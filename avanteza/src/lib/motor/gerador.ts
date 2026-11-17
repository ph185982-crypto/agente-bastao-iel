// Gerador do Motor de Entregas. Funções PURAS (sem banco, sem relógio): recebem "hoje", os serviços contratados com as
// tarefas-modelo, as fases do plano e as ações que já existem, e devolvem o que criar, atualizar, vincular e arquivar.
// Idempotência: cada ação gerada tem recurrence_key = "<tarefa>" (uma vez) ou "<tarefa>@<AAAA-MM-DD>" (recorrente).
// Rodar duas vezes com a mesma entrada não cria nada na segunda. Ações concluídas, em andamento, bloqueadas ou
// editadas à mão (edited_at) nunca são sobrescritas; dispensadas (archived_at) nunca voltam.
import { addDaysStr, isDateStr } from "../mapa/plan";
import type { Papel, Prioridade, Recorrencia } from "./tipos";

export interface TarefaModelo {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  phase_position: number;
  role: Papel;
  offset_days: number;
  recurrence: Recorrencia;
  recurrence_day: number | null;
  checklist: string[];
  done_criteria: string | null;
  client_dependent: boolean;
  client_visible: boolean;
  estimated_min: number | null;
  priority: Prioridade;
  active: boolean;
}

export interface ServicoContratado {
  id: string; // client_services.id
  service_id: string;
  start_date: string;
  end_date: string | null;
  status: "ativo" | "pausado" | "encerrado";
  assignee_id: string | null;
}

export interface FaseLike {
  id: string;
  position: number;
  starts_on: string | null;
  ends_on: string | null;
}

export interface AcaoExistente {
  id: string;
  title: string;
  status: string;
  origin: string;
  recurrence_key: string | null;
  due_date: string | null;
  edited_at: string | null;
  archived_at: string | null;
  assignee_id: string | null;
}

export interface Responsaveis {
  /** Quem cobre cada papel (do cadastro da equipe). */
  porPapel: Partial<Record<Papel, string>>;
  /** Responsável pela conta do cliente: padrão quando ninguém cobre o papel. */
  gerente: string | null;
}

export interface EntradaGerador {
  hoje: string;
  /** Quantos dias à frente gerar das recorrências (padrão 30). */
  horizonteDias?: number;
  /** Quantos dias para trás recuperar recorrências perdidas (rotina que não rodou). Padrão 3. */
  retroDias?: number;
  servicos: { servico: ServicoContratado; tarefas: TarefaModelo[] }[];
  fases: FaseLike[];
  existentes: AcaoExistente[];
  responsaveis: Responsaveis;
}

export interface AcaoDesejada {
  key: string;
  playbookTaskId: string;
  clientServiceId: string;
  serviceId: string;
  title: string;
  description: string | null;
  phaseId: string | null;
  role: Papel;
  assigneeId: string | null;
  dueDate: string;
  owner: "avanteza" | "cliente";
  checklist: { t: string; ok: boolean }[];
  doneCriteria: string | null;
  clientDependent: boolean;
  visibleToClient: boolean;
  estimatedMin: number | null;
  priority: Prioridade;
  recorrente: boolean;
}

export interface PlanoGeracao {
  janela: { de: string; ate: string };
  criar: AcaoDesejada[];
  /** Ações geradas antes, ainda intocadas, cujo modelo mudou (título, descrição, prazo, fase…). */
  atualizar: { id: string; desejada: AcaoDesejada }[];
  /** Ações que já existiam com o mesmo título (plano de 12 meses ou manuais): passam a ser desta tarefa, sem duplicar. */
  vincular: { id: string; desejada: AcaoDesejada }[];
  /** Ações geradas, intocadas e em aberto que não fazem mais sentido (serviço encerrado/pausado, tarefa desativada). */
  arquivar: string[];
  /** Quantas desejadas já existiam e ficaram como estão. */
  mantidas: number;
}

// ── datas ──
/** Dia da semana ISO (1 = segunda … 7 = domingo). */
export function diaSemana(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
const diffDias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const ultimoDia = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * Datas de uma tarefa recorrente dentro de [de, ate], a partir de `base` (início do serviço + D+n) e até `fim` (fim do serviço).
 * - semanal/quinzenal: no dia da semana preferido (ou o da base), a cada 7/14 dias, a partir da 1ª data >= base;
 * - mensal: no dia do mês preferido (dia que não existe no mês vira o último), a partir do mês da base.
 * Uma vez ("none"): só a base, sem olhar a janela.
 */
export function ocorrencias(rec: Recorrencia, dia: number | null, base: string, de: string, ate: string, fim: string | null = null): string[] {
  if (!isDateStr(base)) throw new Error("Data base inválida.");
  if (rec === "none") return fim && base > fim ? [] : [base];
  const limite = fim && fim < ate ? fim : ate;
  const out: string[] = [];
  if (rec === "semanal" || rec === "quinzenal") {
    const passo = rec === "semanal" ? 7 : 14;
    const alvo = dia && dia >= 1 && dia <= 7 ? dia : diaSemana(base);
    let d = addDaysStr(base, (alvo - diaSemana(base) + 7) % 7);
    // pula direto para perto da janela (sem perder o alinhamento da quinzena)
    if (d < de) d = addDaysStr(d, Math.floor(diffDias(d, de) / passo) * passo);
    for (; d <= limite; d = addDaysStr(d, passo)) if (d >= de && d >= base) out.push(d);
    return out;
  }
  // mensal
  const [by, bm] = base.split("-").map(Number);
  const [ly, lm] = limite.split("-").map(Number);
  const meses = (ly - by) * 12 + (lm - bm);
  for (let i = 0; i <= meses; i++) {
    const y = by + Math.floor((bm - 1 + i) / 12);
    const m0 = (bm - 1 + i) % 12;
    const dd = Math.min(dia && dia >= 1 ? dia : Number(base.slice(8, 10)), ultimoDia(y, m0));
    const d = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (d >= base && d >= de && d <= limite) out.push(d);
  }
  return out;
}

export const chaveRecorrencia = (tarefaId: string, data: string | null) => (data ? `${tarefaId}@${data}` : tarefaId);
export const normalizarTitulo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fase da ação: a da data (quando cai dentro de uma fase); senão a da posição pedida pela tarefa; senão nenhuma. */
export function faseDaAcao(fases: FaseLike[], data: string, posicao: number, recorrente: boolean): string | null {
  const daData = fases.find((f) => f.starts_on && f.ends_on && f.starts_on <= data && data <= f.ends_on)?.id ?? null;
  const daPosicao = fases.find((f) => f.position === posicao)?.id ?? null;
  return recorrente ? daData ?? daPosicao : daPosicao ?? daData;
}

/** Todas as ações que DEVERIAM existir para a janela (uma vez: sempre; recorrentes: só dentro da janela). */
export function acoesDesejadas(e: EntradaGerador): { de: string; ate: string; acoes: AcaoDesejada[] } {
  if (!isDateStr(e.hoje)) throw new Error("Data de hoje inválida.");
  const de = addDaysStr(e.hoje, -(e.retroDias ?? 3));
  const ate = addDaysStr(e.hoje, e.horizonteDias ?? 30);
  const out: AcaoDesejada[] = [];
  const vistas = new Set<string>();
  for (const { servico: s, tarefas } of e.servicos) {
    if (s.status !== "ativo" || !isDateStr(s.start_date)) continue;
    for (const t of tarefas) {
      if (!t.active) continue;
      const base = addDaysStr(s.start_date, Math.max(0, t.offset_days));
      const recorrente = t.recurrence !== "none";
      for (const data of ocorrencias(t.recurrence, t.recurrence_day, base, de, ate, s.end_date)) {
        const key = chaveRecorrencia(t.id, recorrente ? data : null);
        if (vistas.has(key)) continue;
        vistas.add(key);
        out.push({
          key,
          playbookTaskId: t.id,
          clientServiceId: s.id,
          serviceId: s.service_id,
          title: t.title,
          description: t.description,
          phaseId: faseDaAcao(e.fases, data, t.phase_position, recorrente),
          role: t.role,
          assigneeId: s.assignee_id ?? e.responsaveis.porPapel[t.role] ?? e.responsaveis.gerente ?? null,
          dueDate: data,
          owner: t.client_dependent ? "cliente" : "avanteza",
          checklist: t.checklist.filter((x) => x.trim()).map((x) => ({ t: x.trim(), ok: false })),
          doneCriteria: t.done_criteria,
          clientDependent: t.client_dependent,
          visibleToClient: t.client_visible,
          estimatedMin: t.estimated_min,
          priority: t.priority,
          recorrente,
        });
      }
    }
  }
  out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.priority - b.priority));
  return { de, ate, acoes: out };
}

/** Compara o desejado com o existente e decide o que fazer. Determinístico. */
export function planejarGeracao(e: EntradaGerador): PlanoGeracao {
  const { de, ate, acoes } = acoesDesejadas(e);
  const porChave = new Map(e.existentes.filter((a) => a.recurrence_key).map((a) => [a.recurrence_key!, a]));
  // candidatas a vínculo: ações sem chave (plano de 12 meses, manuais), não dispensadas, por título normalizado
  const semChave = new Map<string, AcaoExistente>();
  for (const a of e.existentes) if (!a.recurrence_key && !a.archived_at) {
    const k = normalizarTitulo(a.title);
    if (!semChave.has(k)) semChave.set(k, a);
  }
  const plano: PlanoGeracao = { janela: { de, ate }, criar: [], atualizar: [], vincular: [], arquivar: [], mantidas: 0 };
  const desejadas = new Set<string>();
  for (const d of acoes) {
    desejadas.add(d.key);
    const ex = porChave.get(d.key);
    if (ex) {
      // vinculadas (origem plano/manual), concluídas, em andamento, bloqueadas, editadas ou dispensadas: ficam como estão
      if (ex.origin !== "playbook" || ex.archived_at || ex.edited_at || ex.status !== "planejada") { plano.mantidas++; continue; }
      if (ex.title !== d.title || ex.due_date !== d.dueDate) plano.atualizar.push({ id: ex.id, desejada: d });
      else plano.mantidas++;
      continue;
    }
    if (!d.recorrente) {
      const igual = semChave.get(normalizarTitulo(d.title));
      if (igual) {
        semChave.delete(normalizarTitulo(d.title));
        plano.vincular.push({ id: igual.id, desejada: d });
        continue;
      }
    }
    plano.criar.push(d);
  }
  for (const a of e.existentes) {
    if (!a.recurrence_key || a.origin !== "playbook" || desejadas.has(a.recurrence_key)) continue;
    if (a.archived_at || a.edited_at || a.status !== "planejada") continue;
    const recorrente = a.recurrence_key.includes("@");
    const naJanela = Boolean(a.due_date && a.due_date >= de && a.due_date <= ate);
    if (!recorrente || naJanela) plano.arquivar.push(a.id);
  }
  return plano;
}

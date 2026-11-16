// Saúde do cliente (semáforo da Carteira e do alerta de risco). Função PURA: recebe os dados e "hoje", devolve o nível e
// os motivos em português, prontos para mostrar. Regras simples e explícitas (o dono precisa entender por que ficou vermelho).
export type Nivel = "verde" | "amarelo" | "vermelho";

export interface EntradaSaude {
  hoje: string;
  /** Início do relacionamento (serviço mais antigo ou início do plano). Sem início, nada de "dias sem…" é cobrado. */
  inicio: string | null;
  acoes: { status: string; due_date: string | null; completed_at: string | null; client_dependent?: boolean; blocked_reason?: string | null; owner?: string }[];
  /** Datas (AAAA-MM-DD ou ISO) das reuniões registradas. */
  reunioes: string[];
  /** Canais de mídia (Meta/Windsor): status e erros da última coleta. */
  canais: { status: string; last_error?: string | null; ig_last_error?: string | null }[];
  /** Contas de marketplace: status e erro. */
  contas: { marketplace: string; nickname?: string | null; status: string; last_error?: string | null }[];
}

export interface Saude {
  nivel: Nivel;
  motivos: string[];
  pontos: number;
  metricas: {
    pctPlano: number;
    total: number;
    concluidas: number;
    atrasadas: number;
    atrasoMaxDias: number;
    bloqueadasCliente: number;
    diasSemEntrega: number | null;
    diasSemReuniao: number | null;
    canaisComErro: number;
  };
}

const dia = (s: string) => s.slice(0, 10);
const dias = (a: string, b: string) => Math.round((Date.parse(`${dia(b)}T00:00:00Z`) - Date.parse(`${dia(a)}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function calcularSaude(e: EntradaSaude): Saude {
  const abertas = e.acoes.filter((a) => a.status !== "concluida");
  const concluidas = e.acoes.filter((a) => a.status === "concluida");
  const atrasadas = abertas.filter((a) => a.due_date && dia(a.due_date) < e.hoje);
  const atrasoMax = atrasadas.reduce((m, a) => Math.max(m, dias(a.due_date!, e.hoje)), 0);
  const bloqueadas = abertas.filter((a) => a.status === "bloqueada");
  const ultimaEntrega = concluidas.map((a) => a.completed_at).filter(Boolean).map((s) => dia(s!)).sort().pop() ?? null;
  const ultimaReuniao = e.reunioes.map(dia).filter((d) => d <= e.hoje).sort().pop() ?? null;
  const decorridos = e.inicio ? dias(e.inicio, e.hoje) : null;
  const diasSemEntrega = ultimaEntrega ? dias(ultimaEntrega, e.hoje) : decorridos !== null && decorridos >= 0 ? decorridos : null;
  const diasSemReuniao = ultimaReuniao ? dias(ultimaReuniao, e.hoje) : decorridos !== null && decorridos >= 0 ? decorridos : null;
  const canaisErro = e.canais.filter((c) => c.status === "erro" || c.status === "desconectado" || Boolean(c.last_error) || Boolean(c.ig_last_error));
  const contasErro = e.contas.filter((c) => c.status !== "active" || Boolean(c.last_error));

  const motivos: { peso: number; texto: string }[] = [];
  const add = (peso: number, texto: string) => motivos.push({ peso, texto });

  if (atrasadas.length >= 3 || atrasoMax > 7) add(3, `${plural(atrasadas.length, "ação atrasada", "ações atrasadas")} (a mais antiga há ${plural(atrasoMax, "dia", "dias")})`);
  else if (atrasadas.length > 0) add(1, `${plural(atrasadas.length, "ação atrasada", "ações atrasadas")}`);

  if (bloqueadas.length >= 3) add(3, `${plural(bloqueadas.length, "ação parada", "ações paradas")} esperando o cliente`);
  else if (bloqueadas.length > 0) add(1, `${plural(bloqueadas.length, "ação parada", "ações paradas")} esperando o cliente`);

  // só cobra ritmo depois da primeira semana de relacionamento
  if (decorridos !== null && decorridos >= 7 && e.acoes.length > 0) {
    if (diasSemEntrega !== null && diasSemEntrega > 14) add(3, ultimaEntrega ? `${diasSemEntrega} dias sem entrega concluída` : "nenhuma entrega concluída ainda");
    else if (diasSemEntrega !== null && diasSemEntrega > 7) add(1, `${diasSemEntrega} dias sem entrega concluída`);
  }
  if (decorridos !== null && decorridos >= 15) {
    if (diasSemReuniao !== null && diasSemReuniao > 30) add(3, ultimaReuniao ? `${diasSemReuniao} dias sem reunião` : "nenhuma reunião registrada");
    else if (diasSemReuniao !== null && diasSemReuniao > 15) add(1, ultimaReuniao ? `${diasSemReuniao} dias sem reunião` : "nenhuma reunião registrada");
  }

  const desconectados = canaisErro.filter((c) => c.status === "desconectado").length + contasErro.filter((c) => c.status === "reauth_required" || c.status === "disabled").length;
  if (desconectados > 0) add(3, `${plural(desconectados, "canal ou conta desconectado", "canais ou contas desconectados")}`);
  const comErro = canaisErro.length + contasErro.length - desconectados;
  if (comErro > 0) add(1, `${plural(comErro, "canal ou conta com erro", "canais ou contas com erro")} na última coleta`);

  const total = e.acoes.length;
  const pct = total ? Math.round((concluidas.length / total) * 100) : 0;
  const pontos = motivos.reduce((s, m) => s + m.peso, 0);
  const nivel: Nivel = motivos.some((m) => m.peso >= 3) || pontos >= 4 ? "vermelho" : pontos > 0 ? "amarelo" : "verde";
  return {
    nivel,
    motivos: motivos.sort((a, b) => b.peso - a.peso).map((m) => m.texto),
    pontos,
    metricas: {
      pctPlano: pct, total, concluidas: concluidas.length, atrasadas: atrasadas.length, atrasoMaxDias: atrasoMax,
      bloqueadasCliente: bloqueadas.length, diasSemEntrega, diasSemReuniao, canaisComErro: canaisErro.length + contasErro.length,
    },
  };
}

const ORDEM: Record<Nivel, number> = { vermelho: 0, amarelo: 1, verde: 2 };
/** Ordena por risco: vermelho → amarelo → verde; dentro do nível, mais pontos primeiro; depois por nome. */
export function ordenarPorRisco<T extends { saude: Saude; nome: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => ORDEM[a.saude.nivel] - ORDEM[b.saude.nivel] || b.saude.pontos - a.saude.pontos || a.nome.localeCompare(b.nome, "pt-BR"));
}

export const ROTULO_NIVEL: Record<Nivel, string> = { verde: "Em dia", amarelo: "Atenção", vermelho: "Em risco" };

// Evento "contrato.assinado" (Comercial → Central) e o onboarding automático do cliente.
// Contrato do evento em docs/eventos.md. Tudo idempotente: rodar o mesmo evento 2× não duplica cliente, serviço, ação,
// acesso nem receita. O estado de cada contrato fica em avanteza.onboardings (um por envelope).
// Passos: cliente (CNPJ → nome normalizado → novo) · serviços contratados (+ Onboarding) · plano de 12 meses · Kickoff D+2 ·
// playbooks (gerador do Motor) · acesso ao Mapa (senha só como hash; texto UMA vez em notificação ao admin) ·
// receita recorrente no Financeiro do Vendedor IA (indisponível → pendência e o evento volta para a fila) · auditoria.
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rawQuery } from "../db/client";
import { spDate } from "../dates";
import { addDaysStr, addMonthsStr, isDateStr } from "../mapa/plan";
import { generatePassword, generatePlanFor } from "../mapa/admin";
import { aplicarPlaybooks } from "../motor/repo";
import { notificar } from "../notificacoes";
import { mensagemDoErro, provedorFinanceiroDoAmbiente, type FinanceiroProvider } from "../financeiro/vendedoria";
import type { DepsEvento, ResultadoHandler, TipoEvento } from "./registro";

const dataStr = z.string().refine(isDateStr, "data AAAA-MM-DD");
const txt = (max: number) => z.string().trim().min(1).max(max);

export const ContratoAssinadoPayload = z.object({
  contratoId: txt(120),
  envelopeId: txt(120).regex(/^[\w.@-]+$/, "envelopeId: só letras, números e . @ _ -"),
  razaoSocial: txt(200),
  nomeFantasia: txt(200).nullish(),
  cnpj: z.string().trim().max(30).nullish(),
  representante: txt(160).nullish(),
  emailCliente: z.string().trim().toLowerCase().email().max(200).nullish(),
  telefoneCliente: z.string().trim().max(40).nullish(),
  modelo: txt(120),
  plano: txt(120).nullish(),
  servicos: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/)).max(20).default([]),
  valorMensal: z.number().finite().positive().max(10_000_000).nullish(),
  duracaoMeses: z.number().int().min(1).max(120).nullish(),
  inicioEm: dataStr.nullish(),
  vencimentoDia: z.number().int().min(1).max(31).nullish(),
  oportunidadeId: z.string().trim().max(120).nullish(),
  leadId: z.string().trim().max(120).nullish(),
  pdfUrl: z.string().trim().max(2000).refine((u) => /^https:\/\/\S+$/i.test(u), "pdfUrl deve ser https").nullish(),
  /** Só a tela "Simular contrato assinado" da Central manda: não lança receita no Financeiro (a menos que peça). */
  simulado: z.boolean().optional(),
});
export type ContratoAssinado = z.infer<typeof ContratoAssinadoPayload>;

// ───────── funções puras (testadas sem banco) ─────────
export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");
export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}
/** Nome para comparar empresas: sem acento, sem caixa, sem pontuação e sem sufixo societário (Ltda, ME, EIRELI, S/A…). */
export function nomeNormalizado(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\bs\s*\/\s*a\b/g, " ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ltda|me|mei|epp|eireli|sa|cia|limitada|comercio|servicos)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
}
/** 1º vencimento: o dia de vencimento no mês do início (ou no seguinte, se já passou); sem dia, o próprio início. */
export function primeiroVencimento(inicio: string, dia?: number | null): string {
  if (!dia) return inicio;
  const [y, m] = inicio.split("-").map(Number);
  const ultimo = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const mk = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(dia, ultimo(yy, mm))).padStart(2, "0")}`;
  const neste = mk(y, m);
  return neste >= inicio ? neste : mk(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
}
export const marcaFinanceiro = (envelopeId: string) => `[ref:${envelopeId}]`;
const dataDoInstante = (iso: string | undefined, hoje: string) => (iso ? (isDateStr(iso) ? iso : spDate(new Date(iso))) : hoje);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function audit(event: string, clientId: string | null, details: Record<string, unknown>) {
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ($1,'evento:contrato.assinado',$2,$3)", [event, clientId, JSON.stringify(details)]);
}

interface Onb {
  envelope_id: string; client_id: string | null; cliente_criado: boolean; kickoff_action_id: string | null; acesso_email: string | null; acesso_status: string | null;
  financeiro_status: "pendente" | "feito" | "sem_valor" | "simulacao"; financeiro_ref: string | null; financeiro_tentativas: number;
}

// ───────── passos ─────────
async function casarOuCriarCliente(p: ContratoAssinado, inicio: string, kind: string): Promise<{ id: string; criado: boolean; nome: string }> {
  const cnpj = soDigitos(p.cnpj);
  const cnpjOk = cnpj.length === 14 ? cnpj : null;
  if (cnpjOk) {
    const [c] = await rawQuery<{ id: string; name: string }>("select id, name from avanteza.clients where cnpj = $1", [cnpjOk]);
    if (c) return { id: c.id, criado: false, nome: c.name };
  }
  const alvos = [p.nomeFantasia, p.razaoSocial].filter(Boolean).map((n) => nomeNormalizado(n!)).filter((n) => n.length >= 2);
  const todos = await rawQuery<{ id: string; name: string; cnpj: string | null }>("select id, name, cnpj from avanteza.clients");
  // mesmo nome, mas outro CNPJ cadastrado = outra empresa
  const iguais = todos.filter((c) => alvos.includes(nomeNormalizado(c.name)) && (!c.cnpj || !cnpjOk || c.cnpj === cnpjOk));
  if (iguais.length > 1) throw new Error(`Mais de um cliente com o nome "${p.nomeFantasia ?? p.razaoSocial}": informe o CNPJ no cadastro certo e reprocesse.`);
  const nome = (p.nomeFantasia || p.razaoSocial).trim();
  if (iguais.length === 1) {
    const c = iguais[0];
    await rawQuery(
      `update avanteza.clients set cnpj = coalesce(cnpj, $2), contact_name = coalesce(contact_name, $3), contact_email = coalesce(contact_email, $4),
         contact_phone = coalesce(contact_phone, $5), owner_name = coalesce(owner_name, $3), start_date = coalesce(start_date, $6) where id = $1`,
      [c.id, cnpjOk, p.representante ?? null, p.emailCliente ?? null, p.telefoneCliente ?? null, inicio],
    );
    return { id: c.id, criado: false, nome: c.name };
  }
  const base = slugify(nome);
  const usados = new Set((await rawQuery<{ slug: string }>("select slug from avanteza.clients where slug like $1", [`${base}%`])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; usados.has(slug); i++) slug = `${base}-${i}`;
  const [novo] = await rawQuery<{ id: string }>(
    `insert into avanteza.clients (name, slug, kind, start_date, cnpj, contact_name, contact_email, contact_phone, owner_name, notes, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$6,$9,true) returning id`,
    [nome, slug, kind, inicio, cnpjOk, p.representante ?? null, p.emailCliente ?? null, p.telefoneCliente ?? null,
      `Criado pelo contrato assinado (${p.modelo}${p.plano ? ` · ${p.plano}` : ""}). Razão social: ${p.razaoSocial}.`],
  );
  return { id: novo.id, criado: true, nome };
}

/** Nomes curtos aceitos no contrato → slug do catálogo (o gerador de contratos usa "midias"). */
export const ALIAS_SERVICO: Record<string, string> = {
  midias: "midias-sociais", midia: "midias-sociais", social: "midias-sociais", "redes-sociais": "midias-sociais",
  marketplaces: "marketplace", "trafego-pago": "trafego", ads: "trafego",
};
export const slugsDoContrato = (servicos: string[]) => [...new Set(servicos.map((s) => ALIAS_SERVICO[s] ?? s))];

async function criarServicos(clientId: string, p: ContratoAssinado, inicio: string) {
  const pedidos = slugsDoContrato(p.servicos);
  const slugs = [...new Set(["onboarding", ...pedidos])];
  const cat = await rawQuery<{ id: string; slug: string }>("select id, slug from avanteza.service_catalog where slug = any($1::text[])", [slugs]);
  const desconhecidos = pedidos.filter((s) => !cat.some((c) => c.slug === s));
  const vendidos = cat.filter((c) => c.slug !== "onboarding");
  const fim = p.duracaoMeses ? addDaysStr(addMonthsStr(inicio, p.duracaoMeses), -1) : null;
  const valor = p.valorMensal && vendidos.length ? Math.round((p.valorMensal / vendidos.length) * 100) / 100 : null;
  const nota = p.valorMensal && vendidos.length > 1 ? `Mensalidade do contrato (${brl(p.valorMensal)}) dividida igualmente entre ${vendidos.length} serviços.` : null;
  let criados = 0;
  for (const c of cat) {
    const r = await rawQuery(
      `insert into avanteza.client_services (client_id, service_id, start_date, end_date, monthly_value, contract_ref, status, notes)
       values ($1,$2,$3,$4,$5,$6,'ativo',$7) on conflict (client_id, service_id) do nothing returning id`,
      [clientId, c.id, inicio, c.slug === "onboarding" ? null : fim, c.slug === "onboarding" ? null : valor, p.contratoId, c.slug === "onboarding" ? null : nota],
    );
    criados += r.length;
  }
  return { criados, servicos: cat.map((c) => c.slug), desconhecidos };
}

const TITULO_KICKOFF = "Reunião de kickoff e alinhamento de metas";

async function criarKickoff(clientId: string, devido: string): Promise<string> {
  // O plano de 12 meses já traz o Kickoff (no tipo "ambos", um por frente: "Marketplaces: …" e "Mídia: …"). A reunião é
  // uma só: reaproveita a primeira (título padrão e prazo D+2, se ninguém mexeu nela) e dispensa as outras do plano.
  const kick = await rawQuery<{ id: string; status: string; edited_at: string | null }>(
    `select id, status, edited_at::text from avanteza.plan_actions where client_id = $1 and title ilike '%reunião de kickoff%' and archived_at is null order by position, created_at`,
    [clientId],
  );
  if (kick.length) {
    const [primeira, ...resto] = kick;
    if (primeira.status !== "concluida" && !primeira.edited_at) {
      await rawQuery("update avanteza.plan_actions set title = $2, due_date = $3, sla_due = $3, priority = 1, updated_at = now() where id = $1", [primeira.id, TITULO_KICKOFF, devido]);
    }
    const sobras = resto.filter((a) => a.status === "planejada" && !a.edited_at).map((a) => a.id);
    if (sobras.length) await rawQuery("update avanteza.plan_actions set archived_at = now(), updated_at = now() where id = any($1::uuid[]) and origin = 'plano'", [sobras]);
    return primeira.id;
  }
  const [fase] = await rawQuery<{ id: string }>("select id from avanteza.plan_phases where client_id = $1 order by position limit 1", [clientId]);
  const [cli] = await rawQuery<{ manager_id: string | null }>("select manager_id from avanteza.clients where id = $1", [clientId]);
  // Mesmo título da tarefa do playbook de Onboarding: o gerador VINCULA esta ação à tarefa (não cria outra).
  const [a] = await rawQuery<{ id: string }>(
    `insert into avanteza.plan_actions (client_id, phase_id, title, description, owner, due_date, sla_due, origin, priority, assignee_id, visible_to_client, role)
     values ($1,$2,'${TITULO_KICKOFF}','Apresentar a Avanteza, o plano de 12 meses, a rotina de reuniões e combinar as metas. Agendada automaticamente pelo contrato assinado.',
             'avanteza',$3,$3,'manual',1,$4,true,'gestor_conta') returning id`,
    [clientId, fase?.id ?? null, devido, cli?.manager_id ?? null],
  );
  return a.id;
}

async function criarAcesso(clientId: string, nome: string, email: string | null | undefined): Promise<{ status: string; senha: string | null }> {
  if (!email) return { status: "sem_email", senha: null };
  const [u] = await rawQuery<{ role: string }>("select role from avanteza.admins where email = $1", [email]);
  if (u && u.role !== "client") return { status: "email_da_equipe", senha: null };
  if (u) {
    await rawQuery("insert into avanteza.client_user_clients (user_email, client_id) values ($1,$2) on conflict do nothing", [email, clientId]);
    return { status: "vinculado", senha: null };
  }
  const senha = generatePassword();
  await rawQuery(
    "insert into avanteza.admins (email, name, role, client_id, apps, active, password_hash) values ($1,$2,'client',$3,'{}',true,$4) on conflict (email) do nothing",
    [email, nome, clientId, await bcrypt.hash(senha, 12)],
  );
  await rawQuery("insert into avanteza.client_user_clients (user_email, client_id) values ($1,$2) on conflict do nothing", [email, clientId]);
  return { status: "criado", senha };
}

async function lancarReceita(fin: FinanceiroProvider, p: ContratoAssinado, nome: string, inicio: string): Promise<string> {
  const marca = marcaFinanceiro(p.envelopeId);
  // Já existe (resposta perdida numa tentativa anterior)? Não lança de novo.
  const existentes = await fin.contratos("empresa");
  const ja = existentes.find((c) => c.descricao.includes(marca));
  if (ja) return ja.id;
  await fin.criarReceita("empresa", {
    modo: "recorrente",
    descricao: `Mensalidade ${nome} ${marca}`.slice(0, 200),
    data_prevista: primeiroVencimento(inicio, p.vencimentoDia),
    valor_parcela: p.valorMensal!,
    meses: p.duracaoMeses ?? null,
    cliente: nome.slice(0, 120),
    observacao: `Contrato ${p.modelo}${p.plano ? ` · ${p.plano}` : ""} assinado (${p.contratoId}).`.slice(0, 500),
  });
  const depois = await fin.contratos("empresa");
  return depois.find((c) => c.descricao.includes(marca))?.id ?? marca;
}

export async function onboardingContrato(ev: { id: string; ocorrido_em?: string; origem: string; payload: ContratoAssinado }, deps: DepsEvento = {}): Promise<ResultadoHandler> {
  const p = ev.payload;
  const hoje = deps.hoje ?? spDate();
  const assinado = dataDoInstante(ev.ocorrido_em, hoje);
  const inicio = p.inicioEm ?? assinado;
  const pendencias: string[] = [];
  const feito: Record<string, unknown> = { envelopeId: p.envelopeId };

  await rawQuery("insert into avanteza.onboardings (envelope_id, evento_id) values ($1,$2) on conflict (envelope_id) do nothing", [p.envelopeId, ev.id]);
  const onb = async () => (await rawQuery<Onb>("select * from avanteza.onboardings where envelope_id = $1", [p.envelopeId]))[0];
  let o = await onb();

  // 1) cliente
  let clientId = o.client_id, nome = "";
  if (clientId) {
    const [c] = await rawQuery<{ name: string }>("select name from avanteza.clients where id = $1", [clientId]);
    if (!c) clientId = null; else nome = c.name;
  }
  if (!clientId) {
    const kinds = await rawQuery<{ kind: string }>("select distinct kind from avanteza.service_catalog where slug = any($1::text[]) and kind in ('marketplace','midia','ambos')", [slugsDoContrato(p.servicos)]);
    const k = new Set(kinds.map((x) => x.kind));
    const kind = k.has("ambos") || (k.has("marketplace") && k.has("midia")) ? "ambos" : k.has("midia") ? "midia" : "marketplace";
    const c = await casarOuCriarCliente(p, inicio, kind);
    clientId = c.id; nome = c.nome;
    await rawQuery("update avanteza.onboardings set client_id = $2, cliente_criado = $3, atualizado_em = now() where envelope_id = $1", [p.envelopeId, clientId, c.criado]);
    await audit(c.criado ? "onboarding_cliente_criado" : "onboarding_cliente_casado", clientId, { envelopeId: p.envelopeId, contratoId: p.contratoId });
    if (c.criado) {
      await notificar({ tipo: "cliente_novo", titulo: `Cliente novo: ${nome}`, corpo: `Criado pelo contrato ${p.modelo}${p.plano ? ` (${p.plano})` : ""}.`, link: `/clientes/${clientId}`, para: "equipe", clientId, dedupKey: `cliente-novo:${clientId}` });
    }
    o = await onb();
  }
  feito.clientId = clientId;
  feito.clienteCriado = o.cliente_criado;

  // 2) serviços contratados (+ Onboarding) — on conflict do nothing
  const sv = await criarServicos(clientId, p, inicio);
  feito.servicos = sv.servicos;
  if (sv.desconhecidos.length) feito.servicosDesconhecidos = sv.desconhecidos; // não trava: o admin cadastra no catálogo
  if (sv.criados) await audit("onboarding_servicos", clientId, { criados: sv.criados, servicos: sv.servicos });

  // 3) plano de 12 meses (se ainda não tem) e Kickoff D+2
  const temPlano = (await rawQuery("select 1 from avanteza.plan_phases where client_id = $1 limit 1", [clientId])).length > 0;
  if (!temPlano) {
    await rawQuery("update avanteza.clients set start_date = coalesce(start_date, $2) where id = $1", [clientId, inicio]);
    await generatePlanFor(clientId);
    await audit("onboarding_plano", clientId, { inicio });
  }
  if (!o.kickoff_action_id) {
    const id = await criarKickoff(clientId, addDaysStr(assinado, 2));
    await rawQuery("update avanteza.onboardings set kickoff_action_id = $2, atualizado_em = now() where envelope_id = $1", [p.envelopeId, id]);
    await audit("onboarding_kickoff", clientId, { acao: id, prazo: addDaysStr(assinado, 2) });
  }
  feito.kickoff = addDaysStr(assinado, 2);

  // 4) playbooks (gerador do Motor; idempotente pela recurrence_key)
  const ap = await aplicarPlaybooks(clientId, { hoje, actor: "evento:contrato.assinado", inicio });
  feito.playbooks = ap.gravado;

  // 5) acesso ao Mapa
  if (!o.acesso_status) {
    const a = await criarAcesso(clientId, nome, p.emailCliente);
    await rawQuery("update avanteza.onboardings set acesso_status = $2, acesso_email = $3, atualizado_em = now() where envelope_id = $1", [p.envelopeId, a.status, p.emailCliente ?? null]);
    await audit("onboarding_acesso", clientId, { status: a.status });
    if (a.status === "criado") {
      const n = await notificar({
        tipo: "acesso_cliente", titulo: `Acesso ao Mapa criado: ${nome}`, para: "admin", clientId, dedupKey: `acesso:${p.envelopeId}`,
        corpo: `Usuário ${p.emailCliente}. A senha inicial aparece uma única vez ao abrir esta notificação; envie por canal seguro.`, link: `/clientes/${clientId}`,
        segredo: a.senha,
      });
      if (!n.segredoGuardado) {
        await notificar({ tipo: "acesso_cliente", titulo: `Acesso ao Mapa de ${nome}: gere a senha`, para: "admin", clientId, dedupKey: `acesso-sem-senha:${p.envelopeId}`,
          corpo: "ENCRYPTION_KEY ausente: a senha inicial não pôde ser guardada. Use “Redefinir senha” na tela do cliente.", link: `/clientes/${clientId}` });
      }
    } else if (a.status !== "vinculado") {
      await notificar({ tipo: "acesso_cliente", titulo: `Acesso ao Mapa de ${nome} pendente`, para: "admin", clientId, dedupKey: `acesso-pendente:${p.envelopeId}`,
        corpo: a.status === "sem_email" ? "O contrato veio sem e-mail do cliente: crie o acesso na tela do cliente." : "O e-mail do contrato é da equipe Avanteza: crie o acesso com o e-mail do cliente.", link: `/clientes/${clientId}` });
    }
    o = await onb();
  }
  feito.acesso = o.acesso_status;

  // 6) receita recorrente no Financeiro (Vendedor IA)
  if (o.financeiro_status === "pendente") {
    if (!p.valorMensal) {
      await rawQuery("update avanteza.onboardings set financeiro_status = 'sem_valor', atualizado_em = now() where envelope_id = $1", [p.envelopeId]);
    } else if (p.simulado) {
      await rawQuery("update avanteza.onboardings set financeiro_status = 'simulacao', atualizado_em = now() where envelope_id = $1", [p.envelopeId]);
    } else {
      try {
        const fin = deps.financeiro === undefined ? provedorFinanceiroDoAmbiente() : deps.financeiro;
        if (!fin) throw new Error("Financeiro indisponível.");
        const ref = await lancarReceita(fin, p, nome, inicio);
        await rawQuery("update avanteza.onboardings set financeiro_status = 'feito', financeiro_ref = $2, financeiro_erro = null, financeiro_tentativas = financeiro_tentativas + 1, atualizado_em = now() where envelope_id = $1", [p.envelopeId, ref]);
        await audit("onboarding_receita", clientId, { ref, mensal: p.valorMensal, meses: p.duracaoMeses ?? null });
      } catch (e) {
        const msg = mensagemDoErro(e).slice(0, 300);
        await rawQuery("update avanteza.onboardings set financeiro_erro = $2, financeiro_tentativas = financeiro_tentativas + 1, atualizado_em = now() where envelope_id = $1", [p.envelopeId, msg]);
        pendencias.push(`Financeiro: ${msg}`);
      }
    }
    o = await onb();
  }
  feito.financeiro = o.financeiro_status;

  await rawQuery("update avanteza.onboardings set pendencias = $2, atualizado_em = now() where envelope_id = $1", [p.envelopeId, JSON.stringify(pendencias)]);
  await notificar({
    tipo: "contrato_assinado", titulo: `Contrato assinado: ${nome}`, para: "admin", clientId, dedupKey: `contrato:${p.envelopeId}`, link: "/operacoes/onboarding",
    corpo: `${p.modelo}${p.plano ? ` · ${p.plano}` : ""}${p.valorMensal ? ` · ${brl(p.valorMensal)}/mês` : ""}${p.simulado ? " · simulação" : ""}. Cliente, serviços, plano, Kickoff (${addDaysStr(assinado, 2).split("-").reverse().join("/")}) e acesso preparados.`,
  });
  return { resultado: feito, pendencias };
}

export const tipoContratoAssinado: TipoEvento<ContratoAssinado> = {
  tipo: "contrato.assinado",
  descricao: "Contrato assinado no ClickSign: onboarding automático do cliente.",
  payload: ContratoAssinadoPayload as z.ZodType<ContratoAssinado>,
  validarId: (id, p) => (id === `contrato.assinado:${p.envelopeId}` ? null : 'id deve ser "contrato.assinado:<envelopeId>"'),
  handler: (ev, deps) => onboardingContrato(ev, deps),
};

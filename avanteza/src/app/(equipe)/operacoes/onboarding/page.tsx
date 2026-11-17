// Operações → Onboarding: cada contrato assinado (evento "contrato.assinado") e o que o onboarding automático já fez —
// cliente, serviços, Kickoff, acesso ao Mapa e receita no Financeiro — com as pendências e o botão de reprocessar.
// Administrador também simula um contrato assinado (para testar sem ClickSign); em produção, com confirmação dupla.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { rawQuery } from "@/lib/db/client";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { podeVerMotor } from "@/lib/motor/acesso";
import { listarEventos } from "@/lib/eventos/barramento";
import { emProducao, FRASE_PRODUCAO } from "@/lib/eventos/simulacao";
import { spDate } from "@/lib/dates";
import { reprocessarEventoForm, simularContratoForm } from "./actions";
import "@/components/motor/motor.css";
import "@/components/capturas/capturas.css";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata: Metadata = { title: "Onboarding — Operações — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const ST_EVENTO: Record<string, { t: string; c: string }> = { processado: { t: "Concluído", c: "pill-ok" }, pendente: { t: "Pendente", c: "pill-sand" }, falhou: { t: "Falhou", c: "pill-danger" } };
const ACESSO: Record<string, string> = { criado: "Acesso criado", vinculado: "Acesso existente vinculado", sem_email: "Sem e-mail no contrato", email_da_equipe: "E-mail da equipe (crie à mão)" };
const FIN: Record<string, string> = { feito: "Receita lançada", pendente: "Receita pendente", sem_valor: "Sem valor mensal", simulacao: "Simulação (sem receita)" };

interface Onb { envelope_id: string; evento_id: string; client_id: string | null; client_name: string | null; cliente_criado: boolean; acesso_status: string | null; financeiro_status: string; financeiro_erro: string | null; pendencias: string[]; criado_em: string; kickoff: string | null }

export default async function Onboarding({ searchParams }: { searchParams: Promise<SP> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const admin = sess.role === "admin";
  const [onbs, eventos, catalogo] = await Promise.all([
    rawQuery<Onb>(
      `select o.envelope_id, o.evento_id, o.client_id, c.name as client_name, o.cliente_criado, o.acesso_status, o.financeiro_status, o.financeiro_erro, o.pendencias,
              to_char(o.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as criado_em, a.due_date::text as kickoff
         from avanteza.onboardings o left join avanteza.clients c on c.id = o.client_id left join avanteza.plan_actions a on a.id = o.kickoff_action_id
        order by o.criado_em desc limit 40`,
    ),
    listarEventos(40),
    rawQuery<{ slug: string; name: string }>("select slug, name from avanteza.service_catalog where active and slug <> 'onboarding' order by position, name"),
  ]);
  const ev = new Map(eventos.map((e) => [e.id, e]));
  const prod = emProducao();

  return (
    <>
      <PageHeader eyebrow="Operações" title="Onboarding">
        <p className="muted" style={{ margin: "6px 0 0" }}>Contrato assinado vira cliente, serviços, plano de 12 meses, Kickoff em D+2, acesso ao Mapa e receita no Financeiro — sem duplicar nada.</p>
      </PageHeader>
      <Flash sp={sp} />

      <section className="mt-sec" aria-labelledby="contratos">
        <h2 id="contratos">Contratos assinados</h2>
        {!onbs.length && <p className="muted">Nenhum contrato recebido ainda. {admin ? "Simule um abaixo para ver o fluxo." : ""}</p>}
        <div className="mt-lista">
          {onbs.map((o) => {
            const e = ev.get(o.evento_id);
            const st = ST_EVENTO[e?.status ?? "pendente"];
            return (
              <article key={o.envelope_id} className="cp-item">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    {o.client_id ? <Link className="cli" href={`/clientes/${o.client_id}`}>{o.client_name}</Link> : <span className="cli">Cliente ainda não criado</span>}
                    <div className="small muted">Envelope {o.envelope_id} · recebido {quando(o.criado_em)}{e && e.origem === "simulacao" ? " · simulação" : ""}</div>
                  </div>
                  <span className={`pill ${st.c}`}>{st.t}</span>
                </div>
                <div className="mt-acao" style={{ border: 0, boxShadow: "none", padding: "8px 0 0", background: "transparent" }}>
                  <div className="tags">
                    <span className="pill pill-outline">{o.cliente_criado ? "Cliente novo" : o.client_id ? "Cliente existente" : "—"}</span>
                    {o.kickoff && <span className="pill pill-outline">Kickoff {o.kickoff.split("-").reverse().join("/")}</span>}
                    <span className="pill pill-outline">{ACESSO[o.acesso_status ?? ""] ?? "Acesso pendente"}</span>
                    <span className={`pill ${o.financeiro_status === "pendente" ? "pill-danger" : "pill-outline"}`}>{FIN[o.financeiro_status] ?? o.financeiro_status}</span>
                  </div>
                </div>
                {(o.pendencias?.length > 0 || (e?.erro && e.status !== "processado")) && (
                  <ul className="ob-pend" aria-label="Pendências">
                    {(o.pendencias?.length ? o.pendencias : [e!.erro!]).map((p, i) => <li key={i}>{p}</li>)}
                    {e && e.status === "pendente" && <li className="muted">Nova tentativa automática (tentativa {e.tentativas}).</li>}
                  </ul>
                )}
                {admin && e && e.status !== "processado" && (
                  <form action={reprocessarEventoForm} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={e.id} />
                    <Submit className="btn btn-sm btn-ghost">Reprocessar agora</Submit>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {admin && (
        <section className="mt-sec" aria-labelledby="simular">
          <h2 id="simular">Simular contrato assinado</h2>
          <form action={simularContratoForm} className="cp-box ob-form stack">
            {prod && (
              <p className="notice ob-aviso" role="alert" style={{ margin: 0 }}>
                Você está em PRODUÇÃO: isto cria um cliente real, o acesso dele ao Mapa e as ações no Motor. Use só para testar e apague depois.
              </p>
            )}
            <div className="fgrid">
              <div className="field"><label htmlFor="s-rs">Razão social</label><input id="s-rs" name="razaoSocial" required maxLength={200} placeholder="Loja Exemplo Comércio Ltda" /></div>
              <div className="field"><label htmlFor="s-nf">Nome fantasia</label><input id="s-nf" name="nomeFantasia" maxLength={200} placeholder="Loja Exemplo" /></div>
              <div className="field"><label htmlFor="s-cnpj">CNPJ</label><input id="s-cnpj" name="cnpj" inputMode="numeric" maxLength={20} placeholder="00.000.000/0001-00" /></div>
              <div className="field"><label htmlFor="s-rep">Representante</label><input id="s-rep" name="representante" maxLength={160} /></div>
              <div className="field"><label htmlFor="s-email">E-mail do cliente (acesso ao Mapa)</label><input id="s-email" name="emailCliente" type="email" maxLength={200} /></div>
              <div className="field"><label htmlFor="s-tel">Telefone</label><input id="s-tel" name="telefoneCliente" maxLength={40} /></div>
              <div className="field"><label htmlFor="s-mod">Modelo do contrato</label><input id="s-mod" name="modelo" maxLength={120} defaultValue="Prestação de serviços" /></div>
              <div className="field"><label htmlFor="s-plano">Plano</label><input id="s-plano" name="plano" maxLength={120} placeholder="Essencial" /></div>
              <div className="field"><label htmlFor="s-val">Valor mensal (R$)</label><input id="s-val" name="valorMensal" inputMode="decimal" placeholder="2500" /></div>
              <div className="field"><label htmlFor="s-dur">Duração (meses)</label><input id="s-dur" name="duracaoMeses" type="number" min={1} max={120} defaultValue={12} /></div>
              <div className="field"><label htmlFor="s-ini">Início</label><input id="s-ini" name="inicioEm" type="date" defaultValue={spDate()} /></div>
              <div className="field"><label htmlFor="s-venc">Dia do vencimento</label><input id="s-venc" name="vencimentoDia" type="number" min={1} max={31} defaultValue={10} /></div>
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 6 }}>Serviços contratados</legend>
              <div className="ob-servicos">
                {catalogo.map((c) => <label key={c.slug} className="check"><input type="checkbox" name="servicos" value={c.slug} defaultChecked={c.slug === "marketplace"} /> {c.name}</label>)}
              </div>
            </fieldset>
            <label className="check"><input type="checkbox" name="lancar_receita" /> Lançar também a receita recorrente no Financeiro (desmarcado = simulação sem receita)</label>
            {prod && (
              <div className="stack">
                <label className="check"><input type="checkbox" name="confirma1" required /> Entendo que isto grava dados reais em produção</label>
                <div className="field"><label htmlFor="s-conf">Digite {FRASE_PRODUCAO} para confirmar</label><input id="s-conf" name="confirma2" required autoComplete="off" /></div>
              </div>
            )}
            <div className="btn-row"><Submit className="btn btn-sm btn-orange">Simular contrato assinado</Submit></div>
          </form>
        </section>
      )}
    </>
  );
}

// Operações → Capturas (Inbox de combinados): importar conversa exportada do WhatsApp e ver o que entrou de cada cliente
// (Max, conversa exportada, reunião, manual) com as ações que a IA criou — cada uma pode ser desfeita.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { Submit } from "@/components/Submit";
import { ImportarConversa } from "@/components/capturas/ImportarConversa";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { clientesAtivos, isUuid } from "@/lib/motor/repo";
import { listarCapturas } from "@/lib/capturas/importar";
import { ORIGENS_CAPTURA } from "@/lib/motor/capturas";
import { fmtDate } from "@/lib/mapa/progress";
import { acaoRapidaForm } from "../motor-actions";
import "@/components/motor/motor.css";
import "@/components/capturas/capturas.css";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata: Metadata = { title: "Capturas — Operações — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const ROTULO_ORIGEM: Record<string, string> = { whatsapp_max: "Max (WhatsApp)", whatsapp_export: "Conversa exportada", extensao: "Extensão", reuniao: "Reunião", manual: "Manual", claude: "Claude" };
const ROTULO_STATUS: Record<string, { t: string; c: string }> = {
  processada: { t: "Analisada", c: "pill-ok" }, sem_ia: { t: "Sem IA", c: "pill-outline" }, erro: { t: "Erro na análise", c: "pill-danger" }, recebida: { t: "Recebida", c: "pill-outline" },
};
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function Capturas({ searchParams }: { searchParams: Promise<SP> }) {
  const sess = await requireUser();
  if (!podeVerMotor(sess)) redirect("/central");
  const sp = await searchParams;
  const cliente = isUuid(one(sp.cliente)) ? one(sp.cliente) : null;
  const origem = (ORIGENS_CAPTURA as readonly string[]).includes(one(sp.origem)) ? one(sp.origem) : null;
  const [clientes, capturas] = await Promise.all([clientesAtivos(), listarCapturas({ clientId: cliente, origem, limite: 60 })]);
  const pode = podeTrabalharMotor(sess);
  const back = `/operacoes/capturas${cliente || origem ? `?${new URLSearchParams({ ...(cliente ? { cliente } : {}), ...(origem ? { origem } : {}) })}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Operações" title="Capturas">
        <p className="muted" style={{ margin: "6px 0 0" }}>Conversas do WhatsApp viram combinados: as ações entram direto no plano do cliente com o selo IA e podem ser desfeitas.</p>
      </PageHeader>
      <Flash sp={sp} />

      <section className="mt-sec" aria-labelledby="imp">
        <h2 id="imp">Importar conversa exportada</h2>
        <ImportarConversa clientes={clientes.map((c) => ({ id: c.id, name: c.name }))} podeImportar={pode} />
      </section>

      <section className="mt-sec" aria-labelledby="lista">
        <div className="row">
          <h2 id="lista" style={{ margin: 0 }}>Capturas recebidas</h2>
          <form className="cp-filtros" method="get">
            <label className="sr-only" htmlFor="f-cli">Cliente</label>
            <select id="f-cli" name="cliente" defaultValue={cliente ?? ""}>
              <option value="">Todos os clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="f-ori">Origem</label>
            <select id="f-ori" name="origem" defaultValue={origem ?? ""}>
              <option value="">Todas as origens</option>
              {ORIGENS_CAPTURA.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
            </select>
            <button className="btn btn-sm btn-ghost" type="submit">Filtrar</button>
          </form>
        </div>
        {!capturas.length && <p className="muted">Nenhuma captura{cliente || origem ? " com esse filtro" : " ainda"}. Mande uma mensagem ao Max (“para a Showman: …”) ou importe uma conversa.</p>}
        <div className="mt-lista" style={{ marginTop: 12 }}>
          {capturas.map((k) => {
            const st = ROTULO_STATUS[k.status] ?? ROTULO_STATUS.recebida;
            return (
              <article key={k.id} className="cp-item">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <Link className="cli" href={`/operacoes/capturas?cliente=${k.client_id}`}>{k.client_name}</Link>
                    <div className="small muted">{ROTULO_ORIGEM[k.origem] ?? k.origem}{k.conversa ? ` · ${k.conversa}` : k.autor ? ` · ${k.autor}` : ""} · {quando(k.criado_em)}</div>
                  </div>
                  <span className={`pill ${st.c}`}>{st.t}</span>
                </div>
                {k.trecho && <pre className="cp-trecho">{k.trecho}{k.trecho.length >= 400 ? "…" : ""}</pre>}
                {k.erro && <p className="small" role="alert">{k.erro}</p>}
                {k.acoes.length > 0 && (
                  <ul className="cp-acoes">
                    {k.acoes.map((a) => (
                      <li key={a.id}>
                        <span className="cp-acao-t">{a.title}</span>
                        <span className="small muted">{a.due_date ? fmtDate(a.due_date) : "sem prazo"}{a.status === "concluida" ? " · concluída" : ""}</span>
                        {a.ai_generated && <span className="pill pill-sand">IA</span>}
                        {pode && a.ai_generated && a.status !== "concluida" && (
                          <form action={acaoRapidaForm}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="tipo" value="desfazer_ia" />
                            <input type="hidden" name="back" value={back} />
                            <Submit className="btn btn-sm btn-ghost">Desfazer</Submit>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

// Operações → Funil de Entrega: quadro por etapa/pilar, clientes, renovações, modelos e gatilhos. Dados do CRM (lib/entregas).
// Leitura: administrador e revisor (e membro com o app "Funil de Entrega"). Escrita: só administrador.
// As páginas /entregas (ações do plano dos clientes do Mapa) são outra coisa e continuam existindo.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { podeEscreverEntregas, podeVerEntregas } from "@/lib/entregas/acesso";
import { clientesDoMapa, emFixture, tentar } from "@/lib/entregas";
import { PILARES, ROTULO_PILAR, STATUS_ENTREGA, URL_PADRAO, type Pilar } from "@/lib/entregas/crm";
import { Flash } from "@/components/Flash";
import { ABAS, Cabecalho, hrefEntregas, type AbaId, type FiltrosUrl } from "@/components/entregas/Cabecalho";
import { Filtros } from "@/components/entregas/Filtros";
import { Quadro } from "@/components/entregas/Quadro";
import { Clientes, FonteAviso, ModelosEGatilhos, Renovacoes } from "@/components/entregas/Blocos";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata: Metadata = { title: "Funil de Entrega — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function FunilDeEntrega({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sess = await requireUser();
  if (!podeVerEntregas(sess)) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso ao Funil de Entrega."));
  const podeEscrever = podeEscreverEntregas(sess);

  const aba = (ABAS.find((a) => a.id === um(sp.aba))?.id ?? "quadro") as AbaId;
  const f: FiltrosUrl = {
    aba, por: um(sp.por) === "pilar" ? "pilar" : "etapa", q: um(sp.q).trim().slice(0, 100), resp: um(sp.resp).slice(0, 64),
    pilar: (PILARES as readonly string[]).includes(um(sp.pilar)) ? um(sp.pilar) : "", atraso: um(sp.atraso) === "1",
    status: (STATUS_ENTREGA as readonly string[]).includes(um(sp.status)) ? um(sp.status) : "EM_ANDAMENTO",
  };
  const voltar = hrefEntregas(f);
  const crmUrl = (process.env.CRM_URL?.trim() || URL_PADRAO).replace(/\/+$/, "");

  const usuarios = await tentar((p) => p.usuarios());
  const listaUsuarios = usuarios.estado === "ok" ? usuarios.dados : [];
  let corpo: React.ReactNode;
  let indicadores;

  if (aba === "quadro") {
    const q = await tentar((p) => p.quadro({ status: f.status, q: f.q, responsavelId: f.resp, pilar: f.pilar, atrasados: f.atraso }));
    const dados = q.estado === "ok" ? q.dados : null;
    indicadores = dados?.indicadores;
    const entregas = Object.fromEntries((dados?.entregas ?? []).map((e) => [e.id, { cliente: e.contato.nome, entrega: e.nome }]));
    const colunas = dados ? (f.por === "etapa" ? dados.colunas : dados.pilares.map((p) => ({ id: p.id, rotulo: ROTULO_PILAR[p.id as Pilar] ?? p.rotulo }))) : [];
    corpo = (
      <>
        <div className="ent-modo" role="group" aria-label="Agrupar o quadro">
          <span className="rot">Ver por</span>
          <div className="chips" style={{ margin: 0 }}>
            <a className="chip" aria-current={f.por === "etapa"} href={hrefEntregas({ ...f, por: "etapa" })}>Etapa</a>
            <a className="chip" aria-current={f.por === "pilar"} href={hrefEntregas({ ...f, por: "pilar" })}>Pilar</a>
          </div>
        </div>
        <Filtros f={f} usuarios={listaUsuarios} />
        <FonteAviso f={q} />
        {dados && dados.cartoes.length === 0 && <div className="card empty" style={{ marginTop: 12 }}>Nenhum cartão neste filtro. A entrega nasce quando uma oportunidade é ganha no CRM, com os cartões do modelo padrão.</div>}
        {dados && dados.cartoes.length > 0 && <Quadro colunas={colunas} por={f.por} cartoes={dados.cartoes} entregas={entregas} podeEscrever={podeEscrever} />}
      </>
    );
  } else if (aba === "clientes") {
    const q = await tentar((p) => p.quadro({ status: f.status, q: f.q, responsavelId: f.resp, pilar: f.pilar, atrasados: f.atraso }));
    indicadores = q.estado === "ok" ? q.dados.indicadores : undefined;
    const mapa = q.estado === "ok" ? await clientesDoMapa(q.dados.entregas.map((e) => e.contato)) : new Map();
    corpo = (
      <>
        <Filtros f={f} usuarios={listaUsuarios} />
        <FonteAviso f={q} />
        {q.estado === "ok" && <Clientes entregas={q.dados.entregas} mapa={mapa} />}
      </>
    );
  } else if (aba === "renovacoes") {
    const r = await tentar((p) => p.renovacoes(60));
    const mapa = r.estado === "ok" ? await clientesDoMapa(r.dados.map((x) => x.contato)) : new Map();
    corpo = (<><FonteAviso f={r} />{r.estado === "ok" && <Renovacoes itens={r.dados} crmUrl={crmUrl} mapa={mapa} />}</>);
  } else {
    const [modelos, gatilhos] = await Promise.all([tentar((p) => p.modelos()), tentar((p) => p.gatilhos())]);
    corpo = <ModelosEGatilhos modelos={modelos} gatilhos={gatilhos} podeEscrever={podeEscrever} voltar={voltar} />;
  }

  return (
    <>
      <Flash sp={sp} />
      <Cabecalho f={f} ind={indicadores} emFixture={emFixture()} />
      {corpo}
    </>
  );
}

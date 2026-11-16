// Financeiro da Central: /financeiro[/aba] (empresa) e /financeiro/pessoal[/aba] (só o dono).
// Leitura: administrador e revisor (e membro com o app liberado). Escrita: só administrador. Pessoal: só o dono — qualquer
// outro (revisor, membro) recebe 404, como se a área não existisse. Dados vêm do Vendedor IA (lib/financeiro).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { podeEscreverFinanceiro, podeVerFinanceiro, podeVerPessoal, type EscopoFin } from "@/lib/financeiro/acesso";
import { carregarVisaoGeral, emFixture, tentar, todasTransacoes } from "@/lib/financeiro";
import { hojeBrasilia, mesDaUrl, ultimoDia } from "@/lib/financeiro/periodo";
import { Flash } from "@/components/Flash";
import { Cabecalho, ABAS, baseDe, type AbaId } from "@/components/financeiro/Comum";
import { VisaoGeral } from "@/components/financeiro/VisaoGeral";
import { Lancamentos } from "@/components/financeiro/Lancamentos";
import { ContasPagar } from "@/components/financeiro/Contas";
import { Receber } from "@/components/financeiro/Receber";
import { Contratos } from "@/components/financeiro/Contratos";
import { Dre } from "@/components/financeiro/Dre";
import { Metas } from "@/components/financeiro/Metas";
import { Categorias } from "@/components/financeiro/Categorias";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata: Metadata = { title: "Financeiro — Avanteza" };

type SP = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Financeiro({ params, searchParams }: { params: Promise<{ caminho?: string[] }>; searchParams: Promise<SP> }) {
  const { caminho = [] } = await params;
  const sp = await searchParams;
  const sess = await requireUser();
  if (!podeVerFinanceiro(sess)) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso ao Financeiro."));

  const pessoal = caminho[0] === "pessoal";
  const escopo: EscopoFin = pessoal ? "pessoal" : "empresa";
  if (pessoal && !podeVerPessoal(sess)) notFound(); // revisor/membro nunca veem o Pessoal, nem por link direto
  const resto = pessoal ? caminho.slice(1) : caminho;
  if (resto.length > 1) notFound();
  const abaId = (resto[0] ?? "") as AbaId;
  if (!ABAS.some((a) => a.id === abaId)) notFound();

  const mes = mesDaUrl(sp.mes);
  const de = `${mes}-01`, ate = ultimoDia(mes);
  const podeEscrever = podeEscreverFinanceiro(sess);
  const podePessoal = podeVerPessoal(sess);
  const voltarQs = new URLSearchParams();
  if (mes !== hojeBrasilia().slice(0, 7)) voltarQs.set("mes", mes);
  for (const k of ["texto", "tipo", "categoria", "confirmado", "page"]) if (um(sp[k])) voltarQs.set(k, um(sp[k]));
  const voltar = `${baseDe(escopo)}${abaId ? `/${abaId}` : ""}${voltarQs.size ? `?${voltarQs}` : ""}`;

  let corpo: React.ReactNode;
  if (abaId === "") {
    corpo = <VisaoGeral d={await carregarVisaoGeral(escopo, mes)} escopo={escopo} mes={mes} />;
  } else if (abaId === "lancamentos") {
    const filtros = { texto: um(sp.texto).slice(0, 120), tipo: ["receita", "despesa"].includes(um(sp.tipo)) ? um(sp.tipo) : "", categoria: um(sp.categoria).slice(0, 80), confirmado: ["true", "false"].includes(um(sp.confirmado)) ? um(sp.confirmado) : "", page: Math.max(1, Number(um(sp.page)) || 1) };
    const [lista, cats] = await Promise.all([
      tentar((p) => p.transacoes(escopo, { de, ate, texto: filtros.texto || undefined, tipo: (filtros.tipo || undefined) as "receita" | "despesa" | undefined, categoria: filtros.categoria || undefined, confirmado: filtros.confirmado ? filtros.confirmado === "true" : undefined, page: filtros.page, pageSize: 30 })),
      tentar((p) => p.categorias(escopo)),
    ]);
    corpo = <Lancamentos f={lista} lista={lista.estado === "ok" ? lista.dados : undefined} cats={cats.estado === "ok" ? cats.dados : null} escopo={escopo} mes={mes} podeEscrever={podeEscrever} podeReclassificar={podeEscrever && podePessoal} voltar={voltar} filtros={filtros} />;
  } else if (abaId === "contas") {
    corpo = <ContasPagar f={await tentar((p) => p.contas(escopo))} escopo={escopo} mes={mes} podeEscrever={podeEscrever} podeReclassificar={podeEscrever && podePessoal} voltar={voltar} />;
  } else if (abaId === "receber") {
    corpo = <Receber f={await tentar((p) => p.receitas(escopo, { mes }))} escopo={escopo} mes={mes} podeEscrever={podeEscrever} podeReclassificar={podeEscrever && podePessoal} voltar={voltar} />;
  } else if (abaId === "contratos") {
    corpo = <Contratos f={await tentar((p) => p.contratos(escopo))} escopo={escopo} podeEscrever={podeEscrever} voltar={voltar} />;
  } else if (abaId === "dre") {
    corpo = <Dre f={await tentar((p) => p.dre(escopo, { mes }))} />;
  } else if (abaId === "metas") {
    const [resumo, metas] = await Promise.all([tentar((p) => p.resumo(escopo, { mes })), escopo === "pessoal" ? tentar((p) => p.metas()) : Promise.resolve(null)]);
    corpo = <Metas escopo={escopo} resumo={resumo} metas={metas} podeEscrever={podeEscrever} voltar={voltar} />;
  } else {
    const [cats, mov] = await Promise.all([tentar((p) => p.categorias(escopo)), tentar((p) => todasTransacoes(p, escopo, { de, ate }))]);
    corpo = <Categorias cats={cats} movimento={mov} />;
  }

  return (
    <>
      <Flash sp={sp} />
      {emFixture() && <div className="notice" role="note" style={{ margin: "0 0 10px" }}><b>Dados simulados</b> (FINANCEIRO_FIXTURE, só desenvolvimento). Nada aqui é real e nada é gravado no Vendedor IA.</div>}
      <Cabecalho escopo={escopo} aba={abaId} mes={mes} podePessoal={podePessoal} seletorMes={abaId !== "contratos"} />
      {corpo}
    </>
  );
}

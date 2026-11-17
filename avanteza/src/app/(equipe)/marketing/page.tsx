// Departamento Marketing: Anúncios (Meta da agência + contas dos clientes), Canais dos clientes (fonte Meta/Windsor e estado de
// conexão de cada um) e Conteúdo (login único). Reaproveita as seções dos Dashboards e as leituras de src/lib/channels; cada
// fonte é isolada (Meta fora do ar ou falha de banco só mostram o aviso daquele bloco). /dashboards fica só com um resumo.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { departamento } from "@/lib/shell/departamentos";
import { podeVerDashboards } from "@/lib/dashboards/nav";
import { carregarMeta } from "@/lib/dashboards";
import { fixtureAtiva } from "@/lib/dashboards/fixtures";
import { PERIODOS, ROTULO_PERIODO, ddmm, parsePeriodo, resolverPeriodo } from "@/lib/dashboards/periodo";
import { canaisPorCliente, carregarCanaisClientes } from "@/lib/channels/dashboards";
import { canUseApp } from "@/lib/session";
import { PageHeader } from "@/components/shell/GlassCard";
import { ModuloCard } from "@/components/shell/ModuloCard";
import { SecaoCanaisClientes, SecaoMarketing, TabelaCanaisPorCliente } from "@/components/dashboards/Secoes";

export const metadata: Metadata = { title: "Marketing — Avanteza" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Marketing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sess = await requireUser();
  const d = departamento("marketing", sess);
  if (!d) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso a este departamento."));
  const verAnuncios = podeVerDashboards(sess);
  const conteudo = d.modulos.find((m) => m.id === "conteudo");
  const sp = await searchParams;
  const id = parsePeriodo(sp.periodo);
  const periodo = resolverPeriodo(id);
  const fixture = Boolean(fixtureAtiva());

  const [meta, porCliente] = verAnuncios
    ? await Promise.all([carregarMeta(periodo), canaisPorCliente().catch(() => null)])
    : [null, null];
  // Subtotal das contas dos clientes: falha de banco só esconde o bloco (como nos Dashboards).
  const contasClientes = meta && !fixture ? await carregarCanaisClientes(periodo.atual, meta).catch(() => null) : null;
  const secoes = [
    ...(verAnuncios ? [{ href: "#anuncios", label: "Anúncios" }, { href: "#canais", label: "Canais dos clientes" }] : []),
    ...(conteudo ? [{ href: "#conteudo", label: "Conteúdo" }] : []),
  ];

  return (
    <>
      <PageHeader eyebrow="Departamento" title={<>Market<span className="accent">ing</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>{d.descricao}</p>
      </PageHeader>
      {secoes.length > 1 && (
        <nav className="btn-row mk-secoes" aria-label="Seções do Marketing">
          {secoes.map((s) => <a key={s.href} href={s.href} className="btn btn-ghost btn-sm">{s.label}</a>)}
        </nav>
      )}

      {verAnuncios && meta && (
        <>
          <section id="anuncios" aria-label="Anúncios" className="mk-ancora">
            <nav className="tabs periodo" aria-label="Período">
              {PERIODOS.map((p) => (
                <Link key={p} href={p === "30" ? "/marketing#anuncios" : `/marketing?periodo=${p}#anuncios`} aria-current={p === id ? "page" : undefined}>{ROTULO_PERIODO[p]}</Link>
              ))}
            </nav>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              {ddmm(periodo.atual.de)} a {ddmm(periodo.atual.ate)} · variações comparam com {ddmm(periodo.anterior.de)} a {ddmm(periodo.anterior.ate)}.
            </p>
            {fixture && <div className="notice" role="note" style={{ margin: "10px 0" }}><b>Dados simulados</b> (DASHBOARDS_FIXTURE, só desenvolvimento). Nada aqui é real.</div>}
            <SecaoMarketing d={{ meta, periodo }} titulo="Anúncios" id="anuncios-meta" />
            <SecaoCanaisClientes c={contasClientes} id="anuncios-clientes" titulo="Contas de anúncios dos clientes" />
          </section>

          <section className="dsec mk-ancora" id="canais" aria-label="Canais dos clientes">
            <h2>Canais dos clientes</h2>
            <p className="small muted dsub">Fonte de cada cliente (Meta ou Windsor.ai) e se a última coleta deu certo. Detalhes e configuração na aba Canais de cada cliente.</p>
            {porCliente ? <TabelaCanaisPorCliente itens={porCliente} linkCliente={canUseApp(sess, "marketplaces")} /> : <div className="notice danger" role="status"><b>Canais indisponíveis</b><p className="small muted" style={{ margin: "4px 0 0" }}>Não foi possível ler os canais agora.</p></div>}
          </section>
        </>
      )}

      {conteudo && (
        <section className="dsec mk-ancora" id="conteudo" aria-label="Conteúdo">
          <h2>Conteúdo</h2>
          <p className="small muted dsub">Produção e publicação para Instagram e LinkedIn, no aplicativo Conteúdo (login único).</p>
          <div className="grid three"><ModuloCard m={conteudo} /></div>
        </section>
      )}
    </>
  );
}

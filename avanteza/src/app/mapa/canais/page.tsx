// Mapa → Canais: tráfego pago (Meta) e Instagram do cliente + evolução. Só clientes "midia" ou "ambos" (marketplace é redirecionado).
// O client_id vem do escopo da sessão; a tela nunca recebe token nem IDs internos das contas.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMapa } from "@/lib/mapa/auth";
import { getClient } from "@/lib/mapa/repo";
import { hasChannels } from "@/lib/mapa/nav";
import { carregarCanaisDoCliente } from "@/lib/channels/cliente";
import { PERIODOS, ROTULO_PERIODO, ddmm, parsePeriodo, type PeriodoId } from "@/lib/dashboards/periodo";
import { ago } from "@/lib/format";
import { FontesAguardando, PainelAnuncios, PainelEvolucao, PainelInstagram } from "@/components/canais/Paineis";

export const dynamic = "force-dynamic";
const ABAS = [{ k: "anuncios", label: "Anúncios" }, { k: "instagram", label: "Instagram" }, { k: "evolucao", label: "Evolução" }] as const;
type Aba = (typeof ABAS)[number]["k"];

export default async function Canais({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scope } = await requireMapa();
  const client = await getClient(scope);
  if (!client || !hasChannels(client.kind)) redirect("/mapa");
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const aba: Aba = ABAS.some((a) => a.k === pick(sp.aba)) ? (pick(sp.aba) as Aba) : "anuncios";
  const periodoId = parsePeriodo(pick(sp.periodo));
  const agrup = pick(sp.agrup) === "semana" ? "semana" : "mes";
  const d = await carregarCanaisDoCliente(scope, periodoId);
  const href = (o: { aba?: Aba; periodo?: PeriodoId; agrup?: "mes" | "semana" }) => {
    const q = new URLSearchParams();
    const a = o.aba ?? aba, p = o.periodo ?? periodoId, g = o.agrup ?? agrup;
    if (a !== "anuncios") q.set("aba", a);
    if (p !== "30") q.set("periodo", p);
    if (a === "evolucao" && g !== "mes") q.set("agrup", g);
    const s = q.toString();
    return `/mapa/canais${s ? `?${s}` : ""}`;
  };
  const { atual } = d.periodo;
  return (
    <>
      <div className="eyebrow">{client.name}</div>
      <h1>Canais</h1>
      <p className="muted small" style={{ marginTop: 4 }}>
        Anúncios (Meta Ads) e Instagram: investimento, resultados, criativos e evolução. Cada fonte é independente e mostra de onde vieram os dados.
        {d.estado.conectado && d.estado.ultimaAtualizacao && <> Última atualização {ago(d.estado.ultimaAtualizacao)}.</>}
      </p>
      {d.estado.simulado && <div className="notice" role="note" style={{ margin: "10px 0" }}><b>Dados simulados</b> (CHANNELS_FIXTURE, só desenvolvimento). Nada aqui é real.</div>}
      {!d.estado.conectado ? (
        <FontesAguardando anuncios={d.estado.anuncios || !d.estado.instagram} instagram={d.estado.instagram || !d.estado.anuncios} />
      ) : (
        <>
          <nav className="tabs abas" aria-label="Seções de canais">
            {ABAS.map((a) => <Link key={a.k} href={href({ aba: a.k })} aria-current={aba === a.k ? "page" : undefined}>{a.label}</Link>)}
          </nav>
          {aba !== "evolucao" && (
            <>
              <nav className="tabs periodo" aria-label="Período">
                {PERIODOS.map((p) => <Link key={p} href={href({ periodo: p })} aria-current={p === periodoId ? "page" : undefined}>{ROTULO_PERIODO[p]}</Link>)}
              </nav>
              <p className="muted small" style={{ margin: "4px 0 0" }}>{ddmm(atual.de)} a {ddmm(atual.ate)} ({atual.dias} {atual.dias === 1 ? "dia" : "dias"}) · variações comparam com o período anterior de mesmo tamanho.</p>
            </>
          )}
          {aba === "anuncios" && <PainelAnuncios d={d} />}
          {aba === "instagram" && <PainelInstagram d={d} />}
          {aba === "evolucao" && <PainelEvolucao d={d} agrup={agrup} hrefAgrup={(g) => href({ agrup: g })} />}
        </>
      )}
    </>
  );
}

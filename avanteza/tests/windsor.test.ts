// Instagram pelo Windsor.ai (fonte 2) independente dos anúncios pela Meta Ads (fonte 1): parse das linhas reais, null, erros de chave/conta,
// independência das fontes, migração dos canais existentes, separação por fonte na leitura e segredo fora de qualquer saída.
// O Windsor real NUNCA é chamado: tudo usa fetch simulado. A chave abaixo é FALSA (só existe neste arquivo de teste).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { criarWindsor, esconderChave, WindsorErro, WINDSOR_HOST, type FonteWindsor } from "../src/lib/channels/windsor";
import { criarWindsorFixture, criarApiFixture } from "../src/lib/channels/fixture";
import { coletarCanal, coletarTodos, mensagemSegura } from "../src/lib/channels/collect";
import { atualizarAgora, origemChaveWindsor, testarConexaoWindsor } from "../src/lib/channels/servico";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { lerCamposAnuncios, lerCamposInstagram, lerCamposCanal } from "../src/lib/channels/form";
import { relAudiencia, relInstagram, type Linha } from "../src/lib/channels/report";
import { desconectarFonte, gravarSnapshots, lerSnapshots, marcarColeta, obterCanal, resolverChaveWindsor, salvarAnuncios, salvarCanal, salvarInstagram } from "../src/lib/channels/store";
import { resolverPeriodo } from "../src/lib/dashboards/periodo";
import { GraphErro } from "../src/lib/channels/graph";
import type { CanaisApi } from "../src/lib/channels/types";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";
import { rawQuery } from "../src/lib/db/client";
import { redactUrl } from "../src/lib/http";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const CHAVE = "wk-FALSA-da-plataforma-9f8e7d6c5b4a3210";
const CHAVE_CANAL = "wk-FALSA-do-canal-0a1b2c3d4e5f6789";
const TOKEN_META = "EAAB-token-falso-meta-1234567890-ZZ99";
const CONTA = "showmanbarbearia";
const sem = async () => undefined;
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

// ─── Amostras no formato real do Windsor (conta showmanbarbearia) ────────────
const PERFIL_REAL = [
  { date: "2026-11-13", account_name: CONTA, followers_count: null, follower_count: 4, reach: 702, views: 1388, profile_views: 37, accounts_engaged: 25, total_interactions: 104, follows_and_unfollows: null, website_clicks_1d: null, profile_links_taps: 3, impressions: null },
  { date: "2026-11-14", account_name: CONTA, followers_count: null, follower_count: -1, reach: null, views: 1100, profile_views: null, accounts_engaged: 19, total_interactions: 88, follows_and_unfollows: null, website_clicks_1d: 1, profile_links_taps: null, impressions: null },
  { date: "2026-11-15", account_name: CONTA, followers_count: null, follower_count: 3, reach: "655", views: 1204, profile_views: 40, accounts_engaged: 21, total_interactions: 97, follows_and_unfollows: null, website_clicks_1d: null, profile_links_taps: null, impressions: null },
  { date: "2026-11-16", account_name: CONTA, followers_count: 1985, follower_count: 2, reach: null, views: null, profile_views: null, accounts_engaged: null, total_interactions: null, follows_and_unfollows: null, website_clicks_1d: null, profile_links_taps: null, impressions: null },
];
const MIDIAS_REAL = [
  { date: "2026-11-12", account_name: CONTA, media_id: "17900000000000001", media_product_type: "REELS", media_type: "VIDEO", media_caption: "Corte + barba sem hora marcada: o Ilimitado por R$69,90", media_permalink: "https://www.instagram.com/reel/AAAA/", media_thumbnail_url: "https://scontent.cdninstagram.com/v/t51/thumb1.jpg", media_url: "https://scontent.cdninstagram.com/o1/v/video1.mp4", media_reach: 1775, media_like_count: 96, media_comments_count: 7, media_saved: 11, media_shares: 9, media_views: 2899, media_plays: 2899 },
  { date: "2026-11-10", account_name: CONTA, media_id: "17900000000000002", media_product_type: "FEED", media_type: "IMAGE", media_caption: null, media_permalink: "http://inseguro.example/p", media_thumbnail_url: null, media_url: "javascript:alert(1)", media_reach: 640, media_like_count: 41, media_comments_count: null, media_saved: null, media_shares: null, media_views: null, media_plays: null },
  { date: "2026-11-09", account_name: CONTA, media_id: "17900000000000003", media_product_type: "STORY", media_type: "IMAGE", media_caption: null, media_permalink: null, media_thumbnail_url: null, media_url: null, media_reach: 300, media_like_count: null, media_comments_count: null, media_saved: null, media_shares: null, media_views: null, media_plays: null },
  // a mesma mídia em outra linha (outro dia), com null onde não se aplica: valores não nulos se juntam
  { date: "2026-11-13", account_name: CONTA, media_id: "17900000000000001", media_product_type: "REELS", media_type: "VIDEO", media_caption: null, media_permalink: null, media_thumbnail_url: null, media_url: null, media_reach: 1775, media_like_count: 101, media_comments_count: null, media_saved: null, media_shares: null, media_views: 2899, media_plays: null },
];
const AUDIENCIA_REAL: Record<string, unknown[]> = {
  audience_age_name: [{ account_name: CONTA, audience_age_name: "25-34", audience_age_size: 780 }, { account_name: CONTA, audience_age_name: "18-24", audience_age_size: 410 }, { account_name: CONTA, audience_age_name: "25-34", audience_age_size: 770 }],
  audience_gender_name: [{ account_name: CONTA, audience_gender_name: "M", audience_gender_size: 1330 }, { account_name: CONTA, audience_gender_name: "F", audience_gender_size: 560 }],
  audience_city_name: [{ account_name: CONTA, audience_city_name: "Belo Horizonte, Minas Gerais", audience_city_size: 940 }, { account_name: CONTA, audience_city_name: "Contagem, Minas Gerais", audience_city_size: 130 }],
  audience_country_name: [{ account_name: CONTA, audience_country_name: "BR", audience_country_size: 1900 }],
};

interface Chamada { url: URL; init?: RequestInit }
/** Windsor simulado: roteia pelo conjunto de campos pedidos. `rota` pode devolver o corpo ou uma Response. */
function windsorFalso(rota?: (u: URL, f: string[], n: number) => unknown, o: { chave?: string; accountName?: string | null } = {}) {
  const chamadas: Chamada[] = [];
  const padrao = (f: string[]) => {
    if (f.includes("media_id")) return { data: MIDIAS_REAL };
    const aud = Object.keys(AUDIENCIA_REAL).find((k) => f.includes(k));
    if (aud) return { data: AUDIENCIA_REAL[aud] };
    return { data: PERFIL_REAL };
  };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    chamadas.push({ url: u, init });
    const f = (u.searchParams.get("fields") ?? "").split(",");
    const r = rota ? rota(u, f, chamadas.length) : undefined;
    const corpo = r === undefined ? padrao(f) : r;
    return corpo instanceof Response ? corpo : json(corpo);
  }) as typeof fetch;
  const fonte = criarWindsor({ chave: o.chave ?? CHAVE, accountName: o.accountName, fetchImpl, sleep: sem, baseDelayMs: 1, maxDelayMs: 2 });
  return { fonte, chamadas, fetchImpl };
}
const naoTemChave = (x: unknown) => { const t = typeof x === "string" ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})); return !t.includes(CHAVE) && !t.includes(CHAVE_CANAL); };

// ─── Provider: requisição, parse e null ──────────────────────────────────────

test("Windsor: só GET em connectors.windsor.ai/instagram, date_from/date_to, campos reais de perfil e api_key só na querystring", async () => {
  const { fonte, chamadas } = windsorFalso();
  await fonte.perfil({ de: "2026-11-10", ate: "2026-11-16" });
  await fonte.midias({ de: "2026-08-18", ate: "2026-11-16" }, 40);
  await fonte.perfil({ preset: "last_30d" });
  assert.equal(chamadas.length, 3);
  for (const c of chamadas) {
    assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET");
    assert.equal(c.init?.body, undefined);
    assert.equal(c.url.hostname, WINDSOR_HOST);
    assert.equal(c.url.pathname, "/instagram");
    assert.equal(c.url.searchParams.get("api_key"), CHAVE);
    assert.ok(!JSON.stringify(c.init?.headers ?? {}).includes(CHAVE), "a chave não vai em cabeçalho");
  }
  const perfil = chamadas[0].url.searchParams;
  assert.equal(perfil.get("date_from"), "2026-11-10"); assert.equal(perfil.get("date_to"), "2026-11-16"); assert.equal(perfil.get("date_preset"), null);
  for (const campo of ["date", "account_name", "followers_count", "follower_count", "reach", "views", "profile_views", "accounts_engaged", "total_interactions"]) assert.ok(perfil.get("fields")!.split(",").includes(campo), campo);
  assert.ok(!perfil.get("fields")!.includes("media_id"), "perfil e mídias em consultas separadas");
  const midia = chamadas[1].url.searchParams.get("fields")!.split(",");
  for (const campo of ["media_id", "media_reach", "media_like_count", "media_comments_count", "media_saved", "media_shares", "media_views", "media_thumbnail_url"]) assert.ok(midia.includes(campo), campo);
  assert.ok(!midia.includes("reach"));
  assert.equal(chamadas[2].url.searchParams.get("date_preset"), "last_30d");
});

test("Windsor: perfil por dia — followers_count só no dia atual, saldo diário, null vira 'sem dado', texto numérico é lido e linha inválida é ignorada", async () => {
  const { fonte } = windsorFalso((_u, f) => (f.includes("media_id") ? undefined : { data: [...PERFIL_REAL, { date: null, account_name: CONTA, reach: 5 }, { date: "2026-11-12", account_name: CONTA, reach: { x: 1 } }] }));
  const p = await fonte.perfil({ de: "2026-11-10", ate: "2026-11-16" });
  assert.equal(p.conta, CONTA);
  assert.equal(p.seguidores, 1985); assert.equal(p.seguidoresDia, "2026-11-16");
  assert.deepEqual(p.dias.map((d) => d.date), ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
  const dia = (d: string) => p.dias.find((x) => x.date === d)!.metrics;
  assert.deepEqual(dia("2026-11-13"), { follower_net: 4, reach: 702, views: 1388, profile_views: 37, accounts_engaged: 25, total_interactions: 104 });
  assert.ok(!("reach" in dia("2026-11-14")) && !("profile_views" in dia("2026-11-14")), "null = ausente, nunca zero");
  assert.equal(dia("2026-11-14").follower_net, -1);
  assert.equal(dia("2026-11-15").reach, 655, "texto numérico é aceito");
  assert.deepEqual(dia("2026-11-16"), { follower_net: 2, followers: 1985 });
  assert.equal(p.linhasIgnoradas, 2);
  assert.ok(p.camposComDado.includes("reach") && p.camposComDado.includes("website_clicks_1d") && !p.camposComDado.includes("impressions"));
});

test("Windsor: mídias — Reel real (alcance 1775, visualizações 2899), null por campo, Story fora, URLs inseguras descartadas, linhas repetidas se juntam", async () => {
  const { fonte } = windsorFalso();
  const m = await fonte.midias({ de: "2026-08-18", ate: "2026-11-16" }, 40);
  assert.equal(m.length, 2, "o Story não entra");
  const reel = m.find((x) => x.id === "17900000000000001")!;
  assert.equal(reel.alcance, 1775); assert.equal(reel.views, 2899);
  assert.equal(reel.likes, 101, "a linha mais recente não nula prevalece");
  assert.equal(reel.comentarios, 7); assert.equal(reel.salvos, 11); assert.equal(reel.compartilhamentos, 9);
  assert.equal(reel.interacoes, 101 + 7 + 11 + 9);
  assert.equal(reel.thumb, "https://scontent.cdninstagram.com/v/t51/thumb1.jpg", "vídeo usa a miniatura");
  assert.equal(reel.permalink, "https://www.instagram.com/reel/AAAA/");
  assert.equal(reel.data, "2026-11-12", "dia da postagem = primeira linha");
  assert.equal(reel.produto, "REELS");
  const foto = m.find((x) => x.id === "17900000000000002")!;
  assert.equal(foto.thumb, null, "javascript: nunca vira imagem"); assert.equal(foto.permalink, null, "http inseguro descartado");
  assert.equal(foto.legenda, null); assert.equal(foto.comentarios, null); assert.equal(foto.salvos, null); assert.equal(foto.likes, 41); assert.equal(foto.interacoes, 41);
  assert.equal(m[0].id, reel.id, "mais recentes primeiro");
  assert.equal((await fonte.midias({ de: "2026-08-18", ate: "2026-11-16" }, 1)).length, 1);
});

test("Windsor: audiência por dimensão — não soma o mesmo rótulo duas vezes; dimensão que falha vira erro parcial", async () => {
  const { fonte } = windsorFalso((_u, f) => (f.includes("audience_country_name") ? json({ error: "field not found: audience_country_name" }, 400) : undefined));
  const a = await fonte.audiencia();
  assert.deepEqual(a.dados.idade, { "25-34": 780, "18-24": 410 });
  assert.deepEqual(a.dados.genero, { M: 1330, F: 560 });
  assert.equal(a.dados.cidades!["Belo Horizonte, Minas Gerais"], 940);
  assert.equal(a.dados.paises, undefined);
  assert.equal(a.erros.length, 1); assert.match(a.erros[0], /paises/);
  const rel = relAudiencia([{ kind: "ig_audience", date: "2026-11-16", key: "account", metrics: a.dados as any }]);
  assert.deepEqual(rel!.idade.map((x) => x.rotulo), ["18-24", "25-34"]);
  assert.deepEqual(rel!.genero.map((x) => x.rotulo), ["Homens", "Mulheres"]);
  assert.equal(rel!.cidades[0].rotulo, "Belo Horizonte");
  assert.equal(Math.round(rel!.genero.reduce((t, x) => t + x.pct, 0)), 100);
  assert.equal(relAudiencia([]), null);
});

// ─── Erros: chave, conta, limite, rede ───────────────────────────────────────

test("Windsor: chave inválida (HTTP 401/403 ou erro em 200) e no_accounts_configured viram mensagem clara em português, sem a chave", async () => {
  const casos: Array<[unknown, string, RegExp]> = [
    [json({ error: "Invalid API key" }, 401), "chave", /chave do Windsor\.ai foi recusada/],
    [json({ message: `Forbidden for api_key=${CHAVE}` }, 403), "chave", /recusada/],
    [json({ error: `Unauthorized ${CHAVE}` }), "chave", /recusada/],
    [json({ error: "no_accounts_configured" }), "sem_contas", /nenhuma conta de Instagram conectada/],
    [json({ detail: "no_accounts_configured: connect an account" }, 400), "sem_contas", /Data Sources/],
    [json({ data: "x" }), "formato", /Resposta inesperada/],
    [json({ error: "field foo not found" }, 400), "campo", /não reconheceu algum campo/],
  ];
  for (const [resp, codigo, rx] of casos) {
    const { fonte } = windsorFalso(() => resp instanceof Response ? resp.clone() : resp);
    await assert.rejects(fonte.perfil({ preset: "last_30d" }), (e: any) => {
      assert.ok(e instanceof WindsorErro, String(e));
      assert.equal(e.codigo, codigo); assert.match(e.message, rx); assert.ok(naoTemChave(e.message) && naoTemChave(e), `sem chave: ${e.message}`);
      return true;
    });
  }
});

test("Windsor: retry em 429/5xx com backoff e erro de rede traduzido; 401 não tenta de novo", async () => {
  let n = 0;
  const a = windsorFalso(() => (++n < 3 ? new Response("{}", { status: 503 }) : undefined));
  assert.equal((await a.fonte.perfil({ preset: "last_30d" })).dias.length, 4); assert.equal(n, 3);
  n = 0;
  const b = windsorFalso(() => (++n < 2 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : undefined));
  await b.fonte.perfil({ preset: "last_30d" }); assert.equal(n, 2);
  n = 0;
  const c = windsorFalso(() => { n++; return json({ error: "bad" }, 401); });
  await assert.rejects(c.fonte.perfil({ preset: "last_30d" }), WindsorErro); assert.equal(n, 1);
  const f = criarWindsor({ chave: CHAVE, fetchImpl: (async () => { throw new TypeError(`fetch failed https://x?api_key=${CHAVE}`); }) as typeof fetch, sleep: sem, baseDelayMs: 1, retries: 1 });
  await assert.rejects(f.perfil({ preset: "last_30d" }), (e: any) => e.codigo === "rede" && /rede ou tempo esgotado/.test(e.message) && naoTemChave(e));
  const d = windsorFalso(() => new Response("{}", { status: 500 }));
  await assert.rejects(d.fonte.perfil({ preset: "last_30d" }), (e: any) => e.codigo === "api" && /fora do ar/.test(e.message));
});

test("Windsor: conta — account_name filtra (sem @, sem caixa), não casar é erro claro e várias contas sem filtro nunca são misturadas", async () => {
  const duas = (f: string[]) => ({ data: [...PERFIL_REAL, { date: "2026-11-16", account_name: "outra_conta", followers_count: 50, reach: 9999 }].filter(() => !f.includes("media_id")) });
  const a = windsorFalso((_u, f) => duas(f), { accountName: "@ShowmanBarbearia" });
  const p = await a.fonte.perfil({ preset: "last_30d" });
  assert.equal(p.conta, CONTA); assert.equal(p.seguidores, 1985); assert.deepEqual(p.contas, ["outra_conta", CONTA]);
  assert.ok(p.dias.every((d) => d.metrics.reach !== 9999));
  const b = windsorFalso((_u, f) => duas(f), { accountName: "barbearia_errada" });
  await assert.rejects(b.fonte.perfil({ preset: "last_30d" }), (e: any) => e.codigo === "conta" && /barbearia_errada/.test(e.message) && /outra_conta, showmanbarbearia/.test(e.message));
  const c = windsorFalso((_u, f) => duas(f));
  await assert.rejects(c.fonte.perfil({ preset: "last_30d" }), (e: any) => e.codigo === "varias_contas" && /account_name/.test(e.message));
});

test("Windsor: teste de conexão mostra contas/@, campos com dados, dias e mídias lidas e avisa quando account_name não casa", async () => {
  const ok = await windsorFalso().fonte.testar();
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.info.contas, [CONTA]); assert.equal(ok.info.dias, 4); assert.equal(ok.info.midias, 2); assert.equal(ok.info.seguidores, 1985); assert.equal(ok.info.ig_username, CONTA);
  assert.ok(ok.info.campos.includes("reach") && ok.info.campos.includes("followers_count"));
  const por = (r: typeof ok, id: string) => r.verificacoes.find((v) => v.id === id)!;
  assert.match(por(ok, "contas").detalhe, /@showmanbarbearia/);
  assert.match(por(ok, "midias").detalhe, /2 mídia/);
  const ruim = await windsorFalso(undefined, { accountName: "nao_existe" }).fonte.testar();
  assert.equal(ruim.ok, false);
  assert.equal(por(ruim, "conta_filtro").ok, false); assert.match(por(ruim, "conta_filtro").detalhe, /não casa.*showmanbarbearia/);
  assert.equal(ruim.verificacoes.some((v) => v.id === "perfil"), false, "para no aviso, sem ler dados de outra conta");
  const semContas = await windsorFalso(() => json({ error: "no_accounts_configured" })).fonte.testar();
  assert.equal(semContas.ok, false); assert.match(semContas.verificacoes[0].detalhe, /nenhuma conta de Instagram conectada/);
  const semChave = await windsorFalso(() => json({ error: "Invalid API key" }, 401)).fonte.testar();
  assert.equal(semChave.ok, false); assert.equal(semChave.verificacoes.length, 1); assert.match(semChave.verificacoes[0].detalhe, /chave do Windsor\.ai foi recusada/);
  for (const r of [ok, ruim, semContas, semChave]) assert.ok(naoTemChave(r));
});

test("segredo: esconderChave, redactUrl e mensagemSegura nunca carregam a chave", () => {
  assert.ok(naoTemChave(esconderChave(`falha ${CHAVE} em https://connectors.windsor.ai/instagram?fields=a&api_key=${CHAVE}&x=1`, CHAVE)));
  assert.ok(!redactUrl(`https://connectors.windsor.ai/instagram?api_key=${CHAVE}`).includes(CHAVE));
  assert.ok(naoTemChave(mensagemSegura(new WindsorErro(`chave ${CHAVE} recusada`, "chave"), CHAVE)));
  assert.equal(mensagemSegura(new Error(`vazou ${CHAVE}`), CHAVE), "Falha inesperada na coleta.");
  // nenhum arquivo-fonte guarda uma chave literal na URL
  const varre = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? varre(p) : /\.(tsx?|mjs|md)$/.test(n) ? [p] : []; });
  for (const f of [...varre(new URL("../src", import.meta.url).pathname), ...varre(new URL("../docs", import.meta.url).pathname)]) {
    assert.ok(!/api_key=[A-Za-z0-9_\-]{12,}/.test(readFileSync(f, "utf8")), `${f}: chave literal`);
  }
});

// ─── Formulários (sem banco) ─────────────────────────────────────────────────

test("formulários: seções de anúncios e de Instagram são validadas separadamente; a chave Windsor nunca aparece em erro", () => {
  const fd = (o: Record<string, string | undefined>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v); return f; };
  const ig = lerCamposInstagram(fd({ ig_source: "windsor", windsor_account_name: "@showmanbarbearia", windsor_key: ` ${CHAVE_CANAL}\n`, ig_user_id: "123456" }));
  assert.ok("campos" in ig);
  if ("campos" in ig) { assert.equal(ig.campos.igSource, "windsor"); assert.equal(ig.campos.windsorAccountName, "showmanbarbearia"); assert.equal(ig.campos.windsorKey, CHAVE_CANAL); assert.equal(ig.campos.igUserId, null, "ID da Meta não vale para o Windsor"); }
  const meta = lerCamposInstagram(fd({ ig_source: "meta", ig_user_id: "17841", page_id: "99999" }));
  assert.ok("campos" in meta && meta.campos.igUserId === "17841" && meta.campos.windsorKey === null);
  for (const ruim of [{ ig_source: "meta" }, { ig_source: "x" }, { ig_source: "windsor", windsor_key: "curta" }, { ig_source: "windsor", windsor_account_name: "a;drop" }]) { const r = lerCamposInstagram(fd(ruim)); assert.ok("erro" in r, JSON.stringify(ruim)); assert.ok(naoTemChave(JSON.stringify(r))); }
  const ads = lerCamposAnuncios(fd({ ads_source: "meta", ad_account_id: "act_605261696580859", token: TOKEN_META }));
  assert.ok("campos" in ads && ads.campos.adAccountId === "act_605261696580859" && ads.campos.adsSource === "meta");
  assert.ok("erro" in lerCamposAnuncios(fd({ ads_source: "meta" })), "Meta Ads exige a conta");
  assert.ok("campos" in lerCamposAnuncios(fd({ ads_source: "none" })));
  assert.ok("campos" in lerCamposCanal(fd({ ad_account_id: "605261696580859", ig_user_id: "17841" })));
});

test("fixture do Windsor: mesma forma de snapshots que o coletor da Meta produz (a tela não depende da fonte)", async () => {
  const w = criarWindsorFixture("2026-11-16");
  const m = await w.midias({ de: "2026-08-18", ate: "2026-11-16" }, 40);
  const mm = await criarApiFixture("2026-11-16").igMidias("1", "2026-08-18", 40, () => true);
  assert.deepEqual(Object.keys(m[0]).sort(), Object.keys(mm[0]).sort());
  assert.equal(m.find((x) => x.alcance === 1775)!.views, 2899);
  const p = await w.perfil({ de: "2026-11-10", ate: "2026-11-16" });
  assert.equal(p.seguidores, 1985); assert.equal(p.conta, CONTA);
});

// ─── Banco ───────────────────────────────────────────────────────────────────

let a1 = "", a2 = "", a3 = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  a1 = await mkClient("Showman Windsor", { slug: "showman-w", kind: "midia" });
  a2 = await mkClient("Outra Windsor", { slug: "outra-w", kind: "midia" });
  a3 = await mkClient("Terceira", { slug: "terceira-w", kind: "midia" });
  await mkUser("w1@cliente.com", a1);
  await mkUser("w2@cliente.com", a2);
});
after(async () => { if (!skip) await closeDb(); });

const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};
const apiMeta = (): CanaisApi => criarApiFixture("2026-11-16");
const OPC = { hoje: "2026-11-16", dias: 90, maxMs: 120_000 };
const capturaLogs = async <T,>(fn: () => Promise<T>): Promise<{ r: T; logs: string }> => {
  const logs: string[] = []; const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => { logs.push(x.join(" ")); };
  try { return { r: await fn(), logs: logs.join("\n") }; } finally { Object.assign(console, o); }
};

test("migração: canais e snapshots do formato antigo viram duas fontes sem perda; reaplicar é idempotente e não desfaz escolhas", { skip }, async () => {
  const c1 = await mkClient("Mig Ads+IG", { slug: "mig-1", kind: "midia" });
  const c2 = await mkClient("Mig Só Ads", { slug: "mig-2", kind: "midia" });
  // volta ao formato anterior (sem as colunas/fonte e com a chave primária de 4 colunas)
  await rawQuery("alter table avanteza.client_channels drop column ads_source, drop column ig_source, drop column windsor_account_name, drop column windsor_key_enc, drop column windsor_key_hint, drop column ig_last_sync_at, drop column ig_last_error");
  await rawQuery("alter table avanteza.channel_snapshots drop column source");
  await rawQuery("alter table avanteza.channel_snapshots add primary key (client_id, kind, date, key)");
  await rawQuery("alter table avanteza.channel_snapshots drop constraint channel_snapshots_kind_check, add constraint channel_snapshots_kind_check check (kind in ('campaign_daily','ad_daily','ig_daily','ig_media'))");
  await rawQuery("insert into avanteza.client_channels (client_id, provider, ad_account_id, ig_user_id, status, last_sync_at, token_enc, token_hint) values ($1,'meta','act_1111','1784','ativo','2026-11-15T10:00:00Z','v1:aaa:bbb:ccc','ZZ99')", [c1]);
  await rawQuery("insert into avanteza.client_channels (client_id, provider, ad_account_id, status) values ($1,'meta','act_2222','pendente')", [c2]);
  await rawQuery("insert into avanteza.channel_snapshots (client_id, kind, date, key, metrics) values ($1,'ig_daily','2026-11-10','account','{\"reach\":5}'), ($1,'campaign_daily','2026-11-10','C1','{\"spend\":9}')", [c1]);

  const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  await rawQuery(sql);
  await rawQuery(sql); // idempotente
  const lin = async (id: string) => (await rawQuery<any>("select ads_source, ig_source, ig_last_sync_at, last_sync_at, token_enc, token_hint, status, windsor_key_enc from avanteza.client_channels where client_id = $1", [id]))[0];
  const m1 = await lin(c1), m2 = await lin(c2);
  assert.equal(m1.ads_source, "meta"); assert.equal(m1.ig_source, "meta");
  assert.equal(new Date(m1.ig_last_sync_at).toISOString(), "2026-11-15T10:00:00.000Z", "última coleta do Instagram herdada");
  assert.equal(m1.token_enc, "v1:aaa:bbb:ccc"); assert.equal(m1.token_hint, "ZZ99"); assert.equal(m1.status, "ativo"); assert.equal(m1.windsor_key_enc, null);
  assert.equal(m2.ads_source, "meta"); assert.equal(m2.ig_source, "none"); assert.equal(m2.ig_last_sync_at, null, "canal do Showman: Instagram ainda por escolher");
  const snaps = await rawQuery<any>("select kind, source, metrics from avanteza.channel_snapshots where client_id = $1 order by kind", [c1]);
  assert.deepEqual(snaps.map((s: any) => [s.kind, s.source]), [["campaign_daily", "meta"], ["ig_daily", "meta"]]);
  assert.equal(snaps[1].metrics.reach, 5);
  const [pk] = await rawQuery<{ n: number }>("select array_length(conkey,1)::int n from pg_constraint where contype = 'p' and conrelid = 'avanteza.channel_snapshots'::regclass");
  assert.equal(pk.n, 5);
  await rawQuery("insert into avanteza.channel_snapshots (client_id, kind, date, key, metrics, source) values ($1,'ig_audience','2026-11-10','account','{}','windsor')", [c1]); // novo kind aceito
  // a escolha feita depois da migração sobrevive a nova aplicação do schema
  await salvarInstagram(c2, { igSource: "windsor", windsorAccountName: CONTA });
  await rawQuery(sql);
  assert.equal((await lin(c2)).ig_source, "windsor");
  await assert.rejects(rawQuery("update avanteza.client_channels set ig_source = 'tiktok' where client_id = $1", [c2]));
});

test("chave do Windsor: cifrada em repouso, hint de 4 caracteres, nunca devolvida; a do canal vale mais que WINDSOR_API_KEY; sem nenhuma, null", { skip }, async () => {
  const antes = process.env.WINDSOR_API_KEY;
  try {
    await salvarCanal(a1, { adAccountId: "act_605261696580859", campaignIds: [], igUserId: null, pageId: null, usarTokenPlataforma: false, igSource: "windsor", windsorAccountName: CONTA, windsorKey: null });
    delete process.env.WINDSOR_API_KEY;
    assert.equal(await resolverChaveWindsor(a1), null);
    assert.equal(origemChaveWindsor(await obterCanal(a1)), "ausente");
    process.env.WINDSOR_API_KEY = CHAVE;
    assert.deepEqual(await resolverChaveWindsor(a1), { chave: CHAVE, origem: "plataforma" });
    assert.equal(origemChaveWindsor(await obterCanal(a1)), "plataforma");
    const c = await salvarInstagram(a1, { igSource: "windsor", windsorAccountName: CONTA, windsorKey: CHAVE_CANAL });
    assert.equal(c.temChaveWindsor, true); assert.equal(c.chaveWindsorHint, CHAVE_CANAL.slice(-4));
    assert.ok(naoTemChave(c) && naoTemChave(await obterCanal(a1)));
    const [cru] = await rawQuery<{ windsor_key_enc: string }>("select windsor_key_enc from avanteza.client_channels where client_id = $1", [a1]);
    assert.match(cru.windsor_key_enc, /^v1:/); assert.ok(naoTemChave(cru.windsor_key_enc));
    assert.deepEqual(await resolverChaveWindsor(a1), { chave: CHAVE_CANAL, origem: "canal" }, "a chave do canal vence a da plataforma");
    await salvarInstagram(a1, { igSource: "windsor", windsorAccountName: "outro", windsorKey: null });
    assert.equal((await resolverChaveWindsor(a1))!.chave, CHAVE_CANAL, "sem chave nova, mantém a salva");
    await salvarInstagram(a1, { igSource: "windsor", windsorAccountName: CONTA, windsorKey: null });
    // salvar anúncios não mexe no Instagram e vice-versa
    await salvarAnuncios(a1, { adAccountId: "act_605261696580859", campaignIds: [], usarTokenPlataforma: false, token: TOKEN_META, adsSource: "meta" });
    const k = (await obterCanal(a1))!;
    assert.equal(k.igSource, "windsor"); assert.equal(k.windsorAccountName, CONTA); assert.equal(k.temChaveWindsor, true); assert.equal(k.tokenHint, TOKEN_META.slice(-4));
    // desligar o Instagram apaga só a chave dele; o token da Meta fica
    await desconectarFonte(a1, "instagram");
    const d = (await obterCanal(a1))!;
    assert.equal(d.igSource, "none"); assert.equal(d.temChaveWindsor, false); assert.equal(d.temToken, true); assert.equal(d.adsSource, "meta"); assert.notEqual(d.status, "desconectado");
    await desconectarFonte(a1, "ads");
    assert.equal((await obterCanal(a1))!.status, "desconectado", "as duas fontes desligadas");
    await salvarInstagram(a1, { igSource: "windsor", windsorAccountName: CONTA });
    await salvarAnuncios(a1, { adAccountId: "act_605261696580859", campaignIds: [], usarTokenPlataforma: false, token: null, adsSource: "meta" });
  } finally { if (antes === undefined) delete process.env.WINDSOR_API_KEY; else process.env.WINDSOR_API_KEY = antes; }
});

test("coleta do Instagram pelo Windsor: perfil, mídias e audiência gravados com source 'windsor'; idempotente; anúncios intocados; chave fora dos logs", { skip }, async () => {
  const canal = (await obterCanal(a1))!;
  assert.equal(canal.lastSyncAt, null);
  const { fonte, chamadas } = windsorFalso();
  const { r, logs } = await capturaLogs(async () => {
    const r1 = await coletarCanal(canal, null, { ...OPC, fontes: ["instagram"] }, null, { fonte, chave: CHAVE });
    const n1 = Number((await rawQuery<{ n: number }>("select count(*)::int n from avanteza.channel_snapshots where client_id = $1", [a1]))[0].n);
    const r2 = await coletarCanal((await obterCanal(a1))!, null, { ...OPC, fontes: ["instagram"] }, null, { fonte, chave: CHAVE });
    assert.equal(Number((await rawQuery<{ n: number }>("select count(*)::int n from avanteza.channel_snapshots where client_id = $1", [a1]))[0].n), n1, "idempotente");
    return [r1, r2];
  });
  assert.ok(r[0].ok && r[1].ok && r[0].instagram!.origem === "windsor" && r[0].ads === null);
  assert.ok(naoTemChave(logs) && naoTemChave(JSON.stringify(r)));
  assert.ok(chamadas.every((c) => c.url.hostname === WINDSOR_HOST));
  assert.equal(chamadas.filter((c) => c.url.searchParams.get("fields")!.includes("media_id")).length, 2);
  const dias = await lerSnapshots(a1, ["ig_daily"], "2026-08-01", "2026-11-16", "windsor");
  assert.equal(dias.length, 4);
  const dia = (d: string) => dias.find((x) => String(x.date).includes(d))!;
  assert.equal(dia("2026-11-16").metrics.followers, 1985); assert.equal(dia("2026-11-16").metrics.follower_net, 2);
  assert.ok(!("reach" in dia("2026-11-16").metrics), "o dia em andamento não grava alcance incompleto");
  assert.ok(!("reach" in dia("2026-11-14").metrics), "null não vira zero");
  assert.equal(dia("2026-11-13").metrics.reach, 702);
  assert.deepEqual(dia("2026-11-15").metrics.indisponiveis, [], "indisponíveis só quando nenhum dia trouxe a métrica (aqui todas vieram)");
  const midias = await lerSnapshots(a1, ["ig_media"], "2026-08-01", "2026-11-16", "windsor");
  assert.equal(midias.length, 2);
  const reel = midias.find((m) => m.key === "17900000000000001")!;
  assert.equal(reel.metrics.reach, 1775); assert.equal(reel.metrics.views, 2899); assert.equal(reel.metrics.type, "VIDEO"); assert.equal(reel.metrics.product, "REELS");
  const aud = await lerSnapshots(a1, ["ig_audience"], "2026-11-16", "2026-11-16", "windsor");
  assert.equal(aud.length, 1); assert.equal(aud[0].metrics.idade["25-34"], 780);
  assert.equal((await lerSnapshots(a1, ["ig_daily", "ig_media", "ig_audience"], "2026-01-01", "2026-12-31", "meta")).length, 0, "nada gravado como Meta");
  const c = (await obterCanal(a1))!;
  assert.ok(c.igLastSyncAt); assert.equal(c.igLastError, null); assert.equal(c.lastSyncAt, null, "coleta de anúncios continua separada"); assert.equal(c.status, "ativo"); assert.equal(c.info.ig_username, CONTA);
});

test("independência: falha dos anúncios não derruba o Instagram (e vice-versa); cada fonte guarda o próprio erro, sem segredo", { skip }, async () => {
  await rawQuery("update avanteza.client_channels set last_sync_at = null, last_error = null, ig_last_sync_at = null, ig_last_error = null, status = 'pendente' where client_id = $1", [a1]);
  const meta = apiMeta();
  const quebrado: CanaisApi = { ...meta, insightsDiarios: async () => { throw new GraphErro(`O token ${TOKEN_META} expirou`, "token"); } };
  const w = windsorFalso();
  let canal = (await obterCanal(a1))!;
  const r1 = await coletarCanal(canal, quebrado, OPC, TOKEN_META, { fonte: w.fonte, chave: CHAVE });
  assert.equal(r1.ads!.ok, false); assert.equal(r1.instagram!.ok, true); assert.equal(r1.ok, true);
  canal = (await obterCanal(a1))!;
  assert.ok(canal.lastError && !canal.lastError.includes(TOKEN_META)); assert.equal(canal.lastSyncAt, null);
  assert.equal(canal.igLastError, null); assert.ok(canal.igLastSyncAt);
  assert.equal(canal.status, "ativo", "o Instagram saudável mantém o canal ativo");
  // agora o contrário: Windsor com chave recusada, anúncios bem
  const ruim = windsorFalso(() => json({ error: "Invalid API key" }, 401));
  const r2 = await coletarCanal(canal, meta, OPC, TOKEN_META, { fonte: ruim.fonte, chave: CHAVE });
  assert.equal(r2.ads!.ok, true); assert.equal(r2.instagram!.ok, false);
  canal = (await obterCanal(a1))!;
  assert.ok(canal.lastSyncAt); assert.equal(canal.lastError, null);
  assert.match(canal.igLastError ?? "", /chave do Windsor\.ai foi recusada/); assert.ok(naoTemChave(canal));
  // dados das duas fontes ficam cada um na sua origem; os anúncios nunca vêm do Windsor
  assert.equal((await lerSnapshots(a1, ["campaign_daily", "ad_daily"], "2026-08-01", "2026-11-16", "windsor")).length, 0);
  assert.ok((await lerSnapshots(a1, ["campaign_daily"], "2026-08-01", "2026-11-16", "meta")).length > 0);
  // sem credencial de uma fonte: pula só aquela
  const r3 = await coletarCanal(canal, null, OPC, null, { fonte: w.fonte, chave: CHAVE });
  assert.equal(r3.ads!.executada, false); assert.match(r3.ads!.motivoPulo!, /Meta/); assert.equal(r3.instagram!.ok, true);
  const r4 = await coletarCanal(canal, meta, OPC, TOKEN_META, null);
  assert.equal(r4.instagram!.executada, false); assert.match(r4.instagram!.motivoPulo!, /Windsor/); assert.equal(r4.ads!.ok, true);
});

test("coletarTodos: canal com anúncios sem token e Instagram no Windsor coleta o Instagram; sem nenhuma credencial pula; atualizarAgora age por fonte", { skip }, async () => {
  await rawQuery("update avanteza.client_channels set ig_last_sync_at = null where client_id = $1", [a1]);
  await salvarCanal(a3, { adAccountId: "act_777000111", campaignIds: [], igUserId: null, pageId: null, usarTokenPlataforma: false, token: null, igSource: "windsor", windsorAccountName: CONTA });
  const w = windsorFalso();
  const visitados: string[] = [];
  const r = await coletarTodos({
    maxMs: 300_000, apiPara: async (c) => { visitados.push(`meta:${c.clientId}`); return c.clientId === a3 ? null : { api: apiMeta(), token: null }; },
    windsorPara: async (c) => (c.clientId === a3 ? { fonte: w.fonte, chave: CHAVE } : null),
  });
  const do3 = r.resultados.find((x: any) => x.clientId === a3) as any;
  assert.ok(do3 && do3.ok === true && do3.ads.executada === false && do3.instagram.ok === true);
  const do1 = r.resultados.find((x: any) => x.clientId === a1) as any;
  assert.ok(do1.ads.ok === true && do1.instagram?.executada === false, "a1 sem Windsor pula só o Instagram");
  assert.ok((await obterCanal(a3))!.igLastSyncAt && !(await obterCanal(a3))!.lastSyncAt);
  // atualizarAgora por fonte
  const rIg = await atualizarAgora(a3, { fonte: "instagram", windsor: async () => ({ fonte: w.fonte, chave: CHAVE }) });
  assert.equal(rIg.ok, true); assert.match(rIg.mensagem, /Coleta de Instagram concluída/); assert.ok(rIg.resultado!.ads === null);
  const rAds = await atualizarAgora(a3, { fonte: "ads", meta: async () => ({ api: apiMeta(), token: null }) });
  assert.equal(rAds.ok, true); assert.match(rAds.mensagem, /Coleta de anúncios/); assert.ok(rAds.resultado!.instagram === null);
  const semChave = await atualizarAgora(a3, { fonte: "instagram", windsor: async () => null });
  assert.equal(semChave.ok, false); assert.match(semChave.mensagem, /Sem chave do Windsor\.ai/);
  const semMeta = await atualizarAgora(a3, { fonte: "ads", meta: async () => null });
  assert.equal(semMeta.ok, false); assert.match(semMeta.mensagem, /Sem token da Meta/);
  const falhou = await atualizarAgora(a3, { fonte: "instagram", windsor: async () => ({ fonte: windsorFalso(() => json({ error: "no_accounts_configured" })).fonte, chave: CHAVE }) });
  assert.equal(falhou.ok, false); assert.match(falhou.mensagem, /nenhuma conta de Instagram conectada/); assert.ok(naoTemChave(falhou.mensagem));
  await rawQuery("update avanteza.client_channels set ig_last_error = null where client_id = $1", [a3]);
});

test("teste de conexão do Windsor (serviço): usa a chave digitada > do canal > WINDSOR_API_KEY, diz qual usou e nunca a devolve", { skip }, async () => {
  const antes = process.env.WINDSOR_API_KEY, orig = globalThis.fetch;
  const vistos: string[] = [];
  try {
    delete process.env.WINDSOR_API_KEY;
    const sem_ = await testarConexaoWindsor({ clientId: a2, accountName: null });
    assert.equal(sem_.ok, false); assert.match(sem_.verificacoes[0].detalhe, /Nenhuma chave disponível.*WINDSOR_API_KEY/);
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const u = new URL(String(url)); vistos.push(`${init?.method ?? "GET"} ${u.hostname} ${u.searchParams.get("api_key")}`);
      const f = (u.searchParams.get("fields") ?? "").split(",");
      return json(f.includes("media_id") ? { data: MIDIAS_REAL } : { data: PERFIL_REAL });
    }) as typeof fetch;
    process.env.WINDSOR_API_KEY = CHAVE;
    const plat = await testarConexaoWindsor({ clientId: a2, accountName: CONTA });
    assert.equal(plat.origemChave, "plataforma"); assert.equal(plat.ok, true); assert.equal(plat.info.midias, 2);
    const dig = await testarConexaoWindsor({ clientId: a2, accountName: CONTA, chaveDigitada: CHAVE_CANAL });
    assert.equal(dig.origemChave, "canal");
    assert.deepEqual([...new Set(vistos.map((v) => v.split(" ")[0]))], ["GET"]);
    assert.ok(vistos.some((v) => v.endsWith(CHAVE)) && vistos.some((v) => v.endsWith(CHAVE_CANAL)));
    assert.ok(naoTemChave(plat) && naoTemChave(dig) && naoTemChave(sem_));
    assert.equal((await obterCanal(a2))?.info.ig_username ?? CONTA, CONTA);
  } finally { globalThis.fetch = orig; if (antes === undefined) delete process.env.WINDSOR_API_KEY; else process.env.WINDSOR_API_KEY = antes; }
});

test("Mapa: o Instagram lê só da fonte configurada (Windsor ou Meta) e os anúncios só da Meta; as fontes nunca se misturam e uma não esconde a outra", { skip }, async () => {
  const c = await mkClient("Duas Fontes", { slug: "duas-fontes", kind: "midia" });
  await mkUser("duas@cliente.com", c);
  await salvarCanal(c, { adAccountId: "act_5550001", campaignIds: [], igUserId: "17841400000001", pageId: null, usarTokenPlataforma: false, token: null, igSource: "windsor", windsorAccountName: CONTA });
  const sc = await scopeDe("duas@cliente.com", [c]);
  // 1) nada coletado: estado honesto
  let d = await carregarCanaisDoCliente(sc, "30", "2026-11-16");
  assert.equal(d.estado.conectado, false); assert.equal(d.estado.anuncios, true); assert.equal(d.estado.instagram, true); assert.equal(d.estado.fonteInstagram, "windsor");
  // 2) só o Instagram (Windsor) coletou: anúncios seguem "conectando" e o Instagram já mostra dados
  await gravarSnapshots(c, [
    { kind: "ig_daily", date: "2026-11-15", key: "account", metrics: { reach: 700, followers: 1985, follower_net: 3 } },
    { kind: "ig_daily", date: "2026-11-14", key: "account", metrics: { reach: 650, follower_net: 2 } },
    { kind: "ig_media", date: "2026-11-12", key: "W1", metrics: { type: "VIDEO", product: "REELS", caption: "REEL DO WINDSOR", timestamp: "2026-11-12T15:00:00Z", reach: 1775, views: 2899, likes: 96 } },
  ], "windsor");
  await gravarSnapshots(c, [
    { kind: "ig_daily", date: "2026-11-15", key: "account", metrics: { reach: 99999, followers: 7 } },
    { kind: "ig_media", date: "2026-11-12", key: "M1", metrics: { type: "IMAGE", caption: "POST DA META", timestamp: "2026-11-12T15:00:00Z", likes: 5 } },
  ], "meta");
  await marcarColeta(c, { ok: true }, "instagram");
  d = await carregarCanaisDoCliente(sc, "30", "2026-11-16");
  assert.equal(d.estado.instagramConectado, true); assert.equal(d.estado.anunciosConectado, false); assert.equal(d.estado.conectado, true);
  assert.equal(d.anuncios, null); assert.ok(d.instagram);
  assert.equal(d.instagram!.seguidores.atual, 1985); assert.equal(d.instagram!.seguidores.estimado, true);
  assert.equal(d.instagram!.kpis.find((k) => k.id === "reach")!.atual, 1350, "só a soma da fonte Windsor (700 + 650)");
  assert.deepEqual(d.instagram!.midias.map((m) => m.legenda), ["REEL DO WINDSOR"]);
  const t = JSON.stringify(d);
  assert.ok(!t.includes("POST DA META") && !t.includes("99999"));
  assert.ok(!/windsor_|api_key|wk-/i.test(t.replace(/"fonteInstagram":"windsor"/, "")));
  // 3) anúncios da Meta chegam: aparecem sem somar nada do Instagram
  await gravarSnapshots(c, [{ kind: "campaign_daily", date: "2026-11-15", key: "C", metrics: { nome: "C", spend: 50, impressions: 1000, clicks: 20, results: 4 } }], "meta");
  await marcarColeta(c, { ok: true }, "ads");
  d = await carregarCanaisDoCliente(sc, "30", "2026-11-16");
  assert.equal(d.estado.anunciosConectado, true); assert.equal(d.anuncios!.atual.gasto, 50);
  // 4) trocar a fonte do Instagram para a Meta: passa a ler só os dados da Meta
  await salvarInstagram(c, { igSource: "meta", igUserId: "17841400000001" });
  await marcarColeta(c, { ok: true }, "instagram");
  d = await carregarCanaisDoCliente(sc, "30", "2026-11-16");
  assert.equal(d.estado.fonteInstagram, "meta");
  assert.equal(d.instagram!.kpis.find((k) => k.id === "reach")!.atual, 99999);
  assert.deepEqual(d.instagram!.midias.map((m) => m.legenda), ["POST DA META"]);
  // 5) uma fonte com erro não apaga a outra: estado por fonte
  await marcarColeta(c, { ok: false, erro: "falha" }, "ads");
  d = await carregarCanaisDoCliente(sc, "30", "2026-11-16");
  assert.equal(d.estado.anunciosComProblema, true); assert.equal(d.estado.instagramComProblema, false); assert.ok(d.anuncios && d.instagram);
});

test("isolamento (IDOR): dados e fonte Windsor de um cliente não aparecem para outro, e a chave/conta do Windsor nunca saem pela leitura do Mapa", { skip }, async () => {
  await salvarInstagram(a2, { igSource: "windsor", windsorAccountName: "conta_secreta_do_outro", windsorKey: CHAVE_CANAL });
  await marcarColeta(a2, { ok: true }, "instagram");
  await gravarSnapshots(a2, [
    { kind: "ig_media", date: "2026-11-14", key: "SEC", metrics: { type: "IMAGE", caption: "LEGENDA SECRETA DO OUTRO", timestamp: "2026-11-14T10:00:00Z", likes: 1 } },
    { kind: "ig_audience", date: "2026-11-16", key: "account", metrics: { cidades: { "Cidade Secreta": 10 } } },
    { kind: "ig_daily", date: "2026-11-15", key: "account", metrics: { reach: 4242, followers: 31337 } },
  ], "windsor");
  const dados1 = await carregarCanaisDoCliente(await scopeDe("w1@cliente.com", [a1]), "90", "2026-11-16");
  const dados2 = await carregarCanaisDoCliente(await scopeDe("w2@cliente.com", [a2]), "90", "2026-11-16");
  const t1 = JSON.stringify(dados1), t2 = JSON.stringify(dados2);
  for (const secreto of ["SECRETA DO OUTRO", "Cidade Secreta", "31337", "conta_secreta_do_outro", CHAVE_CANAL.slice(-4)]) assert.ok(!t1.includes(secreto), `a1 não vê ${secreto}`);
  assert.ok(t2.includes("LEGENDA SECRETA DO OUTRO") && t2.includes("Cidade Secreta"));
  for (const t of [t1, t2]) assert.ok(naoTemChave(t) && !/windsor_key|WINDSOR_API_KEY/.test(t));
  await assert.rejects(carregarCanaisDoCliente({ clientId: a2, allowedClientIds: [a2], readOnly: false, userEmail: "x@x" } as any, "30"), /Escopo/);
});

test("relatório: seguidores reconstruídos para trás do valor atual e do saldo diário são marcados como estimados", () => {
  const per = resolverPeriodo("7", "2026-11-16");
  const L = (date: string, metrics: Record<string, unknown>): Linha => ({ kind: "ig_daily", date, key: "account", metrics });
  const r = relInstagram([L("2026-11-16", { followers: 1985, follower_net: 2 }), L("2026-11-15", { follower_net: 3 }), L("2026-11-14", { follower_net: -1 }), L("2026-11-13", { follower_net: 4 })], per);
  assert.equal(r.seguidores.atual, 1985); assert.equal(r.seguidores.estimado, true);
  assert.deepEqual(r.seguidores.serie.slice(-3).map((s) => s.valor), [1980, 1983, 1985], "valor no fim de cada dia (15/11 = 1985 - 2; 14/11 = 1983 - 3 = 1980 ...)");
});

// Canais → Anúncios: "Público e localização". Linhas reais do Windsor da agência (conector facebook, conta 605261696580859,
// campanhas SHOW MAN, 01–18/11/2026) como fixtures: idade × gênero com conversas, região (conversas vieram 0 = indisponível),
// posicionamento e adset_targeting. O Windsor e a Meta reais NUNCA são chamados (fetch simulado). A chave abaixo é FALSA.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { criarWindsorAds, CAMPOS_QUEBRA } from "../src/lib/channels/windsor-ads";
import { WINDSOR_HOST } from "../src/lib/channels/windsor";
import { criarApiGraph, criarGraph, quebraDaLinhaGraph } from "../src/lib/channels/graph";
import { coletarCanal } from "../src/lib/channels/collect";
import { carregarCanaisDoCliente } from "../src/lib/channels/cliente";
import { lerSnapshots, obterCanal, salvarAnuncios } from "../src/lib/channels/store";
import {
  carregarPublico, interpretarTargeting, limparNome, negocioDoNome, relIdadeGenero, relPosicionamento, relPublico, relRegioes, rotuloPublico, type LinhaSnap,
} from "../src/lib/channels/publico";
import { resolverPeriodo } from "../src/lib/dashboards/periodo";
import { SecaoPublico } from "../src/components/canais/Publico";
import { TodosAnuncios } from "../src/components/canais/TodosAnuncios";
import { linkMetaSeguro, rotuloCta } from "../src/lib/channels/links";
import { relAnuncios } from "../src/lib/channels/report";
import { resumoPublico, resumosDosConjuntos } from "../src/lib/channels/publico";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession } from "../src/lib/mapa/scope";
import { liveAllowedCompanies } from "../src/lib/mapa/repo";

(globalThis as unknown as { React: typeof React }).React = React;
const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);
const CHAVE = "wk-FALSA-publico-0a1b2c3d4e5f";
const CONTA = "605261696580859";
const RES = "actions_onsite_conversion_messaging_conversation_started_7d";
const sem = async () => undefined;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

const FLORESTA = { id: "120252388371430661", nome: "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km" };
const BASE = { id: "120252609606470661", nome: "SHOW MAN | BASE CLIENTES" };
const SEMELHANTE = { id: "120252609607960661", nome: "SHOW MAN | SEMELHANTE 1%" };
const DESTRAVA = { id: "999000111", nome: "Destrava - SHOPEE" };

// Amostras reais de adset_targeting (como texto JSON, do jeito que o Windsor devolve). Coordenadas do CJ1 de demonstração.
const T_CJ1 = JSON.stringify({ age_max: 45, age_min: 18, excluded_custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], genders: [1], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.6253, longitude: -49.2643, radius: 3, country: "BR" }], location_types: ["home", "recent"] }, targeting_automation: { advantage_audience: 0 }, brand_safety_content_filter_levels: ["FACEBOOK_STANDARD"] });
const T_BASE = JSON.stringify({ age_max: 65, age_min: 18, custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.5981, longitude: -49.2741, radius: 10, country: "BR" }] } });
const T_LAL = JSON.stringify({ age_max: 50, age_min: 20, genders: [1], custom_audiences: [{ id: "120252609600000001", name: "Lookalike (BR, 1%) - SM_base_completa.csv" }], excluded_custom_audiences: [{ id: "120252609561060661", name: "SM_base_completa.csv" }], geo_locations: { custom_locations: [{ distance_unit: "kilometer", latitude: -16.6253, longitude: -49.2643, radius: 5, country: "BR" }] }, targeting_automation: { advantage_audience: 1 }, campo_novo_da_meta: { x: 1 } });

// (2) campaign,age,gender,spend,impressions,conversas — linhas reais (homens) + femininas/unknown do mesmo corte (somente leitura, 01–18/11)
const IDADE: Array<[string, string, number, number, number]> = [
  ["18-24", "male", 47.32, 3959, 14], ["25-34", "male", 141.32, 10031, 26], ["35-44", "male", 109.91, 5871, 16], ["45-54", "male", 9.21, 335, 2],
  ["25-34", "female", 12.4, 900, 1], ["18-24", "female", 3.1, 300, 0], ["25-34", "unknown", 2.05, 150, 0],
];
// (1) campaign,region,… — conversas vieram 0 com o corte region
const REGIAO: Array<[typeof FLORESTA, number, number]> = [[FLORESTA, 307.76, 20196], [BASE, 37.4, 2279], [SEMELHANTE, 21.38, 1607]];
// (3) campaign,publisher_platform,platform_position,spend
const POSICAO: Array<[string, string, number]> = [
  ["facebook", "facebook_reels", 25.92], ["facebook", "facebook_reels_overlay", 0.31], ["facebook", "facebook_stories", 9.54], ["facebook", "feed", 48.81],
  ["instagram", "feed", 60.2], ["instagram", "instagram_reels", 90.1], ["instagram", "instagram_stories", 70.4], ["instagram", "instagram_explore", 6.5],
];

// Anúncios reais do Showman (01–18/11): o mesmo A1 roda no Floresta 3km e na BASE CLIENTES; A2/A3/A1V quase não entregaram.
const BODY_A1 = "Seu corte dura 15 dias. Aí o cabelo cresce, o degradê some e você paga tudo de novo.\n\nNa Show Man Barbearia você assina e corta quantas vezes quiser por R$69,90.";
const ADS = [
  { id: "ad1", nome: "A1 | Estático | Ilimitado R$69,90", c: FLORESTA, s: "s1", sn: "CJ1 | Ilimitado R$69,90 | Floresta 3km", g: 292.41, i: 18000, k: 300, r: 57, title: "Corte ilimitado por R$69,90", body: BODY_A1 },
  { id: "ad4", nome: "A1 | Estático | Ilimitado R$69,90", c: BASE, s: "s2", sn: "BASE | Clientes cadastrados", g: 37.26, i: 2200, k: 20, r: 2, title: "Corte ilimitado por R$69,90", body: BODY_A1 },
  { id: "ad2", nome: "A2 | Estático | 4 motivos", c: FLORESTA, s: "s1", sn: "CJ1 | Ilimitado R$69,90 | Floresta 3km", g: 1.18, i: 90, k: 1, r: 0, title: "Assine e fique sempre na régua", body: "Curto." },
  { id: "ad3", nome: "A3 | Estático | Barbearia do Floresta", c: FLORESTA, s: "s1", sn: "CJ1 | Ilimitado R$69,90 | Floresta 3km", g: 0.83, i: 60, k: 0, r: 0, title: "Show Man Barbearia · Floresta", body: "Venha conhecer." },
  { id: "ad5", nome: "A1V | Vídeo | Ilimitado R$69,90", c: FLORESTA, s: "s1", sn: "CJ1 | Ilimitado R$69,90 | Floresta 3km", g: 1.05, i: 80, k: 1, r: 0, title: "Corte ilimitado", body: "Vídeo." },
];

interface Chamada { url: URL; init?: RequestInit }
function windsorFalso(o: { recusar?: (f: string[]) => boolean } = {}) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    chamadas.push({ url: u, init });
    const f = (u.searchParams.get("fields") ?? "").split(",");
    if (o.recusar?.(f)) return json({ error: "unknown_field: reach" }, 400);
    const conta = { account_id: CONTA, account_name: "Showman" };
    const so = (l: Record<string, unknown>) => Object.fromEntries(Object.entries(l).filter(([k]) => f.includes(k)));
    if (f.includes("adset_targeting")) {
      return json({ data: [
        { ...conta, campaign_id: FLORESTA.id, campaign: FLORESTA.nome, adset_id: "a1", adset_name: "CJ1 | Ilimitado R$69,90 | Floresta 3km", adset_targeting: T_CJ1 },
        { ...conta, campaign_id: BASE.id, campaign: BASE.nome, adset_id: "s2", adset_name: "BASE | Clientes cadastrados", adset_targeting: T_BASE },
        { ...conta, campaign_id: SEMELHANTE.id, campaign: SEMELHANTE.nome, adset_id: "s3", adset_name: "SEMELHANTE 1% | Clientes", adset_targeting: T_LAL },
        { ...conta, campaign_id: DESTRAVA.id, campaign: DESTRAVA.nome, adset_id: "a9", adset_name: "Shopee", adset_targeting: "{\"age_min\":30}" },
      ].map(so) });
    }
    const d = "2026-11-10";
    if (f.includes("ad_id") && f.includes("title")) return json({ data: ADS.map((x) => ({ ...conta, ad_id: x.id, campaign_id: x.c.id, campaign: x.c.nome, adset_id: x.s, adset_name: x.sn, title: x.title, body: x.body, call_to_action_type: "WHATSAPP_MESSAGE", ad_preview_shareable_link: x.id === "ad2" ? "javascript:alert(1)" : `https://fb.me/v${x.id.slice(2)}prev`, instagram_permalink_url: x.id === "ad3" ? "https://instagram.com.evil.test/p/x" : "https://www.instagram.com/p/ABC123/" })).map(so) });
    if (f.includes("ad_id") && f.includes("status")) return json({ data: ADS.map((x) => ({ ...conta, ad_id: x.id, ad_name: x.nome, campaign_id: x.c.id, campaign: x.c.nome, status: "ACTIVE", effective_status: "ACTIVE", thumbnail_url: null })).map(so) });
    if (f.includes("ad_id")) return json({ data: ADS.map((x) => ({ date: d, ...conta, ad_id: x.id, ad_name: x.nome, campaign_id: x.c.id, campaign: x.c.nome, spend: x.g, impressions: x.i, reach: Math.round(x.i * 0.7), clicks: x.k, ctr: 1, cpc: 1, frequency: 1.1, [RES]: x.r })).map(so) });
    if (f.includes("age")) return json({ data: [...IDADE.map(([age, gender, spend, impressions, c]) => ({ date: d, ...conta, campaign_id: FLORESTA.id, campaign: FLORESTA.nome, age, gender, spend, impressions, reach: Math.round(impressions * 0.7), clicks: 10, [RES]: c })), { date: d, ...conta, campaign_id: DESTRAVA.id, campaign: DESTRAVA.nome, age: "25-34", gender: "male", spend: 999, impressions: 9, [RES]: 9 }].map(so) });
    if (f.includes("region")) return json({ data: REGIAO.map(([c, spend, impressions]) => ({ date: d, ...conta, campaign_id: c.id, campaign: c.nome, region: "Goiás", spend, impressions, reach: impressions, clicks: 5, [RES]: 0 })).map(so) });
    if (f.includes("publisher_platform")) return json({ data: POSICAO.map(([publisher_platform, platform_position, spend]) => ({ date: d, ...conta, campaign_id: FLORESTA.id, campaign: FLORESTA.nome, publisher_platform, platform_position, spend, impressions: Math.round(spend * 70) })).map(so) });
    // nível campanha (coleta)
    return json({ data: [FLORESTA, BASE, SEMELHANTE, DESTRAVA].map((c) => ({ date: d, ...conta, campaign_id: c.id, campaign: c.nome, spend: 100, impressions: 5000, reach: 4000, clicks: 50, ctr: 1, cpc: 2, frequency: 1.2, [RES]: c === DESTRAVA ? 50 : 20 })).map(so) });
  }) as typeof fetch;
  const fonte = criarWindsorAds({ chave: CHAVE, contaId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", fetchImpl, sleep: sem, baseDelayMs: 1, maxDelayMs: 2, retries: 0 });
  return { fonte, chamadas };
}

// ─── Parser do targeting ─────────────────────────────────────────────────────

test("targeting CJ1 (Floresta 3km): idade, homens, raio com link do mapa e lista de clientes excluída — sem id, .csv nem JSON", () => {
  const { publico: p, tecnico } = interpretarTargeting(T_CJ1, { conjunto: "CJ1 | Ilimitado R$69,90 | Floresta 3km", campanha: FLORESTA.nome, negocio: negocioDoNome("Showman Barbearia") });
  assert.equal(p.legivel, true);
  assert.equal(p.idade, "18 a 45 anos");
  assert.equal(p.genero, "Homens");
  assert.equal(p.locais.length, 1);
  assert.equal(p.locais[0].texto, "3 km ao redor de Floresta", "lugar tirado do nome do conjunto com o mesmo raio");
  assert.equal(p.locais[0].mapa, "https://www.google.com/maps/search/?api=1&query=-16.62530,-49.26430");
  assert.deepEqual(p.publicosExcluidos, ["lista de clientes da barbearia"]);
  assert.deepEqual(p.publicos, []);
  assert.equal(p.posicionamentos, null, "sem publisher_platforms = automático");
  const txt = JSON.stringify(p);
  assert.doesNotMatch(txt, /\.csv|120252609561060661|SM_base|age_min|\{\\"/);
  assert.deepEqual(tecnico.naoInterpretados, []);
  assert.match(tecnico.json, /SM_base_completa\.csv/, "o administrador vê o bruto");
});

test("targeting BASE e SEMELHANTE 1%: 18+ todos os gêneros com a lista; semelhante 1% aos clientes; Advantage+ e campo novo só no técnico", () => {
  const neg = negocioDoNome("Showman Barbearia");
  const b = interpretarTargeting(T_BASE, { conjunto: "BASE | Clientes cadastrados", negocio: neg }).publico;
  assert.equal(b.idade, "18 anos ou mais"); assert.equal(b.genero, "Homens e mulheres");
  assert.deepEqual(b.publicos, ["lista de clientes da barbearia"]);
  assert.equal(b.locais[0].texto, "10 km ao redor de ponto definido");
  const { publico: l, tecnico } = interpretarTargeting(T_LAL, { conjunto: "SEMELHANTE 1% | Clientes", negocio: neg });
  assert.deepEqual(l.publicos, ["semelhante 1% aos clientes"]);
  assert.deepEqual(l.publicosExcluidos, ["lista de clientes da barbearia"]);
  assert.equal(l.idade, "20 a 50 anos");
  assert.ok(l.notas.some((n) => /Advantage\+/.test(n)));
  assert.deepEqual(tecnico.naoInterpretados, ["campo_novo_da_meta"]);
  assert.doesNotMatch(JSON.stringify(l), /campo_novo|\.csv|1202526/);
});

test("targeting: países, regiões, cidades, CEP, milhas, interesses, posicionamentos, nome com endereço e formato inválido", () => {
  const t = {
    genders: [2], age_min: 25,
    geo_locations: { countries: ["BR"], regions: [{ key: "460", name: "Goiás" }], cities: [{ key: "1", name: "Goiânia", region: "Goiás", radius: 10, distance_unit: "kilometer" }], zips: [{ key: "BR:74000-000" }],
      custom_locations: [{ latitude: -16.6, longitude: -49.2, radius: 2, distance_unit: "mile", address_string: "Rua 10, Setor Oeste" }, { latitude: 1, longitude: 2, radius: 1, distance_unit: "kilometer", name: "(-16.60, -49.20)" }] },
    excluded_geo_locations: { cities: [{ name: "Aparecida de Goiânia" }] },
    flexible_spec: [{ interests: [{ id: "6003", name: "Barbearia" }], behaviors: [{ id: "6004", name: "Compradores engajados" }] }],
    exclusions: { interests: [{ id: "1", name: "Salão de beleza" }] },
    publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "facebook_reels"], instagram_positions: ["stream", "story", "explore"],
    device_platforms: ["mobile"],
  };
  const p = interpretarTargeting(t, { conjunto: "Teste 1234567890123" }).publico;
  assert.equal(p.conjunto, "Teste", "número longo (id) some do nome");
  assert.equal(p.genero, "Mulheres"); assert.equal(p.idade, "25 anos ou mais");
  const textos = p.locais.map((l) => l.texto);
  assert.ok(textos.includes("3,2 km ao redor de Rua 10, Setor Oeste"), textos.join(" / "));
  assert.ok(textos.includes("1 km ao redor de ponto definido"), "nome que é só coordenada vira 'ponto definido'");
  assert.ok(textos.includes("Goiânia (Goiás) e até 10 km ao redor"));
  assert.ok(textos.includes("Goiás")); assert.ok(textos.includes("CEP 74000-000")); assert.ok(textos.includes("Brasil"));
  assert.deepEqual(p.locaisExcluidos, ["Aparecida de Goiânia"]);
  assert.deepEqual(p.interesses, ["Barbearia", "Compradores engajados"]);
  assert.deepEqual(p.interessesExcluidos, ["Salão de beleza"]);
  assert.equal(p.posicionamentos, "Facebook: Feed, Reels · Instagram: Feed, Stories, Explorar");
  assert.ok(p.notas.includes("Só no celular."));
  const ruim = interpretarTargeting("{isto não é json", { conjunto: "X" });
  assert.equal(ruim.publico.legivel, false);
  assert.deepEqual(ruim.tecnico.naoInterpretados, ["(formato não reconhecido)"]);
});

test("rótulos amigáveis de públicos e limpeza de nomes", () => {
  assert.equal(rotuloPublico("SM_base_completa.csv", "da barbearia"), "lista de clientes da barbearia");
  assert.equal(rotuloPublico("SM_base_completa.csv", null), "lista de clientes cadastrados");
  assert.equal(rotuloPublico("Público semelhante (BR, 2%) - Engajamento Instagram 365d", null), "semelhante 2% a quem interagiu com o perfil");
  assert.equal(rotuloPublico("IG engajamento 90d", null), "pessoas que interagiram com o Instagram");
  assert.equal(rotuloPublico("Visitantes site 30d (pixel)", null), "visitantes do site");
  assert.equal(rotuloPublico("Viu 50% do vídeo", null), "pessoas que assistiram aos vídeos");
  assert.equal(rotuloPublico("120252609561060661", null), "público personalizado da empresa");
  assert.equal(rotuloPublico(null, null, "SEMELHANTE 1%"), "semelhante 1% aos clientes");
  assert.equal(limparNome("BASE | SM_base_completa.csv"), "BASE");
  assert.equal(negocioDoNome("Clínica Sorriso"), "da clínica");
  assert.equal(negocioDoNome("Showman"), null);
});

// ─── Agregações ──────────────────────────────────────────────────────────────

const snap = (kind: string, date: string, metrics: Record<string, unknown>): LinhaSnap => ({ kind, date, key: JSON.stringify(metrics).slice(0, 40), metrics });
const linhasIdade = () => IDADE.map(([idade, genero, spend, impressions, results]) => snap("ads_breakdown", "2026-11-10", { dimensao: "idade_genero", campaign_id: FLORESTA.id, idade, genero, spend, impressions, reach: null, clicks: null, results }));

test("idade × gênero (linhas reais): homens 25–34 = R$ 141,32 / 26 conversas; melhor público e mais caro com gasto relevante", () => {
  const r = relIdadeGenero(linhasIdade())!;
  assert.equal(r.conversasDisponiveis, true);
  const h2534 = r.segmentos.find((s) => s.faixa === "25-34" && s.genero === "homens")!;
  assert.equal(h2534.gasto, 141.32); assert.equal(h2534.conversas, 26); assert.equal(h2534.custoPorConversa, 5.44); assert.equal(h2534.rotulo, "Homens de 25 a 34 anos");
  assert.equal(r.totalGasto, 325.31);
  assert.equal(r.melhor!.rotulo, "Homens de 18 a 24 anos", "R$ 3,38 por conversa");
  assert.equal(r.maisCaro!.rotulo, "Homens de 35 a 44 anos", "R$ 6,87 por conversa; 45–54 (R$ 9,21) fica de fora por pouco gasto");
  assert.deepEqual(r.faixas.map((f) => f.faixa), ["18-24", "25-34", "35-44", "45-54"]);
  assert.equal(r.faixas[1].outros!.gasto, 2.05);
  assert.equal(r.porGenero.find((g) => g.genero === "mulheres")!.conversas, 1);
});

test("região: conversas 0 com conversas na campanha = 'indisponível neste corte' (null), nunca zero; sem métrica também", () => {
  const rows = REGIAO.map(([c, spend, impressions]) => snap("ads_breakdown", "2026-11-10", { dimensao: "regiao", campaign_id: c.id, regiao: "Goiás", spend, impressions, results: 0 }));
  const r = relRegioes(rows, 66)!;
  assert.equal(r.conversasDisponiveis, false);
  assert.equal(r.itens.length, 1); assert.equal(r.itens[0].gasto, 366.54); assert.equal(r.itens[0].impressoes, 24082);
  assert.equal(r.itens[0].conversas, null); assert.equal(r.itens[0].custoPorConversa, null); assert.equal(r.itens[0].participacao, 100);
  const semMetrica = relRegioes(rows.map((x) => ({ ...x, metrics: { ...x.metrics, results: null } })), 0)!;
  assert.equal(semMetrica.conversasDisponiveis, false);
  const comMetrica = relRegioes(rows.map((x) => ({ ...x, metrics: { ...x.metrics, results: 3 } })), 9)!;
  assert.equal(comMetrica.itens[0].conversas, 9);
});

test("posicionamento: Feed/Reels/Stories/Explorar × Facebook/Instagram com gasto e participação", () => {
  const rows = POSICAO.map(([plataforma, posicao, spend]) => snap("ads_breakdown", "2026-11-10", { dimensao: "posicionamento", campaign_id: FLORESTA.id, plataforma, posicao, spend, impressions: 100, results: null }));
  const p = relPosicionamento(rows)!;
  assert.deepEqual(p.grupos.map((g) => g.grupo), ["Feed", "Reels", "Stories", "Explorar"]);
  const reels = p.grupos.find((g) => g.grupo === "Reels")!;
  assert.equal(reels.porPlataforma.Facebook, 26.23, "reels + sobreposição");
  assert.equal(reels.porPlataforma.Instagram, 90.1);
  assert.equal(p.grupos.find((g) => g.grupo === "Feed")!.porPlataforma.Facebook, 48.81);
  const total = POSICAO.reduce((t, x) => t + x[2], 0);
  assert.equal(Math.round(p.plataformas.reduce((t, x) => t + x.participacao, 0)), 100);
  assert.equal(p.plataformas.find((x) => x.plataforma === "Facebook")!.gasto, Math.round((25.92 + 0.31 + 9.54 + 48.81) * 100) / 100);
  assert.ok(total > 0); assert.equal(p.conversasDisponiveis, false);
});

test("relPublico: sem linhas = sem dados (estado vazio honesto); técnico só quando pedido", () => {
  assert.equal(relPublico([]).temDados, false);
  const segs = [snap("adset_targeting", "2026-11-17", { adset_name: "CJ1", campaign_name: FLORESTA.nome, targeting: T_CJ1 }), { ...snap("adset_targeting", "2026-11-18", { adset_name: "CJ1", campaign_name: FLORESTA.nome, targeting: T_BASE }), key: "x" }];
  segs[0].key = "x";
  const r = relPublico(segs);
  assert.equal(r.conjuntos.length, 1, "último estado por conjunto");
  assert.equal(r.conjuntos[0].idade, "18 anos ou mais", "vale o mais recente");
  assert.equal(r.tecnico, undefined);
  assert.equal(relPublico(segs, { tecnico: true }).tecnico!.length, 1);
});

// ─── Fontes (só GET, um corte por consulta) ──────────────────────────────────

test("Windsor: um corte por consulta, datas explícitas, só GET; região sem pedir conversas; filtro SHOW MAN deixa a Destrava de fora", async () => {
  const { fonte, chamadas } = windsorFalso();
  const ig = await fonte.quebras!({ contaId: CONTA, dimensao: "idade_genero", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  const rg = await fonte.quebras!({ contaId: CONTA, dimensao: "regiao", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  const ps = await fonte.quebras!({ contaId: CONTA, dimensao: "posicionamento", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  assert.equal(chamadas.length, 3);
  for (const [i, c] of chamadas.entries()) {
    assert.equal((c.init?.method ?? "GET").toUpperCase(), "GET"); assert.equal(c.init?.body, undefined);
    assert.equal(c.url.hostname, WINDSOR_HOST); assert.equal(c.url.pathname, "/facebook");
    assert.equal(c.url.searchParams.get("date_from"), "2026-11-01"); assert.equal(c.url.searchParams.get("date_to"), "2026-11-18");
    assert.equal(c.url.searchParams.get("date_preset"), null);
    const f = c.url.searchParams.get("fields")!.split(",");
    const dims = Object.values(CAMPOS_QUEBRA).flat();
    const meus = CAMPOS_QUEBRA[(["idade_genero", "regiao", "posicionamento"] as const)[i]];
    assert.deepEqual(dims.filter((d) => f.includes(d)), [...meus], "só os campos de UM corte");
  }
  assert.ok(!chamadas[1].url.searchParams.get("fields")!.includes(RES), "região não pede conversas");
  assert.equal(ig.length, 7, "Destrava fica de fora");
  assert.equal(ig.find((x) => x.idade === "25-34" && x.genero === "male")!.results, 26);
  assert.equal(rg.length, 3); assert.ok(rg.every((x) => x.results === null && x.regiao === "Goiás"));
  assert.equal(ps.length, 8); assert.ok(ps.every((x) => x.results === null));
  const seg = await fonte.segmentacoes!({ contaId: CONTA, campanhas: [], de: "2026-11-01", ate: "2026-11-18" });
  assert.deepEqual(seg.map((s) => s.adsetNome), ["CJ1 | Ilimitado R$69,90 | Floresta 3km", "BASE | Clientes cadastrados", "SEMELHANTE 1% | Clientes"]);
});

test("Windsor: campo recusado → repete o corte só com o essencial em vez de perder a seção", async () => {
  const { fonte, chamadas } = windsorFalso({ recusar: (f) => f.includes("reach") });
  const ig = await fonte.quebras!({ contaId: CONTA, dimensao: "idade_genero", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  assert.equal(chamadas.length, 2);
  assert.ok(!chamadas[1].url.searchParams.get("fields")!.includes("reach"));
  assert.equal(ig.find((x) => x.idade === "25-34" && x.genero === "male")!.results, 26);
  assert.equal(ig[0].reach, null);
});

test("Meta Graph: breakdowns um por consulta, /adsets?fields=…targeting, só GET; conversas por região ausentes = indisponível", async () => {
  const urls: URL[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    urls.push(u);
    assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
    if (u.pathname.endsWith("/adsets")) return json({ data: [{ id: "1", name: "CJ1", campaign_id: FLORESTA.id, campaign: { name: FLORESTA.nome }, effective_status: "ACTIVE", targeting: JSON.parse(T_CJ1) }] });
    return json({ data: [{ date_start: "2026-11-10", campaign_id: FLORESTA.id, campaign_name: FLORESTA.nome, age: "25-34", gender: "male", region: "Goiás", spend: "141.32", impressions: "10031", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "26" }] }] });
  }) as typeof fetch;
  const api = criarApiGraph(criarGraph({ token: "EAAB-falso-123456", fetchImpl, sleep: sem, pausaMs: 0 }));
  const q = await api.quebras!({ contaId: `act_${CONTA}`, dimensao: "idade_genero", de: "2026-11-01", ate: "2026-11-18", campanhas: [FLORESTA.id] });
  assert.equal(q[0].results, 26); assert.equal(q[0].idade, "25-34");
  assert.equal(urls[0].searchParams.get("breakdowns"), "age,gender");
  await api.quebras!({ contaId: `act_${CONTA}`, dimensao: "posicionamento", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  assert.equal(urls[1].searchParams.get("breakdowns"), "publisher_platform,platform_position");
  const s = await api.segmentacoes!({ contaId: `act_${CONTA}`, campanhas: [FLORESTA.id] });
  assert.match(urls[2].searchParams.get("fields")!, /targeting/);
  assert.equal(s[0].status, "ACTIVE");
  assert.equal(quebraDaLinhaGraph({ date_start: "2026-11-10", campaign_id: "1", region: "Goiás", spend: "5" }, "regiao")!.results, null);
  assert.equal(quebraDaLinhaGraph({ date_start: "2026-11-10", campaign_id: "1", age: "18-24", spend: "5" }, "idade_genero")!.results, 0);
});

// ─── Coleta, leitura do cliente, HTML e isolamento (banco) ───────────────────

let c1 = "", c2 = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  c1 = await mkClient("Showman Barbearia", { slug: "showman-pub", kind: "midia" });
  c2 = await mkClient("Outro Cliente", { slug: "outro-pub", kind: "midia" });
  await mkUser("pub1@cliente.com", c1); await mkUser("pub2@cliente.com", c2);
});
after(async () => { if (!skip) await closeDb(); });
const scopeDe = async (email: string, ids: string[]) => {
  const sess = await verifySessionFull(await signSession(email, process.env.SESSION_SECRET!, 3600, "client", { clientIds: ids }), process.env.SESSION_SECRET!);
  return scopeFromSession(sess, null, null, await liveAllowedCompanies(email))!;
};

test("coleta grava ads_breakdown (dia × dimensão) e adset_targeting só das campanhas filtradas; cliente vê linguagem simples e nada sensível; isolamento", { skip }, async () => {
  await salvarAnuncios(c1, { adAccountId: `act_${CONTA}`, campaignIds: [], campaignNameFilter: "SHOW MAN", usarTokenPlataforma: false, adsSource: "windsor" });
  const { fonte } = windsorFalso();
  const r = await coletarCanal((await obterCanal(c1))!, null, { hoje: "2026-11-18", dias: 18, maxMs: 60_000, fontes: ["ads"] }, null, null, { api: fonte, chave: CHAVE });
  assert.ok(r.ok, JSON.stringify(r.ads));
  assert.equal(r.linhas.ads_breakdown, 7 + 3 + 8);
  assert.equal(r.linhas.adset_targeting, 3);
  const cortes = await lerSnapshots(c1, ["ads_breakdown"], "2026-11-01", "2026-11-18", "windsor");
  assert.ok(cortes.every((x) => !String(x.metrics.campaign_name).includes("Destrava")));
  assert.ok(cortes.find((x) => x.key === `idade_genero|${FLORESTA.id}|25-34|male`));
  assert.ok(cortes.filter((x) => x.metrics.dimensao === "regiao").every((x) => x.metrics.results === null), "região guardada como indisponível");
  // idempotente
  await coletarCanal((await obterCanal(c1))!, null, { hoje: "2026-11-18", dias: 18, maxMs: 60_000, fontes: ["ads"] }, null, null, { api: fonte, chave: CHAVE });
  assert.equal((await lerSnapshots(c1, ["ads_breakdown", "adset_targeting"], "2026-11-01", "2026-11-18", "windsor")).length, 18 + 3);

  const d = await carregarCanaisDoCliente(await scopeDe("pub1@cliente.com", [c1]), "30", "2026-11-18");
  const p = d.publico!;
  assert.ok(p.temDados);
  assert.equal(p.tecnico, undefined, "cliente nunca recebe o bloco técnico");
  assert.equal(p.idadeGenero!.segmentos.find((s) => s.rotulo === "Homens de 25 a 34 anos")!.conversas, 26);
  assert.equal(p.regioes!.conversasDisponiveis, false);
  assert.deepEqual(p.conjuntos.map((c) => c.publicos.concat(c.publicosExcluidos)), [["lista de clientes da barbearia"], ["lista de clientes da barbearia"], ["semelhante 1% aos clientes", "lista de clientes da barbearia"]]);
  assert.ok(p.locaisConfigurados.some((l) => l.texto === "3 km ao redor de Floresta" && l.mapa?.startsWith("https://www.google.com/maps/")));

  const html = renderToStaticMarkup(createElement(SecaoPublico, { p, r: { um: "conversa", plural: "Conversas" } }));
  for (const proibido of [".csv", "SM_base", "120252609561060661", "120252609600000001", FLORESTA.id, CONTA, "age_min", "geo_locations", "custom_audiences", "Destrava", "Segmentação técnica"]) assert.ok(!html.includes(proibido), `HTML do cliente contém ${proibido}`);
  for (const esperado of ["Público e localização", "Quem estamos atingindo", "Homens de 18 a 24 anos", "Melhor público", "indisponível neste corte", "3 km ao redor de Floresta", "10 km ao redor de ponto definido", "ver no mapa", "lista de clientes da barbearia", "semelhante 1% aos clientes", "Onde os anúncios aparecem", "Reels"]) assert.ok(html.includes(esperado), `faltou ${esperado}`);
  assert.doesNotMatch(html, /\{&quot;|\{"/, "nada de JSON");

  // Admin: mesma seção + bloco técnico recolhível
  const adm = await carregarPublico((await obterCanal(c1))!, resolverPeriodo("30", "2026-11-18"), "2026-11-18", { tecnico: true });
  const htmlAdm = renderToStaticMarkup(createElement(SecaoPublico, { p: adm, r: { um: "conversa", plural: "Conversas" }, admin: true }));
  assert.ok(htmlAdm.includes("Segmentação técnica (só equipe)") && htmlAdm.includes("SM_base_completa.csv") && htmlAdm.includes("campo_novo_da_meta"));

  // Isolamento: outro cliente (sem canal) e escopo do outro cliente não enxergam nada do Showman
  const d2 = await carregarCanaisDoCliente(await scopeDe("pub2@cliente.com", [c2]), "30", "2026-11-18");
  assert.equal(d2.publico, null);
  assert.equal((await lerSnapshots(c2, ["ads_breakdown", "adset_targeting"], "2026-01-01", "2026-12-31")).length, 0);
  await assert.rejects(() => carregarCanaisDoCliente({ clientId: c1 } as any, "30", "2026-11-18"));
});

test("estado vazio: sem cortes no período, a seção diz que os dados chegam na próxima atualização (sem zeros inventados)", () => {
  const html = renderToStaticMarkup(createElement(SecaoPublico, { p: relPublico([]), r: { um: "conversa", plural: "Conversas" } }));
  assert.match(html, /Ainda sem dados de público/);
  assert.doesNotMatch(html, /R\$/);
});

// ─── Criativos: público por anúncio, mesmo criativo em vários públicos, "Todos os anúncios" e "Por que" ─────

test("links de anúncio: só https de fb.me/facebook.com/instagram.com; CTA em português", () => {
  for (const ok of ["https://fb.me/abc", "https://www.facebook.com/ads/preview/?x=1", "https://www.instagram.com/p/ABC/", "https://instagram.com/reel/x"]) assert.ok(linkMetaSeguro(ok), ok);
  for (const ruim of ["http://fb.me/abc", "javascript:alert(1)", "https://evil.test/fb.me", "https://instagram.com.evil.test/p", "https://user:x@facebook.com/", "https://facebook.com:8443/x", " ", null, 42]) assert.equal(linkMetaSeguro(ruim), null, String(ruim));
  assert.equal(rotuloCta("WHATSAPP_MESSAGE"), "Conversar no WhatsApp");
  assert.equal(rotuloCta("LEARN_MORE"), "Saiba mais");
  assert.equal(rotuloCta("SOMETHING_NEW"), "Something new");
});

test("resumo do público por conjunto: Floresta, lista de clientes e semelhante", () => {
  const neg = negocioDoNome("Showman Barbearia");
  assert.equal(resumoPublico(interpretarTargeting(T_CJ1, { conjunto: "CJ1 | Ilimitado R$69,90 | Floresta 3km", negocio: neg }).publico), "Homens 18–45 · 3 km de Floresta");
  assert.equal(resumoPublico(interpretarTargeting(T_BASE, { conjunto: "BASE | Clientes cadastrados", negocio: neg }).publico), "Sua lista de clientes");
  assert.equal(resumoPublico(interpretarTargeting(T_LAL, { conjunto: "SEMELHANTE 1% | Clientes", negocio: neg }).publico), "Semelhante 1% aos clientes · Homens 20–50");
  const m = resumosDosConjuntos([{ kind: "adset_targeting", date: "2026-11-18", key: "s2", metrics: { adset_name: "BASE | Clientes cadastrados", targeting: T_BASE } }], neg);
  assert.equal(m.get("s2"), "Sua lista de clientes"); assert.equal(m.get("nome:base | clientes cadastrados"), "Sua lista de clientes");
});

const linhasAd = () => ADS.map((x) => ({ kind: "ad_daily" as const, date: "2026-11-10", key: x.id, metrics: { nome: x.nome, campaign_id: x.c.id, campaign_name: x.c.nome, adset_id: x.s, adset_name: x.sn, spend: x.g, impressions: x.i, reach: Math.round(x.i * 0.7), clicks: x.k, results: x.r, title: x.title, body: x.body, cta: "WHATSAPP_MESSAGE", preview_url: `https://fb.me/v${x.id.slice(2)}`, ig_url: "javascript:alert(1)" } }));
const campDia = [FLORESTA, BASE].map((c) => ({ kind: "campaign_daily" as const, date: "2026-11-10", key: c.id, metrics: { nome: c.nome, spend: 10, impressions: 100, clicks: 1, results: 1 } }));

test("ranking: o mesmo criativo em dois públicos vira um cartão com a comparação; todos os anúncios com o 'Por que'", () => {
  const publicos = new Map([["s1", "Homens 18–45 · 3 km de Floresta"], ["s2", "Sua lista de clientes"]]);
  const rel = relAnuncios([...campDia, ...linhasAd()], resolverPeriodo("30", "2026-11-18"), [], 30, { publicos });
  const a1 = rel.criativos.ranking.filter((c) => c.nome.startsWith("A1 |"));
  assert.equal(a1.length, 1, "um cartão só para o A1");
  const v = a1[0].variantes!;
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((x) => [x.publico, x.resultados, x.custoPorResultado]), [["Homens 18–45 · 3 km de Floresta", 57, 5.13], ["Sua lista de clientes", 2, 18.63]]);
  assert.equal(a1[0].resultados, 59); assert.equal(a1[0].gasto, 329.67);
  assert.equal(v[0].porque[0], "custo por conversa 72% menor que em “Sua lista de clientes”");
  assert.equal(v[1].porque[0], "custo por conversa 3,6 vezes o de “Homens 18–45 · 3 km de Floresta”");
  assert.equal(rel.anuncios.length, 5, "todos os anúncios, um por anúncio");
  const a2 = rel.anuncios.find((x) => x.nome.startsWith("A2"))!;
  assert.equal(a2.porque.length, 1);
  assert.match(a2.porque[0], /^teve pouca entrega \(R\$\s1,18\): o Meta priorizou outro anúncio do mesmo conjunto$/);
  assert.equal(a2.titulo, "Assine e fique sempre na régua"); assert.equal(a2.cta, "Conversar no WhatsApp"); assert.equal(a2.previa, "https://fb.me/v2"); assert.equal(a2.instagram, null, "javascript: some");
  const base = rel.anuncios.find((x) => x.publico === "Sua lista de clientes")!;
  assert.ok(base.porque.some((p) => p.startsWith("público de lista de clientes é menor e mais caro")), base.porque.join(" | "));
  assert.equal(base.campanha, "SHOW MAN | BASE CLIENTES");
});

test("Windsor: criativo (conjunto, título, texto, CTA, links) em consulta própria, links sanitizados", async () => {
  const { fonte, chamadas } = windsorFalso();
  await fonte.insightsDiarios({ contaId: CONTA, nivel: "ad", de: "2026-11-01", ate: "2026-11-18", campanhas: [] });
  const infos = await fonte.anuncios({ contaId: CONTA, campanhas: [] });
  const q = chamadas.find((c) => c.url.searchParams.get("fields")!.includes("title"))!;
  for (const f of ["ad_id", "adset_id", "adset_name", "title", "body", "call_to_action_type", "ad_preview_shareable_link", "instagram_permalink_url"]) assert.ok(q.url.searchParams.get("fields")!.split(",").includes(f), f);
  const a1 = infos.find((x) => x.id === "ad1")!;
  assert.equal(a1.titulo, "Corte ilimitado por R$69,90"); assert.equal(a1.texto, BODY_A1); assert.equal(a1.cta, "WHATSAPP_MESSAGE");
  assert.equal(a1.conjuntoId, "s1"); assert.equal(a1.previa, "https://fb.me/v1prev"); assert.equal(a1.instagram, "https://www.instagram.com/p/ABC123/");
  assert.equal(infos.find((x) => x.id === "ad2")!.previa, null);
  assert.equal(infos.find((x) => x.id === "ad3")!.instagram, null);
});

test("coleta → Mapa: anúncios com público, criativo e 'Por que'; HTML de Todos os anúncios sem ids", { skip }, async () => {
  const { fonte } = windsorFalso();
  await coletarCanal((await obterCanal(c1))!, null, { hoje: "2026-11-18", dias: 18, maxMs: 60_000, fontes: ["ads"] }, null, null, { api: fonte, chave: CHAVE });
  const ad = (await lerSnapshots(c1, ["ad_daily"], "2026-11-10", "2026-11-10", "windsor")).find((x) => x.key === "ad1")!;
  assert.equal(ad.metrics.title, "Corte ilimitado por R$69,90"); assert.equal(ad.metrics.adset_id, "s1"); assert.equal(ad.metrics.preview_url, "https://fb.me/v1prev");
  const d = await carregarCanaisDoCliente(await scopeDe("pub1@cliente.com", [c1]), "30", "2026-11-18");
  const a = d.anuncios!;
  assert.equal(a.anuncios.length, 5);
  assert.ok(a.anuncios.every((x) => /^t\d+$/.test(x.id)), "ids externos trocados");
  const a1 = a.criativos.ranking.find((c) => c.variantes)!;
  assert.deepEqual(a1.variantes!.map((v) => v.publico), ["Homens 18–45 · 3 km de Floresta", "Sua lista de clientes"]);
  const html = renderToStaticMarkup(createElement(TodosAnuncios, { anuncios: a.anuncios, r: { um: "conversa", plural: "Conversas" } }));
  for (const esperado of ["Todos os anúncios", "Corte ilimitado por R$69,90", "Seu corte dura 15 dias", "Conversar no WhatsApp", "ver prévia", "ver no Instagram", "Por que:", "teve pouca entrega", "Sua lista de clientes", "Homens 18–45 · 3 km de Floresta"]) assert.ok(html.includes(esperado), `faltou ${esperado}`);
  for (const proibido of ["ad1", "ad4", "s1\"", FLORESTA.id, BASE.id, CONTA, "javascript:", "evil.test", ".csv"]) assert.ok(!html.includes(proibido), `HTML contém ${proibido}`);
});

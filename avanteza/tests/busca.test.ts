// F6b — Busca global da equipe (Ctrl/Cmd+K): permissões por papel, isolamento (cliente do Mapa nunca), texto do usuário
// sem curinga, provedor plugável do Comercial (404/503/401/tempo → "Comercial indisponível", só caminhos /comercial/) e
// buscas no banco (sem acento, limite por grupo, arquivadas/inativos fora). DB opcional: TEST_DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HAS_DB, resetSchema, closeDb, mkClient } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import type { Session } from "../src/lib/session";
import { gruposPermitidos, podeBuscar } from "../src/lib/busca/acesso";
import { acoesRapidas, paginasDoMenu } from "../src/lib/busca/paginas";
import { filtrarLocal, limparConsulta, normalizar, padraoLike } from "../src/lib/busca/texto";
import { caminhoSeguro, criarProvedorComercial, provedorComercialDoAmbiente, type ProvedorComercial } from "../src/lib/busca/comercial";
import { buscar, BuscaNegada, lerLimite } from "../src/lib/busca";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
process.env.ADMIN_EMAILS = "dono@avanteza.com.br";

const S = {
  dono: { email: "dono@avanteza.com.br", role: "admin", apps: [], name: "Dono" } as Session,
  adminForaDaLista: { email: "intruso@x.com", role: "admin", apps: [], name: "" } as Session,
  revisor: { email: "rev@avanteza.com.br", role: "reviewer", apps: [], name: "" } as Session,
  membro: { email: "m@avanteza.com.br", role: "member", apps: [], name: "" } as Session,
  membroVendas: { email: "v@avanteza.com.br", role: "member", apps: ["vendas"], name: "" } as Session,
  membroMkt: { email: "mk@avanteza.com.br", role: "member", apps: ["marketplaces"], name: "" } as Session,
  cliente: { email: "c@cliente.com", role: "client", apps: [], name: "", clientId: "x", clientIds: ["x"] } as Session,
};

/** Provedor falso do Comercial que registra as chamadas. */
function comercialFalso(r: Awaited<ReturnType<ProvedorComercial["buscar"]>>) {
  const chamadas: Array<{ q: string; limite: number; tipos: string[] }> = [];
  return { chamadas, buscar: async (q: string, limite: number, tipos: any[]) => { chamadas.push({ q, limite, tipos }); return r; } } as ProvedorComercial & { chamadas: typeof chamadas };
}
const comOk = () => comercialFalso({ ok: true, grupos: {
  oportunidades: [{ id: "oportunidades:1", titulo: "Showman — Marketplace", detalhe: "Proposta", href: "/comercial/oportunidades/1", ext: true }],
  contatos: [{ id: "contatos:9", titulo: "Ana Showman", href: "/comercial/contatos/9", ext: true }],
  contratos: [],
} });

// ─── Texto ───────────────────────────────────────────────────────────────────
test("texto: sem acento/caixa, corta em 80, e % _ \\ do usuário nunca viram curinga", () => {
  assert.equal(normalizar("  Ótica  AVANÇADA "), "otica avancada");
  assert.equal(limparConsulta("x".repeat(200)).length, 80);
  assert.equal(limparConsulta(undefined), "");
  assert.equal(padraoLike("50%_a\\b"), "%50\\%\\_a\\\\b%");
  assert.equal(lerLimite("3"), 3); assert.equal(lerLimite("999"), 10); assert.equal(lerLimite("-1"), 5); assert.equal(lerLimite("abc"), 5);
  const itens = [{ id: "a", titulo: "Financeiro da empresa", href: "/financeiro" }, { id: "b", titulo: "Lançamentos", detalhe: "Financeiro", href: "/l" }];
  assert.deepEqual(filtrarLocal(itens, "financ").map((i) => i.id), ["a", "b"], "começo do título vem antes");
  assert.deepEqual(filtrarLocal(itens, "lanc fin").map((i) => i.id), ["b"], "todas as palavras precisam casar");
});

// ─── Papéis ──────────────────────────────────────────────────────────────────
test("permissões: cliente do Mapa e sessão inválida não buscam; cada papel só vê os grupos dele", () => {
  assert.equal(podeBuscar(null), false);
  assert.equal(podeBuscar(S.cliente), false);
  assert.equal(podeBuscar(S.adminForaDaLista), false, "admin fora de ADMIN_EMAILS não é sessão válida");
  const g = (s: Session) => [...gruposPermitidos(s)].sort();
  assert.deepEqual(g(S.dono), ["acoes", "aprovacoes", "clientes", "contatos", "contratos", "oportunidades"]);
  assert.deepEqual(g(S.revisor), ["acoes", "aprovacoes", "clientes"], "revisor: lê Clientes e Motor, sem Comercial");
  assert.deepEqual(g(S.membro), ["acoes", "aprovacoes"], "membro sem apps: só o Motor");
  assert.deepEqual(g(S.membroVendas), ["acoes", "aprovacoes", "contatos", "contratos", "oportunidades"]);
  assert.deepEqual(g(S.membroMkt), ["acoes", "aprovacoes", "clientes"]);
  assert.deepEqual(g(S.cliente), []);
});

test("páginas do menu na paleta: Pessoal do Financeiro só para o dono; membro só os apps liberados; Marketing aponta para /marketing", () => {
  const hrefs = (s: Session) => paginasDoMenu(s).map((p) => p.href);
  assert.ok(hrefs(S.dono).includes("/financeiro/pessoal"));
  assert.ok(hrefs(S.dono).includes("/marketing#anuncios") && hrefs(S.dono).includes("/marketing#canais"));
  assert.ok(!hrefs(S.dono).some((h) => h.startsWith("/dashboards#")), "Anúncios/Canais saíram das âncoras de /dashboards");
  assert.ok(!hrefs(S.revisor).includes("/financeiro/pessoal"), "revisor nunca vê o Pessoal");
  assert.ok(hrefs(S.revisor).includes("/financeiro"), "revisor lê o Financeiro da empresa");
  for (const h of ["/financeiro", "/financeiro/pessoal", "/clientes", "/usuarios", "/dashboards"]) assert.ok(!hrefs(S.membro).includes(h), `membro sem apps não vê ${h}`);
  assert.ok(hrefs(S.membro).includes("/operacoes"));
  assert.ok(hrefs(S.membroVendas).some((h) => h.startsWith("/comercial/")), "membro com vendas vê o Comercial");
  assert.deepEqual(paginasDoMenu(S.cliente), []);
  assert.deepEqual(paginasDoMenu(null), []);
});

test("ações rápidas: revisor não tem nenhuma (só lê); membro só importa conversa; dono tem as três", () => {
  const ids = (s: Session) => acoesRapidas(s).map((a) => a.id);
  assert.deepEqual(ids(S.dono), ["rapida:nova-acao", "rapida:simular-contrato", "rapida:importar-conversa"]);
  assert.deepEqual(ids(S.revisor), []);
  assert.deepEqual(ids(S.membro), ["rapida:importar-conversa"]);
  assert.deepEqual(ids(S.cliente), []);
  const nova = acoesRapidas(S.dono)[0];
  assert.equal(nova.pedeCliente, true); assert.match(nova.href, /^\/clientes\/\{cliente\}\?aba=plano#nova-acao$/);
});

// ─── Orquestração (sem banco: só grupos do Comercial) ────────────────────────
test("buscar: cliente do Mapa é recusado; menos de 2 caracteres não consulta nada", async () => {
  await assert.rejects(buscar(S.cliente, "showman", { comercial: comOk() }), BuscaNegada);
  await assert.rejects(buscar(null, "showman"), BuscaNegada);
  const p = comOk();
  const r = await buscar(S.membroVendas, " s ", { comercial: p, grupos: ["oportunidades"] });
  assert.deepEqual(r.grupos, []); assert.equal(p.chamadas.length, 0);
});

test("buscar: revisor e membro sem vendas nunca chamam o Comercial; membro com vendas recebe os grupos dele", async () => {
  for (const s of [S.revisor, S.membro, S.membroMkt]) {
    const p = comOk();
    const r = await buscar(s, "showman", { comercial: p, grupos: ["oportunidades", "contatos", "contratos"] });
    assert.equal(p.chamadas.length, 0, `${s.email} não consulta o Comercial`);
    assert.deepEqual(r.grupos, []);
  }
  const p = comOk();
  const r = await buscar(S.membroVendas, "Showman", { comercial: p, grupos: ["oportunidades", "contatos", "contratos", "clientes"] });
  assert.deepEqual(p.chamadas, [{ q: "showman", limite: 5, tipos: ["oportunidades", "contatos", "contratos"] }]);
  assert.deepEqual(r.grupos.map((g) => g.id), ["oportunidades", "contatos"], "grupo vazio some; clientes não é do membro de vendas");
  assert.ok(r.grupos.every((g) => g.itens.every((i) => i.ext && i.href.startsWith("/comercial/"))));
});

test("buscar: Comercial fora do ar vira aviso e não derruba a busca", async () => {
  const r = await buscar(S.membroVendas, "showman", { comercial: comercialFalso({ ok: false, motivo: "indisponivel" }), grupos: ["oportunidades"] });
  assert.deepEqual(r.grupos, []);
  assert.equal(r.avisos.length, 1); assert.equal(r.avisos[0].grupo, "comercial"); assert.match(r.avisos[0].texto, /Comercial indisponível/);
  const lanca = { buscar: async () => { throw new Error("boom"); } } as ProvedorComercial;
  const r2 = await buscar(S.membroVendas, "showman", { comercial: lanca, grupos: ["contatos"] });
  assert.equal(r2.avisos[0].grupo, "comercial");
});

// ─── Provedor do Comercial ───────────────────────────────────────────────────
test("Comercial: GET com Bearer na rota de serviço; 404/503/401/formato/tempo viram indisponível; só caminhos /comercial/", async () => {
  const pedidos: Array<{ url: string; init: RequestInit }> = [];
  const resp = (status: number, corpo: unknown) => async (url: any, init: any) => { pedidos.push({ url: String(url), init }); return new Response(JSON.stringify(corpo), { status }); };
  const prov = (f: typeof fetch, timeoutMs?: number) => criarProvedorComercial({ baseUrl: "https://vend.test/", chave: "CHAVE-SECRETA-123", fetchImpl: f, timeoutMs });

  const ok = await prov(resp(200, {
    oportunidades: [
      { id: 1, titulo: "Boa", detalhe: "Proposta", caminho: "/comercial/oportunidades/1" },
      { id: 2, titulo: "Fora", caminho: "https://evil.test/x" },
      { id: 3, titulo: "Barra dupla", caminho: "//evil.test" },
      { id: 4, titulo: "Sobe", caminho: "/comercial/../api/x" },
      { id: 5, titulo: "Outra zona", caminho: "/financeiro" },
    ],
    contatos: [{ id: "c1", titulo: "Ana", caminho: "/comercial/contatos/c1" }],
  }) as any).buscar("ana", 5, ["oportunidades", "contatos", "contratos"]);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.grupos.oportunidades.map((i) => i.titulo), ["Boa"]);
    assert.equal(ok.grupos.contatos[0].href, "/comercial/contatos/c1");
    assert.deepEqual(ok.grupos.contratos, []);
  }
  const u = new URL(pedidos[0].url);
  assert.equal(u.origin + u.pathname, "https://vend.test/api/integracoes/avanteza/busca");
  assert.equal(u.searchParams.get("q"), "ana"); assert.equal(u.searchParams.get("limite"), "5"); assert.equal(u.searchParams.get("tipos"), "oportunidades,contatos,contratos");
  assert.equal((pedidos[0].init.headers as any).Authorization, "Bearer CHAVE-SECRETA-123");
  assert.equal(pedidos[0].init.method, "GET");
  assert.ok(!pedidos[0].url.includes("CHAVE"), "chave nunca na URL");

  for (const [st, motivo] of [[404, "indisponivel"], [500, "indisponivel"], [503, "nao-configurado"], [401, "nao-autorizado"]] as const) {
    const r = await prov(resp(st, { erro: "x" }) as any).buscar("ana", 5, ["contatos"]);
    assert.deepEqual(r, { ok: false, motivo }, `HTTP ${st}`);
  }
  assert.deepEqual(await prov(resp(200, { contatos: "lixo" }) as any).buscar("ana", 5, ["contatos"]), { ok: false, motivo: "formato" });
  const lento = (async (_u: any, init: any) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))) as any;
  assert.deepEqual(await prov(lento, 20).buscar("ana", 5, ["contatos"]), { ok: false, motivo: "timeout" });

  let chamou = false;
  const semChave = provedorComercialDoAmbiente({ VENDEDORIA_URL: "https://vend.test" });
  const g = globalThis.fetch; globalThis.fetch = (async () => { chamou = true; return new Response("{}"); }) as any;
  try { assert.deepEqual(await semChave.buscar("ana", 5, ["contatos"]), { ok: false, motivo: "nao-configurado" }); } finally { globalThis.fetch = g; }
  assert.equal(chamou, false, "sem AVANTEZA_CRM_KEY não chama a rede");
  assert.ok(caminhoSeguro("/comercial/contratos/abc?aba=1#x")); assert.ok(!caminhoSeguro("/comercial\\..\\x")); assert.ok(!caminhoSeguro("javascript:alert(1)"));
});

test("rota /api/busca e a casca: sessão obrigatória, cliente recusado, sem cache; lupa e Ctrl+K na casca da equipe", () => {
  const rota = readFileSync(new URL("../src/app/api/busca/route.ts", import.meta.url), "utf8");
  assert.match(rota, /currentSession\(\)/); assert.match(rota, /BuscaNegada[\s\S]*401/); assert.match(rota, /no-store/);
  assert.doesNotMatch(rota, /export async function (POST|PUT|PATCH|DELETE)/, "só leitura");
  const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mw, /api\\\/busca/, "a rota não está na lista pública do middleware");
  const casca = readFileSync(new URL("../src/components/shell/EquipeShell.tsx", import.meta.url), "utf8");
  assert.match(casca, /BuscaGlobal/);
  const paleta = readFileSync(new URL("../src/components/shell/BuscaGlobal.tsx", import.meta.url), "utf8");
  for (const r of [/role="dialog"/, /aria-modal="true"/, /role="combobox"/, /role="listbox"/, /role="option"/, /aria-activedescendant/, /ArrowDown/, /ArrowUp/, /"Enter"/, /"Escape"/, /metaKey/, /ctrlKey/, /DEBOUNCE_MS/, /MIN_CARACTERES/])
    assert.match(paleta, r);
  // O Mapa do cliente não usa a casca da equipe (e, portanto, nunca tem a busca).
  const mapaLayout = readFileSync(new URL("../src/app/mapa/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mapaLayout, /EquipeShell|BuscaGlobal/);
});

// ─── Banco local (clientes, ações do Motor, aprovações) ──────────────────────
let A = "", INATIVO = "", B = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  A = await mkClient("Ótica Avançada", { slug: "otica-avancada", kind: "midia" });
  B = await mkClient("Showman Barbearia", { slug: "showman" });
  INATIVO = await mkClient("Ótica Antiga", { slug: "otica-antiga", active: false });
  for (let i = 1; i <= 7; i++) await rawQuery("insert into avanteza.plan_actions (client_id, title, due_date) values ($1,$2,'2026-11-20')", [A, `Relatório semanal ${i}`]);
  await rawQuery("insert into avanteza.plan_actions (client_id, title, archived_at) values ($1,'Relatório arquivado', now())", [A]);
  await rawQuery("insert into avanteza.plan_actions (client_id, title) values ($1,'Relatório do cliente inativo')", [INATIVO]);
  await rawQuery("insert into avanteza.plan_actions (client_id, title) values ($1,'Campanha 50% off')", [B]);
  await rawQuery("insert into avanteza.aprovacoes (client_id, titulo, criado_por) values ($1,'Criativo Black Friday','ana')", [B]);
  await rawQuery("insert into avanteza.aprovacoes (client_id, titulo, criado_por, status) values ($1,'Criativo cancelado','ana','cancelada')", [B]);
});
after(async () => { if (!skip) await closeDb(); });

test("banco: clientes sem acento e sem caixa; ativos primeiro; inativo marcado", { skip }, async () => {
  const r = await buscar(S.dono, "OTICA", { grupos: ["clientes"] });
  const cli = r.grupos.find((g) => g.id === "clientes")!;
  assert.deepEqual(cli.itens.map((i) => i.titulo), ["Ótica Avançada", "Ótica Antiga"]);
  assert.match(cli.itens[1].detalhe!, /inativo/);
  assert.equal(cli.itens[0].href, `/clientes/${A}`);
  const r2 = await buscar(S.dono, "avancada");
  assert.equal(r2.grupos.find((g) => g.id === "clientes")!.itens[0].id, A);
});

test("banco: ações do Motor com limite por grupo, sem arquivadas nem de cliente inativo; link conforme o papel", { skip }, async () => {
  const r = await buscar(S.dono, "relatorio", { grupos: ["acoes"] });
  const ac = r.grupos.find((g) => g.id === "acoes")!;
  assert.equal(ac.itens.length, 5, "limite padrão por grupo");
  assert.ok(ac.itens.every((i) => /^Relatório semanal/.test(i.titulo)), "arquivada e de cliente inativo ficam fora");
  assert.equal(ac.itens[0].href, `/clientes/${A}?aba=entregas`);
  assert.match(ac.itens[0].detalhe!, /Ótica Avançada · Planejada · (prazo|atrasada desde) 20\/11/);
  const r3 = await buscar(S.dono, "relatorio", { grupos: ["acoes"], limite: 10 });
  assert.equal(r3.grupos[0].itens.length, 7);
  const m = await buscar(S.membro, "relatorio");
  assert.ok(!m.grupos.some((g) => g.id === "clientes"));
  assert.ok(m.grupos.find((g) => g.id === "acoes")!.itens.every((i) => i.href === "/operacoes"), "membro sem a ficha do cliente vai para a fila");
});

test("banco: % e _ do usuário são literais (nada de 'traz tudo')", { skip }, async () => {
  const r = await buscar(S.dono, "%%", { grupos: ["clientes", "acoes", "aprovacoes"] });
  assert.deepEqual(r.grupos, []);
  const r2 = await buscar(S.dono, "50%", { grupos: ["acoes"] });
  assert.deepEqual(r2.grupos[0].itens.map((i) => i.titulo), ["Campanha 50% off"]);
  const r3 = await buscar(S.dono, "__", { grupos: ["clientes", "acoes"] });
  assert.deepEqual(r3.grupos, []);
});

test("banco: aprovações por título ou cliente, sem as canceladas; revisor lê, cliente nunca", { skip }, async () => {
  const r = await buscar(S.revisor, "showman", { grupos: ["aprovacoes"] });
  assert.deepEqual(r.grupos[0].itens.map((i) => i.titulo), ["Criativo Black Friday"]);
  assert.match(r.grupos[0].itens[0].href, /^\/operacoes\/aprovacoes\/[0-9a-f-]{36}$/);
  await assert.rejects(buscar({ ...S.cliente, clientId: B, clientIds: [B] }, "showman"), BuscaNegada);
});

test("banco: a resposta nunca leva contato, token ou ID de conta", { skip }, async () => {
  await rawQuery("update avanteza.clients set contact_email = 'segredo@cliente.com', contact_phone = '11999990000' where id = $1", [B]);
  await rawQuery("insert into avanteza.client_channels (client_id, ad_account_id, token_enc, token_hint, status) values ($1,'act_123456','TOKEN-CIFRADO','wxyz','ativo')", [B]);
  const r = JSON.stringify(await buscar(S.dono, "showman", { comercial: comOk() }));
  for (const s of ["segredo@cliente.com", "11999990000", "TOKEN-CIFRADO", "wxyz", "act_123456"]) assert.ok(!r.includes(s), `não vaza ${s}`);
});

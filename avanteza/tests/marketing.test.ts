// F6b — Departamento Marketing: dedup das contas de anúncios dos clientes considerando também a fonte Windsor (conta sem act_,
// snapshots só da fonte configurada, mesma conta em dois clientes somada uma vez), resumo de canais por cliente (sem token
// nem ID de conta) e o menu Marketing apontando para /marketing. DB opcional: TEST_DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HAS_DB, resetSchema, closeDb, mkClient } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { gravarSnapshots } from "../src/lib/channels/store";
import { canaisPorCliente, carregarCanaisClientes, classificar, contaNormalizada, estadoFonte } from "../src/lib/channels/dashboards";
import { resolverPeriodo } from "../src/lib/dashboards/periodo";
import { departamentos } from "../src/lib/shell/departamentos";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const metaCom = (...ids: string[]): any => ({ estado: "ok", dados: { contas: ids.map((id) => ({ id, ok: true })) } });

test("classificar: conta do Windsor (sem act_) que já está na Meta da agência não é somada de novo", () => {
  assert.equal(contaNormalizada(" act_605261696580859 "), "605261696580859");
  assert.equal(classificar("605261696580859", metaCom("act_605261696580859")), "ja-na-agencia");
  assert.equal(classificar("act_605261696580859", metaCom("605261696580859")), "ja-na-agencia");
  assert.equal(classificar("ACT_111", metaCom("act_222")), "somada");
  assert.equal(classificar("111", { estado: "indisponivel", codigo: "rede", motivo: "x" }), "incerto");
  assert.equal(classificar("111", { estado: "nao-configurado", motivo: "x" }), "somada");
});

test("estadoFonte: cada fonte independente; erro, conectando, conectado, desconectado e sem fonte", () => {
  assert.deepEqual(estadoFonte("windsor", "ativo", "2026-11-16T10:00:00Z", false), { fonte: "windsor", estado: "conectado", atualizadoEm: "2026-11-16T10:00:00Z" });
  assert.equal(estadoFonte("meta", "pendente", null, false).estado, "conectando");
  assert.equal(estadoFonte("meta", "ativo", "2026-11-16T10:00:00Z", true).estado, "erro");
  assert.equal(estadoFonte("meta", "desconectado", null, false).estado, "desconectado");
  assert.equal(estadoFonte("none", "ativo", null, false).estado, "sem-fonte");
  assert.equal(estadoFonte(null, null, null, false).estado, "sem-fonte");
});

test("menu Marketing: Anúncios e Canais em /marketing (não mais nas âncoras de /dashboards); página reaproveita as seções", () => {
  const mk = departamentos().find((d) => d.id === "marketing")!;
  assert.equal(mk.modulos.find((m) => m.id === "anuncios")!.href, "/marketing#anuncios");
  assert.equal(mk.modulos.find((m) => m.id === "canais")!.href, "/marketing#canais");
  const pg = readFileSync(new URL("../src/app/(equipe)/marketing/page.tsx", import.meta.url), "utf8");
  for (const r of [/id="anuncios"/, /id="canais"/, /id="conteudo"/, /SecaoMarketing/, /carregarCanaisClientes/, /canaisPorCliente/, /podeVerDashboards/])
    assert.match(pg, r);
  const dash = readFileSync(new URL("../src/app/dashboards/page.tsx", import.meta.url), "utf8");
  assert.match(dash, /ResumoMarketing/, "/dashboards mantém um resumo com link para Marketing");
  const sec = readFileSync(new URL("../src/components/dashboards/Secoes.tsx", import.meta.url), "utf8");
  assert.match(sec, /href="\/marketing#anuncios"/);
});

let SH = "", WIN = "", DUP = "", TROCA = "", SEMCANAL = "";
before(async () => {
  if (skip) return;
  await resetSchema();
  SH = await mkClient("Showman", { slug: "showman", kind: "midia" });
  WIN = await mkClient("Cliente Windsor", { slug: "cli-windsor", kind: "midia" });
  DUP = await mkClient("Mesma Conta", { slug: "mesma-conta", kind: "midia" });
  TROCA = await mkClient("Trocou Fonte", { slug: "trocou", kind: "midia" });
  SEMCANAL = await mkClient("Sem Canal", { slug: "sem-canal", kind: "midia" });
  await mkClient("Só Marketplace", { slug: "so-mkt", kind: "marketplace" });
  const canal = (c: string, conta: string, fonte: string, extra = "") =>
    rawQuery(`insert into avanteza.client_channels (client_id, ad_account_id, ads_source, status, last_sync_at, token_enc, token_hint, windsor_key_enc ${extra ? ", ig_source, ig_user_id, ig_last_error" : ""})
              values ($1,$2,$3,'ativo',now(),'TOKEN-CIFRADO','h1h2','CHAVE-WINDSOR-CIFRADA' ${extra ? ", 'meta', '17841000000000', 'falhou'" : ""})`, [c, conta, fonte]);
  await canal(SH, "act_605261696580859", "meta");
  await canal(WIN, "777000111", "windsor", "ig");
  await canal(DUP, "act_777000111", "meta"); // mesma conta do Cliente Windsor, por outra fonte
  await canal(TROCA, "888000222", "windsor");
  const camp = (v: number) => [{ kind: "campaign_daily" as const, date: "2026-11-15", key: "C1", metrics: { nome: "C1", spend: v, results: 2 } }];
  await gravarSnapshots(SH, camp(100), "meta");
  await gravarSnapshots(WIN, camp(50), "windsor");
  await gravarSnapshots(DUP, camp(50), "meta");
  await gravarSnapshots(TROCA, camp(30), "windsor");
  await gravarSnapshots(TROCA, camp(999), "meta"); // histórico da fonte antiga: não soma com a atual
});
after(async () => { if (!skip) await closeDb(); });

test("Dashboards/Marketing: contas Windsor entram no subtotal sem dupla contagem", { skip }, async () => {
  const per = resolverPeriodo("30", "2026-11-16").atual;
  const d = await carregarCanaisClientes(per, metaCom("act_605261696580859"));
  const por = Object.fromEntries(d.linhas.map((l) => [l.cliente, l]));
  assert.equal(por["Showman"].situacao, "ja-na-agencia");
  assert.equal(por["Cliente Windsor"].fonte, "windsor");
  assert.equal(por["Trocou Fonte"].gasto, 30, "só a fonte configurada (Windsor), nunca Meta + Windsor");
  assert.equal(por["Cliente Windsor"].gasto + por["Mesma Conta"].gasto, 50, "mesma conta (act_ ou não) em dois clientes: soma uma vez");
  assert.equal(d.gastoSomado, 80, "50 da conta compartilhada + 30; Showman já está na agência");
  // A conta do Windsor também está na Meta da agência (com act_): sai do subtotal.
  const d2 = await carregarCanaisClientes(per, metaCom("act_605261696580859", "act_777000111"));
  assert.equal(d2.linhas.find((l) => l.cliente === "Cliente Windsor")!.situacao, "ja-na-agencia");
  assert.equal(d2.gastoSomado, 30);
});

test("canais por cliente: fonte e estado de cada um, clientes de mídia sem canal aparecem, nada de token/ID/erro", { skip }, async () => {
  const lista = await canaisPorCliente();
  const por = Object.fromEntries(lista.map((c) => [c.cliente, c]));
  assert.ok(!por["Só Marketplace"], "cliente só de marketplace sem canal não entra");
  assert.equal(por["Sem Canal"].anuncios.estado, "sem-fonte");
  assert.equal(por["Cliente Windsor"].anuncios.fonte, "windsor");
  assert.equal(por["Cliente Windsor"].anuncios.estado, "conectado");
  assert.equal(por["Cliente Windsor"].instagram.estado, "erro");
  assert.equal(lista[0].cliente, "Cliente Windsor", "problemas primeiro");
  const txt = JSON.stringify(lista);
  for (const s of ["TOKEN-CIFRADO", "h1h2", "CHAVE-WINDSOR", "777000111", "17841000000000", "falhou", "act_"]) assert.ok(!txt.includes(s), `não vaza ${s}`);
});

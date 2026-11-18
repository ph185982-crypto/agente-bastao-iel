// E-mail de boas-vindas do Mapa: link, login, passo a passo, cópia ao dono e NUNCA a senha. Resend real nunca é chamado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assuntoBoasVindas, emailBoasVindasHtml, enviarBoasVindas } from "../src/lib/mapa/boas-vindas";

process.env.APP_URL = "https://app.avanteza.com.br";

test("conteúdo: link, login, troca de senha, menu e sem senha", () => {
  const html = emailBoasVindasHtml({ cliente: "Showman", email: "cliente@exemplo.com", nome: "Paulo Henrique", limiteRecarga: 400 });
  assert.match(html, /https:\/\/app\.avanteza\.com\.br/);
  assert.match(html, /cliente@exemplo\.com/);
  assert.match(html, /Olá, Paulo!/);
  assert.match(html, /<strong>Conta<\/strong>/);
  for (const item of ["Início", "Plano", "Canais", "Reuniões", "Para aprovar"]) assert.ok(html.includes(item), item);
  assert.match(html, /Aviso de recarga/);
  assert.match(html, /R\$ 400,00/);
  assert.match(html, /enviada pela equipe Avanteza por WhatsApp/);
  assert.equal(assuntoBoasVindas("Showman"), "Bem-vindo à Avanteza, Showman: seu acesso ao painel");
});

test("sem limite de recarga não fala de recarga; escapa HTML", () => {
  const html = emailBoasVindasHtml({ cliente: "<b>X</b>", email: "a@b.com" });
  assert.doesNotMatch(html, /Aviso de recarga/);
  assert.doesNotMatch(html, /<b>X<\/b>/);
  assert.match(html, /Olá!/);
});

test("envio: cliente no 'para', dono em cópia, assinatura sem senha", async () => {
  const enviados: any[] = [];
  const ok = await enviarBoasVindas({ cliente: "Showman", email: "cliente@exemplo.com" }, { enviar: async (m) => { enviados.push(m); return true; }, copia: ["dono@exemplo.com"] });
  assert.equal(ok, true);
  assert.deepEqual(enviados[0].to, ["cliente@exemplo.com"]);
  assert.deepEqual(enviados[0].cc, ["dono@exemplo.com"]);
  assert.doesNotMatch(enviados[0].html, /senha:\s*\S{8,}/i);
});

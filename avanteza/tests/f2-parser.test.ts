// F2: leitor do "Exportar conversa" do WhatsApp (amostras sintéticas realistas de Android e iOS), zip, blocos de dias,
// casamento de ação por similaridade e funções puras do onboarding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhatsappTxt, hashMensagem, blocosPorDias, chaveConversa, tituloDoArquivo } from "../src/lib/capturas/whatsapp-export";
import { listarZip, extrairZip, ehZip } from "../src/lib/capturas/zip";
import { lerArquivo } from "../src/lib/capturas/importar";
import { casarAcao, similaridade, type AcaoAberta } from "../src/lib/motor/pendencias-api";
import { cnpjValido, nomeNormalizado, primeiroVencimento, slugify, soDigitos } from "../src/lib/eventos/contrato-assinado";
import { atrasoBackoffMs, validarEvento } from "../src/lib/eventos/barramento";
import { ANDROID, IOS, montarZip as zip } from "./_whatsapp-amostras";

test("Android: data dd/mm/aaaa e dd/mm/aa, multilinha, sistema, mídia oculta, anexo, editada e apagada", () => {
  const c = parseWhatsappTxt(ANDROID, "Conversa do WhatsApp com Ladies x Avanteza.txt");
  assert.equal(c.formato, "android");
  assert.equal(c.titulo, "Ladies x Avanteza");
  assert.equal(c.grupo, true);
  const uteis = c.mensagens.filter((m) => m.tipo !== "sistema");
  assert.deepEqual(c.participantes, ["Pedro Avanteza", "Carla Ladies", "+55 62 98888-7777"]);
  assert.equal(c.mensagens.filter((m) => m.tipo === "sistema").length, 4, "criptografia, criou, adicionou, apagada");
  assert.equal(uteis[0].texto, "Bom dia, Carla! Para começar o Mercado Livre preciso de:\n1) planilha de custos\n2) acesso à conta");
  assert.equal(uteis[0].data, "2026-11-10");
  assert.equal(uteis[0].hora, "09:15:00");
  assert.equal(uteis.find((m) => m.tipo === "midia")?.autor, "Carla Ladies");
  const audio = uteis.find((m) => m.tipo === "anexo")!;
  assert.equal(audio.anexo, "PTT-20261111-WA0003.opus");
  const editada = uteis.find((m) => m.autor?.startsWith("+55"))!;
  assert.equal(editada.data, "2026-11-11");
  assert.equal(editada.texto, "Combinado, vou subir as fotos novas na quarta");
});

test("iOS: [dd/mm/aaaa, hh:mm:ss], caractere invisível, sistema assinado pelo grupo, anexado, ocultada", () => {
  const c = parseWhatsappTxt(IOS, "WhatsApp Chat - Showman Barbearia.zip");
  assert.equal(c.formato, "ios");
  assert.equal(c.titulo, "Showman Barbearia");
  assert.equal(c.grupo, true);
  assert.ok(!c.participantes.includes("Showman Barbearia"), "o nome do grupo não é participante");
  const uteis = c.mensagens.filter((m) => m.tipo !== "sistema");
  assert.equal(uteis[0].texto, "Fala Pedro, sobre o tráfego:\nquero focar em corte + barba\ne aumentar a verba em 20%");
  assert.equal(uteis[1].anexo, "00000007-AUDIO-2026-11-12-08-06-02.opus");
  assert.equal(uteis[2].tipo, "midia");
  assert.equal(uteis[2].data, "2026-11-12");
  assert.equal(c.mensagens.find((m) => /apagou/.test(m.texto))?.tipo, "sistema");
  const pdf = uteis.find((m) => m.anexo?.endsWith(".pdf"))!;
  assert.equal(pdf.texto, "", "linha de descrição do PDF não vira texto");
  // sem nome de arquivo: título vem do autor das mensagens do sistema (nome do grupo)
  assert.equal(parseWhatsappTxt(IOS, "_chat.txt").titulo, "Showman Barbearia");
});

test("conversa individual, linhas soltas antes da 1ª mensagem e texto que não é do WhatsApp", () => {
  const c = parseWhatsappTxt("lixo no topo\n05/01/2026 10:00 - Maria: oi\n05/01/2026 10:01 - Pedro: olá, tudo bem?", "Conversa do WhatsApp com Maria.txt");
  assert.equal(c.grupo, false);
  assert.equal(c.linhasIgnoradas, 1);
  assert.equal(c.mensagens.length, 2);
  assert.equal(parseWhatsappTxt("só um texto qualquer\nsem datas").mensagens.length, 0);
  assert.equal(parseWhatsappTxt("32/13/2026 10:00 - X: data impossível").mensagens.length, 0);
  assert.equal(tituloDoArquivo("Conversa do WhatsApp com Ladies (1).txt"), "Ladies");
});

test("hash por (autor, data, texto) e chave da conversa estáveis; blocos por dias", () => {
  const a = parseWhatsappTxt(ANDROID, "x.txt").mensagens;
  const b = parseWhatsappTxt(ANDROID.replace(/\n/g, "\r\n"), "x.txt").mensagens;
  assert.deepEqual(a.map(hashMensagem), b.map(hashMensagem), "CRLF não muda o hash");
  assert.notEqual(hashMensagem(a[3]), hashMensagem({ ...a[3], autor: "Outro" }));
  assert.equal(chaveConversa({ titulo: "Ladies x Avanteza", participantes: [] }), chaveConversa({ titulo: "ladies X avanteza ", participantes: ["z"] }));
  assert.equal(chaveConversa({ titulo: null, participantes: ["B", "a"] }), chaveConversa({ titulo: null, participantes: ["A", "b"] }));
  const blocos = blocosPorDias(a);
  assert.equal(blocos.length, 2, "10–11/11 num bloco; 20/11 em outro (passou de 7 dias)");
  assert.equal(blocos[0].de, "2026-11-10");
  assert.equal(blocos[0].ate, "2026-11-11");
  assert.match(blocos[0].texto, /\[10\/11 09:15\] Pedro Avanteza: Bom dia/);
  assert.match(blocos[0].texto, /\[mídia não exportada\]/);
  assert.doesNotMatch(blocos[0].texto, /criptografia/);
  const grande = Array.from({ length: 400 }, (_, i) => `15/11/2026 10:${String(i % 60).padStart(2, "0")} - P: ${"x".repeat(60)} ${i}`).join("\n");
  assert.ok(blocosPorDias(parseWhatsappTxt(grande).mensagens, { maxChars: 3000 }).length > 1, "dia muito longo também é quebrado");
});



test("zip: lê _chat.txt e áudios; recusa zip quebrado, sem conversa e arquivo grande", () => {
  const z = zip({ "_chat.txt": IOS, "00000007-AUDIO-2026-11-12-08-06-02.opus": Buffer.from("OggS-falso"), "00000009-tabela.pdf": "pdf" });
  assert.ok(ehZip(z));
  const ents = listarZip(z);
  assert.equal(ents.length, 3);
  assert.equal(extrairZip(z, ents[1], 1000).toString(), "OggS-falso");
  assert.throws(() => extrairZip(z, ents[0], 10), /grande demais/);
  const arq = lerArquivo(z, "WhatsApp Chat - Showman Barbearia.zip");
  assert.equal(arq.conversa.titulo, "Showman Barbearia");
  assert.equal(arq.audios.size, 1);
  assert.throws(() => lerArquivo(zip({ "foto.jpg": "x" }), "a.zip"), /não tem a conversa/);
  assert.throws(() => lerArquivo(Buffer.concat([z.subarray(0, 40), Buffer.alloc(30)]), "a.zip"), /inválido|corrompid/);
  assert.throws(() => lerArquivo(Buffer.alloc(5 * 1024 * 1024, 65), "a.txt"), /4 MB/);
  assert.throws(() => lerArquivo(Buffer.from("olá"), "a.txt"), /Não encontrei mensagens/);
});

const A = (id: string, titulo: string): AcaoAberta => ({ id, titulo, prazo: null, status: "planejada", responsavel: "avanteza", atrasada: false });

test("concluir por similaridade: ação clara, ambígua (opções) e nenhuma", () => {
  const acoes = [A("1", "Estruturar campanhas de ADS"), A("2", "Otimizar campanhas de ADS"), A("3", "Enviar custos e margens por produto"), A("4", "Reunião de kickoff e alinhamento de metas")];
  assert.deepEqual(casarAcao("enviei os custos e margens", acoes), { acao: acoes[2] });
  assert.deepEqual(casarAcao("o kickoff", acoes), { acao: acoes[3] });
  const amb = casarAcao("campanhas de ads", acoes);
  assert.ok("opcoes" in amb && amb.opcoes.length === 2);
  assert.deepEqual(casarAcao("comprar pão", acoes), { nenhuma: true });
  assert.ok(similaridade("otimizei as campanhas de ADS", "Otimizar campanhas de ADS") > similaridade("otimizei as campanhas de ADS", "Estruturar campanhas de ADS"));
});

test("onboarding: CNPJ, nome normalizado, slug, 1º vencimento; eventos: validação e backoff", () => {
  assert.equal(soDigitos("12.345.678/0001-95"), "12345678000195");
  assert.ok(cnpjValido("11222333000181"));
  assert.ok(!cnpjValido("11222333000182"));
  assert.ok(!cnpjValido("11111111111111"));
  assert.equal(nomeNormalizado("Ladies Moda Comércio LTDA - ME"), "ladies moda");
  assert.equal(nomeNormalizado("Showman S/A"), nomeNormalizado("SHOWMAN"));
  assert.equal(slugify("Barbearia Showman & Cia"), "barbearia-showman-cia");
  assert.equal(primeiroVencimento("2026-11-16", 10), "2026-12-10");
  assert.equal(primeiroVencimento("2026-11-05", 10), "2026-11-10");
  assert.equal(primeiroVencimento("2026-01-31", 31), "2026-01-31");
  assert.equal(primeiroVencimento("2026-02-01", 31), "2026-02-28");
  assert.equal(primeiroVencimento("2026-12-20", 5), "2027-01-05");
  assert.equal(primeiroVencimento("2026-11-16", null), "2026-11-16");
  assert.equal(atrasoBackoffMs(1), 60_000);
  assert.ok(atrasoBackoffMs(3) < atrasoBackoffMs(5));
  assert.equal(atrasoBackoffMs(99), atrasoBackoffMs(7));
  const base = { id: "contrato.assinado:env-1", tipo: "contrato.assinado", origem: "comercial", ocorrido_em: "2026-11-16T12:00:00Z",
    payload: { contratoId: "c1", envelopeId: "env-1", razaoSocial: "X Ltda", modelo: "Padrão", servicos: ["marketplace"] } };
  assert.equal(validarEvento(base).ok, true);
  const idErrado = validarEvento({ ...base, id: "contrato.assinado:outro" });
  assert.ok(!idErrado.ok && /envelopeId/.test(idErrado.erro));
  const tipo = validarEvento({ ...base, tipo: "nao.existe" });
  assert.ok(!tipo.ok && tipo.status === 422);
  const pay = validarEvento({ ...base, payload: { ...base.payload, valorMensal: -1 } });
  assert.ok(!pay.ok && pay.status === 400);
  assert.ok(!validarEvento({ ...base, id: "com espaço" }).ok);
});

// Leitor do "Exportar conversa" do WhatsApp em pt-BR (Android e iOS; individual e grupo). Funções PURAS, sem banco.
//   Android: "16/11/2026 14:32 - Fulano: texto"        (às vezes "16/11/26 14:32 - " ou com vírgula)
//   iOS:     "[16/11/2026, 14:32:05] Fulano: texto"   (às vezes "[16/11/26 14:32:05]"; anexos "<anexado: arquivo>")
// Mensagens multilinha (linhas sem cabeçalho continuam a anterior), "<Mídia oculta>", anexos e mensagens do sistema
// (criptografia, entrou, saiu, apagada…). O conteúdo é dado de terceiros: aqui só é lido, nunca interpretado.
import { createHash } from "node:crypto";

export type TipoMensagem = "texto" | "midia" | "anexo" | "sistema";
export interface MensagemExport {
  data: string; // AAAA-MM-DD
  hora: string; // HH:MM:SS
  autor: string | null;
  texto: string;
  tipo: TipoMensagem;
  /** Nome do arquivo anexado (quando a conversa foi exportada com mídia). */
  anexo?: string;
}
export interface ConversaExport {
  formato: "android" | "ios" | "desconhecido";
  titulo: string | null;
  grupo: boolean;
  participantes: string[];
  mensagens: MensagemExport[];
  linhasIgnoradas: number;
}

const INVISIVEIS = /[‎‏‪-‮⁦-⁩﻿]/g;
const RE_IOS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s?(.*)$/;
const RE_ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+-\s(.*)$/;
const RE_AUTOR = /^([^:\n]{1,80}?):\s(.*)$/s;

const SISTEMA = [
  /criptografia de ponta a ponta/i, /\bcriou (o )?grupo\b/i, /\badicionou\b/i, /\bremoveu\b/i, /\bsaiu\b$/i, /\bentrou usando o link/i,
  /mudou (o assunto|a descrição|a imagem|o nome|as configurações|para)/i, /\balterou (o assunto|a descrição|a imagem|as configurações)/i,
  /^esta mensagem foi apagada\.?$/i, /^mensagem apagada\.?$/i, /^você apagou esta mensagem\.?$/i, /^(você )?(foi adicionad[oa]|entrou)\b/i,
  /código de segurança/i, /mensagens temporárias/i, /^chamada de (voz|vídeo) perdida/i, /^(ligação|chamada) de (voz|vídeo)/i,
  /agora é admin/i, /não é mais admin/i, /^null$/i, /^esta mensagem foi editada$/i, /bloqueou este contato|desbloqueou este contato/i,
];
const OCULTA = /^<?(m[ií]dia (oculta|omitida)|media omitted)>?$|^(imagem|áudio|audio|vídeo|video|figurinha|documento|gif|contato|sticker) (ocultad[oa]|omitid[oa])$/i;
const ANEXO_IOS = /<anexado:\s*([^>]+)>/i;
const ANEXO_ANDROID = /^(.+?\.[a-z0-9]{2,5})\s+\((arquivo anexado|file attached)\)/i;
const APAGADA_OU_CHAMADA = /^(esta mensagem foi apagada|mensagem apagada|você apagou esta mensagem|chamada de (voz|vídeo) perdida|(ligação|chamada) de (voz|vídeo)[^\n]*)\.?$/i;
const EDITADA = /\s*<(esta mensagem foi editada|mensagem editada|this message was edited)>\s*$/i;

const pad = (n: number | string) => String(n).padStart(2, "0");
function montarData(d: string, m: string, a: string): string | null {
  const ano = a.length === 2 ? 2000 + Number(a) : Number(a);
  const dia = Number(d), mes = Number(m);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2009 || ano > 2100) return null;
  const iso = `${ano}-${pad(mes)}-${pad(dia)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** Título pelo nome do arquivo: "Conversa do WhatsApp com Ladies.txt", "WhatsApp Chat - Ladies.zip", "Conversa do WhatsApp - Ladies.zip". */
export function tituloDoArquivo(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const base = nome.split(/[\\/]/).pop()!.replace(/\.(txt|zip)$/i, "").replace(/\s*\(\d+\)$/, "").trim();
  const m = /^(?:conversa do whatsapp com|conversa do whatsapp -|whatsapp chat with|whatsapp chat -|whatsapp chat com)\s+(.+)$/i.exec(base);
  if (m) return m[1].trim() || null;
  if (/^_?chat$/i.test(base) || /^whatsapp chat$/i.test(base)) return null;
  return null;
}

export function parseWhatsappTxt(texto: string, nomeArquivo?: string | null): ConversaExport {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const msgs: MensagemExport[] = [];
  let ios = 0, android = 0, ignoradas = 0;
  let autorSistemaIos: string | null = null;
  for (const bruta of linhas) {
    const lrmNoCorpo = /\]\s?[^:]*:\s?‎/.test(bruta) || /^‎/.test(bruta);
    const linha = bruta.replace(INVISIVEIS, "");
    const mi = RE_IOS.exec(linha);
    const ma = mi ? null : RE_ANDROID.exec(linha);
    const m = mi ?? ma;
    if (!m) {
      if (msgs.length) msgs[msgs.length - 1].texto += `\n${linha}`;
      else if (linha.trim()) ignoradas++;
      continue;
    }
    const data = montarData(m[1], m[2], m[3]);
    const h = Number(m[4]);
    if (!data || h > 23) { if (msgs.length) msgs[msgs.length - 1].texto += `\n${linha}`; else ignoradas++; continue; }
    if (mi) ios++; else android++;
    const hora = `${pad(h)}:${m[5]}:${m[6] ?? "00"}`;
    const resto = m[7] ?? "";
    const am = RE_AUTOR.exec(resto);
    if (am) {
      const autor = am[1].trim();
      // iOS: mensagem do sistema vem "assinada" pelo nome do grupo com um caractere invisível antes do texto
      const sistemaIos = Boolean(mi && lrmNoCorpo && SISTEMA.some((r) => r.test(am[2].trim())));
      if (sistemaIos && !autorSistemaIos) autorSistemaIos = autor;
      msgs.push({ data, hora, autor: sistemaIos ? null : autor, texto: am[2], tipo: sistemaIos ? "sistema" : "texto" });
    } else {
      msgs.push({ data, hora, autor: null, texto: resto, tipo: "sistema" });
    }
  }
  // classificação final (o texto multilinha já está completo)
  for (const msg of msgs) {
    msg.texto = msg.texto.replace(EDITADA, "").replace(/\s+$/g, "");
    if (msg.tipo === "sistema") continue;
    const t = msg.texto.trim();
    const anexo = ANEXO_IOS.exec(t) ?? ANEXO_ANDROID.exec(t);
    if (anexo) {
      msg.tipo = "anexo";
      msg.anexo = anexo[1].trim();
      const legenda = t.replace(ANEXO_IOS, "").replace(ANEXO_ANDROID, "").replace(/^[^\n]*•[^\n]*$/m, "").trim();
      msg.texto = legenda;
    } else if (OCULTA.test(t)) {
      msg.tipo = "midia";
      msg.texto = "";
    } else if (APAGADA_OU_CHAMADA.test(t)) {
      msg.tipo = "sistema";
    }
  }
  const participantes = [...new Set(msgs.filter((x) => x.tipo !== "sistema" && x.autor).map((x) => x.autor!))];
  const sistemaGrupo = msgs.some((x) => x.tipo === "sistema" && /criou (o )?grupo|adicionou|entrou usando o link|saiu$|removeu/i.test(x.texto));
  const titulo = tituloDoArquivo(nomeArquivo) ?? autorSistemaIos ?? null;
  return {
    formato: ios > android ? "ios" : android > 0 ? "android" : "desconhecido",
    titulo,
    grupo: Boolean(autorSistemaIos) || sistemaGrupo || participantes.length > 2,
    participantes,
    mensagens: msgs,
    linhasIgnoradas: ignoradas,
  };
}

const normEsp = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Hash da mensagem (autor + data/hora + texto): a mesma mensagem nunca entra duas vezes para o cliente. */
export function hashMensagem(m: Pick<MensagemExport, "autor" | "data" | "hora" | "texto" | "anexo">): string {
  return createHash("sha256").update(JSON.stringify([normEsp(m.autor).toLowerCase(), `${m.data}T${m.hora}`, normEsp(m.texto), normEsp(m.anexo)])).digest("hex");
}

/** Chave da conversa/grupo para lembrar o cliente: título normalizado; sem título, os participantes. */
export function chaveConversa(c: Pick<ConversaExport, "titulo" | "participantes">): string {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  if (c.titulo) return `t:${n(c.titulo)}`;
  return `p:${[...c.participantes].map(n).sort().join("|")}`.slice(0, 300);
}

const fmtLinha = (m: MensagemExport) => {
  const corpo = m.tipo === "midia" ? "[mídia não exportada]" : m.texto || (m.anexo ? `[anexo: ${m.anexo}]` : "");
  return `[${m.data.slice(8, 10)}/${m.data.slice(5, 7)} ${m.hora.slice(0, 5)}] ${m.autor ?? "?"}: ${corpo}`;
};

export interface Bloco { de: string; ate: string; mensagens: MensagemExport[]; texto: string }

/** Agrupa mensagens em blocos de dias (até `maxDias` dias corridos ou ~`maxChars` caracteres) para o extrator de combinados. */
export function blocosPorDias(msgs: MensagemExport[], o: { maxDias?: number; maxChars?: number } = {}): Bloco[] {
  const maxDias = o.maxDias ?? 7, maxChars = o.maxChars ?? 12_000;
  const ordenadas = msgs.filter((m) => m.tipo !== "sistema").sort((a, b) => (`${a.data}T${a.hora}` < `${b.data}T${b.hora}` ? -1 : 1));
  const out: Bloco[] = [];
  let atual: Bloco | null = null;
  const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  for (const m of ordenadas) {
    const linha = fmtLinha(m).slice(0, 4000);
    if (!atual || dias(atual.de, m.data) >= maxDias || (atual.texto.length + linha.length > maxChars && atual.ate !== m.data) || atual.texto.length + linha.length > maxChars * 2) {
      atual = { de: m.data, ate: m.data, mensagens: [], texto: "" };
      out.push(atual);
    }
    atual.mensagens.push(m);
    atual.ate = m.data;
    atual.texto += (atual.texto ? "\n" : "") + linha;
  }
  return out;
}

export const EXT_AUDIO = /\.(opus|ogg|m4a|mp3|aac|amr|wav)$/i;

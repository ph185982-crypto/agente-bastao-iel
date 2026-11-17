// Importação de conversa exportada do WhatsApp (.txt ou .zip com mídia) para o Inbox de combinados de um cliente.
// Usada pela tela Operações → Capturas e pela API de serviço POST /api/capturas/importar (o Max repassa o arquivo).
//  1. lê o arquivo (zip: o _chat.txt/primeiro .txt e os áudios);  2. cada mensagem entra UMA vez por cliente (hash de
//  autor + data + texto em captura_mensagens);  3. só as novas são agrupadas em blocos de dias e passam pelo extrator de
//  combinados existente (ingestCaptura: ações entram direto com selo IA e podem ser desfeitas);  4. lembra conversa → cliente.
// Áudios: transcritos só com provedor configurado (senão "[áudio não transcrito]").
import { rawQuery } from "../db/client";
import { ingestCaptura } from "../motor/capturas";
import type { AiProvider } from "../ai/provider";
import { baseNome, ehZip, extrairZip, listarZip, ZipErro, type EntradaZip } from "./zip";
import { blocosPorDias, chaveConversa, EXT_AUDIO, hashMensagem, parseWhatsappTxt, type ConversaExport, type MensagemExport } from "./whatsapp-export";
import { transcritorDoAmbiente, type Transcritor } from "./transcricao";

/** Limite do arquivo (a Vercel recusa corpo acima de ~4,5 MB). Conversas maiores: exportar "sem mídia". */
export const LIMITE_ARQUIVO = 4 * 1024 * 1024;
const MAX_TXT = 20 * 1024 * 1024;
const MAX_AUDIO = 8 * 1024 * 1024;
const MAX_AUDIOS_POR_IMPORTACAO = 15;

export class ImportacaoErro extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface ArquivoLido { conversa: ConversaExport; audios: Map<string, EntradaZip>; zip: Buffer | null; nome: string }

export function lerArquivo(buf: Buffer, nome: string): ArquivoLido {
  if (!buf.length) throw new ImportacaoErro("Arquivo vazio.");
  if (buf.length > LIMITE_ARQUIVO) throw new ImportacaoErro("Arquivo acima de 4 MB: exporte a conversa “sem mídia” (ou só o .txt) e tente de novo.", 413);
  if (ehZip(buf)) {
    let entradas: EntradaZip[];
    try { entradas = listarZip(buf); } catch (e) { throw new ImportacaoErro(e instanceof ZipErro ? e.message : "Arquivo .zip inválido."); }
    const txts = entradas.filter((e) => /\.txt$/i.test(e.nome) && !baseNome(e.nome).startsWith("."));
    const chat = txts.find((e) => /^_chat\.txt$/i.test(baseNome(e.nome))) ?? txts.find((e) => /whatsapp/i.test(e.nome)) ?? txts[0];
    if (!chat) throw new ImportacaoErro("O .zip não tem a conversa (.txt). Use o arquivo gerado por “Exportar conversa”.");
    let texto: string;
    try { texto = extrairZip(buf, chat, MAX_TXT).toString("utf8"); } catch { throw new ImportacaoErro("Não consegui abrir a conversa dentro do .zip."); }
    const audios = new Map(entradas.filter((e) => EXT_AUDIO.test(e.nome)).map((e) => [baseNome(e.nome), e] as const));
    const conversa = parseWhatsappTxt(texto, nome);
    if (!conversa.mensagens.length) throw new ImportacaoErro("Não encontrei mensagens no formato do WhatsApp neste arquivo.");
    return { conversa, audios, zip: buf, nome };
  }
  const texto = buf.toString("utf8");
  if (texto.includes("\u0000")) throw new ImportacaoErro("Envie o .txt ou o .zip gerado por “Exportar conversa” do WhatsApp.");
  const conversa = parseWhatsappTxt(texto, nome);
  if (!conversa.mensagens.length) throw new ImportacaoErro("Não encontrei mensagens no formato do WhatsApp neste arquivo.");
  return { conversa, audios: new Map(), zip: null, nome };
}

export async function clienteLembrado(c: ConversaExport): Promise<{ id: string; name: string } | null> {
  const r = await rawQuery<{ id: string; name: string }>(
    "select c.id, c.name from avanteza.captura_conversas v join avanteza.clients c on c.id = v.client_id where v.chave = $1 and c.active",
    [chaveConversa(c)],
  );
  return r[0] ?? null;
}

export interface Previa {
  titulo: string | null; formato: string; grupo: boolean; participantes: string[];
  mensagens: number; sistema: number; midias: number; audios: number; audiosNoZip: number; de: string | null; ate: string | null;
  clienteSugerido: { id: string; name: string } | null; jaImportadas: number | null;
  amostra: { quando: string; autor: string; texto: string }[];
}

export async function previaConversa(buf: Buffer, nome: string, clientId?: string | null): Promise<Previa> {
  const { conversa: c, audios } = lerArquivo(buf, nome);
  const uteis = c.mensagens.filter((m) => m.tipo !== "sistema");
  const sugerido = await clienteLembrado(c);
  const alvo = clientId ?? sugerido?.id ?? null;
  let ja: number | null = null;
  if (alvo) {
    const hashes = uteis.map(hashMensagem);
    const [r] = await rawQuery<{ n: number }>("select count(*)::int n from avanteza.captura_mensagens where client_id = $1 and hash = any($2::text[])", [alvo, hashes]);
    ja = r.n;
  }
  const datas = uteis.map((m) => m.data).sort();
  return {
    titulo: c.titulo, formato: c.formato, grupo: c.grupo, participantes: c.participantes.slice(0, 30),
    mensagens: uteis.length, sistema: c.mensagens.length - uteis.length,
    midias: uteis.filter((m) => m.tipo === "midia" || m.tipo === "anexo").length,
    audios: uteis.filter((m) => m.anexo && EXT_AUDIO.test(m.anexo)).length, audiosNoZip: audios.size,
    de: datas[0] ?? null, ate: datas[datas.length - 1] ?? null,
    clienteSugerido: sugerido, jaImportadas: ja,
    amostra: uteis.slice(-12).map((m) => ({
      quando: `${m.data.slice(8, 10)}/${m.data.slice(5, 7)} ${m.hora.slice(0, 5)}`, autor: m.autor ?? "",
      texto: (m.tipo === "midia" ? "[mídia]" : m.texto || `[anexo: ${m.anexo}]`).slice(0, 280),
    })),
  };
}

export interface ResultadoImportacao {
  clientId: string; titulo: string | null; mensagens: number; novas: number; duplicadas: number; blocos: number;
  capturas: string[]; acoesCriadas: number; audiosTranscritos: number; audiosNaoTranscritos: number; semIa: boolean; erros: string[];
}

export async function importarConversa(
  o: { clientId: string; buf: Buffer; nome: string; actor: string },
  deps: { provider?: AiProvider; transcrever?: Transcritor | null; hoje?: string } = {},
): Promise<ResultadoImportacao> {
  const [cli] = await rawQuery<{ id: string }>("select id from avanteza.clients where id = $1 and active", [o.clientId]);
  if (!cli) throw new ImportacaoErro("Cliente não encontrado.", 404);
  const arq = lerArquivo(o.buf, o.nome);
  const c = arq.conversa;
  const titulo = c.titulo ?? (c.participantes.length ? c.participantes.slice(0, 3).join(", ") : null);
  await rawQuery(
    `insert into avanteza.captura_conversas (chave, titulo, client_id) values ($1,$2,$3)
     on conflict (chave) do update set client_id = excluded.client_id, titulo = excluded.titulo, atualizado_em = now()`,
    [chaveConversa(c), (titulo ?? "Conversa").slice(0, 200), o.clientId],
  );
  const uteis = c.mensagens.filter((m) => m.tipo !== "sistema");
  // 1) quais mensagens são novas para este cliente
  const hashes = new Map<MensagemExport, string>(uteis.map((m) => [m, hashMensagem(m)]));
  const inseridos = new Set<string>();
  for (let i = 0; i < uteis.length; i += 1000) {
    const lote = uteis.slice(i, i + 1000);
    const r = await rawQuery<{ hash: string }>(
      `insert into avanteza.captura_mensagens (client_id, hash, enviada_em)
       select $1, h, e from unnest($2::text[], $3::timestamptz[]) as t(h, e) on conflict do nothing returning hash`,
      [o.clientId, lote.map((m) => hashes.get(m)!), lote.map((m) => `${m.data}T${m.hora}-03:00`)],
    );
    for (const x of r) inseridos.add(x.hash);
  }
  // a mesma mensagem repetida no próprio arquivo conta uma vez só
  const vistos = new Set<string>();
  const novas = uteis.filter((m) => {
    const h = hashes.get(m)!;
    if (!inseridos.has(h) || vistos.has(h)) return false;
    vistos.add(h);
    return true;
  });
  // 2) áudios das mensagens novas
  let transcritos = 0, naoTranscritos = 0;
  const transcrever = deps.transcrever === undefined ? transcritorDoAmbiente() : deps.transcrever;
  for (const m of novas) {
    if (!m.anexo || !EXT_AUDIO.test(m.anexo)) continue;
    const ent = arq.audios.get(baseNome(m.anexo));
    let t: string | null = null;
    if (ent && arq.zip && transcrever && transcritos < MAX_AUDIOS_POR_IMPORTACAO) {
      try { t = await transcrever(extrairZip(arq.zip, ent, MAX_AUDIO), baseNome(m.anexo)); } catch { t = null; }
    }
    if (t) { transcritos++; m.texto = `[áudio transcrito] ${t}${m.texto ? `\n${m.texto}` : ""}`; }
    else { naoTranscritos++; m.texto = `[áudio não transcrito]${m.texto ? ` ${m.texto}` : ""}`; }
  }
  // 3) blocos de dias → extrator de combinados
  const blocos = blocosPorDias(novas);
  const out: ResultadoImportacao = {
    clientId: o.clientId, titulo, mensagens: uteis.length, novas: novas.length, duplicadas: uteis.length - novas.length, blocos: blocos.length,
    capturas: [], acoesCriadas: 0, audiosTranscritos: transcritos, audiosNaoTranscritos: naoTranscritos, semIa: false, erros: [],
  };
  for (const b of blocos) {
    const r = await ingestCaptura(
      { origem: "whatsapp_export", clientId: o.clientId, autor: (titulo ?? "Conversa exportada").slice(0, 120), texto: b.texto.slice(0, 50_000), data: b.ate },
      { provider: deps.provider, hoje: deps.hoje },
    );
    out.capturas.push(r.capturaId);
    out.acoesCriadas += r.acoesCriadas;
    if (r.status === "sem_ia") out.semIa = true;
    if (r.status === "erro" && r.erro) out.erros.push(`${b.de}–${b.ate}: ${r.erro}`);
    await rawQuery("update avanteza.capturas set conversa = $2 where id = $1", [r.capturaId, titulo]);
    await rawQuery("update avanteza.captura_mensagens set captura_id = $3 where client_id = $1 and hash = any($2::text[])", [o.clientId, b.mensagens.map((m) => hashes.get(m)!), r.capturaId]);
  }
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('conversa_importada', $1, $2, $3)", [
    o.actor, o.clientId, JSON.stringify({ mensagens: out.mensagens, novas: out.novas, blocos: out.blocos, acoes: out.acoesCriadas, audios: transcritos + naoTranscritos }),
  ]);
  return out;
}

export interface CapturaLista {
  id: string; client_id: string; client_name: string; origem: string; autor: string | null; conversa: string | null; status: string; erro: string | null;
  criado_em: string; trecho: string; acoes: { id: string; title: string; status: string; ai_generated: boolean; due_date: string | null }[];
}

export async function listarCapturas(f: { clientId?: string | null; origem?: string | null; limite?: number } = {}): Promise<CapturaLista[]> {
  const rows = await rawQuery<Omit<CapturaLista, "acoes"> & { acoes_geradas: string[] }>(
    `select k.id, k.client_id, c.name as client_name, k.origem, k.autor, k.conversa, k.status, k.erro, to_char(k.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as criado_em,
            left(coalesce(k.texto, k.transcricao, k.midia_url, ''), 400) as trecho, k.acoes_geradas
       from avanteza.capturas k join avanteza.clients c on c.id = k.client_id
      where ($1::uuid is null or k.client_id = $1) and ($2::text is null or k.origem = $2)
      order by k.criado_em desc limit $3`,
    [f.clientId ?? null, f.origem ?? null, f.limite ?? 50],
  );
  const ids = rows.flatMap((r) => r.acoes_geradas ?? []);
  const acoes = ids.length
    ? await rawQuery<{ id: string; title: string; status: string; ai_generated: boolean; due_date: string | null; captura_id: string }>(
        "select id, title, status, ai_generated, due_date, captura_id from avanteza.plan_actions where id = any($1::uuid[]) and archived_at is null", [ids])
    : [];
  return rows.map(({ acoes_geradas: _x, ...r }) => ({ ...r, acoes: acoes.filter((a) => a.captura_id === r.id) }));
}

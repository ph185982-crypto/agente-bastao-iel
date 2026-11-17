// Leitor mínimo de .zip (só o necessário para o "Exportar conversa" do WhatsApp): diretório central + deflate/stored.
// Sem dependência externa. Proteções: número de entradas, tamanho descompactado por arquivo e total (zip bomb), nomes saneados.
import { inflateRawSync } from "node:zlib";

export interface EntradaZip { nome: string; metodo: number; compactado: number; tamanho: number; offsetLocal: number }

export class ZipErro extends Error {}

const MAX_ENTRADAS = 5000;

export function listarZip(buf: Buffer): EntradaZip[] {
  // fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipErro("Arquivo .zip inválido.");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (total > MAX_ENTRADAS) throw new ZipErro("Arquivo .zip com arquivos demais.");
  const out: EntradaZip[] = [];
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipErro("Diretório do .zip corrompido.");
    const metodo = buf.readUInt16LE(p + 10);
    const compactado = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nLen).toString("utf8");
    out.push({ nome, metodo, compactado, tamanho, offsetLocal });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

export function extrairZip(buf: Buffer, e: EntradaZip, maxBytes: number): Buffer {
  if (e.tamanho > maxBytes) throw new ZipErro(`${e.nome}: grande demais.`);
  const p = e.offsetLocal;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new ZipErro("Entrada do .zip corrompida.");
  const ini = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const dados = buf.subarray(ini, ini + e.compactado);
  if (e.metodo === 0) return Buffer.from(dados);
  if (e.metodo === 8) return inflateRawSync(dados, { maxOutputLength: maxBytes });
  throw new ZipErro(`${e.nome}: compressão não suportada.`);
}

export const ehZip = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
/** Só o nome do arquivo, sem pastas (o .zip do iOS às vezes traz caminho). */
export const baseNome = (n: string) => n.split(/[\\/]/).pop() ?? n;

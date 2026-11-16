// Amostras SINTÉTICAS (nomes e números inventados) do "Exportar conversa" do WhatsApp em pt-BR, e um montador de .zip.
import { deflateRawSync } from "node:zlib";

const L = "\u200e";
export const ANDROID = [
  "10/11/2026 09:12 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta e ficam somente entre você e os participantes desta conversa. Nem mesmo o WhatsApp pode ler ou ouvi-las. Toque para saber mais.",
  "10/11/2026 09:12 - Pedro Avanteza criou o grupo \"Ladies x Avanteza\"",
  "10/11/2026 09:13 - Pedro Avanteza adicionou Carla Ladies",
  "10/11/2026 09:15 - Pedro Avanteza: Bom dia, Carla! Para começar o Mercado Livre preciso de:",
  "1) planilha de custos",
  "2) acesso à conta",
  "10/11/2026 09:20 - Carla Ladies: Bom dia! Mando a planilha até sexta",
  "10/11/2026 09:21 - Carla Ladies: <Mídia oculta>",
  "10/11/2026 09:22 - Carla Ladies: Esta mensagem foi apagada",
  "11/11/2026 14:02 - Pedro Avanteza: PTT-20261111-WA0003.opus (arquivo anexado)",
  "11/11/26 14:05 - +55 62 98888-7777: Combinado, vou subir as fotos novas na quarta <Esta mensagem foi editada>",
  "20/11/2026 10:00 - Carla Ladies: Pedro, e a campanha de Black Friday?",
].join("\n");

export const IOS = [
  `[12/11/2026, 08:01:10] Showman Barbearia: ${L}As mensagens e ligações são protegidas com a criptografia de ponta a ponta.`,
  `[12/11/2026, 08:01:10] Showman Barbearia: ${L}João Showman criou o grupo “Showman Barbearia”`,
  "[12/11/2026, 08:05:44] João Showman: Fala Pedro, sobre o tráfego:",
  "quero focar em corte + barba",
  "e aumentar a verba em 20%",
  `[12/11/2026, 08:06:02] Pedro Avanteza: ${L}<anexado: 00000007-AUDIO-2026-11-12-08-06-02.opus>`,
  `[12/11/26 08:07:15] João Showman: ${L}imagem ocultada`,
  "[12/11/2026, 08:09:00] Pedro Avanteza: Fechado, subo a campanha nova até sexta (14/11)",
  `[13/11/2026, 19:30:00] João Showman: ${L}Você apagou esta mensagem.`,
  `[13/11/2026, 19:31:00] Ana Avanteza: ${L}tabela.pdf • 2 páginas <anexado: 00000009-tabela.pdf>`,
].join("\n");

export function montarZip(arquivos: Record<string, Buffer | string>): Buffer {
  const locais: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = Buffer.from(conteudo);
    const comp = deflateRawSync(dados);
    const n = Buffer.from(nome);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(dados.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(dados.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locais.push(lh, n, comp); central.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cd, end]);
}


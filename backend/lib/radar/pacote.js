// Pacote de entrega do carrossel: ZIP com as 8 imagens, a legenda, a ficha de fontes e a origem de cada imagem.
// ZIP "armazenado" (sem compressão: PNG já é comprimido), feito à mão para não depender de biblioteca nem de disco.
const U = require('./util');
const C = require('./config');

let _tabela;
function crc32(buf) {
  if (!_tabela) { _tabela = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _tabela[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = _tabela[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function montarZip(arquivos, { agora = new Date() } = {}) {
  const partes = []; const central = []; let deslocamento = 0;
  const dosTime = ((agora.getUTCHours() & 31) << 11) | ((agora.getUTCMinutes() & 63) << 5) | ((agora.getUTCSeconds() >> 1) & 31);
  const dosDate = (((agora.getUTCFullYear() - 1980) & 127) << 9) | (((agora.getUTCMonth() + 1) & 15) << 5) | (agora.getUTCDate() & 31);
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8'); const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, 'utf8'); const crc = crc32(dados);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dados.length, 18); lh.writeUInt32LE(dados.length, 22); lh.writeUInt16LE(nome.length, 26); lh.writeUInt16LE(0, 28);
    partes.push(lh, nome, dados);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dados.length, 20); ch.writeUInt32LE(dados.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(deslocamento, 42);
    central.push(ch, nome);
    deslocamento += 30 + nome.length + dados.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

// Lê um ZIP gerado por montarZip (usado nos testes e na conferência de integridade antes de guardar).
function lerZip(zip) {
  const out = []; let fim = zip.length - 22;
  while (fim >= 0 && zip.readUInt32LE(fim) !== 0x06054b50) fim -= 1;
  if (fim < 0) throw new Error('ZIP inválido: sem diretório central');
  const n = zip.readUInt16LE(fim + 10); let p = zip.readUInt32LE(fim + 16) + 0; const dirOff = zip.readUInt32LE(fim + 16);
  let c = dirOff; void p;
  for (let i = 0; i < n; i++) {
    if (zip.readUInt32LE(c) !== 0x02014b50) throw new Error('ZIP inválido: entrada corrompida');
    const crc = zip.readUInt32LE(c + 16); const tam = zip.readUInt32LE(c + 24); const nl = zip.readUInt16LE(c + 28); const off = zip.readUInt32LE(c + 42);
    const nome = zip.slice(c + 46, c + 46 + nl).toString('utf8');
    const lnl = zip.readUInt16LE(off + 26); const lel = zip.readUInt16LE(off + 28); const ini = off + 30 + lnl + lel;
    const dados = zip.slice(ini, ini + tam);
    if (crc32(dados) !== crc) throw new Error(`ZIP corrompido: CRC de ${nome}`);
    out.push({ nome, dados }); c += 46 + nl;
  }
  return out;
}

const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : 'sem data');

// Ficha de fontes (Markdown legível + JSON): cada afirmação com URL, veículo, data, trecho, data da consulta, confiança e limitações.
function fichaDeFontes(op, carrossel) {
  const v = op.verificacao || {};
  const linhas = [];
  linhas.push(`# Ficha de fontes — ${op.nome}`, '', `Série “${C.SERIE}” · @pedro_destrava`, `Gerada em ${dataBR(carrossel?.criado_em || new Date().toISOString())} · pontuação ${op.pontuacao ?? '—'}/100`, '');
  linhas.push('## Resumo da verificação', '');
  linhas.push(`- Estado: **${v.estado || 'não verificada'}**`, `- Fonte oficial: ${v.fonte_oficial ? `${v.fonte_oficial.url} (consultada em ${dataBR(v.fonte_oficial.acessada_em)})` : 'não confirmada'}`, `- Fontes independentes de imprensa: ${v.independentes ?? 0}`, `- Regra: só vira carrossel com fonte oficial ou duas fontes independentes. Números não confirmados não são usados.`, '');
  linhas.push('## Afirmações e evidências', '');
  const claims = v.claims || [];
  if (!claims.length) linhas.push('Nenhuma afirmação confirmada.', '');
  claims.forEach((c) => {
    linhas.push(`### ${c.id} · ${c.tipo}${c.usavel ? '' : ' (NÃO USADA)'}`, '', `- Afirmação: ${c.texto}`);
    if (c.numero !== null) linhas.push(`- Valor: ${c.valor_exibicao || c.numero}${c.periodo ? ` (${c.periodo})` : ''}`);
    linhas.push(`- Fonte: ${c.veiculo} — ${c.url}`, `- Data da publicação: ${dataBR(c.data_publicacao)} · consultada em ${dataBR(c.consultado_em)}`, `- Trecho que comprova: “${c.trecho}”`, `- Confiança: ${c.confianca}${c.atribuicao ? ` · atribuição na arte: ${c.atribuicao}` : ''}`);
    if (c.confirmado_por?.length) linhas.push(`- Confirmada também por: ${c.confirmado_por.map((x) => `${x.veiculo} (${x.url})`).join('; ')}`);
    if (c.observacoes?.length) linhas.push(`- Observações: ${c.observacoes.join(' ')}`);
    linhas.push('');
  });
  if ((v.claims_rejeitadas || []).length) { linhas.push('## Afirmações recusadas pela conferência', ''); v.claims_rejeitadas.forEach((r) => linhas.push(`- ${r.texto || '(sem texto)'} — ${r.motivo}`)); linhas.push(''); }
  linhas.push('## Fontes lidas', '');
  (v.fontes || []).forEach((f) => linhas.push(`- ${f.veiculo} (${f.classe}) — ${f.url} · publicada em ${dataBR(f.publicada_em)} · consultada em ${dataBR(f.acessada_em)}`));
  if ((v.limitacoes || []).length) { linhas.push('', '## Limitações', ''); v.limitacoes.forEach((l) => linhas.push(`- ${l}`)); }
  linhas.push('', '## Imagens', '');
  const imgs = carrossel?.imagens || [];
  if (!imgs.length) linhas.push('Nenhuma fotografia real foi usada (telas tipográficas).');
  imgs.forEach((i) => linhas.push(`- Telas ${i.telas.join(', ')}: ${i.descricao} · origem: ${i.origem?.url_imagem} (página ${i.origem?.url_pagina}) · consultada em ${dataBR(i.origem?.consultado_em)} · ${i.licenca}`));
  linhas.push('', '## Hipóteses (não são fatos)', '', 'A tela 7 e o campo “adaptação ao Brasil” são hipóteses de teste, não afirmações sobre o mercado brasileiro.', '');
  const json = { negocio: op.nome, pais: op.pais, pontuacao: op.pontuacao, criterios: op.criterios, verificacao: { estado: v.estado, fonte_oficial: v.fonte_oficial, independentes: v.independentes, claims, claims_rejeitadas: v.claims_rejeitadas, fontes: v.fontes, limitacoes: v.limitacoes, idade: v.idade }, imagens: imgs, gerada_em: carrossel?.criado_em };
  return { markdown: linhas.join('\n'), json };
}

function nomeArquivo(nome) { return U.semAcento(nome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ideia'; }

module.exports = { montarZip, lerZip, crc32, fichaDeFontes, nomeArquivo, dataBR };

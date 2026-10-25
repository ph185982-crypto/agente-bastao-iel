const crypto = require('crypto');
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const ESTILOS = {
  foto_editorial: { nome: 'Foto editorial', descricao: 'Fotos, manchete forte e leitura curta', letra: 'A' },
  impacto: { nome: 'Impacto', descricao: 'Contraste, frases curtas e destaque visual', letra: 'B' },
  revista: { nome: 'Revista', descricao: 'Foto recortada, contexto e prova', letra: 'C' },
};
const MOTIVOS = { texto_longo: 'Texto demais', sem_foto: 'Quero mais fotos', capa_fraca: 'Capa sem impacto', visual: 'Não gostei do visual', voz: 'Não parece comigo', cta: 'CTA fraco', tema: 'Tema não interessa', fatos: 'Informação incorreta' };
async function listar() { return (await armazem()?.feedback.listar(ACCOUNT.ig_id)) || []; }
async function registrar(c, { acao, motivos = [], detalhe = '', versao }) {
  const v = require('../../static/contentModel').versaoAtiva(c);
  if (!v || (versao && versao !== v.hash)) throw Object.assign(new Error('O conteúdo mudou. Atualize a prévia antes de decidir.'), { status:409 });
  if (!['aprovar','refazer','descartar'].includes(acao)) throw Object.assign(new Error('Decisão inválida.'), { status:400 });
  const validos = [...new Set(motivos)].filter(k => MOTIVOS[k]).slice(0,8);
  if (acao === 'refazer' && !validos.length && !String(detalhe).trim()) throw Object.assign(new Error('Escolha um motivo para orientar a nova versão.'), { status:400 });
  const dado = { id: crypto.createHash('sha256').update(`${c.id}:${v.hash}:${acao}`).digest('hex').slice(0,32), content_id:c.id, versao:v.hash, estilo:c.experimento?.estilo || v.slides[0]?.estilo || 'original', formato:c.formato, acao, motivos:validos, detalhe:String(detalhe).trim().slice(0,500), em:new Date().toISOString() };
  await armazem().feedback.salvar(ACCOUNT.ig_id,dado);
  return dado;
}
async function orientacoes() {
  const feedback = (await listar()).slice(0,30);
  const contagem = Object.fromEntries(Object.keys(MOTIVOS).map(k => [k,feedback.filter(f => f.acao === 'refazer' && f.motivos.includes(k)).length]));
  const regras = [];
  if (contagem.texto_longo) regras.push('Preferir 12 a 28 palavras por slide; dividir ideias em vez de criar parágrafos.');
  if (contagem.sem_foto) regras.push('Priorizar capa fotográfica e alternar fotos com texto.');
  if (contagem.capa_fraca) regras.push('Gancho direto, específico, com uma tensão real; sem clickbait inventado.');
  if (contagem.voz) regras.push('Escrever como conversa de empreendedor, sem fórmulas de IA, com opinião claramente apresentada como opinião.');
  if (contagem.cta) regras.push('Fechar com um motivo concreto para seguir @pedro_destrava.');
  return { regras, recentes:feedback.filter(f => f.acao === 'refazer').slice(0,5).map(f => ({ motivos:f.motivos.map(k => MOTIVOS[k]), pedido:f.detalhe })), contagem };
}
async function escolherEstilo({ indice = 0 } = {}) {
  const feedback = await listar();
  const ids = Object.keys(ESTILOS);
  // Keep exploring all formats. Feedback expresses preference, not measured reach.
  const scores = ids.map(id => ({ id, n: feedback.filter(f => f.estilo === id && f.acao === 'aprovar').length - feedback.filter(f => f.estilo === id && f.acao === 'refazer' && f.motivos.includes('visual')).length }));
  scores.sort((a,b) => b.n-a.n);
  const ciclo = feedback.length + indice;
  return ciclo % 3 === 0 && scores[0].n > 0 ? scores[0].id : ids[ciclo % ids.length];
}
module.exports = { ESTILOS, MOTIVOS, listar, registrar, orientacoes, escolherEstilo };

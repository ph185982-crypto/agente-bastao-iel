// Limpeza do banco (o Postgres gratuito tem 512 MB). Mantém tudo o que está em uso e apaga:
//  - prévias (render:<conteúdo>:<versão>:…) de conteúdo arquivado/descartado, de conteúdo que não existe mais e de versões
//    que não são a ativa — a publicação redesenha o slide a partir do texto, a prévia é só para ver no app;
//  - fotos (img:…) que nenhum conteúdo vivo usa;
//  - revisões antigas do histórico de cada conteúdo (fica o limite do armazém).
// Arquivos de outros tipos (upload:encerramento, recortes, áudios…) nunca são tocados.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const M = require('../../static/contentModel');

const MORTO = new Set(['arquivado', 'descartado', 'excluido']);

async function limpar({ simular = false, orcamentoMs = 40000 } = {}) {
  const a = armazem(); const conta = ACCOUNT.ig_id; const inicio = Date.now();
  if (!a?.duravel) return { executou: false, motivo: 'Sem banco de dados no servidor.' };
  const antes = a.arquivos.espaco ? await a.arquivos.espaco().catch(() => null) : null;

  const lista = await a.conteudos.listar(conta);
  const ativa = new Map(); // id → versão ativa (só conteúdo vivo)
  for (const x of lista) if (!MORTO.has(x.resumo?.status)) ativa.set(x.id, x.resumo?.versao || null);

  // fotos em uso: lê só os conteúdos vivos
  const fotosEmUso = new Set(); const previasEmUso = new Set(); const lidosIds = new Set(); let lidos = 0; let incompleto = false;
  for (const id of ativa.keys()) {
    if (Date.now() - inicio > orcamentoMs * 0.6) { incompleto = true; break; }
    const c = (await a.conteudos.obter(conta, id))?.doc; lidos++;
    if (!c) continue;
    lidosIds.add(id);
    // a prévia vale pelo que a versão ativa REFERENCIA (slide que não mudou reaproveita a imagem da versão anterior)
    const va = M.versaoAtiva(c)?.id; (c.arte?.renders || []).forEach((r) => r.versao === va && r.blob_key && previasEmUso.add(r.blob_key));
    (c.imagens || []).forEach((i) => i?.id && fotosEmUso.add(`img:${i.id}`));
    (M.versaoAtiva(c)?.slides || []).forEach((s) => s.imagem_id && fotosEmUso.add(`img:${s.imagem_id}`));
  }

  const arquivos = await a.arquivos.listar(conta);
  const apagar = []; let bytes = 0;
  for (const f of arquivos) {
    const p = String(f.chave).split(':');
    let fora = false;
    if (p[0] === 'render' && p.length >= 3) fora = !ativa.has(p[1]) || (lidosIds.has(p[1]) && !previasEmUso.has(f.chave));
    else if (p[0] === 'img' && !incompleto) fora = !fotosEmUso.has(f.chave); // sem a lista completa de fotos em uso, não apaga foto
    if (fora) { apagar.push(f.chave); bytes += Number(f.tamanho) || 0; }
  }

  let apagados = 0; let revisoes = 0;
  if (!simular) {
    apagados = await a.arquivos.apagar(conta, apagar);
    revisoes = a.conteudos.podarHistorico ? await a.conteudos.podarHistorico(conta) : 0;
    if (a.arquivos.compactar) await a.arquivos.compactar().catch(() => {});
  }
  const depois = !simular && a.arquivos.espaco ? await a.arquivos.espaco().catch(() => null) : null;
  return { executou: true, simulado: simular, conteudos: lista.length, vivos: ativa.size, lidos, fotos_em_uso: fotosEmUso.size, incompleto, arquivos: arquivos.length, apagar: apagar.length, apagados, mb_liberados: Math.round(bytes / 1048576), revisoes_podadas: revisoes, espaco_antes: antes, espaco_depois: depois };
}

module.exports = { limpar };

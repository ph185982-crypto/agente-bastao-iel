// Servidor REAL da aplicação com a IA SIMULADA (só para teste no navegador).
// Uso: PORT=3995 [DATABASE_URL=...] node servidorTeste.js
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'chave-falsa-de-teste';
const path = require('path');
const RAIZ = require('path').join(__dirname, '..', '..');
const llmJson = require(path.join(RAIZ, 'backend/lib/llmJson'));
const chamadas = {};
const atraso = Number(process.env.ATRASO_MS || 2500);
const TRECHO = 'O Senado aprovou nesta quinta-feira o projeto que eleva o teto de faturamento anual do microempreendedor individual para R$ 140 mil';
llmJson.pedirJson = async ({ usuario }) => {
  const tipo = /liste as afirmações FACTUAIS/.test(usuario) ? 'claims' : /BRIEFING editorial/.test(usuario) ? 'briefing' : /TRÊS CAPAS/.test(usuario) ? 'copy' : /AFIRMAÇÃO A VERIFICAR/.test(usuario) ? 'verify' : /AFIRMAÇÃO: /.test(usuario) ? 'conferir' : 'outro';
  chamadas[tipo] = (chamadas[tipo] || 0) + 1;
  await new Promise((r) => setTimeout(r, atraso));
  const llm = { provider: 'simulado', model: 'teste', tokens: { entrada: 1000, saida: 200, total: 1200 }, tentativas_provedor: 1 };
  if (tipo === 'claims') return { llm, dados: { afirmacoes: [{ texto: 'O Senado aprovou o projeto que eleva o teto de faturamento anual do MEI para R$ 140 mil.', tipo: 'fato', natureza: 'fato', correspondencia: 'integral', central: true, trecho: TRECHO, risco: 'baixo', valores: [{ valor: 140000, unidade: 'BRL' }] }] } };
  if (tipo === 'briefing') return { llm, dados: { assunto: 'Teto do MEI', acontecimento: 'Senado aprovou.', por_que_interessa: 'MEIs perto do limite.', objetivo: 'autoridade', tese: 'Mais espaço para crescer.', tese_tipo: 'explicacao', fatos_disponiveis: ['a1'], duvidas: [], formato: 'carrossel', estrutura: 'acontecimento', motivo_compartilhar: 'x', diferenca_recentes: 'x' } };
  if (tipo === 'copy') return { llm, dados: { estrutura: 'acontecimento', capas: [{ foco: 'acontecimento', texto: 'Senado aprova teto de R$ 140 mil para o MEI', claim_ids: ['a1'] }, { foco: 'consequencia', texto: 'MEI pode faturar mais sem trocar de regime', claim_ids: ['a1'] }, { foco: 'tensao', texto: 'O teto subiu. O que muda?', claim_ids: [] }], slides: [{ funcao: 'capa', texto: 'Senado aprova teto de **R$ 140 mil** para o MEI', claim_ids: ['a1'] }, { funcao: 'explicacao', texto: 'O projeto eleva o teto de faturamento anual para **R$ 140 mil**.', claim_ids: ['a1'] }, { funcao: 'consequencia', texto: 'Quem estava perto do limite ganha fôlego.', claim_ids: [] }], legenda: 'Segundo a matéria, o Senado aprovou o novo teto do MEI.', legenda_claim_ids: ['a1'], cta: 'Comente MEI se isso muda o seu negócio', hashtags: ['#mei'] } };
  return { llm, dados: { materias: [], fontes: [] } };
};
const app = require(path.join(RAIZ, 'backend/server'));
app.get('/__teste/chamadas', (req, res) => res.json(chamadas));
const http = require('http');
const fs = require('fs');
const STATIC = path.join(RAIZ, 'static');
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/__teste')) return app(req, res);
  let f = path.join(STATIC, req.url.split('?')[0]);
  if (!f.startsWith(STATIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(STATIC, 'index.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.TESTE_PORT || 3995), '127.0.0.1', () => console.log('teste em', process.env.TESTE_PORT || 3995, process.env.DATABASE_URL ? 'COM banco' : 'SEM banco'));

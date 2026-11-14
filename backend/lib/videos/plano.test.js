// Plano visual do formato Destrava (IA gratuita, uma vez por vídeo): o que a IA manda só entra se o editor sabe desenhar.
// node --test backend/lib/videos/plano.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('./plano');

const FRASES = [
  'Você não precisa de investidor milionário para criar uma marca gigante.',
  'Steve Jobs voltou para a Apple em 1997.',
  'Ela focou em duas coisas: produto bom e preço justo.',
  'Pesquise no Google como crescer sem investidor.',
  'Em 2012 a margem chegou a 70%.',
];

test('normaliza: tipos conhecidos, número só se está na frase, pessoa só se é citada, gancho e clima', () => {
  const p = P.normalizarPlano({
    gancho: 'Sem investidor milionário.', clima: 'tensa',
    cenas: [
      { i: 0, tipo: 'imagem', titulo: 'Sem investidor', busca: 'luxury jewelry boutique' },
      { i: 1, tipo: 'pessoa', titulo: 'A volta', pessoa: 'Steve Jobs' },
      { i: 2, tipo: 'lista', titulo: '2 pilares', itens: ['Produto bom', 'Preço justo'] },
      { i: 3, tipo: 'celular', texto: 'como crescer sem investidor' },
      { i: 4, tipo: 'numero', titulo: 'Margem', destaque: '85%' },   // número que a frase não diz → vira ícone
    ],
  }, FRASES);
  assert.strictEqual(p.gancho, 'Sem investidor milionário');
  assert.strictEqual(p.clima, 'tensa');
  assert.deepStrictEqual(p.cenas.map((c) => c.tipo), ['imagem', 'pessoa', 'lista', 'celular', 'icone']);
  assert.strictEqual(p.cenas[1].pessoa, 'Steve Jobs');
  assert.deepStrictEqual(p.cenas[2].itens, ['Produto bom', 'Preço justo']);
  assert.strictEqual(p.cenas[3].texto, 'como crescer sem investidor');
});

test('pessoa que a frase não cita não vira foto; tipo desconhecido e clima inválido caem no padrão', () => {
  const p = P.normalizarPlano({ clima: 'eufórica', cenas: [{ tipo: 'pessoa', pessoa: 'Elon Musk', busca: 'rocket launch', titulo: 'Foguete' }, { tipo: 'holograma' }] }, FRASES.slice(0, 2));
  assert.deepStrictEqual(p.cenas[0], { tipo: 'imagem', busca: 'rocket launch', titulo: 'Foguete' });
  assert.deepStrictEqual(p.cenas[1], {});
  assert.strictEqual(p.clima, 'calma'); assert.strictEqual(p.gancho, '');
});

test('planoDoVideo: gera uma vez (IA gratuita), guarda no vídeo e devolve o guardado depois; o hash tem versão', async () => {
  const doc = { id: 'vd_1', video: {} }; let rev = 1; const chamadas = [];
  const V = { _ler: async () => ({ doc: JSON.parse(JSON.stringify(doc)), rev }), _gravar: async (d) => { doc.video = d.video; rev += 1; } };
  const pedir = async (args) => { chamadas.push(args); return { dados: { gancho: 'Sem investidor', clima: 'animada', cenas: FRASES.map((f, i) => ({ i, tipo: 'icone', titulo: `Ideia ${i}` })) }, llm: { provider: 'groq' } }; };
  const r1 = await P.planoDoVideo('vd_1', { titulo: 'Marca forte', frases: FRASES }, { deps: { V, pedir } });
  assert.strictEqual(r1.fonte, 'groq'); assert.strictEqual(r1.gancho, 'Sem investidor'); assert.strictEqual(r1.clima, 'animada');
  assert.strictEqual(chamadas.length, 1); assert.strictEqual(chamadas[0].pago, 'nunca');
  const r2 = await P.planoDoVideo('vd_1', { titulo: 'Marca forte', frases: FRASES }, { deps: { V, pedir } });
  assert.strictEqual(r2.fonte, 'guardado'); assert.strictEqual(r2.gancho, 'Sem investidor'); assert.strictEqual(chamadas.length, 1);
  assert.notStrictEqual(P.hashDe('t', ['a']), require('crypto').createHash('sha1').update('t\na').digest('hex').slice(0, 16));
});

test('planoDoVideo: plano quase vazio da IA é recusado (o editor segue com as regras)', async () => {
  const V = { _ler: async () => ({ doc: { id: 'vd_2', video: {} }, rev: 1 }), _gravar: async () => {} };
  const pedir = async () => ({ dados: { cenas: [{ tipo: 'holograma' }] }, llm: { provider: 'groq' } });
  await assert.rejects(P.planoDoVideo('vd_2', { titulo: 'x', frases: FRASES }, { deps: { V, pedir } }), (e) => e.code === 'PLANO_VAZIO');
});

// Patch mínimo de produção: identidade fixa e nenhum selo falso.
// node --test backend/lib/identidade.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('o @ e o nome não mudam por variável de ambiente', () => {
  process.env.PROFILE_HANDLE = '@pedrodestrava';
  process.env.PROFILE_NAME = 'Outro Nome';
  process.env.INSTAGRAM_USERNAME = 'pedrodestrava';
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}backend${path.sep}`)) delete require.cache[k];
  const dna = require('./pedroDna');
  assert.strictEqual(dna.PROFILE_HANDLE, '@pedro_destrava');
  assert.strictEqual(dna.PROFILE_NAME, 'Pedro Martins');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['lib/viralRender.js', 'routes/carousels.js', 'lib/profileInsights.js', 'lib/pedroDna.js']) {
    assert.ok(!/process\.env\.(PROFILE_HANDLE|PROFILE_NAME|INSTAGRAM_USERNAME)/.test(src(f)), `${f} ainda lê o @ do ambiente`);
  }
});

test('leitura do perfil recusa outra conta', async () => {
  const axios = require('axios');
  const original = axios.get;
  axios.get = async () => ({ data: { id: '999', edge_followed_by: { count: 1 } } });
  try {
    for (const k of Object.keys(require.cache)) if (k.endsWith('profileInsights.js')) delete require.cache[k];
    const pi = require('./profileInsights');
    process.env.RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'chave-falsa';
    await assert.rejects(() => pi.getInsights({ force: true }), /outra conta/);
    assert.ok(!pi.lastInsights(), 'nada da outra conta ficou guardado');
  } finally { axios.get = original; }
});

test('nenhum gerador desenha selo de verificado', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.ok(!/1D9BF0/.test(src('lib/viralRender.js')), 'template Print');
  const chamadas = [...src('routes/tvCuts.js').matchAll(/\$\{([^}]*)viralBadgeSvg\(/g)].map((m) => m[1]);
  assert.ok(chamadas.length && chamadas.every((p) => /ACCOUNT\.verified \?/.test(p)), 'cortes de TV');
  assert.match(src('routes/videoEditor.js'), /const PROFILE_VERIFIED = require\('\.\.\/lib\/account'\)\.ACCOUNT\.verified === true;/);
  assert.strictEqual(require('./account').ACCOUNT.verified, false);
});

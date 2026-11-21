// Formatos de carrossel de topo de funil (ver docs/CARROSSEIS_DIALOGO_E_PAPEL.md):
//   POST /api/carrosseis/dialogo          diálogo ilustrado (uma cena, balões mudando)
//   POST /api/carrosseis/papel-de-parede  capa + uma frase por tela sobre foto
//   POST /api/carrosseis/marca            "Por trás da marca": link da matéria → carrossel do pipeline top (assíncrono)
// Montadas DEPOIS do porteiro de acesso (server.js: app.use('/api', access.exigeAcesso)): exigem o mesmo login das
// outras rotas. Criam o conteúdo, desenham as telas e guardam; o carrossel aparece em "Carrosséis para validar".
const express = require('express');
const { limita } = require('../lib/access');
const F = require('../lib/formatosCarrossel');

const router = express.Router();
const limite = limita({ max: 10, janelaMs: 60000, nome: 'carrosseis' });

// Erro de entrada volta com a mensagem; erro interno volta com mensagem fixa (nada de corpo cru de API nem chave).
const responder = (fn) => async (req, res) => {
  try { res.status(201).json(await fn(req.body || {})); } catch (e) {
    const status = Number(e.status) || 500;
    if (status >= 500 && status !== 503) console.error('[carrosseis]', e.code || e.name || 'erro');
    res.status(status).json({ error: status < 500 || status === 503 ? e.message : 'Não consegui criar o carrossel agora. Tente de novo.', code: e.code || 'ERRO' });
  }
};

router.post('/dialogo', limite, responder((b) => F.criarDialogo(b)));
router.post('/papel-de-parede', limite, responder((b) => F.criarPapelDeParede(b)));

// "Por trás da marca" (docs/CARROSSEL_TOP.md): cria pelo pipeline top com formato 'marca' e devolve o id na hora; os
// passos (fatos, ângulo, roteiro, júri, fotos, arte) andam pelas rodadas do piloto ou por POST /api/top/carrosseis/:id/passo.
// Corpo: { link: "https://…matéria", marca?: "Milky Moo", fotos?: ["https://…jpg", …] (uma por slide), foco?: "texto livre", instagram?: "@perfil_oficial_da_marca" }
router.post('/marca', limite, responder(async (b) => {
  const T = require('../lib/top/pipeline');
  if (!b.link && !b.url && !b.texto) throw Object.assign(new Error('Envie o link da matéria sobre a marca.'), { status: 400, code: 'ENTRADA' });
  const c = await T.criar({ url: b.link || b.url || null, texto: b.texto || null, titulo: b.titulo, origem: 'manual', formato: 'marca', marca: b.marca, fotos: b.fotos, foco: b.foco, instagram: b.instagram });
  try { await require('../lib/top/piloto').registrar(c.id, { titulo: c.titulo }); } catch { /* sem banco: o app conduz os passos */ }
  return { ...T.resumo(c), formato: 'marca', passo: `/api/top/carrosseis/${encodeURIComponent(c.id)}/passo` };
}));

module.exports = router;

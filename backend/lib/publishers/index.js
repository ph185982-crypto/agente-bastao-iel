// Interface comum dos publicadores: { name, canPublish(item), publish(id, opts), getStatus(id) }.
//  - instagram: implementado (máquina de estados em ../publicador.js);
//  - facebook: opcional, desligado por padrão (publishers/facebook.js);
//  - linkedin: perfil do Pedro, depois do Instagram e só do que foi aprovado (../linkedin.js).
const P = require('../publicador');
const fb = require('./facebook');

const instagram = {
  name: 'instagram',
  canPublish: async (id) => { try { await P.carregarAprovado(id); return true; } catch { return false; } },
  publish: (id, opts) => P.iniciar(id, opts),
  getStatus: (id) => P.avancar(id),
};
const facebook = {
  name: 'facebook',
  canPublish: async (id) => { const cfg = await P.config(); if (!cfg.publishers?.facebook) return false; try { await P.carregarAprovado(id); return true; } catch { return false; } },
  publish: (id, opts) => fb.publicar(id, opts),
  getStatus: (id) => fb.status(id),
};
const linkedin = {
  name: 'linkedin',
  canPublish: async (id) => { const L = require('../linkedin'); const e = await L.estado(); if (!e.ativo) return false; try { await P.carregarAprovado(id); return true; } catch { return false; } },
  publish: (id, opts) => require('../linkedin').publicar(id, opts),
  getStatus: async (id) => { const p = await require('../armazem').armazem().publicacoes.obter(P.conta(), id, 'linkedin'); return p ? P.resposta(p) : null; },
};
const PUBLICADORES = { instagram, facebook, linkedin };
module.exports = { PUBLICADORES, instagram, facebook, linkedin };

// Interface comum dos publicadores: { name, canPublish(item), publish(id, opts), getStatus(id) }.
//  - instagram: implementado (máquina de estados em ../publicador.js);
//  - facebook: opcional, desligado por padrão (publishers/facebook.js);
//  - linkedin: SÓ o esqueleto — o acesso à API ainda será solicitado; nada é implementado.
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
  canPublish: async () => false,
  publish: async () => { throw new P.ErroPub('NAO_IMPLEMENTADO', 'A publicação no LinkedIn ainda não foi implementada (aguardando o acesso à API).', 501); },
  getStatus: async () => null,
};

const PUBLICADORES = { instagram, facebook, linkedin };
module.exports = { PUBLICADORES, instagram, facebook, linkedin };

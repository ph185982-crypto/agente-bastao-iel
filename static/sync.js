// Cópia no servidor, vista do navegador.
//
// Regras:
//  - o navegador continua com a sua cópia; nada local é apagado por causa do servidor;
//  - um conteúdo só conta como "salvo no servidor" depois de LIDO DE VOLTA e o hash
//    conferir com o que foi enviado;
//  - se outro aparelho gravou antes, não sobrescreve: marca conflito e o Pedro escolhe;
//  - antes de trocar a cópia local pela do servidor, guarda um snapshot local.
(function () {
  'use strict';
  const M = window.ContentModel;
  const S = window.Store;

  const meta = async (id) => (await S.cfgGet(`sync:${id}`)) || null;
  const gravaMeta = (id, m) => S.cfgSet(`sync:${id}`, m);

  async function sha256Doc(doc) {
    const bytes = new TextEncoder().encode(M.canonico(JSON.parse(JSON.stringify(doc))));
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function req(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Erro ${r.status}`), { status: r.status, code: j.code, detalhe: j });
    return j;
  }

  let _status = null;
  async function status(forcar) {
    if (_status && !forcar) return _status;
    try { _status = await req('/api/sync/status'); } catch (e) { _status = { configurado: false, erro: e.message }; }
    return _status;
  }

  // Envia um conteúdo e confere lendo de volta.
  async function enviar(c) {
    const m = (await meta(c.id)) || {};
    if (m.conflito) return { id: c.id, estado: 'conflito' };
    const local = await sha256Doc(c);
    if (m.hash === local && m.rev) return { id: c.id, estado: 'igual', rev: m.rev };
    try {
      const r = await req(`/api/sync/conteudos/${encodeURIComponent(c.id)}`, { method: 'PUT', body: { doc: c, base_rev: m.rev || 0 } });
      const lido = await req(`/api/sync/conteudos/${encodeURIComponent(c.id)}`);
      const conferido = lido.rev === r.rev && lido.hash === r.hash && (await sha256Doc(lido.doc)) === local && r.hash === local;
      if (!conferido) {
        await gravaMeta(c.id, { ...m, erro: 'A cópia lida de volta não confere com a enviada.', em: new Date().toISOString() });
        return { id: c.id, estado: 'nao_conferido' };
      }
      await gravaMeta(c.id, { rev: r.rev, hash: r.hash, em: new Date().toISOString(), conferido: true });
      return { id: c.id, estado: 'enviado', rev: r.rev };
    } catch (e) {
      if (e.status === 409) {
        await gravaMeta(c.id, { ...m, conflito: true, rev_remoto: e.detalhe?.rev_atual, em: new Date().toISOString() });
        return { id: c.id, estado: 'conflito' };
      }
      await gravaMeta(c.id, { ...m, erro: e.message, em: new Date().toISOString() });
      return { id: c.id, estado: 'erro', erro: e.message };
    }
  }

  // Traz do servidor o que não existe aqui ou o que mudou lá sem mudar aqui.
  async function puxar() {
    const { conteudos } = await req('/api/sync/conteudos');
    const out = { novos: 0, atualizados: 0, conflitos: 0 };
    for (const r of conteudos) {
      const local = await S.obter(r.id);
      const m = (await meta(r.id)) || {};
      if (!local) {
        const d = await req(`/api/sync/conteudos/${encodeURIComponent(r.id)}`);
        if ((await sha256Doc(d.doc)) !== d.hash) continue;
        await S.salvarExato(d.doc);
        await gravaMeta(r.id, { rev: d.rev, hash: d.hash, em: new Date().toISOString(), conferido: true, origem: 'servidor' });
        out.novos += 1;
        continue;
      }
      if (r.rev === m.rev) continue;
      const mudouAqui = (await sha256Doc(local)) !== m.hash;
      if (!m.rev || mudouAqui) {
        if (r.hash === (await sha256Doc(local))) { await gravaMeta(r.id, { rev: r.rev, hash: r.hash, em: new Date().toISOString(), conferido: true }); continue; }
        await gravaMeta(r.id, { ...m, conflito: true, rev_remoto: r.rev, em: new Date().toISOString() });
        out.conflitos += 1;
        continue;
      }
      const d = await req(`/api/sync/conteudos/${encodeURIComponent(r.id)}`);
      if ((await sha256Doc(d.doc)) !== d.hash) continue;
      await S.snapshot(local, 'antes de trazer do servidor');
      await S.salvarExato(d.doc);
      await gravaMeta(r.id, { rev: d.rev, hash: d.hash, em: new Date().toISOString(), conferido: true });
      out.atualizados += 1;
    }
    return out;
  }

  // Conflito: o Pedro escolhe. Nenhuma das duas cópias é perdida.
  async function resolverConflito(id, escolha) {
    const local = await S.obter(id);
    const remoto = await req(`/api/sync/conteudos/${encodeURIComponent(id)}`);
    if (escolha === 'servidor') {
      if (local) await S.snapshot(local, 'conflito: cópia deste aparelho');
      await S.salvarExato(remoto.doc);
      await gravaMeta(id, { rev: remoto.rev, hash: remoto.hash, em: new Date().toISOString(), conferido: true });
      return 'servidor';
    }
    // manter a deste aparelho: grava por cima; a do servidor fica no histórico de revisões de lá
    await gravaMeta(id, { rev: remoto.rev, hash: null, em: new Date().toISOString() });
    return (await enviar(local)).estado;
  }

  // Migração/sincronização completa: envia tudo, confere, traz o que falta.
  let rodando = null;
  async function sincronizarTudo() {
    if (rodando) return rodando;
    rodando = (async () => {
      const st = await status(true);
      if (!st.configurado) return { configurado: false };
      const lista = await S.listar();
      const res = { configurado: true, enviados: 0, iguais: 0, conflitos: 0, erros: 0, nao_conferidos: 0 };
      for (const c of lista) {
        const r = await enviar(c);
        res[{ enviado: 'enviados', igual: 'iguais', conflito: 'conflitos', erro: 'erros', nao_conferido: 'nao_conferidos' }[r.estado]] += 1;
      }
      const p = await puxar();
      Object.assign(res, { trazidos: p.novos, atualizados: p.atualizados, conflitos: res.conflitos + p.conflitos, em: new Date().toISOString() });
      await S.cfgSet('sync_ultimo', res);
      return res;
    })().finally(() => { rodando = null; });
    return rodando;
  }

  // Envio automático (alguns segundos depois da última alteração).
  const fila = new Map();
  function agendar(c) {
    clearTimeout(fila.get(c.id));
    fila.set(c.id, setTimeout(async () => { fila.delete(c.id); if ((await status()).configurado) { await enviar(c); window.dispatchEvent(new CustomEvent('pico-sync', { detail: { id: c.id } })); } }, 3000));
  }

  // Arquivos (fotos, encerramento aprovado, exportações).
  async function enviarArquivo(chave, blob) {
    const b64 = await new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1]); f.onerror = () => no(new Error('Não consegui ler o arquivo.')); f.readAsDataURL(blob); });
    return req(`/api/sync/arquivos/${encodeURIComponent(chave)}`, { method: 'PUT', body: { tipo: blob.type, base64: b64 } });
  }
  async function baixarArquivo(chave) {
    const r = await fetch(`/api/sync/arquivos/${encodeURIComponent(chave)}`);
    if (!r.ok) return null;
    return r.blob();
  }

  window.Sync = { status, enviar, puxar, sincronizarTudo, agendar, resolverConflito, meta, enviarArquivo, baixarArquivo, sha256Doc };
})();

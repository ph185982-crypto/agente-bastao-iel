// Persistência do trabalho no aparelho (IndexedDB), com versões, backup e restauração.
//
// Garantias:
//  - cada alteração é gravada na hora (ou em até 400 ms, com gravação forçada ao
//    sair/ocultar a aba): fechar a página não perde o trabalho;
//  - nada é apagado calado: dado sem origem vai para a QUARENTENA (com motivo),
//    a fila antiga continua intacta no banco, e restaurar nunca sobrescreve uma
//    versão mais nova sem antes guardar a existente;
//  - backup automático (1 por dia, guarda os 7 últimos) e antes de qualquer migração;
//  - exportar/importar um arquivo único, que serve para trocar de aparelho.
// Sincronização entre aparelhos exige um banco no servidor e ainda não existe.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./contentModel') : root.ContentModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this, function (M) {
  const DB_NAME = 'pico-esteira';
  const DB_VERSION = 2;
  const FORMATO_BACKUP = 'pico-backup';
  const MAX_BACKUPS = 7;
  const MAX_SNAPSHOTS = 20;

  // ── Funções puras (testáveis no Node) ──────────────────────────────────────
  function validarBackup(obj) {
    const erros = [];
    if (!obj || typeof obj !== 'object') return { ok: false, erros: ['O arquivo não é um backup.'] };
    if (obj.formato !== FORMATO_BACKUP) erros.push('Formato de arquivo desconhecido.');
    if (!Array.isArray(obj.conteudos)) erros.push('O backup não traz conteúdos.');
    (obj.conteudos || []).forEach((c, i) => {
      if (!c || typeof c.id !== 'string' || !c.copia || !c.conta) erros.push(`Conteúdo ${i + 1} incompleto.`);
      else if (c.schema > M.SCHEMA) erros.push(`Conteúdo ${i + 1} é de uma versão mais nova do app.`);
    });
    return { ok: erros.length === 0, erros };
  }

  // Decide o que fazer com um conteúdo do backup que já existe no aparelho.
  function decidirMescla(existente, novo) {
    if (!existente) return 'adicionar';
    const a = Date.parse(existente.updated_at || 0);
    const b = Date.parse(novo.updated_at || 0);
    if (b > a) return 'substituir_guardando_atual';
    if (b === a) return 'igual';
    return 'manter_atual';
  }

  function serializar({ conteudos, blobsBase64 = [], extras = {} }) {
    return {
      formato: FORMATO_BACKUP,
      schema: M.SCHEMA,
      exportado_em: new Date().toISOString(),
      conta: M.ACCOUNT_PIN,
      conteudos,
      blobs: blobsBase64,
      ...extras,
      aviso: 'Artes (PNG) não vão no arquivo: são refeitas a partir do texto aprovado. Imagens enviadas por você vão.',
    };
  }

  // Alertas visíveis na lista (nada some em silêncio).
  function alertasDoConteudo(c) {
    const a = [];
    const texto = `${c.legado?.legenda || ''} ${(M.versaoAtiva(c)?.legenda) || ''}`;
    if (M.HANDLES_ERRADOS.some((h) => new RegExp(`@${h}(?![a-z0-9_])`, 'i').test(texto))) a.push('@ errado na legenda');
    if (c.legado) a.push('gerado antes da base de evidências');
    return a;
  }

  const puro = { validarBackup, decidirMescla, serializar, alertasDoConteudo };

  // ── Navegador ──────────────────────────────────────────────────────────────
  if (typeof indexedDB === 'undefined') return { puro, ok: false };

  let _db = null;
  let _okEstado = { ok: true, erro: null, persistente: null };

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tem = (n) => db.objectStoreNames.contains(n);
        // v1 (fila antiga): items, assets, kv. Não mexe neles.
        if (!tem('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!tem('assets')) db.createObjectStore('assets');
        if (!tem('kv')) db.createObjectStore('kv');
        // v2
        if (!tem('contents')) db.createObjectStore('contents', { keyPath: 'id' });
        if (!tem('snapshots')) db.createObjectStore('snapshots');
        if (!tem('blobs')) db.createObjectStore('blobs');
        if (!tem('backups')) db.createObjectStore('backups', { keyPath: 'id' });
        if (!tem('quarantine')) db.createObjectStore('quarantine', { autoIncrement: true });
        if (!tem('memory')) db.createObjectStore('memory', { keyPath: 'id' });
        if (!tem('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => { _db = req.result; _db.onversionchange = () => { _db.close(); _db = null; }; resolve(_db); };
      req.onerror = () => { _okEstado = { ok: false, erro: String(req.error?.message || req.error), persistente: false }; reject(req.error); };
      req.onblocked = () => reject(new Error('Feche as outras abas do app para atualizar o armazenamento.'));
    });
  }

  async function tx(store, mode, fn) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      try { out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => { _okEstado.erro = String(t.error?.message || t.error); reject(t.error); };
      t.onabort = () => { _okEstado.erro = String(t.error?.message || t.error); reject(t.error || new Error('Gravação cancelada')); };
    });
  }

  const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
  const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
  const put = (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
  const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
  const keys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());

  // ── Conteúdos ─────────────────────────────────────────────────────────────
  const _pendentes = new Map();
  let _timer = null;

  async function salvar(c) {
    c.updated_at = new Date().toISOString();
    await put('contents', c);
    _pendentes.delete(c.id);
    return c;
  }
  // Grava exatamente o documento recebido (sincronização): não mexe em updated_at,
  // senão o hash conferido com o servidor deixaria de bater.
  async function salvarExato(c) { await put('contents', c); _pendentes.delete(c.id); return c; }
  // Grava logo mais (digitação); flush() força. Sempre grava o objeto mais recente.
  function salvarLogo(c) {
    _pendentes.set(c.id, c);
    clearTimeout(_timer);
    _timer = setTimeout(flush, 400);
  }
  async function flush() {
    clearTimeout(_timer);
    const lista = [..._pendentes.values()];
    for (const c of lista) await salvar(c);
    return lista.length;
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', () => { flush(); });
  }

  const listar = async () => (await getAll('contents')).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const obter = (id) => get('contents', id);

  async function snapshot(c, motivo) {
    const n = Date.now();
    await put('snapshots', { id: c.id, n, em: new Date().toISOString(), motivo, conteudo: M.clone(c) }, `${c.id}@${n}`);
    const todas = (await keys('snapshots')).filter((k) => String(k).startsWith(`${c.id}@`)).sort();
    for (const k of todas.slice(0, Math.max(0, todas.length - MAX_SNAPSHOTS))) await del('snapshots', k);
  }
  async function snapshotsDe(id) {
    const todas = await getAll('snapshots');
    return todas.filter((s) => s.id === id).sort((a, b) => b.n - a.n);
  }

  async function apagarConteudo(id, { motivo = 'apagado por você' } = {}) {
    const c = await obter(id);
    if (!c) return false;
    // "Apagar" arquiva e guarda uma cópia na quarentena; a recuperação existe.
    await put('quarantine', { em: new Date().toISOString(), motivo, origem: `conteudo:${id}`, dado: c });
    await del('contents', id);
    return true;
  }

  // ── Blobs (imagens enviadas, artes) ────────────────────────────────────────
  const salvarBlob = (key, blob, meta = {}) => put('blobs', { blob, tipo: blob.type, em: new Date().toISOString(), ...meta }, key);
  const obterBlob = async (key) => (await get('blobs', key)) || null;
  const apagarBlob = (key) => del('blobs', key);

  // ── Configurações e quarentena ─────────────────────────────────────────────
  const cfgGet = (k) => get('settings', k);
  const cfgSet = (k, v) => put('settings', v, k);
  const quarentena = () => getAll('quarantine');
  const isolar = (motivo, origem, dado) => put('quarantine', { em: new Date().toISOString(), motivo, origem, dado });

  // ── Backups ────────────────────────────────────────────────────────────────
  async function coletar({ incluirBlobsEnviados = false } = {}) {
    const conteudos = await listar();
    let blobsBase64 = [];
    if (incluirBlobsEnviados) {
      for (const k of await keys('blobs')) {
        if (!String(k).startsWith('upload:')) continue;
        const b = await obterBlob(k);
        if (b?.blob) blobsBase64.push({ key: k, tipo: b.tipo, base64: await blobParaBase64(b.blob) });
      }
    }
    const extras = { configuracoes: Object.fromEntries(await Promise.all((await keys('settings')).map(async (k) => [k, await cfgGet(k)]))) };
    return serializar({ conteudos, blobsBase64, extras });
  }
  function blobParaBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  }
  function base64ParaBlob(b64, tipo) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: tipo || 'application/octet-stream' });
  }

  async function criarBackupAutomatico(motivo = 'automático') {
    const dados = await coletar();
    const id = `b_${Date.now()}`;
    await put('backups', { id, em: new Date().toISOString(), motivo, n: dados.conteudos.length, dados: JSON.stringify(dados) });
    const todos = (await getAll('backups')).sort((a, b) => b.id.localeCompare(a.id));
    for (const b of todos.slice(MAX_BACKUPS)) await del('backups', b.id);
    return id;
  }
  async function backupDiarioSeNecessario() {
    const todos = (await getAll('backups')).sort((a, b) => b.id.localeCompare(a.id));
    const ultimo = todos[0] && Date.parse(todos[0].em);
    if (!ultimo || Date.now() - ultimo > 20 * 3600e3) {
      if ((await keys('contents')).length) return criarBackupAutomatico('diário');
    }
    return null;
  }
  const listarBackups = async () => (await getAll('backups')).sort((a, b) => b.id.localeCompare(a.id)).map(({ dados, ...r }) => r);

  async function exportar() {
    const dados = await coletar({ incluirBlobsEnviados: true });
    return new Blob([JSON.stringify(dados)], { type: 'application/json' });
  }

  // Mescla um backup (objeto) no aparelho SEM apagar nada.
  async function importarObjeto(obj) {
    const v = validarBackup(obj);
    if (!v.ok) { const e = new Error(v.erros[0]); e.erros = v.erros; throw e; }
    await criarBackupAutomatico('antes de importar');
    const r = { adicionados: 0, substituidos: 0, mantidos: 0, iguais: 0 };
    for (const novo of obj.conteudos) {
      const atual = await obter(novo.id);
      const acao = decidirMescla(atual, novo);
      if (acao === 'adicionar') { await put('contents', novo); r.adicionados += 1; }
      else if (acao === 'substituir_guardando_atual') { await snapshot(atual, 'antes de restaurar backup'); await put('contents', novo); r.substituidos += 1; }
      else if (acao === 'manter_atual') { r.mantidos += 1; }
      else r.iguais += 1;
    }
    for (const b of obj.blobs || []) await salvarBlob(b.key, base64ParaBlob(b.base64, b.tipo), { restaurado: true });
    for (const [k, val] of Object.entries(obj.configuracoes || {})) if (val !== undefined && (await cfgGet(k)) === undefined) await cfgSet(k, val);
    return r;
  }
  async function importarArquivo(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error('O arquivo não é um backup válido (JSON ilegível).'); }
    return importarObjeto(obj);
  }
  async function restaurarBackup(id) {
    const b = await get('backups', id);
    if (!b) throw new Error('Backup não encontrado.');
    return importarObjeto(JSON.parse(b.dados));
  }

  // ── Migração da fila antiga e quarentena ──────────────────────────────────
  // Idempotente: roda uma vez; a fila antiga (items/assets/kv) continua no banco.
  async function migrar() {
    const feito = await cfgGet('migracao_v2');
    const resumo = { itens: 0, quarentena: [], jaFeita: !!feito };
    const antigos = await getAll('items');
    if (!feito) {
      if (antigos.length) await criarBackupAutomatico('antes da migração');
      for (const it of antigos) {
        const c = M.migrarItemLegado(it);
        if (await obter(c.id)) continue;
        // Arquivos antigos: copia os blobs, não move.
        const arqs = (await get('assets', it.id)) || [];
        arqs.forEach((a, i) => { if (a.blob) salvarBlob(`legacy:${it.id}:${i}`, a.blob, { content_id: c.id, nome: a.name }); });
        await put('contents', c);
        resumo.itens += 1;
      }
      await cfgSet('migracao_v2', { em: new Date().toISOString(), itens: resumo.itens, schema: M.SCHEMA });
    }
    // Dado sem origem de conta: isola, não usa mais e registra o motivo.
    for (const chave of ['insights', 'pautas']) {
      const v = await get('kv', chave);
      if (!v) continue;
      const temOrigem = chave === 'insights' && v.conta && v.conta.ok === true && v.conta.ig_id === M.ACCOUNT_PIN.ig_id && v.schema === M.SCHEMA;
      if (!temOrigem) {
        await isolar(chave === 'insights' ? 'Leitura do Instagram sem origem de conta (pode ser de outra conta)' : 'Pautas geradas sem origem confirmada (a leitura do perfil usada podia ser de outra conta)', `kv:${chave}`, v);
        await del('kv', chave);
        resumo.quarentena.push(chave);
      }
    }
    return resumo;
  }

  async function pedirPersistencia() {
    try {
      if (navigator.storage?.persist) _okEstado.persistente = await navigator.storage.persist();
      if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); _okEstado.uso = e.usage; _okEstado.cota = e.quota; }
    } catch { /* sem suporte */ }
    return _okEstado;
  }

  async function iniciar() {
    try {
      await abrir();
      const mig = await migrar();
      await backupDiarioSeNecessario();
      await pedirPersistencia();
      return { ok: true, migracao: mig, estado: _okEstado };
    } catch (e) {
      _okEstado.ok = false; _okEstado.erro = String(e?.message || e);
      return { ok: false, erro: _okEstado.erro, estado: _okEstado };
    }
  }

  return {
    puro, ok: true, iniciar, estado: () => _okEstado,
    listar, obter, salvar, salvarExato, salvarLogo, flush, snapshot, snapshotsDe, apagarConteudo,
    salvarBlob, obterBlob, apagarBlob, cfgGet, cfgSet, quarentena, isolar,
    listarBackups, criarBackupAutomatico, exportar, importarArquivo, importarObjeto, restaurarBackup, migrar,
    _raw: { getAll, get, put, del, keys },
  };
});

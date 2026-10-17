// Armazenamento no servidor: a cópia que sobrevive à perda do navegador.
//
// Três coisas diferentes, guardadas de jeitos diferentes:
//  - conteúdo estruturado e versões  → banco Postgres (Neon pela Vercel);
//    cada gravação guarda a revisão anterior (histórico de 30 revisões);
//  - arquivos (fotos, encerramento aprovado, exportações) → por enquanto no
//    mesmo banco, com limite de tamanho; o recomendado para volume é um
//    armazenamento de arquivos (Cloudflare R2), ainda NÃO contratado;
//  - resultado de etapas (pesquisa, redação) → tabela de tarefas, para retomar
//    depois de fechar a aba sem refazer nem pagar de novo.
//
// Tudo é separado por conta (ig_id fixo). Gravação usa controle de revisão: se
// outro aparelho gravou antes, a gravação é recusada (conflito) em vez de
// sobrescrever.
const crypto = require('crypto');

const LIMITE_ARQUIVO = 8 * 1024 * 1024;
const HISTORICO = 30;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const hashDoc = (doc) => sha256(canon(doc));

const erro = (msg, code, extra) => Object.assign(new Error(msg), { code, ...(extra || {}) });

const resumo = (d) => ({
  titulo: d.titulo || '', status: d.status || null, formato: d.formato || null, atualizado: d.updated_at || null,
  versao: d.copia?.versao_ativa || null, legado: !!d.legado, schema: d.schema || null,
});

function validaDoc(conta, id, doc) {
  if (!doc || typeof doc !== 'object' || doc.id !== id) throw erro('Documento inválido.', 'ENTRADA');
  if (doc.conta?.ig_id && String(doc.conta.ig_id) !== String(conta)) throw erro('Este conteúdo pertence a outra conta.', 'CONTA');
  const tam = Buffer.byteLength(JSON.stringify(doc));
  if (tam > 4 * 1024 * 1024) throw erro('Conteúdo grande demais para gravar (acima de 4 MB).', 'TAMANHO');
}

// ── Memória (testes) ───────────────────────────────────────────────────────
function memoria() {
  const docs = new Map(); const hist = []; const arqs = new Map(); const jobs = new Map();
  const k = (c, id) => `${c}|${id}`;
  return {
    tipo: 'memoria', duravel: false,
    async iniciar() {},
    conteudos: {
      async listar(conta) { return [...docs.entries()].filter(([key]) => key.startsWith(`${conta}|`)).map(([, v]) => ({ id: v.doc.id, rev: v.rev, hash: v.hash, atualizado_em: v.em, resumo: resumo(v.doc) })); },
      async obter(conta, id) { const v = docs.get(k(conta, id)); return v ? { doc: JSON.parse(JSON.stringify(v.doc)), rev: v.rev, hash: v.hash } : null; },
      async salvar(conta, id, doc, baseRev) {
        validaDoc(conta, id, doc);
        const atual = docs.get(k(conta, id));
        if ((atual?.rev || 0) !== (baseRev || 0)) throw erro('Outro aparelho gravou uma versão mais nova.', 'CONFLITO', { rev_atual: atual?.rev || 0 });
        if (atual) hist.push({ conta, id, rev: atual.rev, hash: atual.hash, doc: atual.doc });
        const v = { doc: JSON.parse(JSON.stringify(doc)), rev: (atual?.rev || 0) + 1, hash: hashDoc(doc), em: new Date().toISOString() };
        docs.set(k(conta, id), v);
        return { rev: v.rev, hash: v.hash };
      },
      async historico(conta, id) { return hist.filter((h) => h.conta === conta && h.id === id).map(({ rev, hash }) => ({ rev, hash })); },
    },
    arquivos: {
      async salvar(conta, chave, dados, tipo) {
        if (dados.length > LIMITE_ARQUIVO) throw erro('Arquivo acima de 8 MB.', 'TAMANHO');
        arqs.set(k(conta, chave), { dados: Buffer.from(dados), tipo, sha256: sha256(dados) });
        return { sha256: sha256(dados), tamanho: dados.length };
      },
      async obter(conta, chave) { return arqs.get(k(conta, chave)) || null; },
      async listar(conta) { return [...arqs.entries()].filter(([key]) => key.startsWith(`${conta}|`)).map(([key, v]) => ({ chave: key.split('|').slice(1).join('|'), tipo: v.tipo, tamanho: v.dados.length, sha256: v.sha256 })); },
    },
    jobs: {
      async iniciar(rid, etapa, conteudo) { if (!jobs.has(rid)) jobs.set(rid, { rid, etapa, conteudo_id: conteudo || null, estado: 'rodando', criado_em: new Date().toISOString() }); return jobs.get(rid); },
      async concluir(rid, resultado) { const j = jobs.get(rid); if (j) Object.assign(j, { estado: 'concluido', resultado, atualizado_em: new Date().toISOString() }); },
      async falhar(rid, msg) { const j = jobs.get(rid); if (j) Object.assign(j, { estado: 'erro', erro: msg, atualizado_em: new Date().toISOString() }); },
      async obter(rid) { return jobs.get(rid) || null; },
    },
  };
}

// ── Postgres (Neon em produção; Postgres local nos testes) ─────────────────
function postgres({ url, pool }) {
  let _pool = pool || null;
  const db = () => {
    if (!_pool) {
      const { Pool } = require('pg');
      _pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined });
    }
    return _pool;
  };
  const q = (sql, params) => db().query(sql, params);
  let pronto = null;
  const iniciar = () => (pronto ??= q(`
    create table if not exists pico_conteudos (conta text not null, id text not null, rev integer not null, hash text not null,
      atualizado_em timestamptz not null default now(), resumo jsonb not null, doc jsonb not null, primary key (conta, id));
    create table if not exists pico_conteudos_hist (conta text not null, id text not null, rev integer not null, hash text not null,
      gravado_em timestamptz not null default now(), doc jsonb not null, primary key (conta, id, rev));
    create table if not exists pico_arquivos (conta text not null, chave text not null, tipo text, tamanho integer, sha256 text,
      criado_em timestamptz not null default now(), dados bytea not null, primary key (conta, chave));
    create table if not exists pico_jobs (rid text primary key, etapa text, conteudo_id text, estado text not null,
      criado_em timestamptz not null default now(), atualizado_em timestamptz, resultado jsonb, erro text);
  `).catch((e) => { pronto = null; throw e; }));

  return {
    tipo: 'postgres', duravel: true, iniciar,
    conteudos: {
      async listar(conta) {
        await iniciar();
        const r = await q('select id, rev, hash, atualizado_em, resumo from pico_conteudos where conta = $1 order by atualizado_em desc', [conta]);
        return r.rows.map((x) => ({ id: x.id, rev: x.rev, hash: x.hash, atualizado_em: x.atualizado_em.toISOString(), resumo: x.resumo }));
      },
      async obter(conta, id) {
        await iniciar();
        const r = await q('select doc, rev, hash from pico_conteudos where conta = $1 and id = $2', [conta, id]);
        return r.rows[0] ? { doc: r.rows[0].doc, rev: r.rows[0].rev, hash: r.rows[0].hash } : null;
      },
      async salvar(conta, id, doc, baseRev) {
        validaDoc(conta, id, doc);
        await iniciar();
        const hash = hashDoc(doc);
        const c = await db().connect();
        try {
          await c.query('begin');
          const atual = (await c.query('select rev, hash, doc from pico_conteudos where conta = $1 and id = $2 for update', [conta, id])).rows[0];
          if ((atual?.rev || 0) !== (baseRev || 0)) {
            await c.query('rollback');
            throw erro('Outro aparelho gravou uma versão mais nova.', 'CONFLITO', { rev_atual: atual?.rev || 0 });
          }
          const rev = (atual?.rev || 0) + 1;
          if (atual) {
            await c.query('insert into pico_conteudos_hist (conta, id, rev, hash, doc) values ($1, $2, $3, $4, $5) on conflict do nothing', [conta, id, atual.rev, atual.hash, atual.doc]);
            await c.query('delete from pico_conteudos_hist where conta = $1 and id = $2 and rev <= $3', [conta, id, atual.rev - HISTORICO]);
          }
          await c.query(`insert into pico_conteudos (conta, id, rev, hash, atualizado_em, resumo, doc) values ($1, $2, $3, $4, now(), $5, $6)
            on conflict (conta, id) do update set rev = excluded.rev, hash = excluded.hash, atualizado_em = now(), resumo = excluded.resumo, doc = excluded.doc`,
          [conta, id, rev, hash, JSON.stringify(resumo(doc)), JSON.stringify(doc)]);
          await c.query('commit');
          return { rev, hash };
        } catch (e) {
          if (e.code !== 'CONFLITO') await c.query('rollback').catch(() => {});
          throw e;
        } finally { c.release(); }
      },
      async historico(conta, id) {
        await iniciar();
        return (await q('select rev, hash, gravado_em from pico_conteudos_hist where conta = $1 and id = $2 order by rev desc', [conta, id])).rows;
      },
    },
    arquivos: {
      async salvar(conta, chave, dados, tipo) {
        if (dados.length > LIMITE_ARQUIVO) throw erro('Arquivo acima de 8 MB.', 'TAMANHO');
        await iniciar();
        const h = sha256(dados);
        await q(`insert into pico_arquivos (conta, chave, tipo, tamanho, sha256, dados) values ($1, $2, $3, $4, $5, $6)
          on conflict (conta, chave) do update set tipo = excluded.tipo, tamanho = excluded.tamanho, sha256 = excluded.sha256, dados = excluded.dados, criado_em = now()`,
        [conta, chave, tipo, dados.length, h, dados]);
        return { sha256: h, tamanho: dados.length };
      },
      async obter(conta, chave) {
        await iniciar();
        const r = await q('select dados, tipo, sha256 from pico_arquivos where conta = $1 and chave = $2', [conta, chave]);
        return r.rows[0] ? { dados: r.rows[0].dados, tipo: r.rows[0].tipo, sha256: r.rows[0].sha256 } : null;
      },
      async listar(conta) {
        await iniciar();
        return (await q('select chave, tipo, tamanho, sha256 from pico_arquivos where conta = $1 order by criado_em desc', [conta])).rows;
      },
    },
    jobs: {
      async iniciar(rid, etapa, conteudo) {
        await iniciar();
        await q("insert into pico_jobs (rid, etapa, conteudo_id, estado) values ($1, $2, $3, 'rodando') on conflict (rid) do nothing", [rid, etapa, conteudo || null]);
      },
      async concluir(rid, resultado) { await q("update pico_jobs set estado = 'concluido', resultado = $2, atualizado_em = now() where rid = $1", [rid, JSON.stringify(resultado)]); },
      async falhar(rid, msg) { await q("update pico_jobs set estado = 'erro', erro = $2, atualizado_em = now() where rid = $1", [rid, String(msg).slice(0, 500)]); },
      async obter(rid) {
        await iniciar();
        const r = await q('select rid, etapa, conteudo_id, estado, criado_em, atualizado_em, resultado, erro from pico_jobs where rid = $1', [rid]);
        return r.rows[0] || null;
      },
    },
    async fechar() { if (_pool) await _pool.end(); _pool = null; pronto = null; },
  };
}

// Escolhe pelo ambiente. Sem banco configurado: null (o app avisa que a única
// cópia está no navegador).
let _atual;
function armazem() {
  if (_atual !== undefined) return _atual;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  _atual = url ? postgres({ url }) : null;
  return _atual;
}
const _definir = (a) => { _atual = a; };

module.exports = { armazem, memoria, postgres, hashDoc, canon, resumo, LIMITE_ARQUIVO, _definir };

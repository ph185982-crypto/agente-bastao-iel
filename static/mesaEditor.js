// Editor da Mesa (entrada B): link/texto → fonte → afirmações → pesquisa →
// briefing → texto → arte → revisão → exportação.
// Cada etapa grava o progresso no navegador assim que termina; se a conexão
// cair ou a página recarregar, o trabalho continua de onde parou.
// Nada aqui publica no Instagram: exportar gera arquivos para o Pedro postar.
(function () {
  'use strict';
  const M = window.ContentModel;
  const G = window.QualityGates;
  const S = window.Store;

  const ctx = () => window.Mesa.ctx();
  const x0 = ctx;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dia = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  const quando = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${dia(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  const PASSOS = ['leitura', 'afirmacoes', 'pesquisa', 'briefing', 'copy', 'arte'];
  const ROTULO = { leitura: 'Ler a fonte', afirmacoes: 'Afirmações', pesquisa: 'Conferir', briefing: 'Briefing', copy: 'Texto', arte: 'Arte' };
  const ESTADO_CLAIM = {
    sustentada: ['ok', 'Sustentada'], parcialmente_sustentada: ['warn', 'Só em parte'], contradita: ['err', 'Contradita'], nao_verificada: ['neutro', 'Não verificada'],
  };
  const RELACAO = { sustenta: 'Sustenta', contradiz: 'Contradiz', parcial: 'Parcial', neutra: 'Neutra' };
  const LAYOUTS = { capa_tipografica: 'Capa só texto', capa_foto: 'Capa com minha foto', explicacao: 'Explicação', prova: 'Prova / documento', comparacao: 'Comparação', encerramento: 'Encerramento' };

  const rodando = {};            // id do conteúdo → true enquanto uma sequência roda
  const ganchosUi = {};   // painel "Mais ganchos" por conteúdo (só na memória da tela)
  const urls = new Map();        // blob_key → object URL (só para exibir)
  const abertos = new Set();     // detalhes que o Pedro abriu

  // ── Pipeline persistido ─────────────────────────────────────────────────────
  const marca = (c, e, estado, extra = {}) => { c.pipeline[e] = { ...(c.pipeline[e] || {}), estado, ...extra, em: new Date().toISOString() }; };
  const feito = (c, e) => c.pipeline[e]?.estado === 'concluida';

  async function passo(x, c, nome, fn) {
    marca(c, nome, 'em_andamento', { erro: null, codigo: null, progresso: null });
    await x.persistir(c); x.render();
    try {
      const extra = (await fn()) || {};
      marca(c, nome, 'concluida', { erro: null, ...extra });
      M.registrar(c, 'sistema', 'etapa', `${ROTULO[nome]} concluída`);
      await x.persistir(c); x.render();
    } catch (e) {
      marca(c, nome, 'erro', { erro: e.message || 'Falhou', codigo: e.code || null });
      M.registrar(c, 'sistema', 'erro', `${ROTULO[nome]}: ${e.message}`);
      await x.persistir(c); x.render();
      throw e;
    }
  }
  const progresso = async (x, c, nome, texto) => { c.pipeline[nome].progresso = texto; await x.persistir(c); x.render(); };

  // Consumo por conteúdo: cada etapa devolve as chamadas de IA que fez.
  function registrarConsumo(c, consumo) {
    if (!consumo) return;
    c.consumo = [...(c.consumo || []), { etapa: consumo.etapa, em: new Date().toISOString(), duracao_ms: consumo.duracao_ms, chamadas: consumo.chamadas || [], custo: consumo.custo || 'desconhecido' }];
  }
  function resumoConsumo(c) {
    const ch = (c.consumo || []).flatMap((x) => x.chamadas);
    const soma = (k) => ch.reduce((n, x) => n + (x.tokens?.[k] || 0), 0);
    const semTokens = ch.filter((x) => x.ok && !x.tokens).length;
    const modelos = [...new Set(ch.filter((x) => x.ok).map((x) => `${x.provider}/${x.model}`))];
    return { chamadas: ch.length, falhas: ch.filter((x) => !x.ok).length, entrada: soma('entrada'), saida: soma('saida'), semTokens, modelos,
      tentativas_extra: ch.reduce((n, x) => n + Math.max(0, (x.tentativas_provedor || 1) - 1), 0),
      tempo_s: Math.round((c.consumo || []).reduce((n, x) => n + (x.duracao_ms || 0), 0) / 1000), etapas: (c.consumo || []).length, pago: ch.some((x) => x.pago) };
  }

  const corpoFonte = (c) => (c.origem?.tipo === 'texto' ? { texto: c.origem.texto_bruto } : { url: c.origem?.url });

  // Etapas que custam IA guardam o request_id no conteúdo ANTES de chamar.
  // Se a aba fechar, ao continuar o mesmo request_id é reenviado: com a cópia no
  // servidor, o resultado já pronto volta sem nova chamada de IA.
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function chamarEtapa(x, c, nome, chave, rota, corpo) {
    const p = c.pipeline[nome] || (c.pipeline[nome] = {});
    p.rids = p.rids || {};
    let rid = p.rids[chave];
    if (!rid) { rid = x.novoId(); p.rids[chave] = rid; await x.persistir(c); }
    let r = await x.api(rota, { method: 'POST', body: { ...corpo, request_id: rid, conteudo_id: c.id } });
    for (let i = 0; r?.em_andamento && i < 36; i++) {
      if (c.pipeline[nome]) { c.pipeline[nome].progresso = 'Ainda rodando no servidor (pedido feito antes)…'; x.render(); }
      await espera(2500);
      const j = await x.api(`/api/jobs/${encodeURIComponent(r.rid)}`).catch(() => null);
      if (j?.estado === 'concluido') r = j.resultado;
      else if (j?.estado === 'erro') throw new Error(j.erro || 'A etapa falhou no servidor.');
    }
    if (r?.em_andamento) throw new Error('A etapa ainda está rodando no servidor. Tente continuar em instantes.');
    if (r?.reaproveitado) M.registrar(c, 'sistema', 'reaproveitado', `${ROTULO[nome] || nome}: resultado já pronto no servidor reaproveitado (sem nova chamada de IA)`);
    delete p.rids[chave];
    return r;
  }

  async function etapaLeitura(x, c) {
    const r = await x.api('/api/content/ingest', { method: 'POST', body: { ...corpoFonte(c), request_id: x.novoId() } });
    c.fonte_principal = r.fonte;
    registrarConsumo(c, r.consumo);
    if (r.fonte.titulo && /^https?:/.test(c.titulo || '')) c.titulo = r.fonte.titulo.slice(0, 140);
    if (!r.fonte.legivel) {
      const e = new Error(r.fonte.observacoes?.[0] || 'Não consegui ler esta fonte.');
      e.code = 'FONTE_ILEGIVEL'; throw e;
    }
    return { observacoes: r.fonte.observacoes };
  }

  async function etapaAfirmacoes(x, c) {
    const r = await chamarEtapa(x, c, 'afirmacoes', 'claims', '/api/content/claims', { fonte: c.fonte_principal });
    c.claims = r.claims; c.evidencias = r.evidencias;
    registrarConsumo(c, r.consumo);
    return { descartadas: r.descartadas, llm: r.llm };
  }

  function mesclar(c, claim, novas) {
    const i = c.claims.findIndex((k) => k.id === claim.id);
    if (i !== -1) c.claims[i] = { ...claim, revisao: c.claims[i].revisao || {} };
    const ids = new Set(c.evidencias.map((e) => e.id));
    novas.forEach((e) => { if (!ids.has(e.id)) c.evidencias.push(e); });
    // Evidências de uma verificação anterior que nenhuma afirmação usa mais.
    const usadas = new Set(c.claims.flatMap((k) => k.evidencias || []));
    c.evidencias = c.evidencias.filter((e) => usadas.has(e.id));
  }

  async function verificarUma(x, c, claim, links) {
    const r = await chamarEtapa(x, c, 'pesquisa', `verify:${claim.id}${links ? ':link' : ''}`, '/api/content/verify', { claim, fonte: c.fonte_principal, evidencias: c.evidencias, links: links || [] });
    mesclar(c, r.claim, r.evidencias);
    registrarConsumo(c, r.consumo);
    c.pesquisa_log = { ...(c.pesquisa_log || {}), [claim.id]: { log: r.log, consulta: r.consulta, janela_dias: r.janela_dias, cobertura: r.cobertura, em: new Date().toISOString() } };
    return r;
  }

  async function conferirUma(x, c, k) {
    if (rodando[c.id]) return;
    rodando[c.id] = true; x.render();
    try {
      const r = await chamarEtapa(x, c, 'pesquisa', `conferir:${k.id}`, '/api/content/conferir', { claim: k, fonte: c.fonte_principal, evidencias: c.evidencias });
      mesclar(c, r.claim, r.evidencias);
      registrarConsumo(c, r.consumo);
      reabrirAprovacao(c);
      M.registrar(c, 'sistema', 'conferencia', `Conferiu “${k.texto.slice(0, 60)}”: ${r.claim.estado}`);
      x.toast(`Resultado: ${(ESTADO_CLAIM[r.claim.estado] || [, r.claim.estado])[1]}. ${r.claim.motivo_estado || ''}`);
    } catch (e) { x.toast(e.message); } finally { fim(x, c); await x.persistir(c); x.render(); }
  }

  // Opiniões: premissas factuais separadas e ligadas às afirmações conferidas.
  const slidesDeOpiniao = (c, v) => (v?.slides || []).filter((s) => (s.claim_ids || []).some((id) => { const k = c.claims.find((q) => q.id === id); return k && (k.tipo === 'opiniao' || k.natureza === 'opiniao'); }));
  // Todo o texto público (slides, exceto encerramento, e legenda) é auditado:
  // cada afirmação de fato precisa apontar para uma afirmação conferida.
  async function auditarOpinioes(x, c, { so_pendentes = true } = {}) {
    const v = M.versaoAtiva(c);
    if (!v) return;
    const unidades = [...v.slides.filter((s) => s.layout !== 'encerramento').map((s) => ({ id: s.id, texto: M.textoParaAuditoria(s) })), ...(v.legenda ? [{ id: 'legenda', texto: v.legenda }] : [])];
    const aud = c.auditoria_textos || {};
    const alvo = unidades.filter((u) => !so_pendentes || aud[u.id]?.hash_texto !== M.hash(u.texto));
    if (!alvo.length) return;
    const r = await chamarEtapa(x, c, 'copy', `auditar:${alvo.map((u) => M.hash(u.texto)).join(',')}`, '/api/content/auditar', { slides: alvo, claims: c.claims });
    c.auditoria_textos = { ...aud };
    r.auditoria.forEach((a) => { c.auditoria_textos[a.slide_id] = a; });
    registrarConsumo(c, r.consumo);
    const sem = r.auditoria.flatMap((a) => a.premissas.filter((p) => !p.claim_id));
    M.registrar(c, 'sistema', 'auditoria', `Opiniões conferidas: ${sem.length} premissa(s) factual(is) sem fonte`);
  }

  async function etapaPesquisa(x, c) {
    const alvo = c.claims.filter((k) => k.central && k.tipo !== 'opiniao').slice(0, 4);
    let falhas = 0;
    for (let i = 0; i < alvo.length; i++) {
      await progresso(x, c, 'pesquisa', `Conferindo ${i + 1} de ${alvo.length}…`);
      try { await verificarUma(x, c, alvo[i]); } catch (e) {
        falhas += 1;
        c.pesquisa_log = { ...(c.pesquisa_log || {}), [alvo[i].id]: { log: [`Falhou: ${e.message}`], em: new Date().toISOString() } };
      }
      await x.persistir(c);
    }
    if (alvo.length && falhas === alvo.length) throw new Error('Nenhuma afirmação pôde ser conferida agora. Tente de novo em instantes.');
    return { conferidas: alvo.length - falhas, falhas };
  }

  async function etapaBriefing(x, c) {
    const p = c.origem?.pauta;
    const r = await chamarEtapa(x, c, 'briefing', 'briefing', '/api/content/briefing', {
      fonte: c.fonte_principal, claims: c.claims, evidencias: c.evidencias, recentes: x.recentesParaPrompt(),
      objetivo: p?.objetivo_sugerido || '', formato: p?.formato_sugerido === 'estatico' ? 'estatico' : '', voz: x.state.config.voice_profile || '',
    });
    c.briefing = r.briefing;
    registrarConsumo(c, r.consumo);
    return { llm: r.briefing.llm };
  }

  async function etapaCopy(x, c, instrucoes = '') {
    const r = await chamarEtapa(x, c, 'copy', 'copy', '/api/content/copy', {
      briefing: c.briefing, fonte: c.fonte_principal, claims: c.claims, evidencias: c.evidencias, recentes: x.recentesParaPrompt(),
      formato: c.briefing.formato === 'estatico' ? 'estatico' : 'carrossel', instrucoes, voz: x.state.config.voice_profile || '',
    });
    // Opiniões ganham ids únicos por versão (as versões antigas continuam apontando para as suas).
    const n = c.copia.versoes.length + 1;
    const mapa = {};
    r.opinioes.forEach((o, i) => { mapa[o.id] = `o${n}_${i + 1}`; });
    const troca = (ids) => (ids || []).map((id) => mapa[id] || id);
    const versao = M.clone(r.versao);
    versao.slides.forEach((s) => { s.claim_ids = troca(s.claim_ids); });
    c.claims.push(...r.opinioes.map((o) => ({ ...o, id: mapa[o.id] })));
    c.formato = versao.formato === 'estatico' ? 'estatico' : 'carrossel';
    registrarConsumo(c, r.consumo);
    if (c.status === 'rascunho') c.status = 'em_revisao';
    M.criarVersao(c, versao, { quem: 'ia', rotulo: instrucoes ? `Texto gerado (${instrucoes.slice(0, 40)})` : 'Texto gerado' });
    try { await auditarOpinioes(x, c); } catch (e) { M.registrar(c, 'sistema', 'erro', `Conferência das opiniões falhou: ${e.message}`); }
    return { llm: r.llm, tentativas: r.tentativas, problemas_de_forma: r.problemas_de_forma };
  }

  // ── Arte ────────────────────────────────────────────────────────────────────
  const blobParaDataUrl = (blob) => new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => no(new Error('Não consegui ler o arquivo.')); f.readAsDataURL(blob); });
  const dataUrlParaBlob = async (u) => (await fetch(u)).blob();

  async function atualizarArte(x, c, { todos = false, soSlide = null } = {}) {
    const v = M.versaoAtiva(c);
    if (!v) return;
    const enc = x.state.encerramento ? (await S.obterBlob('upload:encerramento'))?.blob : null;
    const encEm = enc ? x.state.encerramento.em : null;
    const total = v.slides.length;
    // 1) Reaproveita já a arte que continua valendo (mesmo texto, mesma posição).
    const plano = v.slides.map((s, i) => {
      const forca = soSlide ? s.id === soSlide : todos;
      const h = M.hashRender(s);
      const mesmo = (r) => r.slide_id === s.id && r.texto_hash === h && r.indice === i + 1 && r.total === total && (s.layout !== 'encerramento' || r.enc_em === encEm) && r.blob_key;
      const existente = !forca && (c.arte.renders.find((r) => mesmo(r) && r.versao === v.id) || c.arte.renders.find(mesmo));
      return { s, i, h, existente };
    });
    const outras = c.arte.renders.filter((r) => r.versao !== v.id);
    const atuais = plano.filter((q) => q.existente).map((q) => ({ ...q.existente, versao: v.id }));
    c.arte.renders = [...outras, ...atuais];
    x.render();
    // 2) Desenha só o que falta, um slide por vez, gravando a cada um.
    let feitos = 0;
    for (const q of plano.filter((y) => !y.existente)) {
      const { s, i, h } = q;
      let img = s.imagem_id ? (await S.obterBlob(`img:${s.imagem_id}`))?.blob : null;
      if (s.imagem_id && !img && window.Sync) { img = await window.Sync.baixarArquivo(`img:${s.imagem_id}`); if (img) await S.salvarBlob(`img:${s.imagem_id}`, img, { content_id: c.id, origem: 'servidor' }); }
      if (s.imagem_id && !img) throw new Error(`A foto do slide ${i + 1} não está neste aparelho nem no servidor. Envie de novo.`);
      if (c.pipeline.arte) { c.pipeline.arte.progresso = `Desenhando slide ${i + 1} de ${total}…`; x.render(); }
      const r = await x.api('/api/content/render-slide', { method: 'POST', body: {
        slide: s, indice: i + 1, total, imagem: img ? await blobParaDataUrl(img) : undefined,
        encerramento: s.layout === 'encerramento' && enc ? await blobParaDataUrl(enc) : undefined, request_id: x.novoId(),
      } });
      registrarConsumo(c, r.consumo);
      const key = `render:${c.id}:${s.id}:${h}:${i + 1}/${total}:${encEm || '-'}`;
      await S.salvarBlob(key, await dataUrlParaBlob(r.png), { content_id: c.id });
      c.arte.renders = [...c.arte.renders.filter((y) => !(y.versao === v.id && y.slide_id === s.id)), { slide_id: s.id, versao: v.id, texto_hash: h, indice: i + 1, total, blob_key: key, metrics: r.metrics, elementos: r.metrics.elementos || [], gerada_em: new Date().toISOString(), enc_em: encEm }];
      feitos += 1;
      await x.persistir(c); x.render();
    }
    if (feitos) M.registrar(c, 'sistema', 'arte', `Arte gerada: ${feitos} slide(s) da versão ${v.id}`);
    await x.persistir(c);
    return feitos;
  }

  async function etapaArte(x, c) {
    const feitos = await atualizarArte(x, c);
    return { slides_gerados: feitos };
  }

  // ── Sequências ──────────────────────────────────────────────────────────────
  async function sequencia(x, c, passos) {
    if (rodando[c.id]) return;
    rodando[c.id] = true;
    try {
      for (const nome of passos) {
        if (feito(c, nome)) continue;
        const fn = { leitura: etapaLeitura, afirmacoes: etapaAfirmacoes, pesquisa: etapaPesquisa, briefing: etapaBriefing, copy: etapaCopy, arte: etapaArte }[nome];
        await passo(x, c, nome, () => fn(x, c));
      }
    } catch (e) { x.toast(e.message || 'Algo deu errado.'); } finally { fim(x, c); x.render(); }
  }
  const ATE_BRIEFING = ['leitura', 'afirmacoes', 'pesquisa', 'briefing'];
  const TEXTO_E_ARTE = ['copy', 'arte'];

  async function regerarTexto(x, c, instrucoes) {
    if (rodando[c.id]) return;
    rodando[c.id] = true;
    try {
      await passo(x, c, 'copy', () => etapaCopy(x, c, instrucoes));
      await passo(x, c, 'arte', () => etapaArte(x, c));
    } catch (e) { x.toast(e.message || 'Algo deu errado.'); } finally { fim(x, c); x.render(); }
  }

  // ── Edições (sempre criam versão; nada é sobrescrito) ───────────────────────
  // Edição feita enquanto outra etapa roda: a arte é atualizada quando ela terminar.
  const artePendente = {};
  function fim(x, c) {
    delete rodando[c.id];
    if (artePendente[c.id]) { delete artePendente[c.id]; aposEdicao(x, c, null, null, { silencioso: true }); }
  }

  async function aposEdicao(x, c, efeito, msg, { silencioso = false } = {}) {
    const n = (efeito?.afirmacoes || []).length;
    await x.persistir(c); x.render();
    if (!silencioso) x.toast(msg || (n ? `Mudou número ou fonte: ${n} afirmação(ões) voltaram para conferência.` : 'Salvo como nova versão.'));
    if (rodando[c.id]) { artePendente[c.id] = true; return; }
    rodando[c.id] = true;
    try {
      try { await auditarOpinioes(x, c); } catch (e) { x.toast(`Conferência da opinião falhou: ${e.message}`); }
      marca(c, 'arte', 'em_andamento', { erro: null }); x.render();
      await atualizarArte(x, c);
      marca(c, 'arte', 'concluida', { erro: null, progresso: null });
    } catch (e) { marca(c, 'arte', 'erro', { erro: e.message }); x.toast(`Arte não atualizada: ${e.message}`); } finally { fim(x, c); await x.persistir(c); x.render(); }
  }

  function reabrirAprovacao(c) {
    if (c.revisao.aprovada_versao) {
      c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null, reaberta_em: new Date().toISOString() };
      if (['aprovado', 'exportado'].includes(c.status)) c.status = 'em_revisao';
    }
  }

  function novaVersaoCom(c, mut, rotulo) {
    const ativa = M.versaoAtiva(c);
    const dados = M.clone(ativa);
    mut(dados);
    const efeito = M.efeitoDaEdicao(ativa, dados, c.claims);
    M.criarVersao(c, dados, { quem: 'pedro', rotulo });
    return efeito;
  }

  // ── ZIP simples (sem compressão: PNG já é comprimido) ───────────────────────
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let k = n; for (let i = 0; i < 8; i++) k = k & 1 ? 0xEDB88320 ^ (k >>> 1) : k >>> 1; t[n] = k >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function montarZip(arquivos) {
    const enc = new TextEncoder();
    const agora = new Date();
    const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    const partes = []; const central = []; let pos = 0;
    for (const a of arquivos) {
      const nome = enc.encode(a.nome); const crc = crc32(a.dados);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, hora, true); lh.setUint16(12, data, true); lh.setUint32(14, crc, true); lh.setUint32(18, a.dados.length, true); lh.setUint32(22, a.dados.length, true);
      lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
      partes.push(new Uint8Array(lh.buffer), nome, a.dados);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, hora, true); ch.setUint16(14, data, true); ch.setUint32(16, crc, true); ch.setUint32(20, a.dados.length, true); ch.setUint32(24, a.dados.length, true);
      ch.setUint16(28, nome.length, true); ch.setUint32(42, pos, true);
      central.push(new Uint8Array(ch.buffer), nome);
      pos += 30 + nome.length + a.dados.length;
    }
    const tamCentral = central.reduce((n, p) => n + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
    return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/zip' });
  }

  async function sha256(u8) {
    if (!(window.crypto && crypto.subtle)) return null;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fichaDeFontes(c) {
    const v = M.versaoAtiva(c);
    const usadas = new Set([...(v.slides || []).flatMap((s) => s.claim_ids || []), ...(v.legenda_claim_ids || [])]);
    const linhas = [`FICHA DE FONTES — ${c.titulo}`, `Conta: ${c.conta.handle || '@pedro_destrava'} · versão ${v.id} · aprovada em ${quando(c.revisao.aprovada_em)}`, ''];
    c.claims.filter((k) => usadas.has(k.id)).forEach((k) => {
      linhas.push(`• ${k.texto}`, `  Tipo: ${k.tipo} · Estado: ${(ESTADO_CLAIM[k.estado] || [, k.estado])[1]}${k.motivo_estado ? ` — ${k.motivo_estado}` : ''}`);
      if (k.decisao) linhas.push(`  Decisão do Pedro: ${DECISAO[k.decisao.tipo]}${k.decisao.condicao ? ` — “${k.decisao.condicao}”` : ''} (${quando(k.decisao.em)})`);
      if (k.calculo) linhas.push(`  Cálculo: ${k.calculo.formula}; entradas ${(k.calculo.entradas || []).map((e) => `${e.nome}=${e.valor}`).join(', ')}; resultado ${k.calculo.resultado}`);
      (k.evidencias || []).map((id) => c.evidencias.find((e) => e.id === id)).filter(Boolean).forEach((e) => {
        const co = e.correspondencia || ({ sustenta: 'integral', parcial: 'parcial', contradiz: 'contradiz', neutra: 'nao_sustenta' })[e.relacao];
        linhas.push(`  – ${e.origem} (${AUTORIDADE[e.autoridade] || e.autoridade || e.tipo}; ${(CORRESP[co] || [, co])[1]}${e.falta ? `; falta: ${e.falta}` : ''})`, `    ${e.titulo || ''}`, `    ${e.url || ''}`, `    Publicada: ${dia(e.publicada_em)} · Consultada: ${quando(e.consultada_em)}${e.periodo ? ` · Período: ${e.periodo}` : ''}`);
        if (e.trecho) linhas.push(`    Trecho: “${e.trecho}”`);
        if (e.limitacoes) linhas.push(`    Limites: ${e.limitacoes}`);
      });
      linhas.push('');
    });
    return linhas.join('\n');
  }

  async function exportar(x, c) {
    const chk = G.checarExportacao(c);
    if (!chk.ok) throw new Error(chk.erros[0]);
    const v = M.versaoAtiva(c);
    const enc = new TextEncoder();
    const arquivos = []; const hashes = [];
    const renders = v.slides.map((s) => c.arte.renders.find((r) => r.slide_id === s.id && r.versao === v.id));
    for (let i = 0; i < renders.length; i++) {
      const b = await S.obterBlob(renders[i].blob_key);
      if (!b?.blob) throw new Error(`A imagem do slide ${i + 1} não está neste aparelho. Gere a arte de novo.`);
      const dados = new Uint8Array(await b.blob.arrayBuffer());
      const nome = `slide-${String(i + 1).padStart(2, '0')}.png`;
      arquivos.push({ nome, dados }); hashes.push({ arquivo: nome, sha256: await sha256(dados) });
    }
    const hash = (v.hashtags || []).join(' ');
    arquivos.push({ nome: 'legenda.txt', dados: enc.encode(`${v.legenda}\n\n${v.cta ? `${v.cta}\n\n` : ''}${hash}\n`) });
    arquivos.push({ nome: 'fontes.txt', dados: enc.encode(fichaDeFontes(c)) });
    arquivos.push({ nome: 'versao.json', dados: enc.encode(JSON.stringify({ conteudo: c.id, conta: c.conta.handle || '@pedro_destrava', versao: v.id, hash_versao: v.hash, aprovada_em: c.revisao.aprovada_em, exportada_em: new Date().toISOString(), arquivos: hashes }, null, 2)) });
    M.registrarExportacao(c, { arquivos: arquivos.map((a) => a.nome), hashes });
    await S.snapshot(c, 'exportado');
    await x.persistir(c);
    const nomeZip = `pedro-destrava-${(c.titulo || 'post').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'post'}-${v.id}.zip`;
    const zip = montarZip(arquivos);
    await x.entregarArquivo(zip, nomeZip);
    let guardado = '';
    if (x.state.servidor?.configurado && window.Sync) {
      try {
        const r = await window.Sync.enviarArquivo(`export:${c.id}:${v.id}`, zip);
        c.exportacoes[c.exportacoes.length - 1].servidor = { chave: `export:${c.id}:${v.id}`, sha256: r.sha256, tamanho: r.tamanho };
        await x.persistir(c); guardado = ' Cópia do ZIP guardada no servidor.';
      } catch (e) { guardado = ` O ZIP NÃO foi guardado no servidor (${e.message}); ele está só no seu aparelho.`; }
    }
    x.toast(`Arquivos exportados.${guardado} Publique no Instagram você mesmo.`);
  }

  // ── Telas ───────────────────────────────────────────────────────────────────
  function telaNovo() {
    const novo = window.Mesa.state.novo || {};
    const modo = novo.modo || 'link';
    return `
      <button class="es-btn ghost sm" style="width:auto" data-action="voltar">‹ Mesa</button>
      <div class="es-h1" style="margin-top:12px">Quero falar sobre isso</div>
      <div class="es-sub">Cole o link da matéria ou o texto. O sistema lê, separa o que precisa ser conferido e pesquisa antes de escrever.</div>
      <div class="studio-source-form"><div class="mz-top" role="group" aria-label="Tipo de fonte"><button class="es-btn ${modo === 'link' ? '' : 'ghost'} sm" style="width:auto" data-action="ed-modo" data-m="link" aria-pressed="${modo === 'link'}">Link</button><button class="es-btn ${modo === 'texto' ? '' : 'ghost'} sm" style="width:auto" data-action="ed-modo" data-m="texto" aria-pressed="${modo === 'texto'}">Texto colado</button></div>
      ${modo === 'link'
        ? `<label class="es-label" for="ed-novo-url">Link da matéria</label><input id="ed-novo-url" class="es-input" type="url" inputmode="url" value="${esc(novo.url || '')}" placeholder="https://site.com/sua-materia" autocomplete="off" aria-describedby="source-help"><div id="source-help" class="es-text" style="margin:12px 0 20px">Para posts do Instagram, TikTok, X ou YouTube, use a opção “Texto colado”.</div>`
        : `<label class="es-label" for="ed-novo-texto">Texto da matéria ou do post</label><textarea id="ed-novo-texto" class="es-input" rows="9" placeholder="Cole aqui o conteúdo que você quer desenvolver…" aria-describedby="source-help">${esc(novo.texto || '')}</textarea><div id="source-help" class="es-text" style="margin:12px 0 20px">Cole pelo menos 200 caracteres. As informações serão pesquisadas em outras fontes antes da criação do conteúdo.</div>`}
      <button class="es-btn" data-action="ed-iniciar">Ler e pesquisar</button>
      </div><div class="studio-editor-note"><b>Você acompanha cada etapa</b><p>Leitura → Pesquisa → Texto → Arte. Revise o resultado antes de aprovar a publicação.</p></div>`;
  }

  function stepper(c) {
    return `<div class="ed-passos">${PASSOS.map((p) => {
      const st = c.pipeline[p] || {}; const viva = st.estado === 'em_andamento' && rodando[c.id];
      const est = viva ? 'andando' : st.estado === 'em_andamento' ? 'interrompida' : (st.estado || 'pendente');
      return `<div class="ed-passo ${est}"><i></i><span>${ROTULO[p]}</span></div>`;
    }).join('')}</div>`;
  }

  function painelEstado(c) {
    const atual = PASSOS.find((p) => !feito(c, p));
    const st = atual ? (c.pipeline[atual] || {}) : null;
    const vivo = !!rodando[c.id];
    if (vivo) {
      const p = c.pipeline[PASSOS.find((q) => c.pipeline[q]?.estado === 'em_andamento')] || {};
      return `<div class="es-card"><span class="es-spin"></span> <b>Trabalhando…</b> ${esc(p.progresso || '')}<div class="es-text">Pode sair desta tela: o progresso fica salvo.</div></div>`;
    }
    if (!atual) return '';
    if (st.estado === 'erro') {
      const colar = atual === 'leitura' && c.origem?.tipo !== 'texto';
      return `<div class="es-errbox"><b>${esc(ROTULO[atual])} não terminou.</b> ${esc(st.erro)}</div>
        ${colar ? '<textarea id="ed-colar" class="es-input" rows="6" placeholder="Cole aqui o texto da matéria"></textarea><button class="es-btn" data-action="ed-colar">Usar este texto</button>' : ''}
        <button class="es-btn ${colar ? 'ghost' : ''}" data-action="ed-continuar">Tentar de novo</button>`;
    }
    if (st.estado === 'em_andamento') {
      const duravel = x0().state.servidor?.configurado && ['afirmacoes', 'pesquisa', 'briefing', 'copy'].includes(atual);
      return `<div class="es-warn">A etapa “${esc(ROTULO[atual])}” foi interrompida (conexão ou página fechada). O que já estava pronto continua salvo. ${duravel ? 'Ao continuar, se o servidor já tiver terminado, o resultado é recuperado sem nova chamada de IA.' : atual === 'arte' ? 'Ao continuar, só os slides que faltaram são desenhados de novo.' : 'Ao continuar, esta etapa recomeça (sem cópia no servidor, o pedido anterior não pode ser recuperado).'}</div><button class="es-btn" data-action="ed-continuar">Continuar de onde parou</button>`;
    }
    if (ATE_BRIEFING.includes(atual)) return `<button class="es-btn" data-action="ed-continuar">Continuar: ${esc(ROTULO[atual])}</button>`;
    return '';
  }

  function cartaoFonte(c) {
    const f = c.fonte_principal;
    if (!f) return '';
    return `<div class="es-label">Fonte lida</div>
      <div class="es-card">
        <div class="es-title">${esc(f.titulo || (f.url || 'Sem título'))}</div>
        <div class="es-text"><b>${esc(f.veiculo || '')}</b> · publicada ${esc(dia(f.publicada_em))}${f.atualizada_em ? ` · atualizada ${esc(dia(f.atualizada_em))}` : ''} · lida em ${esc(quando(f.acessada_em))}</div>
        ${f.url_final ? `<div class="es-text"><a href="${esc(f.url_final)}" target="_blank" rel="noopener noreferrer">abrir a matéria</a></div>` : ''}
        ${(f.observacoes || []).map((o) => `<div class="es-warn">${esc(o)}</div>`).join('')}
        ${f.tipo === 'texto' ? '' : '<div class="es-text">Uma matéria prova o que ela afirma; só vira fato quando outra fonte independente ou um dado oficial confirma.</div>'}
      </div>`;
  }

  const NATUREZA = { fato: 'Fato', dado: 'Dado', anuncio: 'Anúncio', declaracao: 'Declaração', previsao: 'Previsão', opiniao: 'Opinião' };
  const CORRESP = { integral: ['ok', 'sustenta a afirmação inteira'], parcial: ['warn', 'sustenta só parte'], contradiz: ['err', 'contradiz'], nao_sustenta: ['neutro', 'não sustenta'] };
  const AUTORIDADE = { primaria: 'fonte oficial / primária', reportagem: 'reportagem', republicacao: 'reprodução da mesma matéria (não é independente)', texto_colado: 'texto colado (prova só o que está escrito)' };
  const DECISAO = { corrigir: 'Corrigida', atribuir: 'Publicar com atribuição/condição', retirar: 'Retirada', em_revisao: 'Em revisão' };
  let decidindo = null; // { id, tipo }

  function cartaoEvidencia(e) {
    const co = e.correspondencia || ({ sustenta: 'integral', parcial: 'parcial', contradiz: 'contradiz', neutra: 'nao_sustenta' })[e.relacao] || 'nao_sustenta';
    const au = e.autoridade || (e.tipo === 'primaria' ? 'primaria' : 'reportagem');
    return `<div class="mz-bloco ed-ev"><b>${esc(e.origem)}${e.fonte_principal ? ' · a matéria que você trouxe' : ''}</b>
      <span>1. Trecho: ${e.trecho_encontrado === false ? '<b class="ed-mal">não encontrado no documento</b>' : 'encontrado no documento'}${e.trecho ? ` — “${esc(e.trecho)}”` : ''}</span>
      <span>2. Correspondência: <b class="ed-${CORRESP[co][0]}">${CORRESP[co][1]}</b>${e.falta ? ` — falta: ${esc(e.falta)}` : ''}</span>
      <span>3. Qualidade: ${esc(AUTORIDADE[au] || au)} · publicada ${esc(dia(e.publicada_em))} · consultada ${esc(quando(e.consultada_em))}${e.periodo ? ` · período ${esc(e.periodo)}` : ''}${e.unidade ? ` · ${esc(e.unidade)}` : ''}${e.abrangencia ? ` · abrange: ${esc(e.abrangencia)}` : ''}${e.limitacoes ? ` · limites: ${esc(e.limitacoes)}` : ''}${e.desatualizada ? ' · <b>pode estar desatualizada</b>' : ''}</span>
      ${e.url ? `<span><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">abrir fonte</a></span>` : ''}</div>`;
  }

  function painelDecisao(c, k) {
    const precisa = k.precisa_conferir || ['parcialmente_sustentada', 'nao_verificada', 'contradita'].includes(k.estado) || k.decisao;
    if (!precisa) return '';
    const sugestao = (() => { const e = (k.evidencias || []).map((id) => c.evidencias.find((x) => x.id === id)).find((x) => x && x.trecho_encontrado !== false && x.trecho); return e ? `segundo ${e.origem}` : ''; })();
    const aberto = decidindo && decidindo.id === k.id ? decidindo.tipo : null;
    const tipos = ['corrigir', ...(k.estado === 'contradita' ? [] : ['atribuir']), 'retirar', 'em_revisao'];
    return `<div class="ed-decisao">
      ${k.decisao ? `<div class="es-text"><b>Sua decisão:</b> ${esc(DECISAO[k.decisao.tipo])}${k.decisao.condicao ? ` — “${esc(k.decisao.condicao)}”` : ''} (${esc(quando(k.decisao.em))})</div>` : '<div class="es-text"><b>O que fazer com esta afirmação?</b></div>'}
      <div class="es-actions" style="flex-wrap:wrap">${tipos.map((t) => `<button class="es-btn ${aberto === t ? '' : 'ghost'} sm" data-action="ed-decidir" data-id="${esc(k.id)}" data-tipo="${t}">${{ corrigir: 'Corrigir o texto', atribuir: 'Publicar com atribuição ou condição', retirar: 'Retirar', em_revisao: 'Manter em revisão' }[t]}</button>`).join('')}</div>
      ${aberto === 'corrigir' ? `<textarea id="ed-dec-valor" class="es-input" rows="2">${esc(k.texto)}</textarea><button class="es-btn" data-action="ed-decidir-ok" data-id="${esc(k.id)}">Salvar e conferir nas fontes</button>` : ''}
      ${aberto === 'atribuir' ? `<input id="ed-dec-valor" class="es-input" value="${esc(sugestao)}" placeholder="ex.: segundo o governo; ainda depende de aprovação; é uma estimativa"><div class="es-text">Essa expressão terá de aparecer em cada slide e na legenda que usarem a afirmação.</div><button class="es-btn" data-action="ed-decidir-ok" data-id="${esc(k.id)}">Confirmar</button>` : ''}
    </div>`;
  }

  function cartaoClaim(c, k) {
    const opin = k.tipo === 'opiniao' || k.natureza === 'opiniao';
    const [cls, rot] = opin ? ['neutro', 'Opinião'] : (ESTADO_CLAIM[k.estado] || ESTADO_CLAIM.nao_verificada);
    const ev = (k.evidencias || []).map((id) => c.evidencias.find((e) => e.id === id)).filter(Boolean);
    const rev = k.revisao || {};
    const log = c.pesquisa_log?.[k.id];
    const aberto = abertos.has(`k:${k.id}`);
    const nat = M.naturezaDe(k);
    return `<div class="es-card ed-claim" data-claim="${esc(k.id)}">
      <div class="es-row" style="flex-wrap:wrap;gap:6px"><span class="mz-chip ${cls}">${rot}</span>${opin ? '' : `<span class="mz-chip neutro">${NATUREZA[nat]}</span>`}${k.central ? '<span class="mz-chip neutro">Central</span>' : ''}${k.risco === 'alto' ? '<span class="mz-chip err">Sensível</span>' : ''}${k.mutavel ? '<span class="mz-chip warn">Pode mudar</span>' : ''}${M.EXIGE_ATRIBUICAO.has(nat) ? '<span class="mz-chip warn">No texto: dizer quem anunciou/disse</span>' : ''}${k.origem === 'pedro' ? '<span class="mz-chip neutro">Sua afirmação</span>' : ''}${rev.reaberta_em && !rev.confirmada_por_pedro ? '<span class="mz-chip warn">Reaberta por edição</span>' : ''}${rev.confirmada_por_pedro ? '<span class="mz-chip ok">Você confirmou</span>' : ''}</div>
      <div class="es-text" style="margin-top:6px;color:var(--es-dark)">${esc(k.texto)}</div>
      ${k.motivo_estado && !opin ? `<div class="es-text">${esc(k.motivo_estado)}</div>` : ''}
      ${opin ? `<div class="es-text">Opinião sua. Premissas factuais: ${(k.premissas || []).map((id) => esc(c.claims.find((x) => x.id === id)?.texto || id)).join('; ') || '—'}</div>` : ''}
      ${(k.textos_anteriores || []).length ? `<div class="es-text">Antes: “${esc(k.textos_anteriores[k.textos_anteriores.length - 1].texto)}”</div>` : ''}
      <details class="mz-det" data-aberto="k:${esc(k.id)}" ${aberto ? 'open' : ''}><summary>${ev.length} fonte(s): trecho, correspondência e qualidade</summary>
        ${ev.map(cartaoEvidencia).join('') || '<div class="es-text">Nenhum trecho localizado nas fontes acessadas.</div>'}
        ${log ? `<div class="mz-bloco"><b>Como a busca foi feita (${esc(quando(log.em))})</b>${(log.log || []).map((l) => `<span>${esc(l)}</span>`).join('')}${log.cobertura ? `<span><i>${esc(log.cobertura)}</i></span>` : ''}</div>` : ''}
      </details>
      ${opin ? '' : painelDecisao(c, k)}
      ${opin ? '' : `<div class="es-actions" style="flex-wrap:wrap">
        ${k.precisa_conferir ? `<button class="es-btn sm" data-action="ed-conferir" data-id="${esc(k.id)}" ${rodando[c.id] ? 'disabled' : ''}>Conferir o texto corrigido</button>` : `<button class="es-btn ghost sm" data-action="ed-verificar" data-id="${esc(k.id)}" ${rodando[c.id] ? 'disabled' : ''}>Buscar outras fontes</button>`}
        <details class="mz-det" data-aberto="l:${esc(k.id)}" ${abertos.has(`l:${k.id}`) ? 'open' : ''} style="width:100%"><summary>Conferir com outro link</summary><input class="es-input" id="ed-link-${esc(k.id)}" inputmode="url" placeholder="https://… (outra matéria ou a fonte oficial)"><button class="es-btn ghost sm" data-action="ed-verificar-link" data-id="${esc(k.id)}" ${rodando[c.id] ? 'disabled' : ''}>Ler e comparar</button></details>
        ${k.risco === 'alto' && !rev.confirmada_por_pedro ? `<button class="es-btn ghost sm" data-action="ed-confirmar" data-id="${esc(k.id)}">Li a fonte e confirmo</button>` : ''}
      </div>`}
    </div>`;
  }

  function secaoFatos(c) {
    if (!c.claims.length) return '';
    const fatos = c.claims.filter((k) => !String(k.id).startsWith('o'));
    return `<div class="es-label">Conferência dos fatos</div>
      <div class="es-text" style="margin-bottom:8px">${c.claims.filter((k) => k.estado === 'sustentada').length} sustentada(s) · ${c.claims.filter((k) => k.estado === 'parcialmente_sustentada').length} em parte · ${c.claims.filter((k) => k.estado === 'contradita').length} contradita(s) · ${c.claims.filter((k) => k.estado === 'nao_verificada' && k.tipo !== 'opiniao').length} não verificada(s). As fontes são mostradas em cada afirmação.</div>
      ${(c.pipeline.afirmacoes?.descartadas || []).length ? `<div class="es-text">${c.pipeline.afirmacoes.descartadas.length} afirmação(ões) sugerida(s) pela IA foram descartadas porque o trecho citado não existe na matéria.</div>` : ''}
      <div class="es-stack">${fatos.map((k) => cartaoClaim(c, k)).join('')}</div>
      <details class="mz-det" data-aberto="nova" ${abertos.has('nova') ? 'open' : ''}><summary>Conferir uma afirmação sua</summary>
        <div class="es-text">Escreva o que você quer dizer. O sistema confere no que já foi lido e mostra se o trecho sustenta a afirmação inteira.</div>
        <textarea id="ed-nova-afirmacao" class="es-input" rows="2" placeholder="Ex.: a medida já está em vigor"></textarea>
        <button class="es-btn ghost" data-action="ed-nova-afirmacao" ${rodando[c.id] ? 'disabled' : ''}>Conferir</button>
      </details>`;
  }

  const opcoes = (obj, atual) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === atual ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.nome || v.rotulo || k)}</option>`).join('');

  function secaoBriefing(c) {
    const b = c.briefing;
    if (!b) return '';
    const E = window.Editorial;
    const temTexto = !!M.versaoAtiva(c);
    return `<div class="es-label">Briefing</div>
      <div class="es-card">
        <div class="mz-bloco"><b>Assunto</b><span>${esc(b.assunto)}</span></div>
        <div class="mz-bloco"><b>O que aconteceu</b><span>${esc(b.acontecimento)}</span></div>
        <div class="mz-bloco"><b>Por que interessa ao seu público</b><span>${esc(b.por_que_interessa)}</span></div>
        ${b.conflito ? `<div class="es-warn"><b>Os fatos não sustentam a posição de sempre.</b> ${esc(b.conflito.descricao)}${b.conflito.alternativa_enquadramento ? ` Enquadramento possível: ${esc(b.conflito.alternativa_enquadramento)}` : ''}</div>` : ''}
        <div class="es-label">Tese ou pergunta central (${b.tese_tipo === 'opiniao' ? 'opinião sua' : 'explicação'})</div>
        <textarea class="es-input" rows="2" data-ed-brief="tese">${esc(b.tese)}</textarea>
        <div class="es-label">Objetivo</div>
        <select class="es-input" data-ed-brief="objetivo">${opcoes(E.OBJETIVOS, b.objetivo)}</select>
        <div class="es-text">${esc(b.objetivo_motivo)}</div>
        <div class="es-label">Formato</div>
        <select class="es-input" data-ed-brief="formato"><option value="carrossel" ${b.formato === 'carrossel' ? 'selected' : ''}>Carrossel</option><option value="estatico" ${b.formato === 'estatico' ? 'selected' : ''}>Post estático (1 imagem)</option></select>
        <div class="es-text">${esc(b.formato_motivo)} Reels e Stories ainda não são gerados.</div>
        <div class="es-label">Estrutura</div>
        <select class="es-input" data-ed-brief="estrutura">${opcoes(E.ESTRUTURAS, b.estrutura)}</select>
        <div class="es-text">${esc(b.estrutura_motivo)}</div>
        <div class="mz-bloco"><b>Por que alguém enviaria, salvaria ou seguiria</b><span>${esc(b.motivo_compartilhar)}</span></div>
        <div class="mz-bloco"><b>Diferença para os posts recentes</b><span>${esc(b.diferenca_recentes)}</span></div>
        ${(b.duvidas || []).length ? `<div class="mz-bloco"><b>Dúvidas e limites</b>${b.duvidas.map((d) => `<span>• ${esc(d)}</span>`).join('')}</div>` : ''}
        ${b.alterado_apos_copia ? '<div class="es-warn">O briefing mudou depois do texto ser gerado. Gere o texto de novo para refletir.</div>' : ''}
        ${b.llm ? `<div class="es-text">Gerado por ${esc(b.llm.provider)} / ${esc(b.llm.model)} em ${esc(quando(b.gerado_em))}</div>` : ''}
        ${temTexto ? '' : '<button class="es-btn" data-action="ed-gerar-texto" ' + (rodando[c.id] ? 'disabled' : '') + '>Gerar o texto e a arte</button>'}
      </div>`;
  }

  function thumb(c, v, s) {
    const r = c.arte.renders.find((x) => x.slide_id === s.id && x.versao === v.id);
    if (!r) return '<div class="ed-thumb vazio">Arte ainda não gerada</div>';
    const velha = r.texto_hash !== M.hashRender(s);
    const nao = r.metrics && r.metrics.cabe === false;
    return `<div class="ed-thumb"><img data-render="${esc(r.blob_key)}" alt="Arte do slide ${r.indice}" ${velha ? 'style="opacity:.4"' : ''}>${velha ? '<span class="mz-chip warn">Arte desatualizada</span>' : ''}${nao ? '<span class="mz-chip err">Texto não cabe</span>' : ''}${(r.elementos || []).includes('encerramento_tipografico') ? '<span class="mz-chip warn">PROVISÓRIO: encerramento só de texto até você enviar o arquivo aprovado (Ajustes)</span>' : ''}${(r.elementos || []).includes('arquivo_aprovado') ? '<span class="mz-chip ok">Encerramento aprovado (arquivo original)</span>' : ''}${(r.elementos || []).includes('foto_baixa_resolucao') ? `<span class="mz-chip warn">Foto pequena (${r.metrics?.foto?.largura}×${r.metrics?.foto?.altura}): ampliada ${r.metrics?.foto?.ampliacao}×</span>` : ''}</div>`;
  }

  function cartaoSlide(c, v, s, i) {
    const n = v.slides.length;
    const primeiro = i === 0; const ultimo = s.layout === 'encerramento';
    const claims = (s.claim_ids || []).map((id) => c.claims.find((k) => k.id === id)).filter(Boolean);
    const layouts = primeiro ? ['capa_tipografica', 'capa_foto'] : ultimo ? ['encerramento'] : ['explicacao', 'prova', ...(s.dados ? ['comparacao'] : [])];
    return `<div class="es-card ed-slide">
      <div class="es-between"><b>${i + 1}/${n} · ${esc(window.Editorial.FUNCOES_SLIDE[s.funcao] || s.funcao || '')}</b>${s.bloqueado ? '<span class="mz-chip ok">Bloqueado</span>' : ''}</div>
      ${thumb(c, v, s)}
      ${ultimo ? `<div class="es-text">${s.layout === 'encerramento' ? 'Encerramento: usa o arquivo aprovado enviado em Ajustes, sem refazer.' : ''}</div>` : ''}
      ${!primeiro && !ultimo ? `<label class="es-label" for="titulo-${esc(s.id)}">Título (opcional)</label><input id="titulo-${esc(s.id)}" class="es-input" maxlength="120" data-ed-titulo="${esc(s.id)}" value="${esc(s.titulo || '')}" ${s.bloqueado ? 'disabled' : ''}>` : ''}
      <label class="es-label">Texto (use **palavra** para destacar)</label>
      <textarea class="es-input" rows="3" data-ed-texto="${esc(s.id)}" ${s.bloqueado ? 'disabled' : ''}>${esc(s.texto)}</textarea>
      <div class="es-row" style="gap:8px;flex-wrap:wrap">
        <select class="es-input" style="width:auto" data-ed-layout="${esc(s.id)}" ${s.bloqueado ? 'disabled' : ''} aria-label="Layout">${layouts.map((l) => `<option value="${l}" ${l === s.layout ? 'selected' : ''}>${LAYOUTS[l]}</option>`).join('')}</select>
        ${s.layout === 'prova' ? `<span class="es-text">Fonte na arte: ${esc(s.fonte_linha || 'sem fonte ligada')}</span>` : ''}
      </div>
      ${(() => { const a = (c.auditoria_textos || {})[s.id]; if (!a) return ''; const atual = a.hash_texto === M.hash(M.textoParaAuditoria(s)); return `<div class="mz-bloco"><b>Afirmações de fato neste slide${atual ? '' : ' (texto mudou: confira de novo)'}</b> <button class="es-btn ghost sm" style="width:auto" data-action="ed-auditar" ${rodando[c.id] ? 'disabled' : ''}>Conferir de novo</button>${a.premissas.map((p) => `<span>${p.claim_id ? '✓' : '✗'} ${esc(p.texto)}${p.claim_id ? ` — sustentado por ${esc(p.claim_id)}` : ' — <b>sem fonte</b>'}</span>`).join('') || '<span>Nenhuma afirmação de fato: só avaliação.</span>'}</div>`; })()}
      ${claims.length ? `<div class="es-text">Baseado em: ${claims.map((k) => `<span class="mz-chip ${(ESTADO_CLAIM[k.estado] || ESTADO_CLAIM.nao_verificada)[0]}" title="${esc(k.texto)}">${esc(k.texto.slice(0, 38))}${k.texto.length > 38 ? '…' : ''}</span>`).join(' ')}</div>` : '<div class="es-text">Sem número ou fato novo neste slide.</div>'}
      <div class="es-actions" style="flex-wrap:wrap">
        ${!primeiro && !ultimo ? `<button class="es-btn ghost sm" data-action="ed-mover" data-id="${esc(s.id)}" data-d="-1" ${i <= 1 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="es-btn ghost sm" data-action="ed-mover" data-id="${esc(s.id)}" data-d="1" ${i >= (v.slides[n - 1].layout === 'encerramento' ? n - 2 : n - 1) ? 'disabled' : ''} aria-label="Descer">↓</button>` : ''}
        <button class="es-btn ghost sm" data-action="ed-bloquear" data-id="${esc(s.id)}">${s.bloqueado ? 'Desbloquear' : 'Bloquear (aprovado)'}</button>
        ${primeiro && s.layout === 'capa_foto' ? '' : ''}
        ${primeiro ? `<label class="es-btn ghost sm" style="cursor:pointer;width:auto">Usar minha foto<input type="file" accept="image/png,image/jpeg,image/webp" data-ed-foto="${esc(s.id)}" hidden></label>` : ''}
        ${!primeiro && !ultimo ? `<button class="es-btn ghost sm" data-action="ed-novo-slide" data-id="${esc(s.id)}">+ Slide depois</button><button class="es-btn ghost sm" data-action="ed-remover" data-id="${esc(s.id)}">Remover</button>` : ''}
        <button class="es-btn ghost sm" data-action="ed-refazer-arte" data-id="${esc(s.id)}" ${rodando[c.id] ? 'disabled' : ''}>Refazer só esta arte</button>
      </div>
      ${s.imagem_id ? `<div class="es-text">Imagem: ${esc((c.imagens.find((x) => x.id === s.imagem_id) || {}).origem || 'sem origem registrada')}</div>` : ''}
    </div>`;
  }

  function secaoTexto(c) {
    const v = M.versaoAtiva(c);
    if (!v) return '';
    const capas = v.capas || [];
    const FOCO = { acontecimento: 'O fato', consequencia: 'A consequência', tensao: 'A tensão', gancho: 'Gancho extra' };
  const painelGanchos = (c) => {
    const g = ganchosUi[c.id];
    if (!g) return '';
    if (g.carregando) return '<div class="es-text">Escrevendo e filtrando ganchos…</div>';
    if (g.erro) return `<div class="es-warn">${esc(g.erro)}</div>`;
    const item = (k, i) => `<div class="ed-gancho"><b>${esc(k.texto)}</b><br><small>${esc((window.HookGuard?.FORMULAS[k.formula]?.nome) || 'sem fórmula reconhecida')} · ${k.checks.ok}/${k.checks.total} verificações${k.checks.itens.filter((q) => !q.ok).length ? ' · atenção: ' + esc(k.checks.itens.filter((q) => !q.ok).map((q) => q.label).join('; ')) : ''}</small><br><button class="es-btn ghost sm" data-action="ed-gancho-usar" data-g="${i}">Usar como capa</button></div>`;
    const todos = [...g.top, ...g.outros];
    return `<div class="ed-ganchos"><div class="es-label">Melhores ganchos (verificações objetivas, sem nota)</div>${g.top.map((k, i) => item(k, i)).join('') || '<div class="es-text">Nenhum gancho passou nas regras desta vez. Tente de novo.</div>'}
      ${g.outros.length ? `<details class="mz-det"><summary>${g.outros.length} outro(s) candidato(s)</summary>${g.outros.map((k, i) => item(k, g.top.length + i)).join('')}</details>` : ''}
      ${g.descartados.length ? `<details class="mz-det"><summary>${g.descartados.length} descartado(s): ver por quê</summary>${g.descartados.map((d) => `<div class="es-text"><b>${esc(d.texto)}</b><br>${esc(d.motivo)}</div>`).join('')}</details>` : ''}
      <div class="es-text">${esc(g.aviso || '')}</div></div>`;
  };
  const notaCapa = (k) => {
    const h = window.HookGuard ? window.HookGuard.checks(String(k.texto).replace(/\*\*/g, '')) : null;
    if (!h) return '';
    const falhas = h.itens.filter((i) => !i.ok).map((i) => i.label);
    const f = h.formula && window.HookGuard.FORMULAS[h.formula] ? window.HookGuard.FORMULAS[h.formula].nome : 'sem fórmula reconhecida';
    return `<small class="ed-capa-checks">${esc(f)} · ${h.ok}/${h.total} verificações${falhas.length ? ' · atenção: ' + esc(falhas.join('; ')) : ''}</small>`;
  };
    return `<div class="es-between"><div class="es-label">Texto e arte · versão ${esc(v.id)}</div><button class="es-btn ghost sm" style="width:auto" data-action="ed-desfazer" ${v.pai ? '' : 'disabled'}>↶ Desfazer</button></div>
      ${capas.length ? `<div class="es-card"><b>Escolha a capa</b><div class="es-text">Três jeitos diferentes de abrir, com a mesma base factual. Nenhuma foi escolhida por você ainda${v.capa_escolhida ? ' — escolhida: ' + esc(FOCO[(capas.find((x) => x.id === v.capa_escolhida) || {}).foco] || '') : ''}.</div>
        ${capas.map((k) => `<label class="ed-capa ${v.capa_escolhida === k.id ? 'sel' : ''}"><input type="radio" name="capa" data-ed-capa="${esc(k.id)}" ${v.capa_escolhida === k.id ? 'checked' : ''}><span><b>${esc(FOCO[k.foco] || k.foco)}</b><br>${esc(k.texto)}<br><small>${esc(k.explicacao)}</small>${notaCapa(k)}</span></label>`).join('')}
        <button class="es-btn ghost sm" data-action="ed-ganchos" ${ganchosUi[c.id]?.carregando ? 'disabled' : ''}>${ganchosUi[c.id]?.carregando ? 'Escrevendo ganchos…' : 'Mais ganchos'}</button>${painelGanchos(c)}</div>` : ''}
      <div class="es-stack">${v.slides.map((s, i) => cartaoSlide(c, v, s, i)).join('')}</div>
      <button class="es-btn ghost" data-action="ed-auditar" ${rodando[c.id] ? 'disabled' : ''}>Conferir fatos dos títulos, textos e legenda</button>
      <div class="es-label">Legenda</div>
      <textarea class="es-input" rows="7" data-ed-legenda="legenda">${esc(v.legenda)}</textarea>
      <div class="es-label">Chamada final</div>
      <input class="es-input" data-ed-legenda="cta" value="${esc(v.cta)}">
      <div class="es-label">Pedir um ajuste ao texto</div>
      <textarea id="ed-instrucao" class="es-input" rows="2" placeholder="Ex.: mais direto; menos números; abrir pelo efeito no bolso"></textarea>
      <div class="es-actions"><button class="es-btn ghost" data-action="ed-regerar" ${rodando[c.id] ? 'disabled' : ''}>Gerar outra versão do texto</button><button class="es-btn ghost" data-action="ed-arte-todas" ${rodando[c.id] ? 'disabled' : ''}>Refazer toda a arte</button></div>
      <div class="es-text">Gerar outra versão não apaga a atual: você pode voltar a ela.</div>`;
  }

  // Vários bloqueios do mesmo tipo viram um só cartão, sem repetições.
  function agrupar(lista) {
    const m = new Map();
    lista.forEach((b) => { if (!m.has(b.id)) m.set(b.id, { id: b.id, titulo: b.titulo, acao: b.acao, itens: [] }); const gr = m.get(b.id); if (!gr.itens.some((x) => x.detalhe === b.detalhe)) gr.itens.push(b); });
    return [...m.values()];
  }

  function secaoRevisao(c) {
    const v = M.versaoAtiva(c);
    if (!v) return '';
    const g = G.avaliar(c, { conta: M.ACCOUNT_PIN, recentes: window.Mesa.ctx().recentesParaPrompt() });
    const aprovado = c.revisao.aprovada_versao === v.id && c.revisao.hash_aprovado === v.hash;
    const r = g.resumo;
    const chip = (ok, t) => `<span class="mz-chip ${ok ? 'ok' : 'warn'}">${t}</span>`;
    return `<div class="es-label">Revisão</div>
      <div class="es-card">
        <div class="mz-top">${chip(r.conta === 'ok', 'Conta: ' + (r.conta === 'ok' ? '@pedro_destrava' : 'incorreta'))}${chip(r.fatos === 'ok', 'Fatos: ' + (r.fatos === 'ok' ? 'ok' : r.fatos === 'contradicao' ? 'contradição' : 'pendências'))}${chip(r.arte === 'ok', 'Arte: ' + (r.arte === 'ok' ? 'ok' : 'pendências'))}${chip(r.redacao === 'ok', 'Redação: ' + (r.redacao === 'ok' ? 'sem sugestões' : r.redacao === 'bloqueada' ? 'a capa precisa mudar' : g.sugestoes.length + ' sugestão(ões)'))}</div>
        ${g.bloqueios.length ? `<b>Impedem aprovar (${g.bloqueios.length})</b>${agrupar(g.bloqueios).map((gr) => `<div class="ed-bloq"><b>${esc(gr.titulo)}${gr.itens.length > 1 ? ` (${gr.itens.length})` : ''}</b>${gr.itens.length === 1 ? `<br>${esc(gr.itens[0].detalhe)}` : `<ul>${gr.itens.map((b) => `<li>${esc(b.detalhe)}</li>`).join('')}</ul>`}${gr.acao ? `<br><small>${esc(gr.acao)}</small>` : ''}${gr.itens.some((b) => b.onde?.claim) ? '<br><small>Decida em cada afirmação, na seção “Conferência dos fatos”.</small>' : ''}</div>`).join('')}` : '<div class="es-text"><b>Nenhum bloqueio.</b> Fatos, conta e arte estão em ordem.</div>'}
        ${g.sugestoes.length ? `<details class="mz-det" data-aberto="sug" ${abertos.has('sug') ? 'open' : ''}><summary>Sugestões de redação (não impedem nada)</summary>${g.sugestoes.map((b) => `<div class="mz-bloco"><b>${esc(b.titulo)}</b><span>${esc(b.detalhe)}</span></div>`).join('')}</details>` : ''}
        ${aprovado ? `<div class="es-text" style="margin-top:8px"><b>Aprovada</b> em ${esc(quando(c.revisao.aprovada_em))} (versão ${esc(v.id)}).</div>` : `<button class="es-btn" style="margin-top:10px" data-action="ed-aprovar" ${g.bloqueios.length ? 'disabled' : ''}>Aprovar esta versão</button>`}
        ${aprovado ? '<button class="es-btn" data-action="ed-exportar">Exportar arquivos (PNG, legenda e fontes)</button>' : ''}
      </div>
      ${c.exportacoes.length ? `<div class="es-text">Exportações: ${c.exportacoes.map((e) => `${esc(quando(e.em))} (versão ${esc(e.versao)})${e.hash_versao !== v.hash || !aprovado ? ' — <b>desatualizada: não corresponde ao texto atual</b>' : ''}`).join(' · ')}</div>
        ${c.exportacoes.some((e) => e.hash_versao !== v.hash) ? '<div class="es-warn">O texto mudou depois da última exportação. Os arquivos baixados antes não valem para esta versão: aprove e exporte de novo.</div>' : ''}
        <div class="es-label">Depois de postar</div>
        ${c.publicacao ? `<div class="es-text">Marcada como publicada ${c.publicacao.url ? `— <a href="${esc(c.publicacao.url)}" target="_blank" rel="noopener noreferrer">ver post</a>` : ''}. Versão publicada: ${esc(c.publicacao.versao_publicada || '—')}.</div>` : '<input id="ed-pub-url" class="es-input" inputmode="url" placeholder="Link do post no Instagram (https://www.instagram.com/p/…)"><button class="es-btn ghost" data-action="ed-publicado">Marcar como publicado</button><div class="es-text">O sistema não publica por você.</div>'}` : ''}`;
  }

  function secaoVersoes(c) {
    if (!c.copia.versoes.length) return '';
    const ativa = c.copia.versao_ativa;
    return `<details class="mz-det" data-aberto="ver" ${abertos.has('ver') ? 'open' : ''}><summary>Versões (${c.copia.versoes.length}) e histórico</summary>
      ${c.copia.versoes.slice().reverse().map((v) => `<div class="mz-bloco"><b>${esc(v.id)}${v.id === ativa ? ' · ativa' : ''}${c.revisao.aprovada_versao === v.id ? ' · aprovada' : ''} — ${esc(v.rotulo || '')}</b><span>${esc(quando(v.criada_em))} · por ${esc(v.origem)}</span><span>Capa: ${esc((v.slides[0]?.texto || '').slice(0, 90))}</span>
        ${v.id !== ativa ? `<button class="es-btn ghost sm" data-action="ed-ativar" data-v="${esc(v.id)}">Voltar para esta versão</button>` : ''}</div>`).join('')}
      ${(() => { const k = resumoConsumo(c); return `<div class="mz-bloco"><b>Consumo deste conteúdo</b><span>${k.chamadas} chamada(s) de IA${k.falhas ? ` (${k.falhas} falharam)` : ''} em ${k.etapas} etapa(s) · ${esc(k.modelos.join(', ') || '—')}</span><span>Tokens: ${k.entrada} de entrada, ${k.saida} de saída${k.semTokens ? ` (${k.semTokens} chamada(s) sem contagem do provedor)` : ''} · tentativas extras de provedor: ${k.tentativas_extra} · tempo de servidor: ${k.tempo_s}s</span><span>Custo: desconhecido — o provedor não informa preço na resposta${k.pago ? '; houve chamada a provedor PAGO' : ''}.</span></div>`; })()}
      <div class="mz-bloco"><b>Últimos eventos</b>${c.historico.slice(-8).reverse().map((h) => `<span>${esc(quando(h.em))} · ${esc(h.resumo)}</span>`).join('')}</div>
    </details>`;
  }

  function render(c) {
    window.Mesa.state.novo = null;
    return `${stepper(c)}${painelEstado(c)}${cartaoFonte(c)}${secaoFatos(c)}${secaoBriefing(c)}${secaoTexto(c)}${secaoRevisao(c)}${secaoVersoes(c)}
      <div class="es-actions" style="margin-top:14px"><button class="es-btn danger" data-action="arquivar" data-id="${esc(c.id)}">Arquivar</button></div>`;
  }

  // Arte que ficou para trás (aba fechada no meio, outro aparelho): desenhar o que
  // falta não usa IA e é determinístico, então é retomado sozinho ao abrir.
  const retomadas = new Set();
  function retomarArte() {
    const x = ctx(); const c = x.conteudoAtual();
    if (!c || rodando[c.id] || retomadas.has(c.id)) return;
    const v = M.versaoAtiva(c);
    if (!v || !feito(c, 'copy')) return;
    const falta = v.slides.some((s) => { const r = c.arte.renders.find((q) => q.slide_id === s.id && q.versao === v.id); return !r || r.texto_hash !== M.hashRender(s); });
    if (!falta) return;
    retomadas.add(c.id);
    aposEdicao(x, c, null, null, { silencioso: true });
  }

  // Miniaturas: carrega do banco local para o <img>.
  async function aposRender(root) {
    setTimeout(retomarArte, 0);
    root.querySelectorAll('img[data-render]').forEach(async (img) => {
      const key = img.dataset.render;
      if (!urls.has(key)) { const b = await S.obterBlob(key); if (!b?.blob) return; urls.set(key, URL.createObjectURL(b.blob)); }
      img.src = urls.get(key);
    });
    root.querySelectorAll('details[data-aberto]').forEach((d) => { d.ontoggle = () => { d.open ? abertos.add(d.dataset.aberto) : abertos.delete(d.dataset.aberto); }; });
  }

  // ── Entradas ────────────────────────────────────────────────────────────────
  function novoPorLink(x) {
    x.state.novo = { modo: 'link' }; x.state.sub = 'conteudo'; x.state.atual = null; x.render();
  }

  // Padrão único de carrossel ("Pedro Destrava — Minimalista"): a criação nova vai para o Radar, que pesquisa, escreve,
  // escolhe imagens e revisa no servidor. A reversão técnica (CARROSSEL_PADRAO=legado) devolve o fluxo antigo da mesa.
  let _padrao = null;
  async function padraoNovo(x) { if (_padrao === null) { try { _padrao = (await x.api('/api/radar/padrao')).ativo !== false; } catch { _padrao = true; } } return _padrao; }
  async function enviarAoRadar(x, corpo) {
    const r = await x.api('/api/radar/pautas', { method: 'POST', body: { ...corpo, origem: 'mesa' } });
    x.state.tab = 'radar'; if (window.RadarUI) { window.RadarUI._st.pautas.unshift(r.pauta); window.RadarUI.carregar(x, { forcar: true }); }
    x.toast('Pauta enviada ao Radar: o carrossel sai no padrão Pedro Destrava — Minimalista.'); x.render();
  }
  async function desenvolverPauta(p, x) {
    const fonte = (p.fontes || [])[0];
    if (!fonte?.url) { x.toast('Esta pauta não tem link de matéria.'); return; }
    if (await padraoNovo(x)) { try { await enviarAoRadar(x, { url: fonte.url, titulo: p.titulo }); } catch (e) { x.toast(e.message); } return; }
    const c = x.criarConteudoDeFonte({ url: fonte.url, titulo: p.titulo, pauta: { id: p.id, titulo: p.titulo, pilar: p.pilar, por_que_interessa: p.por_que_interessa, angulo: p.angulo, objetivo_sugerido: p.objetivo_sugerido, formato_sugerido: p.formato_sugerido, fontes: p.fontes } });
    await x.persistir(c);
    await x.abrirConteudo(c.id);
    sequencia(x, c, ATE_BRIEFING);
  }

  // ── Geração em lote (com o app aberto) ──────────────────────────────────────
  // Um conteúdo por vez, até o limite diário de criação. Cada um vira rascunho para
  // revisão na Central: nada é aprovado nem publicado aqui, e a capa continua sendo
  // escolha do Pedro. Pautas de assunto sensível ou parecidas com post recente são puladas.
  const lote = { rodando: false, parar: false, feitos: 0, alvo: 0, atual: null, pulados: 0, erros: 0, motivo: null };
  const hojeISO = () => new Date().toISOString().slice(0, 10);
  const criadosHoje = (x) => x.state.contents.filter((c) => c.origem?.lote && (c.created_at || '').slice(0, 10) === hojeISO()).length;

  async function pautasDoLote(x) {
    let pautas = x.state.descoberta?.dados?.pautas;
    if (!pautas?.length) {
      const d = await x.api('/api/content/discover', { method: 'POST', body: { pilares: x.state.config.pilares, recentes: x.recentesParaPrompt(), dias: 3 } });
      x.state.descoberta = { carregando: false, erro: null, dados: d };
      pautas = d.pautas;
    }
    const usadas = new Set(x.state.contents.flatMap((c) => [c.origem?.pauta?.id, c.origem?.url]).filter(Boolean));
    return pautas.filter((p) => p.fontes?.[0]?.url && p.risco !== 'alto' && !p.repete_recente && !usadas.has(p.id) && !usadas.has(p.fontes[0].url));
  }

  async function gerarLote(x, n) {
    if (lote.rodando) return;
    Object.assign(lote, { rodando: true, parar: false, feitos: 0, pulados: 0, erros: 0, alvo: n, atual: null, motivo: null });
    x.render();
    try {
      const cap = Math.max(1, Number(x.state.config.daily_generation_cap) || 10);
      const restante = cap - criadosHoje(x);
      if (restante <= 0) { lote.motivo = `Limite diário de criação atingido (${cap}/${cap}).`; return; }
      lote.alvo = Math.min(n, restante);
      const fila = await pautasDoLote(x);
      if (!fila.length) { lote.motivo = 'Nenhuma pauta nova adequada agora (as sensíveis e as parecidas com posts recentes são puladas).'; return; }
      if (await padraoNovo(x)) {
        // Lote no padrão novo: o servidor processa uma pauta por vez, com estado e erro por item, e retoma se cair.
        const itens = fila.slice(0, lote.alvo).map((p) => ({ url: p.fontes[0].url, titulo: p.titulo }));
        const r = await x.api('/api/radar/lotes', { method: 'POST', body: { itens, origem: 'mesa' } });
        lote.motivo = `Lote enviado ao Radar (${r.lote.total} pauta(s)). Acompanhe item por item na aba Radar; o app pode ser fechado.`;
        return;
      }
      for (const p of fila) {
        if (lote.parar || lote.feitos >= lote.alvo || lote.erros >= 3) break;
        lote.atual = p.titulo; x.render();
        const c = x.criarConteudoDeFonte({ url: p.fontes[0].url, titulo: p.titulo, pauta: { id: p.id, titulo: p.titulo, pilar: p.pilar, por_que_interessa: p.por_que_interessa, angulo: p.angulo, objetivo_sugerido: p.objetivo_sugerido, formato_sugerido: p.formato_sugerido, fontes: p.fontes } });
        c.origem.lote = true;
        await x.persistir(c);
        await sequencia(x, c, [...ATE_BRIEFING, ...TEXTO_E_ARTE]);
        if (feito(c, 'arte')) { lote.feitos += 1; M.registrar(c, 'sistema', 'lote', 'Gerado em lote; aguardando revisão'); await x.persistir(c); }
        else if (c.pipeline.leitura?.estado === 'erro') { c.status = 'arquivado'; M.registrar(c, 'sistema', 'lote', 'Pulada: a fonte não pôde ser lida'); await x.persistir(c); lote.pulados += 1; }
        else lote.erros += 1;
      }
      if (lote.erros >= 3) lote.motivo = 'Parei depois de 3 falhas seguidas (veja os erros em cada conteúdo).';
    } catch (e) { lote.motivo = e.message; }
    finally {
      lote.rodando = false; lote.atual = null; x.render();
      if (lote.feitos) {
        x.toast(`${lote.feitos} conteúdo(s) novo(s) para revisar na Central.`);
        x.api('/api/push/notificar-lote', { method: 'POST', body: { n: lote.feitos } }).catch(() => {});
      } else if (lote.motivo) x.toast(lote.motivo);
    }
  }

  async function iniciarNovo(x) {
    const modo = x.state.novo?.modo || 'link';
    const url = document.getElementById('ed-novo-url')?.value.trim();
    const texto = document.getElementById('ed-novo-texto')?.value.trim();
    if (modo === 'link' && !/^https?:\/\/\S+$/i.test(url || '')) { x.toast('Cole um link que comece com http:// ou https://'); return; }
    if (modo === 'texto' && (texto || '').length < 200) { x.toast('Cole um texto maior (pelo menos uns 200 caracteres).'); return; }
    if (await padraoNovo(x)) { try { await enviarAoRadar(x, modo === 'link' ? { url } : { texto }); } catch (e) { x.toast(e.message); } return; }
    const c = x.criarConteudoDeFonte(modo === 'link' ? { url } : { texto, titulo: texto.split('\n')[0].slice(0, 80) });
    await x.persistir(c);
    await x.abrirConteudo(c.id);
    sequencia(x, c, ATE_BRIEFING);
  }

  // ── Ações ───────────────────────────────────────────────────────────────────
  async function acao(a, el, x) {
    if (!a.startsWith('ed-')) return false;
    const c = x.conteudoAtual();
    const id = el.dataset.id;
    const claim = () => c.claims.find((k) => k.id === id);
    switch (a) {
      case 'ed-ganchos': {
        const fatos = (c.claims || []).filter((k) => k.estado === 'sustentada').slice(0, 12).map((k) => ({ id: k.id, texto: k.texto, estado: k.estado }));
        if (!fatos.length) { x.toast('Confira os fatos antes: não há afirmação sustentada para escrever ganchos.'); return true; }
        ganchosUi[c.id] = { carregando: true }; x.render();
        try {
          const r = await x.api('/api/content/ganchos', { method: 'POST', body: { request_id: x.novoId('gan'), conteudo_id: c.id, assunto: c.briefing?.assunto || c.titulo, angulo: c.briefing?.tese || '', claims: fatos, recentes: x.recentesParaPrompt ? x.recentesParaPrompt(c.id) : [] } });
          ganchosUi[c.id] = { top: r.top || [], outros: r.outros || [], descartados: r.descartados || [], aviso: r.aviso };
        } catch (e) { ganchosUi[c.id] = { erro: e.message || 'Não consegui escrever ganchos agora.' }; }
        x.render(); return true;
      }
      case 'ed-gancho-usar': {
        const g = ganchosUi[c.id]; const k = g && [...g.top, ...g.outros][Number(el.dataset.g)];
        if (!k) return true;
        const r1 = M.adicionarCapas(c, [{ texto: k.texto, formula: k.formula, claim_ids: k.claim_ids, explicacao: 'Gancho extra gerado e filtrado pelo código' }]);
        const novo = r1.versao.capas[r1.versao.capas.length - 1].id;
        const r2 = M.escolherCapa(c, novo);
        delete ganchosUi[c.id];
        await aposEdicao(x, c, r2.efeito, 'Capa trocada. Confira a arte e a revisão.'); return true;
      }
      case 'ed-modo': x.state.novo = { ...x.state.novo, modo: el.dataset.m }; x.render(); return true;
      case 'ed-iniciar': await iniciarNovo(x); return true;
      case 'ed-continuar': sequencia(x, c, ATE_BRIEFING.every((p) => feito(c, p)) ? TEXTO_E_ARTE : ATE_BRIEFING); return true;
      case 'ed-colar': {
        const t = document.getElementById('ed-colar')?.value.trim();
        if ((t || '').length < 200) { x.toast('Cole um texto maior (pelo menos uns 200 caracteres).'); return true; }
        c.origem = { tipo: 'texto', texto_bruto: t, origem_anterior: c.origem };
        c.fonte_principal = null; marca(c, 'leitura', 'pendente');
        M.registrar(c, 'pedro', 'fonte', 'Colou o texto da matéria'); await x.persistir(c);
        sequencia(x, c, ATE_BRIEFING); return true;
      }
      case 'ed-gerar-texto': sequencia(x, c, TEXTO_E_ARTE); return true;
      case 'ed-regerar': {
        const ins = document.getElementById('ed-instrucao')?.value.trim() || '';
        await regerarTexto(x, c, ins); return true;
      }
      case 'ed-verificar-link': {
        const u = document.getElementById(`ed-link-${id}`)?.value.trim();
        if (!/^https?:\/\/\S+$/i.test(u || '')) { x.toast('Cole um link que comece com http:// ou https://'); return true; }
        if (rodando[c.id]) return true;
        rodando[c.id] = true; x.render();
        try { const r = await verificarUma(x, c, claim(), [u]); reabrirAprovacao(c); M.registrar(c, 'pedro', 'pesquisa', `Conferiu com o link ${u}`); x.toast(`Resultado: ${(ESTADO_CLAIM[r.claim.estado] || [, r.claim.estado])[1]}. ${r.claim.motivo_estado || ''}`); } catch (e) { x.toast(e.message); }
        fim(x, c); await x.persistir(c); x.render(); return true;
      }
      case 'ed-verificar': {
        if (rodando[c.id]) return true;
        rodando[c.id] = true; const estadoAntes = c.pipeline.pesquisa.estado; marca(c, 'pesquisa', 'em_andamento', { progresso: 'Conferindo a afirmação…' }); x.render();
        try {
          const k = claim(); await verificarUma(x, c, k);
          const revAntes = k.revisao; const novo = c.claims.find((q) => q.id === id); novo.revisao = { ...revAntes, reaberta_em: null, aceito_com_ressalva: false };
          reabrirAprovacao(c);
          marca(c, 'pesquisa', 'concluida', { progresso: null }); M.registrar(c, 'pedro', 'pesquisa', 'Conferiu uma afirmação de novo');
        } catch (e) { marca(c, 'pesquisa', estadoAntes === 'concluida' ? 'concluida' : 'erro', { erro: e.message }); x.toast(e.message); }
        fim(x, c); await x.persistir(c); x.render(); return true;
      }
      case 'ed-decidir': {
        const tipo = el.dataset.tipo;
        if (tipo === 'corrigir' || tipo === 'atribuir') { decidindo = decidindo && decidindo.id === id && decidindo.tipo === tipo ? null : { id, tipo }; x.render(); return true; }
        if (tipo === 'retirar' && !window.confirm('Retirar esta afirmação? Ela não poderá ser usada no texto.')) return true;
        try { M.decidirAfirmacao(c, id, { tipo }); } catch (e) { x.toast(e.message); return true; }
        decidindo = null; await x.persistir(c); x.render(); x.toast(tipo === 'retirar' ? 'Afirmação retirada. Tire-a do texto onde aparecer.' : 'Mantida em revisão.'); return true;
      }
      case 'ed-decidir-ok': {
        const valor = document.getElementById('ed-dec-valor')?.value || '';
        const tipo = decidindo?.tipo;
        try { M.decidirAfirmacao(c, id, tipo === 'corrigir' ? { tipo, texto_novo: valor } : { tipo, condicao: valor }); } catch (e) { x.toast(e.message); return true; }
        decidindo = null; await x.persistir(c); x.render();
        if (tipo === 'corrigir') await conferirUma(x, c, c.claims.find((q) => q.id === id));
        else x.toast('Decisão registrada. A expressão precisa aparecer no texto público.');
        return true;
      }
      case 'ed-conferir': await conferirUma(x, c, claim()); return true;
      case 'ed-auditar': { if (rodando[c.id]) return true; rodando[c.id] = true; x.render(); try { await auditarOpinioes(x, c, { so_pendentes: false }); } catch (e) { x.toast(e.message); } fim(x, c); await x.persistir(c); x.render(); return true; }
      case 'ed-nova-afirmacao': {
        const t = document.getElementById('ed-nova-afirmacao')?.value.trim() || '';
        if (t.length < 12) { x.toast('Escreva a afirmação completa.'); return true; }
        const n = c.claims.filter((q) => q.origem === 'pedro').length + 1;
        const nova = { id: `p${n}`, texto: t, tipo: 'fato', central: true, risco: 'baixo', evidencias: [], origem: 'pedro', estado: 'nao_verificada', revisao: {}, criada_em: new Date().toISOString() };
        c.claims.push(nova); M.registrar(c, 'pedro', 'afirmacao', 'Escreveu uma afirmação para conferir');
        await x.persistir(c); await conferirUma(x, c, nova); return true;
      }
      case 'ed-confirmar': claim().revisao = { ...claim().revisao, confirmada_por_pedro: true, confirmada_em: new Date().toISOString() }; reabrirAprovacao(c); M.registrar(c, 'pedro', 'revisao', 'Confirmou assunto sensível após ler a fonte'); await x.persistir(c); x.render(); return true;
      case 'ed-mover': {
        const v = M.versaoAtiva(c); const ids = v.slides.map((s) => s.id); const i = ids.indexOf(id); const d = Number(el.dataset.d);
        const ultimoMovel = v.slides[ids.length - 1].layout === 'encerramento' ? ids.length - 2 : ids.length - 1;
        const j = i + d; if (j < 1 || j > ultimoMovel) return true;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const r = M.reordenarSlides(c, ids); await aposEdicao(x, c, r.efeito); return true;
      }
      case 'ed-bloquear': { const s = M.versaoAtiva(c).slides.find((q) => q.id === id); M.alternarBloqueio(c, id, !s.bloqueado); await x.persistir(c); x.render(); return true; }
      case 'ed-novo-slide': {
        let novoId;
        const ef = novaVersaoCom(c, (d) => { const i = d.slides.findIndex((s) => s.id === id); novoId = M.uid('s'); d.slides.splice(i + 1, 0, { id: novoId, funcao: 'explicacao', layout: 'explicacao', texto: 'Novo slide: escreva aqui.', claim_ids: [], bloqueado: false }); }, 'Slide adicionado');
        await aposEdicao(x, c, ef); return true;
      }
      case 'ed-remover': {
        if (!window.confirm('Remover este slide? Dá para voltar pela lista de versões.')) return true;
        const ef = novaVersaoCom(c, (d) => { d.slides = d.slides.filter((s) => s.id !== id); }, 'Slide removido');
        await aposEdicao(x, c, ef); return true;
      }
      case 'ed-refazer-arte': { marca(c, 'arte', 'em_andamento'); rodando[c.id] = true; x.render(); try { await atualizarArte(x, c, { soSlide: id }); marca(c, 'arte', 'concluida'); } catch (e) { marca(c, 'arte', 'erro', { erro: e.message }); x.toast(e.message); } fim(x, c); await x.persistir(c); x.render(); return true; }
      case 'ed-arte-todas': { rodando[c.id] = true; marca(c, 'arte', 'em_andamento'); x.render(); try { await atualizarArte(x, c, { todos: true }); marca(c, 'arte', 'concluida', { progresso: null }); } catch (e) { marca(c, 'arte', 'erro', { erro: e.message }); x.toast(e.message); } fim(x, c); await x.persistir(c); x.render(); return true; }
      case 'ed-ativar': M.ativarVersao(c, el.dataset.v); aposEdicao(x, c, null, `Voltou para a versão ${el.dataset.v}.`); return true;
      case 'ed-desfazer': M.desfazer(c); await aposEdicao(x, c, null, 'Voltou para a versão anterior.'); return true;
      case 'ed-aprovar': {
        const g = G.avaliar(c, { conta: M.ACCOUNT_PIN, recentes: x.recentesParaPrompt() });
        try { M.aprovar(c, g); } catch (e) { x.toast(e.bloqueios ? `Ainda há ${e.bloqueios.length} bloqueio(s).` : e.message); return true; }
        await S.snapshot(c, 'aprovado'); await x.persistir(c); x.render(); x.toast('Versão aprovada.'); return true;
      }
      case 'ed-exportar': try { await exportar(x, c); } catch (e) { x.toast(e.message); } x.render(); return true;
      case 'ed-publicado': {
        const url = document.getElementById('ed-pub-url')?.value.trim();
        if (url && !/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/i.test(url)) { x.toast('O link deve ser de um post do Instagram (instagram.com/p/… ou /reel/…).'); return true; }
        const ult = c.exportacoes[c.exportacoes.length - 1];
        if (ult && ult.hash_versao !== M.versaoAtiva(c).hash && !window.confirm('O texto atual é diferente do último arquivo exportado. Marcar como publicado assim mesmo? (fica registrado qual versão foi exportada)')) return true;
        M.registrarPublicacao(c, { url: url || null }); await S.snapshot(c, 'publicado'); await x.persistir(c); x.render(); return true;
      }
      default: return false;
    }
  }

  async function aoMudar(el, x) {
    const c = x.conteudoAtual();
    if (!c) return;
    const d = el.dataset;
    try {
      if (d.edBrief) {
        c.briefing[d.edBrief] = el.value;
        if (M.versaoAtiva(c)) c.briefing.alterado_apos_copia = true;
        M.registrar(c, 'pedro', 'briefing', `Alterou ${d.edBrief} do briefing`); await x.persistir(c); x.render(); return;
      }
      if (d.edTexto) { const r = M.editarSlide(c, d.edTexto, { texto: el.value.trim() }); return aposEdicao(x, c, r.efeito); }
      if (d.edTitulo) { const r = M.editarSlide(c, d.edTitulo, { titulo: el.value.trim() || null }); return aposEdicao(x, c, r.efeito); }
      if (d.edLayout) {
        const sl = M.versaoAtiva(c).slides.find((q) => q.id === d.edLayout);
        const patch = { layout: el.value };
        if (['prova', 'comparacao'].includes(el.value)) patch.fonte_linha = M.linhaDeFonte(c, sl.claim_ids) || null;
        const r = M.editarSlide(c, d.edLayout, patch); return aposEdicao(x, c, r.efeito);
      }
      if (d.edLegenda) { const r = M.editarLegenda(c, { [d.edLegenda]: el.value }); return aposEdicao(x, c, r.efeito); }
      if (d.edCapa) { const r = M.escolherCapa(c, d.edCapa); return aposEdicao(x, c, r.efeito); }
      if (d.edFoto && el.files?.[0]) {
        const f = el.files[0];
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { x.toast('Use PNG, JPG ou WebP.'); return; }
        if (f.size > 6 * 1024 * 1024) { x.toast('A foto passa de 6 MB. Reduza e envie de novo.'); return; }
        const imgId = M.uid('img');
        await S.salvarBlob(`img:${imgId}`, f, { content_id: c.id, nome: f.name });
        if (x.state.servidor?.configurado && window.Sync) await window.Sync.enviarArquivo(`img:${imgId}`, f).catch((e) => x.toast(`Foto guardada só neste aparelho: ${e.message}`));
        c.imagens.push({ id: imgId, tipo: 'foto_pedro', origem: 'Foto enviada pelo Pedro', credito: '@pedro_destrava', licenca: 'Imagem do próprio perfil', relevancia: 'alta', arquivo: f.name, enviada_em: new Date().toISOString() });
        const r = M.editarSlide(c, d.edFoto, { imagem_id: imgId, layout: 'capa_foto' });
        return aposEdicao(x, c, r.efeito);
      }
    } catch (e) { x.toast(e.message); x.render(); }
  }

  // Ao carregar o app: nada fica "andando" sem estar rodando.
  window.MesaEditor = { gerarLote, lote, criadosHoje, render, telaNovo, aposRender, acao, aoMudar, novoPorLink, desenvolverPauta, _internos: { montarZip, crc32, fichaDeFontes, atualizarArte, sequencia, etapaCopy } };
})();

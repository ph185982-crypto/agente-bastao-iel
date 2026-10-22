// Objeto central de cada conteúdo (esquema v1) e as regras que o mantêm coerente.
// Roda no navegador (window.ContentModel) e no Node (require): é puro, sem rede.
//
// Princípio: PNG, legenda, pesquisa e métricas são PARTES do mesmo objeto, ligadas
// por ids e por hash de versão. Nada é regravado por cima: cada edição cria uma
// versão nova, e desfazer só troca a versão ativa. Uma edição invalida só o que
// depende dela (cor não reabre pesquisa; número reabre afirmação, legenda e arte).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContentModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA = 1;

  // Cópia do que está em backend/lib/account.js; um teste confere que não divergem.
  const ACCOUNT_PIN = Object.freeze({ username: 'pedro_destrava', handle: '@pedro_destrava', ig_id: '74541076144' });
  const HANDLES_ERRADOS = ['pedrodestrava'];

  const STATUS = ['rascunho', 'em_revisao', 'aprovado', 'exportado', 'publicado', 'arquivado'];
  const ETAPAS = ['leitura', 'afirmacoes', 'pesquisa', 'briefing', 'copy', 'arte'];
  const ESTADOS_CLAIM = ['sustentada', 'parcialmente_sustentada', 'contradita', 'nao_verificada'];

  const agoraISO = () => new Date().toISOString();
  const uid = (p = 'id') => {
    const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
    return `${p}_${r}`;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ── Hash determinístico (igualdade e integridade, não segurança) ───────────
  function canonico(v) {
    if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  // Sem título, mantém compatibilidade com auditorias anteriores.
  function textoParaAuditoria(slide) {
    const texto = String(slide?.texto || '');
    return slide?.titulo ? `${slide.titulo}. ${texto}` : texto;
  }

  function hash(v) {
    const s = canonico(v);
    let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }

  // ── Números em texto PT-BR ─────────────────────────────────────────────────
  // "R$ 1.600,50" → 1600.5 | "94%" → 94 | "2 mil" → 2000 | "2,5 milhões" → 2500000
  const MULT = { mil: 1e3, mi: 1e6, bi: 1e9, tri: 1e12, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9, trilhao: 1e12, trilhoes: 1e12 };
  const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function extrairNumeros(texto) {
    const t = String(texto || '').replace(/ /g, ' ');
    const out = [];
    const re = /(R\$|US\$|€)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(%|por cento|mil(?:h[õo]es|h[ãa]o)?|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|trilh[õo]es|trilh[ãa]o|mi\b|bi\b|tri\b)?/gi;
    let m;
    while ((m = re.exec(t))) {
      const moeda = m[1] || null;
      let n = parseFloat(m[2].replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      const suf = m[3] ? semAcento(m[3]) : '';
      let tipo = 'quantidade';
      if (suf === '%' || suf === 'por cento') tipo = 'percentual';
      else if (MULT[suf]) n *= MULT[suf];
      if (moeda) tipo = 'moeda';
      else if (tipo === 'quantidade' && Number.isInteger(n) && n >= 1900 && n <= 2100 && !m[3]) tipo = 'ano';
      out.push({ raw: m[0].trim(), valor: n, tipo, moeda });
    }
    return out;
  }

  // Número que precisa ter origem: dinheiro, percentual, ano, ou quantidade ≥ 13.
  // Inteiros pequenos sem unidade ("5 passos", "3 erros") são contagem editorial.
  const exigeOrigem = (n) => n.tipo === 'moeda' || n.tipo === 'percentual' || n.tipo === 'ano' || n.valor >= 13 || !Number.isInteger(n.valor);

  const igual = (a, b) => {
    if (a === b) return true;
    const tol = Math.max(Math.abs(b) * 0.01, 0.005);
    return Math.abs(a - b) <= tol;
  };

  // ── Criação ────────────────────────────────────────────────────────────────
  function novoConteudo({ origem, conta, titulo, formato = 'carrossel' } = {}) {
    const agora = agoraISO();
    return {
      schema: SCHEMA,
      id: uid('c'),
      created_at: agora,
      updated_at: agora,
      titulo: titulo || '',
      status: 'rascunho',
      formato,
      origem: origem || { tipo: 'texto' },
      conta: conta || { ...ACCOUNT_PIN, confirmed_at: null, source: 'codigo' },
      pipeline: Object.fromEntries(ETAPAS.map((e) => [e, { estado: 'pendente' }])),
      fonte_principal: null,
      briefing: null,
      claims: [],
      evidencias: [],
      imagens: [],
      copia: { versao_ativa: null, versoes: [] },
      arte: { template: 'familia', versao_template: 1, renders: [] },
      revisao: { aprovada_versao: null, aprovada_em: null, hash_aprovado: null },
      exportacoes: [],
      publicacao: null,
      metricas: [],
      agenda: { data: null },
      historico: [{ em: agora, quem: 'sistema', tipo: 'criado', resumo: 'Conteúdo criado' }],
    };
  }

  function registrar(c, quem, tipo, resumo, extra) {
    c.historico.push({ em: agoraISO(), quem, tipo, resumo, ...(extra || {}) });
    c.updated_at = agoraISO();
    return c;
  }

  // ── Versões de copy ────────────────────────────────────────────────────────
  const conteudoDaVersao = (v) => ({
    estrutura: v.estrutura || null,
    capa_escolhida: v.capa_escolhida || null,
    slides: (v.slides || []).map((s) => ({ id: s.id, layout: s.layout, funcao: s.funcao || null, texto: s.texto, titulo: s.titulo || null, rotulo: s.rotulo || null, dados: s.dados || null, fonte_linha: s.fonte_linha || null, claim_ids: s.claim_ids || [], imagem_id: s.imagem_id || null, ...(s.estilo ? { estilo:s.estilo } : {}) })),
    legenda: v.legenda || '',
    cta: v.cta || '',
    hashtags: v.hashtags || [],
    legenda_claim_ids: v.legenda_claim_ids || [],
  });

  // Hash do que aparece na arte de um slide (detecta arte desatualizada).
  const hashRender = (s) => hash({ t: s.texto, l: s.layout, i: s.imagem_id || null, ti: s.titulo || null, d: s.dados || undefined, r: s.rotulo || undefined, f: s.fonte_linha || undefined, ...(s.estilo ? { estilo:s.estilo } : {}) });

  const versaoAtiva = (c) => c.copia.versoes.find((v) => v.id === c.copia.versao_ativa) || null;

  // Cria uma versão NOVA (nunca altera as antigas). Reabre a aprovação.
  function criarVersao(c, dados, { quem = 'pedro', rotulo = '' } = {}) {
    const n = c.copia.versoes.length + 1;
    const pai = versaoAtiva(c);
    // Metadados DEPOIS dos dados: a versão nova nunca herda id/hash/pai da anterior.
    const v = {
      ...clone(dados),
      id: `v${n}`,
      n,
      pai: pai ? pai.id : null,
      criada_em: agoraISO(),
      origem: quem,
      rotulo,
    };
    v.slides = (v.slides || []).map((s) => ({ id: s.id || uid('s'), bloqueado: false, claim_ids: [], ...s }));
    v.hash = hash(conteudoDaVersao(v));
    c.copia.versoes.push(v);
    c.copia.versao_ativa = v.id;
    if (c.revisao.aprovada_versao) {
      c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null, reaberta_em: agoraISO() };
      if (['aprovado', 'exportado'].includes(c.status)) c.status = 'em_revisao';
    }
    registrar(c, quem, 'versao', rotulo || `Versão ${v.id}`, { versao: v.id });
    return v;
  }

  // O que uma edição invalida. Cor/tema → só arte. Texto → arte do slide + aprovação.
  // Texto com número ou troca de afirmação → reabre as afirmações envolvidas.
  function efeitoDaEdicao(antes, depois, claims) {
    const efeito = { arte: [], afirmacoes: [], legenda: false, aprovacao: true };
    const mapaAntes = Object.fromEntries((antes.slides || []).map((s) => [s.id, s]));
    for (const s of depois.slides || []) {
      const a = mapaAntes[s.id];
      if (!a) { efeito.arte.push(s.id); continue; }
      if (hashRender(a) !== hashRender(s)) efeito.arte.push(s.id);
      // Reabre a conferência quando o slide ganha número novo ou liga outra afirmação.
      // Tirar um número do texto não cria risco factual.
      const nA = extrairNumeros(textoParaAuditoria(a)).map((n) => n.valor);
      const novosNumeros = extrairNumeros(textoParaAuditoria(s)).map((n) => n.valor).filter((v) => !nA.some((x) => igual(x, v)));
      const idsNovos = (s.claim_ids || []).filter((id) => !(a.claim_ids || []).includes(id));
      if (novosNumeros.length || idsNovos.length) {
        efeito.afirmacoes.push(...(s.claim_ids || []));
        efeito.legenda = true;
      }
    }
    if ((antes.slides || []).length !== (depois.slides || []).length) efeito.arte = (depois.slides || []).map((s) => s.id);
    efeito.afirmacoes = [...new Set(efeito.afirmacoes)];
    if (antes.legenda !== depois.legenda || antes.cta !== depois.cta) {
      const nA = extrairNumeros(antes.legenda).map((n) => n.valor);
      if (extrairNumeros(depois.legenda).some((n) => !nA.some((x) => igual(x, n.valor)))) efeito.legenda = true;
    }
    return efeito;
  }

  // Edição de um slide: cria versão nova e reabre só o que depende dela.
  function editarSlide(c, slideId, patch, { quem = 'pedro', rotulo } = {}) {
    const ativa = versaoAtiva(c);
    if (!ativa) throw new Error('Não há versão de texto para editar.');
    const alvo = ativa.slides.find((s) => s.id === slideId);
    if (!alvo) throw new Error('Slide não encontrado.');
    if (alvo.bloqueado && !patch.__forcar) throw new Error('Esse trecho está bloqueado (aprovado). Desbloqueie para editar.');
    const dados = clone(ativa);
    const s = dados.slides.find((x) => x.id === slideId);
    const { __forcar, ...resto } = patch;
    Object.assign(s, resto);
    const efeito = efeitoDaEdicao(ativa, dados, c.claims);
    const v = criarVersao(c, dados, { quem, rotulo: rotulo || `Edição no slide ${dados.slides.findIndex((x) => x.id === slideId) + 1}` });
    reabrirAfirmacoes(c, efeito.afirmacoes);
    return { versao: v, efeito };
  }

  function editarLegenda(c, patch, { quem = 'pedro' } = {}) {
    const ativa = versaoAtiva(c);
    const dados = clone(ativa);
    Object.assign(dados, patch);
    const efeito = efeitoDaEdicao(ativa, dados, c.claims);
    const v = criarVersao(c, dados, { quem, rotulo: 'Edição da legenda' });
    return { versao: v, efeito };
  }

  function reordenarSlides(c, ordemIds, { quem = 'pedro' } = {}) {
    const ativa = versaoAtiva(c);
    const mapa = Object.fromEntries(ativa.slides.map((s) => [s.id, s]));
    if (ordemIds.length !== ativa.slides.length || ordemIds.some((id) => !mapa[id])) throw new Error('Ordem inválida.');
    const dados = clone(ativa);
    dados.slides = ordemIds.map((id) => clone(mapa[id]));
    const v = criarVersao(c, dados, { quem, rotulo: 'Slides reordenados' });
    return { versao: v, efeito: { arte: ordemIds, afirmacoes: [], legenda: false, aprovacao: true } };
  }

  function escolherCapa(c, capaId, { quem = 'pedro' } = {}) {
    const ativa = versaoAtiva(c);
    const capa = (ativa.capas || []).find((x) => x.id === capaId);
    if (!capa) throw new Error('Capa não encontrada.');
    const dados = clone(ativa);
    dados.capa_escolhida = capaId;
    const primeiro = dados.slides[0];
    if (primeiro) { primeiro.texto = capa.texto; if (capa.claim_ids) primeiro.claim_ids = capa.claim_ids; }
    const efeito = efeitoDaEdicao(ativa, dados, c.claims);
    const v = criarVersao(c, dados, { quem, rotulo: `Capa: ${capa.foco}` });
    reabrirAfirmacoes(c, efeito.afirmacoes);
    return { versao: v, efeito };
  }

  function alternarBloqueio(c, slideId, bloquear) {
    const ativa = versaoAtiva(c);
    const s = ativa.slides.find((x) => x.id === slideId);
    if (!s) throw new Error('Slide não encontrado.');
    s.bloqueado = !!bloquear;
    ativa.hash = hash(conteudoDaVersao(ativa));
    registrar(c, 'pedro', 'bloqueio', `${bloquear ? 'Bloqueou' : 'Desbloqueou'} o slide`, { slide: slideId });
  }

  // Trocar a versão ativa nunca apaga nada: só aponta para outra. A aprovação
  // vale para UMA versão; apontar para outra a reabre.
  function ativarVersao(c, versaoId, { quem = 'pedro', resumo } = {}) {
    const v = c.copia.versoes.find((x) => x.id === versaoId);
    if (!v) throw new Error('Versão não encontrada.');
    c.copia.versao_ativa = v.id;
    if (c.revisao.aprovada_versao && c.revisao.aprovada_versao !== v.id) {
      c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null };
      if (['aprovado', 'exportado'].includes(c.status)) c.status = 'em_revisao';
    }
    registrar(c, quem, 'desfazer', resumo || `Voltou para ${v.id}`, { versao: v.id });
    return v;
  }

  // Desfazer não apaga: reativa a versão anterior.
  function desfazer(c) {
    const ativa = versaoAtiva(c);
    if (!ativa || !ativa.pai) throw new Error('Não há versão anterior.');
    return ativarVersao(c, ativa.pai);
  }

  function reabrirAfirmacoes(c, ids) {
    for (const id of ids || []) {
      const cl = c.claims.find((x) => x.id === id);
      if (!cl) continue;
      cl.revisao = { ...(cl.revisao || {}), reaberta_em: agoraISO(), confirmada_por_pedro: false, aceito_com_ressalva: null };
    }
  }

  // ── Estado de uma afirmação a partir das evidências ───────────────────────
  // Três perguntas, nesta ordem, e só a terceira olha a fonte:
  //  1. o trecho foi encontrado no documento acessado?  (trecho_encontrado)
  //  2. o trecho sustenta a afirmação INTEIRA?           (correspondencia)
  //  3. a fonte é adequada para ESTE tipo de afirmação? (autoridade × natureza)
  // Ausência de segunda fonte não rebaixa sozinha: uma fonte primária adequada
  // basta; duas republicações contam como uma; duas reportagens independentes
  // reforçam, mas uma fonte primária que contradiz prevalece.
  const NATUREZAS = ['fato', 'dado', 'anuncio', 'declaracao', 'previsao', 'opiniao'];
  const naturezaDe = (c) => (NATUREZAS.includes(c.natureza) ? c.natureza : c.tipo === 'declaracao' ? 'declaracao' : c.tipo === 'calculo' ? 'dado' : c.tipo === 'opiniao' ? 'opiniao' : 'fato');
  // Afirmações que só podem ir a público com quem disse / condição explícita.
  const EXIGE_ATRIBUICAO = new Set(['anuncio', 'declaracao', 'previsao']);
  const CORR_DE_REL = { sustenta: 'integral', parcial: 'parcial', neutra: 'nao_sustenta', contradiz: 'contradiz' };
  const corr = (e) => e.correspondencia || CORR_DE_REL[e.relacao] || 'nao_sustenta';
  const autoridade = (e) => e.autoridade || (e.tipo === 'primaria' ? 'primaria' : e.republicacao_da_fonte_principal ? 'republicacao' : 'reportagem');

  function avaliarAfirmacao(claim, evidencias) {
    const nat = naturezaDe(claim);
    const exige_atribuicao = EXIGE_ATRIBUICAO.has(nat);
    const r = (estado, motivo, extra) => ({ estado, motivo, natureza: nat, exige_atribuicao, ...(extra || {}) });
    const todas = (claim.evidencias || []).map((id) => evidencias.find((e) => e.id === id)).filter(Boolean);
    const ev = todas.filter((e) => e.trecho_encontrado !== false && e.trecho);
    // Texto colado ou print prova o que está escrito nele, não que seja verdade.
    if (ev.length && ev.every((e) => autoridade(e) === 'texto_colado') && naturezaDe(claim) !== 'opiniao') return r('nao_verificada', 'Só o texto colado diz isso. Ele prova o que está escrito, não que seja verdade: precisa de uma fonte acessada.');
    if (!ev.length) return r('nao_verificada', todas.length ? 'Nenhum trecho das fontes acessadas foi localizado para esta afirmação.' : 'Nenhuma fonte acessada trata desta afirmação.');
    if (nat === 'opiniao') return r('nao_verificada', 'Opinião: não se verifica; as premissas factuais é que são conferidas.');

    const grupos = (lista) => new Set(lista.map((e) => e.grupo || e.id));
    const integ = ev.filter((e) => corr(e) === 'integral');
    const parc = ev.filter((e) => corr(e) === 'parcial');
    const contra = ev.filter((e) => corr(e) === 'contradiz');
    const prim = (l) => l.filter((e) => autoridade(e) === 'primaria');
    const indep = (l) => grupos(l.filter((e) => autoridade(e) !== 'republicacao')).size + (l.some((e) => autoridade(e) === 'republicacao') && !l.some((e) => autoridade(e) !== 'republicacao') ? 1 : 0);
    const faltas = parc.map((e) => e.falta).filter(Boolean);

    if (prim(contra).length) return r('contradita', `Fonte primária contradiz: ${prim(contra)[0].origem}.`);
    if (contra.length) {
      if (prim(integ).length) return r('parcialmente_sustentada', `Fonte primária sustenta, mas ${contra[0].origem} diverge. Confira antes de publicar.`, { divergencia: true });
      if (indep(contra) >= indep(integ)) return r('contradita', `${contra[0].origem} contradiz e não há fonte mais forte a favor.`);
      return r('parcialmente_sustentada', `Fontes divergem (${contra[0].origem} contradiz).`, { divergencia: true });
    }
    if (prim(integ).length) return r('sustentada', `Fonte primária sustenta a afirmação inteira (${prim(integ)[0].origem}).`, { forca: 'primaria' });
    if (integ.length && (nat === 'anuncio' || nat === 'declaracao')) {
      return r('sustentada', `A reportagem registra o ${nat === 'anuncio' ? 'anúncio' : 'que foi dito'}. Isso comprova que foi ${nat === 'anuncio' ? 'anunciado' : 'dito'}, não que seja verdade ou que vá acontecer.`, { forca: 'reportagem' });
    }
    if (integ.length && nat === 'previsao') return r('sustentada', 'A fonte registra a previsão. Só pode ir a público como estimativa de quem a fez.', { forca: 'reportagem' });
    if (indep(integ) >= 2) return r('sustentada', `${indep(integ)} reportagens independentes sustentam a afirmação inteira (não substitui a fonte primária).`, { forca: 'multiplas' });
    if (integ.length) {
      // Uma reportagem original: basta para fato de baixo risco; dado estatístico e
      // assunto sensível pedem a fonte do dado ou confirmação.
      if (integ.every((e) => autoridade(e) === 'republicacao')) return r('parcialmente_sustentada', 'Só há reproduções da mesma matéria: não é confirmação independente.');
      if (nat === 'dado') return r('parcialmente_sustentada', `O número vem de ${integ[0].origem}, que não é quem produz o dado. Confira na fonte do dado ou publique atribuindo.`);
      if (claim.risco === 'alto') return r('parcialmente_sustentada', 'Assunto sensível com uma única reportagem: confirme em fonte primária ou publique atribuindo.');
      return r('sustentada', `Sustentada pela reportagem de ${integ[0].origem}; fonte primária não consultada.`, { forca: 'reportagem' });
    }
    if (parc.length) return r('parcialmente_sustentada', faltas.length ? `O trecho cobre só parte: ${faltas[0]}` : 'Os trechos cobrem só parte da afirmação.');
    return r('nao_verificada', 'Os trechos encontrados não sustentam esta afirmação.');
  }

  // ── Decisão do Pedro sobre uma afirmação que não está sustentada ────────────
  // Não existe "aceitar com ressalva" genérico. Cada decisão é específica e fica
  // no histórico: corrigir o texto (volta para conferência), publicar com
  // atribuição/condição explícita (a frase precisa aparecer no texto público),
  // retirar (não pode ser usada) ou manter em revisão (continua bloqueando).
  const DECISOES = ['corrigir', 'atribuir', 'retirar', 'em_revisao'];
  const temTrechoUtil = (c, cl) => (cl.evidencias || []).some((id) => {
    const e = c.evidencias.find((x) => x.id === id);
    return e && e.trecho && e.trecho_encontrado !== false && ['integral', 'parcial'].includes(corr(e));
  });
  function decidirAfirmacao(c, claimId, { tipo, condicao, texto_novo, justificativa } = {}, { quem = 'pedro' } = {}) {
    const cl = c.claims.find((x) => x.id === claimId);
    if (!cl) throw new Error('Afirmação não encontrada.');
    if (!DECISOES.includes(tipo)) throw new Error('Decisão inválida.');
    const agora = agoraISO();
    if (tipo === 'corrigir') {
      const t = String(texto_novo || '').trim();
      if (t.length < 12) throw new Error('Escreva a afirmação corrigida.');
      cl.textos_anteriores = [...(cl.textos_anteriores || []), { texto: cl.texto, ate: agora }];
      cl.texto = t;
      cl.estado = 'nao_verificada';
      cl.motivo_estado = 'Texto corrigido: precisa ser conferido de novo nas fontes.';
      cl.precisa_conferir = true;
    }
    if (tipo === 'atribuir') {
      const cond = String(condicao || '').trim();
      if (cond.length < 4) throw new Error('Escreva a atribuição ou condição que vai no texto (ex.: "segundo o governo", "ainda depende de aprovação").');
      if (cl.estado === 'contradita') throw new Error('Afirmação contradita não pode ir a público só com atribuição: corrija ou retire.');
      if (!temTrechoUtil(c, cl)) throw new Error('Nenhuma fonte acessada traz isso: não há a quem atribuir. Corrija ou retire.');
    }
    cl.decisao = tipo === 'em_revisao' ? null : { tipo, condicao: tipo === 'atribuir' ? String(condicao).trim() : null, justificativa: justificativa || null, em: agora, por: quem };
    if (c.revisao.aprovada_versao) {
      c.revisao = { aprovada_versao: null, aprovada_em: null, hash_aprovado: null, reaberta_em: agora };
      if (['aprovado', 'exportado'].includes(c.status)) c.status = 'em_revisao';
    }
    const rot = { corrigir: 'Corrigiu a afirmação', atribuir: `Decidiu publicar com atribuição/condição: “${cl.decisao?.condicao}”`, retirar: 'Retirou a afirmação', em_revisao: 'Manteve a afirmação em revisão' }[tipo];
    registrar(c, quem, 'decisao', rot, { claim: claimId });
    return cl;
  }

  // ── Texto de um slide/legenda → o que pode ser conferido ───────────────────
  function valoresPermitidos(c, claimIds) {
    const vals = [];
    for (const id of claimIds || []) {
      const cl = c.claims.find((x) => x.id === id);
      if (!cl) continue;
      extrairNumeros(cl.texto).forEach((n) => vals.push(n.valor));
      (cl.valores || []).forEach((v) => { if (Number.isFinite(Number(v.valor))) vals.push(Number(v.valor)); });
      if (cl.calculo) {
        if (Number.isFinite(Number(cl.calculo.resultado))) vals.push(Number(cl.calculo.resultado));
        (cl.calculo.entradas || []).forEach((e) => { if (Number.isFinite(Number(e.valor))) vals.push(Number(e.valor)); });
      }
      (cl.evidencias || []).forEach((eid) => {
        const e = c.evidencias.find((x) => x.id === eid);
        if (e) { extrairNumeros(`${e.trecho || ''} ${e.periodo || ''}`).forEach((n) => vals.push(n.valor)); }
      });
    }
    return vals;
  }

  // Linha de fonte que aparece na arte: montada DAS EVIDÊNCIAS, nunca escrita pela IA.
  const dd = (iso) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  function linhaDeFonte(c, claimIds) {
    const cl = (claimIds || []).map((id) => c.claims.find((x) => x.id === id)).find(Boolean);
    if (!cl) return '';
    if (cl.calculo) {
      const ent = (cl.calculo.entradas || []).map((e) => `${e.nome} ${e.valor}`).join('; ');
      const ev = (cl.evidencias || []).map((id) => c.evidencias.find((x) => x.id === id)).find(Boolean);
      return `Cálculo: ${cl.calculo.formula} (${ent}) · ${ev ? ev.origem : 'fontes oficiais'} · consulta ${dd(ev?.consultada_em) || ''}`.trim();
    }
    const evs = (cl.evidencias || []).map((id) => c.evidencias.find((x) => x.id === id)).filter(Boolean);
    const e = evs.find((x) => x.tipo === 'primaria' && x.relacao !== 'contradiz') || evs.find((x) => x.relacao === 'sustenta') || evs[0];
    if (!e) return '';
    const partes = [`Fonte: ${e.origem}`];
    if (e.titulo && e.via === 'artigo') partes.push(`“${e.titulo.length > 70 ? `${e.titulo.slice(0, 67)}…` : e.titulo}”`);
    if (e.publicada_em) partes.push(`publicada em ${dd(e.publicada_em)}`);
    partes.push(`consultada em ${dd(e.consultada_em)}`);
    return partes.join(' · ');
  }

  // ── Migração de itens da fila antiga (esteira v1) ─────────────────────────
  // Nada é descartado. O item vira rascunho marcado como legado: foi gerado
  // antes da base de evidências, então não pode ser aprovado sem revisão.
  function migrarItemLegado(item) {
    const c = novoConteudo({
      titulo: item.title || '',
      formato: item.format === 'roteiro' ? 'reels' : item.format === 'corte_tv' ? 'corte_tv' : 'carrossel',
      origem: { tipo: 'legado', texto_bruto: item.summary || '' },
    });
    c.id = item.id ? `legacy_${item.id}` : c.id;
    c.created_at = item.created_at || c.created_at;
    c.updated_at = item.updated_at || c.updated_at;
    c.status = item.status === 'postado' ? 'publicado' : 'rascunho';
    c.agenda = { data: item.scheduled_date || null };
    c.legado = {
      id_original: item.id, formato: item.format, tipo_carrossel: item.carousel_type || null,
      pilar: item.pillar || null, fonte_nome: item.source_name || null, fonte_url: item.source_url || null,
      video_url: item.video_url || null, legenda: item.caption || '', hashtags: item.hashtags || [],
      arquivos: item.assets || [], status_antigo: item.status, nota_antiga_ignorada: item.viral?.score ?? null,
      metricas_manuais: item.metrics || null, roteiro: item.roteiro || null,
      aviso: 'Gerado antes da base de evidências. Fatos, números e arte não foram verificados.',
    };
    if (item.status === 'postado') c.publicacao = { url: item.metrics?.url || null, ig_post_id: null, publicado_em: item.posted_at || null, versao_publicada: null, legenda_publicada: item.caption || '' };
    registrar(c, 'sistema', 'migrado', 'Migrado da fila anterior como rascunho não verificado');
    return c;
  }

  // ── Aprovação, exportação ──────────────────────────────────────────────────
  function aprovar(c, resultadoGates, { quem = 'pedro' } = {}) {
    const ativa = versaoAtiva(c);
    if (!ativa) throw new Error('Não há versão para aprovar.');
    if (resultadoGates.bloqueios.length) {
      const e = new Error('Há bloqueios abertos.');
      e.bloqueios = resultadoGates.bloqueios;
      throw e;
    }
    c.revisao = { aprovada_versao: ativa.id, aprovada_em: agoraISO(), hash_aprovado: ativa.hash, por: quem };
    c.status = 'aprovado';
    registrar(c, quem, 'aprovacao', `Aprovou a versão ${ativa.id}`, { versao: ativa.id });
    return c;
  }

  function registrarExportacao(c, { arquivos, hashes }) {
    const ativa = versaoAtiva(c);
    if (!c.revisao.aprovada_versao || !ativa || ativa.id !== c.revisao.aprovada_versao || ativa.hash !== c.revisao.hash_aprovado) {
      throw new Error('Só a versão aprovada pode ser exportada.');
    }
    c.exportacoes.push({ em: agoraISO(), versao: ativa.id, hash_versao: ativa.hash, arquivos, hashes: hashes || [] });
    c.status = 'exportado';
    registrar(c, 'sistema', 'exportacao', `Exportou a versão ${ativa.id}`, { versao: ativa.id });
    return c;
  }

  function registrarPublicacao(c, { url, ig_post_id, publicado_em, legenda_publicada }) {
    const exp = c.exportacoes[c.exportacoes.length - 1];
    c.publicacao = { url: url || null, ig_post_id: ig_post_id || null, publicado_em: publicado_em || agoraISO(), versao_publicada: exp ? exp.versao : null, legenda_publicada: legenda_publicada ?? (versaoAtiva(c)?.legenda || '') };
    c.status = 'publicado';
    registrar(c, 'pedro', 'publicado', 'Marcou como publicado');
    return c;
  }

  function resumoParaLista(c) {
    const v = versaoAtiva(c);
    return {
      id: c.id, titulo: c.titulo, status: c.status, formato: c.formato, atualizado: c.updated_at,
      versao: v ? v.id : null, legado: !!c.legado, agenda: c.agenda?.data || null,
      etapa_pendente: ETAPAS.find((e) => c.pipeline[e]?.estado !== 'concluida') || null,
    };
  }

  return {
    SCHEMA, ACCOUNT_PIN, HANDLES_ERRADOS, STATUS, ETAPAS, ESTADOS_CLAIM,
    textoParaAuditoria, hash, hashRender, linhaDeFonte, canonico, uid, clone, extrairNumeros, exigeOrigem, igual, semAcento,
    novoConteudo, criarVersao, versaoAtiva, conteudoDaVersao, efeitoDaEdicao,
    editarSlide, editarLegenda, reordenarSlides, escolherCapa, alternarBloqueio, desfazer, ativarVersao,
    avaliarAfirmacao, decidirAfirmacao, DECISOES, naturezaDe, NATUREZAS, EXIGE_ATRIBUICAO, valoresPermitidos, migrarItemLegado, aprovar, registrarExportacao, registrarPublicacao,
    registrar, resumoParaLista,
  };
});

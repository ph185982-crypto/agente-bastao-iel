// Bloqueios e sugestões. SEPARADOS de propósito:
//  - bloqueios: impedem marcar como aprovado (conta, fatos, citações, selo, texto
//    cortado, versão exportada diferente da aprovada);
//  - sugestões: melhoram a redação, não impedem nada.
// Um post pode estar bem escrito e factualmente pendente: o resumo mostra os dois.
// Puro e sem rede. Não existe "nota": cada item diz o que está errado e onde.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./contentModel') : root.ContentModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QualityGates = api;
})(typeof self !== 'undefined' ? self : this, function (M) {
  const LIMITE_PALAVRAS = { capa_foto: 18, capa_tipografica: 20, explicacao: 55, prova: 45, comparacao: 45, encerramento: 30 };

  const ABERTURAS_GENERICAS = [/^voc[eê] sabia/i, /^prepare-se/i, /^aten[cç][aã]o[:!]/i, /^isso muda tudo/i, /^uma reflex[aã]o/i, /^vamos falar sobre/i, /^hoje eu (quero|vou) falar/i, /^nesse (post|v[ií]deo)/i];
  const A_EVITAR = [/isso muda tudo/i, /uma reflex[aã]o necess[aá]ria/i, /voc[eê] n[aã]o vai acreditar/i, /ningu[eé]m (te )?conta/i];
  const PROMESSA = /\b(garant(o|ido|ia)|vai (ficar rico|dobrar)|dobre seu dinheiro|resultado certo|sem risco)\b/i;
  const ABSOLUTOS = /\b(sempre|nunca|todos|ningu[eé]m|comprova|prova que|fica claro que|sem d[uú]vida)\b/i;
  const LINGUAGEM_RELATORIO = /\b(outrossim|destarte|no que tange|conforme exposto|em suma|ressalte-se|cabe destacar)\b/i;

  const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
  const norm = (s) => M.semAcento(s).replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const limpa = (s) => String(s || '').replace(/\*\*/g, '');

  function textosDaVersao(v) {
    const t = [];
    (v.slides || []).forEach((s, i) => t.push({ onde: { slide: s.id, indice: i + 1 }, texto: limpa(`${s.titulo ? s.titulo + '. ' : ''}${s.texto}`), claim_ids: s.claim_ids || [], tipo: 'slide', layout: s.layout }));
    t.push({ onde: { campo: 'legenda' }, texto: limpa(v.legenda), claim_ids: v.legenda_claim_ids || [], tipo: 'legenda' });
    t.push({ onde: { campo: 'cta' }, texto: limpa(v.cta), claim_ids: v.legenda_claim_ids || [], tipo: 'cta' });
    return t;
  }

  function corpusEvidencias(c) {
    const partes = [];
    (c.evidencias || []).forEach((e) => partes.push(e.trecho, e.titulo, e.origem));
    if (c.fonte_principal) partes.push(c.fonte_principal.titulo, c.fonte_principal.origem, c.fonte_principal.texto);
    (c.claims || []).forEach((cl) => partes.push(cl.texto));
    return norm(partes.filter(Boolean).join(' \n '));
  }

  function claimsUsadas(c, textos) {
    const ids = new Set();
    textos.forEach((t) => (t.claim_ids || []).forEach((id) => ids.add(id)));
    return [...ids].map((id) => c.claims.find((x) => x.id === id)).filter(Boolean);
  }

  const bloqueio = (id, eixo, titulo, detalhe, onde, acao) => ({ id, eixo, titulo, detalhe, onde: onde || null, acao: acao || null });
  const sugestao = (id, eixo, titulo, detalhe, onde) => ({ id, eixo, titulo, detalhe, onde: onde || null });

  // ── Bloqueios ──────────────────────────────────────────────────────────────
  function bloqueios(c, ctx) {
    const out = [];
    const v = M.versaoAtiva(c);
    const pin = (ctx && ctx.conta) || M.ACCOUNT_PIN;

    if (!v) {
      out.push(bloqueio('sem_versao', 'fatos', 'Não há texto para aprovar', 'Gere ou escreva o texto antes de revisar.', null, 'Ir para o texto'));
      return out;
    }
    const textos = textosDaVersao(v);

    // Conta
    if (!c.conta || c.conta.ig_id !== pin.ig_id || String(c.conta.username).toLowerCase() !== pin.username) {
      out.push(bloqueio('conta_incorreta', 'conta', 'Conta incorreta', `Este conteúdo está ligado a ${c.conta?.username || 'nenhuma conta'}, não a ${pin.handle}.`, null, 'Não aprove: crie o conteúdo de novo'));
    }
    const todoTexto = textos.map((t) => t.texto).join(' ') + ' ' + (v.hashtags || []).join(' ');
    M.HANDLES_ERRADOS.forEach((h) => {
      if (new RegExp(`@${h}(?![a-z0-9_])`, 'i').test(todoTexto)) out.push(bloqueio('handle_errado', 'conta', `Aparece @${h}`, `O @ correto é ${pin.handle}. Corrija o texto.`, null, 'Corrigir o @'));
    });

    // Legado
    if (c.legado) {
      out.push(bloqueio('legado_nao_verificado', 'fatos', 'Gerado antes da base de evidências', 'Fatos, números e arte deste item não foram verificados. Refaça pela Mesa para poder aprovar.', null, 'Refazer pela Mesa'));
    }

    // Afirmações usadas
    const usadas = claimsUsadas(c, textos);
    for (const cl of usadas) {
      const rev = cl.revisao || {};
      const central = cl.central !== false;
      if (cl.tipo === 'opiniao') {
        (cl.premissas || []).forEach((pid) => {
          const p = c.claims.find((x) => x.id === pid);
          if (p && p.estado !== 'sustentada') out.push(bloqueio('premissa_pendente', 'fatos', 'Opinião com premissa factual pendente', `“${cl.texto}” depende de “${p.texto}”, que está ${rotuloEstado(p.estado)}.`, { claim: cl.id }, 'Verificar a premissa'));
        });
        continue;
      }
      if (cl.estado === 'contradita' && !rev.resolvido) {
        out.push(bloqueio('contradicao_nao_resolvida', 'fatos', 'Fonte contradiz a afirmação', `“${cl.texto}”: ${cl.motivo_estado || 'as fontes contradizem'}. Corrija a afirmação ou marque como resolvida com justificativa.`, { claim: cl.id }, 'Rever afirmação'));
      } else if (central && (cl.estado === 'nao_verificada' || !cl.estado)) {
        out.push(bloqueio('afirmacao_sem_sustentacao', 'fatos', 'Afirmação central sem fonte', `“${cl.texto}” não foi confirmada por nenhuma fonte consultada.`, { claim: cl.id }, 'Buscar fonte ou remover'));
      } else if (central && cl.estado === 'parcialmente_sustentada' && !rev.aceito_com_ressalva) {
        out.push(bloqueio('afirmacao_parcial', 'fatos', 'Afirmação central só em parte sustentada', `“${cl.texto}”: ${cl.motivo_estado || 'as fontes cobrem só parte'}. Ajuste o texto ao que a fonte diz ou aceite com ressalva.`, { claim: cl.id }, 'Ajustar ou aceitar com ressalva'));
      }
      if (cl.risco === 'alto' && !rev.confirmada_por_pedro && cl.estado !== 'contradita') {
        out.push(bloqueio('revisao_humana_pendente', 'fatos', 'Assunto sensível: confirme você mesmo', `“${cl.texto}” envolve pessoas, acusações ou impacto alto. Leia a fonte e confirme.`, { claim: cl.id }, 'Confirmar'));
      }
    }

    // Números e consistência entre capa, slides e legenda
    const porClaim = new Map();
    for (const t of textos) {
      const permitidos = M.valoresPermitidos(c, t.claim_ids);
      for (const n of M.extrairNumeros(t.texto).filter(M.exigeOrigem)) {
        const ok = permitidos.some((p) => M.igual(n.valor, p));
        if (ok) continue;
        if (!t.claim_ids.length) {
          out.push(bloqueio('numero_sem_afirmacao', 'fatos', 'Número sem afirmação ligada', `“${n.raw}” aparece ${rotuloOnde(t)} sem estar ligado a uma afirmação com fonte.`, t.onde, 'Ligar a uma fonte ou remover'));
        } else {
          out.push(bloqueio('numero_sem_origem', 'fatos', 'Número que as fontes não trazem', `“${n.raw}” aparece ${rotuloOnde(t)}, mas não consta nas afirmações e evidências ligadas.`, t.onde, 'Corrigir o número'));
          const key = t.claim_ids.join('|');
          if (!porClaim.has(key)) porClaim.set(key, []);
          porClaim.get(key).push({ n, onde: t.onde });
        }
      }
    }
    for (const [key, lista] of porClaim) {
      const doMesmoTipo = lista.filter((x) => x.n.tipo === 'moeda' || x.n.tipo === 'percentual');
      const valores = new Set(doMesmoTipo.map((x) => `${x.n.tipo}:${x.n.valor}`));
      if (valores.size > 1) out.push(bloqueio('valores_divergentes', 'fatos', 'Números diferentes para a mesma afirmação', `Capa, slides ou legenda trazem valores diferentes ligados à mesma afirmação (${[...valores].map((s) => s.split(':')[1]).join(' × ')}).`, null, 'Alinhar os números'));
      void key;
    }

    // Citações e atribuições
    const corpus = corpusEvidencias(c);
    for (const t of textos) {
      const re = /[“"]([^”"]{12,})[”"]/g;
      let m;
      while ((m = re.exec(t.texto))) {
        if (!corpus.includes(norm(m[1]))) out.push(bloqueio('citacao_sem_origem', 'fatos', 'Citação que não está na fonte', `A frase entre aspas “${m[1].slice(0, 60)}…” não aparece em nenhuma fonte consultada.`, t.onde, 'Remover as aspas ou citar exatamente'));
      }
      const reAt = /\b([Ss]egundo|[Dd]e acordo com|[Cc]onforme|[Dd]isse|[Aa]firmou|[Dd]eclarou|[Aa]firma|[Dd]iz)\s+(?:o |a |os |as |do |da )?((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.'-]*)(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.'-]*){0,3})/g;
      while ((m = reAt.exec(t.texto))) {
        const nome = norm(m[2]);
        if (nome.length >= 3 && !corpus.includes(nome)) out.push(bloqueio('atribuicao_sem_origem', 'fatos', 'Atribuição sem fonte', `“${m[1]} ${m[2]}” não aparece nas fontes consultadas.`, t.onde, 'Confirmar quem disse ou remover'));
      }
    }

    // Capa: o Pedro escolhe entre as opções
    if ((v.capas || []).length && !v.capa_escolhida) out.push(bloqueio('capa_nao_escolhida', 'arte', 'Escolha uma das capas', 'Há três opções de capa e nenhuma foi escolhida.', null, 'Escolher a capa'));

    // Arte
    const renders = c.arte?.renders || [];
    const idsSlides = (v.slides || []).map((s) => s.id);
    const faltam = idsSlides.filter((id) => !renders.find((r) => r.slide_id === id && r.versao === v.id));
    if (faltam.length) out.push(bloqueio('arte_pendente', 'arte', 'Arte ainda não gerada', `${faltam.length} slide(s) sem arte desta versão.`, null, 'Gerar a arte'));
    for (const r of renders.filter((x) => x.versao === v.id)) {
      const s = (v.slides || []).find((x) => x.id === r.slide_id);
      if (!s) continue;
      if (r.texto_hash && r.texto_hash !== M.hashRender(s)) {
        out.push(bloqueio('arte_desatualizada', 'arte', 'Arte desatualizada', 'O texto mudou depois de gerar a arte.', { slide: s.id }, 'Gerar a arte de novo'));
      }
      if (r.metrics && r.metrics.cabe === false) out.push(bloqueio('texto_cortado', 'arte', 'Texto não cabe na arte', `No slide ${idsSlides.indexOf(r.slide_id) + 1} o texto passa do espaço ou fica pequeno demais para ler.`, { slide: s.id }, 'Encurtar, dividir ou trocar o layout'));
      if ((r.elementos || []).some((e) => /selo|verificad|badge/i.test(e))) out.push(bloqueio('selo_falso', 'arte', 'Selo de verificação na arte', 'A conta não é verificada: nenhum selo pode aparecer.', { slide: s.id }, 'Gerar a arte de novo'));
    }
    (v.slides || []).forEach((s) => { if (s.selo || /selo|badge/i.test(s.layout || '')) out.push(bloqueio('selo_falso', 'arte', 'Selo de verificação no slide', 'Remova o selo.', { slide: s.id })); });

    // Imagens
    const usadasImg = (v.slides || []).map((s) => (c.imagens || []).find((i) => i.id === s.imagem_id)).filter(Boolean);
    usadasImg.forEach((img) => { if (img.tipo !== 'tipografica' && !img.origem) out.push(bloqueio('imagem_sem_origem', 'arte', 'Imagem sem origem', 'Registre de onde vem a imagem e as condições de uso.', { imagem: img.id }, 'Informar a origem ou trocar')); });

    return dedupe(out);
  }

  function dedupe(lista) {
    const vistos = new Set();
    return lista.filter((b) => { const k = `${b.id}|${b.detalhe}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  }
  const rotuloEstado = (e) => ({ sustentada: 'sustentada', parcialmente_sustentada: 'só em parte sustentada', contradita: 'contradita', nao_verificada: 'não verificada' }[e] || 'não verificada');
  const rotuloOnde = (t) => (t.tipo === 'slide' ? `no slide ${t.onde.indice}` : t.tipo === 'legenda' ? 'na legenda' : 'no CTA');

  // ── Sugestões de redação ───────────────────────────────────────────────────
  function sugestoes(c, ctx) {
    const out = [];
    const v = M.versaoAtiva(c);
    if (!v) return out;
    const textos = textosDaVersao(v);
    const slides = textos.filter((t) => t.tipo === 'slide');

    const capa = slides[0];
    if (capa && ABERTURAS_GENERICAS.some((r) => r.test(capa.texto))) out.push(sugestao('abertura_generica', 'redacao', 'Abertura genérica', 'A capa começa com uma fórmula comum. Abra com o fato ou com a tensão do assunto.', capa.onde));
    textos.forEach((t) => { A_EVITAR.forEach((r) => { if (r.test(t.texto)) out.push(sugestao('expressao_a_evitar', 'redacao', 'Expressão desgastada', `“${(t.texto.match(r) || [''])[0]}” diz pouco. Diga o que muda e por quê.`, t.onde)); }); });
    textos.forEach((t) => { if (PROMESSA.test(t.texto)) out.push(sugestao('promessa_resultado', 'redacao', 'Promessa de resultado', 'Evite prometer ganho ou resultado.', t.onde)); });
    textos.forEach((t) => { if (LINGUAGEM_RELATORIO.test(t.texto)) out.push(sugestao('linguagem_relatorio', 'redacao', 'Linguagem de relatório', 'Fale como você falaria com alguém.', t.onde)); });

    slides.forEach((t) => {
      const lim = LIMITE_PALAVRAS[t.layout] || 55;
      if (palavras(t.texto).length > lim) out.push(sugestao('excesso_texto', 'redacao', 'Texto longo para este layout', `${palavras(t.texto).length} palavras (limite legível: ${lim}). Resuma ou divida em dois slides.`, t.onde));
    });

    // Repetição entre slides
    for (let i = 0; i < slides.length; i++) {
      for (let j = i + 1; j < slides.length; j++) {
        const a = new Set(norm(slides[i].texto).split(' ').filter((w) => w.length > 3));
        const b = new Set(norm(slides[j].texto).split(' ').filter((w) => w.length > 3));
        if (a.size < 5 || b.size < 5) continue;
        const inter = [...a].filter((w) => b.has(w)).length;
        if (inter / Math.min(a.size, b.size) > 0.7) out.push(sugestao('repeticao', 'redacao', 'Slides repetem a mesma ideia', `Os slides ${i + 1} e ${j + 1} dizem quase a mesma coisa.`, slides[j].onde));
      }
    }

    const perguntas = textos.reduce((n, t) => n + (t.texto.match(/\?/g) || []).length, 0);
    if (perguntas > 2) out.push(sugestao('perguntas_demais', 'redacao', 'Perguntas retóricas em excesso', `${perguntas} perguntas no post. Afirme mais, pergunte menos.`));

    // Conclusão pouco clara
    const ultimo = [...slides].reverse().find((s) => s.layout !== 'encerramento');
    if (ultimo && palavras(ultimo.texto).length < 4) out.push(sugestao('conclusao_fraca', 'redacao', 'Conclusão pouco clara', 'O último slide de conteúdo é curto demais para fechar o raciocínio.', ultimo.onde));

    // Conclusão maior que a evidência
    const parciais = claimsUsadas(c, textos).filter((cl) => cl.estado === 'parcialmente_sustentada');
    if (parciais.length) textos.forEach((t) => { if (ABSOLUTOS.test(t.texto)) out.push(sugestao('conclusao_maior_que_evidencia', 'redacao', 'Palavra absoluta com evidência parcial', `“${(t.texto.match(ABSOLUTOS) || [''])[0]}” vai além do que as fontes sustentam.`, t.onde)); });

    // CTA x objetivo
    const obj = c.briefing?.objetivo;
    const cta = norm(v.cta);
    if (obj === 'alcance' && cta && !/(manda|envia|compartilha|marca|salva)/.test(cta)) out.push(sugestao('cta_sem_relacao', 'redacao', 'CTA não combina com o objetivo', 'O objetivo é alcance: peça para enviar ou salvar.'));
    if (obj === 'autoridade' && cta && !/(segue|salva|comenta|le |leia)/.test(cta)) out.push(sugestao('cta_sem_relacao', 'redacao', 'CTA não combina com o objetivo', 'O objetivo é autoridade: convide a seguir, salvar ou comentar.'));
    if (!cta) out.push(sugestao('cta_ausente', 'redacao', 'Sem chamada final', 'Nenhum pedido ao leitor. Pode ser proposital; confirme.'));

    // Imagens
    (v.slides || []).forEach((s, i) => {
      const img = (c.imagens || []).find((x) => x.id === s.imagem_id);
      if (img && img.tipo !== 'tipografica' && ['baixa', 'desconhecida', undefined].includes(img.relevancia)) out.push(sugestao('imagem_pouco_relevante', 'arte', 'Imagem pouco relevante', `A imagem do slide ${i + 1} não foi confirmada como pertinente ao assunto. Se não servir, use composição só com texto.`, { slide: s.id }));
    });

    // Igual a posts recentes
    const recentes = (ctx && ctx.recentes) || [];
    if (capa && recentes.length) {
      const ini = norm(capa.texto).split(' ').slice(0, 4).join(' ');
      if (ini.length > 8 && recentes.some((r) => norm(r).startsWith(ini))) out.push(sugestao('abertura_igual_recentes', 'redacao', 'Abertura igual à de um post recente', 'Mude a forma de abrir para não repetir o perfil.', capa.onde));
      const fim = norm(v.cta);
      if (fim.length > 12 && recentes.filter((r) => norm(r).includes(fim)).length >= 2) out.push(sugestao('cta_repetido', 'redacao', 'CTA repetido nos posts recentes', 'Variar o fechamento evita cansar quem já te segue.'));
    }
    return out;
  }

  // ── Resultado completo ─────────────────────────────────────────────────────
  function avaliar(c, ctx) {
    const b = bloqueios(c, ctx);
    const s = sugestoes(c, ctx);
    const fatos = b.filter((x) => x.eixo === 'fatos');
    const temContradita = b.some((x) => x.id === 'contradicao_nao_resolvida');
    return {
      bloqueios: b,
      sugestoes: s,
      resumo: {
        fatos: temContradita ? 'contradicao' : fatos.length ? 'pendente' : 'ok',
        conta: b.some((x) => x.eixo === 'conta') ? 'incorreta' : 'ok',
        arte: b.some((x) => x.eixo === 'arte') ? 'pendente' : 'ok',
        redacao: s.length ? 'com_sugestoes' : 'ok',
        pode_aprovar: b.length === 0,
      },
    };
  }

  // Exportação: só a versão aprovada, íntegra, com arte da mesma versão.
  function checarExportacao(c) {
    const v = M.versaoAtiva(c);
    const erros = [];
    if (!c.revisao.aprovada_versao) erros.push('Nada foi aprovado ainda.');
    else if (!v || v.id !== c.revisao.aprovada_versao) erros.push(`A versão ativa (${v ? v.id : '—'}) não é a aprovada (${c.revisao.aprovada_versao}).`);
    else if (v.hash !== c.revisao.hash_aprovado) erros.push('A versão aprovada foi alterada depois da aprovação.');
    if (v) {
      const faltam = (v.slides || []).filter((s) => !(c.arte?.renders || []).find((r) => r.slide_id === s.id && r.versao === v.id));
      if (faltam.length) erros.push('Há slides sem arte desta versão.');
    }
    return { ok: erros.length === 0, erros };
  }

  return { avaliar, bloqueios, sugestoes, checarExportacao, LIMITE_PALAVRAS, textosDaVersao };
});

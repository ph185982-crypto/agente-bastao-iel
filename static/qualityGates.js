// Bloqueios e sugestões. SEPARADOS de propósito:
//  - bloqueios: impedem marcar como aprovado (conta, fatos, citações, selo, texto
//    cortado, versão exportada diferente da aprovada);
//  - sugestões: melhoram a redação, não impedem nada.
// Um post pode estar bem escrito e factualmente pendente: o resumo mostra os dois.
// Puro e sem rede. Não existe "nota": cada item diz o que está errado e onde.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./contentModel') : root.ContentModel, typeof module === 'object' && module.exports ? require('./hookGuard') : root.HookGuard, typeof module === 'object' && module.exports ? require('./editorial') : root.Editorial);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QualityGates = api;
})(typeof self !== 'undefined' ? self : this, function (M, HG, E) {
  const LIMITE_PALAVRAS = { capa_foto: 12, capa_tipografica: 12, explicacao: 45, prova: 40, comparacao: 40, encerramento: 25 };

  const ABERTURAS_GENERICAS = [/^voc[eê] sabia/i, /^prepare-se/i, /^aten[cç][aã]o[:!]/i, /^isso muda tudo/i, /^uma reflex[aã]o/i, /^vamos falar sobre/i, /^hoje eu (quero|vou) falar/i, /^nesse (post|v[ií]deo)/i];
  const A_EVITAR = [/isso muda tudo/i, /uma reflex[aã]o necess[aá]ria/i, /voc[eê] n[aã]o vai acreditar/i, /ningu[eé]m (te )?conta/i];
  const PROMESSA = /\b(garant(o|ido|ia)|vai (ficar rico|dobrar)|dobre seu dinheiro|resultado certo|sem risco)\b/i;
  const ABSOLUTOS = /\b(sempre|nunca|todos|ningu[eé]m|comprova|prova que|fica claro que|sem d[uú]vida)\b/i;
  const LINGUAGEM_RELATORIO = /\b(outrossim|destarte|no que tange|conforme exposto|em suma|ressalte-se|cabe destacar)\b/i;

  const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
  const norm = (s) => M.semAcento(s).replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const limpa = (s) => String(s || '').replace(/\*\*/g, '');

  // Números que aparecem só nos dados do slide (comparação, número gigante) também precisam de origem.
  function dadosComoTexto(d) {
    if (!d) return '';
    const lado = (l) => (l ? ` ${l.rotulo || ''}: ${l.valor || ''} ${l.unidade || ''} ${l.detalhe || ''}` : '');
    return `${lado(d.esquerda)}${lado(d.direita)}${d.faixa ? ` ${d.faixa.valor || ''} ${d.faixa.texto || ''}` : ''}${d.numero ? ` ${d.numero.rotulo || ''}: ${d.numero.valor || ''}` : ''}`;
  }
  // Variação percentual entre os dois lados (calculada, não digitada): aceita com 0,15 ponto de tolerância
  // porque os valores mostrados são arredondados.
  function variacaoDosDados(d) {
    if (!d || !d.esquerda || !d.direita) return null;
    const a = M.extrairNumeros(`${d.esquerda.valor} ${d.esquerda.unidade || ''}`)[0]; const b = M.extrairNumeros(`${d.direita.valor} ${d.direita.unidade || ''}`)[0];
    if (!a || !b || !(a.valor > 0)) return null;
    return Math.abs((b.valor - a.valor) / a.valor * 100);
  }

  function textosDaVersao(v) {
    const t = [];
    (v.slides || []).forEach((s, i) => t.push({ onde: { slide: s.id, indice: i + 1 }, texto: limpa(`${s.titulo ? s.titulo + '. ' : ''}${s.texto}${dadosComoTexto(s.dados)}`), claim_ids: s.claim_ids || [], tipo: 'slide', layout: s.layout, dados: s.dados || null }));
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

  // Marcas de atribuição ou condição que mantêm uma ressalva pública.
  const MARCA_ATRIBUICAO = /(?<!\p{L})(segundo|de acordo com|conforme|diz|dizem|disse|disseram|afirma|afirmou|declarou|anuncia|anunciou|anunciam|anunciado|anunciada|prop[õo]e|prop[ôo]s|proposta|projeto|prev[êe]|previsto|prevista|estima|estimativa|pretende|planeja|promete|prometeu|deve|pode|poder[áa]|depende|aponta|apontam|apontou|avalia|avaliam|alerta|alertam|alertou|calcula|calculam|projeta|projetam|recomenda|recomendam|v[êe]|veem|se (for )?aprovad[ao]|em discuss[ãa]o|em an[áa]lise|estuda|estudo|quer)(?!\p{L})/iu;
  const ondeUsa = (textos, id) => textos.filter((t) => (t.claim_ids || []).includes(id)).map(rotuloOnde).join(', ') || 'ao conteúdo';

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

    // Expressões que o Pedro não quer em nenhum texto público (padrão de produção).
    const tudoNorm = norm(todoTexto);
    ((E && E.FRASES_PROIBIDAS) || []).forEach((f) => {
      if (f.re.test(tudoNorm)) {
        const t = textos.find((x) => f.re.test(norm(x.texto)));
        out.push(bloqueio('frase_proibida', 'redacao', 'Expressão que o perfil não usa', `O texto traz “${f.rotulo}”. Reescreva dizendo o que a pessoa deve fazer ou entender, sem essa frase.`, t ? t.onde : null, 'Reescrever o trecho'));
      }
    });

    // Legado
    if (c.legado) {
      out.push(bloqueio('legado_nao_verificado', 'fatos', 'Gerado antes da base de evidências', 'Fatos, números e arte deste item não foram verificados. Refaça pela Mesa para poder aprovar.', null, 'Refazer pela Mesa'));
    }

    // Afirmações usadas
    const usadas = claimsUsadas(c, textos);
    for (const cl of usadas) {
      const rev = cl.revisao || {};
      const dec = cl.decisao?.tipo || null;
      const central = cl.central !== false;
      if (dec === 'retirar') {
        out.push(bloqueio('afirmacao_retirada_em_uso', 'fatos', 'Afirmação retirada ainda está no texto', `Você retirou “${cl.texto}”, mas ela continua ligada ${ondeUsa(textos, cl.id)}.`, { claim: cl.id }, 'Tirar do texto'));
        continue;
      }
      if (cl.tipo === 'opiniao' || cl.natureza === 'opiniao') {
        // Auditoria das premissas factuais embutidas na opinião (por slide e texto).
        textos.filter((t) => t.tipo === 'slide' && (t.claim_ids || []).includes(cl.id)).forEach((t) => {
          const s = (v.slides || []).find((x) => x.id === t.onde.slide);
          const a = (c.auditoria_textos || c.auditoria_opinioes || {})[s.id];
          if (!a || a.hash_texto !== M.hash(M.textoParaAuditoria(s))) { out.push(bloqueio('opiniao_nao_auditada', 'fatos', 'Opinião ainda não conferida', `O slide ${t.onde.indice} é opinião e ainda não teve as premissas factuais separadas e conferidas${a ? ' (o texto mudou depois da conferência)' : ''}.`, t.onde, 'Conferir a opinião')); return; }
          a.premissas.filter((p) => !p.claim_id).forEach((p) => out.push(bloqueio('premissa_sem_fonte', 'fatos', 'Fato dentro da opinião sem fonte', `No slide ${t.onde.indice}, “${p.texto}” é apresentado como fato e nenhuma afirmação conferida sustenta isso. Tire, transforme em pergunta ou traga uma fonte.`, t.onde, 'Reescrever ou buscar fonte')));
          a.premissas.filter((p) => p.claim_id).forEach((p) => { const q = c.claims.find((x) => x.id === p.claim_id); if (q && q.estado !== 'sustentada' && q.decisao?.tipo !== 'atribuir') out.push(bloqueio('premissa_pendente', 'fatos', 'Opinião apoiada em fato ainda pendente', `“${p.texto}” depende de “${q.texto}”, que está ${rotuloEstado(q.estado)}.`, t.onde, 'Decidir sobre a premissa')); });
        });
        (cl.premissas || []).forEach((pid) => {
          const p = c.claims.find((x) => x.id === pid);
          if (p && p.estado !== 'sustentada' && p.decisao?.tipo !== 'atribuir') out.push(bloqueio('premissa_pendente', 'fatos', 'Opinião apoiada em fato ainda pendente', `“${cl.texto}” depende de “${p.texto}”, que está ${rotuloEstado(p.estado)}.`, { claim: cl.id }, 'Decidir sobre a premissa'));
        });
        continue;
      }
      if (cl.precisa_conferir) {
        out.push(bloqueio('afirmacao_corrigida_sem_conferencia', 'fatos', 'Afirmação corrigida ainda não conferida', `“${cl.texto}” foi reescrita e precisa ser conferida nas fontes.`, { claim: cl.id }, 'Conferir'));
      } else if (cl.estado === 'contradita') {
        out.push(bloqueio('contradicao_nao_resolvida', 'fatos', 'Fonte contradiz a afirmação', `“${cl.texto}”: ${cl.motivo_estado || 'as fontes contradizem'} Corrija ou retire.`, { claim: cl.id }, 'Corrigir ou retirar'));
      } else if (central && (cl.estado === 'nao_verificada' || !cl.estado) && dec !== 'atribuir') {
        out.push(bloqueio('afirmacao_sem_sustentacao', 'fatos', 'Afirmação central sem sustentação', `“${cl.texto}”: ${cl.motivo_estado || 'nenhuma fonte acessada sustenta'}`, { claim: cl.id }, 'Corrigir, atribuir ou retirar'));
      } else if (central && cl.estado === 'parcialmente_sustentada' && dec !== 'atribuir') {
        out.push(bloqueio('afirmacao_parcial', 'fatos', 'Afirmação central só em parte sustentada', `“${cl.texto}”: ${cl.motivo_estado || 'as fontes cobrem só parte'}`, { claim: cl.id }, 'Corrigir, publicar com atribuição/condição ou retirar'));
      }
      if (cl.risco === 'alto' && !rev.confirmada_por_pedro && cl.estado !== 'contradita') {
        out.push(bloqueio('revisao_humana_pendente', 'fatos', 'Assunto sensível: confirme você mesmo', `“${cl.texto}” envolve pessoas, acusações ou impacto alto. Leia a fonte e confirme.`, { claim: cl.id }, 'Confirmar'));
      }
      // Ressalva pública: anúncio, declaração, previsão ou decisão de atribuir.
      const exige = dec === 'atribuir' || cl.exige_atribuicao || M.EXIGE_ATRIBUICAO.has(M.naturezaDe(cl));
      if (exige) {
        const cond = dec === 'atribuir' ? M.normalizarAtribuicao(cl.decisao.condicao) : null;
        textos.filter((t) => (t.claim_ids || []).includes(cl.id) && t.tipo !== 'cta').forEach((t) => {
          const ok = cond ? M.normalizarAtribuicao(t.texto).includes(cond) : MARCA_ATRIBUICAO.test(t.texto);
          if (!ok) out.push(bloqueio('ressalva_ausente', 'fatos', 'Falta a atribuição ou condição no texto', cond
            ? `${rotuloOnde(t)[0].toUpperCase()}${rotuloOnde(t).slice(1)} usa “${cl.texto}” sem “${cl.decisao.condicao}”.`
            : `${rotuloOnde(t)[0].toUpperCase()}${rotuloOnde(t).slice(1)} apresenta como fato “${cl.texto}”, que é ${({ anuncio: 'um anúncio', declaracao: 'uma declaração', previsao: 'uma previsão' })[M.naturezaDe(cl)] || 'atribuído'}: diga quem anunciou/disse ou a condição.`, t.onde, 'Recolocar a atribuição ou condição'));
        });
      }
    }

    // Auditoria dos textos que não são opinião: fato sem afirmação conferida.
    const aud = c.auditoria_textos || {};
    const editorial = (v.slides || []).some(s=>s.design==='editorial_2026');
    if(editorial&&Object.values(aud).some(a=>a.extracao_incompleta&&!a.texto_conferido))out.push(bloqueio('conferencia_integral_pendente','fatos','Conferência completa pendente','A extração não foi conclusiva. O texto completo precisa ser conferido contra as fontes antes da aprovação.',{},'Conferir o texto'));
    if(editorial && /an[aá]lises r[aá]pidas|mais insights|pr[oó]ximas not[ií]cias/i.test(v.cta||''))out.push(bloqueio('cta_generico','redacao','Chamada final genérica','Diga um benefício concreto ligado a esta pauta, sem "análises rápidas", "mais insights" ou "próximas notícias".',{campo:'cta'},'Reescrever a chamada'));
    if(editorial){const a=[/\b(?:siga|segue|seguir|acompanhe)\b/i,/\b(?:salve|salva|salvar|guarde)\b/i,/\b(?:envie|envia|mande|manda|compartilhe|compartilha)\b/i].filter(r=>r.test(v.cta||''));if(a.length>1)out.push(bloqueio('cta_varias_acoes','redacao','Escolha uma ação principal','O fechamento deve pedir somente seguir, salvar ou compartilhar, conforme o objetivo escolhido.',{campo:'cta'},'Simplificar a chamada'));}
    textos.filter((t) => t.tipo !== 'cta'||editorial).forEach((t) => {
      const chave = t.tipo === 'slide' ? t.onde.slide : t.tipo;
      const s = t.tipo === 'slide' ? (v.slides || []).find((x) => x.id === chave) : null;
      const ehOpiniao = (t.claim_ids || []).some((id) => { const k = c.claims.find((q) => q.id === id); return k && (k.tipo === 'opiniao' || k.natureza === 'opiniao'); });
      if (ehOpiniao || (s && s.layout === 'encerramento'&&!editorial)) return;
      const a = aud[chave];
      const textoAtual = t.tipo === 'legenda' ? v.legenda : t.tipo==='cta'?v.cta:M.textoParaAuditoria(s);
      if (!a || a.hash_texto !== M.hash(textoAtual)) {
        if(editorial&&textoAtual)out.push(bloqueio('texto_nao_auditado','fatos','Texto ainda não conferido',`${rotuloOnde(t)[0].toUpperCase()}${rotuloOnde(t).slice(1)} precisa passar pela conferência desta versão.`,t.onde,'Conferir o texto'));
        if (s?.titulo) out.push(bloqueio('titulo_nao_auditado', 'fatos', 'Título ainda não conferido', `O título e o texto do slide ${t.onde.indice} precisam ser conferidos juntos.`, t.onde, 'Conferir o slide'));
        return;
      }
      a.premissas.filter((p) => !p.claim_id).forEach((p) => out.push(bloqueio('fato_sem_fonte', 'fatos', 'Afirmação de fato sem fonte', `${rotuloOnde(t)[0].toUpperCase()}${rotuloOnde(t).slice(1)} diz “${p.texto}”, e nenhuma afirmação conferida sustenta isso.`, t.onde, 'Corrigir, tirar ou trazer fonte')));
    });

    // Números e consistência entre capa, slides e legenda
    const porClaim = new Map();
    for (const t of textos) {
      const permitidos = M.valoresPermitidos(c, t.claim_ids);
      for (const n of M.extrairNumeros(t.texto).filter(M.exigeOrigem)) {
        const ok = permitidos.some((p) => M.igual(n.valor, p)) || (n.tipo === 'percentual' && t.dados && variacaoDosDados(t.dados) != null && Math.abs(Math.abs(n.valor) - variacaoDosDados(t.dados)) <= 0.15);
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
      const reAt = /\b([Ss]egundo|[Dd]e acordo com|[Cc]onforme|[Dd]isse|[Aa]firmou|[Dd]eclarou|[Aa]firma|[Dd]iz)\s+(?:o |a |os |as |do |da )?((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'-]*(?:\.[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'-]*)*)(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'-]*(?:\.[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'-]*)*){0,3})/g;
      while ((m = reAt.exec(t.texto))) {
        const nome = norm(m[2]);
        if (nome.length >= 3 && !corpus.includes(nome)) out.push(bloqueio('atribuicao_sem_origem', 'fatos', 'Atribuição sem fonte', `“${m[1]} ${m[2]}” não aparece nas fontes consultadas.`, t.onde, 'Confirmar quem disse ou remover'));
      }
    }

    // Capa: o Pedro escolhe entre as opções
    // Capa copiada de um exemplo do playbook (ou de um gancho já publicado sem resultado): não sai.
    const capaTexto = limpa(((v.slides || [])[0] || {}).texto || '');
    if (HG && capaTexto) {
      const r = HG.verificar(capaTexto);
      if (!r.ok) out.push(bloqueio('hook_copiado', 'redacao', 'Capa copiada de um exemplo', r.motivo, { slide: v.slides[0].id, indice: 1 }, 'Escrever uma capa nova'));
    }
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
      if (r.metrics && r.metrics.cabe === false) out.push(bloqueio('texto_cortado', 'arte', 'Texto não cabe na arte', `No slide ${idsSlides.indexOf(r.slide_id) + 1}: ${(r.metrics.problemas || []).length ? r.metrics.problemas.join('; ') : 'o texto passa do espaço ou fica pequeno demais para ler'}.`, { slide: s.id }, 'Encurtar, dividir ou trocar o layout'));
      if ((r.elementos || []).some((e) => /selo|verificad|badge/i.test(e))) out.push(bloqueio('selo_falso', 'arte', 'Selo de verificação na arte', 'A conta não é verificada: nenhum selo pode aparecer.', { slide: s.id }, 'Gerar a arte de novo'));
    }
    (v.slides || []).forEach((s) => { if (s.selo || /selo|badge/i.test(s.layout || '')) out.push(bloqueio('selo_falso', 'arte', 'Selo de verificação no slide', 'Remova o selo.', { slide: s.id })); });
    (v.slides || []).filter(s=>s.design==='editorial_2026').forEach(s=>{
      if(palavras(M.textoParaAuditoria(s)).length>38)out.push(bloqueio('texto_denso','redacao','Texto demais para o celular','Encurte título e corpo para no máximo 38 palavras, preservando a informação e a atribuição.',{slide:s.id},'Encurtar o slide'));
    });

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
    // "Segue o perfil" sem dizer o que a pessoa ganha seguindo não dá motivo para seguir.
    if (cta && palavras(v.cta).length <= 6 && /\b(segue|siga|seguir)\b/.test(cta) && !/\b(para|pra|que|toda|todo|cada|ver|receber)\b/.test(cta)) out.push(sugestao('cta_generico', 'redacao', 'Chamada final genérica', 'Só “segue o perfil” não dá motivo. Diga o que a pessoa recebe seguindo (ex.: “todo dia, o que a notícia muda no seu bolso”) ou peça para enviar a alguém.'));
    if (!cta) out.push(sugestao('cta_ausente', 'redacao', 'Sem chamada final', 'Nenhum pedido ao leitor. Pode ser proposital; confirme.'));

    // Padrão de produção: estrutura, repetição da capa, posição do Pedro, prova, legenda.
    const carrossel = v.formato !== 'estatico' && slides.length >= 3; // 1–2 telas não é carrossel: o padrão de estrutura não se aplica
    if (carrossel && E && E.SLIDES_BASE) {
      const n = slides.length;
      if (n < E.SLIDES_BASE.min) out.push(sugestao('poucos_slides', 'redacao', 'Menos slides que a base', `São ${n} slides e a base é de ${E.SLIDES_BASE.min} a ${E.SLIDES_BASE.max}. Se a pauta pede mais, acrescente só telas que avancem a história.`));
      else if (n > E.SLIDES_BASE.max + 1) out.push(sugestao('muitos_slides', 'redacao', 'Mais slides que a base', `São ${n} slides e a base é de ${E.SLIDES_BASE.min} a ${E.SLIDES_BASE.max}. Só mantenha as telas que avançam a história.`));
    }
    if (carrossel && slides.length >= 2) {
      const a = new Set(norm(slides[0].texto).split(' ').filter((w) => w.length > 3));
      const b = new Set(norm(slides[1].texto).split(' ').filter((w) => w.length > 3));
      if (a.size >= 3 && b.size >= 3) {
        const inter = [...a].filter((w) => b.has(w)).length;
        if (inter / Math.min(a.size, b.size) >= 0.5) out.push(sugestao('segundo_repete_capa', 'redacao', 'O segundo slide repete a capa', 'O segundo slide precisa acrescentar o que falta entender, não retomar a capa com outras palavras.', slides[1].onde));
      }
    }
    if (carrossel) {
      const funcoes = (v.slides || []).map((s) => s.funcao);
      const temOpiniao = funcoes.includes('opiniao') || claimsUsadas(c, textos).some((k) => k.tipo === 'opiniao' || k.natureza === 'opiniao');
      if (!temOpiniao) out.push(sugestao('sem_leitura_do_pedro', 'redacao', 'Falta a leitura do Pedro', 'Nenhum slide traz a posição do Pedro como opinião. Diga qual é o mecanismo por trás e o que isso significa na prática, apoiado nas provas.'));
      if (!funcoes.some((f) => ['prova', 'comparacao'].includes(f))) out.push(sugestao('sem_prova', 'fatos', 'Falta um slide de prova', 'Nenhum slide mostra o dado, a declaração ou o documento. Traga a prova com fonte, data e unidade.'));
      const conteudo = (v.slides || []).filter((s) => s.layout !== 'encerramento');
      const pen = conteudo[conteudo.length - 1];
      if (pen && conteudo.length >= 3 && !['opiniao', 'consequencia', 'explicacao'].includes(pen.funcao)) out.push(sugestao('penultimo_nao_fecha', 'redacao', 'O penúltimo slide não fecha o raciocínio', 'O último slide antes do encerramento deve fechar o raciocínio e dar motivo para acompanhar o perfil.', { slide: pen.id, indice: (v.slides || []).indexOf(pen) + 1 }));
    }
    if (palavras(v.legenda).join(' ').length > 700) out.push(sugestao('legenda_longa', 'redacao', 'Legenda longa', 'A legenda deve ser curta e complementar ao carrossel, sem repetir todas as telas.', { campo: 'legenda' }));

    // Imagens
    (v.slides || []).forEach((s, i) => {
      const img = (c.imagens || []).find((x) => x.id === s.imagem_id);
      if (img && img.tipo !== 'tipografica' && ['baixa', 'desconhecida', undefined].includes(img.relevancia)) out.push(sugestao('imagem_pouco_relevante', 'arte', 'Imagem pouco relevante', `A imagem do slide ${i + 1} não foi confirmada como pertinente ao assunto. Se não servir, use composição só com texto.`, { slide: s.id }));
    });

    // Texto ainda não auditado (a auditoria roda sozinha depois de gerar/editar).
    const aud = c.auditoria_textos || {};
    textos.filter((t) => t.tipo !== 'cta').forEach((t) => {
      const chave = t.tipo === 'legenda' ? 'legenda' : t.onde.slide;
      const s = t.tipo === 'legenda' ? null : (v.slides || []).find((x) => x.id === chave);
      if (s && s.layout === 'encerramento') return;
      const atual = t.tipo === 'legenda' ? v.legenda : M.textoParaAuditoria(s);
      if (!atual) return;
      if (!aud[chave] || aud[chave].hash_texto !== M.hash(atual)) out.push(sugestao('texto_nao_auditado', 'fatos', 'Texto ainda não conferido', `${rotuloOnde(t)[0].toUpperCase()}${rotuloOnde(t).slice(1)} ainda não teve as afirmações de fato conferidas contra as fontes.`, t.onde));
    });

    // Slide de conteúdo sem base: não é opinião marcada e não liga nenhuma afirmação.
    (v.slides || []).forEach((s, i) => {
      if (i === 0 || ['encerramento'].includes(s.layout) || (s.claim_ids || []).length) return;
      if (palavras(limpa(s.texto)).length > 8) out.push(sugestao('slide_sem_base', 'fatos', 'Slide sem afirmação ligada', `O slide ${i + 1} não está ligado a nenhuma afirmação conferida nem marcado como opinião. Se ele afirma um fato, ligue a uma fonte; se é sua leitura, deixe claro que é opinião.`, { slide: s.id }));
    });

    // Foto ampliada demais (fica borrada) e encerramento provisório
    const rendersV = (c.arte?.renders || []).filter((r) => r.versao === v.id);
    rendersV.forEach((r) => {
      if ((r.elementos || []).includes('foto_baixa_resolucao')) out.push(sugestao('foto_baixa_resolucao', 'arte', 'Foto em baixa resolução', `A foto da capa tem ${r.metrics?.foto?.largura}×${r.metrics?.foto?.altura} px e foi ampliada ${r.metrics?.foto?.ampliacao}× para 1080×1350: deve ficar borrada. Use uma foto maior (ideal: 1080×1350 ou mais).`, { slide: r.slide_id }));
      if ((r.elementos || []).includes('encerramento_tipografico')) out.push(sugestao('encerramento_provisorio', 'arte', 'Encerramento provisório', 'O último slide usa um encerramento só de texto porque o arquivo aprovado ainda não foi enviado (Ajustes → Encerramento).', { slide: r.slide_id }));
    });

    // Igual a posts recentes
    const recentes = (ctx && ctx.recentes) || [];
    if (HG && capa && recentes.length) {
      const r = HG.verificar(capa.texto, { contra: recentes.map((x) => String(x).split(/\n/)[0]), soContra: true, limite: 2 });
      if (r.parecido_com && r.similaridade >= 0.65) out.push(sugestao('hook_parecido_recente', 'redacao', 'Capa parecida com um post recente', `Parecida com “${String(r.parecido_com).slice(0, 80)}”. Mude o ângulo ou o número para não repetir o perfil.`, capa.onde));
    }
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
        redacao: b.some((x) => x.eixo === 'redacao') ? 'bloqueada' : s.some((x) => x.eixo === 'redacao') ? 'com_sugestoes' : 'ok',
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

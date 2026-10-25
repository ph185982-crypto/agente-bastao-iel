// Método Destrava: creation hypotheses and measured results, never a probability of going viral.
// Shared by the writing pipeline and the phone UI. Checks describe the copy, not Instagram ranking.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GrowthModel=api;})(typeof self!=='undefined'?self:this,function(){
  const VERSION='destrava-2';
  const OBJETIVOS={
    seguidores:{nome:'Ganhar seguidores',mecanismo:'Entregar uma leitura própria que dê motivo para voltar ao perfil.',cta:'Convide a seguir com um benefício específico ligado à pauta. Não peça mais duas ações no mesmo fechamento.'},
    compartilhar:{nome:'Gerar compartilhamentos',mecanismo:'Criar algo que o leitor queira enviar para uma pessoa em uma situação concreta.',cta:'Convide a enviar para alguém identificável pela situação (sócio, cliente, quem vive o problema), sem pedir quantidade de amigos.'},
    salvar:{nome:'Gerar salvamentos',mecanismo:'Entregar uma referência útil para consultar depois: diferença, decisão, comparação ou explicação.',cta:'Convide a salvar para uma ocasião concreta. Não transforme notícia sem utilidade em checklist artificial.'}
  };
  const PASSOS=[
    {nome:'Gancho',texto:'Fato específico ou tensão reconhecível. A promessa precisa ser verdadeira.'},
    {nome:'Progressão',texto:'Cada tela ou trecho acrescenta algo e leva à próxima ideia.'},
    {nome:'Entrega',texto:'Uma descoberta, prova ou leitura que cumpra a promessa do começo.'},
    {nome:'Participação',texto:'Pergunta concreta, identificação ou utilidade que dê assunto para conversar.'},
    {nome:'Conversão',texto:'Uma ação principal e um motivo claro para seguir, enviar ou salvar.'}
  ];
  const plano=(formato='carrossel',objetivo='seguidores')=>({versao:VERSION,objetivo:OBJETIVOS[objetivo]?objetivo:'seguidores',formato,
    sequencia:formato==='estatico'?['Uma ideia forte na imagem','Contexto e prova na legenda','Uma ação principal']:formato==='reels'?['0–3s: gancho direto','3–12s: situação e lacuna','12–35s: evidência e virada','35–50s: leitura e entrega','50–60s: fechamento e CTA']:['Capa: acontecimento concreto','Tela 2: sustenta o interesse sozinha','Evidência: um dado ou caso real','Detalhe que a notícia também informa','O que está decidido e quais são os limites','Pergunta ligada ao caso','Convite com benefício específico']});
  function instrucoes({formato='carrossel',objetivo='seguidores'}={}){
    const p=plano(formato,objetivo),o=OBJETIVOS[p.objetivo];
    return `MÉTODO DESTRAVA — hipóteses de criação, sem promessa de viralização. Objetivo principal: ${o.nome}. ${o.mecanismo}\n${p.sequencia.join(' → ')}. A sequência é flexível: não invente fatos para preencher etapas.\n${o.cta}\nCrie três ganchos de verdade para o mesmo conteúdo: fato, consequência e tensão. Evite pergunta vaga, promessa escondida, urgência falsa, afirmação absoluta ou "comente SIM". Não basta pôr uma moldura em outro vídeo: a leitura editorial deve acrescentar significado, sem inverter a opinião do autor. Cumpra a promessa antes do CTA. Opinião se apoia nos fatos listados. Não dê recomendação de compra de ativo nem invente causalidade econômica. Uma pergunta pode criar conversa sem precisar ser opinião factual. O leitor deve reconhecer a situação e ter algo útil para contar a alguém.`;
  }
  const clean=s=>String(s||'').replace(/\*\*/g,'').trim();
  const words=s=>clean(s).split(/\s+/).filter(Boolean);
  const generico=s=>/^ser[aá] que\b|voc[eê] sabia|isso muda tudo|voc[eê] n[aã]o vai acreditar|segredo do sucesso|vale a pena.*agora.*esperar/i.test(s||'');
  function escolherCapa(capas,preferida){
    const lista=(capas||[]).filter(c=>c.texto);
    return [...lista].sort((a,b)=>{
      const n=c=>(generico(c.texto)?-8:0)+(words(c.texto).length<=14?3:0)+(c.claim_ids?.length?2:0)+(c.foco===preferida?1:0);
      return n(b)-n(a);
    })[0]||null;
  }
  function diagnosticar(c){
    const v=c.copia?.versoes?.find(v=>v.id===c.copia.versao_ativa);if(!v)return {versao:VERSION,checks:[],aviso:'Disponível depois da primeira versão.'};
    const slides=v.slides||[],content=slides.filter(s=>s.layout!=='encerramento'),hook=content[0]?.texto||'';
    const objetivo=c.crescimento?.objetivo||'seguidores';
    const final=[v.cta,v.legenda].filter(Boolean).join(' ');
    const wanted=objetivo==='compartilhar'?/envie|envia|manda|mande|compartilh/i:objetivo==='salvar'?/salv|guard/i:/siga|segue|seguir/i;
    const checks=[
      {id:'gancho',nome:'Gancho curto e específico',ok:words(hook).length>0&&words(hook).length<=18&&!generico(hook),dica:'Abra com o que aconteceu ou com uma tensão concreta; sem pergunta genérica.'},
      {id:'leitura',nome:'Leitura no celular',ok:content.every(s=>words([s.titulo,s.texto].join(' ')).length<=38),dica:'Uma ideia por tela, com título e corpo que se complementem.'},
      {id:'entrega',nome:'Entrega apoiada na fonte',ok:content.some(s=>(s.claim_ids||[]).length>0),dica:'Apoie a explicação em fatos da fonte. A conferência factual aparece separadamente.'},
      {id:'convite',nome:'CTA alinhado ao objetivo',ok:wanted.test(final)&&!/mais insights|pr[oó]ximas not[ií]cias|an[aá]lises r[aá]pidas/i.test(v.cta||''),dica:OBJETIVOS[objetivo]?.cta||OBJETIVOS.seguidores.cta}
    ];
    if(c.formato==='carrossel')checks.splice(2,0,{id:'ritmo',nome:'Variedade visual e progressão',ok:new Set(content.map(s=>s.composicao||s.layout)).size>=3,dica:'Alterne foto, evidência, dado ou posição. Evite repetir o mesmo bloco de texto.'});
    if(c.formato==='reels')checks.push({id:'video',nome:'Vídeo e voz preparados',ok:c.motion?.estado==='pronto'&&c.motion?.narracao===true,dica:'Confira a abertura, o áudio e a entrega na prévia.'});
    return {versao:VERSION,objetivo,checks,aviso:'Checklist editorial. Não estima alcance, seguidores nem chance de viralizar.'};
  }
  function taxa(n,d){return typeof n==='number'&&Number.isFinite(n)&&typeof d==='number'&&d>0?Math.round(n/d*100000)/100:null;}
  function medir(d={}){return {compartilhamentos_por_mil:taxa(d.compartilhamentos,d.alcance),salvos_por_mil:taxa(d.salvos,d.alcance),seguidores_por_mil:taxa(d.seguidores,d.alcance)};}
  function consolidar(docs){
    const out={};for(const [field,key]of [['compartilhamentos','compartilhamentos_por_mil'],['salvos','salvos_por_mil'],['seguidores','seguidores_por_mil']]){
      const validos=docs.map(c=>c.desempenho).filter(d=>d&&typeof d[field]==='number'&&Number.isFinite(d[field])&&d.alcance>0);
      out[key]=validos.length?taxa(validos.reduce((n,d)=>n+d[field],0),validos.reduce((n,d)=>n+d.alcance,0)):null;
    }return out;
  }
  return {VERSION,OBJETIVOS,PASSOS,plano,instrucoes,escolherCapa,diagnosticar,medir,consolidar};
});

// Durable production: one checkpoint per invocation, CAS lease, then another short
// invocation. The phone can close; no auto-approval or publishing happens here.
const crypto=require('crypto');
const M=require('../../static/contentModel');
const G=require('../../static/qualityGates');
const {armazem}=require('./armazem');
const {ACCOUNT}=require('./account');
const research=require('./research');
const redacao=require('./redacao');
const arte=require('./arte');
const prefs=require('./preferencias');
const push=require('./push');
const conta=()=>ACCOUNT.ig_id;
const now=()=>new Date().toISOString();
const etapas=['leitura','afirmacoes','pesquisa','briefing','copy','auditoria','foto','arte','motion','finalizar'];
const base=()=>String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/,'');
const falha=(message,status=400)=>Object.assign(new Error(message),{status});
function esperaTemporaria(e){
  const status=Number(e.status||e.statusCode);const msg=String(e.message||'');
  if(e.code!=='AUDITORIA_INCOMPLETA'&&status!==429&&![502,503,504].includes(status)&&!/rate.?limit|timed? ?out|timeout|aborted|ECONNRESET|ETIMEDOUT|ECONNABORTED/i.test(`${e.code||''} ${e.name||''} ${msg}`))return null;
  const header=typeof e.headers?.get==='function'?e.headers.get('retry-after'):e.headers?.['retry-after'];
  const segundos=Number(header)||Number(msg.match(/try again in\s+([\d.]+)\s*s/i)?.[1])||30;
  return Math.min(120,Math.max(10,Math.ceil(segundos)+2));
}
const limparMarcadores=texto=>typeof texto==='string'?texto.replace(/\s*(?:\*\*)?\(\s*[ao]\d+(?:_\d+)?(?:\s*[,;]\s*[ao]\d+(?:_\d+)?)*\s*\)(?:\*\*)?/g,'').trim():texto;
function manterAtribuicoes(v,c){
  const norm=M.normalizarAtribuicao;
  const atribuir=(texto,ids)=>{
    let t=texto;const usadas=c.claims.filter(k=>(ids||[]).includes(k.id));
    const condicoes=[...new Set(usadas.filter(k=>k.decisao?.tipo==='atribuir').map(k=>k.decisao.condicao).filter(Boolean))];
    if(usadas.some(k=>k.exige_atribuicao||M.EXIGE_ATRIBUICAO.has(M.naturezaDe(k)))&&c.fonte_principal?.veiculo)condicoes.push(`Segundo ${c.fonte_principal.veiculo}`);
    for(const cond of condicoes)if(!norm(t).includes(norm(cond)))t=`${cond.charAt(0).toUpperCase()+cond.slice(1)}, ${t.charAt(0).toLowerCase()+t.slice(1)}`;
    return t;
  };
  v.slides.forEach(s=>{s.texto=atribuir(s.texto,s.claim_ids);});
  v.legenda=atribuir(v.legenda,v.legenda_claim_ids);
}
function assinatura(id,job) {
  if (!process.env.PUBLISH_SECRET) throw falha('A produção em segundo plano ainda não está configurada.',503);
  return crypto.createHmac('sha256',process.env.PUBLISH_SECRET).update(`studio:${id}:${job}`).digest('hex');
}
function confere(id,job,token) { const esperado=assinatura(id,job); return typeof token==='string' && token.length===esperado.length && crypto.timingSafeEqual(Buffer.from(token),Buffer.from(esperado)); }
async function gravar(c,rev) { c.updated_at=now(); return armazem().conteudos.salvar(conta(),c.id,c,rev); }
async function ler(id) { const r=await armazem()?.conteudos.obter(conta(),id); if(!r)throw falha('Conteúdo não encontrado.',404); return r; }
function prepararRevisao(c) {
  // The one final approval covers the human review of the entire displayed version.
  const copia=M.clone(c);
  copia.claims.forEach(k=>{ k.revisao={...(k.revisao||{}),confirmada_por_pedro:true}; });
  return G.avaliar(copia,{conta:M.ACCOUNT_PIN});
}
async function recentes() {
  return (await armazem().conteudos.listar(conta())).slice(0,10).map(x=>x.resumo.titulo).filter(Boolean);
}
async function criar({url,texto,formato='carrossel',estilo='auto',indice=0,request_id,voz='',objetivo='seguidores'}) {
  const a=armazem(); if(!a?.duravel)throw falha('A produção precisa do armazenamento no servidor.',503);
  if(!url && (!texto || String(texto).trim().length<200))throw falha('Envie um link ou um texto com pelo menos 200 caracteres.');
  const request=String(request_id || crypto.randomUUID()).slice(0,80);
  const id=`st_${crypto.createHash('sha256').update(request).digest('hex').slice(0,24)}`;
  const existente=await a.conteudos.obter(conta(),id); if(existente)return existente.doc;
  const hoje=now().slice(0,10); const lista=await a.conteudos.listar(conta());
  const cfg=await a.config.obter(conta()); const cap=Math.min(50,Math.max(1,Number(cfg.daily_generation_cap)||10));
  if(lista.filter(x=>x.resumo.atualizado?.startsWith(hoje)&&x.id.startsWith('st_')).length>=cap)throw falha(`Seu limite diário de ${cap} conteúdos foi atingido.`,429);
  if(lista.filter(x=>x.resumo.status==='produzindo').length>=5)throw falha('Já há cinco conteúdos em preparação. Espere um deles terminar.',429);
  const escolhido=prefs.ESTILOS[estilo]?estilo:await prefs.escolherEstilo({indice});
  const c=M.novoConteudo({titulo:url?String(url).slice(0,140):String(texto).split('\n')[0].slice(0,140),formato:['reels','estatico'].includes(formato)?formato:'carrossel',origem:url?{tipo:'link',url:String(url).slice(0,2000)}:{tipo:'texto',texto_bruto:String(texto).slice(0,60000)}});
  c.id=id;c.status='produzindo';c.crescimento=require('../../static/growthModel').plano(c.formato,objetivo);c.experimento={estilo:escolhido,letra:prefs.ESTILOS[escolhido].letra,criado_em:now()};
  c.studio={job:crypto.randomUUID(),estado:'gerando',etapa:'leitura',indice:0,tentativas:0,passos:0,iniciado_em:now(),voz:String(voz).slice(0,1500)};
  try{await gravar(c,0);}catch(e){if(e.code==='CONFLITO')return(await ler(id)).doc;throw e;}
  return c;
}
async function reagendar(id,{motivos=[],detalhe='',hash,acao='refazer'}={}) {
  const reg=await ler(id);const c=reg.doc;
  if(['publicado','aprovado','exportado'].includes(c.status))throw falha('Este conteúdo já foi aprovado. Crie uma nova ideia para não alterar a publicação.',409);
  if(c.studio?.estado==='gerando')return c;
  if(!prefs.ESTILOS[c.experimento?.estilo]){const estilo=await prefs.escolherEstilo({indice:0});c.experimento={estilo,letra:prefs.ESTILOS[estilo].letra,criado_em:now()};}
  if(acao==='retomar' && c.studio?.estado==='erro'){
    const st=c.studio;st.job=crypto.randomUUID();st.estado=st.etapa==='publicacao'?'publicando':'gerando';st.erro=null;st.passos=0;st.retentativas=0;delete st.lease;delete st.adiar_ate;delete st.aviso;
    if(st.etapa==='motion'&&st.pendencias?.length){st.etapa='copy';st.indice=0;st.tentativas=0;st.correcao='Corrija estes problemas antes de entregar: '+st.pendencias.map(p=>`${p.titulo}: ${p.detalhe}`).join('\n').slice(0,4500);}
    c.status=st.estado==='publicando'?'aprovado':'produzindo';await gravar(c,reg.rev);return c;
  }
  if(acao==='refazer') {
    const fb=await prefs.registrar(c,{acao,motivos,detalhe,versao:hash});c.ultimo_feedback=fb;
    c.revisao={aprovada_versao:null,aprovada_em:null,hash_aprovado:null};
    if(motivos.includes('visual')) {const ids=Object.keys(prefs.ESTILOS);c.experimento={...c.experimento,estilo:ids[(ids.indexOf(c.experimento?.estilo)+1)%ids.length]};}
  }
  const voz=c.studio?.voz;
  c.status='produzindo';c.studio={job:crypto.randomUUID(),estado:'gerando',etapa:c.briefing?'copy':'leitura',indice:0,tentativas:0,passos:0,iniciado_em:now(),voz:voz||''};
  c.motion=null;await gravar(c,reg.rev);return c;
}
async function processar(id,job,{deps={}}={}) {
  const reg=await ler(id);const c=reg.doc;const st=c.studio;
  if(!st || st.job!==job || st.estado!=='gerando')return c;
  if(st.adiar_ate&&Date.parse(st.adiar_ate)>Date.now())return c;
  if(st.lease && Date.now()-Date.parse(st.lease)<75000)return c;
  st.lease=now();st.passos=(st.passos||0)+1;
  const lease=await gravar(c,reg.rev).catch(e=>{if(e.code==='CONFLITO')return null;throw e;});if(!lease)return c;
  const proxima=(e,i=0)=>{st.etapa=e;st.indice=i;};
  try {
    if(st.passos>100)throw new Error('A produção levou mais etapas do que o esperado. Retome para tentar novamente.');
    const d={research,redacao,arte,...deps};
    await require('./llmJson').comPrazo(47000,async()=>{switch(st.etapa) {
      case 'leitura': {
        c.fonte_principal=await d.research.lerFonte(c.origem.tipo==='texto'?{texto:c.origem.texto_bruto}:{url:c.origem.url});
        if(!c.fonte_principal.legivel)throw new Error('Não consegui ler a matéria. Cole o texto para tentar novamente.');
        c.titulo=c.fonte_principal.titulo || c.titulo;proxima('afirmacoes');break;
      }
      case 'afirmacoes': {const r=await d.research.levantarAfirmacoes(c.fonte_principal);c.claims=r.claims;c.evidencias=r.evidencias;proxima('pesquisa');break;}
      case 'pesquisa': {
        const alvo=c.claims.filter(k=>k.central && k.tipo!=='opiniao').slice(0,4);const k=alvo[st.indice];
        if(k) {const r=await d.research.verificarAfirmacao(k,c.fonte_principal,c.evidencias);const i=c.claims.findIndex(q=>q.id===k.id);c.claims[i]=r.claim;const ids=new Set(c.evidencias.map(e=>e.id));c.evidencias.push(...r.evidencias.filter(e=>!ids.has(e.id)));}
        if(st.indice+1<alvo.length)proxima('pesquisa',st.indice+1);else proxima('briefing');break;
      }
      case 'briefing': {
        const cfg=await armazem().config.obter(conta());
        c.briefing=(await d.redacao.gerarBriefing({fonte:c.fonte_principal,claims:c.claims,evidencias:c.evidencias,recentes:await recentes(),objetivo:'alcance',formato:'carrossel',voz:st.voz||cfg.voice_profile})).briefing;proxima('copy');break;
      }
      case 'copy': {
        // An attributed report remains attributed; this does not turn it into a verified fact.
        c.claims.filter(k=>k.tipo!=='opiniao' && ['parcialmente_sustentada','nao_verificada'].includes(k.estado)).forEach(k=>{
          const evid=c.evidencias.filter(e=>(k.evidencias||[]).includes(e.id));
          if(evid.some(e=>e.fonte_principal && e.trecho) && c.fonte_principal.veiculo && c.fonte_principal.tipo!=='texto')k.decisao={tipo:'atribuir',condicao:`segundo ${c.fonte_principal.veiculo}`,quem:'sistema',motivo:'Manter atribuição explícita à matéria; não afirmar como fato confirmado.'};
        });
        const cfg=await armazem().config.obter(conta());const aprendizado=await prefs.orientacoes();
        const instr=[require('../../static/growthModel').instrucoes({formato:c.formato,objetivo:c.crescimento?.objetivo}),`Crie para leitura no celular. Até 28 palavras por slide, contando título e corpo. CTA específico alinhado ao objetivo principal: diga o benefício concreto, sem "mais análises", "próximas notícias" ou promessa de resultado.`,...aprendizado.regras,c.formato==='reels'?'Roteiro para narração: 6 a 8 blocos, entre 120 e 145 palavras no total, frases faladas e progressão dinâmica.':'Ritmo: acontecimento → detalhe concreto → dado/recorte da fonte → esclarecimento de limites ou prazos → pergunta específica → uma ação principal. Consequência econômica e opinião não são etapas obrigatórias. Use apenas o que os dados sustentam; não preencha telas com uma moral ou tese genérica.',c.ultimo_feedback?`Pedido de ajuste do autor (estilo, não fatos): ${c.ultimo_feedback.motivos.map(k=>prefs.MOTIVOS[k]).join('; ')}. ${c.ultimo_feedback.detalhe}`:'',st.correcao||''].filter(Boolean).join('\n');
        const r=await d.redacao.gerarCopia({briefing:c.briefing,fonte:c.fonte_principal,claims:c.claims,evidencias:c.evidencias,recentes:await recentes(),formato:c.formato==='estatico'?'estatico':'carrossel',editorial:c.formato!=='reels',instrucoes:instr,voz:st.voz||cfg.voice_profile,objetivo:c.crescimento?.objetivo||'seguidores'});
        const n=c.copia.versoes.length+1;const mapa={};r.opinioes.forEach((o,i)=>{mapa[o.id]=`o${n}_${i+1}`;});c.claims.push(...r.opinioes.map(o=>({...o,id:mapa[o.id]})));
        const v=M.clone(r.versao);v.legenda=limparMarcadores(v.legenda);v.capas?.forEach(k=>{k.texto=limparMarcadores(k.texto);});v.slides.forEach(s=>{s.texto=limparMarcadores(s.texto);s.titulo=limparMarcadores(s.titulo);s.claim_ids=(s.claim_ids||[]).map(id=>mapa[id]||id);s.estilo=c.experimento.estilo;});
        if(c.formato!=='reels')v.slides.forEach(s=>{s.design='editorial_2026';});
        const foco=c.experimento.estilo==='impacto'?'acontecimento':c.experimento.estilo==='revista'?'tensao':'consequencia';
        let capa=require('../../static/growthModel').escolherCapa(redacao.capasConferidas(c,v),foco);
        if(!capa&&c.formato!=='reels'&&c.fonte_principal?.titulo&&c.fonte_principal.titulo.split(/\s+/).length<=18)capa={id:'fonte_principal',texto:c.fonte_principal.titulo,claim_ids:c.claims.filter(k=>k.tipo!=='opiniao'&&k.natureza!=='opiniao'&&k.estado!=='contradita'&&k.decisao?.tipo!=='retirar').map(k=>k.id)};
        if(capa){v.capa_escolhida=capa.id;v.slides[0].titulo=null;v.slides[0].texto=capa.texto;v.slides[0].claim_ids=capa.claim_ids;}else v.capa_escolhida='original';
        if(!v.cta){v.cta=`Siga ${ACCOUNT.handle}. Aqui eu conecto decisões da economia ao dia a dia de quem empreende.`;const fim=v.slides.at(-1);if(fim?.layout==='encerramento')fim.texto=v.cta;}
        manterAtribuicoes(v,c);
        c.crescimento={...require('../../static/growthModel').plano(c.formato,c.crescimento?.objetivo),ganchos:v.capas?.map(k=>({foco:k.foco,texto:k.texto})),hash_versao:M.hash(M.conteudoDaVersao(v))};
        M.criarVersao(c,v,{quem:'sistema',rotulo:'Versão preparada para aprovação única'});c.status='produzindo';c.auditoria_textos={};c.arte.renders=c.arte.renders || [];delete st.pendencias;proxima('auditoria');break;
      }
      case 'auditoria': {
        const v=M.versaoAtiva(c);const editorial=v.slides.some(s=>s.design==='editorial_2026');const unidades=[...v.slides.filter(s=>s.layout!=='encerramento'||editorial).map(s=>({id:s.id,texto:M.textoParaAuditoria(s)})),{id:'legenda',texto:v.legenda},...(editorial&&v.cta?[{id:'cta',texto:v.cta}]:[])].filter(t=>t.texto?.trim());
        if(st.auditoria_verificar_ids?.length){
          const ids=st.auditoria_verificar_ids;
          let r;try{r=await d.redacao.conferirVinculos({auditoria:ids.map(id=>c.auditoria_textos[id]),claims:c.claims,textos:unidades.filter(t=>ids.includes(t.id))});}
          catch(e){if(e.code==='AUDITORIA_INCOMPLETA'&&ids.length>1){st.auditoria_lote=1;st.auditoria_verificar_ids=ids.slice(0,1);break;}throw e;}
          r.auditoria.forEach(a=>{c.auditoria_textos[a.slide_id]=a;});delete st.auditoria_verificar_ids;
          if(st.indice+ids.length<unidades.length)proxima('auditoria',st.indice+ids.length);else proxima('foto');break;
        }
        const grupo=unidades.slice(st.indice,st.indice+(st.auditoria_lote||(editorial?2:3)));
        let r;try{r=await d.redacao.auditarOpinioes({slides:grupo,claims:c.claims,revisaoIntegral:editorial&&typeof d.redacao.conferirVinculos==='function'});}
        catch(e){if(e.code==='AUDITORIA_INCOMPLETA'&&grupo.length>1){st.auditoria_lote=1;break;}throw e;}
        r.auditoria.forEach(a=>{c.auditoria_textos[a.slide_id]=a;});
        if(typeof d.redacao.conferirVinculos==='function'){st.auditoria_verificar_ids=grupo.map(s=>s.id);break;}
        if(st.indice+grupo.length<unidades.length)proxima('auditoria',st.indice+grupo.length);else proxima('foto');break;
      }
      case 'foto': {
        const v=M.versaoAtiva(c);
        const consultas=require('./fotosStudio').consultasPara(c.titulo);
        try {
          const foto=await(deps.buscarFoto || require('./fotosStudio').buscarFoto)(consultas[Math.min(st.indice,1)],{excluir:st.indice?c.imagens.map(i=>i.id):[]});
          await armazem().arquivos.salvar(conta(),`img:${foto.meta.id}`,foto.dados,'image/jpeg');
          c.imagens=[...(c.imagens||[]).filter(i=>i.id!==foto.meta.id),foto.meta];
          if(st.indice===0){v.slides[0].imagem_id=foto.meta.id;v.slides[0].layout='capa_foto';}
          else {const s=v.slides.find((s,i)=>i>0&&s.composicao==='foto')||v.slides.find((s,i)=>i>0&&s.funcao==='contexto');if(s){s.imagem_id=foto.meta.id;if(s.design)s.composicao='foto';}}
          v.hash=M.hash(M.conteudoDaVersao(v));st.foto_aviso=null;
        }catch(e){st.foto_aviso=e.message;}
        if(st.indice===0&&c.formato==='carrossel')proxima('foto',1);else proxima('arte');break;
      }
      case 'arte': {
        const v=M.versaoAtiva(c);const s=v.slides[st.indice];
        if(s){const imagem=s.imagem_id?(await armazem().arquivos.obter(conta(),`img:${s.imagem_id}`))?.dados:null;const encerramento=s.layout==='encerramento'?(await armazem().arquivos.obter(conta(),'upload:encerramento'))?.dados:null;
          const r=await d.arte.renderizarSlide(s,{indice:st.indice+1,total:v.slides.length,imagem,arquivoEncerramento:encerramento});
          const key=`render:${c.id}:${v.id}:${s.id}:${M.hashRender(s)}`;await armazem().arquivos.salvar(conta(),key,r.png,'image/png');
          c.arte.renders=[...c.arte.renders.filter(q=>q.versao!==v.id || q.slide_id!==s.id),{slide_id:s.id,versao:v.id,texto_hash:M.hashRender(s),blob_key:key,indice:st.indice+1,total:v.slides.length,metrics:r.metrics,elementos:r.metrics.elementos||[]}];}
        if(st.indice+1<v.slides.length)proxima('arte',st.indice+1);else proxima('motion');break;
      }
      case 'motion': {
        const g=prepararRevisao(c);
        if(g.bloqueios.length){
          if(st.tentativas<2){st.tentativas+=1;st.correcao='Corrija estes problemas antes de entregar: '+g.bloqueios.map(b=>`${b.titulo}: ${b.detalhe}`).join('\n').slice(0,4500);proxima('copy');break;}
          st.pendencias=g.bloqueios.map(b=>({id:b.id,titulo:b.titulo,detalhe:b.detalhe}));throw new Error('Não consegui concluir a conferência automática. Você pode pedir outra versão ou ajustar o conteúdo.');
        }
        if(c.formato==='reels'){
          if(!deps.motion && process.env.STUDIO_RENDERER!=='shotstack') c.motion=await require('./motionLocal').avancar(c);
          else {const motion=deps.motion || require('./motionStudio');if(!c.motion){c.motion=await motion.iniciar(c,{base:base(),tokenMidia:assinatura(c.id,st.job),sandbox:!!st.sandbox});}else c.motion=await motion.consultar(c.motion);}
          if(c.motion.estado!=='pronto')break;
        }
        proxima('finalizar');break;
      }
      case 'finalizar':c.status='em_revisao';st.estado='pronto';st.concluido_em=now();M.registrar(c,'sistema','pronto','Conteúdo pronto: basta conferir e aprovar ou pedir ajuste.');break;
      default:throw new Error('Etapa de produção desconhecida.');
    }});
    delete st.lease;delete st.adiar_ate;delete st.aviso;st.retentativas=0;await gravar(c,lease.rev);
    if(st.estado==='pronto' && !st.notificado){await push.notificarLote(1).catch(()=>{});}
    return c;
  }catch(e){
    if(e.code==='CONFLITO')return(await ler(id)).doc;
    const espera=esperaTemporaria(e);
    if(espera!==null&&(st.retentativas||0)<5){
      delete st.lease;st.retentativas=(st.retentativas||0)+1;st.adiar_ate=new Date(Date.now()+espera*1000).toISOString();
      st.aviso=e.code==='AUDITORIA_INCOMPLETA'?'Estou refazendo a conferência para cobrir o texto completo.':'O serviço de IA está ocupado. A preparação será retomada automaticamente.';st.erro=null;c.status='produzindo';
      await gravar(c,lease.rev);return c;
    }
    delete st.lease;delete st.adiar_ate;delete st.aviso;st.estado='erro';st.erro=e.code==='AUDITORIA_INCOMPLETA'?'A conferência não cobriu o conteúdo completo. Retome para conferir esta versão novamente.':espera!==null?'O serviço de IA continua indisponível após novas tentativas. Tente retomar a preparação em alguns minutos.':e.message;c.status='rascunho';await gravar(c,lease.rev).catch(()=>{});
    await push.notificar({corpo:'Um conteúdo precisa de um ajuste. Toque para retomar a preparação.',tag:`erro-${c.id}`}).catch(()=>{});return c;
  }
}
async function decidir(id,{acao,motivos,detalhe,hash}) {
  const reg=await ler(id);const c=reg.doc;
  if(c.studio?.estado==='gerando')throw falha('Espere a preparação terminar antes de aprovar.',409);
  if(acao==='refazer')return reagendar(id,{acao,motivos,detalhe,hash});
  const v=M.versaoAtiva(c);if(!v || v.hash!==hash)throw falha('A versão mudou. Atualize para ver o conteúdo atual.',409);
  if(acao==='descartar'){await prefs.registrar(c,{acao,motivos,detalhe,versao:hash});c.status='arquivado';await gravar(c,reg.rev);return c;}
  if(acao!=='aprovar')throw falha('Decisão inválida.');
  const g=prepararRevisao(c);if(g.bloqueios.length)throw falha('A preparação ainda precisa de ajuste: '+g.bloqueios[0].titulo,409);
  if(c.formato==='reels' && (c.motion?.estado!=='pronto'||c.motion.hash!==v.hash))throw falha('Espere o vídeo desta versão terminar.',409);
  c.claims.forEach(k=>{k.revisao={...(k.revisao||{}),confirmada_por_pedro:true};});
  M.aprovar(c,g);M.registrar(c,'pedro','revisao_unica','Aprovou o conteúdo completo e autorizou publicar esta versão.');await gravar(c,reg.rev);
  await prefs.registrar(c,{acao:'aprovar',versao:hash});return c;
}
async function panorama(){
  const feedback=await prefs.listar();const docs=await armazem().conteudos.listar(conta());
  const itens=[];for(const r of docs.filter(r=>r.resumo.status==='publicado').slice(0,100)){const c=(await ler(r.id)).doc;itens.push(c);}
  return {estilos:Object.entries(prefs.ESTILOS).map(([id,cfg])=>{const publicados=itens.filter(c=>c.experimento?.estilo===id);return {id,...cfg,aprovacoes:feedback.filter(f=>f.estilo===id&&f.acao==='aprovar').length,ajustes:feedback.filter(f=>f.estilo===id&&f.acao==='refazer').length,publicados:publicados.length,medidos:publicados.filter(c=>c.desempenho?.alcance>0).length,alcance:publicados.reduce((n,c)=>n+(c.desempenho?.alcance||0),0),...require('../../static/growthModel').consolidar(publicados),interacoes:publicados.reduce((n,c)=>n+(c.desempenho?.interacoes||0),0),seguidores:publicados.some(c=>c.desempenho?.seguidores!=null)?publicados.reduce((n,c)=>n+(c.desempenho?.seguidores||0),0):null};}),orientacoes:await prefs.orientacoes(),aviso:'Preferências vêm das suas decisões. Desempenho usa somente métricas devolvidas pelo Instagram; ainda não há vencedor sem amostra suficiente.'};
}
module.exports={criar,reagendar,processar,decidir,ler,prepararRevisao,assinatura,confere,panorama,etapas,base,limparMarcadores,esperaTemporaria};

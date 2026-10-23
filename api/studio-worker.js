require('../backend/fontSetup');
const {fila}=require('../backend/lib/studioFila');
const studio=require('../backend/lib/studio');
const {executar}=require('../backend/routes/studio')._internos;

module.exports=fila().handleNodeCallback(async({id,job})=>{
  if(typeof id!=='string'||!/^\w[\w.:-]{0,119}$/.test(id)||typeof job!=='string')return;
  const antes=(await studio.ler(id)).doc;
  if(antes.studio?.job!==job||!['gerando','publicando'].includes(antes.studio.estado))return;
  const falta=Math.ceil((Date.parse(antes.studio.adiar_ate)-Date.now())/1000);
  if(falta>0)throw Object.assign(new Error('Aguardando o serviço de IA liberar novas chamadas.'),{afterSeconds:falta});
  await executar(id,job);
  const c=(await studio.ler(id)).doc;
  if(c.studio?.job===job&&['gerando','publicando'].includes(c.studio.estado)&&c.studio.lease)throw new Error('Outra etapa ainda está em processamento.');
},{visibilityTimeoutSeconds:90,retry:(error,metadata)=>({afterSeconds:error.afterSeconds||Math.min(300,20*metadata.deliveryCount)})});

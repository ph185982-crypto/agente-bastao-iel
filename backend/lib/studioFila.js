let cliente;
function fila(){return cliente ||= new(require('@vercel/queue').QueueClient)({region:process.env.VERCEL_REGION||'iad1'});}
async function enfileirar(c){
  const st=c.studio;
  const chave=[c.id,st.job,st.etapa,st.indice||0,st.passos||0,st.polls||0].join(':');
  const delaySeconds=st.adiar_ate?Math.max(0,Math.ceil((Date.parse(st.adiar_ate)-Date.now())/1000)):0;
  return fila().send('pedro-studio',{id:c.id,job:st.job},{idempotencyKey:chave,retentionSeconds:86400,delaySeconds});
}
module.exports={enfileirar,fila};

const { safeFetch } = require('./safeFetch');
const sharp = require('sharp');
// Only licensed illustrative photos. Never identify a stock model as a real news subject.
async function buscarFoto(consulta, { fetcher = fetch, carregar = safeFetch, excluir = [] } = {}) {
  if (!process.env.PEXELS_API_KEY) throw new Error('A busca de fotos não está configurada.');
  const query = String(consulta || 'business city brazil').replace(/[^\p{L}\p{N}\s-]/gu,' ').trim().slice(0,100);
  const r=await fetcher(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`, { headers:{Authorization:process.env.PEXELS_API_KEY},signal:AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`A busca de fotos não respondeu (${r.status}).`);
  const d=await r.json(); const p=(d.photos || []).find(p=>!excluir.includes(`pexels_${p.id}`) && (p.src?.large2x || p.src?.large));
  if (!p) throw new Error('Não encontrei uma foto adequada. Tente outro assunto ou envie sua foto.');
  const url=p.src.large2x || p.src.large;
  if (new URL(url).hostname !== 'images.pexels.com') throw new Error('A origem da foto não confere.');
  const img=await carregar(url,{ maxBytes:6*1024*1024, timeoutMs:12000, tipos:[/^image\//], binario:true, accept:'image/jpeg,image/png,image/webp' });
  if (img.status !== 200) throw new Error('Não consegui baixar a foto.');
  const dados=await sharp(img.corpo,{limitInputPixels:40e6}).rotate().resize(1080,1350,{fit:'cover'}).jpeg({quality:88}).toBuffer();
  return { dados, meta:{ id:`pexels_${p.id}`,tipo:'ilustrativa',origem:p.url,autor:String(p.photographer || '').slice(0,120),licenca:'Pexels License',licenca_url:'https://www.pexels.com/license/',consulta:query,src:url,alt:String(p.alt || 'Foto ilustrativa').slice(0,240) } };
}
function consultasPara(titulo){
  if(/enel|apag[aã]o|apag[oõ]es|energia el[eé]trica|fornecimento de energia/i.test(titulo))return ['electrical power lines city','electricity meter'];
  if(/d[oó]lar|c[aâ]mbio/i.test(titulo))return ['dollar banknotes closeup','brazil money cash'];
  if(/mei|empreendedor|pequen[oa]s? (empresa|neg[oó]cio)/i.test(titulo))return ['small business owner shop','small store counter'];
  if(/juros|infla|sal[aá]rio|imposto|economia|dinheiro|arrecada/i.test(titulo))return ['brazil money economy','business financial documents'];
  if(/tecnolog|intelig[eê]ncia|digital/i.test(titulo))return ['technology computer','working laptop desk'];
  if(/diesel|petr[oó]leo|combust|gasolina/i.test(titulo))return ['gas station fuel','fuel pump closeup'];
  return ['business daily life','business documents desk'];
}
module.exports={buscarFoto,consultasPara};

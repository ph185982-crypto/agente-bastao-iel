const {ACCOUNT}=require('./account');
const limpar=s=>String(s||'').replace(/\s+/g,' ').trim();
function limparTitulo(raw){
  let t=limpar(raw);
  // OCR of a profile header is not an editorial hook. Keep a real headline
  // that follows the header, but reject identity plus punctuation/noise.
  t=t.replace(/pedro\s+martins/gi,'').replace(/[q@]?pedro[_.\s]*destrava/gi,'').trim();
  const tokens=t.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w.length>1);
  if(tokens.length<3||t.length<12||t.length>140||/^@/.test(t)||/^(seguir|follow|inscreva|compartilhar|curtir)\b/i.test(t))return '';
  if(!/[\p{L}]/u.test(t)||/[—–_.|]{3,}/.test(t))return '';
  return t.replace(/^[\s:;|—–.-]+|[\s|—–]+$/g,'').trim();
}
function daFonte({givenHeadline,transcript,visual,tema,objetivo='seguidores'}={}){
  const fala=limpar(transcript).replace(/\b(?:m[uú]sica\s*){2,}/gi,'').trim();
  const base=fala||limpar(visual)||limpar(tema);
  const frase=base.split(/(?<=[.!?])\s+/).find(s=>s.length>=12&&s.length<=140);
  const headline=limpar(givenHeadline)||limparTitulo(frase);
  if(!headline)throw Object.assign(new Error('Não consegui ler uma fala ou título confiável. Abra “Usar meu próprio gancho”, escreva o título e tente novamente.'),{status:422});
  const cta=objetivo==='compartilhar'?'Envie para alguém com quem você conversaria sobre isso.':objetivo==='salvar'?'Salve para voltar a essa discussão depois.':`Siga ${ACCOUNT.handle} para acompanhar a leitura por trás das imagens e decisões que circulam por aqui.`;
  // A source transcript is an honest fallback, not invented advice or a placeholder.
  const texto=fala&&fala.length<=1600?`Fala do vídeo de origem:\n${fala}`:headline;
  return {headline,caption:`${texto}\n\n${cta}`,fonte:'transcricao',aviso:'Legenda baseada no conteúdo de origem. Confira o texto antes de postar.'};
}
module.exports={limparTitulo,daFonte};

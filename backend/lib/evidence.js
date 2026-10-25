// Base de evidências. Regras que nenhuma IA consegue contornar porque rodam em código:
//  - um trecho só vale se existe, de fato, no texto que o servidor leu;
//  - uma string como "Fonte: G1" nunca é evidência;
//  - republicação da mesma notícia não conta como confirmação independente;
//  - cada evidência guarda quando foi publicada, quando foi consultada, o que
//    cobre e o que NÃO cobre.
const crypto = require('crypto');

const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const normaliza = (s) => semAcento(s).replace(/[“”"‘’'«»]/g, ' ').replace(/[^a-z0-9%$,.\- ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Confere que `trecho` está em `texto`. Aceita reticências ("…" ou "...") separando
// pedaços que precisam aparecer NA ORDEM. Devolve { ok, inicio, fim } ou { ok:false }.
function acharTrecho(texto, trecho) {
  const t = normaliza(texto);
  const pedacos = String(trecho || '').split(/…|\.{3}|\[\.\.\.\]/).map(normaliza).filter((p) => p.length >= 8);
  if (!pedacos.length) return { ok: false, motivo: 'trecho curto demais' };
  let pos = 0; let inicio = -1;
  for (const p of pedacos) {
    const i = t.indexOf(p, pos);
    if (i < 0) return { ok: false, motivo: 'trecho não está no texto lido' };
    if (inicio < 0) inicio = i;
    pos = i + p.length;
  }
  return { ok: true, inicio, fim: pos };
}

// Domínio "registrável": agora.uol.com.br -> uol.com.br, www.g1.globo.com -> globo.com.
const SEGUNDO_NIVEL = new Set(['com.br', 'gov.br', 'org.br', 'net.br', 'edu.br', 'leg.br', 'jus.br', 'mil.br', 'co.uk', 'org.uk', 'com.au', 'com.pt']);
function dominioRegistravel(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  const p = host.split('.');
  if (p.length <= 2) return host;
  const ult2 = p.slice(-2).join('.');
  return SEGUNDO_NIVEL.has(ult2) ? p.slice(-3).join('.') : ult2;
}

// Similaridade entre dois textos por "telhas" de 5 palavras (republicação/cópia de agência).
function telhas(texto, n = 5) {
  const w = normaliza(texto).split(' ').filter(Boolean);
  const s = new Set();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
}
function similaridade(a, b) {
  const A = telhas(a); const B = telhas(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

// Veículos que republicam material de agência: quando a matéria cita a agência,
// ela e a agência contam como UMA origem.
const AGENCIAS = [/ag[eê]ncia brasil/i, /ag[eê]ncia senado/i, /ag[eê]ncia c[aâ]mara/i, /\breuters\b/i, /\bassociated press\b|\bap\b news/i, /\bafp\b/i, /ag[eê]ncia estado/i];
const citaAgencia = (texto) => AGENCIAS.find((r) => r.test(String(texto || '').slice(0, 4000)));

// Dado um conjunto de evidências com `texto_completo` (opcional), atribui `grupo`.
// Mesmo domínio = mesmo grupo. Texto muito parecido (>= 0,6) = mesmo grupo (republicação).
function agrupar(evidencias, textoPrincipal) {
  const grupos = [];
  const novo = (e) => { const g = { id: `g${grupos.length + 1}`, dominio: e.dominio, texto: e.texto_completo || '' }; grupos.push(g); return g; };
  if (textoPrincipal) grupos.push({ id: 'g0', dominio: textoPrincipal.dominio, texto: textoPrincipal.texto || '' });
  for (const e of evidencias) {
    if (e.via && e.via !== 'artigo') { e.grupo = `api:${e.dominio || e.origem}`; continue; }
    let g = grupos.find((x) => x.dominio && x.dominio === e.dominio);
    if (!g && e.texto_completo) g = grupos.find((x) => x.texto && similaridade(x.texto, e.texto_completo) >= 0.6);
    if (!g && e.texto_completo && textoPrincipal?.texto && citaAgencia(e.texto_completo) && citaAgencia(textoPrincipal.texto)) {
      g = grupos.find((x) => x.id === 'g0');
    }
    if (!g) g = novo(e);
    e.grupo = g.id;
    if (g.id === 'g0') e.republicacao_da_fonte_principal = true;
  }
  return evidencias;
}

// Autoridade da fonte, decidida por código (explicável, sem IA):
//  - 'primaria': dado oficial consultado na API do órgão, ou página do próprio
//    poder público (gov.br, leg.br, jus.br, mp.br…);
//  - 'republicacao': cópia/reprodução da matéria de origem (não é independente);
//  - 'reportagem': matéria jornalística original.
const OFICIAIS = /(^|\.)(gov\.br|leg\.br|jus\.br|mp\.br|def\.br|mil\.br|bcb\.gov\.br|ibge\.gov\.br)$/i;
function autoridadeDe({ via, dominio, republicacao }) {
  if (via && via !== 'artigo') return 'primaria';
  if (republicacao) return 'republicacao';
  if (dominio && OFICIAIS.test(dominio)) return 'primaria';
  return 'reportagem';
}

const CORRESP = ['integral', 'parcial', 'nao_sustenta', 'contradiz'];
const RELACAO_DE = { integral: 'sustenta', parcial: 'parcial', nao_sustenta: 'neutra', contradiz: 'contradiz' };
const CORRESP_DE = { sustenta: 'integral', parcial: 'parcial', neutra: 'nao_sustenta', contradiz: 'contradiz' };

// Números da afirmação que não aparecem no trecho: o trecho não sustenta a afirmação INTEIRA.
function numerosAusentes(textoAfirmacao, trecho) {
  const { extrairNumeros, exigeOrigem, igual } = require('../../static/contentModel');
  const doTrecho = extrairNumeros(trecho).map((n) => n.valor);
  return extrairNumeros(textoAfirmacao).filter(exigeOrigem).filter((n) => !doTrecho.some((v) => igual(v, n.valor))).map((n) => n.raw);
}

// Cria um registro de evidência completo e validado.
// Três camadas SEPARADAS: (1) trecho encontrado no documento; (2) correspondência
// entre o trecho e a afirmação; (3) qualidade e limites da fonte.
function novaEvidencia(d) {
  const consultada = d.consultada_em || new Date().toISOString();
  const e = {
    id: d.id || `e_${crypto.randomBytes(4).toString('hex')}`,
    via: d.via || 'artigo',                    // 'artigo' | 'api_bcb' | 'api_ibge' | 'api_camara'
    tipo: d.tipo || 'secundaria',              // 'primaria' | 'secundaria'
    url: d.url || null,
    url_consultada: d.url_consultada || d.url || null,
    titulo: String(d.titulo || '').slice(0, 300),
    origem: String(d.origem || '').slice(0, 120),
    dominio: d.dominio || dominioRegistravel(d.url || ''),
    trecho: String(d.trecho || '').slice(0, 800),
    publicada_em: d.publicada_em || null,       // data da notícia/publicação
    data_acontecimento: d.data_acontecimento || null,
    consultada_em: consultada,
    periodo: d.periodo || null,
    unidade: d.unidade || null,
    abrangencia: d.abrangencia || null,
    limitacoes: d.limitacoes || null,
    // (1) trecho
    trecho_encontrado: d.trecho_encontrado !== false,
    // (2) correspondência
    correspondencia: CORRESP.includes(d.correspondencia) ? d.correspondencia : (CORRESP_DE[d.relacao] || 'nao_sustenta'),
    falta: d.falta ? String(d.falta).slice(0, 300) : null,
    // (3) qualidade
    autoridade: ['primaria', 'reportagem', 'republicacao', 'texto_colado'].includes(d.autoridade) ? d.autoridade : autoridadeDe({ via: d.via, dominio: d.dominio || dominioRegistravel(d.url || ''), republicacao: d.republicacao_da_fonte_principal }),
    relacao: null,
    explicacao: d.explicacao ? String(d.explicacao).slice(0, 400) : null,
    desatualizada: !!d.desatualizada,
    republicacao_da_fonte_principal: !!d.republicacao_da_fonte_principal,
    grupo: d.grupo || null,
    llm: d.llm || null,
  };
  e.relacao = RELACAO_DE[e.correspondencia];
  if (e.tipo === 'secundaria' && e.autoridade === 'primaria') e.tipo = 'primaria';
  return e;
}

// Fonte antiga para afirmação que muda com o tempo (status, preço, posição).
function marcarDesatualizada(e, { mutavel, agora = Date.now(), dias = 3 } = {}) {
  if (mutavel && e.publicada_em && agora - Date.parse(e.publicada_em) > dias * 86400e3) e.desatualizada = true;
  return e;
}

// Validação final de uma evidência de artigo: trecho precisa existir no texto lido.
function validarEvidenciaDeArtigo(e, textoLido) {
  const r = acharTrecho(textoLido, e.trecho);
  if (!r.ok) return { ok: false, motivo: r.motivo };
  if (/^\s*(fonte|segundo|via)\s*[:\-]?\s*[\w .]{1,30}\s*$/i.test(e.trecho)) return { ok: false, motivo: 'texto de crédito não é evidência' };
  return { ok: true };
}

module.exports = { autoridadeDe, numerosAusentes, CORRESP, RELACAO_DE, CORRESP_DE, acharTrecho, normaliza, dominioRegistravel, similaridade, agrupar, novaEvidencia, marcarDesatualizada, validarEvidenciaDeArtigo, citaAgencia };

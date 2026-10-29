// Foto real do protagonista da pauta, com licença que permite uso com crédito (Wikimedia Commons).
// Aceita só CC BY (qualquer versão, incluindo "CC BY 3.0 br" da Agência Brasil), CC0 e domínio público.
// CC BY-SA fica de fora: a arte é uma adaptação e o "compartilha igual" obrigaria a licenciar o carrossel inteiro.
// O rosto nunca é gerado nem alterado: a arte só converte para preto e branco e recorta a borda.
const BASE = 'https://commons.wikimedia.org/w/api.php';
const UA = 'PedroDestravaEstudio/1.0 (https://agente-bastao-iel.vercel.app; contato via app)';
const LICENCA_OK = /^(cc[ -]by(?![ -]?sa)(?![ -]?nd)(?![ -]?nc)[ -]?\d(\.\d)?( [a-z]{2})?|cc0|public domain|domínio público|pd(-[a-z]+)?)$/i;
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpaHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

function licencaAceita(meta) {
  const nome = limpaHtml(meta?.LicenseShortName?.value || meta?.License?.value || '');
  return LICENCA_OK.test(nome.trim()) ? nome : null;
}

// Pontua: nome no título do arquivo, foto recente, formato retrato, tamanho bom.
function pontuar(item, nome) {
  const titulo = sem(item.title);
  const partes = sem(nome).split(/\s+/).filter((p) => p.length >= 3);
  if (!partes.length || !partes.every((p) => titulo.includes(p))) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g|png)$/i.test(item.title) || (ii.width || 0) < 700 || (ii.height || 0) < 700) return -1;
  const ano = Number((titulo.match(/\b(20[12]\d)\b/) || [])[1] || (String(ii.extmetadata?.DateTimeOriginal?.value || '').match(/\b(20[12]\d)\b/) || [])[1] || 0);
  let p = 10;
  if (ano) p += Math.max(0, 8 - (2026 - ano));
  if ((ii.height || 0) >= (ii.width || 0) * 0.9) p += 3;
  if (/(retrato|portrait|oficial|official|foto oficial)/.test(titulo)) p += 4;
  if (/(reuniao|meeting|cerimonia|ceremony|grupo|group|com |with )/.test(titulo)) p -= 3;
  return p;
}

// Lugar/instituição: foto do ambiente, nunca retrato de alguém (uma senadora qualquer na capa sugere que ela está na notícia).
const PESSOA = /(senador|deputad|ministr|president|governador|prefeit|discurs|pronunciament|entrevista|retrato|portrait|posse|cerimonia|homenage|reuniao|audiencia|depoiment|protest|manifest|greenpeace|\bato\b|faixa|cartaz|banner|ocupa)/;
function pontuarLugar(item, nome) {
  const titulo = sem(item.title);
  const partes = sem(nome).split(/\s+/).filter((p) => p.length >= 4);
  if (!partes.length || partes.filter((p) => titulo.includes(p)).length < Math.min(2, partes.length)) return -1;
  if (PESSOA.test(titulo)) return -1;
  // séries numeradas do Flickr (Agência Senado/Câmara, "(14786000717)") são fotos de sessão: quase sempre alguém discursando
  if (/\(\d{8,}\)/.test(titulo) || /\b(sessao|plenario)\b/.test(titulo) && !/(vista|panorama|vazio|empty)/.test(titulo)) return -1;
  const ii = item.imageinfo?.[0] || {};
  if (!/\.(jpe?g|png)$/i.test(item.title) || (ii.width || 0) < 1000 || (ii.height || 0) < 700) return -1;
  let p = 10;
  if (/(fachada|predio|edificio|exterior|vista|panorama|cupula|congresso nacional)/.test(titulo)) p += 5;
  if (/(plenario|vista|fachada|predio|panorama|interior|exterior|sessao|cupula|edificio|sede|congresso)/.test(titulo)) p += 5;
  const ano = Number((titulo.match(/\b(1[89]\d\d|20[0-2]\d)\b/) || [])[1] || 0);
  if (ano && ano < 1990) return -1; // foto histórica não serve de capa de notícia
  return p;
}

async function buscar(nome, { fetcher = fetch, limite = 25, modo = 'pessoa' } = {}) {
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${nome} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(limite), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1400', origin: '*' });
  const r = await fetcher(`${BASE}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Commons respondeu ${r.status}`);
  const d = await r.json();
  const itens = Object.values(d?.query?.pages || {});
  return itens
    .map((it) => ({ it, lic: licencaAceita(it.imageinfo?.[0]?.extmetadata), p: modo === 'lugar' ? pontuarLugar(it, nome) : pontuar(it, nome) }))
    .filter((x) => x.lic && x.p >= 0)
    .sort((a, b) => b.p - a.p)
    .map(({ it, lic }) => {
      const ii = it.imageinfo[0]; const em = ii.extmetadata || {};
      return { titulo: it.title, url: ii.thumburl || ii.url, pagina: ii.descriptionurl, licenca: lic, autor: limpaHtml(em.Artist?.value || em.Credit?.value || 'autor não informado').slice(0, 120), largura: ii.thumbwidth || ii.width, altura: ii.thumbheight || ii.height };
    });
}

// Baixa a melhor foto. Devolve { dados: Buffer, meta } ou null (sem foto com licença aceita).
async function fotoDe(nome, { fetcher = fetch, modo = 'pessoa' } = {}) {
  if (!nome || sem(nome).length < 4) return null;
  const lista = await buscar(nome, { fetcher, modo });
  for (const f of lista.slice(0, 3)) {
    try {
      const u = new URL(f.url);
      if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname)) continue; // o Commons passou a servir miniaturas por thumb.
      const r = await fetcher(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const dados = Buffer.from(await r.arrayBuffer());
      if (dados.length < 20000 || dados.length > 8 * 1024 * 1024) continue;
      return { dados, meta: { id: `commons_${require('crypto').createHash('sha1').update(f.titulo).digest('hex').slice(0, 12)}`, tipo: 'foto_real', titulo: f.titulo, origem: f.pagina, autor: f.autor, licenca: f.licenca, exige_credito: !/cc0|public domain|domínio público|^pd/i.test(f.licenca), alt: `Foto de ${nome}` } };
    } catch { /* tenta a próxima */ }
  }
  return null;
}

module.exports = { fotoDe, buscar, licencaAceita, pontuar, pontuarLugar, LICENCA_OK };

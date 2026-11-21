// Banco de frases famosas para o formato "frase": lê a seção "Verificadas" do pt.wikiquote (citação com fonte conferida) de
// uma lista de autores. A semente fica em data/citacoes.json; o resto é lido aos poucos pelo piloto (poucos autores por
// rodada, com pausa entre as chamadas: a Wikimedia limita quem pede rápido) e guardado em config.citacoes.
const { armazem } = require('./armazem');
const { ACCOUNT } = require('./account');
const conta = () => ACCOUNT.ig_id;

const AUTORES = ['Steve Jobs', 'Henry Ford', 'Walt Disney', 'Ayrton Senna', 'Pelé', 'Albert Einstein', 'Warren Buffett', 'Benjamin Franklin', 'Theodore Roosevelt', 'Winston Churchill', 'Confúcio', 'Sêneca', 'Aristóteles', 'Bruce Lee', 'Michael Jordan', 'Mahatma Gandhi', 'Nelson Mandela', 'Thomas Edison', 'Leonardo da Vinci', 'Mário Quintana', 'Clarice Lispector', 'Fernando Pessoa', 'Machado de Assis', 'Abraham Lincoln', 'Napoleão Bonaparte', 'Peter Drucker', 'Bill Gates', 'Elon Musk', 'Jeff Bezos', 'Martin Luther King Jr.', 'Charles Chaplin', 'Muhammad Ali', 'Epicteto', 'Marco Aurélio', 'Friedrich Nietzsche', 'Paulo Coelho', 'Ariano Suassuna', 'Carlos Drummond de Andrade', 'Cora Coralina', 'Oscar Wilde', 'Mark Twain', 'Lao-Tsé', 'Sun Tzu', 'Abílio Diniz', 'Silvio Santos', 'Platão', 'Sócrates', 'Voltaire', 'Victor Hugo', 'Johann Wolfgang von Goethe', 'William Shakespeare', 'Ralph Waldo Emerson', 'Henry David Thoreau', 'Eleanor Roosevelt', 'Franklin D. Roosevelt', 'John F. Kennedy', 'Barack Obama', 'Madre Teresa de Calcutá', 'Dalai Lama', 'Rui Barbosa', 'Santos Dumont', 'Oscar Niemeyer', 'Vinicius de Moraes', 'Rubem Alves', 'Paulo Freire', 'Ayn Rand', 'Napoleon Hill', 'Dale Carnegie', 'Charles Darwin', 'Isaac Newton', 'Galileu Galilei', 'Marie Curie', 'Nikola Tesla', 'Andrew Carnegie', 'John D. Rockefeller', 'Sam Walton', 'Ray Kroc', 'Akio Morita', 'Jack Ma', 'Oprah Winfrey', 'Maya Angelou', 'Coco Chanel', 'Pablo Picasso', 'Vincent van Gogh', 'Salvador Dalí', 'Ludwig van Beethoven', 'Ernest Hemingway', 'Gabriel García Márquez', 'Jorge Luis Borges', 'Antoine de Saint-Exupéry', 'Liev Tolstói', 'Arthur Schopenhauer', 'Immanuel Kant', 'René Descartes', 'Blaise Pascal', 'Jean-Paul Sartre', 'Albert Camus', 'Carl Jung', 'Viktor Frankl', 'Margaret Thatcher', 'Dwight D. Eisenhower', 'George Washington', 'Thomas Jefferson', 'Bob Marley', 'John Lennon', 'Raul Seixas', 'Renato Russo', 'Cazuza', 'Tom Jobim', 'Zico', 'Oscar Schmidt', 'Bernardinho', 'Usain Bolt', 'Kobe Bryant', 'Babe Ruth'];
const EN = /\b(the|you|and|of|is|to|your|it|that|what|be)\b/i;

function limpa(x) {
  return String(x || '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1').replace(/'{2,}/g, '')
    .replace(/<ref[\s\S]*?<\/ref>|<ref[^>]*\/>/g, '').replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
}
// Extrai as citações da seção "Verificadas" (com a tradução quando a original está em outra língua).
function extrair(wikitext, autor) {
  const t = String(wikitext || '');
  const m = /^(=+)\s*Verificad[ao]s?\s*=+\s*$/m.exec(t); if (!m) return [];
  const nivel = m[1].length; const resto = t.slice(m.index + m[0].length);
  const fim = new RegExp(`^={1,${nivel}}[^=].*?=+\\s*$`, 'm').exec(resto);
  const sec = fim ? resto.slice(0, fim.index) : resto;
  const out = [];
  for (const blk of sec.split(/^\*(?!\*)/m).slice(1)) {
    const linhas = blk.split('\n'); const tr = linhas.slice(1).find((l) => /Tradu/.test(l));
    const q = limpa(tr || linhas[0]).replace(/^[:\-\s]*Tradução( livre)?:\s*/i, '').trim().replace(/^["“]+|["”]+$/g, '').trim();
    if (q.length < 30 || q.length > 160) continue;
    if (EN.test(q) && !tr) continue;
    if ((q.match(/"/g) || []).length % 2 || (q.match(/“/g) || []).length !== (q.match(/”/g) || []).length) continue;
    out.push({ texto: q, autor, fonte: `https://pt.wikiquote.org/wiki/${encodeURIComponent(autor.replace(/ /g, '_'))}` });
  }
  return out;
}

async function lerAutor(autor, { fetcher = fetch } = {}) {
  const q = new URLSearchParams({ action: 'parse', page: autor, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1' });
  const r = await fetcher(`https://pt.wikiquote.org/w/api.php?${q}`, { headers: { 'User-Agent': 'estudio-pedro-destrava/1.0 (frases para posts)' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 429) throw Object.assign(new Error('Wikiquote pediu para esperar (429)'), { limite: true });
  if (!r.ok) return [];
  const j = await r.json(); return extrair(j?.parse?.wikitext, autor);
}

const semente = () => { try { return require('../data/citacoes.json'); } catch { return []; } };

// Todas as frases conhecidas (semente + lidas em produção), sem repetir.
async function todas({ deps = {} } = {}) {
  const a = deps.armazem || armazem();
  const lidas = a?.duravel ? ((await a.config.obter(conta())).citacoes?.itens || []) : [];
  const vistos = new Set(); const out = [];
  for (const q of [...(deps.semente || semente()), ...lidas]) { const k = q.texto.toLowerCase(); if (!vistos.has(k)) { vistos.add(k); out.push(q); } }
  return out;
}

// Lê até `max` autores ainda não lidos (para no primeiro 429). Devolve { lidos, novas }.
async function crescer({ max = 6, pausaMs = 1200, deps = {} } = {}) {
  const a = deps.armazem || armazem(); if (!a?.duravel) return { lidos: 0, novas: 0 };
  const cfg = (await a.config.obter(conta())).citacoes || { itens: [], autores: {} };
  const semAutores = new Set((deps.semente || semente()).map((q) => q.autor));
  const fila = (deps.autores || AUTORES).filter((x) => !cfg.autores?.[x] && !semAutores.has(x)).slice(0, max);
  let lidos = 0; let novas = 0; const itens = [...(cfg.itens || [])]; const autores = { ...(cfg.autores || {}) };
  for (const autor of fila) {
    try { const qs = await lerAutor(autor, { fetcher: deps.fetcher || fetch }); itens.push(...qs); novas += qs.length; autores[autor] = new Date().toISOString().slice(0, 10); lidos++; }
    catch (e) { if (e.limite) break; autores[autor] = 'erro'; }
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  if (lidos || Object.keys(autores).length !== Object.keys(cfg.autores || {}).length) await a.config.salvar(conta(), { citacoes: { itens: itens.slice(-3000), autores } });
  return { lidos, novas, faltam: (deps.autores || AUTORES).filter((x) => !autores[x] && !semAutores.has(x)).length };
}

module.exports = { extrair, lerAutor, todas, crescer, AUTORES };

// Análise do Raio-X: o diagnóstico "sem agradar" do perfil, feito por REGRAS sobre os números reais lidos da Meta
// (backend/lib/raioX.js). Pura, sem IA e sem custo. Princípios:
//  - mediana, nunca média; só post com mais de 72 h entra em comparação; formato comparado com o mesmo formato;
//  - grupo com menos de 5 posts não vira conclusão (aparece como "amostra pequena");
//  - cada achado traz o número que o sustenta e o que fazer; o que a Meta não entregou aparece como "sem dado".
const MI = require('./meuInstagram');
const C = require('./crescimento');

const MIN = 5; const DIA = 86400000; const MADURO_H = 72;
const arred = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const mil = (a, b) => (a == null || !b ? null : (a / b) * 1000);
const med = (xs) => MI.mediana(xs.filter((x) => x != null && Number.isFinite(x)));
const soma = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const pct = (a, b, d = 0) => (a == null || !b ? null : arred((a / b) * 100, d));
const f = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));   // número em português (1.234,5)
const diaSP = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
const ROTULO_FORMATO = { reel: 'Reel', carrossel: 'Carrossel', imagem: 'Imagem única', video: 'Vídeo' };
const ROTULO_LINHA = {
  frase: 'Frase famosa (ferramenta)', por_tras_da_marca: 'Por trás da marca (ferramenta)', quem_e_ele: 'Quem é ele? (ferramenta)', video_editado: 'Vídeo editado aqui',
  reciclagem: 'Reciclagem (ferramenta)', noticia_tweet: 'Notícia: manchete + foto (ferramenta)', noticia_estatico: 'Notícia: post único (ferramenta)', noticia_ensaio: 'Notícia: ensaio (ferramenta)',
  fora: 'Publicado fora da ferramenta', sem_registro: 'Da ferramenta, sem registro',
};
const rotuloLinha = (k) => ROTULO_LINHA[k] || `${String(k).replace(/_/g, ' ')} (ferramenta)`;
const MIX_DA_LINHA = { frase: 'frase', por_tras_da_marca: 'marca', quem_e_ele: 'revelacao', noticia_tweet: 'noticia', noticia_estatico: 'noticia', noticia_ensaio: 'noticia' };

// Tipo de abertura da legenda (aproximação pelas primeiras palavras; a legenda é o que a Meta devolve).
function ganchoDe(legenda) {
  const t = String(legenda || '').trim().split(/\n/)[0].slice(0, 160);
  if (!t) return 'sem_legenda';
  if (/^["“”'‘]/.test(t)) return 'citacao';
  if (/\?/.test(t)) return 'pergunta';
  if (/\d|R\$|%/.test(t)) return 'numero';
  if (/(?<!\p{L})(n[aã]o [eé]|nunca|ningu[eé]m|pare de|para de|errad\p{L}*|mentira|o problema|a verdade)(?!\p{L})/iu.test(t)) return 'contraste';
  if (/(?<!\p{L})(voc[eê]|seu|sua|teu|tua)(?!\p{L})/iu.test(t)) return 'voce';
  return 'afirmacao';
}
const ROTULO_GANCHO = { citacao: 'Citação entre aspas', pergunta: 'Pergunta', numero: 'Número ou valor', contraste: 'Contraste ou negação', voce: 'Fala com "você"', afirmacao: 'Afirmação simples', sem_legenda: 'Sem legenda' };

const medidas = (p) => ({ envios_mil: mil(p.envios, p.alcance), salvos_mil: mil(p.salvos, p.alcance), curtidas_mil: mil(p.curtidas, p.alcance), coment_mil: mil(p.comentarios, p.alcance), seg_mil: mil(p.seguidores, p.alcance), visitas_mil: mil(p.visitas, p.alcance) });
function resumo(ps) {
  const x = ps.filter((p) => p.alcance); const m = x.map(medidas); const seg = x.filter((p) => p.seguidores != null);
  return {
    n: x.length, amostra: x.length >= MIN ? 'suficiente' : 'pequena', alcance: arred(med(x.map((p) => p.alcance)), 0), views: arred(med(x.map((p) => p.views)), 0),
    envios_mil: arred(med(m.map((q) => q.envios_mil))), salvos_mil: arred(med(m.map((q) => q.salvos_mil))), curtidas_mil: arred(med(m.map((q) => q.curtidas_mil))), coment_mil: arred(med(m.map((q) => q.coment_mil)), 2),
    seg_mil: arred(med(m.map((q) => q.seg_mil)), 2), seguidores: seg.length ? seg.reduce((s, p) => s + p.seguidores, 0) : null, n_com_seguidores: seg.length,
  };
}
// Posição (0 a 1) de cada valor dentro da lista: empates ficam no meio.
function posicoes(vals) {
  const ok = vals.map((v, i) => [v, i]).filter(([v]) => v != null && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const out = new Array(vals.length).fill(null); const n = ok.length;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && ok[j + 1][0] === ok[i][0]) j++; const r = n === 1 ? 0.5 : ((i + j) / 2) / (n - 1); for (let k = i; k <= j; k++) out[ok[k][1]] = r; i = j + 1; }
  return out;
}
// Nota de cada post contra TODOS os outros (formato fraco não se salva por ser comparado só com ele mesmo):
// envios por mil 40%, alcance 25%, seguidores por mil 20% (só feed; sem o dado, o peso se reparte), salvos por mil 15%.
function pontuar(maduros) {
  const nota = new Map(); const m = maduros.map(medidas);
  const pe = posicoes(m.map((q) => q.envios_mil)); const pa = posicoes(maduros.map((p) => p.alcance)); const ps = posicoes(m.map((q) => q.seg_mil)); const pv = posicoes(m.map((q) => q.salvos_mil));
  maduros.forEach((p, i) => { const partes = [[pe[i], 0.4], [pa[i], 0.25], [ps[i], 0.2], [pv[i], 0.15]].filter(([v]) => v != null); const w = partes.reduce((x, [, k]) => x + k, 0); nota.set(p.id, w ? partes.reduce((x, [v, k]) => x + v * k, 0) / w : null); });
  return nota;
}
const grupos = (ps, chave) => { const m = new Map(); for (const p of ps) { const k = chave(p); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(p); } return m; };

function janelaConta(w) {
  if (!w?.m) return null;
  const corte = (metrica, por) => (w.m[metrica]?.cortes || []).find((c) => c.por === por)?.itens || null;
  const de = (itens, nome) => (itens || []).find((x) => String(x.valor).toUpperCase() === nome)?.n ?? null;
  const al = corte('reach', 'follow_type'); const vw = corte('views', 'follower_type') || corte('views', 'follow_type'); const fu = corte('follows_and_unfollows', 'follow_type');
  const seg = de(al, 'FOLLOWER'); const nao = de(al, 'NON_FOLLOWER');
  const entrou = de(fu, 'FOLLOWER'); const saiu = de(fu, 'NON_FOLLOWER');
  return {
    de: w.de, ate: w.ate, alcance: w.m.reach?.total ?? null, alcance_seguidores: seg, alcance_nao_seguidores: nao, nao_seguidores_pct: seg != null && nao != null ? pct(nao, seg + nao) : null,
    views_seguidores: de(vw, 'FOLLOWER'), views_nao_seguidores: de(vw, 'NON_FOLLOWER'),
    seguiram: entrou, sairam: saiu, saldo: entrou != null && saiu != null ? entrou - saiu : null,
    interacoes: w.m.total_interactions?.total ?? null, contas_engajadas: w.m.accounts_engaged?.total ?? null,
    por_formato: (w.m.reach_por_formato?.cortes?.[0]?.itens || corte('reach', 'media_product_type') || []).map((x) => ({ formato: x.valor, alcance: x.n })),
  };
}

function analisar({ posts = [], conta = null, agora = Date.now() } = {}) {
  const todos = posts.filter((p) => p && p.em && p.tipo).map((p) => ({ ...p, linha: p.ficha?.tipo || 'fora', gancho: ganchoDe(p.legenda), tema: C.temaDe(p.legenda).id, maduro: (agora - Date.parse(p.em)) / 3600000 >= MADURO_H }))
    .sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
  const maduros = todos.filter((p) => p.maduro && p.alcance);
  const seguidores = conta?.perfil?.followers_count ?? null;
  const geral = resumo(maduros);
  const nota = pontuar(maduros);
  const com = (p) => ({ id: p.id, em: p.em, tipo: p.tipo, linha: p.linha, link: p.link || null, legenda: String(p.legenda || '').replace(/\s+/g, ' ').slice(0, 140), alcance: p.alcance, vezes_mediana: geral.alcance ? arred(p.alcance / geral.alcance, 1) : null, envios_mil: arred(mil(p.envios, p.alcance)), salvos_mil: arred(mil(p.salvos, p.alcance)), seguidores: p.seguidores ?? null, comentarios: p.comentarios ?? null, nota: arred((nota.get(p.id) ?? 0) * 100, 0) });
  const ordenados = maduros.filter((p) => nota.get(p.id) != null).sort((a, b) => nota.get(b.id) - nota.get(a.id));
  const topN = Math.max(1, Math.round(ordenados.length * 0.2));
  const melhores = new Set(ordenados.slice(0, topN).map((p) => p.id));

  const tabela = (chave, rotulo) => [...grupos(maduros, chave).entries()].map(([k, ps]) => {
    const r = resumo(ps); const noTop = ps.filter((p) => melhores.has(p.id)).length;
    return { id: k, nome: rotulo(k), ...r, alcance_x: geral.alcance && r.alcance != null ? arred(r.alcance / geral.alcance, 2) : null, envios_x: geral.envios_mil && r.envios_mil != null ? arred(r.envios_mil / geral.envios_mil, 2) : null,
      participacao_pct: pct(ps.length, maduros.length), entre_os_melhores_pct: pct(noTop, ps.length), n_melhores: noTop };
  }).sort((a, b) => b.n - a.n);
  const formatos = tabela((p) => p.tipo, (k) => ROTULO_FORMATO[k] || k);
  const linhas = tabela((p) => p.linha, rotuloLinha);
  const ganchos = tabela((p) => p.gancho, (k) => ROTULO_GANCHO[k] || k);
  const temas = tabela((p) => p.tema, (k) => (C.TEMAS.find((t) => t.id === k)?.nome || 'Outros / sem tema claro'));

  // Por mês: volume e resultado andam juntos?
  const meses = [...grupos(maduros, (p) => diaSP(p.em).slice(0, 7)).entries()].map(([mes, ps]) => { const dias = new Set(ps.map((p) => diaSP(p.em))).size; return { mes, ...resumo(ps), dias_com_post: dias, posts_por_dia: arred(ps.length / Math.max(1, dias)) }; }).sort((a, b) => a.mes.localeCompare(b.mes));
  // Por dia: quantos posts saíram no mesmo dia × alcance de cada um.
  const porDia = grupos(todos, (p) => diaSP(p.em));
  const faixa = (n) => (n <= 1 ? '1 post no dia' : n <= 3 ? '2 a 3 no dia' : n <= 6 ? '4 a 6 no dia' : '7 ou mais no dia');
  const volume = [...grupos(maduros, (p) => faixa(porDia.get(diaSP(p.em))?.length || 1)).entries()].map(([f, ps]) => ({ faixa: f, ...resumo(ps), dias: new Set(ps.map((p) => diaSP(p.em))).size }))
    .sort((a, b) => ['1 post no dia', '2 a 3 no dia', '4 a 6 no dia', '7 ou mais no dia'].indexOf(a.faixa) - ['1 post no dia', '2 a 3 no dia', '4 a 6 no dia', '7 ou mais no dia'].indexOf(b.faixa));
  const ult14 = todos.filter((p) => agora - Date.parse(p.em) <= 14 * DIA); const ult30 = todos.filter((p) => agora - Date.parse(p.em) <= 30 * DIA);
  const ritmo = { posts_14d: ult14.length, por_dia_14d: arred(ult14.length / 14), max_no_dia_14d: Math.max(0, ...[...grupos(ult14, (p) => diaSP(p.em)).values()].map((x) => x.length)), posts_30d: ult30.length, reels_30d: ult30.filter((p) => p.tipo === 'reel' || p.tipo === 'video').length };

  // Funil do feed (a Meta só informa visitas e seguidores por post de feed).
  const feed = maduros.filter((p) => p.tipo === 'carrossel' || p.tipo === 'imagem'); const comSeg = feed.filter((p) => p.seguidores != null);
  const funil = { posts: feed.length, alcance: soma(feed.map((p) => p.alcance)), visitas: soma(feed.map((p) => p.visitas)), seguidores: soma(comSeg.map((p) => p.seguidores)), sem_seguidor: comSeg.filter((p) => !p.seguidores).length, com_dado: comSeg.length };
  funil.visita_por_mil = arred(mil(funil.visitas, funil.alcance)); funil.seguidor_por_mil = arred(mil(funil.seguidores, funil.alcance), 2); funil.visita_vira_seguidor_pct = pct(funil.seguidores, funil.visitas, 1);
  const porAlc = [...maduros].sort((a, b) => b.alcance - a.alcance); const totAlc = soma(maduros.map((p) => p.alcance));
  const concentracao = { top5_alcance_pct: pct(soma(porAlc.slice(0, 5).map((p) => p.alcance)), totAlc), top5_seguidores_pct: funil.seguidores ? pct(soma([...comSeg].sort((a, b) => b.seguidores - a.seguidores).slice(0, 5).map((p) => p.seguidores)), funil.seguidores) : null };
  const reels = maduros.filter((p) => (p.tipo === 'reel' || p.tipo === 'video') && p.tempo_medio_ms);
  const medW = med(reels.map((p) => p.tempo_medio_ms));
  const pulos = maduros.filter((p) => p.pulou_3s_pct != null).map((p) => p.pulou_3s_pct);
  const retencao = reels.length ? { n: reels.length, tempo_medio_s: arred(medW / 1000), pulou_3s_pct: pulos.length ? arred(med(pulos), 0) : null, n_pulou: pulos.length, alcance_quem_segura_mais: arred(med(reels.filter((p) => p.tempo_medio_ms >= medW).map((p) => p.alcance)), 0), alcance_quem_segura_menos: arred(med(reels.filter((p) => p.tempo_medio_ms < medW).map((p) => p.alcance)), 0) } : null;

  const janelas = (conta?.janelas || []).map(janelaConta).filter(Boolean);
  const serieSeg = (conta?.serie_30d?.follower_count || []).map((x) => x[1]).filter((x) => x != null);
  const demo = (m) => { const d = conta?.demografia?.[m] || {}; return Object.fromEntries(Object.entries(d).map(([k, v]) => { const t = v.reduce((s, x) => s + x.n, 0); return [k, v.slice(0, 5).map((x) => ({ valor: x.valor, pct: pct(x.n, t) }))]; })); };

  // ── Achados (regras; cada um com o número que o sustenta) ──
  const achados = []; const add = (gravidade, titulo, evidencia, fazer, extra = {}) => achados.push({ gravidade, titulo, evidencia, fazer, ...extra });
  const alcPct = seguidores && geral.alcance ? arred((geral.alcance / seguidores) * 100, 1) : null;
  if (!maduros.length) add('info', 'Sem posts maduros para analisar', 'Nenhum post com mais de 72 h e alcance informado pela Meta.', 'Leia de novo em alguns dias.');
  if (alcPct != null && alcPct < 5) add('alta', 'A sua base quase não vê o que você posta', `Alcance mediano de ${geral.alcance.toLocaleString('pt-BR')} por post: ${f(alcPct)}% dos ${f(seguidores)} seguidores (${geral.n} posts).`, 'Seguidor que não reage ensina o Instagram a mostrar menos. Menos posts, cada um feito para o seguidor parar; e vídeo testado primeiro com quem não segue.');
  const j0 = janelas[0];
  if (j0?.nao_seguidores_pct != null && j0.nao_seguidores_pct < 30) add('alta', 'Quase nada chega a quem não te segue', `Nos últimos 30 dias, ${f(j0.nao_seguidores_pct)}% do alcance veio de não seguidores (${(j0.alcance_nao_seguidores || 0).toLocaleString('pt-BR')} de ${((j0.alcance_seguidores || 0) + (j0.alcance_nao_seguidores || 0)).toLocaleString('pt-BR')}).`, 'Sem não seguidor não entra seguidor novo. Confira no Instagram: Configurações → Status da conta → se o conteúdo pode ser recomendado. O que leva a não seguidor é Reel e post que as pessoas enviam.');
  if (j0?.saldo != null && j0.saldo < 0) add('alta', 'Você está perdendo seguidores', `Últimos 30 dias: ${j0.seguiram.toLocaleString('pt-BR')} seguiram e ${j0.sairam.toLocaleString('pt-BR')} saíram (saldo ${j0.saldo.toLocaleString('pt-BR')}).`, 'Quem sai é quem veio por outro tipo de conteúdo. Cada post que o seguidor antigo ignora acelera a saída: publique menos e melhor.');
  else if (j0?.saldo != null && seguidores && j0.saldo < seguidores * 0.002) add('media', 'O perfil está parado', `Últimos 30 dias: ${j0.seguiram.toLocaleString('pt-BR')} seguiram e ${j0.sairam.toLocaleString('pt-BR')} saíram (saldo ${j0.saldo >= 0 ? '+' : ''}${j0.saldo.toLocaleString('pt-BR')}).`, 'Com este saldo o perfil gira, não cresce.');
  const v1 = volume.find((x) => x.faixa === '1 post no dia') || volume.find((x) => x.faixa === '2 a 3 no dia'); const vMuitos = volume.filter((x) => ['4 a 6 no dia', '7 ou mais no dia'].includes(x.faixa) && x.n >= MIN);
  for (const vm of vMuitos) if (v1 && v1.n >= MIN && v1.alcance && vm.alcance && vm.alcance <= v1.alcance * 0.7) add('alta', 'Postar muito no mesmo dia derruba cada post', `Em dias com ${vm.faixa.replace(' no dia', '')} posts, o alcance mediano foi ${vm.alcance.toLocaleString('pt-BR')} (${vm.n} posts); em dias com ${v1.faixa.replace(' no dia', '').replace(' post', '')}, foi ${v1.alcance.toLocaleString('pt-BR')} (${v1.n} posts).`, 'Os posts do mesmo dia disputam o mesmo seguidor. Teto de 1 Reel e 1 carrossel por dia.');
  if (ritmo.por_dia_14d >= 4 && !achados.some((a) => /mesmo dia/.test(a.titulo))) add('media', 'Volume alto de publicação', `${ritmo.posts_14d} posts nos últimos 14 dias (${f(ritmo.por_dia_14d)} por dia; até ${ritmo.max_no_dia_14d} no mesmo dia).`, 'Ainda sem amostra para medir o efeito, mas cada post ignorado pesa contra o próximo. Reduza para no máximo 2 por dia e compare.');
  for (const l of linhas.filter((x) => x.id !== 'fora' && x.n >= MIN)) {
    if (l.envios_x != null && l.alcance_x != null && l.envios_x <= 0.6 && l.alcance_x <= 0.8) add('alta', `A linha "${l.nome}" rende abaixo do resto`, `${l.n} posts: alcance mediano ${(l.alcance || 0).toLocaleString('pt-BR')} (${f(l.alcance_x)}× o perfil) e ${f(l.envios_mil)} envios por mil (${f(l.envios_x)}× o perfil); ${l.n_melhores} entre os melhores.`, 'Pausar esta linha e usar a vaga em vídeo com você.', { linha: l.id, mix: MIX_DA_LINHA[l.id] || null });
    else if (l.entre_os_melhores_pct != null && l.entre_os_melhores_pct >= 35 && l.n_melhores >= 3) add('info', `A linha "${l.nome}" aparece entre os melhores`, `${l.n_melhores} de ${l.n} posts estão entre os 20% melhores do perfil.`, 'Manter e fazer mais do mesmo tipo.', { linha: l.id });
  }
  if (funil.com_dado >= MIN && (funil.seguidor_por_mil ?? 0) < 0.3) add('alta', 'Alcance não vira seguidor', `${funil.sem_seguidor} de ${funil.com_dado} posts de feed não trouxeram nenhum seguidor; no total, ${f(funil.seguidor_por_mil ?? 0)} seguidor por mil alcançados${funil.visita_vira_seguidor_pct != null ? ` e ${f(funil.visita_vira_seguidor_pct)}% das visitas ao perfil viraram seguidor` : ''}.`, 'O post não dá motivo para seguir: falta você, falta série com nome e falta o perfil prometer o que vem depois.');
  const fR = formatos.find((f) => f.id === 'reel'); const fC = formatos.find((f) => f.id === 'carrossel');
  if (ritmo.posts_30d >= 10 && ritmo.reels_30d / ritmo.posts_30d < 0.2) add(fR && fC && fR.n >= MIN && fC.n >= MIN && (fR.envios_mil ?? 0) > (fC.envios_mil ?? 0) ? 'alta' : 'media', 'Quase não tem vídeo', `Só ${ritmo.reels_30d} de ${ritmo.posts_30d} posts dos últimos 30 dias são Reels${fR && fC && fR.n >= MIN && fC.n >= MIN ? `; Reel: ${f(fR.envios_mil)} envios por mil, carrossel: ${f(fC.envios_mil)}` : ''}.`, 'É o Reel que o Instagram entrega para quem não segue, e a sua base veio por vídeo. Pelo menos 1 Reel seu por dia útil.');
  if (geral.n >= MIN && geral.coment_mil != null && geral.coment_mil < 0.5) add('media', 'Ninguém conversa nos posts', `Mediana de ${f(geral.coment_mil)} comentário por mil alcançados.`, 'Post sem opinião não gera resposta. Feche com uma pergunta de escolha (A ou B) e responda os primeiros comentários.');
  if (retencao && retencao.n_pulou >= MIN && retencao.pulou_3s_pct >= 60) add('alta', 'A maioria sai do Reel antes de 3 segundos', `${f(retencao.pulou_3s_pct)}% das visualizações saíram nos 3 primeiros segundos (mediana de ${retencao.n_pulou} Reels).`, 'O problema é a abertura: comece com você falando o assunto e a promessa, com o texto na tela desde o primeiro quadro.');
  if (retencao && retencao.n >= MIN && retencao.tempo_medio_s < 4) add('media', 'Os Reels perdem a pessoa nos primeiros segundos', `Tempo médio assistido: ${f(retencao.tempo_medio_s)} s (mediana de ${retencao.n} Reels).`, 'O primeiro segundo precisa mostrar o assunto e a promessa, com você falando e texto na tela.');
  if (concentracao.top5_alcance_pct != null && maduros.length >= 15 && concentracao.top5_alcance_pct > 60) add('info', 'Poucos posts carregam o perfil', `Os 5 maiores posts somam ${concentracao.top5_alcance_pct}% de todo o alcance de ${maduros.length} posts.`, 'Estude esses 5: tema, abertura e formato. É o que a análise de "melhores" abaixo mostra.');
  const semMetrica = todos.filter((p) => p.maduro && !p.alcance).length;
  if (semMetrica) add('info', 'Posts sem métrica', `${semMetrica} post(s) maduros vieram sem alcance da Meta e ficaram fora das contas (não foram tratados como zero).`, 'Nada a fazer: limite da Meta.');
  const ordem = { alta: 0, media: 1, info: 2 }; achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);

  // O que repetir e o que parar: quem aparece mais (ou nunca) entre os 20% melhores.
  const padroes = { repetir: [], parar: [] };
  for (const [dim, tab] of [['formato', formatos], ['linha', linhas], ['abertura', ganchos], ['tema', temas]]) for (const g of tab) {
    if (g.id === 'outros' || g.id === 'sem_legenda') continue;
    const base = pct(topN, ordenados.length) || 20;
    if (g.n_melhores >= 3 && g.entre_os_melhores_pct >= base * 1.5) padroes.repetir.push({ dimensao: dim, nome: g.nome, texto: `${g.nome}: ${g.n_melhores} de ${g.n} posts entre os melhores (${f(g.entre_os_melhores_pct)}%; o esperado seria ${f(base)}%).` });
    if (g.n >= 6 && g.entre_os_melhores_pct <= base * 0.4) padroes.parar.push({ dimensao: dim, nome: g.nome, texto: `${g.nome}: ${g.n_melhores} de ${g.n} posts entre os melhores (${g.entre_os_melhores_pct}%; o esperado seria ${base}%).` });
  }

  return {
    gerado_em: new Date(agora).toISOString(), seguidores, total_lidos: todos.length, maduros: maduros.length, periodo: todos.length ? { de: todos[todos.length - 1].em, ate: todos[0].em } : null,
    geral: { ...geral, alcance_pct_da_base: alcPct }, ritmo, achados, formatos, linhas, ganchos, temas, meses, volume, funil, concentracao, retencao, padroes,
    melhores: ordenados.slice(0, 12).map(com), piores: ordenados.slice(-12).reverse().map(com), maiores_alcances: porAlc.slice(0, 8).map(com),
    conta: { janelas, seguidores_novos_30d: serieSeg.length ? serieSeg.reduce((a, b) => a + b, 0) : null, erros: conta?.erros || [] },
    demografia: { seguidores: demo('follower_demographics'), engajados: demo('engaged_audience_demographics') },
    regras: { maduro: `${MADURO_H} h`, minimo: MIN, nota: 'Nota do post contra todos os outros: envios por mil 40%, alcance 25%, seguidores por mil 20% (só feed), salvos por mil 15%.', tema: 'Tema e abertura vêm das palavras da legenda: aproximação.' },
  };
}

// Texto compacto para o Pedro copiar e colar numa conversa (sem identificadores de mídia nem links).
function texto(a, posts = [], { completo = true } = {}) {
  const n = (v) => (v == null ? '—' : typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)); const L = [];
  L.push(`RAIO-X @pedro_destrava · gerado ${a.gerado_em.slice(0, 16)} · ${n(a.seguidores)} seguidores · ${a.total_lidos} posts lidos (${a.maduros} com mais de 72 h)${a.periodo ? ` · de ${a.periodo.de.slice(0, 10)} a ${a.periodo.ate.slice(0, 10)}` : ''}`);
  L.push(`GERAL: alcance mediano ${n(a.geral.alcance)} (${n(a.geral.alcance_pct_da_base)}% da base) · envios/mil ${n(a.geral.envios_mil)} · salvos/mil ${n(a.geral.salvos_mil)} · curtidas/mil ${n(a.geral.curtidas_mil)} · coment/mil ${n(a.geral.coment_mil)} · seg/mil ${n(a.geral.seg_mil)}`);
  L.push(`RITMO: ${a.ritmo.posts_14d} posts em 14 dias (${n(a.ritmo.por_dia_14d)}/dia, máx ${a.ritmo.max_no_dia_14d} no dia) · 30 dias: ${a.ritmo.posts_30d} posts, ${a.ritmo.reels_30d} Reels`);
  L.push('ACHADOS:'); for (const x of a.achados) L.push(`- [${x.gravidade}] ${x.titulo}: ${x.evidencia}`);
  const tab = (titulo, linhas) => { if (!linhas.length) return; L.push(`${titulo} (n | alcance | ×perfil | envios/mil | salvos/mil | seg/mil | % entre os melhores):`); for (const g of linhas) L.push(`- ${g.nome}: ${g.n} | ${n(g.alcance)} | ${n(g.alcance_x)} | ${n(g.envios_mil)} | ${n(g.salvos_mil)} | ${n(g.seg_mil)} | ${n(g.entre_os_melhores_pct)}`); };
  tab('LINHAS', a.linhas); tab('FORMATOS', a.formatos); tab('ABERTURAS', a.ganchos); tab('TEMAS', a.temas);
  L.push('VOLUME NO DIA (faixa: n posts | alcance mediano | envios/mil):'); for (const v of a.volume) L.push(`- ${v.faixa}: ${v.n} | ${n(v.alcance)} | ${n(v.envios_mil)}`);
  L.push('MESES (mês: n | posts/dia | alcance | envios/mil | seguidores):'); for (const m of a.meses) L.push(`- ${m.mes}: ${m.n} | ${n(m.posts_por_dia)} | ${n(m.alcance)} | ${n(m.envios_mil)} | ${n(m.seguidores)}`);
  L.push(`FUNIL FEED: ${n(a.funil.posts)} posts · alcance ${n(a.funil.alcance)} · visitas ${n(a.funil.visitas)} · seguidores ${n(a.funil.seguidores)} · ${n(a.funil.sem_seguidor)} de ${n(a.funil.com_dado)} sem seguidor · top5 = ${n(a.concentracao.top5_alcance_pct)}% do alcance`);
  if (a.retencao) L.push(`REELS: saíram em 3 s ${n(a.retencao.pulou_3s_pct)}% (${a.retencao.n_pulou}) · tempo médio ${n(a.retencao.tempo_medio_s)} s (${a.retencao.n}) · alcance de quem segura mais ${n(a.retencao.alcance_quem_segura_mais)} × menos ${n(a.retencao.alcance_quem_segura_menos)}`);
  for (const j of a.conta.janelas) L.push(`CONTA ${j.de} a ${j.ate}: alcance ${n(j.alcance)} · seguidores ${n(j.alcance_seguidores)} × não seguidores ${n(j.alcance_nao_seguidores)} (${n(j.nao_seguidores_pct)}% de fora) · seguiram ${n(j.seguiram)} · saíram ${n(j.sairam)} · saldo ${n(j.saldo)} · por formato ${j.por_formato.map((x) => `${x.formato} ${n(x.alcance)}`).join(', ') || '—'}`);
  if (a.conta.erros?.length) L.push(`CONTA sem dado: ${a.conta.erros.slice(0, 8).join(' | ')}`);
  for (const [k, d] of Object.entries(a.demografia)) { const partes = Object.entries(d).map(([c, v]) => `${c}: ${v.map((x) => `${x.valor} ${x.pct}%`).join(', ')}`); if (partes.length) L.push(`DEMOGRAFIA ${k}: ${partes.join(' · ')}`); }
  if (a.padroes.repetir.length) { L.push('APARECE MAIS ENTRE OS MELHORES:'); a.padroes.repetir.forEach((p) => L.push(`- ${p.texto}`)); }
  if (a.padroes.parar.length) { L.push('QUASE NUNCA ENTRE OS MELHORES:'); a.padroes.parar.forEach((p) => L.push(`- ${p.texto}`)); }
  const linha = (p) => `- ${p.em.slice(0, 10)} ${p.tipo} [${p.linha}] alc ${n(p.alcance)} (${n(p.vezes_mediana)}×) env/mil ${n(p.envios_mil)} salv/mil ${n(p.salvos_mil)} seg ${n(p.seguidores)} com ${n(p.comentarios)} :: ${p.legenda}`;
  L.push('MELHORES:'); a.melhores.forEach((p) => L.push(linha(p))); L.push('PIORES:'); a.piores.forEach((p) => L.push(linha(p)));
  if (completo) {
    L.push('TODOS (data | tipo | linha | alcance | views | curtidas | coment | envios | salvos | seg | visitas | tempo médio s/saíram em 3 s | slides | legenda):');
    for (const p of posts.slice(0, 400)) L.push(`${String(p.em).slice(0, 10)}|${p.tipo}|${p.ficha?.tipo || 'fora'}|${p.alcance ?? ''}|${p.views ?? ''}|${p.curtidas ?? ''}|${p.comentarios ?? ''}|${p.envios ?? ''}|${p.salvos ?? ''}|${p.seguidores ?? ''}|${p.visitas ?? ''}|${p.tempo_medio_ms ? arred(p.tempo_medio_ms / 1000) : ''}${p.pulou_3s_pct != null ? `/${arred(p.pulou_3s_pct, 0)}%` : ''}|${p.slides ?? ''}|${String(p.legenda || '').replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return L.join('\n');
}

module.exports = { analisar, texto, ganchoDe, resumo, pontuar, posicoes, janelaConta, rotuloLinha, MIX_DA_LINHA, MIN };

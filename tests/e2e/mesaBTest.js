// Entrega B no navegador: fluxo link → fatos → briefing → texto → arte → revisão → exportação.
// IA e leitura da matéria são simuladas aqui; arte, regras de revisão, persistência e
// exportação são as reais. Backend em 3990 e staticProxy em 4800.
const { chromium } = require('playwright');
const fs = require('fs'); const { execSync } = require('child_process');
const SP = process.env.SP || require('path').join(__dirname, 'out'); // SP/vendor: react, react-dom, babel (offline)
const BASE = process.env.BASE || 'http://127.0.0.1:4800';
const falhas = [];
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) falhas.push(m); };

const TEXTO = 'O Senado aprovou nesta quinta-feira o projeto que eleva o teto de faturamento anual do microempreendedor individual para R$ 140 mil. O texto segue para sanção presidencial.';
const FONTE = { tipo: 'artigo', url: 'https://jornalx.com.br/mei', url_final: 'https://jornalx.com.br/mei', titulo: 'Senado aprova teto de R$ 140 mil para o MEI', veiculo: 'Jornal X', autores: null, publicada_em: '2026-10-15T15:03:00.000Z', atualizada_em: null, acessada_em: new Date().toISOString(), texto: TEXTO, legivel: true, acesso: 'ok', hash: 'abc', dominio: 'jornalx.com.br', observacoes: [] };
const EV1 = { id: 'e1', via: 'artigo', tipo: 'secundaria', url: FONTE.url, titulo: FONTE.titulo, origem: 'Jornal X', trecho: 'eleva o teto de faturamento anual do microempreendedor individual para R$ 140 mil', publicada_em: FONTE.publicada_em, consultada_em: FONTE.acessada_em, relacao: 'sustenta', grupo: 'g0', fonte_principal: true, limitacoes: 'Fonte única até aqui.' };
const EV2 = { id: 'e2', via: 'artigo', tipo: 'secundaria', url: 'https://outro.com.br/mei', titulo: 'Senado eleva teto do MEI', origem: 'Outro Veículo', trecho: 'teto de R$ 140 mil', publicada_em: FONTE.publicada_em, consultada_em: FONTE.acessada_em, relacao: 'sustenta', grupo: 'g_e2', limitacoes: null };
const CLAIM = { id: 'a1', texto: 'O Senado aprovou o teto de R$ 140 mil para o MEI.', tipo: 'fato', central: true, risco: 'baixo', mutavel: true, valores: [{ valor: 140000, unidade: 'BRL', periodo: '' }], evidencias: ['e1'], estado: 'parcialmente_sustentada', motivo_estado: 'Só uma fonte secundária sustenta.', revisao: {}, origem: 'fonte_principal' };
const BRIEF = { assunto: 'Teto do MEI sobe', acontecimento: 'Senado aprovou novo teto.', por_que_interessa: 'Afeta quem fatura perto do limite.', objetivo: 'autoridade', objetivo_motivo: 'Tema de nicho do perfil.', tese: 'Mais espaço para crescer sem trocar de regime.', tese_tipo: 'opiniao', conflito: null, fatos_disponiveis: ['a1'], duvidas: [], formato: 'carrossel', formato_motivo: 'Há sequência.', estrutura: 'acontecimento', estrutura_motivo: 'Fato novo.', motivo_compartilhar: 'MEIs vão enviar a outros MEIs.', diferenca_recentes: 'Sem posts recentes.', gerado_em: new Date().toISOString(), llm: { provider: 'teste', model: 'falso' } };
const COPIA = { versao: { estrutura: 'acontecimento', capa_escolhida: null, formato: 'carrossel', cta: 'Comente MEI', hashtags: ['#mei'], legenda: 'Segundo o Jornal X, o Senado aprovou o novo teto do MEI.', legenda_claim_ids: ['a1'],
  capas: [{ id: 'k_acontecimento', foco: 'acontecimento', texto: 'Senado aprova teto de **R$ 140 mil** para o MEI', explicacao: 'O fato.', claim_ids: ['a1'] }, { id: 'k_consequencia', foco: 'consequencia', texto: 'Se você é MEI, pode faturar mais sem mudar de regime', explicacao: 'O efeito.', claim_ids: ['a1'] }, { id: 'k_tensao', foco: 'tensao', texto: 'O teto subiu. Mas o que muda de verdade?', explicacao: 'A pergunta.', claim_ids: [] }],
  slides: [{ id: 's1', funcao: 'capa', layout: 'capa_tipografica', texto: 'Senado aprova teto de **R$ 140 mil** para o MEI', claim_ids: ['a1'] }, { id: 's2', funcao: 'prova', layout: 'prova', texto: 'O Senado aprovou o teto de **R$ 140 mil**.', fonte_linha: 'Fonte: Jornal X · consultada em 17/10/2026', claim_ids: ['a1'] }, { id: 's3', funcao: 'explicacao', layout: 'explicacao', texto: 'O texto segue para sanção presidencial.', claim_ids: [] }, { id: 's4', funcao: 'consequencia', layout: 'explicacao', texto: 'Quem estava perto do limite ganha fôlego para crescer.', claim_ids: [] }, { id: 's5', funcao: 'encerramento', layout: 'encerramento', texto: 'Comente MEI', claim_ids: [] }] },
  opinioes: [], problemas_de_forma: [], bloqueios_de_fatos: [], llm: { provider: 'teste', model: 'falso' }, tentativas: 1 };

async function nova(browser, mocks = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.route('**/unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${SP}/vendor/${f}`) }); });
  await p.route('**/fonts.g*/**', (r) => r.abort());
  p.chamadas = {};
  p.mock = mocks;
  await p.route('**/api/content/*', async (r) => {
    const rota = new URL(r.request().url()).pathname.split('/').pop();
    p.chamadas[rota] = (p.chamadas[rota] || 0) + 1;
    const m = p.mock[rota];
    if (!m) return r.continue();
    const x = typeof m === 'function' ? m(p.chamadas[rota], r.request()) : m;
    if (x === 'abort') return r.abort();
    if (x && x.__status) return r.fulfill({ status: x.__status, contentType: 'application/json', body: JSON.stringify(x.body) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  });
  p.erros = []; p.on('pageerror', (e) => p.erros.push(e.message.slice(0, 200)));
  return { ctx, p };
}
const MOCKS = () => ({
  ingest: { fonte: FONTE },
  claims: { claims: [CLAIM], evidencias: [EV1], descartadas: [], llm: { provider: 'teste', model: 'falso' } },
  verify: { claim: { ...CLAIM, evidencias: ['e1', 'e2'], estado: 'sustentada', motivo_estado: 'Sustentada por 2 fontes independentes.' }, evidencias: [EV2], log: ['Outro Veículo: sustenta'], consulta: {}, janela_dias: 10 },
  briefing: { briefing: BRIEF },
  copy: COPIA,
});
const esperaToast = (p, re) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector('.es-toast')?.textContent || ''), re.source, { timeout: 8000 });
const aberto = async (p) => { await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.Mesa?.state.pronto, null, { timeout: 15000 }); };
const conteudo = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.Mesa.state.contents[0])));
const arteOk = (p, n) => p.waitForFunction((n) => { const c = window.Mesa.state.contents[0]; const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa); const feitos = c.arte.renders.filter((r) => r.versao === v.id).length; return feitos >= n && !document.querySelector('.ed-thumb.vazio') && [...document.querySelectorAll('.ed-slide img[data-render]')].filter((i) => i.naturalWidth > 0).length >= n && !document.querySelector('.es-spin'); }, n, { timeout: 25000 });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  let { ctx, p } = await nova(browser, MOCKS());
  await aberto(p);

  console.log('1. Do link ao briefing');
  await p.click('[data-e="link"]');
  await p.fill('#ed-novo-url', 'ftp://x');
  await p.click('[data-action="ed-iniciar"]');
  ok(/http/.test(await p.textContent('.es-toast')), 'link inválido recusado antes de chamar o servidor');
  await p.fill('#ed-novo-url', 'https://jornalx.com.br/mei');
  await p.click('[data-action="ed-iniciar"]');
  await p.waitForSelector('[data-ed-brief="tese"]', { timeout: 15000 });
  let c = await conteudo(p);
  ok(['leitura', 'afirmacoes', 'pesquisa', 'briefing'].every((e) => c.pipeline[e].estado === 'concluida'), 'quatro etapas concluídas e gravadas');
  ok(c.claims[0].estado === 'sustentada' && c.evidencias.length === 2, 'afirmação passou a sustentada com 2 fontes independentes');
  ok(c.conta.ig_id === '74541076144' && c.conta.username === 'pedro_destrava', 'conteúdo ligado à conta correta');
  ok(await p.locator('text=Sustentada').count() > 0, 'estado da afirmação visível');
  ok(await p.locator('text=abrir fonte').count() >= 0, 'fonte abre em link');
  const cl = await p.textContent('.ed-claim');
  ok(/a matéria que você trouxe/.test(cl), 'a matéria de origem aparece marcada como tal');
  ok(/1\. Trecho: encontrado no documento/.test(cl) && /2\. Correspondência:/.test(cl) && /3\. Qualidade:/.test(cl), 'trecho, correspondência e qualidade aparecem separados');
  await p.screenshot({ path: `${SP}/b_1_briefing.png`, fullPage: false });

  console.log('2. Texto e arte');
  await p.click('[data-action="ed-gerar-texto"]');
  await p.waitForSelector('.ed-slide', { timeout: 15000 });
  await arteOk(p, 5);
  c = await conteudo(p);
  ok(c.copia.versoes.length === 1 && c.arte.renders.length === 5, 'versão v1 e 5 artes registradas');
  ok(c.copia.versoes[0].capa_escolhida === null, 'a capa NÃO vem escolhida: três opções para o Pedro');
  ok(await p.locator('input[data-ed-capa]').count() === 3, 'três capas oferecidas');
  const txt = await p.textContent('.es-card:has(.ed-bloq)');
  ok(/Escolha uma das capas/.test(txt), 'sem capa escolhida há bloqueio');
  ok(await p.locator('[data-action="ed-aprovar"]').isDisabled(), 'aprovar fica desabilitado enquanto há bloqueio');
  await p.screenshot({ path: `${SP}/b_2_texto.png`, fullPage: true });

  console.log('3. Edições localizadas');
  await p.check('input[data-ed-capa="k_consequencia"]');
  await esperaToast(p, /Salvo/);
  await arteOk(p, 5);
  c = await conteudo(p);
  ok(c.copia.versoes.length === 2 && /mudar de regime/.test(c.copia.versoes[1].slides[0].texto), 'capa escolhida cria v2 sem apagar v1');
  const renderS3 = c.arte.renders.filter((r) => r.versao === 'v2' && r.slide_id === 's3')[0];
  const renderS3v1 = c.arte.renders.filter((r) => r.versao === 'v1' && r.slide_id === 's3')[0];
  ok(renderS3 && renderS3.blob_key === renderS3v1.blob_key, 'slides que não mudaram reaproveitam a arte (só a capa foi redesenhada)');

  // número inventado
  await p.fill('[data-ed-texto="s2"]', 'O Senado aprovou o teto de **R$ 180 mil**.');
  await p.locator('[data-ed-texto="s2"]').blur();
  await esperaToast(p, /Salvo|conferência/);
  await arteOk(p, 5);
  let bl = await p.textContent('.es-card:has(.ed-bloq)');
  ok(/Número que as fontes não trazem/.test(bl) && /180/.test(bl), 'número editado à mão que a fonte não traz vira bloqueio');
  c = await conteudo(p);
  ok(c.claims[0].revisao.reaberta_em, 'edição de número reabre a conferência da afirmação');
  ok(await p.locator('[data-action="ed-aprovar"]').isDisabled(), 'não dá para aprovar com número inventado');
  await p.click('[data-action="ed-desfazer"]');
  await esperaToast(p, /anterior/);
  bl = await p.textContent('.es-card:has([data-action="ed-aprovar"])');
  ok(!/180/.test(bl), 'desfazer volta ao estado anterior');

  // texto longo demais
  await p.fill('[data-ed-texto="s3"]', 'palavra '.repeat(200));
  await p.locator('[data-ed-texto="s3"]').blur();
  await esperaToast(p, /Salvo|conferência/);
  await arteOk(p, 5);
  bl = await p.textContent('.es-card:has([data-action="ed-aprovar"])');
  ok(/Texto não cabe na arte/.test(bl), 'texto que não cabe é apontado, não espremido');
  await p.click('[data-action="ed-desfazer"]');
  await esperaToast(p, /anterior/);

  // frase editada
  await p.fill('[data-ed-texto="s4"]', 'Quem estava no limite do teto agora tem **espaço** para crescer.');
  await p.locator('[data-ed-texto="s4"]').blur();
  await esperaToast(p, /Salvo/);
  await arteOk(p, 5);
  c = await conteudo(p);
  const v = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa);
  ok(c.arte.renders.filter((r) => r.versao === v.id).length === 5, 'todas as artes pertencem à versão ativa');

  // bloqueio de slide
  await p.click('[data-action="ed-bloquear"][data-id="s3"]');
  await p.waitForSelector('[data-ed-texto="s3"][disabled]'); ok(true, 'slide bloqueado não pode ser editado');

  // reordenar
  await p.click('[data-action="ed-mover"][data-id="s4"][data-d="-1"]');
  await esperaToast(p, /Salvo/);
  await arteOk(p, 5);
  c = await conteudo(p);
  const ids = c.copia.versoes.find((x) => x.id === c.copia.versao_ativa).slides.map((s) => s.id);
  ok(ids.join() === 's1,s2,s4,s3,s5', `slides reordenados (${ids.join()}); capa e encerramento ficam nas pontas`);

  console.log('4. Aprovação e exportação');
  ok(await p.locator('[data-action="ed-exportar"]').count() === 0, 'sem aprovação não existe botão de exportar');
  ok(!(await p.locator('[data-action="ed-aprovar"]').isDisabled()), 'sem bloqueios, aprovar fica liberado');
  await p.click('[data-action="ed-aprovar"]');
  await p.waitForSelector('[data-action="ed-exportar"]');
  c = await conteudo(p);
  ok(c.status === 'aprovado' && c.revisao.aprovada_versao === c.copia.versao_ativa, 'aprovação grava versão e hash');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-action="ed-exportar"]')]);
  const zipPath = `${SP}/b_export.zip`; await dl.saveAs(zipPath);
  const lista = execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile('${zipPath}');print(z.testzip());print(','.join(z.namelist()))"`).toString().trim().split('\n');
  ok(lista[0] === 'None', 'ZIP íntegro');
  ok(lista[1] === 'slide-01.png,slide-02.png,slide-03.png,slide-04.png,slide-05.png,legenda.txt,fontes.txt,versao.json', `conteúdo do ZIP: ${lista[1]}`);
  const meta = JSON.parse(execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('${zipPath}').read('versao.json').decode())"`).toString());
  ok(meta.hash_versao === c.revisao.hash_aprovado && meta.arquivos.length === 5 && meta.conta === '@pedro_destrava', 'versao.json tem o hash da versão aprovada e a conta');
  const fontes = execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('${zipPath}').read('fontes.txt').decode())"`).toString();
  ok(/Outro Veículo/.test(fontes) && /https:\/\/outro.com.br\/mei/.test(fontes) && /Consultada/.test(fontes), 'ficha de fontes lista origem, URL e data da consulta');
  const png = execSync(`python3 -c "import zipfile,struct;d=zipfile.ZipFile('${zipPath}').read('slide-01.png');print(struct.unpack('>II',d[16:24]))"`).toString().trim();
  ok(png === '(1080, 1350)', `PNG exportado tem 1080×1350 (${png})`);
  c = await conteudo(p);
  ok(c.status === 'exportado' && c.exportacoes.length === 1, 'exportação registrada');
  ok(!/selo|verificad/i.test(fontes), 'sem selo de verificação');

  console.log('5. Edição depois da aprovação');
  await p.fill('[data-ed-legenda="legenda"]', 'Segundo o Jornal X, o Senado aprovou o teto do MEI. Edição tardia.');
  await p.locator('[data-ed-legenda="legenda"]').blur();
  await esperaToast(p, /Salvo/);
  c = await conteudo(p);
  ok(c.revisao.aprovada_versao === null && c.status === 'em_revisao', 'editar depois de aprovar reabre a aprovação');
  ok(await p.locator('[data-action="ed-exportar"]').count() === 0, 'não dá para exportar a versão nova sem aprovar de novo');
  await p.click('summary:has-text("Versões")');
  await p.click('[data-action="ed-ativar"][data-v="' + c.exportacoes[0].versao + '"]');
  await esperaToast(p, /Voltou/);
  c = await conteudo(p);
  ok(c.revisao.aprovada_versao === null, 'voltar a uma versão antiga também não restaura a aprovação sozinho');

  console.log('6. Persistência');
  const chamadasAntes = p.chamadas['render-slide'];
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.Mesa?.state.pronto);
  const antes = c.copia.versoes.length;
  c = await conteudo(p);
  ok(c.copia.versoes.length === antes && c.exportacoes.length === 1, 'depois de recarregar, versões e exportação continuam');
  await p.click(`[data-action="abrir"][data-id="${c.id}"]`);
  await arteOk(p, 5);
  ok(p.chamadas['render-slide'] === chamadasAntes, `artes reabrem do armazenamento local, sem pedir ao servidor de novo (${chamadasAntes} → ${p.chamadas['render-slide']})`);
  ok(p.erros.length === 0, `sem erros de JavaScript (${p.erros.join(' | ')})`);
  await ctx.close();

  console.log('7. Falhas reais e retomada');
  const m = MOCKS(); let tent = 0;
  m.claims = () => (++tent === 1 ? 'abort' : { claims: [CLAIM], evidencias: [EV1], descartadas: [], llm: {} });
  ({ ctx, p } = await nova(browser, m));
  await aberto(p);
  await p.click('[data-e="link"]'); await p.fill('#ed-novo-url', 'https://jornalx.com.br/mei'); await p.click('[data-action="ed-iniciar"]');
  await p.waitForSelector('[data-action="ed-continuar"]', { timeout: 10000 });
  c = await conteudo(p);
  ok(c.pipeline.afirmacoes.estado === 'erro' && c.pipeline.leitura.estado === 'concluida', 'queda de conexão na etapa 2: etapa 1 continua salva, erro mostrado');
  ok(/não terminou/.test(await p.textContent('.es-errbox')), 'erro aparece para o Pedro (não fica silencioso)');
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForFunction(() => window.Mesa?.state.pronto);
  await p.click('[data-action="abrir"]');
  await p.click('[data-action="ed-continuar"]');
  await p.waitForSelector('[data-ed-brief="tese"]', { timeout: 15000 });
  c = await conteudo(p);
  ok(c.pipeline.afirmacoes.estado === 'concluida' && p.chamadas.ingest === 1, `retomou de onde parou sem reler a fonte (ingest chamado ${p.chamadas.ingest}x)`);
  await ctx.close();

  const m2 = MOCKS(); m2.copy = { __status: 502, body: { error: 'Provedor de IA indisponível (timeout)', code: 'ERRO' } };
  ({ ctx, p } = await nova(browser, m2));
  await aberto(p);
  await p.click('[data-e="link"]'); await p.fill('#ed-novo-url', 'https://jornalx.com.br/mei'); await p.click('[data-action="ed-iniciar"]');
  await p.waitForSelector('[data-action="ed-gerar-texto"]', { timeout: 15000 });
  await p.click('[data-action="ed-gerar-texto"]');
  await p.waitForSelector('.es-errbox', { timeout: 10000 });
  ok(/timeout/.test(await p.textContent('.es-errbox')), 'falha do provedor de IA é mostrada com a causa');
  c = await conteudo(p);
  ok(c.copia.versoes.length === 0 && c.briefing, 'a falha não apaga o briefing nem inventa texto');
  await ctx.close();

  const m3 = MOCKS(); m3.ingest = { fonte: { ...FONTE, legivel: false, acesso: 'negado', texto: '', observacoes: ['O site recusou a leitura (HTTP 403). Não contorno bloqueio nem login: cole o texto ou envie um print.'] } };
  ({ ctx, p } = await nova(browser, m3));
  await aberto(p);
  await p.click('[data-e="link"]'); await p.fill('#ed-novo-url', 'https://g1.globo.com/x'); await p.click('[data-action="ed-iniciar"]');
  await p.waitForSelector('#ed-colar', { timeout: 10000 });
  ok(/403/.test(await p.textContent('.es-errbox')) && !p.chamadas.claims, 'site que bloqueia: avisa, oferece colar o texto e NÃO inventa afirmações');
  await ctx.close();


  console.log('8. Afirmações só em parte sustentadas');
  const m4 = MOCKS(); m4.verify = { claim: CLAIM, evidencias: [], log: ['sem outras fontes'], consulta: {}, janela_dias: 10 };
  ({ ctx, p } = await nova(browser, m4));
  await aberto(p);
  await p.click('[data-e="link"]'); await p.fill('#ed-novo-url', 'https://jornalx.com.br/mei'); await p.click('[data-action="ed-iniciar"]');
  await p.waitForSelector('[data-action="ed-gerar-texto"]', { timeout: 15000 });
  await p.click('[data-action="ed-gerar-texto"]');
  await p.waitForSelector('.ed-slide', { timeout: 15000 }); await arteOk(p, 5);
  await p.check('input[data-ed-capa="k_acontecimento"]'); await arteOk(p, 5);
  let bq = await p.textContent('.es-card:has([data-action="ed-aprovar"])');
  ok(/Afirmação central só em parte sustentada/.test(bq), 'afirmação central só em parte sustentada bloqueia');
  ok(await p.locator('[data-action="ed-aprovar"]').isDisabled(), 'e não dá para aprovar');
  ok(await p.locator('[data-action="ed-ressalva-todas"], [data-action="ed-ressalva"]').count() === 0, 'não existe mais "aceitar com ressalva" genérico');
  await p.click('[data-action="ed-decidir"][data-id="a1"][data-tipo="atribuir"]');
  await p.fill('#ed-dec-valor', 'segundo o Jornal X');
  await p.click('[data-action="ed-decidir-ok"][data-id="a1"]');
  await p.waitForFunction(() => /Falta a atribuição/.test(document.body.textContent));
  bq = await p.textContent('.es-card:has([data-action="ed-aprovar"])');
  ok(!/só em parte sustentada/.test(bq) && /Falta a atribuição ou condição/.test(bq), 'decidir "atribuir" troca o bloqueio: agora a frase precisa estar no texto');
  ok(await p.locator('[data-action="ed-aprovar"]').isDisabled(), 'sem a frase no texto, continua sem aprovar');
  for (const [sel, txt] of [['[data-ed-texto="s1"]', 'Segundo o Jornal X, o Senado aprovou teto de **R$ 140 mil** para o MEI'], ['[data-ed-texto="s2"]', 'Segundo o Jornal X, o Senado aprovou o teto de **R$ 140 mil**.'], ['[data-ed-legenda="legenda"]', 'Segundo o Jornal X, o Senado aprovou o novo teto do MEI.']]) {
    await p.fill(sel, txt); await p.locator(sel).blur(); await esperaToast(p, /Salvo|conferência/); await arteOk(p, 5);
  }
  ok(!(await p.locator('[data-action="ed-aprovar"]').isDisabled()), 'com a atribuição no texto, a aprovação libera');
  c = await conteudo(p);
  ok(c.historico.some((h) => h.tipo === 'decisao' && /segundo o Jornal X/.test(h.resumo)), 'a decisão fica no histórico');
  ok(c.consumo && c.consumo.length >= 5 && c.consumo.every((x) => x.etapa && Number.isFinite(x.duracao_ms)), `consumo registrado por etapa (${(c.consumo || []).map((x) => x.etapa).join(',')})`);
  await ctx.close();

  await browser.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n- ${falhas.join('\n- ')}` : '\nTudo certo.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });

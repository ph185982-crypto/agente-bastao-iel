// Testes da leitura de print — rode com: node --test backend/lib/lerPrint.test.js
// As fixtures reproduzem o que a OCR devolve para prints reais de post do
// Instagram (relógio, marca d'água, linha do perfil, legenda, caixa de comentário).
// Só a separação é testada aqui: ela é função pura, não precisa de imagem nem de rede.
const test = require('node:test');
const assert = require('node:assert');
const {
  separarTextoDoPrint, montarCopyDoPrint, ehChrome, cortarFraseIncompleta, limparMencoes,
} = require('./lerPrint');

const HANDLE = '@pedro_destrava';

// Print 1: gancho dentro do card branco, música no rodapé do perfil.
const PRINT_COMBUSTIVEL = `22:37
@fatosInesperados
Abastecer de noite ou de dia?
A física explica:

fatosInesperados
♫ Felipe & Ferrari, DIEGO & ,
Seguir

A diferença entre abastecer de dia ou à noite está
ligada a um conceito da física chamado dilatação
térmica. Esse fenômeno descreve como os materiais se
expandem quando a temperatura aumenta e se
contraem quando a temperatura diminui.

No caso dos combustíveis, como gasolina ou etanol, isso
significa que o volume deles pode variar de acordo com o
calor do ambiente.

Deixe um comentário para f...
GIF`;

// Print 2: gancho fora do card (texto claro sobre fundo escuro), sem música.
const PRINT_PLATAFORMA = `22:37
A engenharia que neutraliza o
movimento do oceano e parece
desafiar a física.

fisicarevelada
Seguir

Trabalhar em alto-mar significa lidar constantemente
com o movimento provocado pelas ondas. Mesmo em
condições aparentemente calmas, plataformas e
embarcações estão sujeitas a oscilações contínuas.

Esses equipamentos utilizam sensores de alta precisão
para monitorar, em tempo real, os deslocamentos da
estrutura.

O que você acha disso?
GIF`;

// Print 3: a legenda original começa pedindo pra seguir o perfil do autor.
const PRINT_FORMULA1 = `22:37
Este cara aperta o botão que inicia as
corridas de Fórmula 1.

Salário médio: US$ 300.000 por ano.

mundo_desvendadoo
Seguir

Siga @mundo_desvendadoo para descobrir algo novo
todos os dias!

Em uma corrida da Formula 1, o momento da largada é
um dos mais tensos de todo o evento. Vinte carros
alinhados, motores rugindo e milhões de espectadores
esperando pelo início da disputa.

Participe da conversa...
GIF`;

// Print 4: legenda cortada no meio da frase pela borda da tela, com data no fim.
const PRINT_AGUIA = `22:37
Durante um jogo de futebol americano, uma
águia acabou pousando justamente sobre
o único indígena presente no meio da multidão.

espetacular
Seguir

Durante o Cotton Bowl de 2018, nos Estados Unidos,
um momento inesperado acabou chamando mais
atenção do que o próprio jogo.

Enquanto o hino nacional era executado no estádio,
uma águia-careca chamada Clark sobrevoava a
multidão como parte da cerimônia. Em determinado
momento, ela pousou rapidamente em alguns
torcedores da arquibancada e o público

16 de maio
Deixe um comentário...`;

test('ehChrome reconhece o que é interface e não conteúdo', () => {
  for (const lixo of ['22:37', 'Seguir', 'GIF', 'Deixe um comentário...', '16 de maio', '♫ Felipe & Ferrari']) {
    assert.ok(ehChrome(lixo), `deixou passar: "${lixo}"`);
  }
  for (const bom of ['A física explica:', 'Abastecer de noite ou de dia?', 'Trabalhar em alto-mar significa']) {
    assert.ok(!ehChrome(bom), `descartou conteúdo: "${bom}"`);
  }
});

test('print 1: separa o gancho do card e a legenda do post', () => {
  const r = separarTextoDoPrint(PRINT_COMBUSTIVEL, { handle: HANDLE });
  assert.strictEqual(r.headline, 'Abastecer de noite ou de dia? A física explica:');
  assert.ok(r.caption.startsWith('A diferença entre abastecer de dia'), `legenda: ${r.caption}`);
  assert.ok(r.caption.includes('No caso dos combustíveis'), 'perdeu o segundo parágrafo');
  assert.ok(!/22:37|Seguir|GIF|Deixe um coment|Felipe & Ferrari/.test(r.caption), 'interface vazou pra legenda');
  assert.ok(!/fatosInesperados/.test(r.headline), 'a marca d\'água virou gancho');
});

test('print 1: a legenda mantém os parágrafos, não vira uma linha só', () => {
  const r = separarTextoDoPrint(PRINT_COMBUSTIVEL, { handle: HANDLE });
  assert.ok(r.caption.includes('\n\n'), 'os parágrafos foram achatados');
  // as linhas quebradas pela tela precisam voltar a ser frase corrida
  assert.ok(r.caption.includes('está ligada a um conceito'), 'a quebra de linha da tela virou quebra de frase');
});

test('print 2: gancho fora do card branco também é lido', () => {
  const r = separarTextoDoPrint(PRINT_PLATAFORMA, { handle: HANDLE });
  assert.strictEqual(r.headline, 'A engenharia que neutraliza o movimento do oceano e parece desafiar a física.');
  assert.ok(r.caption.startsWith('Trabalhar em alto-mar'), `legenda: ${r.caption}`);
  assert.ok(!/fisicarevelada/.test(r.caption), 'nome do perfil vazou pra legenda');
});

test('print 3: tira o pedido de seguir o perfil original', () => {
  const r = separarTextoDoPrint(PRINT_FORMULA1, { handle: HANDLE });
  assert.ok(!/mundo_desvendadoo/.test(r.caption), 'ficou divulgando o perfil de origem');
  assert.ok(!/^Siga/m.test(r.caption), 'sobrou a chamada "Siga @..."');
  assert.ok(r.caption.includes('Em uma corrida da Formula 1'), 'perdeu o corpo da legenda');
  assert.ok(r.headline.includes('Fórmula 1'), `gancho: ${r.headline}`);
  assert.ok(r.headline.includes('300.000'), 'perdeu a segunda linha do gancho');
});

test('print 4: corta a frase que o print deixou pela metade', () => {
  const r = separarTextoDoPrint(PRINT_AGUIA, { handle: HANDLE });
  assert.ok(!/e o público$/.test(r.caption), `terminou no meio: ...${r.caption.slice(-60)}`);
  assert.ok(/[.!?]$/.test(r.caption), 'legenda não termina em pontuação');
  assert.ok(r.caption.includes('Cotton Bowl de 2018'), 'perdeu o começo da legenda');
  assert.ok(!/16 de maio/.test(r.caption), 'a data entrou na legenda');
});

test('cortarFraseIncompleta não mexe em texto que já termina certo', () => {
  assert.strictEqual(cortarFraseIncompleta('Frase completa.'), 'Frase completa.');
  assert.strictEqual(cortarFraseIncompleta('Pergunta?'), 'Pergunta?');
  // curto demais para cortar com segurança: devolve como está
  assert.strictEqual(cortarFraseIncompleta('Texto curto sem fim'), 'Texto curto sem fim');
});

test('limparMencoes preserva o handle de quem vai publicar', () => {
  const t = limparMencoes('Segue @pedro_destrava e olha o @outro_perfil ali', HANDLE);
  assert.ok(t.includes('@pedro_destrava'), 'apagou o handle do próprio usuário');
  assert.ok(!t.includes('@outro_perfil'), 'manteve a menção ao perfil alheio');
});

test('a copy final usa a legenda lida e troca o CTA pelo seu perfil', () => {
  const lido = separarTextoDoPrint(PRINT_COMBUSTIVEL, { handle: HANDLE });
  const copy = montarCopyDoPrint({ ...lido, handle: HANDLE, variante: 2 });

  assert.strictEqual(copy.fonte, 'print');
  assert.ok(copy.caption.includes('A diferença entre abastecer'), 'não aproveitou o texto lido');
  assert.ok(copy.caption.includes(HANDLE), 'não colocou o CTA com o seu perfil');
  assert.ok(/#\w+/.test(copy.caption), 'não colocou hashtags');
  assert.strictEqual(copy.headline, 'Abastecer de noite ou de dia? A física explica:');
});

test('sem legenda legível no print, o robô escreve uma inteira', () => {
  const copy = montarCopyDoPrint({ headline: 'A verdade sobre vender mais', caption: '', handle: HANDLE, variante: 1 });
  assert.strictEqual(copy.fonte, 'robo');
  assert.ok(copy.caption.trim(), 'legenda vazia');
  assert.ok(copy.caption.includes(HANDLE), 'legenda sem o handle');
  assert.strictEqual(copy.headline, 'A verdade sobre vender mais');
});

test('print ilegível não quebra a separação', () => {
  for (const entrada of ['', '   ', '22:37\nSeguir\nGIF', '!!!\n???']) {
    const r = separarTextoDoPrint(entrada, { handle: HANDLE });
    assert.strictEqual(typeof r.headline, 'string');
    assert.strictEqual(typeof r.caption, 'string');
    assert.ok(r.capturou.gancho === false || r.headline.length > 0);
  }
});

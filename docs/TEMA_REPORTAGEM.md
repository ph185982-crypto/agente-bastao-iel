# Visual "Reportagem" dos carrosséis

Linguagem das peças de cobrança de dados (referência aprovada pelo Pedro): marinho, amarelo, vermelho e creme; letra condensada
pesada (Anton); rosto recortado em preto e branco sobre uma forma de apoio; comparação "antes → depois" com cor que significa algo.
Escolha em **Perfil → Visual dos carrosséis** (`Reportagem` é o padrão; `Avanteza` mantém a identidade azul e laranja).

## Quem faz o quê
| Parte | Quem faz | Regra |
|---|---|---|
| Texto, números, fonte, cores, layout | **código** (`arteReportagem.js`) | medido pela fonte real; não cabe no mínimo = bloqueia |
| Rosto | **recorte do Pedro** (Perfil → Recortes) | nunca gerado nem alterado; só preto e branco com contraste |
| Formas (pincelada, seta, círculo, degrau) e grão | **código** | sempre disponíveis |
| Textura de fundo | IA (opcional, **desligada**) | só textura, sem letra/número/rosto; confere por OCR; ver `IMAGENS_OPENAI.md` |

## Layouts
`rep_capa` (rosto grande + título), `rep_comparacao` (dois valores com etiqueta de período, seta e faixa de resultado),
`rep_numero` (número gigante + frase), `rep_manchete` (título, parágrafo, destaque amarelo e faixa final).
O encerramento aprovado (arquivo original) continua entrando sem ser reconstruído.

## Honestidade dos números
- Os números dos slides de dados (`dados.esquerda`, `dados.direita`, `dados.faixa`, `dados.numero`) passam pelos **mesmos bloqueios** do texto:
  `numero_sem_origem` se não constam nas afirmações com fonte. A variação percentual da faixa vale se for **exatamente a calculada** entre os dois
  valores (tolerância de 0,15 ponto, pelo arredondamento) ou se estiver numa afirmação com cálculo.
- Prova, comparação e número **sem linha de fonte** bloqueiam a arte.
- Cor com significado é decisão editorial explícita: `dados.tom = "alerta"` pinta o lado novo de vermelho; sem isso é neutro (marinho e amarelo).
  O redator só deve usar "alerta" quando as fontes mostram piora.

## Recortes
- PNG ou WebP **com fundo transparente**, até ~3 MB (limite da plataforma para o envio), lado maior de pelo menos 600 px.
- Obrigatórios: nome (como aparece nas pautas), crédito do fotógrafo e licença. Sem eles o recorte não entra.
- O app escolhe o recorte pelo **nome inteiro** citado no título ou nas afirmações (sem acento, em palavras completas). Vários recortes da mesma
  pessoa giram entre os slides. Sem recorte para a pessoa, a arte sai só com a forma de apoio e a revisão mostra o aviso.
- Créditos aparecem em "Ver legenda e detalhes" no cartão de revisão; quando a licença exige, **cite o crédito na legenda** (o app não altera a legenda aprovada).
- Precisa do banco de dados no servidor. Remover tira o recorte do uso (o arquivo fica guardado, mas nunca mais é escolhido).

## Fonte e licença
Anton (SIL Open Font License 1.1) em `backend/assets/Anton-Regular.ttf`; texto da licença em `Anton-OFL.txt`.

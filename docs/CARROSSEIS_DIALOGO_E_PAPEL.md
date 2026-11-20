# Carrosséis "Diálogo ilustrado" e "Papel de parede" (topo de funil)

Dois formatos para a audiência geral (passo 1 do posicionamento: "a estratégia escondida por trás" do dia a dia).
O mecanismo vem de carrosséis de imagem que funcionaram muito bem em outros perfis; **a arte e o texto são sempre do
Pedro** (nada de copiar ilustração nem frase de ninguém). Os dois aparecem em **Carrosséis para validar** como qualquer
outro carrossel e, aprovados, publicam pelo fluxo de sempre (o publicador redesenha cada tela da versão aprovada em
JPEG 1080×1350).

Não passam pela pesquisa de fatos do padrão Minimalista (`docs/PADRAO-MINIMALISTA.md`): são frases de opinião/observação,
sem número de fonte. Se uma fala trouxer número que exige origem (dinheiro, %, ano, quantidade ≥ 13), a revisão bloqueia
como sempre (`numero_sem_afirmacao`).

## 1. Diálogo ilustrado (`tema_visual: 'dialogo'`)

UMA cena repetida em todas as telas; só os balões mudam. O personagem A diz o pensamento padrão, o B mostra a estratégia.
Última tela: fechamento + chamada "Comenta PALAVRA".

| Parte | Quem faz |
|---|---|
| Cena | ilustração por IA (se ligada) · imagem enviada (`cena.imagem`) · ou cena simples desenhada pelo código |
| Balões, texto, rótulos ("QUEM COMPRA"), assinatura `@pedro_destrava` | **sempre o código** (`backend/lib/arteDialogo.js`) — o modelo de imagem nunca escreve |
| Cauda do balão | aponta para a cabeça de cada personagem (`ancoras`, em % da tela; padrão A x28 y68, B x72 y68) |

- 4:5 (1080×1350), margem segura de 72 px, fala de 62 px até o mínimo de 40 px. Se não couber no mínimo, a arte sai
  `cabe:false` e a revisão bloqueia (`texto_cortado`): encurte a fala (limite de entrada: 140 caracteres).
- No conteúdo, cada tela guarda `texto = "fala do A\nfala do B"` (editável como qualquer texto) e
  `dados = { personagens, ancoras, paleta }`. O fechamento usa `layout: 'dialogo_fecho'`.
- Palavra-chave: se ela for de uma isca de **Porta de entrada** com link (`leadMagnets.js`), a chamada vem da isca;
  se o texto já pede "Comenta PALAVRA", nada é acrescentado. **A DM automática por palavra-chave não existe**: quem
  comentar recebe a resposta à mão (fica registrado em `c.dialogo.palavra_chave.dm_automatica = false`).

### Ligar a ilustração por IA (OpenAI)

Desligada por padrão: **cada imagem gasta crédito**. Usa as mesmas variáveis e os mesmos tetos do fundo por IA
(`docs/IMAGENS_OPENAI.md`):

| Variável | Para quê |
|---|---|
| `IMAGEM_OPENAI_LIGADA=1` | liga a geração |
| `OPENAI_API_KEY` | chave (Sensitive, só no servidor) |
| `OPENAI_IMAGE_MODEL` | padrão `gpt-image-1.5` |
| `IMAGEM_TETO_CARROSSEL_USD` / `IMAGEM_TETO_MES_USD` | tetos (padrão 2,00 e 10,00) |

- Uma imagem por carrossel, 1024×1536 em qualidade `medium` (≈ US$ 0,05 no `gpt-image-1.5`; até 2 tentativas ≈ US$ 0,10),
  recortada para 4:5 e guardada (`img:cena_<id>`); todas as telas usam a mesma.
- Prompt (`cenaIA.montarPromptCena`): ilustração editorial pintada (romance gráfico), dois personagens genéricos de costas
  ou à distância no terço de baixo, terço de cima calmo para os balões; regras por último: SEM texto, letras, números,
  placas, logotipos, marcas, pessoa real ou rosto reconhecível, e sem imitar artista específico.
- Conferência: a imagem passa por OCR (`ocrConferencia`); com letra ou número é descartada, há **uma** nova tentativa
  (só se a 1ª levou menos de 25 s, por causa do limite de 60 s da função na Vercel) e depois cai para a cena do código.
  Recusa, teto ou falha também caem para a cena do código, com aviso — a criação nunca falha por causa da imagem.
- A imagem fica registrada em `c.imagens` como `ilustracao_ia` ("ilustra a ideia, não é registro real").

## 2. Papel de parede (`tema_visual: 'papel_de_parede'`)

Capa + uma frase curta por tela sobre foto, com véu escuro, letra grande e assinatura pequena. A frase fica abaixo da
faixa do relógio da tela de bloqueio (de 34% a 84% da altura).

- Capa: a foto do Pedro (rodízio de **Perfil → Minhas histórias e casos**, `fotosPedro.js`) quando houver; senão, capa
  tipográfica. `foto_pedro: false` força a tipográfica.
- Fundo: `"pexels:assunto"` (padrão `pexels:calm nature landscape`; uma foto diferente por tela enquanto a busca tiver),
  um link `https` de imagem (a mesma em todas) ou `"gradiente"`. **Sem `PEXELS_API_KEY`**, ou se a busca falhar, as telas
  saem com degradês feitos pelo código.
- Crédito: cada foto do Pexels fica em `c.imagens` (página, autor, licença) e em `c.papel_de_parede.creditos`; a legenda
  padrão termina com "Fotos: … (Pexels)".

## Rotas (mesmo login das outras rotas do app)

`POST /api/carrosseis/dialogo`

```json
{
  "cena": { "descricao": "corredor de supermercado, dois homens de costas olhando as prateleiras", "imagem": "https://… ou data:image/jpeg;base64,… (opcional)" },
  "personagens": { "a": "Quem compra", "b": "Quem entende o jogo" },
  "falas": [
    { "a": "Só vim comprar leite.", "b": "Por isso ele tá lá no fundo." },
    { "a": "Peguei só um chocolate.", "b": "Ele tava na altura do seu olho." },
    { "a": "Tava em promoção.", "b": "Promoção de quem?" }
  ],
  "fechamento": { "texto": "Comenta MERCADO que eu te mando os 5 truques que mais funcionam com você.", "palavra_chave": "MERCADO" },
  "ancoras": { "a": { "x": 28, "y": 68 }, "b": { "x": 72, "y": 68 } },
  "legenda": "(opcional)", "hashtags": ["mercado"], "titulo": "(opcional)"
}
```

`POST /api/carrosseis/papel-de-parede`

```json
{ "capa": "Coloca esses de papel de parede", "frases": ["Dinheiro parado também tem custo.", "…"], "fundo": "pexels:calm lake", "foto_pedro": true }
```

Resposta `201`: `{ id, titulo, formato, slides, cena|fundo, avisos }`. Erro de entrada: `400` com `code: 'ENTRADA'`;
sem banco: `503 SEM_BANCO`. Limite: 10 chamadas por minuto.

## Para a fábrica de conteúdo (sem rota)

```js
const F = require('./backend/lib/formatosCarrossel');
await F.criarDialogo(entrada);          // mesma entrada da rota
await F.criarPapelDeParede(entrada);
F.validarDialogo(entrada); F.montarSlidesDialogo(entradaValidada, { imagem_id, cta }); // peças puras
```

Tudo é injetável em `{ deps }` (armazém, arte, `gerarCena`, `buscarFoto`, `carregar`, `fotoPedro`, `iscas`).

## Testes

`node --test backend/lib/formatosCarrossel.test.js` — OpenAI, Pexels e OCR falsos: telas 1080×1350, quebra de linha do
balão, cena do código com a IA desligada, OCR reprovando → nova tentativa → cena do código, teto de gasto, Pexels com e
sem chave, rotas com login e lista de validação, nenhuma chave em resposta/conteúdo/log.

## O que ainda não existe

- DM automática por palavra-chave (a resposta a quem comenta é manual).
- Tela de criação no app (**+ Criar**): por enquanto só pela rota ou pela fábrica.
- A fábrica por IA ainda não escreve as falas/frases sozinha: ela pode chamar `criarDialogo`/`criarPapelDeParede`.

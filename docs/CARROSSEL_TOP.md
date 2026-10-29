# Carrossel "top" (notícia com tese, no visual da referência)

Para o @pedro_destrava: pauta com conflito, tese do Pedro, número conferido e o desenho das peças de referência
(marinho, amarelo, vermelho, letra condensada, foto real em preto e branco). Entrega em **Para aprovar**; publicar continua
exigindo o toque do Pedro.

## Fluxo (retomável; cada chamada cabe no limite da função)
`ler → fatos → angulo → roteiro (2 versões) → juri → foto → arte → fim`

| Etapa | O que faz | Régua |
|---|---|---|
| ler | lê a matéria (link) ou o texto colado | sem texto legível = para |
| fatos | IA extrai fatos com **trecho literal**; o código confere que o trecho está na matéria e que todo número do fato está no trecho | < 2 fatos conferidos = descartada |
| angulo | "teste do grupo de WhatsApp": contradição, bolso, número, personagem (0–3 cada) + tese do Pedro | soma < 5 de 12 = descartada (`TOP_GATILHOS_MINIMO`) |
| roteiro | 2 versões, 10 capas cada, estrutura capa → gap → prova → contradição/consequência → leitura → fechamento; voz copiada dos posts reais mais compartilhados (painel Resultados) | número fora dos fatos, "Segundo …" em várias telas, tela longa, prova sem fato = reescreve; insistiu = abaixo da régua |
| juri | nota 0–10 (capa e envio pesam dobrado); escolhe versão e 2 capas | < 7,5 = mais uma rodada; de novo abaixo = não vai para aprovação (`TOP_NOTA_MINIMA`) |
| foto | foto real do protagonista no Wikimedia Commons, só CC BY, CC0 ou domínio público, crédito na legenda | sem foto com licença = sai só com as formas |
| arte | `arteReportagem.js` (rep_capa, rep_manchete, rep_comparacao, rep_numero); foto comum entra inteira num bloco P&B de borda rasgada; arte original do fechamento substitui o último slide quando existir | texto que não cabe no mínimo legível = aviso |

## Rotas
- `POST /api/top/carrosseis` `{ url }` ou `{ texto }` → cria
- `POST /api/top/carrosseis/:id/passo` → avança (chame até `concluido: true`)
- `GET /api/top/carrosseis/:id` → resumo (estado, etapa, nota, gatilhos, tese, avisos)
- `GET /api/top/regua` → régua atual

## Limites honestos
- Os fatos vêm de UMA matéria (o veículo citado). O código garante que o número está na matéria, não que a matéria está certa.
- A qualidade do texto depende do modelo de IA configurado no servidor. Com modelos gratuitos a nota do júri tende a cair.

## Formatos visuais

| Formato | Quando | Desenho |
|---|---|---|
| `reportagem` (`arteReportagem.js`) | comparação numérica forte (antes × depois) ou foto de pessoa/lugar | marinho/creme/amarelo/vermelho, Anton, capa com foto recortada, telas de prova com número gigante |
| `tweet` (`arteTweet.js`) | sequência de frases (padrão + quebra: "é normal… sabe o que não é normal?") ou linha do tempo com número | fundo branco, avatar do Pedro (`backend/assets/pedro-perfil.png`), nome e @, UMA frase por slide em Inter, foto colorida arredondada em até metade dos tweets, seta → |

O editor (etapa `angulo`) escolhe o formato; o piloto **alterna** tweet × reportagem a cada pauta para o feed variar; `POST /api/top/carrosseis` aceita `formato` para forçar. O formato tweet é o que mais engaja no nicho (referência: @thiago.nigro, 150–380 mil curtidas por carrossel).

## Piloto automático (produção diária; o Pedro só aprova)
`backend/lib/top/piloto.js` · rotas `GET/PUT /api/top/piloto`, `POST /api/top/piloto/rodada`, `POST /api/top/carrosseis/:id/desagendar`.

| O quê | Padrão (Perfil → Piloto automático) |
|---|---|
| Meta | 8 carrosséis prontos por dia + 2 de reserva (descartar um abre vaga para outro); pauta de serviço (agenda do dia, "saiba quais") nem entra; precisa pesar em bolso ou contradição (≥ 2); até 30 pautas testadas por dia (cerca de 1 em 3 passa na régua) |
| Produção | das 03:00 às 20:30 (Brasília), uma pauta por vez, a de maior prioridade com link legível |
| Avisos para aprovar | 08:00 e 14:00 — um aviso por janela, com a contagem de prontos |
| Horários de publicação | 09:00, 11:00, 12:30, 15:00, 17:00, 18:30, 20:00, 21:30 |

- **Aprovar = agendar** no próximo horário livre da grade (lista "Agendados" na tela Aprovar, com "Desagendar").
- No horário, a rodada entrega o item ao fluxo de publicação existente. Publicação pausada ou acesso aberto ao público
  seguram o item na agenda (não publica, não perde). Conteúdo que deixou de estar aprovado sai da agenda e nunca é publicado.
- Piloto desligado: não cria nada, mas publica o que já foi aprovado e agendado.
- Quem chama a rodada: o **relógio próprio** (fila `pedro-piloto` da Vercel, `api/piloto-worker.js`): ao fim de cada rodada a
  próxima é agendada — em ~1 min com carrossel em produção, a cada 10 min parado. Uma rodada por vez (trava `rodando_ate`);
  o fim da rodada não apaga aprovações feitas enquanto ela rodava. A fila entrega o tique para a mesma versão (deployment) que o
  enviou; por isso, em produção, o tique chama a rodada no endereço público com `CRON_SECRET` e quem roda é sempre a versão
  atual (a corrente migra sozinha a cada deploy). Duas rotinas diárias da Vercel (03:05 e 13:40 de Brasília) religam o relógio. Também chamam a rodada, e religam o relógio se ele parar:
  `.github/workflows/piloto.yml` (a cada 10 min no papel; na prática o GitHub atrasa horas), o app aberto (a cada 5 min) e o
  botão "Produzir agora". Com o código de acesso ligado, crie o secret `CRON_SECRET` no GitHub (o mesmo da Vercel).
- O monitor de notícias em alta também cria carrossel "top" (antes ia para o Radar, que só aceita ideias de negócio).

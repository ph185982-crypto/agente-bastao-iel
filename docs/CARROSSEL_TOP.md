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

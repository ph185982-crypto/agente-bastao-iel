# Radar de Negócios

Robô recorrente que pesquisa **negócios, SaaS, startups, aplicativos e produtos que funcionam em outros países** e os transforma em
carrosséis simples para o Instagram @pedro_destrava, na série **“Ideias que dão dinheiro”**. Aba **Radar** no app.

**Nunca publica nada no Instagram.** Ele pesquisa, confere, gera o carrossel e o põe na **fila de aprovação do Radar**; o Pedro baixa o ZIP,
posta por conta própria e marca “Já publiquei”. O código do Radar nem importa os módulos de publicação (há um teste que garante isso).

## Quando roda

| O quê | Valor |
|---|---|
| Horário pedido | **07:00 de Brasília** |
| Cron da Vercel (`vercel.json`) | `0 10 * * *` → rota `GET /api/radar/cron` |
| Conversão | Brasília é UTC−3 o ano todo (sem horário de verão desde 2019): 07:00 BRT = **10:00 UTC** |
| Idempotência | uma execução por dia (`rd_AAAAMMDD_cron`); chamar de novo devolve a mesma |
| Precisão | No plano **Hobby** a Vercel dispara o cron “dentro da hora marcada” (pode atrasar até ~59 min). Para o minuto exato há o reforço opcional `.github/workflows/radar.yml` (usa `MONITOR_URL` + `CRON_SECRET`, só funciona depois de estar na `main`). Os dois chamam a mesma rota idempotente. |
| Segurança | a rota só aceita o `Authorization: Bearer $CRON_SECRET` que a Vercel envia (quando o acesso por código está ativo) |

Botão **“Pesquisar oportunidades agora”**: mesmo pipeline, sem esperar o cron. Limite de 4 pesquisas manuais por dia (`max_manuais_dia`).

## Pipeline (retomável)

`coletar → candidatos → verificar → avaliar → selecionar → gerar → notificar`

Cada chamada trabalha até ~44 s (limite da função) e grava o ponto de retomada. A continuação vai pela fila da Vercel (`api/radar-worker.js`, tópico
`pedro-radar`), pelo app aberto (`POST /api/radar/execucoes/:id/passo`) ou pela próxima chamada do cron/`/estado`. Se o servidor cair no meio, a
execução recomeça **da última etapa gravada**, sem refazer o que já está salvo nem gerar o carrossel duas vezes.

1. **Coleta** (≥ 30 negócios): feeds RSS/Atom e APIs públicas — Product Hunt (3 feeds), Kickstarter, blog do Y Combinator, TechCrunch, Crunchbase News,
   Fast Company, Forbes, Inc., Entrepreneur, EU-Startups, Sifted, The Next Web, Inc42, Rest of World, Exame, Startups.com.br, NeoFeed, Google Trends
   (BR e EUA) e a API pública do Hacker News (Show HN + 10 buscas pelos termos em inglês). Os termos em português ordenam o que os feeds trazem.
2. **Candidatos**: a IA lê títulos/resumos e propõe negócios; cada um precisa apontar para itens reais da coleta. Junta duplicados, barra o que já
   foi sugerido, usado ou descartado (120 dias; descartado pela máquina por falta de prova volta em 14).
3. **Verificação** (até 12 candidatos): lê o site oficial, até 2 matérias, o texto do fundador no Show HN e a App Store (API pública da Apple).
   A IA só **propõe** afirmações com o trecho que as comprova; o **código** confere o trecho no texto lido, o número no trecho e as confusões de dinheiro
   (investimento ≠ faturamento, valuation ≠ caixa, crescimento/investimento ≠ lucro). Só vira carrossel com **fonte oficial** (marcada “segundo a
   empresa”) ou **duas fontes independentes**; matéria republicada ou da mesma agência conta como uma. Um número só em uma matéria **não** é usado.
   Negócio antigo (≥ 7 anos sem lançamento recente) e história velha (> 45 dias) são descartados; pirâmide, aposta, renda garantida, enriquecimento
   rápido, patrocinado e especulação também.
4. **Pontuação** 0–100: novidade 15 · prova de demanda 20 · receita clara 15 · compreensão 10 · adaptação ao Brasil 15 · investimento baixo/médio 10 ·
   visual 5 · compartilhamento 10. A IA dá níveis de 0 a 3 com justificativa; os pontos saem dos pesos, em código, com tetos impostos pela verificação
   (sem dado de demanda confirmado, a nota de demanda não passa de 1/3; sem foto real, o visual é 0).
5. **Seleção**: as 5 melhores. **Carrossel automático só se a primeira verificada tiver ≥ 75 pontos e ao menos um número comprovado**; as outras viram
   pautas sugeridas. Se ninguém chegar a 75, nada é gerado e o aviso diz isso.
6. **Aviso no PWA**: “Uma nova ideia de negócio está pronta para você.” (abre `/?tab=radar`).

## O carrossel (8 telas, 1080 × 1350)

1 capa · 2 problema · 3 solução · 4 como ganha dinheiro · 5 prova (só números verificados, fonte no rodapé) · 6 por que funciona · 7 hipótese para o
Brasil · 8 CTA fixo (“Eu pesquiso negócios…”, com a foto e o nome do Pedro, **sem selo azul**: a conta não é verificada).
Validadores de código: 8–25 palavras por tela (capa até 18; a tela 8 é o texto fixo pedido), frases proibidas, sem emoji, no máximo uma exclamação e
duas perguntas, números só os das afirmações liberadas, “segundo a empresa” na mesma tela do número, dinheiro na capa só com dado verificado do mesmo tipo,
hipótese só na tela 7, nenhuma afirmação de que “ninguém faz isso no Brasil” (não existe fonte que prove ausência), legenda ≤ 700 caracteres e ≤ 3 hashtags.
Arte: marfim, azul `#1457D9`, laranja `#F47A1F`, preto `#171717`; foto real ≈ 35 % da tela; todo texto desenhado por código e medido pela fonte (se não cabe, a
tela é recusada, nada é espremido).

**Imagens**: só a imagem de divulgação do **site oficial confirmado** (og:image), com origem registrada (página, endereço, data, hash). Banco de imagens
(Pexels, se `PEXELS_API_KEY`) só como “imagem ilustrativa” e nunca na capa nem no produto. Sem foto real, a capa é tipográfica. Sem logotipo desenhado, sem
imagem de IA, sem rosto alterado.

**Pacote (ZIP)**: `slide-01.png … slide-08.png`, `legenda.txt`, `ficha-de-fontes.md/.json` (cada afirmação com URL, veículo, data, trecho, data da consulta,
confiança e observações), `imagens-origem.json`, `LEIA-ME.txt`.

## Onde os dados ficam

Postgres do servidor (o mesmo Neon da “Cópia no servidor”), tabela própria `pico_radar` (tipos `oportunidade`, `execucao`, `coleta`, `carrossel`, `reels`,
`config`) + arquivos `radar:*` (PNGs, ZIP, imagens) em `pico_arquivos`. Nada do Radar aparece na biblioteca da Mesa. Sem `DATABASE_URL` o Radar avisa e não roda.
Guardado: oportunidades, fontes, afirmações, pontuações, carrosséis e versões, imagens, datas, decisões, temas usados e métricas.

## Aprendizado

“Já publiquei” guarda data e horário; “Informar números do post” guarda visualizações, alcance, curtidas, comentários, compartilhamentos, salvamentos,
visitas ao perfil, seguidores ganhos e retenção. O painel compara **categorias** por alcance, retenção, compartilhamentos e seguidores por mil alcançados.
Curtida não entra em ranking de seguidores; campo em branco não vira zero; menos de 3 posts por categoria = “amostra pequena”.

## Ativar / operar

- Precisa de: banco (`DATABASE_URL`), chave de IA, `CRON_SECRET`, chaves VAPID e o app na Tela de Início para o aviso (`docs/ATIVACAO.md`).
- Fontes bloqueadas (não contornamos): Indie Hackers (403), AppSumo (sem feed), Business Insider (403), PEGN (403), StartSe (sem feed). Ver aba Radar → “Fontes configuradas”.
- Provedores gratuitos primeiro, OpenAI por último (cascata existente). O consumo de cada execução (chamadas, tokens, custo estimado) fica registrado na própria execução e aparece na aba.
- Desligar: `POST /api/radar/config {"ativo": false}`.

# Pautas, temas e ganchos

## Ganchos (capas)

- **Não copia:** exemplos do playbook (`static/viralPlaybook.js`), os dois ganchos que a ferramenta já publicou sem resultado e,
  na revisão, qualquer capa com semelhança de 0,8 ou mais (Dice sobre trigramas de caracteres) com eles **bloqueia a aprovação**
  (`hook_copiado`). Capa parecida com a abertura de um post recente (0,65 ou mais) vira **sugestão** (`hook_parecido_recente`).
  O que se proíbe é o texto, não a ideia: "R$ 100 de 1998 valem R$ 31 hoje" passa.
- **Geração:** o prompt traz cinco fórmulas nomeadas (número grande, antes e depois, contraintuitiva, pergunta que dói, quanto sobra),
  pede uma fórmula diferente por capa, lista os exemplos proibidos e as aberturas recentes. Se uma capa copiar, a segunda tentativa
  recebe o motivo. A fórmula de cada capa é detectada pelo **código**, não declarada pelo modelo.
- **Verificações por capa** (sem nota): até 10 palavras, tem número ou forma clara, sem clichê nem abertura genérica, não copia.
  Aparecem ao lado de cada opção de capa.

## Mais ganchos (botão na escolha de capa)

- A IA escreve até 10 candidatos (2 por fórmula) usando **só os fatos sustentados** do conteúdo. O código descarta, com motivo visível:
  cópia de exemplo do playbook ou de post recente, número que os fatos ligados não têm, número sem fato apontado e repetição entre candidatos.
- O "júri" é objetivo: quantas das 4 verificações cada gancho atende (curto, concreto, sem clichê, original). Desempate: o mais curto.
  As 3 primeiras tentam fórmulas diferentes; a fórmula declarada pelo modelo só vale se o texto tiver essa forma. **Não há nota de viralização.**
- "Usar como capa" acrescenta o gancho como capa candidata numa nova versão (as anteriores ficam guardadas), escolhe essa capa e refaz a arte.
- Os "posts recentes" vêm dos posts lidos pela aba Resultados (o que o perfil realmente publicou) mais o que o navegador mandar.

## Conta aberta (prova com número real) e porta de entrada

Criar → "Prova com número real (Conta aberta)". Sem IA: você informa período, canal, faturamento e custos (comissão, frete, imposto,
anúncios, outros) e, se quiser, quanto sobrou.

- **O código faz as contas**: percentual de cada custo e margem, arredondados a 1 casa. Se os números **não fecham** (faturamento − custos ≠ sobra,
  com tolerância de R$ 1 ou 0,5%), a prova **não é criada** e a mensagem mostra as contas para você corrigir.
- **Anonimiza por padrão**: o nome do cliente só entra com "o cliente autorizou" marcado; sem isso o nome nem é guardado no conteúdo.
- **Rótulo honesto**: os valores são "informados pelo cliente a partir dos registros dele", com a limitação "não verificado de forma independente"
  nas evidências e na legenda ("sem auditoria independente", "não é promessa de resultado"). O estado das afirmações vem das mesmas regras do resto da ferramenta.
- O conteúdo sai com arte e cai na Central para você aprovar; editar um número depois reabre a revisão (número sem origem). Nada é publicado sozinho.
- **Iscas (lead magnets)**: nome, palavra para comentar e **link https**. Sem link, a chamada final não é gerada e a pendência aparece
  (nada de promessa vazia). Com link: "Comenta PRECO que eu te mando: Calculadora de preço."
- **DMs por palavra**: você digita por semana (total e, se souber, qualificadas). Não existe integração com as mensagens; vazio é "—", não zero.

## Temas usados

- Registro em `config.temas_usados` (até 400): alimentado pelos posts lidos na aba **Resultados** (inclui os antigos, origem
  "instagram" ou "ferramenta") e por cada publicação confirmada.
- Dois textos são o mesmo tema quando dividem 2 ou mais radicais (palavras de 5 letras, siglas como MEI e escalas como 6x1) e pelo menos
  40% do menor conjunto. Verbos genéricos de notícia ("aprova", "muda", "sobe") não contam.
- A busca de pautas descarta o que repete tema dentro de N dias (padrão 21) **e mostra a lista com o motivo e a data**.

## Estratégia (Ajustes → Estratégia de pautas)

| Campo | Padrão | Efeito |
|---|---|---|
| `modo_politico` | `neutral` | `neutral` deixa de fora pautas partidárias ou eleitorais (termos eleitorais inequívocos ou ângulo marcado pela IA). Imposto, juros e preço entram. `allowed` libera, com penalidade na prioridade. |
| `temas_bloqueados` | vazio | palavras que tiram a pauta da lista |
| `dias_sem_repetir` | 21 | janela do registro de temas |
| `min_posts_por_grupo` | 5 | amostra mínima para comparar formatos na aba Resultados |

## Prioridade das pautas

A IA dá **níveis de 0 a 3** (enviabilidade, número, aderência ao público, ponte para quem vende) e marca partidário e direito de uso;
o frescor vem da data. O código combina com os pesos 30, 20, 20, 15 e 10 (soma 95, reescalada para 100) e subtrai penalidades
(partidário 30, direito de uso 15, sem fonte 20). **É uma estimativa para ordenar a lista do dia: não prevê alcance nem envio.** Os pesos
são uma hipótese e ainda não foram comparados com resultados reais; a aba Resultados é o lugar de fazer essa comparação.

## Ainda não existe

- Camadas alcance/prova/oferta (50/30/20) como regra de mix semanal (a prova já existe como gerador; falta o planejamento da semana).
- Integração automática com as DMs do Instagram (hoje a contagem por palavra é digitada).
- Ajuste dos pesos pelo resultado dos posts.

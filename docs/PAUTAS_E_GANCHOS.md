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

- Geração de dez ganchos com júri e botão "mais ganchos" na tela de capas (só as três capas de sempre, agora com fórmulas distintas).
- Camadas alcance/prova/oferta (50/30/20) e o gerador "A Conta Aberta" com dados de cliente.
- CTA por palavra-chave com lead magnet (os links ainda não existem) e contagem de DMs.
- Ajuste dos pesos pelo resultado dos posts.

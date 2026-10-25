# Fundo por IA (OpenAI) no modo híbrido

**Vem DESLIGADO por padrão**: cada imagem gasta crédito da OpenAI. Nada é gerado até `IMAGEM_OPENAI_LIGADA=1` estar definido na Vercel e a `OPENAI_API_KEY` existir.

## Como funciona (híbrido)

| Parte do slide | Quem faz | Por quê |
|---|---|---|
| Fundo e formas (pincelada, seta, círculo, degrau, textura de papel e grão) | **IA** (`backend/lib/imagemOpenAI.js`) | É o que dá o ar de reportagem; erro aqui não muda o fato. |
| Texto, números, fonte e data | **Código** (`arte.js`) | O texto sai exatamente como foi aprovado. |
| Rosto | **Recorte real**, colado pelo código | A IA nunca desenha nem altera um rosto. |
| Conferência | **OCR** (`backend/lib/ocrConferencia.js`) | Lê o PNG final e confere os números. Número diferente do esperado bloqueia a arte. |

O prompt de fundo (`montarPrompt`) pede só a forma gráfica e traz sempre, por último e por escrito: SEM texto, SEM letras, SEM números, SEM logotipos, SEM pessoas, SEM rostos, SEM marcas.

## Contratos

- `gerarFundo({ prompt, qualidade='medium', tamanho='1024x1536', modelo, fetcher, chave })` → `{ png, custo_usd, modelo }`. Chama `POST /v1/images/generations` (`n:1`, `output_format:'png'`), timeout de 50 s.
- `fundoComTeto({ conteudo_id, prompt, qualidade, deps })`: reserva o gasto, gera e registra. Devolve `{ png, custo_usd, modelo }`.
- `conferirTexto(png, esperados, { ocr })` → `{ ok, faltando, detalhes, nao_verificaveis, lido }`.
  - Número: igualdade exata (dígitos, `,` `.`, sinal, `%` e unidade colada: `52,3 bi` ≠ `52,8 bi` ≠ `52,3 mi`).
  - Palavra com 5 letras ou mais: tolera 1 letra errada. Palavra curta não é cobrada sozinha.
  - Frase sem número e sem palavra de 5+ letras vai para `nao_verificaveis`.
- Erros tipados: `ImagemDesligada`, `ImagemSemChave`, `ImagemTeto` (com `.detalhe.tipo` = `carrossel` ou `mes`), `ImagemRecusada`, `ImagemFalhou`. As mensagens são fixas: a chave e o corpo de erro cru da API nunca aparecem.

## Variáveis (só nomes; valores na Vercel)

| Variável | Para que serve | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | chave da OpenAI (Sensitive). Use uma chave nova, com limite de gasto no painel da OpenAI | sem chave: nada é gerado |
| `IMAGEM_OPENAI_LIGADA` | `1` liga a geração de fundo | desligado |
| `OPENAI_IMAGE_MODEL` | modelo de imagem | `gpt-image-1.5` |
| `IMAGEM_TETO_CARROSSEL_USD` | teto de gasto por carrossel | `2.00` |
| `IMAGEM_TETO_MES_USD` | teto de gasto por mês (fuso de São Paulo) | `10.00` |

## Custo por imagem (1024×1536, em dólar)

**Confirme no painel da OpenAI: os preços mudam e estes são os da última consulta.**

| Modelo | low | medium | high |
|---|---|---|---|
| `gpt-image-1.5` | 0,013 | 0,05 | 0,20 |
| `gpt-image-1` | 0,016 | 0,063 | 0,25 |
| `gpt-image-1-mini` | 0,006 | 0,015 | 0,052 |

Modelo desconhecido é cobrado, na conta do teto, como `high` do 1.5 (0,20). Para os outros tamanhos usamos o mesmo valor (conservador). Só um fundo por carrossel já basta para o visual; a recomendação é rascunho em `low` e a versão final em `medium` ou `high`, e só depois de aprovar o roteiro.

## Teto de gasto

- A reserva é feita **antes** de chamar a API: se estourar o teto do carrossel ou do mês, nada é gerado nem cobrado (`ImagemTeto`).
- Chamadas simultâneas contam as reservas em andamento.
- Falha ou recusa libera a reserva (nada é cobrado). Atenção: se a conexão cair depois da OpenAI já ter processado, o crédito pode ter sido cobrado e o app não saberá; por isso o limite de gasto no painel da OpenAI continua necessário.
- **Limitação sem banco:** o gasto fica no armazém (chave `imagem_gasto:YYYY-MM` na configuração da conta). Sem `DATABASE_URL` o teto vale só na memória do processo: na Vercel cada instância tem o seu e ele zera quando a função é reciclada. Nesse caso é só um freio por execução, não um controle de verdade.
- O gasto do mês é lido e regravado sem trava no banco; duas instâncias gravando juntas podem somar um pouco menos que o real. Por isso os tetos padrão são baixos.
- O teto por carrossel conta dentro do mês; um conteúdo que atravessa a virada do mês recomeça com o teto cheio.

## Se a OpenAI recusar (`ImagemRecusada`)

A política de conteúdo pode recusar pedidos, mesmo de fundo. Não insista com variações do mesmo pedido:
1. use o fundo feito pelo código (formas desenhadas por `arte.js`), que não depende da IA;
2. o slide continua válido: o fundo é só enfeite, o conteúdo e o rosto não passam pela IA.

Erros `401/403` normalmente são chave errada ou organização sem acesso ao modelo (confira a verificação da organização no painel da OpenAI).

## Linhas para o `.env.example` (adicionar no fim)

```
# Fundo por IA no modo híbrido (desligado por padrão; gasta crédito da OpenAI)
IMAGEM_OPENAI_LIGADA=
OPENAI_IMAGE_MODEL=gpt-image-1.5
IMAGEM_TETO_CARROSSEL_USD=2.00
IMAGEM_TETO_MES_USD=10.00
```

# Dashboards (aba inicial da Central)

`/dashboards` é a primeira aba do menu e o destino padrão do login de **administrador** e **revisor** (o revisor só lê).
Usuários de cliente (Mapa) nunca veem nem acessam (o middleware os manda para `/mapa`; a página também confere). Membros
sem papel de administrador/revisor voltam para a Central.

## Fontes

| Bloco | Fonte | Código |
|---|---|---|
| Vendas, leads, funil, conversão, faturamento, receitas, despesas, resultado, previstos, contratos | Vendedor IA | `src/lib/dashboards/vendedoria.ts` → `GET {VENDEDORIA_URL}/api/integracoes/avanteza/metricas` (contrato em `vendedoria/docs/integracao-avanteza.md`) |
| Marketing (investimento, impressões, alcance, cliques, CTR, CPC, leads/conversas, custo por lead, ROAS, campanhas, por conta) | Meta Marketing API v21.0 | `src/lib/dashboards/meta.ts` |
| CAC | Investimento Meta ÷ novos clientes (negócios ganhos) do Vendedor IA | `calcularCac` em `src/lib/dashboards/index.ts` |

Cada fonte é independente: se uma falhar, só o bloco dela mostra o aviso ("Vendedor IA indisponível", "Meta sem dados") e a
página continua. O CAC mostra "—" com a explicação quando falta investimento, cliente novo ou uma das fontes.

## Períodos
7, 30 e 90 dias (terminando hoje) e mês atual (dia 1º até hoje), em horário de São Paulo. A variação compara com o período
**imediatamente anterior de mesmo tamanho** (no "mês atual", os mesmos N dias que antecedem o dia 1º).

## Meta (somente leitura)
- `GET /me/adaccounts` e `GET /{act_id}/insights` (campos `spend, impressions, reach, clicks, ctr, cpc, actions, action_values`;
  nível conta, conta por dia e `campaign`). Nenhuma chamada de escrita (teste garante: só `GET`).
- Token em `META_ACCESS_TOKEN`, enviado no cabeçalho `Authorization` (nunca na URL, em log ou no banco).
- Várias contas: todas são listadas e somadas; com mais de uma, a tela mostra o quadro "Por conta de anúncio". Conta
  desativada, sem dados ou com erro aparece na linha dela e não derruba as outras. Contas em moeda diferente ficam fora da soma.
- Leads = tipo `lead` (ou, na falta, `lead_grouped`/`fb_pixel_lead`; sem dupla contagem) + conversas iniciadas (WhatsApp).
  ROAS só aparece quando há valor de conversão (`purchase`). O alcance somado entre contas pode repetir pessoas (aviso na tela).
- Retry com backoff (`src/lib/http.ts`) para 429/5xx/rede e para erros transitórios/de limite que a Meta devolve com HTTP 400.
- **Cache de ~15 min**: memória da instância + tabela `avanteza.dashboard_cache` (Postgres/Neon, `db/schema.sql`, idempotente;
  rode `node db/apply.mjs`). Escolhido porque na Vercel cada instância serverless tem memória própria; o banco compartilha o
  resultado e protege o limite de chamadas da Meta. Se a Meta falhar, mostra o último valor guardado, marcado como desatualizado.
  Sem a tabela/banco o painel segue funcionando (só sem cache).

## Variáveis (Vercel do projeto da Central)
`META_ACCESS_TOKEN`, `AVANTEZA_METRICS_KEY` (mesma do Vendedor IA), `VENDEDORIA_URL` (opcional).

## Desenvolvimento e capturas
`DASHBOARDS_FIXTURE=1 npm run dev` mostra dados simulados (`vazio` = fontes sem dados, `erro` = fontes fora do ar). **Só funciona
fora de produção**: com `NODE_ENV=production` ou `VERCEL_ENV=production` a variável é ignorada. O fixture não usa o cache do banco.

## Menu lateral recolhível
Botão "Recolher menu" no rodapé da lateral (telas ≥ 900px) reduz a barra a uma coluna de ícones (72px) com transição suave
(desligada em `prefers-reduced-motion`). Os rótulos viram `title` e ficam disponíveis a leitores de tela; o seletor de empresa do
Mapa mostra as iniciais (o `<select>` continua funcional), e tema e Sair seguem acessíveis. O estado fica em `localStorage`
(`avanteza-menu`) e cookie, ambos com try/catch, e é aplicado por um script no `<head>` antes da pintura (sem flash). No celular
continua a gaveta.

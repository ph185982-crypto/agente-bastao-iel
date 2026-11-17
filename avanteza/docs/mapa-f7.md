# Mapa F7 — aprovações, relatório semanal e lembretes ao cliente

## Isolamento (requisito crítico)
- Lado do cliente só em `src/lib/mapa/aprovacoes.ts` e `src/lib/mapa/relatorios.ts`: toda função exige o escopo emitido pela
  sessão (`assertScope`) e filtra por `scope.clientId`. O id vindo da URL/formulário é só filtro; escrita (`decidirAprovacao`)
  exige `assertWritable` — "Ver como cliente" é somente leitura (formulários escondidos e escrita recusada).
- O cliente só vê relatórios `publicado`; rascunho e descartado nunca saem. Peças canceladas somem do Mapa.
- Nada de e-mail da equipe, ID de conta de anúncios, rotina interna (`visible_to_client = false`) ou nota interna vai ao cliente.
- Testes: `tests/f7-db.test.ts` (IDOR, preview somente leitura, escopo forjado).

## Aprovações
Tabelas: `aprovacoes` (status `pendente | aprovada | ajuste | cancelada`, `versao_atual`, `action_id` = tarefa ligada,
`ajuste_action_id`), `aprovacao_versoes` (link/arquivo por versão), `aprovacao_eventos` (histórico).
- Aprovar: troca condicional `pendente → aprovada`; conclui a tarefa ligada (evidência = link da versão); notifica a equipe.
- Pedir ajuste (comentário obrigatório): `pendente → ajuste`; cria ação em `plan_actions` (origem `aprovacao`, prioridade alta,
  D+2, responsável da tarefa ligada ou o responsável pela conta, visível ao cliente como "Com a Avanteza"); notifica a equipe.
- Nova versão (equipe): `ajuste|pendente → pendente`, `versao_atual + 1`, conclui a ação de ajuste.
- Telas: `/mapa/aprovacoes`, `/mapa/aprovacoes/[id]`, bloco no Início e contador no menu; equipe em `/operacoes/aprovacoes`
  (com o cliente, atrasadas, ajustes pedidos, decididas em 30 dias), `/operacoes/aprovacoes/[id]` e ficha → aba "Aprovações e relatórios".

## Relatório semanal
- Job `relatorios` (`vercel.json`: segunda 11:17 UTC, depois da coleta dos canais). Semana relatada = segunda a domingo anteriores.
  `unique (client_id, semana)`: rodar de novo não cria nem reescreve. Clientes com `relatorio_modo = 'desligado'` ficam de fora.
- Dados (`relatorios_semanais.dados`): marketplaces (`daily_snapshots`), anúncios Meta e Instagram (`channel_snapshots`, cada fonte
  separada), entregas concluídas visíveis, próximas 7 dias, o que depende do cliente (incl. peças para aprovar).
- Abertura: IA (`ANTHROPIC_API_KEY`, saída estruturada, só com os dados do relatório) ou modelo fixo; falha da IA → modelo.
- Publicação: modo `auto` publica no `tick` depois de `relatorio_horas` (padrão 12) se ninguém publicar antes; `revisao` só manual.
  Revisão (abertura e destaques) em `/operacoes/relatorios/[id]`. Publicar é condicional (`rascunho → publicado`): e-mail uma vez.
- PDF: `src/lib/relatorios/pdf.ts` (pdf-lib, JS puro; Manrope embutida em base64, licença OFL). Cliente: `/mapa/relatorios/[id]/pdf`;
  equipe (inclusive rascunho): `/operacoes/relatorios/[id]/pdf`.

## Lembretes
- Job `lembretes` (diário 12:33 UTC = 09:33 em São Paulo). Itens: ações do cliente (`owner = cliente` ou bloqueadas esperando por ele)
  e peças pendentes, atrasadas ou vencendo até hoje + 2, só visíveis. `unique (client_id, dia)`: no máximo 1 por dia, agrupado.
- Mapa: faixa "Lembrete de hoje" no Início (só itens ainda pendentes). E-mail ao `contact_email` quando configurado.
- Desligar: ficha → "Aprovações e relatórios" (`clients.lembretes_ativos`). Log na mesma aba e em `audit_log` (`lembrete_cliente`).

## Produção
1. `node db/apply.mjs` no Neon (aditivo e idempotente; ramo de backup antes).
2. Deploy (os crons novos entram pelo `vercel.json`).
3. Opcional: `RESEND_API_KEY` + `ALERT_EMAIL_FROM` (e-mails), `ANTHROPIC_API_KEY` (abertura pela IA), `APP_URL`; `contact_email` de cada cliente.

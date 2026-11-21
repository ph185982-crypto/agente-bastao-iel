# Auditoria do Estúdio Pedro Destrava e plano de evolução (21/11/2026)

Escopo: o pedido "Prompt Master — evolução completa". Este documento é o diagnóstico técnico pedido na etapa 4; o que já foi
construído está marcado, e o que não foi também.

## 1. Arquitetura atual (verificada no código)

| Item | Como é hoje |
|---|---|
| Frontend | HTML + JS puro em `static/` (sem framework), mobile-first; `mesa.js` orquestra as abas (Aprovar, Criar, Vídeos, Reciclar, Perfil/Ajustes, Resultados, Radar). CSS em `static/*.css`. |
| Backend | Node/Express em `backend/server.js`; rotas em `backend/routes/`, regras em `backend/lib/`. Na Vercel roda como função (`api/index.js`); no Cloud Run/Render, como servidor (`Dockerfile`). |
| Banco | **Postgres da Neon** (pela Vercel), não Supabase. Camada `backend/lib/armazem.js`: tabelas de conteúdos, configuração, `radar` (documentos por tipo), publicações, arquivos. Memória nos testes. |
| Arquivos | Vercel Blob (vídeos, capas). Edição de vídeo no GitHub Actions (`tools/reels`, Python + ffmpeg + faster-whisper). |
| IA | Cascata gratuita Groq → Gemini → Cerebras → OpenRouter (`llm.js`, `llmJson.js`); OpenAI só como reserva paga, com teto (`gastoIa.js`). |
| Autenticação | Código de acesso do dono (`access.js`), CRON_SECRET para rotas agendadas, OIDC do GitHub Actions para o worker de vídeo. |
| Publicação | Instagram pela Graph API (`publicador.js`, `meta.js`), LinkedIn (`linkedin.js`). Nada sai sem aprovação. |
| Agendadores | Relógio do piloto (fila da Vercel), crons da Vercel, workflows do GitHub Actions (piloto, radar, monitor, reciclagem, video-worker). |
| Métricas | `meuInstagram.js` (leitura da Meta), `placar.js` (resultado por jeito de fazer, pesos 80/20), `profileInsights.js`. |
| Logs / testes | `console.*` no servidor (Vercel logs); 832 testes (`npm test`) + 80 do editor de vídeo (Python). |

Limitações de infraestrutura encontradas hoje: o plano Hobby da Vercel foi bloqueado por CPU em 15/11 (migrado para Pro); o banco
Neon atingiu a cota gratuita do mês e está bloqueado (a tela de vídeos mostra o aviso). Sem o banco, nada novo pode ser testado
contra produção.

## 2. Funcionalidades existentes

| Funcionalidade | Status | Onde | Dependências | Problemas |
|---|---|---|---|---|
| Aprovar / Criar | Funciona | `mesa.js`, `mesaEditor.js`, `routes/studio.js`, `lib/studio.js` | Banco, IA | Depende do banco (hoje bloqueado). |
| Vídeos (roteiro, teleprompter, edição) | Funciona | `static/videos.js`, `teleprompter.js`, `lib/videos`, `tools/reels` | Blob, GitHub Actions | Armazenamento bloqueado pela Neon. Edição: regras da fase 4 do Motor Magnético entram no próximo vídeo. |
| Roteiros de Reel | Funciona e foi evoluído | `lib/roteiros` | IA gratuita | Agora com ângulo, 8 ganchos, banca de 3 papéis e DNA Editorial. |
| Reciclar | Funciona | `lib/reciclagem` | Meta, IA | Já transforma tese, mas pode ainda parecer cópia; a camada de "mecanismo criativo" (item 18) não foi refeita. |
| Perfil / Ajustes | Funciona | `mesa.js`, `estrategia.js` | Banco | Ganhou DNA Editorial. |
| Piloto automático | Funciona | `lib/top/piloto.js`, `relogio.js` | Fila, banco | Meta de produção por quantidade (item 17 ainda não reformulado). |
| Radar de negócios | Funciona | `lib/radar` | Fontes, IA | — |
| Métricas / Placar | Funciona | `placar.js`, `meuInstagram.js` | Meta | Não coletava curtidas e comentários (corrigido); histórico só de 90 dias (corrigido com arquivo). |
| Painel de audiência (30 perfis) | Funciona, **simulado** | `lib/painel` | IA | É opinião simulada por IA, não audiência real. O placar já mede se a nota acerta o resultado real. |
| Monitor de tendências | Funciona | `lib/monitor.js` | Feeds, IA | — |
| Ganchos | Funciona | `lib/ganchos.js` | IA | Reaproveitado pelo laboratório de ganchos do roteirista. |
| Stories | Parcial | — | Meta | Não há publicação nem geração de Stories. |
| Biblioteca pessoal (histórias) | Funciona | `lib/historias.js` | Banco | Complementada pelo banco de personalidade do DNA. |
| Iscas | Funciona | `lib/leadMagnets.js` | Banco | DMs são digitadas à mão (a API não entrega). |
| Publicação / LinkedIn | Funciona | `publicador.js`, `linkedin.js` | Meta, LinkedIn | Token da Meta só em variável de ambiente. |

## 3. Redundâncias evitadas
Nada foi recriado. O painel de crescimento usa os posts do `meuInstagram.js` e do arquivo novo do `placar.js`; o DNA estende
`pedroDna.js`; o ângulo e os ganchos usam as regras do fiscal de `roteiros`. Os dados novos ficam nas tabelas existentes
(`config` e `radar`): nenhuma migration, nenhuma tabela nova, nada destrutivo.

## 4. Backup e segurança
Trabalho em branch própria com PR e testes. Mudanças só aditivas no banco. Backup do banco não foi possível: a Neon está
bloqueada. Nenhum token foi lido ou exposto.

## 5. O que foi implementado nesta entrega (fase P0 e parte da P1)

| Item do pedido | Status |
|---|---|
| Growth Dashboard (7/30/90 dias, período anterior, indicadores, o que funciona/não funciona, aprendizado, oportunidade, próxima ação) | **Implementado e testado** (aba Resultados). Personalizado por datas: só na API. |
| Métricas reais e rastreáveis | **Implementado**: curtidas e comentários agora coletados; arquivo de posts maduros além de 90 dias. |
| Diagnóstico de crescimento (períodos A/B/C, relatório) | **Implementado e testado**; precisa das datas da transição, que o Pedro define no DNA. |
| DNA Editorial (posicionamento, promessa, personalidade, linguagem, pilares, séries, banco) | **Implementado**; integrado ao roteirista e ao ângulo; expressões proibidas viram regra do fiscal. |
| Creative Intelligence (ângulos e ganchos) | **Parcial**: roteiros de Reel têm ângulo, 8 ganchos e escolha; falta contexto/audiência, 5 ângulos, score 0-100 e tela de escolha. |
| Revisor criativo | **Parcial**: banca de 3 papéis com frase mais fraca e reescrita; faltam as 10 perguntas obrigatórias. |
| Audience Intelligence, Growth Lab, Community, Distribution, Conversion, reformulação do piloto, reciclagem por mecanismo | **Não implementado** (ver seção 7). |

KPIs que a Meta não entrega e aparecem como indisponíveis com o motivo: seguidores perdidos, taxa de conclusão, cliques. Leads,
diagnósticos e conversões dependem do funil (P4); DMs por palavra-chave vêm do que o Pedro digita.

## 6. Riscos
1. Neon bloqueada: nada novo foi testado contra produção; os testes usam banco em memória e o servidor local com dados de teste.
2. Tema vem da legenda (palavras-chave): é aproximação, e o painel avisa.
3. Reels não informam seguidores por post (limite da Meta): o efeito de um Reel no crescimento só aparece na série diária da conta.
4. A série diária de seguidores cobre 30 dias; períodos maiores aparecem como indisponíveis, sem inventar.
5. Amostra pequena (cerca de 3 Reels por semana): o painel exige 5 posts por grupo e diz quantos faltam.

## 7. Plano e ordem do que falta
1. **P1 (restante):** Inteligência de Audiência (comentários próprios e de concorrentes, perguntas recorrentes; exige permissão de
   comentários na API da Meta), tela de Creative Intelligence com 5 ângulos, 10 ganchos, score e escolha das 3 melhores, 10
   perguntas obrigatórias no revisor.
2. **P2:** Growth Lab (experimentos com hipótese, grupos A/B, amostra mínima, conclusão), marcação por post (rosto, capa, duração).
3. **P3:** Comunidade (classificar comentários, sugerir resposta, virar pauta). Requer leitura de comentários pela API.
4. **P4:** Distribuição pós-publicação e funil de conversão (leads, diagnósticos, propostas, clientes), com registro manual.
5. **Piloto:** trocar meta de quantidade por prioridade estratégica e frequência recomendada pelos dados.
6. **Reciclagem:** extrair mecanismo (tese, gancho, estrutura, emoção) e gerar interpretação original.

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

## 5. Status de cada item do pedido (atualizado em 21/11/2026)

Tudo fica em **Resultados → Crescimento** (abas Painel, Diagnóstico, Criativo, Audiência, Comunidade, Lab, Funil, Fila, Séries)
e em **Ajustes → DNA Editorial**. Rotas em `backend/routes/crescimento.js`; regras em `backend/lib/`.

| Item | Status | Onde | Depende de |
|---|---|---|---|
| Growth Dashboard (7/30/90 dias e datas, período anterior, indicadores, decisões) | Implementado, testado | `crescimento.js` | Leitura da Meta (Atualizar números) |
| Diagnóstico A/B/C e relatório | Implementado, testado | `crescimento.js` | Datas da transição no DNA |
| DNA Editorial + banco de personalidade, integrado ao roteirista | Implementado, testado | `dnaEditorial.js` | — |
| Inteligência de Audiência (categorias, radar, oportunidades com score comparativo) | Implementado, testado | `audiencia.js` | Comentários lidos (permissão `instagram_manage_comments`) |
| Demografia da audiência | Implementado | rota `/audiencia/demografia` | Meta (`follower_demographics`, conta com 100+ seguidores) |
| Comentários de concorrentes, DMs, respostas a Stories | **Não implementado** | — | A Graph API não entrega; exigem webhooks e permissões de mensagens |
| Creative Intelligence (contexto, audiência, 5 ângulos, formatos, 10+ ganchos, score 0–100, 3 opções, aprovar/editar/novas/combinar/descartar) | Implementado, testado | `criativo.js` | IA gratuita |
| Revisor criativo (10 perguntas, alertas) | Implementado, testado | `roteiros/index.js` | IA gratuita (mesma chamada da banca) |
| Growth Lab (experimentos, grupos A/B com posts reais, amostra mínima, veredito sem "vencedor", decisões) | Implementado, testado | `growthLab.js` | Posts lidos da Meta |
| Community Intelligence (classificação, sugestão de resposta, aprovar/editar/descartar, virar pauta, enviar com confirmação) | Implementado, testado | `comunidade.js` | Permissão `instagram_manage_comments` para ler e responder |
| Distribution Intelligence (desempenho na mesma idade, comentários, Stories, reaproveitamento, nova pauta) | Implementado, testado | `distribuicao.js` | Série por post do placar |
| Conversion Intelligence (objetivo por conteúdo, funil lead → cliente, taxas, sequência editorial, CTA por objetivo) | Implementado, testado | `funil.js` | Registro manual dos leads (sem CRM) |
| Séries (gerenciamento, episódios, desempenho, próximos) | Implementado | `/series`, DNA | Marcar a série ao aprovar |
| Piloto por qualidade (meta menor, fila ordenada por prioridade estratégica, frequência recomendada) | Implementado | `prioridade.js`, `top/piloto.js` | Quem já salvou meta própria mantém a dele |
| Reciclagem por mecanismo (gancho, estrutura, emoção, público, motivo, ângulo Pedro, formato; anti-cópia) | Implementado | `reciclagem/coletar.js` | IA gratuita |
| Cliques, taxa de conclusão, seguidores perdidos | **Indisponível** | — | A Meta não entrega por esta conexão |
| Stories (publicação e métricas) | **Não implementado** | — | Fora do escopo da API atual do app |

Custos: tudo novo é regra (sem IA) ou IA gratuita (`pago: 'nunca'`). A estratégia criativa e a sugestão de resposta são chamadas
sob demanda (um toque do Pedro). Nenhum serviço novo.

Testes: `npm test` (874 testes, incluindo `backend/lib/crescimento.test.js` e `backend/lib/estrategiaCamadas.test.js`) e
conferência no servidor local com dados de teste, em tela de celular. Nada foi testado contra o banco de produção (Neon bloqueada).

## 6. Riscos
1. Neon bloqueada: nada novo foi testado contra produção.
2. Leitura e resposta de comentários dependem da permissão `instagram_manage_comments` no token da Meta; sem ela, a aba avisa.
3. Tema vem das palavras da legenda/comentário: aproximação, sinalizada.
4. Reels não informam seguidores por post (limite da Meta).
5. Amostra pequena: todas as telas exigem mínimo e dizem quantos posts faltam.

## 7. Como o Pedro usa
1. Ajustes → DNA Editorial: revisar posicionamento, pilares e datas da transição; escrever opiniões e frases no banco.
2. Resultados → Atualizar números (ou espere a leitura diária) → Crescimento → Painel e Diagnóstico.
3. Comunidade → Ler comentários → sugerir resposta → aprovar → enviar (com confirmação) ou virar pauta.
4. Audiência → oportunidades → "Levar para a Estratégia criativa" → aprovar a melhor opção (Reel vai para os roteiros; carrossel sai pelo Criar).
5. Lab → criar experimento marcando posts A e B; registrar decisões.
6. Funil → registrar leads e mover de estágio; Fila → ver por que cada conteúdo deve ser aprovado antes.

## 8. Próximas melhorias
- Ler DMs e respostas a Stories por webhook (exige app da Meta revisado e permissões de mensagens).
- Marcação automática de rosto nos primeiros segundos e duração pelos vídeos editados aqui, para o Lab montar grupos sozinho.
- Recomendação de frequência quando houver 8 semanas de dado.

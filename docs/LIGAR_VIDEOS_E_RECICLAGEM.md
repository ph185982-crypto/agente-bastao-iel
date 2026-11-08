# Vídeos e reciclagem: como está ligado

Nada depende de você para funcionar. O que segue é opcional.

## Status: tudo ligado (08/11/2026)
- Armazenamento de vídeo: Vercel Blob `videos-pedro` criado e conectado ao projeto (variável `BLOB_READ_WRITE_TOKEN` nos 3 ambientes).
- Editor automático: GitHub Actions a cada 5 minutos, autenticado por OIDC (`backend/lib/githubOidc.js`); sem segredo cadastrado.
- b-roll: o editor pede os clipes ao app (`/api/videos/worker/pexels`), que usa a chave do Pexels da Vercel.
- Coleta da Reciclagem: todo dia 09:00 de Brasília, também por OIDC.

## Opcionais
- `YOUTUBE_API_KEY` (Vercel): a reciclagem passa a ler também os 20 canais de YouTube. Chave gratuita em console.cloud.google.com → APIs → YouTube Data API v3 → Credenciais.
- `GITHUB_DISPATCH_TOKEN` (Vercel): token do GitHub com permissão `repo`; faz o editor começar na hora em vez de esperar o cron de 5 minutos.

## Como usar
- **Vídeos → Gravar com roteiro**: câmera frontal, roteiro rolando, 3-2-1, grava, "Enviar para edição". Ou **Enviar vídeo da galeria**.
- O vídeo editado aparece em Vídeos e em Aprovar: legenda do Instagram pronta, Baixar, Aprovar e publicar agora, Agendar, Refazer com outro estilo (Hormozi / Beast / Caixa).
- **Reciclar**: todo dia às 9h o radar lê 40 contas de empreendedorismo em 7 países, mede o que saiu da curva (índice VL) e extrai a tese. "Reciclar como" carrossel, post ou reel (abre o teleprompter com o roteiro na sua voz). Nunca copia texto: só a tese e o mecanismo.
- **Criar**: Carrossel, Post único (headline + foto + legenda longa) e Ensaio (texto corrido, fundo escuro).

Nada vai ao Instagram sem a sua aprovação.

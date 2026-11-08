# Ligar os vídeos e a reciclagem (3 passos do Pedro)

Tudo o que o app precisa está no código. Só três coisas dependem de você, porque exigem a sua conta.

## 1. Armazenamento de vídeo na Vercel (obrigatório para a aba Vídeos)
Os vídeos não cabem no banco (512 MB). Eles ficam no **Vercel Blob**, que tem plano gratuito no Hobby.
1. Abra https://vercel.com → projeto **agente-bastao-iel** → aba **Storage**.
2. **Create Database/Store → Blob** → nome `videos-pedro` → **Create**.
3. Em **Connect Project**, escolha **agente-bastao-iel** (ambiente Production). Isso cria sozinho a variável `BLOB_READ_WRITE_TOKEN`.
4. Faça um **Redeploy** (Deployments → ⋯ → Redeploy) para o app enxergar a variável.
Pronto: a aba Vídeos para de mostrar "armazenamento não ligado". O token nunca sai do servidor; celular e editor recebem tokens curtos.

Limite do plano grátis: fique de olho em Storage → Usage. Ao usar "Apagar vídeo" na aba Vídeos, o bruto e o final saem do armazenamento.

## 2. Segredos no GitHub (editor de vídeo)
O editor roda no GitHub Actions (grátis). Em https://github.com/ph185982-crypto/agente-bastao-iel → **Settings → Secrets and variables → Actions**:
- `CRON_SECRET` — já existe (o mesmo da Vercel). Nada a fazer.
- `PEXELS_API_KEY` — **novo secret**, mesma chave do Pexels que está na Vercel. Sem ela o editor pula o b-roll (o resto funciona).
- Variável `MONITOR_URL` — já existe.

O editor passa a cada 5 minutos: um vídeo de 1 minuto leva de 2 a 6 minutos para ficar pronto. Você recebe o aviso no celular.

## 3. Opcionais
- `YOUTUBE_API_KEY` (Vercel): a reciclagem passa a ler também os 20 canais de YouTube. Chave gratuita em console.cloud.google.com → APIs → YouTube Data API v3 → Credenciais.
- `GITHUB_DISPATCH_TOKEN` (Vercel): token do GitHub com permissão `repo`; faz o editor começar na hora em vez de esperar o cron de 5 minutos.

## Como usar
- **Vídeos → Gravar com roteiro**: câmera frontal, roteiro rolando, 3-2-1, grava, "Enviar para edição". Ou **Enviar vídeo da galeria**.
- O vídeo editado aparece em Vídeos e em Aprovar: legenda do Instagram pronta, Baixar, Aprovar e publicar agora, Agendar, Refazer com outro estilo (Hormozi / Beast / Caixa).
- **Reciclar**: todo dia às 9h o radar lê 40 contas de empreendedorismo em 7 países, mede o que saiu da curva (índice VL) e extrai a tese. "Reciclar como" carrossel, post ou reel (abre o teleprompter com o roteiro na sua voz). Nunca copia texto: só a tese e o mecanismo.
- **Criar**: Carrossel, Post único (headline + foto + legenda longa) e Ensaio (texto corrido, fundo escuro).

Nada vai ao Instagram sem a sua aprovação.

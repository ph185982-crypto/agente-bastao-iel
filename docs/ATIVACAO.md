# Ativação: o que ligar para o fluxo completo funcionar

Ordem sugerida. Valores só na Vercel (Settings → Environment Variables); **nunca** em arquivo, commit ou chat.
Depois de mudar variáveis, faça um novo deploy.

## 1. Banco de dados (sem ele o monitor, a Central e a publicação não funcionam)

- Em 22/10/2026 o banco **pedro-destrava-db** (Neon, plano Free) foi conectado ao ambiente **Production** do projeto
  `agente-bastao-iel` (ver `docs/ARMAZENAMENTO.md`). O **Preview não tem banco**.
- Para testar as novidades no Preview: Vercel → Storage → o banco Neon → conectar o projeto também ao ambiente **Preview**
  (cria `DATABASE_URL` no Preview). **Recomendado: um banco/branch separado para o Preview**, para teste não se misturar com conteúdo real
  (o Neon tem *branches* gratuitos). Se usar o mesmo banco do Production, tudo que for testado no Preview aparece no app real.
- Confirme em Perfil → Configurações → "Cópia no servidor".

## 2. IA

- `OPENAI_API_KEY` (e/ou `GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`). A cascata tenta as gratuitas primeiro e a OpenAI por último.
- Marque a variável como **Sensitive**. Defina um **limite de gasto mensal** no painel da OpenAI.
- Se uma chave já apareceu em conversa ou mensagem, gere outra e revogue a antiga.

## 3. Acesso e publicação

- `APP_ACCESS_CODE` (mínimo 10 caracteres): sem ele a API privada responde 503 em ambiente publicado.
- `PUBLISH_SECRET` (frase longa inventada por você) e `PUBLIC_BASE_URL` (endereço do app, sem barra no fim).
- `CRON_SECRET` (frase longa): usado pelo agendador do monitor.
- Instagram: `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN` com as permissões
  `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` e **`instagram_manage_insights`** (aba Resultados).
  Passo a passo em `docs/META_SETUP.md`. Teste com **Pausar publicações** ligado e publique um item de cada vez.

## 4. Avisos no celular (Web Push, gratuito)

1. No seu computador (não no chat): `npx web-push generate-vapid-keys`. Saem duas chaves, pública e privada.
2. Vercel: `VAPID_PUBLIC_KEY` = pública, `VAPID_PRIVATE_KEY` = privada (Sensitive), `VAPID_SUBJECT` = `mailto:seu@email.com`. Novo deploy.
3. No iPhone (iOS 16.4 ou mais): abra o endereço do app no **Safari** → Compartilhar → **Adicionar à Tela de Início** → abra pelo ícone.
4. No app: Perfil → **Ativar notificações** → permitir → **Enviar notificação de teste**.
   Sem o app na Tela de Início o iPhone não entrega notificação.

## 5. Monitor de notícias em alta

- Vem ligado. Só roda com banco + chave de IA. Ajuste o teto de roteiros por dia em Perfil → Configurações → Monitor.
- Com o app aberto ele confere sozinho a cada 30 min. Com o app fechado precisa de agendador: `docs/MONITOR.md`
  (GitHub Actions só depois que o arquivo estiver na branch principal; ou cron-job.org).

## 6. Levar para produção

As novidades estão na branch `claude/create-nexos-paginas-5Yvxh`. A produção só as terá depois de **você** autorizar a mesclagem
na `main` (e a Vercel publicar). Antes, teste no Preview (itens 1 a 5) e peça uma conferência.

## Como saber se está tudo ativo

| O quê | Onde ver |
|---|---|
| Banco | Configurações → "Cópia no servidor" mostra "Conectado ao servidor" |
| Instagram | Configurações → Conexões → "Verificar agora": conta, token, cota |
| IA | Buscar o que está em alta agora (Monitor): sem erro de "chave de IA" |
| Notificação | "Enviar notificação de teste" chega no aparelho |
| Monitor | Monitor → "Última rodada" e "roteiros hoje" |
| Resultados | Aba Resultados → "Atualizar números" |

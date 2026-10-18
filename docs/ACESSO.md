# Como definir o seu código de acesso

O código **nunca** deve ser mandado por chat, e-mail ou mensagem. Defina você mesmo:

1. Entre em vercel.com → projeto `agente-bastao-iel` → **Settings** → **Environment Variables**.
2. Crie (ou edite) `APP_ACCESS_CODE` com **pelo menos 10 caracteres** (de preferência uma frase longa
   que só você conhece). Marque o ambiente: **Preview** agora; **Production** quando promover.
3. Faça um novo deploy (Deployments → ⋯ → Redeploy).
4. Abra o app e entre com o código. O aparelho fica autorizado por 14 dias.

O que acontece:
- Trocar o código **derruba todos os acessos já feitos** (inclusive o do preview usado nos testes).
- Em ambiente publicado (Vercel) **sem código válido**, o app não libera nada que consuma IA, leia links
  ou guarde dados: mostra "Configuração necessária". Isso é validado no **servidor**, não só na tela
  (teste automático cobre todas as rotas).
- Rotas agendadas (cron) só passam com `CRON_SECRET`, que a própria Vercel envia se você criar essa variável.

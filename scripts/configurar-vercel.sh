#!/usr/bin/env bash
# Configura as variáveis de ambiente do Pedro Destrava na Vercel (Production) numa só execução.
# Rode NO SEU COMPUTADOR, na pasta do projeto, com a CLI da Vercel logada (`npx vercel login`).
#
#   bash scripts/configurar-vercel.sh
#
# O que faz:
#   - gera sozinho: PUBLISH_SECRET, CRON_SECRET, APP_ACCESS_CODE e o par de chaves VAPID (notificações);
#   - pede, sem mostrar na tela: a chave da OpenAI (use uma chave NOVA, com limite de gasto definido na OpenAI);
#   - NÃO sobrescreve variável que já existe (confira com `npx vercel env ls production`);
#   - NÃO mexe nas META_* (token do Instagram): veja docs/META_SETUP.md.
# Nada é gravado em arquivo do projeto. Os valores gerados são mostrados UMA vez no seu terminal (anote o código de acesso).
set -euo pipefail

PROJETO="${VERCEL_PROJETO:-agente-bastao-iel}"
URL_APP="${URL_APP:-https://agente-bastao-iel.vercel.app}"
EMAIL_VAPID="${EMAIL_VAPID:-}"
V="npx --yes vercel"

command -v openssl >/dev/null || { echo "Precisa do openssl instalado."; exit 1; }
$V whoami >/dev/null 2>&1 || { echo "Faça login primeiro: npx vercel login"; exit 1; }
[ -f .vercel/project.json ] || $V link --yes --project "$PROJETO" >/dev/null

EXISTENTES="$($V env ls production 2>/dev/null | awk 'NR>2 {print $1}')"
existe() { printf '%s\n' "$EXISTENTES" | grep -qx "$1"; }

# grava NOME VALOR [sensivel]
grava() {
  local nome="$1" valor="$2" sens="${3:-}"
  if existe "$nome"; then echo "  = $nome já existe: mantido."; return 0; fi
  local extra=""; [ -n "$sens" ] && extra="--sensitive"
  if printf '%s' "$valor" | $V env add "$nome" production $extra >/dev/null 2>&1; then echo "  + $nome criado."
  else echo "  ! não consegui criar $nome (talvez já exista): confira no painel."; fi
}
gera() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-"$1"; }

echo "Projeto: $PROJETO  ·  Endereço do app: $URL_APP"
echo
echo "1/4 Acesso e publicação"
NOVO_CODIGO=""
if ! existe APP_ACCESS_CODE; then NOVO_CODIGO="$(gera 20)"; grava APP_ACCESS_CODE "$NOVO_CODIGO" sens; else echo "  = APP_ACCESS_CODE já existe: mantido."; fi
grava PUBLISH_SECRET "$(gera 48)" sens
CRON_NOVO=""
if ! existe CRON_SECRET; then CRON_NOVO="$(gera 48)"; grava CRON_SECRET "$CRON_NOVO" sens; else echo "  = CRON_SECRET já existe: mantido."; fi
grava PUBLIC_BASE_URL "$URL_APP"

echo "2/4 IA (OpenAI)"
if existe OPENAI_API_KEY; then echo "  = OPENAI_API_KEY já existe: mantido."
else
  read -r -s -p "  Cole a chave NOVA da OpenAI (não aparece na tela; Enter para pular): " CHAVE; echo
  if [ -n "${CHAVE:-}" ]; then grava OPENAI_API_KEY "$CHAVE" sens; else echo "  - pulado."; fi
  unset CHAVE
fi

echo "3/4 Notificações no iPhone (VAPID)"
if existe VAPID_PUBLIC_KEY && existe VAPID_PRIVATE_KEY; then echo "  = chaves VAPID já existem: mantidas."
else
  if [ -z "$EMAIL_VAPID" ]; then read -r -p "  Seu e-mail (para o contato das notificações): " EMAIL_VAPID; fi
  JSON="$(npx --yes web-push generate-vapid-keys --json)"
  PUB="$(printf '%s' "$JSON" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
  PRIV="$(printf '%s' "$JSON" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
  [ -n "$PUB" ] && [ -n "$PRIV" ] || { echo "Não consegui gerar as chaves VAPID."; exit 1; }
  grava VAPID_PUBLIC_KEY "$PUB"; grava VAPID_PRIVATE_KEY "$PRIV" sens; grava VAPID_SUBJECT "mailto:$EMAIL_VAPID"
fi

echo "4/4 Agendador do monitor (GitHub), opcional"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && [ -n "$CRON_NOVO" ]; then
  gh variable set MONITOR_URL --body "$URL_APP" && printf '%s' "$CRON_NOVO" | gh secret set CRON_SECRET && echo "  + MONITOR_URL e CRON_SECRET criados no GitHub."
else
  echo "  - Crie no GitHub (Settings → Secrets and variables → Actions): variável MONITOR_URL = $URL_APP e secret CRON_SECRET = o mesmo valor do CRON_SECRET da Vercel."
  [ -n "$CRON_NOVO" ] && echo "    CRON_SECRET gerado agora (cole no GitHub; não será mostrado de novo): $CRON_NOVO"
fi

echo
echo "Pronto. Faça um novo deploy para as variáveis valerem:  npx vercel --prod"
[ -n "$NOVO_CODIGO" ] && echo "SEU CÓDIGO DE ACESSO (anote agora, não será mostrado de novo): $NOVO_CODIGO"
echo "Faltam, se ainda não existirem: DATABASE_URL (conecte o banco Neon ao projeto no painel) e as META_* do Instagram (docs/META_SETUP.md)."

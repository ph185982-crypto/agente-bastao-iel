#!/usr/bin/env bash
# Publica o app no Google Cloud Run (substitui a Vercel) e cria as 3 tarefas gratuitas do Cloud Scheduler.
# Uso: PROJETO=pedro-destrava ENV_FILE=/caminho/fora-do-repo/env.yaml tools/gcloud/deploy.sh
#   ENV_FILE: YAML "CHAVE: valor" com as variáveis do servidor. NUNCA versionar (tem segredos).
# Escolhas para custar zero dentro da cota gratuita:
#   • 1 instância no máximo (o app guarda estado de trabalho em memória) e 0 no mínimo (desliga parado);
#   • cobrança por requisição (CPU só durante as chamadas): o trabalho em etapas (estúdio, radar, relógio do piloto)
#     vai pela fila "pedro" do Cloud Tasks, que chama o próprio app — o mesmo papel da fila da Vercel.
set -euo pipefail
PROJETO="${PROJETO:?defina PROJETO}"; REGIAO="${REGIAO:-southamerica-east1}"; SERVICO="${SERVICO:-agente-bastao-iel}"
ENV_FILE="${ENV_FILE:?defina ENV_FILE}"
cd "$(dirname "$0")/../.."
gcloud config set project "$PROJETO" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com cloudtasks.googleapis.com
gcloud tasks queues describe pedro --location "$REGIAO" >/dev/null 2>&1 || gcloud tasks queues create pedro --location "$REGIAO"
NUM=$(gcloud projects describe "$PROJETO" --format 'value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJETO" --member "serviceAccount:$NUM-compute@developer.gserviceaccount.com" --role roles/cloudtasks.enqueuer --condition None --quiet >/dev/null
ENV_COMPLETO=$(mktemp); trap 'rm -f "$ENV_COMPLETO"' EXIT
grep -v '^GCP_\(PROJETO\|REGIAO\):' "$ENV_FILE" > "$ENV_COMPLETO"; printf 'GCP_PROJETO: "%s"\nGCP_REGIAO: "%s"\n' "$PROJETO" "$REGIAO" >> "$ENV_COMPLETO"
gcloud run deploy "$SERVICO" --source . --region "$REGIAO" --allow-unauthenticated \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 1 --concurrency 40 --timeout 1800 \
  --env-vars-file "$ENV_COMPLETO" --quiet
URL=$(gcloud run services describe "$SERVICO" --region "$REGIAO" --format 'value(status.url)')
echo "URL: $URL"
SEGREDO=$(python3 -c "import sys,yaml;print(yaml.safe_load(open(sys.argv[1]))['CRON_SECRET'])" "$ENV_FILE")
tarefa() { # nome, agenda (UTC), caminho
  local args=(--location "$REGIAO" --schedule "$2" --time-zone "Etc/UTC" --uri "$URL$3" --http-method GET
    --headers "Authorization=Bearer $SEGREDO" --attempt-deadline 300s --quiet)
  gcloud scheduler jobs create http "$1" "${args[@]}" 2>/dev/null || gcloud scheduler jobs update http "$1" "${args[@]}"
}
tarefa piloto      '7 * * * *'    /api/top/piloto/rodada                      # rede de segurança: o relógio de verdade é a fila
tarefa manha       '0 10 * * *'   '/api/cron/lote?r=content-finder,radar'      # 07:00 Brasília
tarefa meio-dia    '0 12 * * *'   '/api/cron/lote?r=trending'                  # 09:00 Brasília
echo "Pronto: $URL"

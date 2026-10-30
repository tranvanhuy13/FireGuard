#!/usr/bin/env bash
# One-time GCP infrastructure for FireGuard. Safe to re-run: existing resources are skipped.
#
#   PROJECT_ID=my-project GITHUB_REPO=owner/FireGuard ./deploy/gcp-setup.sh <step>
#
# Steps (run in order, or "all"):
#   apis       enable required APIs
#   registry   Artifact Registry docker repo
#   bucket     Cloud Storage bucket for snapshots + model
#   vm         service account, static IP, firewall, VM (Docker installed by startup script)
#   wif        Workload Identity Federation + deployer service account for GitHub Actions
#   model      upload backend/best.pt to the bucket
#   env        write /opt/fireguard/.env on the VM (needs GMAIL_ADDRESS, asks for its App Password)
#   outputs    print the values to set as GitHub repository variables
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${GITHUB_REPO:?set GITHUB_REPO (owner/name)}"
REGION="${REGION:-asia-southeast1}"
ZONE="${ZONE:-asia-southeast1-b}"
VM_NAME="${VM_NAME:-fireguard}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"
DISK_SIZE="${DISK_SIZE:-30GB}"
AR_REPO="${AR_REPO:-fireguard}"
BUCKET="${BUCKET:-${PROJECT_ID}-fireguard}"
VM_SA="fireguard-vm@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="fireguard-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_POOL="github"
WIF_PROVIDER="github"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
g() { gcloud --project "$PROJECT_ID" "$@"; }
exists() { "$@" >/dev/null 2>&1; }

step_apis() {
  g services enable compute.googleapis.com artifactregistry.googleapis.com \
    storage.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
    sts.googleapis.com iap.googleapis.com
}

step_registry() {
  exists g artifacts repositories describe "$AR_REPO" --location "$REGION" ||
    g artifacts repositories create "$AR_REPO" --location "$REGION" --repository-format docker
  # Keep the 10 most recent images per package, drop the rest
  cat >/tmp/fireguard-ar-policy.json <<'EOF'
[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":10}},
 {"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"30d"}}]
EOF
  g artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" \
    --policy /tmp/fireguard-ar-policy.json --no-dry-run
}

step_bucket() {
  exists g storage buckets describe "gs://$BUCKET" ||
    g storage buckets create "gs://$BUCKET" --location "$REGION" \
      --uniform-bucket-level-access --public-access-prevention
  # Periodic snapshots (every 10 s per camera) are deleted after 30 days; event snapshots are kept
  cat >/tmp/fireguard-lifecycle.json <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":30,"matchesPrefix":["snapshots/periodic_"]}}]}
EOF
  g storage buckets update "gs://$BUCKET" --lifecycle-file /tmp/fireguard-lifecycle.json
}

step_vm() {
  exists g iam service-accounts describe "$VM_SA" ||
    g iam service-accounts create fireguard-vm --display-name "FireGuard VM"
  g storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member "serviceAccount:$VM_SA" --role roles/storage.objectAdmin >/dev/null
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
    --member "serviceAccount:$VM_SA" --role roles/artifactregistry.reader >/dev/null
  for role in roles/logging.logWriter roles/monitoring.metricWriter; do
    g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$VM_SA" \
      --role "$role" --condition None >/dev/null
  done

  exists g compute addresses describe "$VM_NAME-ip" --region "$REGION" ||
    g compute addresses create "$VM_NAME-ip" --region "$REGION"

  exists g compute firewall-rules describe fireguard-allow-web ||
    g compute firewall-rules create fireguard-allow-web --network default \
      --allow tcp:80,tcp:443 --target-tags fireguard --source-ranges 0.0.0.0/0
  # SSH only through Identity-Aware Proxy (used by GitHub Actions and `gcloud compute ssh --tunnel-through-iap`)
  exists g compute firewall-rules describe fireguard-allow-iap-ssh ||
    g compute firewall-rules create fireguard-allow-iap-ssh --network default \
      --allow tcp:22 --target-tags fireguard --source-ranges 35.235.240.0/20

  exists g compute instances describe "$VM_NAME" --zone "$ZONE" ||
    g compute instances create "$VM_NAME" --zone "$ZONE" \
      --machine-type "$MACHINE_TYPE" \
      --image-family debian-12 --image-project debian-cloud \
      --boot-disk-size "$DISK_SIZE" --boot-disk-type pd-balanced \
      --address "$VM_NAME-ip" --tags fireguard \
      --service-account "$VM_SA" --scopes cloud-platform \
      --metadata enable-oslogin=TRUE \
      --metadata-from-file startup-script="$ROOT/deploy/vm-startup.sh"
}

step_wif() {
  local project_number
  project_number=$(g projects describe "$PROJECT_ID" --format 'value(projectNumber)')

  exists g iam service-accounts describe "$DEPLOY_SA" ||
    g iam service-accounts create fireguard-deployer --display-name "FireGuard GitHub deployer"
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
    --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer >/dev/null
  # SSH (with sudo) to the VM through IAP
  for role in roles/compute.osAdminLogin roles/compute.viewer roles/iap.tunnelResourceAccessor; do
    g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" \
      --role "$role" --condition None >/dev/null
  done
  # OS Login on a VM that runs as $VM_SA requires actAs on it
  g iam service-accounts add-iam-policy-binding "$VM_SA" \
    --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser >/dev/null

  exists g iam workload-identity-pools describe "$WIF_POOL" --location global ||
    g iam workload-identity-pools create "$WIF_POOL" --location global --display-name "GitHub Actions"
  exists g iam workload-identity-pools providers describe "$WIF_PROVIDER" \
      --workload-identity-pool "$WIF_POOL" --location global ||
    g iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
      --workload-identity-pool "$WIF_POOL" --location global \
      --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition "assertion.repository == '$GITHUB_REPO'"
  # Only the main branch of this repository may impersonate the deployer
  g iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
    --role roles/iam.workloadIdentityUser \
    --member "principal://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/$WIF_POOL/subject/repo:$GITHUB_REPO:ref:refs/heads/main" >/dev/null
}

step_model() {
  g storage cp "$ROOT/backend/best.pt" "gs://$BUCKET/models/best.pt"
}

step_env() {
  local ip domain gmail_pass
  ip=$(g compute addresses describe "$VM_NAME-ip" --region "$REGION" --format 'value(address)')
  domain="${DOMAIN:-$ip.sslip.io}"
  : "${GMAIL_ADDRESS:?set GMAIL_ADDRESS (sender of the login OTP e-mails)}"
  read -rsp "Gmail App Password for $GMAIL_ADDRESS: " gmail_pass; echo
  g compute ssh "$VM_NAME" --zone "$ZONE" --tunnel-through-iap --command "sudo tee /opt/fireguard/.env >/dev/null && sudo chmod 600 /opt/fireguard/.env" <<EOF
REGISTRY=$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO
TAG=latest
DOMAIN=$domain
GCS_BUCKET=$BUCKET
GMAIL_ADDRESS=$GMAIL_ADDRESS
GMAIL_APP_PASSWORD=$gmail_pass
AUTH_DEV_MODE=false
STREAM_TOKEN_SECRET=$(openssl rand -hex 32)
EOF
  echo "Wrote /opt/fireguard/.env on $VM_NAME (site: https://$domain)"
  echo "Before deployment, add MYSQL_* and MYSQL_SSL_CA_HOST_PATH from deploy/env.example and provision the Aiven CA on the VM."
}

step_outputs() {
  local project_number
  project_number=$(g projects describe "$PROJECT_ID" --format 'value(projectNumber)')
  cat <<EOF
GitHub repository variables (Settings > Secrets and variables > Actions > Variables):
  GCP_PROJECT_ID = $PROJECT_ID
  GCP_REGION     = $REGION
  GCP_ZONE       = $ZONE
  VM_NAME        = $VM_NAME
  AR_REPO        = $AR_REPO
  DEPLOY_SA      = $DEPLOY_SA
  WIF_PROVIDER   = projects/$project_number/locations/global/workloadIdentityPools/$WIF_POOL/providers/$WIF_PROVIDER
EOF
}

case "${1:-}" in
  apis|registry|bucket|vm|wif|model|env|outputs) "step_$1" ;;
  all) for s in apis registry bucket vm wif model; do echo "== $s"; "step_$s"; done; step_outputs ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac

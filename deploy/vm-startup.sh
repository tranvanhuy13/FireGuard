#!/bin/bash
# Compute Engine startup script (runs as root on every boot; installs only once).
set -euo pipefail

if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# root pulls from Artifact Registry with the VM service account
REGION=$(curl -fs -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/zone | awk -F/ '{print $NF}' | sed 's/-[a-z]$//')
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

mkdir -p /opt/fireguard

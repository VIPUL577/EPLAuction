#!/usr/bin/env bash
# Builds the Lambda bundles and deploys/updates the whole CloudFormation stack with AWS SAM.
# First run: ./scripts/deploy-backend.sh --guided   (answers are saved in infra/samconfig.toml)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building backend"
cd "$ROOT/backend"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
npm test
npm run build

echo "==> Deploying stack"
cd "$ROOT/infra"
if [[ "${1:-}" == "--guided" ]]; then
  sam deploy --guided --template-file template.yaml --capabilities CAPABILITY_IAM
else
  sam deploy --template-file template.yaml --capabilities CAPABILITY_IAM "$@"
fi

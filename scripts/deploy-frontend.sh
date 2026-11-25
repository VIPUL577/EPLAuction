#!/usr/bin/env bash
# Builds the React app, writes config.json from the stack outputs, uploads to S3 and
# invalidates CloudFront. Usage: ./scripts/deploy-frontend.sh [stack-name] (default epl-auction)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${1:-epl-auction}"

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET=$(out SiteBucketName)
DIST=$(out DistributionId)
WS=$(out WebSocketUrl)
REGION=$(out Region)
CLIENT=$(out UserPoolClientId)
SITE=$(out SiteUrl)

echo "==> Building frontend"
cd "$ROOT/frontend"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
npm run build

cat > dist/config.json <<JSON
{
  "apiBase": "/api",
  "wsUrl": "$WS",
  "cognito": { "region": "$REGION", "clientId": "$CLIENT" }
}
JSON

echo "==> Uploading to s3://$BUCKET"
# Hashed assets: cache for a year. index.html + config.json: always revalidate.
aws s3 sync dist "s3://$BUCKET" --delete \
  --exclude index.html --exclude config.json \
  --cache-control "public, max-age=31536000, immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache"
aws s3 cp dist/config.json "s3://$BUCKET/config.json" --cache-control "no-cache"

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/index.html" "/config.json" >/dev/null

echo "Done. Public site: $SITE   Admin: $SITE/admin"

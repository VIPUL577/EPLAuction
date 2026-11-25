#!/usr/bin/env bash
# Creates (or resets) an admin login in Cognito with a permanent password.
# Usage: ./scripts/create-admin.sh <username> <password> <master|admin> [stack-name]
set -euo pipefail
USERNAME="$1"; PASSWORD="$2"; GROUP="$3"; STACK="${4:-epl-auction}"
[[ "$GROUP" == "master" || "$GROUP" == "admin" ]] || { echo "group must be master or admin"; exit 1; }

POOL=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$USERNAME" \
  --message-action SUPPRESS >/dev/null 2>&1 || echo "(user exists, updating password/group)"
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$USERNAME" \
  --password "$PASSWORD" --permanent
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$USERNAME" --group-name "$GROUP"
echo "OK: $USERNAME is a $GROUP"

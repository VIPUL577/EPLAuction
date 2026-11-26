#!/usr/bin/env bash
# Creates (or resets) the hardcoded master admin and the 4 admins in Cognito.
# Usage: ./scripts/create-all-admins.sh [stack-name]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="${1:-epl-auction}"

"$DIR/create-admin.sh" eashan 'unsoldEashan' master "$STACK"
"$DIR/create-admin.sh" admin1 'Pass@7'       admin  "$STACK"
"$DIR/create-admin.sh" admin2 'Pass@11'      admin  "$STACK"
"$DIR/create-admin.sh" admin3 'Pass@15'      admin  "$STACK"
"$DIR/create-admin.sh" admin4 'Pass@19'      admin  "$STACK"

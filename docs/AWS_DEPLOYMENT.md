# AWS deployment: step by step

Everything is one CloudFormation stack (`infra/template.yaml`), deployed with the AWS SAM CLI. The site gets the default CloudFront URL `https://dxxxxxxxx.cloudfront.net`, so there is no domain to buy and no certificate to manage.

**Recommended region:** `ap-south-1` (Mumbai), for the lowest latency to an Indian audience. Any region works.

---

## 0. Install the tools (once, on your laptop)

| Tool | Install | Check |
|---|---|---|
| Node.js 22 LTS | https://nodejs.org (or `nvm install 22`) | `node -v` |
| AWS CLI v2 | https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html | `aws --version` |
| AWS SAM CLI | https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html | `sam --version` |

## 1. AWS account and safety rails

1. Create an AWS account at https://aws.amazon.com/free (or use an existing one).
   - Accounts created **on or after 15 July 2025** choose between the **Free plan** (no charges at all, up to $200 in credits, valid 6 months) and the **Paid plan**. **Pick the Free plan.** On the Free plan AWS cannot bill you: usage beyond the always-free allowances is paid from the credits. **Never click "Upgrade to paid plan".**
   - Older accounts have the classic 12-month Free Tier.
2. Turn on **MFA** for the root user: *IAM → Dashboard → Add MFA*.
3. Create a user for deployments instead of using root:
   *IAM Identity Center → Enable → Users → Add user* → give it the **AdministratorAccess** permission set. Then on your laptop run `aws configure sso` and follow the prompts.
   (The simpler alternative is an IAM user with AdministratorAccess and an access key, set up with `aws configure`. Delete the key after the tournament.)
4. Check it works: `aws sts get-caller-identity`.
5. **Billing alerts** (all free):
   - *Billing and Cost Management → Billing preferences* → enable **Free Tier usage alerts** and **Receive billing alerts** (add your email).
   - *Budgets → Create budget → Use a template → **Zero spend budget*** → your email. (The stack can also create a $1 budget for you: see `AlertEmail` below.)

## 2. Deploy the backend and infrastructure

From the repository root:

```bash
./scripts/deploy-backend.sh --guided
```

This installs dependencies, runs the tests, bundles the Lambdas, and then asks:

| Prompt | Answer |
|---|---|
| Stack Name | `epl-auction` (the other scripts assume this name) |
| AWS Region | `ap-south-1` |
| Parameter ReadCapacity / WriteCapacity | Enter (20 / 20). The DynamoDB Free Tier covers 25/25 per region **in total**, so lower these if you already have other tables. |
| Parameter AlertEmail | your email (creates a free AWS Budget alert), or Enter to skip |
| Parameter BudgetUsd | Enter (1) |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI IAM role creation | `Y` |
| Disable rollback | `N` |
| HttpFunction has no authentication. Is this okay? | `y`. Only `/api/public/*` is unauthenticated, and it is read-only. `/api/admin/*` uses Cognito. |
| Save arguments to configuration file | `Y` |

Review the change set (about 30 resources), then confirm. The first deploy takes **5–10 minutes**, mostly because CloudFront is slow to create. When it finishes, SAM prints the outputs:

```
SiteUrl        https://d1abcd2efgh3.cloudfront.net        <- the public link to share
AdminUrl       https://d1abcd2efgh3.cloudfront.net/admin
WebSocketUrl   wss://xxxx.execute-api.ap-south-1.amazonaws.com/prod
UserPoolId ... UserPoolClientId ... SiteBucketName ... DistributionId ...
```

If you set `AlertEmail`, AWS sends a confirmation email for the budget. Click the link in it.

To redeploy later (after code changes): `./scripts/deploy-backend.sh` (no `--guided`).

## 3. Create the 5 admin logins

One master and four admins, with hardcoded credentials:

| Username | Password | Role |
|---|---|---|
| `eashan` | `unsoldEashan` | master |
| `admin1` | `Pass@7` | admin |
| `admin2` | `Pass@11` | admin |
| `admin3` | `Pass@15` | admin |
| `admin4` | `Pass@19` | admin |

```bash
./scripts/create-all-admins.sh
```

The username and password decide the role: users in the `master` group get the Setup tab and the master powers. You can rerun the script to reset a password. Users can also be managed in the console: *Cognito → User pools → epl-auction-admins*.

## 4. Deploy the website

```bash
./scripts/deploy-frontend.sh
```

This builds the React app, writes `config.json` (WebSocket URL, Cognito client ID) from the stack outputs, uploads it to the private S3 bucket and invalidates CloudFront. Open the printed **SiteUrl**. That is your default link.

## 5. Google Sheet setup (master admin)

1. Create the sheet. You can import `seed/players-sample.csv` (*File → Import*) to get the right columns, then replace the rows with the real players.
2. *Share → General access → **Anyone with the link → Viewer***. Do the same for the Drive folder with the player photos.
3. *Extensions → Apps Script* → paste `docs/google-apps-script.gs` → change `SECRET` → *Deploy → New deployment → Web app* (Execute as **Me**, Who has access **Anyone**) → authorise → copy the `/exec` URL.
4. Open `https://<SiteUrl>/admin` and log in as `eashan` (master). In **Setup**: paste the sheet link, the Apps Script URL and the secret → **Save settings** → **Import players from sheet**.
5. In **Teams**: fill in the owners (link owner-players, tick owner-captains). In **Setup**: tick the captains → **Save captains**.
6. On auction day: **Setup → Start auction**.

## 6. Dry run (strongly recommended)

The day before: run 10–15 players with two admins on two laptops and a few phones watching. Then **Setup → Reset auction**. That keeps the players, teams and owners and clears every sale.

Optional load test (costs a few cents of WebSocket usage, which the Free Tier or credits cover):

```bash
cd backend && WS_URL=wss://xxxx.execute-api.ap-south-1.amazonaws.com/prod N=300 DURATION=300 npm run loadtest
```

Place some bids while it runs. Every broadcast should reach `300/300`. Don't claim 300-viewer support until this passes.

## 7. During the tournament

- Admin dashboard: laptop only. Keys: `N` draw, `1`–`8` team, `↑` bid, `⌫` undo, `E` end bid.
- If two admins press at the same moment, one succeeds and the other sees "Another admin changed the auction first", and their screen refreshes. Nothing is applied twice.
- Viewers reconnect automatically. A phone that sleeps for a while catches up when it wakes.
- Every action is listed in **Audit**, with the admin's name, time and state version, for settling disputes.

## 8. After the tournament: tear down (stops all charges)

```bash
STACK=epl-auction
BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue" --output text)
TABLE=$(aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)
aws s3 rm "s3://$BUCKET" --recursive        # the bucket must be empty before deletion
sam delete --stack-name $STACK              # removes everything else
aws dynamodb delete-table --table-name "$TABLE"   # the table is kept on purpose (DeletionPolicy: Retain); export first if you want the data
```

Also delete the SAM artifacts stack if you don't need it: `aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default` (empty its S3 bucket first).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login says `NEW_PASSWORD_REQUIRED` | Rerun `create-admin.sh` (it sets a permanent password). |
| Login works but you get "not in the master or admin group" | `aws cognito-idp admin-add-user-to-group ...` or rerun the script with the right group. |
| "Google returned a login page" when importing | The sheet isn't shared as *Anyone with the link*. |
| Photos show initials only | Share the photo files (or their folder) as *Anyone with the link*. |
| Site shows the old version after a deploy | Wait about a minute for the invalidation, then hard-refresh. |
| Connection badge says "Offline" | Check that `WebSocketUrl` in `config.json` matches the stack output, then rerun `deploy-frontend.sh`. |

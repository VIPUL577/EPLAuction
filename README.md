# EPL 2026 Auction

A real-time cricket player auction for the EPL 2026 (14th Edition) gully cricket tournament.

- **Public viewers** (no login) watch on the big screen or on their phones: the live player, current bid, squads, purses, players sold and left, top buys and the rules.
- **Admins** (desktop, Cognito login) run the auction: draw players, raise the bid with the **PgUp** (or **↑**) key, undo, and end bids (pick the buying team, or unsold).
- **The master admin** also controls setup: the Google Sheet link, the bid ladder and multipliers, categories, teams, owners, captains, start and reset.

Everything runs serverless on AWS and is sized to stay within the Free Tier (see [docs/COSTS.md](docs/COSTS.md)). The site is served from the default CloudFront address (`https://dxxxx.cloudfront.net`), so no custom domain is needed.

```
Browser ──HTTPS──> CloudFront ──> S3 (React app)
   │                   └──/api/*──> API Gateway HTTP API ──> Lambda ──> DynamoDB
   │                                   (Cognito JWT on /api/admin/*)      │
   └──WSS──> API Gateway WebSocket API ──> Lambda (connect/disconnect)    │
                 ▲                                                        │
                 └──────────── broadcast after every committed change ────┘
```

## Repository layout

```
backend/            Node.js + TypeScript (Lambda handlers, auction engine, tests)
  src/core/         types, rules (ladder, wallet, auto-assign), engine, router, Google Sheet I/O
  src/store/        DynamoDB store (production) + in-memory store (dev/tests)
  src/aws/          Lambda entry points (HTTP, WebSocket) and the WebSocket broadcaster
  src/dev/          local dev server (same engine, in-memory, `ws`)
  test/             node:test unit and flow tests
  loadtest.mjs      WebSocket load test (N concurrent viewers)
frontend/           React + TypeScript + Vite (public viewer + admin dashboard)
infra/template.yaml AWS SAM / CloudFormation: every AWS resource in one stack
scripts/            deploy-backend.sh, deploy-frontend.sh, create-admin.sh, create-all-admins.sh
docs/               ARCHITECTURE.md, AWS_DEPLOYMENT.md, COSTS.md, google-apps-script.gs
seed/               players-sample.csv (88 players, ready to paste into Google Sheets)
content/            original logo
```

## Run locally (no AWS needed)

Requirements: **Node.js 22+** and npm.

```bash
# terminal 1: API + WebSocket on :8787, seeded with 88 demo players
cd backend && npm install && npm run dev

# terminal 2: web app on :5173 (proxies /api to :8787)
cd frontend && npm install && npm run dev
```

- Public view: http://localhost:5173 (shrink the window below 820px to see the phone layout)
- Admin: http://localhost:5173/admin. Logins: `eashan` / `unsoldEashan` (master), `admin1` / `Pass@7`, `admin2` / `Pass@11`, `admin3` / `Pass@15`, `admin4` / `Pass@19`.

Try it out: log in as `eashan`, go to **Setup**, tick 8 captains, **Save captains**, **Start auction**. Then on **Auction**: `N` draws a player, `PgUp` (or `↑`) raises the bid one ladder step, `⌫` undoes, `E` ends the bid and lets you tick the team that bought the player. Open a second browser as `admin1` to see live sync and the concurrency protection.

Run the tests with `cd backend && npm test`.

## Deploy to AWS

See **[docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md)** for the full step-by-step guide. In short:

```bash
./scripts/deploy-backend.sh --guided                  # creates the stack (once), later just ./scripts/deploy-backend.sh
./scripts/create-all-admins.sh                        # eashan (master) + admin1..admin4
./scripts/deploy-frontend.sh                          # builds + uploads the site
```

## The Google Sheet

Columns (row 1 = headers): **Sl No | Name | Photo (Google Drive link) | Category | Base price (lakhs) | Final team**.
Category names must match the Setup categories (e.g. `All-rounder 1`, `Impact player 3`). `seed/players-sample.csv` shows the format.

- **Read:** share the sheet as *Anyone with the link can view*. The master pastes the link in Setup and clicks **Import players**. Any admin can click **Refresh from sheet** to pull name, photo and base-price edits.
- **Write-back:** paste [docs/google-apps-script.gs](docs/google-apps-script.gs) into *Extensions → Apps Script* and deploy it as a Web App. Then the final team (column F) and the price (column G) are filled in automatically after every sale.
- **Photos:** share each Drive photo as *Anyone with the link*. They are displayed resized to 600px.

## Auction rules implemented

| Rule | Where |
|---|---|
| 8 teams, 11 categories, ₹18 Cr budget, exactly 1 player per category | `rules.ts eligibilityError`, Setup |
| Bid ladder +10 L below ₹2 Cr, +20 L from ₹2 Cr, continues from odd bases (85, 95 … 195, 205, 225) | `rules.ts nextBid` |
| Wallet: after a purchase, keep 2× base of every unfilled category | `rules.ts affordError` |
| Owner-player auto-assigned to own team at 3× category base | `engine.ts start` |
| Captains first, random order, category base price; last captain → last team at 3× | `engine.ts draw`, `rules.ts nextAutoAssignment` |
| Last player of each category → last team needing it at 2× | `rules.ts nextAutoAssignment` |
| All thresholds, steps and multipliers editable by the master | Setup tab → `engine.ts saveConfig` |
| Two-team bidding conduct (not tracked by the app) | Rules page |
| Full audit trail (who, what, when, version) | Audit tab, DynamoDB `AUDIT` partition |

Unsold players go back into the pool and are drawn again after every fresh player has come up. The master can **revert a sale** (Players tab) or **override the price** when ending a bid, as an escape hatch for disputes. Both are audited.

## Security model

- Every write goes through `/api/admin/*`. API Gateway checks the Cognito JWT there, and the Lambda checks the role (`master` or `admin` Cognito group) for each command. Hiding buttons in the UI is not what protects the data.
- The WebSocket only receives. Messages from viewers are ignored, apart from keep-alive pings.
- There are no AWS credentials in the frontend. The S3 bucket is private and only CloudFront can read it (Origin Access Control).
- The Lambdas have least-privilege IAM: CRUD on one table, plus `ManageConnections` on one WebSocket API.
- The Google Apps Script secret is never sent to viewers (the public config has the sheet fields removed).

# Cost estimate (one-month tournament, about 300 concurrent viewers)

> Prices and Free Tier rules change. Check https://aws.amazon.com/free and each service's pricing page before deploying. The figures below are for estimation only. They are **not** a promise of zero cost.

## How the AWS Free Tier works now

| Account created | What you get |
|---|---|
| **On or after 15 July 2025** | **Free plan**: $100 in credits on sign-up plus up to $100 more for completing onboarding tasks, valid for 6 months, and the **always-free** offers. AWS does not charge a Free-plan account: usage beyond the always-free limits is taken from the credits. |
| Before 15 July 2025 | The legacy 12-month Free Tier (which includes API Gateway: 1M HTTP calls, 1M WebSocket messages and 750k connection-minutes per month) plus the always-free offers. |

## Usage assumptions

- **Auction day:** 4 hours, 300 viewers connected, 88 players, about 12 bids per player. That is roughly 1,300 state changes in total, each one broadcast to every viewer.
- **Rest of the month:** about 50 people check squads for 10 minutes a day.
- The 5 admins send about 2,000 commands in total.

## Per service

| Service | Free allowance | Estimated usage | Cost if nothing were free |
|---|---|---|---|
| **API Gateway WebSocket** messages | 1M/month (legacy 12-month tier only) | 1,300 broadcasts × 300 viewers ≈ 390k, plus keep-alive pings ≈ 10k → **≈ 0.4M** | $1.00 per M → **≈ $0.40** |
| **API Gateway WebSocket** connection-minutes | 750k/month (legacy only) | 300 × 240 min + light use ≈ **90k** | $0.25 per M → **≈ $0.02** |
| **API Gateway HTTP API** calls | 1M/month (legacy only) | Snapshot reads are cached by CloudFront (2 s / per roster version), plus admin commands → **< 20k** | $1.00 per M → **≈ $0.02** |
| **Lambda** | **Always free:** 1M requests and 400k GB-s per month | ≈ 25k invocations, ≈ 1k GB-s | **$0** |
| **DynamoDB** (provisioned, 20 RCU / 20 WCU) | **Always free:** 25 RCU, 25 WCU, 25 GB per region | 1 table, < 5 MB | **$0** (stays at $0 as long as your total across all tables stays ≤ 25/25) |
| **CloudFront** | **Always free:** 1 TB out and 10M requests per month | ≈ 300 × 6 MB ≈ 2 GB, < 100k requests | **$0** |
| **CloudFront Functions** | **Always free:** 2M invocations | < 100k | **$0** |
| **S3** | 5 GB (legacy 12-month) / credits | < 1 MB stored, a few thousand GETs from CloudFront | **< $0.01** |
| **Cognito** (Essentials or Lite) | **Always free:** 10k monthly active users | 5 admins | **$0** |
| **CloudWatch Logs** | **Always free:** 5 GB | < 100 MB (14-day retention set) | **$0** |
| **AWS Budgets** | 2 budgets free | 1–2 | **$0** |

**Worst case, with no API Gateway free tier at all: about $0.50 for the month.** On a Free-plan account this comes out of the credits, so you pay $0. On a legacy account within its first 12 months it is all inside the free allowances.

## Built-in cost optimisations

- **No polling.** Viewers receive pushes over the WebSocket. Bid messages are tiny (the auction state only, well under the 32 KB message unit).
- **Roster refreshes go through CloudFront.** When players or teams change, viewers fetch `/api/public/snapshot?rv=N`. CloudFront collapses 300 identical requests into a single Lambda/DynamoDB hit.
- **Background tabs drop their socket** after 3 minutes and reconnect when shown again. This saves connection-minutes.
- **Keep-alive is one ping every 8 minutes** (API Gateway's idle timeout is 10 minutes).
- **DynamoDB:** a bid is a single conditional `PutItem` of a small item. Transactions are used only when several records must change together (sales, setup). There are no Scans and no GSIs, so all capacity stays inside the free 25/25.
- **Lambdas run on arm64** with 256 MB / 128 MB memory, the AWS SDK comes from the runtime (small bundles mean fast cold starts), and logs are kept for 14 days.
- **Throttles on the APIs** (HTTP 50 rps, WebSocket 100 rps) cap the damage from abuse.
- **Photos** come from Google Drive, resized to 600px (`=w600`), so S3 stores no images.

## What could cost money

- More than 25 RCU/WCU in total across your account in the region (from other projects).
- Leaving the stack running for months on a legacy account after its 12-month Free Tier ends (still cents).
- Running the load test many times (each 300-connection, 10-minute run uses about 3k connection-minutes plus messages).
- Upgrading a Free-plan account to a paid plan. **Don't**, unless you mean to.

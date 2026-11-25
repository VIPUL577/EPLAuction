# Architecture

## Components

| Piece | AWS service | Notes |
|---|---|---|
| Static site (React) | S3 (private) + CloudFront (OAC) | Default `*.cloudfront.net` URL. A CloudFront Function rewrites `/admin` and other app paths to `/index.html`. |
| REST API | API Gateway **HTTP API** → 1 Lambda (`HttpFunction`) | Reached through CloudFront at `/api/*`, so it is same-origin and needs no CORS. `/api/public/*` is cacheable, `/api/admin/*` needs a JWT. |
| Real-time | API Gateway **WebSocket API** → 1 Lambda (`WsFunction`) | `$connect`, `$disconnect`, `$default` (pings). The HTTP Lambda broadcasts through `@connections`. |
| Data | DynamoDB, one table, provisioned 20/20 | Single-table design, TTL on connections. |
| Admin auth | Cognito user pool + groups `master` and `admin` | The HTTP API JWT authorizer validates ID tokens. The Lambda maps the group to a role. |

## Request flow for a bid

1. The admin presses **PgUp** (or **↑**). Bids are not tied to a team. The browser sends `POST /api/admin/bid {version, requestId}` with `Authorization: Bearer <Cognito ID token>`.
2. API Gateway validates the JWT. The Lambda reads `META/CONFIG` and `META/STATE` (1 BatchGet), the team and the player.
3. The server validates everything: the player is live, the ladder or custom amount is valid, and at least one team can still pay it (category open, captain slot open in the captains round, wallet rule passes). The buying team is only chosen at **Sold**, where the same checks run for that team.
4. The Lambda does a conditional `PutItem` on `META/STATE` with `version = :expected`. If another admin wrote first, the condition fails, the server returns **409 with the latest state**, and that admin's screen refreshes. If the same `requestId` arrives again (a network retry), the server returns success without applying it twice.
5. Only after the write succeeds: an audit row and a bid-history row are written, and `{type:"state", state}` is posted to every WebSocket connection. Connections that are gone (HTTP 410) are deleted.
6. Viewers apply the state if `version` is newer than what they have.

Sales, unsold marks and setup changes use a **DynamoDB transaction** (state + players + teams) guarded by the same version condition. Money and squads can never get out of step.

## DynamoDB data model (table `AuctionTable`, keys `pk` + `sk`)

| pk | sk | Item | Access pattern |
|---|---|---|---|
| `META` | `CONFIG` | settings: ladder, multipliers, categories, sheet links | BatchGet with STATE |
| `META` | `STATE` | phase, current lot + bids, `version`, `rosterVersion`, recent request IDs | conditional Put (optimistic concurrency) |
| `TEAM` | `T1`…`T8` | name, colour, budget, purse, owners, `filled` (category → player), `captainId` | Query `pk=TEAM` (all teams), GetItem (one team) |
| `PLAYER` | `P<slNo>` | name, photo, category, base, status, team, price, sale mode | Query `pk=PLAYER` (all players), GetItem |
| `BID#<playerId>` | `<iso>#<rand>` | bid / undo, team, amount, admin | Query: bid history for one player |
| `AUDIT` | `<iso>#<rand>` | admin, role, action, details, version | Query newest-first, limit N |
| `CONN` | `<connectionId>` | `ttl` | Query for broadcasts. TTL removes stale rows. |

- A **team's purchased players** come from `team.filled`, and completed results from `PLAYER` items with `status = SOLD`. Both come from Queries already needed for the snapshot.
- There are **no Scans and no GSIs**, so the provisioned capacity stays inside the always-free 25/25.

## HTTP API

Public (no auth, cached by CloudFront):

| Method & path | Returns |
|---|---|
| `GET /api/public/snapshot[?rv=N]` | `{config (no secrets), state, teams, players}`. `Cache-Control` is 2 s, or 300 s when pinned to roster version `rv`. |
| `GET /api/public/health` | `{ok:true}` |

Admin (Cognito JWT; **M** = master only):

| Method & path | Body | Effect |
|---|---|---|
| `GET /api/admin/me` | | `{username, role}` |
| `GET /api/admin/config` **M** | | full config including the sheet links and secret |
| `GET /api/admin/audit?limit=200` | | audit trail, newest first |
| `GET /api/admin/bids?playerId=P12` | | bid history for one player |
| `POST /api/admin/draw` | `version` | random next player (captains first) |
| `POST /api/admin/bid` | `amount?` | raise to the next ladder step, or a custom amount (no team) |
| `POST /api/admin/undo` | | remove the last bid |
| `POST /api/admin/sell` | `teamId` (required), `price? (M)` | sold to the ticked team, then auto-assignments run, then the sheet write-back |
| `POST /api/admin/unsold` | | player goes back to the pool |
| `POST /api/admin/sync` | | refresh names, photos and base prices from the sheet |
| `POST /api/admin/push-sheet` | | write every result to the sheet |
| `POST /api/admin/config` **M** | `config` | ladder, multipliers, categories (setup only), sheet links |
| `POST /api/admin/teams` **M** | `teams[]` | names and colours; budget and owners only during setup |
| `POST /api/admin/import` **M** | `sheetUrl?` | replace the players from the sheet (setup only) |
| `POST /api/admin/player` **M** | `player` | add or edit |
| `POST /api/admin/player-delete` **M** | `playerId` | setup only |
| `POST /api/admin/captains` **M** | `playerIds[]` | setup only |
| `POST /api/admin/start` **M** | | owner-players assigned at 3×, captains round begins |
| `POST /api/admin/revert` **M** | `playerId` | undo a sale and refund the purse |
| `POST /api/admin/reset` **M** | `confirm:"RESET"` | back to setup, every sale cleared |

Every POST accepts `version` (rejected with 409 if stale) and `requestId` (idempotency key). Errors come back as `{ok:false, error, state?}`.

## WebSocket protocol

- **Server → client:** `{"type":"state","state":{version, rosterVersion, phase, lot, lastAuto, updatedAt, updatedBy}}`. If `rosterVersion` went up, the client fetches `/api/public/snapshot?rv=<rosterVersion>`.
- **Client → server:** `{"action":"ping"}` every 8 minutes. The server doesn't reply.
- **Reconnect:** exponential backoff (1 s up to 30 s, with jitter), plus an immediate retry on `online` or `visibilitychange`. Every (re)connect refetches the snapshot, so nothing is missed. API Gateway's 2-hour connection limit is handled the same way.

## Auction state machine

```
SETUP --start--> CAPTAINS --(every team has a captain)--> PLAYERS --(every slot filled)--> COMPLETE
  ^                                                                                         |
  +--------------------------------------- reset ---------------------------------------------+
```

After every sale or unsold mark the engine "settles": it re-derives the phase and applies forced assignments (last captain at 3×, last player in a category at 2×) until none apply.

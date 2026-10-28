# Rematches

Players can request another round from a completed match's results screen. No new room or login is required. This feature works with Games, Movies and Football, including familiar starter pools.

## Player flow

1. Either player selects **Rematch** after the final result.
2. That player sees a waiting message and **Cancel request**. The opponent sees **Accept rematch**.
3. The server starts a new round only while both players' consent is valid. Requests expire after two minutes.
4. Both results pages receive a Realtime update and open the new match automatically. The server chooses the first player and starts the 20-second timer immediately.

The room code, players, category, catalogue version and saved opening pool stay the same. A new match gets an independent ID, a one-entry history, zero connector usage and one life per player. A different eligible opening is chosen when possible; a one-entry eligible pool may reuse its only opening. Entries from earlier rounds can be used in the new round. The no-repeat and three-use rules apply within each match.

The finished round's outcome, history, usage and effective deadline are retained. Cancellation changes only the caller's pending consent. Once both agree and the new match exists, a cancellation cannot undo it. Stale commands against an older round cannot fork the series or affect current counters.

## Backend deployment

From the project root, after applying the feature patch and passing local checks:

```bash
npx --yes supabase@2.121.0 migration list
npx --yes supabase@2.121.0 db push --dry-run
```

For a project with the Football update already applied, the dry run should show only `20261028120000_rematches.sql`.

```bash
npx --yes supabase@2.121.0 db push
npx --yes supabase@2.121.0 functions deploy match-api --use-api
npx --yes supabase@2.121.0 migration list
```

The Edge Function deployment is required: its action allowlist now accepts `rematch` and `cancel_rematch`. Existing public Supabase configuration and Authentication settings are reused. No new private credentials belong in the frontend. GitHub Pages deployment does not deploy the database or Edge Function.

## Database behaviour

`game_private.rematches` stores readiness timestamps and the unique successor match ID. The table is private, has RLS enabled and gives browser roles no direct access. Authenticated commands verify original match membership and current room ownership before updating the caller's readiness slot.

The RPC locks the finished match and room. Both unexpired readiness slots are required before generating the next match. Creation, participant registration, the opening history row, room transition and successor link commit together. All commands use the same request receipt namespace, so retries cannot create duplicate successors or reuse an ID for a different action.

The existing gameplay function body is moved unchanged to `game_private.core_game_command`. `public.game_command` retains its URL/signature and delegates existing actions to that function. The new private rematch handler never validates or applies gameplay answers itself.

`match.rematch` contains:

| Field | Meaning |
| --- | --- |
| `available` | This completed round is the current room round and can accept consent |
| `requestedBy` | Participant identities with unexpired consent |
| `expiresAt` | Expiry timestamp for each visible consent |
| `nextMatchId` | The unique successor, when created |
| `nextStatus` | Whether that successor is active or finished |

Only the finished source's synchronization revision changes when consent changes; gameplay state and result data are preserved. This uses the existing `matches` Realtime publication and polling fallback. Reconnecting participants can recover the pending request or active successor from a normal snapshot. The client compares revisions so a delayed response cannot roll consent state back.

## Local verification

```bash
npm run verify
npm --prefix web run typecheck
npm --prefix web test -- --watch=false
npm --prefix web run build -- --base-href=/theLastLink/
```

PostgreSQL tests cover all categories/settings, saved results, unchanged gameplay implementation, exact deadlines, reset state, cancellation, expiry, membership, receipt reuse, private permissions, duplicate acceptance, repeated rematches and the single-opening fallback. PGlite serializes transactions; live checks are required to establish hosted concurrency and Realtime behaviour.

Angular tests cover requesting, accepting, cancelling, pending/disabled states, retry IDs, stale errors, result routing and transition into the fresh match. The local visual fixtures are replayed through each category engine. They contain mock players and match state only under `/design-review`; normal result and match routes use real Supabase services.

## Hosted checks

Run after applying the migration and deploying `match-api`:

```bash
node --env-file=web/.env scripts/live-smoke.mjs --rematch
node --env-file=web/.env scripts/live-smoke.mjs --category=movies --opening=familiar --rematch
node --env-file=web/.env scripts/live-smoke.mjs --category=football --opening=familiar --rematch
```

Each check creates two guest identities and one room. It completes a round, verifies pending/duplicate/cancelled requests, sends competing acceptance requests, confirms exactly one successor and both source-match Realtime notifications, validates a fresh-round answer, and verifies independent Cron expiry again. Both rounds' deadlines are server-authoritative; the script does not grant extra time.

For a manual check, use two independent browser sessions. End a match, request a rematch, refresh the waiting results view, cancel once, request again and accept as the other player. Both browsers should open the same fresh match with the same room code. Check another rematch after that round, both win/lose screens, a familiar pool, keyboard activation and a mobile viewport. Keep a saved result URL to inspect its unchanged history later.

## Isolated preview

Start Angular locally and open `/#/design-review/results/design-review-football-match`. The results screen uses the actual Angular component with a clearly labelled mock service. After selecting Rematch, expand Review controls and select **Opponent requests / accepts rematch** to simulate the second player. Select the control first to preview the incoming request state instead.

The fresh preview round uses a real source-backed opening, empty counters and engine-generated answer receipts. Its clock can be paused by the review toolbar. This preview does not authenticate, open a Supabase channel, or prove hosted multiplayer behaviour.

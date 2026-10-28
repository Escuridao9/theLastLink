# Angular services and configuration

The Angular client uses injectable services to keep transport, catalogue loading,
and match synchronization separate from page templates.

| File in `web/src/app/core/` | Responsibility                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `models.ts`                 | Typed catalogue, room, command, and match contracts                                        |
| `config.service.ts`         | Loads and validates the public `config.json` asset                                         |
| `backend.service.ts`        | Restores or creates a Supabase Auth session and invokes `match-api`                        |
| `catalogue.service.ts`      | Loads published catalogues and credits through typed Angular HTTP requests and Observables |
| `match.service.ts`          | Applies authoritative snapshots and refreshes them after Realtime notifications            |

`provideHttpClient()` configures Angular HTTP dependency injection.
`provideAppInitializer()` waits for public configuration loading before the app
starts. Asset URLs are relative to Angular's deployment base path.

## Local setup

Create `web/.env` with your project's public configuration:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

The `configure` script inside `web/package.json` generates both the TypeScript
configuration used by the Supabase service and `web/public/config.json`.
The npm start, typecheck, test, and build commands run configuration first.
Environment files and generated configuration files are ignored by Git.
GitHub Actions supplies the public values through repository variables.

The publishable key is intentionally visible in the browser. Never put database
passwords, personal access tokens, secret keys, or service-role keys in these
frontend settings. Supabase Auth, SQL authorization, and RLS protect access.

## Match synchronization

Use `MatchService.send()` for commands and `watch()` for room or match updates.
The service subscribes to the matching `game_rooms` or `matches` row and fetches
an authorized snapshot after each notification. It also refreshes after
subscription, periodically, and when the browser returns online or becomes
visible. Call `stop()` when the watching component is destroyed.

Match and room revisions prevent older snapshots from replacing newer state.
Stopping a watch invalidates in-flight responses and releases its channel,
polling timer, and browser listeners. PostgreSQL remains responsible for move
validation, connector counters, winners, and the 20-second turn deadline.

`BackendService` uses `match-api` by default. Its optional `rpc` transport invokes
the same authoritative `game_command` with the user's identity. A command receipt
ID must be reused when retrying the same mutation after a lost response.

## Catalogue data and tests

Configured catalogue requests read published versions from Supabase. Without
backend configuration, the catalogue loader reads the published local Games
catalogue and Movie index/detail shards. These assets contain catalogue data;
they do not provide mock players, matches, or accepted answers.

From the repository root:

```bash
npm ci
npm run verify
cd web
npm ci
npm run typecheck
npm test -- --watch=false
npm run build -- --base-href=/theLastLink/
```

`multiplayer-services.spec.ts` checks configuration failures, session reuse,
transport errors, publication pinning, HTTP retries, static asset paths, stale
snapshots, and Realtime cleanup. Its Auth, database, and Realtime responses are
test doubles. It does not certify hosted two-player behavior; verify that
separately with two independent browser sessions.

## Interface and live verification

See [UI and multiplayer](UI_AND_MULTIPLAYER.md) for routes, the isolated visual
preview, and the two-player verification journey.

## Accounts

Email/password login, account creation, email confirmation, and guest conversion
share the production multiplayer session. See [Accounts](ACCOUNTS.md) for Auth
settings, email templates, confirmation URLs, and hosted acceptance checks.

## Rematches

`ResultsComponent` sends `rematch` or `cancel_rematch` with the finished `matchId` and a stable request ID. Both users must consent. The server returns optional `match.rematch` metadata with availability, ready identities, expiry timestamps and a successor match ID/status. No new round starts from a client-only state change.

Consent changes increase the source match's synchronization revision, so its existing Realtime subscription refreshes the result snapshot. When a successor is active, both results views navigate to its normal match route. The existing match watcher then restores the new server state. A finished successor can be viewed from the saved result without creating another match. Routing between finished result IDs reloads the correct snapshot and cleans up the prior subscription.

The room code, identities, category, catalogue and opening setting carry over; history and counters reset for the new match. Pending consent expires after two minutes. Database locks, uniqueness and the shared receipt namespace prevent duplicate acceptance from creating multiple matches. See [Rematch setup and verification](REMATCHES.md).

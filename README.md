# The Last Link

**One life. Make it count.**

A competitive connection game built with Angular, TypeScript and Supabase. Challenge a friend in a private one-versus-one room, connect the current entry to another, and keep the chain alive before the clock runs out.

[Play The Last Link](https://escuridao9.github.io/theLastLink/)

## Rules

- One round of Sudden Death, with a server-authoritative **20-second turn**.
- Every accepted answer passes the turn to the other player.
- Invalid answers can be retried while time remains; they do not reset the deadline.
- Entries cannot repeat, including the opening entry.
- Each connector has **three uses total across both players**.
- Every eligible shared connector is consumed on an accepted answer. If **any** shared connector is already exhausted, the entire answer is rejected without changing state.
- Deliberate traps are allowed. Running out of legal answers does not itself end the match; the deadline or a concession does.
- The server chooses the first player and opening entry. Each match uses one immutable catalogue version.

## Categories and starting options

| Category | Playable entries | Eligible connections |
| --- | ---: | --- |
| Games | 35 | Developers, composers, voice actors and recurring characters; matching eligible roles |
| Movies | 3,505 | Actors, directors, writers, original score composers and cinematographers; the same person may connect different roles |
| Football | 90 clubs | Historical senior players and head managers; a player at one club can connect to a manager at another |
| Music | Coming soon | Unavailable for room creation |

Football includes curated major senior men's clubs worldwide, with no national, youth or reserve teams. Movie and Football identities are canonical people, with one allowance per person across eligible roles. Names alone never create a connection.

Movies and Football offer **Standard** or **Familiar favourites** during room creation. Standard selects any eligible starter. Familiar favourites selects the first entry randomly from a curated pool: 55 movies or 27 clubs. The full category catalogue remains available for every later answer. These pools are editorial selections, not current popularity rankings or a guarantee of difficulty. Both players see the saved setting in the lobby.

## Architecture

The Angular application uses standalone components, lazy routes, typed models, Reactive Forms and reusable search, clock and entry components. `CatalogueService` uses typed Angular `HttpClient` observables for published catalogue indexes and credit details. Components subscribe with explicit loading, error and cleanup handling.

Supabase Authentication provides persistent email accounts and anonymous guest identities. Guests can register their current identity, preserving their room membership. Email confirmation, recovery links and production redirect settings are described in [Accounts](docs/ACCOUNTS.md).

Normal multiplayer commands go through `BackendService` to the **`match-api` Edge Function**. It verifies Supabase Auth and forwards the user's token to PostgreSQL's `public.game_command`. PostgreSQL enforces membership, host permissions, the two-player limit, pinned catalogues, turn order, all connection rules, idempotency and deadlines. Browser code never decides whether a move is valid. Database locks serialize competing submissions; the server samples time after acquiring the match lock.

Supabase Realtime delivers room and match changes. The UI restores snapshots after reconnecting. `pg_cron` independently calls `expire_due_matches()` so a timeout can finish a match even when neither player is connected. RLS protects private room and match reads, and browser roles have no direct write privileges on gameplay tables.

## Structure

| Path | Purpose |
| --- | --- |
| `web/` | Angular frontend, local fonts/assets and component/service tests; its own npm package |
| `web/src/app/core/` | Configuration, accounts, catalogue HTTP and multiplayer synchronization |
| `web/src/app/pages/` | Home, category selection, catalogues, rooms/lobby, match, results and accounts |
| `web/src/app/shared/` | Search, turn clock, entry cards and shared UI helpers |
| `web/src/app/design-review/` | Route-scoped, clearly labelled visual preview fixtures |
| `src/` | Shared TypeScript rules, search and catalogue tools |
| `src/movies/`, `src/football/` | Category normalization and person-based connection engines |
| `data/` | Frozen catalogues, starter-pool manifests, provenance and research audits |
| `supabase/migrations/` | Ordered schema, authorization and frozen publication migrations |
| `supabase/functions/` | Authenticated Edge Functions and handler tests |
| `scripts/` | Configuration, catalogue generation, source collection and live smoke checks |
| `test/` | Rules, normalization, migration, RLS and configuration tests |
| `docs/` | Backend setup, integration and feature documentation |
| `.github/workflows/deploy.yml` | Verification and GitHub Pages deployment |

The root package and `web/package.json` are separate. Install and verify both from the repository root.

## Local development

Requirements: Node.js 24.x, npm and Git. Supabase CLI and Deno are invoked at the pinned versions used by the project scripts.

```bash
npm ci
npm --prefix web ci
cp web/.env.example web/.env
```

Fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `web/.env`. Use your project's public URL and publishable key. Do not commit this file. Enable anonymous sign-ins in Supabase Auth if guest play is required. Configure email and redirects using [ACCOUNTS.md](docs/ACCOUNTS.md).

```bash
npm run catalogue:build
npm --prefix web start
```

Open the local address printed by Angular. Local development does not deploy anything. Configuration scripts generate ignored frontend configuration files from the environment before Angular starts, tests or builds.

## Backend setup

An existing linked Supabase project can apply pending migrations with:

```bash
npx --yes supabase@2.121.0 db push --dry-run
npx --yes supabase@2.121.0 db push
npx --yes supabase@2.121.0 migration list
```

Review the dry run before applying it. Do not reset the remote database or rerun recorded migrations. [Football and familiar starter setup](docs/FOOTBALL_SETUP.md) explains the bounded new import and verification queries. Existing Games and Movies publications retain their identities and hashes.

Deploy the authoritative match API separately when it has changed:

```bash
npx --yes supabase@2.121.0 functions deploy match-api --use-api
```

The additional `create-room` and `join-room` functions have dedicated handler tests. The current multiplayer interface sends its commands through `match-api`.

## Verification

Run these from the repository root:

```bash
npm run verify
npm --prefix web run typecheck
npm --prefix web test -- --watch=false
npm --prefix web run build -- --base-href=/theLastLink/
```

Root verification checks shared TypeScript, the match API and automated Node/PostgreSQL tests. The Angular commands check its TypeScript, component/service/navigation tests and production build. Catalogue builds use frozen local files and do not query third-party data sources.

Embedded PostgreSQL tests run the real migrations, RLS policies and game functions, including the complete publication chain. They cannot establish hosted Realtime delivery, separate-connection locking, email delivery or actual Cron scheduling. Run those checks against the owner's configured Supabase project:

```bash
node --env-file=web/.env scripts/live-smoke.mjs
node --env-file=web/.env scripts/live-smoke.mjs --category=movies --opening=familiar
node --env-file=web/.env scripts/live-smoke.mjs --category=football --opening=familiar
```

Each live smoke test creates two real guest identities and a test room. It verifies accepted/rejected answers, idempotency, two-client Realtime delivery, session restoration and independent server expiry. See [Client integration](docs/CLIENT_INTEGRATION.md) for manual two-browser checks. Simulations and automated checks do not predict human performance under the timer.

## Visual preview and real multiplayer

`/#/design-review` is an explicitly labelled, local-fixture journey through the actual Angular pages. Its route-scoped services mock players, room commands, match state, timers and account flows. Match histories and answer receipts are checked against the category engines and published data. No preview account or result is sent to Supabase.

Try `/#/design-review/rooms?category=football` to review room options and `/#/design-review/match/design-review-football-match` for a populated match. The review toolbar can pause the clock and show waiting, error and result states.

Normal `/rooms`, `/match/:id`, `/results/:id` and `/account` routes use the real Supabase services. Mock providers do not replace production providers. Source-backed catalogue browsing has local static assets when multiplayer is unconfigured; that does not create a playable online match.

## Deployment and public configuration

GitHub Pages hosts the Angular frontend. Hash routing supports direct links and refreshes without a custom web server. Asset URLs are relative, and the workflow obtains the production base path from GitHub Pages. For manual builds under this repository path, use `/theLastLink/` with the trailing slash.

Select **GitHub Actions** under repository Settings → Pages. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` under Settings → Secrets and variables → Actions → Variables. The workflow verifies shared code, Edge handlers and Angular, then deploys successful `main` builds. Pull requests verify without deploying. SQL migrations, Edge deployments and Auth dashboard settings are managed separately.

The publishable key is intentionally public. Environment variables configure the frontend; they do not conceal its values. Authentication, RLS and server authorization enforce access. Database passwords, Supabase secret/service-role keys and private mail credentials must never enter frontend configuration, assets or Git history.

## Data and licences

Movies use TMDB data through the 2017 TMDB 5000 archive, with attribution and validation documented in `MOVIES_DATA_REPORT.md`. This is not an exhaustive or current movie database. TMDB's use conditions still apply.

Football uses Wikidata structured data under CC0, collected on 28 October 2026 through the public QLever Wikidata endpoint. The source-backed catalogue retains statement IDs, available career dates and reference hashes. Positive recorded appearances are required for players; ambiguous roles, future appointments and unconfirmed identities are quarantined. Coverage is incomplete, especially for managers. Missing credits can affect both accepted and rejected answers; see [Football data audit](docs/FOOTBALL_DATA_REPORT.md).

Games retain their reviewed credits and provenance. Research datasets remain separate from the playable publication. Local Bricolage Grotesque and Anton font files include their SIL Open Font License files. Data attribution is also visible at `/#/credits`.

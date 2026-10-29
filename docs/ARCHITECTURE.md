# Architecture

The Last Link is an Angular SPA hosted on GitHub Pages. Supabase provides Authentication, PostgreSQL, Realtime and Edge Functions. The browser presents the current state; the server authorizes and validates gameplay.

## Responsibilities

| Location                     | Responsibility                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `web/src/app/pages/`         | Home, categories, catalogues, rooms/lobby, match, results, accounts and attribution                |
| `web/src/app/shared/`        | Reusable entry cards, search, clock, account navigation and UI helpers                             |
| `web/src/app/core/`          | Typed models, configuration, catalogue HTTP, Auth/account operations and match synchronization     |
| `web/src/app/design-review/` | Clearly labelled route-scoped visual examples                                                      |
| `src/`                       | Shared rules, category normalization, typed data and search                                        |
| `data/`                      | Frozen publications, source snapshots, approval/provenance records, opening pools and asset hashes |
| `supabase/`                  | Ordered migrations, authorization, database functions, Edge handlers and email templates           |
| `scripts/`                   | Configuration, deterministic assets, deliberate data preparation and hosted smoke checks           |
| `test/`                      | Shared rules, source normalization, publication, PostgreSQL and integration tests                  |

The root and Angular packages retain separate dependency lockfiles. Root npm commands provide a single entry point for setup, development, verification and production builds; see [Setup](SETUP.md).

## Data access and match commands

`ConfigService` loads the relative public `config.json` asset before startup. `CatalogueService` uses typed Angular `HttpClient` requests and `Observable` responses to read published Supabase catalogues and requested credit details. Components call `subscribe()`, show loading/error states and release subscriptions. Without configuration, browsing uses locally generated catalogue assets.

`BackendService` owns one lazily loaded Supabase client and its Auth session. Normal multiplayer commands go to `match-api`, which verifies the user and invokes PostgreSQL's `public.game_command` with the user's JWT. Its optional RPC transport invokes the same authorized command directly. Browser code does not determine whether an answer is valid.

PostgreSQL enforces room membership, host permissions, two players, immutable catalogue/pool versions, turn order and every connection rule. Locks serialize competing submissions; server time is sampled after acquiring the match lock. Stable request receipts make mutation retries idempotent. Invalid answers leave state and deadline unchanged.

`MatchService` watches the relevant `game_rooms` or `matches` row. Realtime notifications trigger authorized snapshot reads. Polling, reconnect/visibility events and subscription readiness also refresh snapshots. Revisions reject stale state. Stopping a watch releases channels, timers and listeners and invalidates in-flight responses.

The clock displays the server deadline with a clock offset. Each accepted answer starts an exact 20-second turn for the other player. `pg_cron` independently expires due matches, including when both browsers are closed. RLS restricts private reads; browser roles cannot write gameplay tables directly.

## Categories, accounts and rematches

Games connect recorded eligible developers, composers, voice actors and recurring characters in matching roles. Movies connect actors, directors, writers, composers and cinematographers, allowing the same canonical person across roles. Football connects historical senior players and head managers across roles; national, youth and reserve teams are excluded. Names never substitute for canonical identities.

Every eligible shared connector is consumed once per entity on an accepted move. Both players share the three-use allowance; any exhausted connector rejects the whole answer. Entries cannot repeat within a round. Deliberate traps are legal; timeout or concession ends Sudden Death. Familiar favourites restricts only the first entry to the saved pool.

`AccountService` shares the multiplayer client. Fresh signup, email verification, guest upgrade and login keep authorization tied to the actual user UUID. Guest registration preserves that identity; logging into another account switches it. Identity changes clear private view state and pending answers and stop subscriptions. Resume links are stored per identity. The SDK persists sessions; application code never stores passwords or OTP tokens. Confirmation redirects are processed before routing.

A results view sends `rematch` or `cancel_rematch` using a stable receipt. Private consent expires after two minutes and both players must agree. The server atomically creates one successor in the same room, with the same players/category/catalogue/opening option, a fresh history and counters, and a random first player. It chooses another opening when an eligible alternative exists. Completed results stay intact. Source-match synchronization revisions notify both results views; active successors open automatically. Existing gameplay commands are delegated to the unchanged private core function. Older rounds cannot fork a new active series.

## Source data and generated files

Published catalogue JSON and its provenance live under `data/`. The TMDB archive under `data/movies/import/` is source evidence, not an application bundle. It stays with its metadata and licence notices.

`npm run catalogue:build` verifies frozen input hashes and reproduces 161 browser indexes, credit shards and preview files. The output manifest records their approved hashes; unchanged outputs are verified and reused. Generated browser data is ignored by Git but included in Angular builds. The generator does not write publications, migrations or Supabase data. Source collection is an explicit maintenance operation, never a gameplay or deployment dependency.

Recorded SQL migrations remain intact so a fresh database and an existing linked project share a coherent history. Bulk import payloads are marked generated for GitHub language statistics; authored game functions and security migrations remain visible. Moving historical imports to another mechanism would require a separate, tested migration-history transition. They are not backups of subsequently created user or match data.

## Routes and preview boundary

Hash routing supports GitHub Pages base paths without server rewrites. Main routes include `/`, `/play`, `/catalogue`, `/rooms`, `/rooms/:id`, `/match/:id`, `/results/:id`, `/account` and `/credits`. `RouterLink` navigation stays within the SPA.

`/design-review` provides the same pages with local mock accounts, players, rooms, results and timers. Its example histories and answer receipts replay through the actual category engines. Providers are scoped to this route, preserve the real resume ID and never sign in or call Supabase. A paused timer is visibly labelled. Production routes use real services.

The assignment's binding, pipes, parent-child communication, HTTP, Reactive Forms and lifecycle examples are used by normal routes; they do not depend on the preview. Automated tests cover these paths and server rules. Hosted tests separately establish Realtime, concurrency and Cron; email delivery and public-site keyboard/mobile behavior need browser verification. Simulations do not predict human performance under a timer.

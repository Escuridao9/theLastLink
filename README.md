# The Last Link

**One life. Make it count.**

[Play The Last Link](https://escuridao9.github.io/theLastLink/)

The Last Link is a competitive connection game built with Angular, TypeScript and Supabase. Two players share a private room and take turns connecting games, movies or football clubs through their eligible credits or people.

## Features and rules

- Games, Movies and Football catalogues, with search and credit details.
- Private rooms, invitations, live lobbies, reconnect/resume, and saved results.
- Supabase email accounts, email confirmation, and guest registration that preserves the guest identity.
- Private match summaries and overall/category statistics for registered players; editable display names; password changes and account deletion verified with the current password.
- Hourly cleanup after 24 hours of inactivity for unused rooms, detailed results and eligible guest identities. Registered accounts and their compact results are retained.
- One-versus-one Sudden Death with a **20-second server-authoritative turn**. Invalid answers do not reset the deadline.
- No repeated entries within a match. Every eligible shared connector is consumed; each has three uses shared by both players. Any exhausted connector rejects the entire move.
- Deliberate traps are allowed; timeout or concession ends the round.
- Optional Familiar favourites openings for Movies and Football, and mutual rematches in the same room.

## Run locally

Install Node.js 24.x, npm and Git. Run from the repository root:

```bash
npm run setup
cp web/.env.example web/.env
```

Fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `web/.env`, then:

```bash
npm run dev
```

Open the address Angular prints. A configured Supabase project is required for online play. Without configuration, catalogue browsing and the labelled visual preview remain available. The publishable key is public by design; Auth, database permissions and RLS protect access. Never put private credentials in frontend configuration.

See [Setup](docs/SETUP.md) for database, Authentication, email and deployment instructions. The root and `web/` packages have separate lockfiles; `setup` installs both. It also generates browser catalogue assets entirely from the committed local datasets, without contacting data providers or publishing to Supabase.

## Verify and build

```bash
npm run verify
npm run build -- --base-href=/theLastLink/
```

`verify` runs shared TypeScript, Edge checks and handler tests, Node/PostgreSQL tests, Angular typechecking and tests, and the production build. `verify:core` and `verify:web` run those groups separately. Builds produce `web/dist/the-last-link/browser/`.

GitHub Actions verifies changes and deploys successful `main` builds to GitHub Pages. Hash routing supports direct links and refreshes under `/theLastLink/`. Backend migrations, Edge Functions and hosted Auth settings are managed separately.

## Angular assignment coverage

| Area                       | Example in the application                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Components and templates   | Separate routed pages; reusable entry cards, search and turn clock                                                                          |
| Binding and rendering      | Interpolation, property/event binding, catalogue `[(ngModel)]`, `@if`, `@for`, room-state `@switch`, date/number pipes                      |
| Parent-child communication | Entry cards, search and clock use `@Input`, `@Output` and `EventEmitter`                                                                    |
| Services and typed models  | Injectable catalogue/account/backend/match services, interfaces and dependency injection                                                    |
| HTTP                       | `CatalogueService` uses typed `HttpClient` requests and `Observable`; catalogue components call `subscribe()` and show loading/error states |
| Router                     | `router-outlet`, `RouterLink`, home, category, catalogue, room, match, result and account views                                             |
| Reactive Forms             | Room and account `FormGroup`/`FormControl`, validation, field errors and invalid-submission guards                                          |
| Lifecycle and organisation | `OnInit`, `OnDestroy`, subscription/timer cleanup and separated data/presentation responsibilities                                          |

## Structure, data and preview

`web/` contains Angular, local fonts and UI tests; `src/` contains the shared rules and typed catalogue tools; `data/` holds frozen datasets and provenance. `supabase/` contains backend migrations/functions, `scripts/` contains build and maintenance tools, and `test/` contains shared/database tests. See [Architecture](docs/ARCHITECTURE.md).

The catalogues contain **35 Games, 3,505 Movies and 90 major senior men's Football clubs**. Games use reviewed Wikidata/Wikipedia assertions; Movies use the TMDB 5000 archive; Football uses Wikidata. Missing credits remain a limitation. Normal play reads published Supabase data; source updates are deliberate maintenance. Read [data terms](DATA_LICENSE.md), [third-party notices](THIRD_PARTY_NOTICES.md) and the [Football audit](docs/FOOTBALL_DATA_REPORT.md). Application source uses the [MIT licence](LICENSE).

`/#/design-review` renders the real Angular screens with clearly labelled mock players, accounts and match state. These providers are route-scoped. Normal account, room, match and result routes use real Supabase functionality. Automated checks and previews do not predict human performance under the timer.

# The Last Link

**One life. Make it count.**

The Last Link is a competitive multiplayer connection game being developed
with Angular, TypeScript and Supabase.

Two players connect games or movies through shared eligible credits.
Each accepted answer passes the turn to the opponent.

## Gameplay

- Private online one-versus-one matches.
- One life per player, with a single-round Sudden Death format.
- Twenty-second turns, enforced by the server.
- Unlimited invalid-answer retries while time remains.
- No repeated playable entries within a match.
- Each connector can be used three times total across both players.
- Every eligible shared connector is counted on an accepted move.
- An answer is rejected if any shared connector is exhausted.
- Rejected answers do not change history, connector usage or the deadline.
- Strategic traps are permitted.
- Matches use a fixed, published catalogue version.
- Categories remain independent.

## Categories

### Games

Connections through developers, composers, voice actors and recurring characters.

### Movies

Connections through actors, directors, writers, composers and cinematographers.

### Music

Planned as an independent category.

## Technology

- Frontend: Angular, TypeScript, HTML and CSS.
- Planned backend: Supabase, PostgreSQL, Auth, Realtime and Edge Functions.
- Database access will use authentication and Row Level Security.
- Match validation and deadlines will be server-authoritative.

## Current status

The Angular application includes:

- Application startup and branding.
- A lazy-loaded homepage route.
- Shared charcoal, coral and lilac colour palette.
- Locally served Bricolage Grotesque typography.
- Responsive header and footer.
- Homepage hero, connection illustration and rules section.
- Fragment navigation to the rules section.
- Keyboard skip link and visible focus indicators.
- Component smoke tests.
- Routed category selection with Games and Movies options.
- Reactive category selection using Angular signals.
- Music category marked as coming soon.
- Shared category configuration.
- Category-specific room setup routes.
- Unavailable-category handling.
- Automated routing tests.
- Create-room player-name field with typed reactive forms and accessible validation feedback.
- Join-room form with player-name and room-code validation.
- Case-insensitive six-character room codes, normalized to uppercase.
- Supabase client service with local and production environment configuration.
- GitHub Actions verification and GitHub Pages deployment configuration.
- Shared authentication state, session-event handling and sign-out support.
- Automatic Supabase guest authentication with saved-session reuse.
- Player connection loading, error and retry states.
- Reusable player connection component with @Input properties and
@Output/EventEmitter retry communication.
- Persistent room and player-membership schema.
- Database constraints enforcing two-player rooms.
- Membership-based Row Level Security.
- Room tables registered for Supabase Realtime.
- Authenticated create-room Edge Function.
- Transactional room and host-membership creation.
- Safe retries using a stable creation request ID.
- Backend TypeScript checks and handler tests in GitHub Actions.
- Angular room creation connected to the authenticated Edge Function.
- Typed room request and response models.
- Creation loading, error and success states.
- Stable request IDs for safe retries.
- Backend room-joining function with transactional seat allocation.
- Joining checks for category, capacity, room status and safe retries.
- Authenticated join-room Edge Function with verified player identity.
- Room-joining validation and safe HTTP error responses.
- Angular room joining with loading, validation and error feedback.
- Shared lobby routes for room creation and joining.
- Membership-protected lobby loading and Supabase Realtime updates.
- Lobby recovery after refresh using the saved player session.
- Subscription cleanup and protection against stale room responses.

Room creation and joining open a shared lobby backed by Supabase.
The lobby displays saved room membership and updates through Realtime.
Refreshing restores the lobby using the saved player session.
Readiness controls, match starting, catalogues and gameplay are in development.

## Project structure

- `web/`: Angular frontend, dependencies and component tests.

Database migrations define rooms, player membership and access policies.
Room creation, joining and multiplayer gameplay are being implemented.

- `supabase/`: backend configuration, database migrations and SQL checks.
- `supabase/migrations/`: versioned database schema changes.
- `supabase/checks/`: database constraint and access-policy checks.

## Requirements

- Node.js 24.x.
- npm.
- Git.

## Local development

From the project root:

```bash
cd web
npm ci
cp .env.example .env
```

Open `web/.env` and fill in `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` using your Supabase project's public
connection details.

Then, from `web/`, start the application:

```bash
npm start
```

Open the local URL printed by the development server.

Enable anonymous sign-ins in the Supabase project's Authentication →
Sign In / Providers settings.

The category page restores an existing session or creates a guest
session. Player names are entered in the room forms. Guest identities cannot be recovered after signing out or clearing browser storage.

## Verification

Run from `web/`:

```bash
npm run build
npm run typecheck
npm test -- --watch=false
```

Public Supabase configuration is generated before development,
typechecking, tests and production builds. Local values come from
`web/.env`; GitHub Actions supplies production values through repository
variables.

The generated configuration is included in the frontend bundle.
Authentication, RLS and server authorization will enforce access to data as backend features are implemented.
Private backend credentials must never be included in frontend
configuration.

For live lobby checks, use separate browser contexts for the host and
guest. Verify both categories, automatic player updates, refresh recovery,
full-room errors and rejection of nonmember lobby access.

Room membership persists when navigating away. Leaving and closing rooms
will be added with lobby controls. The live-update indicator describes
the Realtime connection, rather than player presence.

## Edge Function verification

Run from the repository root:

```bash
npx --yes deno@2.9.6 check --config supabase/functions/create-room/deno.json supabase/functions/create-room/index.ts
npx --yes deno@2.9.6 test --config supabase/functions/create-room/deno.json supabase/functions/create-room/handler.test.ts
npx --yes deno@2.9.6 check --config supabase/functions/join-room/deno.json supabase/functions/join-room/index.ts
npx --yes deno@2.9.6 test --config supabase/functions/join-room/deno.json supabase/functions/join-room/handler.test.ts
```

Handler tests use injected database callbacks and require no live
Supabase credentials. They run in GitHub Actions. Authenticated live
requests are verified separately.

Deploy Edge Functions manually from the repository root:

```bash
npx --yes supabase@2.121.0 functions deploy create-room --use-api
npx --yes supabase@2.121.0 functions deploy join-room --use-api
```

GitHub Actions deploys the Angular frontend to GitHub Pages; it does not
apply database migrations or deploy Edge Functions.

## Database verification

Database changes are managed through versioned migrations using
Supabase CLI 2.121.0.

Run CLI commands from the repository root:

```bash
npx --yes supabase@2.121.0 db push --dry-run
npx --yes supabase@2.121.0 db push
npx --yes supabase@2.121.0 migration list
```

Run each complete file separately in the Supabase SQL Editor using the
`postgres` role:

- `supabase/checks/rooms-access.sql`
- `supabase/checks/create-room.sql`
- `supabase/checks/join-room.sql`

The checks verify membership visibility, rejected browser writes,
transactional room creation and room joining. Joining checks cover both
categories, validation, capacity, lobby status and retry-safe membership.
Test fixtures are rolled back.

Database checks are currently run separately from the Angular
GitHub Actions checks.

## Routing and deployment

The application uses hash-based Angular routing, with routes such as
`/#/play/games`. This supports direct navigation and page refreshes
on static hosting.

GitHub Pages is the production hosting target. Production builds must
set `--base-href` to the site's deployment directory, including its
trailing slash.

The development base URL remains `/`. Public assets use relative URLs
so they also work when the application is hosted beneath a repository
directory.

[Open the live application](https://escuridao9.github.io/theLastLink/)

The workflow in `.github/workflows/deploy.yml` installs dependencies,
checks TypeScript, runs automated tests and builds the production
application.

Successful checks on `main` are followed by deployment to GitHub Pages.
Pull requests run the checks without publishing. The workflow can also
be started manually from the repository's Actions tab.

The production base path is obtained from the GitHub Pages configuration.
GitHub Pages hosts the Angular frontend; Supabase will provide
authentication, persistent storage and multiplayer backend services.

For deployment, create the repository variables `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` under Settings → Secrets and variables →
Actions → Variables.

Under Settings → Pages, select GitHub Actions as the publishing source.

## Shared code and database tests

From the repository root, run `npm ci` followed by `npm run verify`.
The root package checks shared TypeScript and runs unit tests and
embedded PostgreSQL tests. The Angular application has its own package
inside `web`.

Hosted Supabase Authentication, Realtime, Cron scheduling and simultaneous
database connections require separate live verification.

## Match API

The `match-api` Edge Function verifies the caller with Supabase Auth
and forwards their access token to `public.game_command`. PostgreSQL
enforces authorization, match state, connector usage, and the
20-second turn deadline.

From the repository root, run `npm run verify` to check shared
TypeScript, the Edge entry point, and automated tests.

Deploy the function with
`npx --yes supabase@2.121.0 functions deploy match-api --use-api`.
GitHub Actions verifies the function. Backend deployment is performed
separately from the Angular deployment to GitHub Pages.
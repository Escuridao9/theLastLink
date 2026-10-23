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

Room setup is available for Games and Movies. Room creation and joining are
not connected yet. Catalogues, authentication and multiplayer functionality
are in development.

## Project structure

- `web/`: Angular frontend, dependencies and component tests.

Backend migrations, datasets and processing scripts will be added
as those features are implemented.

## Requirements

- Node.js 24.x.
- npm.
- Git.

## Local development

From the project root:

```bash
cd web
npm ci
npm start
```

Open the local URL printed by the development server.

## Verification

Run from `web/`:

```bash
npm run build
npx tsc --project tsconfig.app.json --noEmit
npm test -- --watch=false
```
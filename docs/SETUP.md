# Setup and verification

All commands below run from the repository root. Routine frontend development needs Node.js 24.x, npm and Git. The project invokes its pinned Supabase and Deno tools through npm; Docker is not required for the hosted-project workflow.

## Local application

```bash
npm run setup
cp web/.env.example web/.env
```

Set the public values in `web/.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

```bash
npm run dev
```

The root command starts Angular inside `web/`. Angular's configure hook generates the ignored `web/public/config.json` from environment values. There is one production Supabase client, owned by `BackendService`. Local environment files stay out of Git. The publishable key is visible in browser assets; protect data with Auth, RLS and server authorization. Database passwords, secret/service-role keys, access tokens and SMTP credentials must never enter Angular configuration.

When both values are absent, local catalogues and the isolated visual preview work; online rooms and accounts require configuration. Partial or unsafe configuration produces a visible error. A frontend running on localhost still uses the hosted Supabase project when configured.

`npm run setup` installs both npm packages and generates browser data. Direct Angular npm start/test/build commands also ensure those assets exist. `npm run catalogue:build` rebuilds or verifies them offline. The manifest in `data/browser-assets.manifest.json` checks source hashes and all 161 output hashes. These operations never collect external data, rewrite migrations, or publish a catalogue remotely.

## Supabase database and functions

For an already configured project, apply only genuinely pending backend changes. A frontend cleanup does not require another backend deployment.

For a new computer or Supabase project, authenticate and link the intended project:

```bash
npx --yes supabase@2.121.0 login
npx --yes supabase@2.121.0 link --project-ref YOUR_PROJECT_REF
npx --yes supabase@2.121.0 migration list
npx --yes supabase@2.121.0 db push --dry-run
```

Review the dry run before applying:

```bash
npx --yes supabase@2.121.0 db push
npx --yes supabase@2.121.0 migration list
npx --yes supabase@2.121.0 functions deploy match-api --use-api
```

Migrations create the schema, authorization, game functions, frozen catalogue publications, opening pools, Cron jobs and rematches. Keep applied migration bytes and versions intact. The large data-publication migrations remain part of the reproducible installation. Never reset the hosted database. If a push fails, compare migration history and verify committed data before repairing history; do not mark unverified work as applied.

`match-api` is the production command endpoint, including rematch/cancellation actions. The separately tested `create-room` and `join-room` endpoints remain in the repository; the current interface sends its commands through `match-api`. Normal commands authenticate the player and execute with that user's permissions, without a frontend service-role key.

GitHub Pages deployment does not run migrations, deploy Edge Functions or apply dashboard Auth settings. For an initial setup, confirm that Realtime is enabled for `game_rooms` and `matches`, and that the timeout Cron job is active. The migrations configure them; embedded tests cannot verify hosted scheduling.

In Supabase SQL Editor, verify the publications:

```sql
select c.category_id, c.id, c.published,
  (select count(*) from public.entries e where e.catalogue_id=c.id) as entries,
  (select count(*) from public.entry_credits cr where cr.catalogue_id=c.id) as credits
from public.catalogues c
order by c.category_id, c.id;

select p.id, p.published, count(pe.entry_id) as starters
from public.opening_pools p
left join public.opening_pool_entries pe on pe.pool_id=p.id
group by p.id, p.published
order by p.id;
```

Current published counts: Games **35 entries / 165 credits**, Movies **3,505 / 99,476**, Football **90 / 31,286**. Familiar pools contain **55 Movies** and **27 Football clubs**. Existing published versions must not be edited or silently repointed.

## Hosted Authentication and email

`supabase/config.toml` configures a local Supabase stack. Configure the hosted project through its dashboard:

1. Enable email/password authentication and new-user signup. Keep email confirmation enabled, minimum passwords of at least eight characters, and six-digit email OTPs.
2. Enable anonymous sign-ins and manual identity linking so guests can register without losing their player UUID.
3. Set the Site URL to `https://escuridao9.github.io/theLastLink/`.
4. Allow redirects to that exact URL, `http://localhost:4200/` and `http://127.0.0.1:4200/`.
5. Copy [Confirm signup](../supabase/templates/confirm-signup.html) and [Change email](../supabase/templates/change-email.html) into the corresponding Supabase email templates. They retain the confirmation URL and display the OTP token.
6. Configure custom SMTP for public signup. The default mail service has recipient/rate restrictions. Store mail credentials only in Supabase.

Fresh visitors register with name, email and password, then confirm the email. Guests attach an email, verify it, and then choose a password. Logging in to an existing account switches identity; it does not merge guest matches.

The app uses PKCE. Links return to the deployment base directory; the initializer consumes the code before hash routing and removes it from the URL. Open a confirmation link in the browser that requested it, or enter the email code there. A fresh account confirmed elsewhere can log in normally. Complete guest conversion in the original guest browser.

See Supabase's [Auth](https://supabase.com/docs/guides/auth/passwords), [anonymous conversion](https://supabase.com/docs/guides/auth/auth-anonymous), [redirect](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and [SMTP](https://supabase.com/docs/guides/auth/auth-smtp) documentation.

## GitHub Pages

Select GitHub Actions in repository Settings → Pages. Under Settings → Secrets and variables → Actions → Variables, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These public settings feed the build configuration.

The workflow checks shared code, database migrations, Edge handlers and Angular; successful pushes to `main` deploy the generated Angular files. Pull requests verify without deployment. It reads the base path from Pages. A manual repository-path build is:

```bash
npm run build -- --base-href=/theLastLink/
```

Output: `web/dist/the-last-link/browser/`. Hash routes such as `/theLastLink/#/catalogue?category=movies` support direct links and refreshes. Fonts and attribution assets are bundled locally.

## Automated and hosted checks

```bash
npm run verify
```

This runs both verification groups, including the production build. Use `npm run verify:core` or `npm run verify:web` to isolate a group. Tests use synthetic identities and embedded PostgreSQL/transport doubles; they do not send signup emails or certify hosted Realtime/Cron.

For hosted multiplayer checks:

```bash
node --env-file=web/.env scripts/live-smoke.mjs --rematch
node --env-file=web/.env scripts/live-smoke.mjs --category=movies --opening=familiar --rematch
node --env-file=web/.env scripts/live-smoke.mjs --category=football --opening=familiar --rematch
```

These create real guest identities and test rooms. They verify membership, invalid/valid answers, shared usage, duplicate and competing submissions, both Realtime streams, restoration, independent Cron expiry, mutual rematches and saved results. A rematch check runs two rounds; allow it to finish. They do not verify email delivery.

Finally use two independent browser sessions, such as a normal/private pair, on the public site. Check room creation/joining, the saved category/opening setting, host-only start, valid/invalid answers, counters, reconnect/resume and timeout. Request, cancel and accept a rematch; both players must enter the same new round. Refresh direct catalogue, room, match and result URLs, use keyboard controls, and review mobile layouts. Separately test fresh signup, confirmation, logout/login, guest conversion with access to a saved result, expired codes, and identity changes in another tab.

## Data maintenance and visual preview

Ordinary play, builds and deployment do not contact TMDB or Wikidata for updates. `npm run football:collect` explicitly contacts Wikidata/QLever and caches observations. `npm run football:prepare` audits those observations; writing a new version requires the documented explicit flags in that script. `games:prepare` and `football:publication` are deliberate data-maintenance tools, separate from browser builds. Review their outputs and use new immutable publication versions for actual data changes. See the [Football audit](FOOTBALL_DATA_REPORT.md) and [data terms](../DATA_LICENSE.md).

Open `/#/design-review` for the actual Angular pages with route-scoped examples. Review controls can add an opponent, switch turns, run/pause the clock, show results, and accept a mocked rematch. Account example code is `123456`; `error@example.invalid` shows a mock error. No preview email, command or Realtime channel reaches Supabase. Normal application routes use production providers.

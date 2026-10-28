# Football and familiar starter setup

This update adds Football and optional familiar opening pools for Movies and Football. It preserves the 20-second timer, authentication, existing catalogue publications and all connection rules.

## Scope and behaviour

- 90 curated major senior men's clubs worldwide; no national, youth or reserve teams.
- Historical players and head managers, including caretakers. Directors and unspecified coaching jobs do not qualify.
- A person can connect player → player, manager → manager, or player → manager. One shared three-use allowance follows their canonical Wikidata identity.
- Every eligible shared person is consumed. Any exhausted person blocks the whole answer.
- Standard remains the default. Familiar favourites restricts only the random first entry: 55 Movies or 27 Football clubs. Later answers use the entire pinned category catalogue.
- The host selects the setting at creation. Joining cannot change it. Familiar rooms pin the exact pool and catalogue; both players see the choice in the lobby.

## 1. Preview and verify locally

Run from the repository root, after installing both npm packages and configuring `web/.env` as described in the README:

```bash
npm run verify
npm --prefix web run typecheck
npm --prefix web test -- --watch=false
npm --prefix web run build -- --base-href=/theLastLink/
npm --prefix web start
```

Use the address Angular prints. Append `/#/design-review` for the clearly labelled mocked journey. Try Football and Movies room settings, create a room, use the toolbar to add an example opponent, start, search and inspect the history/counters, then show a result. Review both a wide browser and a mobile viewport. Normal online routes require the backend migrations below.

No public data collection or source API key is needed to run the application or these checks.

## 2. Apply only pending database migrations

Use the Supabase project already linked to this repository. If this computer has no CLI session, run `npx --yes supabase@2.121.0 login` first. Linking a project is separate from logging in; verify the project before pushing.

```bash
npx --yes supabase@2.121.0 migration list
npx --yes supabase@2.121.0 db push --dry-run
```

The update contributes 22 migrations dated `20261028`: schema/settings, catalogue metadata, 19 bounded people/career chunks and final publication. Existing recorded migrations must not be reapplied. The largest new file is under 750 KB, avoiding one enormous data/migration-history statement.

```bash
npx --yes supabase@2.121.0 db push
npx --yes supabase@2.121.0 migration list
```

This is an additive import. Never use `db reset` against the hosted project. New data remains unpublished until counts, relationship signatures, source hashes and opening-pool membership pass the final transaction. Chunk and publication retries are tested for the case where SQL committed before migration-history recording failed. If a push fails, inspect migration history and the exact error before repairing it; do not mark unverified migrations applied.

The existing `match-api` function forwards the new payload fields to `game_command` without needing a new function name or secret. This update does not change its source. GitHub Pages deployment does not apply SQL migrations.

## 3. Verify the publication in Supabase SQL Editor

Run this query as the project owner:

```sql
select c.category_id, c.id, c.published,
  (select count(*) from public.entries e where e.catalogue_id=c.id) as entries,
  (select count(*) from public.entry_credits cr where cr.catalogue_id=c.id) as credits
from public.catalogues c
where c.id in ('games-reviewed-2026-10-21-v1', 'movies-tmdb-2017-v1', 'football-clubs-2026-10-28-v1')
order by c.category_id;

select c.category_id, p.id, p.published, count(pe.entry_id) as starters
from public.opening_pools p
join public.catalogues c on c.id=p.catalogue_id
left join public.opening_pool_entries pe on pe.pool_id=p.id
where p.id in ('movies-familiar-2026-10-28-v1', 'football-familiar-2026-10-28-v1')
group by c.category_id,p.id,p.published
order by c.category_id;
```

Expected publications: Games 35 entries / 165 credits; Movies 3,505 / 99,476; Football 90 / 31,286. Both new pools must be published, with 55 Movie and 27 Football starters. Football has 30,467 player and 819 manager credits across 22,974 people. The frozen Football SHA-256 is `f003dc98c8b4986eb36940fe9c38900d18cac4ac544e35faae275ff24ca3606d`.

## 4. Live checks

From the repository root:

```bash
node --env-file=web/.env scripts/live-smoke.mjs --category=football
node --env-file=web/.env scripts/live-smoke.mjs --category=football --opening=familiar
node --env-file=web/.env scripts/live-smoke.mjs --category=movies --opening=familiar
```

These create real temporary guest identities and test rooms on your project. They require guest Auth, Realtime and the existing Cron timeout job to be configured. The familiar variants check that the saved pool contains the first entry. Email signup/login remain separate checks; no new Auth configuration is required for this feature.

In two independent browser contexts, also verify:

1. Create a Football room with Familiar favourites. The second player joins by code and sees the same category/setting.
2. Refresh each lobby. Only the host can start; the seed is in the saved pool and the clock shows 20 seconds.
3. Accept a legal club outside the familiar pool. Check all shared people and role labels in history.
4. Retry an invalid answer. The deadline continues and no counters change.
5. Confirm the three-use shared limit, no repeated clubs, Realtime updates, reconnect and server timeout with both tabs closed.
6. Check Standard Movies/Games rooms and email/guest identities still work.

These hosted checks are required after applying the migrations. Local PostgreSQL tests cannot prove live Auth, Realtime, network concurrency or `pg_cron` behaviour.

## Data maintenance

`npm run catalogue:build` deterministically regenerates public Football assets, the engine-checked visual fixture and bounded SQL from committed frozen local data. It does not fetch or publish remotely. Existing migration bytes and catalogue hashes are guarded.

Optional source research commands:

```bash
npm run football:collect
npm run football:prepare
```

Collection resumes from ignored `.cache/football/` responses, respects rate limits and writes observations only. Preparation without `--write` reports an audit. Curating a new version is deliberate work: inspect identities, qualifiers, dates and quarantine before using `npm run football:prepare -- --write --dataset-id=football-clubs-YYYY-MM-DD-vN`. Never overwrite a published version. Update the versioned pool/generator and add new migration versions for a real catalogue release. The existing pool manifest and migrations must not be silently repointed to a new catalogue.

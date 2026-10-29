/** Reproduce browser catalogue assets from frozen local data. No network or database writes. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ConnectionEngine } from '../src/engine.ts';
import { MovieConnectionEngine } from '../src/movies/engine.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import type { Dataset } from '../src/types.ts';
import type { MovieDataset } from '../src/movies/types.ts';
import type { FootballDataset } from '../src/football/types.ts';
import { GAMES_REVIEW } from '../web/src/app/design-review/games-fixture.ts';
import { REVIEW_STATE } from '../web/src/app/design-review/fixture.ts';
import { footballPresentation } from './catalogue-views.ts';

const root = new URL('../', import.meta.url);
const publicRoot = new URL('web/public/', root);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(read('data/browser-assets.manifest.json')) as {
  sources: Record<string, string>;
  files: Record<string, { sha256: string; bytes: number }>;
};
for (const [path, expected] of Object.entries(manifest.sources)) {
  if (sha(read(path)) !== expected) throw Error(`Frozen source hash mismatch: ${path}`);
}
const assetsMatch = () =>
  Object.entries(manifest.files).every(([path, expected]) => {
    const url = new URL(path, publicRoot);
    if (!existsSync(url)) return false;
    const body = readFileSync(url);
    return body.length === expected.bytes && sha(body) === expected.sha256;
  });
if (assetsMatch()) {
  console.log(`${Object.keys(manifest.files).length} generated browser assets verified.`);
} else {
  await generate();
  if (!assetsMatch()) throw Error('Generated assets differ from the approved browser manifest.');
  console.log(
    `${Object.keys(manifest.files).length} browser assets generated and verified offline.`,
  );
}

function write(path: string, value: unknown, raw = false) {
  const url = new URL(path, publicRoot);
  mkdirSync(new URL('.', url), { recursive: true });
  writeFileSync(url, raw ? (value as string) : JSON.stringify(value) + '\n');
}

async function generate() {
  const games = JSON.parse(read('data/playable/catalogue-v1.json')) as Dataset;
  const movies = JSON.parse(
    read('data/movies/published/movies-tmdb-2017-v1/catalogue.json'),
  ) as MovieDataset;
  const football = JSON.parse(
    read('data/football/published/football-clubs-2026-10-28-v1/catalogue.json'),
  ) as FootballDataset;
  const gamesEngine = new ConnectionEngine(games);
  const movieEngine = new MovieConnectionEngine(movies);
  const footballEngine = new FootballConnectionEngine(football);
  write('catalogue-v1.json', read('data/playable/catalogue-v1.json'), true);
  write(
    'movies-index-v1.json',
    read('data/movies/published/movies-tmdb-2017-v1/search-index.json'),
    true,
  );

  const movieShards = Array.from({ length: 64 }, () => ({}) as Record<string, unknown>);
  for (const movie of movies.movies) {
    const credits = Object.fromEntries(
      Object.entries(movie.credits).map(([role, records]) => [
        role,
        records.map((credit) => ({
          entityId: credit.entityId,
          sourceCredits: credit.sourceCredits.map((evidence) => ({
            credit_id: evidence.credit_id,
            job: evidence.job,
            department: evidence.department,
            character: evidence.character,
            order: evidence.order,
          })),
        })),
      ]),
    );
    const people = Object.fromEntries(
      Object.values(movie.credits)
        .flat()
        .map((credit) => [credit.entityId, movies.entities[credit.entityId]]),
    );
    movieShards[movie.externalIds.tmdb % 64]![movie.id] = { ...movie, credits, people };
  }
  for (const [index, entries] of movieShards.entries())
    write(`movies/${movies.datasetId}/credits-${index}.json`, JSON.stringify(entries), true);

  const roles = ['player', 'manager'] as const;
  const { games: clubs, snapshot, uiEvidence } = footballPresentation(football);
  write('football-index-v1.json', snapshot);
  for (const [index, club] of football.clubs.entries()) {
    const people = Object.fromEntries(
      roles.flatMap((role) =>
        club.credits[role].map((credit) => [credit.entityId, football.entities[credit.entityId]]),
      ),
    );
    const credits = Object.fromEntries(
      roles.map((role) => [
        role,
        club.credits[role].map((credit) => ({
          entityId: credit.entityId,
          sourceCredits: credit.sourceCredits.map((evidence) =>
            uiEvidence(evidence, role, credit.entityId),
          ),
        })),
      ]),
    );
    write(`football/${football.datasetId}/credits-${index}.json`, {
      [club.id]: {
        ...clubs[index],
        credits,
        people,
        coverage: club.coverage,
        provenance: club.provenance,
      },
    });
  }
  const pools = ['movies', 'football'].map(
    (category) =>
      JSON.parse(read(`data/openers/${category}-familiar-v1.json`)) as {
        catalogueId: string;
        label: string;
        poolId: string;
        entries: { id: string }[];
      },
  );
  write(
    'opening-pools-v1.json',
    Object.fromEntries(
      pools.map((pool) => [
        pool.catalogueId,
        [
          {
            mode: 'familiar',
            label: pool.label,
            pool_id: pool.poolId,
            entries: pool.entries.length,
          },
        ],
      ]),
    ),
  );

  const footballHistory = [
    'Q18656',
    'Q8682',
    'Q483020',
    'Q7156',
    'Q1543',
    'Q9616',
    'Q1130849',
    'Q9617',
  ].map((id) => 'wikidata:club:' + id);
  let footballState = footballEngine.createMatch(footballHistory[0]!);
  const named = (connectors: ReturnType<typeof footballEngine.sharedConnectors>) =>
    connectors.map((connector) => ({
      ...connector,
      name: football.entities[connector.entityId]!.name,
    }));
  const turns = [
    {
      index: 0,
      playerId: null as string | null,
      entryId: footballHistory[0]!,
      connectors: [] as ReturnType<typeof named>,
      acceptedAt: '2026-10-28T10:00:00.000Z',
    },
  ];
  for (const [offset, entryId] of footballHistory.slice(1).entries()) {
    const result = footballEngine.applyMove(footballState, entryId);
    if (!result.ok) throw Error('Invalid Football preview history: ' + result.reason);
    footballState = result.state;
    turns.push({
      index: footballState.version,
      playerId: footballState.version % 2 ? 'preview-alex' : 'preview-diogo',
      entryId,
      connectors: named(result.connectors),
      acceptedAt: new Date(Date.parse('2026-10-28T10:00:00Z') + (offset + 1) * 7000).toISOString(),
    });
  }
  write('design-review/football-fixture.json', { state: footballState, turns });
  const receipts: Record<string, unknown> = {};
  for (const [category, data, engine, state] of [
    ['games', games, gamesEngine, GAMES_REVIEW.state],
    ['movies', movies, movieEngine, REVIEW_STATE],
    ['football', football, footballEngine, footballState],
  ] as const) {
    receipts[category] = {
      version: state.version,
      moves: Object.fromEntries(
        engine.gameIds().map((id) => {
          const result = engine.applyMove(state as never, id);
          const connectors = result.connectors.map((connector) => ({
            ...connector,
            name: data.entities[connector.entityId]!.name,
          }));
          const receipt =
            category === 'football'
              ? { ...result, connectors }
              : result.ok
                ? { ok: true, connectors, state: result.state }
                : { ok: false, reason: result.reason, connectors, exhausted: result.exhausted };
          return [id, receipt];
        }),
      ),
    };
  }
  write('design-review/move-receipts.json', receipts);
  await import('./build-rematch-preview.ts');
}

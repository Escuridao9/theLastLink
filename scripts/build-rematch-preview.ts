/** Source-backed, fresh-round examples for the isolated Angular visual preview. No network. */
import { readFileSync, writeFileSync } from 'node:fs';
import { ConnectionEngine } from '../src/engine.ts';
import { MovieConnectionEngine } from '../src/movies/engine.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import type { Dataset } from '../src/types.ts';
import type { MovieDataset } from '../src/movies/types.ts';
import type { FootballDataset } from '../src/football/types.ts';
import { GAMES_REVIEW } from '../web/src/app/design-review/games-fixture.ts';
const root = new URL('../', import.meta.url);
const games: Dataset = JSON.parse(
  readFileSync(new URL('data/playable/catalogue-v1.json', root), 'utf8'),
);
const movies: MovieDataset = JSON.parse(
  readFileSync(new URL('data/movies/published/movies-tmdb-2017-v1/catalogue.json', root), 'utf8'),
);
const football: FootballDataset = JSON.parse(
  readFileSync(
    new URL('data/football/published/football-clubs-2026-10-28-v1/catalogue.json', root),
    'utf8',
  ),
);
const gamesEngine = new ConnectionEngine(games);
const gamesSeeds = gamesEngine
  .connectedComponents()[0]!
  .filter((id) => id !== GAMES_REVIEW.state.history[0])
  .slice(0, 2);
const out: Record<string, unknown> = {};
for (const [category, data, engine, seeds] of [
  ['games', games, gamesEngine, gamesSeeds],
  ['movies', movies, new MovieConnectionEngine(movies), ['tmdb:movie:603', 'tmdb:movie:27205']],
  [
    'football',
    football,
    new FootballConnectionEngine(football),
    ['wikidata:club:Q131499', 'wikidata:club:Q128446'],
  ],
] as const) {
  out[category] = seeds.map((seed) => {
    const state = engine.createMatch(seed);
    const moves = Object.fromEntries(
      engine.gameIds().map((id) => {
        const result = engine.applyMove(state as never, id);
        return [
          id,
          {
            ...result,
            connectors: result.connectors.map((c) => ({
              ...c,
              name: data.entities[c.entityId]!.name,
            })),
          },
        ];
      }),
    );
    return {
      state,
      version: 0,
      turns: [
        {
          index: 0,
          entryId: seed,
          playerId: null,
          connectors: [],
          acceptedAt: '2026-10-28T12:00:00.000Z',
        },
      ],
      moves,
    };
  });
}
writeFileSync(
  new URL('web/public/design-review/rematch-fixtures.json', root),
  JSON.stringify(out) + '\n',
);
console.log('Fresh-round preview fixtures generated through all three category engines.');

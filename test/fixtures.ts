// Entirely synthetic test fixtures. No fixture is an externally retrieved credit.
import type { ConnectorType, Dataset, Game } from "../src/types.ts";

export function game(id: string, credits: Partial<Record<ConnectorType, string[]>> = {}): Game {
  return { id, category: "games", title: `Synthetic game ${id}`, credits: {
    developer: (credits.developer ?? []).map(entityId => ({ entityId })),
    composer: (credits.composer ?? []).map(entityId => ({ entityId })),
    voiceActor: (credits.voiceActor ?? []).map(entityId => ({ entityId })),
    character: (credits.character ?? []).map(entityId => ({ entityId })),
  } };
}

export function fixture(games: Game[]): Dataset {
  const ids = new Set(games.flatMap(g => Object.values(g.credits).flatMap(cs => cs.map(c => c.entityId))));
  return { schemaVersion: 1, datasetId: "synthetic-test-only", games,
    entities: Object.fromEntries([...ids].map(id => [id, { id, name: `Synthetic ${id}` }])) };
}

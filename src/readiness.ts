import { CONNECTOR_TYPES } from "./types.ts";
import type { Dataset } from "./types.ts";

/** Fail-closed deployment gate. Presence of some credits never implies completeness. */
export function catalogueReadiness(dataset: Dataset) {
  const eligibleGameIds: string[] = [];
  const needsReview: { gameId: string; incompleteTypes: string[] }[] = [];
  for (const game of dataset.games) {
    const incompleteTypes = CONNECTOR_TYPES.filter(kind => game.coverage?.[kind]?.complete !== true);
    if (incompleteTypes.length) needsReview.push({ gameId: game.id, incompleteTypes });
    else eligibleGameIds.push(game.id);
  }
  return { eligibleGameIds, needsReview, ready: needsReview.length === 0 && eligibleGameIds.length > 0 };
}

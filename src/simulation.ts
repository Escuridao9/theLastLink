import { ConnectionEngine } from "./engine.ts";
import type { MatchState, Strategy } from "./types.ts";

/** Deterministic PRNG for reproducible experiments, never for authentication. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function chooseMove(engine: ConnectionEngine, state: MatchState, strategy: Strategy,
  rng: () => number): string | null {
  const moves = engine.availableMoves(state);
  if (!moves.length) return null;
  let effective = strategy;
  if (strategy === "mixed") {
    // Asymmetric algorithmic players: A 80% maximize / 20% random;
    // B 50% trap / 50% random. This is not a calibrated human model.
    const p = rng();
    effective = state.version % 2 === 0 ? (p < 0.8 ? "maximize" : "random") : (p < 0.5 ? "trap" : "random");
  }
  if (effective === "random") return moves[Math.floor(rng() * moves.length)]!;
  const scored = moves.map(id => {
    const result = engine.applyMove(state, id);
    if (!result.ok) throw new Error("Engine returned an invalid available move");
    return { id, replies: engine.availableMoves(result.state).length };
  });
  const best = effective === "maximize" ? Math.max(...scored.map(m => m.replies)) : Math.min(...scored.map(m => m.replies));
  const ties = scored.filter(m => m.replies === best);
  return ties[Math.floor(rng() * ties.length)]!.id;
}

export function runChain(engine: ConnectionEngine, start: string, strategy: Strategy, seed: number) {
  const rng = seededRandom(seed);
  let state = engine.createMatch(start);
  const transitions: { from: string; to: string; connectors: ReturnType<ConnectionEngine["sharedConnectors"]> }[] = [];
  while (true) {
    const move = chooseMove(engine, state, strategy, rng);
    if (move === null) break;
    const result = engine.applyMove(state, move);
    if (!result.ok) throw new Error(`Simulation submitted invalid move: ${result.reason}`);
    transitions.push({ from: state.currentGameId, to: move, connectors: result.connectors });
    state = result.state;
  }
  return { state, transitions, moves: state.history.length - 1 };
}

export const CONNECTOR_TYPES = ["developer", "composer", "voiceActor", "character"] as const;
export type ConnectorType = typeof CONNECTOR_TYPES[number];

export interface Credit {
  entityId: string;
  evidenceStatus?: string;
  provenance?: Record<string, unknown>;
}

export interface ConnectorEntity {
  id: string;
  name: string;
  externalIds?: Record<string, unknown>;
  sourceUrl?: string;
}

export interface Game {
  id: string;
  category: "games";
  title: string;
  releaseYear?: number | null;
  credits: Record<ConnectorType, Credit[]>;
  series?: { id: string; name: string }[];
  coverage?: Partial<Record<ConnectorType, { status: string; complete: boolean }>>;
  [metadata: string]: unknown;
}

export interface Dataset {
  schemaVersion: number;
  datasetId: string;
  entities: Record<string, ConnectorEntity>;
  games: Game[];
  [metadata: string]: unknown;
}

export interface SharedConnector {
  entityId: string;
  types: ConnectorType[];
}

export interface Edge {
  from: string;
  to: string;
  connectors: SharedConnector[];
}

/** Trusted server state. Never accept client-supplied history or counters. */
export interface MatchState {
  readonly datasetId: string;
  readonly category: "games";
  readonly currentGameId: string;
  /** Includes the initial seed game, which consumes no connector. */
  readonly history: readonly string[];
  readonly usage: Readonly<Record<string, number>>;
  readonly version: number;
}

export type RejectionReason = "dataset_mismatch" | "invalid_state" | "stale_version" |
  "unknown_game" | "repeated_game" | "no_shared_connector" | "exhausted_connector";

export type Validation =
  | { ok: true; connectors: SharedConnector[] }
  | { ok: false; reason: RejectionReason; connectors: SharedConnector[]; exhausted: string[] };

export type MoveResult =
  | { ok: true; state: MatchState; connectors: SharedConnector[] }
  | { ok: false; state: MatchState; reason: RejectionReason; connectors: SharedConnector[]; exhausted: string[] };

export type Strategy = "random" | "maximize" | "trap" | "mixed";

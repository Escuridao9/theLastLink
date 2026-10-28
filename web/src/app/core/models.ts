export type Category = 'games' | 'movies' | 'football';
export type OpeningMode = 'standard' | 'familiar';
export type ConnectorType =
  | 'developer'
  | 'composer'
  | 'voiceActor'
  | 'character'
  | 'actor'
  | 'director'
  | 'writer'
  | 'cinematographer'
  | 'player'
  | 'manager';
export interface UICredit {
  entityId: string;
  sourceCredits?: { job?: string; character?: string; credit_id?: string }[];
}
export interface Entity {
  id: string;
  name: string;
  sourceUrl?: string;
  externalIds?: Record<string, unknown>;
}
/** A compact view model. Movies' raw import is never downloaded during a match. */
export interface Game {
  id: string;
  category: Category;
  title: string;
  releaseYear?: number | null;
  originalTitle?: string;
  aliases?: string[];
  credits: Partial<Record<ConnectorType, UICredit[]>>;
  genres?: string[];
  countries?: string[];
  region?: string;
  foundedYear?: number;
  externalIds?: Record<string, unknown>;
  detailShard?: number;
  people?: Record<string, Entity>;
  provenance?: Record<string, unknown>;
  coverage?: Partial<Record<ConnectorType, { status: string; complete: boolean }>>;
}
export interface Dataset {
  datasetId: string;
  category: Category;
  games: Game[];
  entities: Record<string, Entity>;
  sourceDate?: string;
  eligibleRoles?: ConnectorType[];
}
export interface SharedConnector {
  entityId: string;
  name?: string;
  types: ConnectorType[];
  fromTypes?: ConnectorType[];
  toTypes?: ConnectorType[];
}
export interface MatchState {
  datasetId: string;
  category: Category;
  currentGameId: string;
  history: readonly string[];
  usage: Readonly<Record<string, number>>;
  version: number;
}
export type { PublicConfiguration as AppConfiguration } from '../../../../src/configuration';
export interface Player {
  id: string;
  name: string;
}
export interface Room {
  id: string;
  code: string;
  hostId: string;
  guestId: string | null;
  category: Category;
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  /** Optional while clients roll forward from the schema without opening pools. */
  openingMode?: OpeningMode;
  openingPoolId?: string | null;
  matchId: string | null;
  revision: number;
  players: Player[];
}
export interface Turn {
  index: number;
  playerId: string | null;
  entryId: string;
  connectors: SharedConnector[];
  acceptedAt: string;
}
export interface Match {
  id: string;
  roomId: string;
  catalogueId: string;
  category: Category;
  status: 'active' | 'finished';
  activePlayer: string;
  deadline: string;
  state: MatchState;
  revision: number;
  winnerId: string | null;
  endReason: 'timeout' | 'conceded' | null;
  endedAt: string | null;
  room: Room;
  turns: Turn[];
}
export interface CommandResponse {
  ok: boolean;
  reason?: string;
  duplicate: boolean;
  serverTime: string;
  room?: Room;
  match?: Match;
  connectors?: SharedConnector[];
  exhausted?: string[];
}
export const ROLE_LABELS: Record<ConnectorType, string> = {
  developer: 'Developer',
  composer: 'Composer',
  voiceActor: 'Voice actor',
  character: 'Character',
  actor: 'Actor',
  director: 'Director',
  writer: 'Writer',
  cinematographer: 'Cinematographer',
  player: 'Player',
  manager: 'Manager',
};
export const CATEGORY_ROLES: Record<Category, ConnectorType[]> = {
  games: ['developer', 'composer', 'voiceActor', 'character'],
  movies: ['actor', 'director', 'writer', 'composer', 'cinematographer'],
  football: ['player', 'manager'],
};
export const CATEGORY_LABELS = { games: 'Games', movies: 'Movies', football: 'Football' };
export const MOVIES_VERSION = 'movies-tmdb-2017-v1';
export const FOOTBALL_VERSION = 'football-clubs-2026-10-28-v1';
export function readCategory(value: unknown): Category {
  return value === 'games' ? 'games' : value === 'football' ? 'football' : 'movies';
}

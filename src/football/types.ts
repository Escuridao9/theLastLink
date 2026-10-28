export const FOOTBALL_ROLES = ['player', 'manager'] as const;
export type FootballRole = (typeof FOOTBALL_ROLES)[number];
export interface CareerEvidence {
  statementId: string;
  property: 'P54' | 'P286' | 'P6087';
  /** Resolve the canonical person source through FootballDataset.entities. */
  job?: string;
  start?: string;
  end?: string;
  startPrecision?: number;
  endPrecision?: number;
  appearances?: number;
  /** Wikidata reference hashes, resolved under https://www.wikidata.org/reference/. */
  references: string[];
  rank: string;
}
export interface FootballCredit {
  entityId: string;
  sourceCredits: CareerEvidence[];
}
export interface FootballPerson {
  id: string;
  name: string;
  sourceUrl: string;
  externalIds: { wikidata: string };
}
export interface FootballClub {
  id: string;
  category: 'football';
  title: string;
  aliases: string[];
  country: string;
  region: string;
  foundedYear?: number;
  externalIds: { wikidata: string };
  credits: Record<FootballRole, FootballCredit[]>;
  coverage: Record<FootballRole, { status: 'observed' | 'not_observed'; complete: false }>;
  provenance: { source: 'Wikidata'; sourceUrl: string; importedAt: string };
}
export interface FootballDataset {
  schemaVersion: 1;
  datasetId: string;
  category: 'football';
  policyVersion: string;
  sourceDate: string;
  sourceLicense: 'CC0-1.0';
  scope: { teams: string; players: string; managers: string; crossRolePeople: true };
  eligibleRoles: readonly FootballRole[];
  clubs: FootballClub[];
  entities: Record<string, FootballPerson>;
}
export interface FootballConnector {
  entityId: string;
  types: FootballRole[];
  fromTypes: FootballRole[];
  toTypes: FootballRole[];
}
export interface FootballMatchState {
  readonly datasetId: string;
  readonly category: 'football';
  /** Existing multiplayer wire field: contains a club ID in this category. */
  readonly currentGameId: string;
  readonly history: readonly string[];
  readonly usage: Readonly<Record<string, number>>;
  readonly version: number;
}

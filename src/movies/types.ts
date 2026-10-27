/** Movies have their own eligibility policy. Games' same-role engine stays unchanged. */
export const MOVIE_ROLES = [
  "actor",
  "director",
  "writer",
  "composer",
  "cinematographer",
] as const;
export type MovieRole = (typeof MOVIE_ROLES)[number];
export interface SourceCredit {
  id: number;
  name: string;
  credit_id?: string;
  job?: string;
  department?: string;
  character?: string;
  order?: number;
  cast_id?: number;
  [key: string]: unknown;
}
export interface MovieCredit {
  entityId: string;
  sourceCredits: SourceCredit[];
}
export interface MoviePerson {
  id: string;
  name: string;
  aliases: string[];
  externalIds: { tmdb: number };
}
export interface Movie {
  id: string;
  category: "movies";
  title: string;
  originalTitle: string;
  releaseYear: number | null;
  releaseDate: string;
  aliases: string[];
  externalIds: { tmdb: number };
  genres: string[];
  countries: string[];
  language: string;
  credits: Record<MovieRole, MovieCredit[]>;
  coverage: Record<
    MovieRole,
    { status: "observed" | "not_observed"; complete: false }
  >;
  provenance: {
    source: string;
    sourceVersion: string;
    importedAt: string;
    payloadSha256: string;
  };
}
export interface MovieDataset {
  schemaVersion: 1;
  category: "movies";
  datasetId: string;
  policyVersion: string;
  eligibleRoles: readonly MovieRole[];
  entities: Record<string, MoviePerson>;
  movies: Movie[];
}
export interface MovieConnector {
  entityId: string;
  name?: string;
  types: MovieRole[];
  fromTypes: MovieRole[];
  toTypes: MovieRole[];
}
/** currentGameId is the existing wire field for either independent category. */
export interface MovieMatchState {
  readonly datasetId: string;
  readonly category: "movies";
  readonly currentGameId: string;
  readonly history: readonly string[];
  readonly usage: Readonly<Record<string, number>>;
  readonly version: number;
}
export interface MovieInput {
  metadata: Record<string, unknown>;
  credits: { cast: SourceCredit[]; crew: SourceCredit[] };
  source: string;
  sourceVersion: string;
  importedAt: string;
  payloadSha256: string;
}
export interface NormalizedMovie {
  movie: Movie;
  people: MoviePerson[];
  errors: string[];
  warnings: string[];
}

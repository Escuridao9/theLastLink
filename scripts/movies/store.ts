import { fileURLToPath } from 'node:url';
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname } from "node:path";
import {
  MOVIE_POLICY,
  normalizeMovie,
  publicationProblems,
} from "../../src/movies/normalize.ts";
import type { MovieInput, NormalizedMovie } from "../../src/movies/types.ts";

export const DEFAULT_STORE = fileURLToPath(new URL(
  "../../.cache/movies/research.sqlite",
  import.meta.url,
));
export function openStore(path = DEFAULT_STORE): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const checkpoint = new URL(
    "../../data/movies/import/research.sqlite.gz",
    import.meta.url,
  );
  if (path === DEFAULT_STORE && !existsSync(path) && existsSync(checkpoint))
    writeFileSync(path, gunzipSync(readFileSync(checkpoint)));
  const db = new DatabaseSync(path);
  db.exec(`pragma foreign_keys=on; pragma journal_mode=DELETE;
    create table if not exists imported_movies (
      tmdb_id integer primary key, payload_sha256 text not null, source text not null,
      imported_at text not null, raw_payload text not null, normalized text not null,
      errors text not null, warnings text not null, publication_problems text not null,
      import_status text not null check(import_status in ('validated','quarantined'))
    );
    create table if not exists import_failures (
      source_key text primary key, reason text not null, attempts integer not null default 1, last_attempt text not null
    );
    create table if not exists request_cache (
      resource text primary key, fetched_at text not null, body text not null
    );
    create table if not exists publications (
      id text primary key, sha256 text not null, published_at text not null, movie_count integer not null
    );
    create index if not exists imported_status on imported_movies(import_status);
  `);
  if (
    !db
      .prepare("pragma table_info(imported_movies)")
      .all()
      .some((c) => c["name"] === "policy_version")
  )
    db.exec(
      "alter table imported_movies add column policy_version text not null default 'tmdb-five-roles-v1'",
    );
  return db;
}
export function saveRecord(
  db: DatabaseSync,
  input: MovieInput,
): { skipped: boolean; normalized?: NormalizedMovie } {
  const id = input.metadata["id"];
  const old = db
    .prepare(
      "select payload_sha256,source,policy_version from imported_movies where tmdb_id=?",
    )
    .get(id as number);
  if (
    (old?.["source"] === "tmdb-api-v3" &&
      input.source === "tmdb-kaggle-5000") ||
    (old?.["payload_sha256"] === input.payloadSha256 &&
      old?.["policy_version"] === MOVIE_POLICY)
  )
    return { skipped: true };
  const normalized = normalizeMovie(input);
  const problems = publicationProblems(normalized);
  db.prepare(
    `insert into imported_movies values (?,?,?,?,?,?,?,?,?,?,?)
    on conflict(tmdb_id) do update set payload_sha256=excluded.payload_sha256, source=excluded.source,
      imported_at=excluded.imported_at, raw_payload=excluded.raw_payload, normalized=excluded.normalized,
      errors=excluded.errors, warnings=excluded.warnings, publication_problems=excluded.publication_problems, import_status=excluded.import_status,policy_version=excluded.policy_version
  `,
  ).run(
    id as number,
    input.payloadSha256,
    input.source,
    input.importedAt,
    JSON.stringify(input),
    JSON.stringify(normalized),
    JSON.stringify(normalized.errors),
    JSON.stringify(normalized.warnings),
    JSON.stringify(problems),
    problems.length ? "quarantined" : "validated",
    MOVIE_POLICY,
  );
  db.prepare("delete from import_failures where source_key=?").run(
    `tmdb:movie:${id}`,
  );
  return { skipped: false, normalized };
}
export function failRecord(
  db: DatabaseSync,
  key: string,
  reason: string,
): void {
  db.prepare(
    `insert into import_failures values(?,?,1,?) on conflict(source_key) do update set reason=excluded.reason, attempts=attempts+1,last_attempt=excluded.last_attempt`,
  ).run(key, reason, new Date().toISOString());
}

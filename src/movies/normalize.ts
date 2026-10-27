import { MOVIE_ROLES } from "./types.ts";
import type {
  MovieInput,
  MovieRole,
  MovieCredit,
  MoviePerson,
  NormalizedMovie,
  SourceCredit,
} from "./types.ts";

// Deliberately exact and finite: music department membership is never sufficient.
export const CREW_JOBS: Readonly<Record<string, MovieRole>> = Object.freeze({
  Director: "director",
  Writer: "writer",
  Screenplay: "writer",
  Teleplay: "writer",
  Novel: "writer",
  Book: "writer",
  "Short Story": "writer",
  "Original Music Composer": "composer",
  "Director of Photography": "cinematographer",
});
export const MOVIE_POLICY = "tmdb-five-roles-v1";
export const positiveId = (id: unknown): id is number =>
  typeof id === "number" && Number.isSafeInteger(id) && id > 0;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function normalizeMovie(input: MovieInput): NormalizedMovie {
  const m = input.metadata;
  if (!positiveId(m["id"])) throw Error("invalid_movie_identity");
  if (!Array.isArray(input.credits.cast) || !Array.isArray(input.credits.crew))
    throw Error("missing_credit_payload");
  const errors: string[] = [],
    warnings: string[] = [];
  const credits = Object.fromEntries(
    MOVIE_ROLES.map((role) => [role, []]),
  ) as unknown as Record<MovieRole, MovieCredit[]>;
  const people = new Map<string, MoviePerson>();
  const sourceIds = new Map<string, number>();
  function add(role: MovieRole, c: SourceCredit): void {
    if (!positiveId(c.id) || !text(c.name)) {
      errors.push("invalid_person_identity");
      return;
    }
    if (typeof c.credit_id !== "string" || !c.credit_id.trim()) {
      errors.push("missing_source_credit_id");
      return;
    }
    const previous = sourceIds.get(c.credit_id);
    if (previous !== undefined && previous !== c.id) {
      errors.push("ambiguous_credit_identity");
      return;
    }
    sourceIds.set(c.credit_id, c.id);
    const entityId = `tmdb:person:${c.id}`;
    const person = people.get(entityId);
    if (!person)
      people.set(entityId, {
        id: entityId,
        name: c.name.trim(),
        aliases: [],
        externalIds: { tmdb: c.id },
      });
    else if (
      person.name !== c.name.trim() &&
      !person.aliases.includes(c.name.trim())
    ) {
      person.aliases.push(c.name.trim());
      warnings.push("person_label_variant");
    }
    let credit = credits[role].find((x) => x.entityId === entityId);
    if (!credit) {
      credit = { entityId, sourceCredits: [] };
      credits[role].push(credit);
    }
    // Multiple characters and jobs remain evidence; identical source records are deduplicated.
    if (
      !credit.sourceCredits.some((x) => JSON.stringify(x) === JSON.stringify(c))
    )
      credit.sourceCredits.push(structuredClone(c));
  }
  for (const c of input.credits.cast) {
    // TMDB sometimes explicitly labels an uncredited appearance in the character string.
    if (/\buncredited\b/i.test(text(c.character))) {
      warnings.push("uncredited_cast_excluded");
      continue;
    }
    add("actor", c); // Includes voice performances; never create a separate voice identity/allowance.
  }
  for (const c of input.credits.crew) {
    const role = typeof c.job === "string" ? CREW_JOBS[c.job] : undefined;
    if (role) add(role, c);
  }
  for (const role of MOVIE_ROLES)
    credits[role].sort((a, b) => a.entityId.localeCompare(b.entityId));
  const releaseDate = text(m["release_date"]);
  const year = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
    ? Number(releaseDate.slice(0, 4))
    : null;
  if (!text(m["title"])) errors.push("missing_title");
  if (!year || year < 1888 || year > new Date().getUTCFullYear())
    errors.push("invalid_release_date");
  if (m["status"] !== "Released") errors.push("not_released");
  if (m["adult"] === true) errors.push("adult_record");
  // A complete API response is not proof of complete real-world screen credits.
  for (const role of MOVIE_ROLES)
    if (!credits[role].length) warnings.push(`not_observed:${role}`);
  const title = text(m["title"]),
    originalTitle = text(m["original_title"]) || title;
  const names = (v: unknown, field: string): string[] =>
    Array.isArray(v)
      ? v
          .map((x) => text(x?.[field]))
          .filter(Boolean)
          .sort()
      : [];
  return {
    movie: {
      id: `tmdb:movie:${m["id"]}`,
      category: "movies",
      title,
      originalTitle,
      releaseYear: year,
      releaseDate,
      aliases: originalTitle === title ? [] : [originalTitle],
      externalIds: { tmdb: m["id"] },
      genres: names(m["genres"], "name"),
      countries: names(m["production_countries"], "iso_3166_1"),
      language: text(m["original_language"]),
      credits,
      coverage: Object.fromEntries(
        MOVIE_ROLES.map((role) => [
          role,
          {
            status: credits[role].length ? "observed" : "not_observed",
            complete: false,
          },
        ]),
      ) as NormalizedMovie["movie"]["coverage"],
      provenance: {
        source: input.source,
        sourceVersion: input.sourceVersion,
        importedAt: input.importedAt,
        payloadSha256: input.payloadSha256,
      },
    },
    people: [...people.values()],
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

/** Publication is an explicit second step; observation gaps are retained and disclosed. */
export function publicationProblems(record: NormalizedMovie): string[] {
  const c = record.movie.credits;
  return [
    ...record.errors,
    ...(["actor", "director", "writer"] as const)
      .filter((role) => !c[role].length)
      .map((role) => `required_role_missing:${role}`),
    ...(!c.composer.length && !c.cinematographer.length
      ? ["both_score_and_camera_not_observed"]
      : []),
  ];
}

/** RFC 4180 parser, including quoted commas, escaped quotes and embedded newlines. */
export function* csvRecords(input: string): Generator<Record<string, string>> {
  let row: string[] = [],
    field = "",
    quoted = false;
  let header: string[] | undefined;
  for (let i = 0; i <= input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else if (c === undefined) throw Error("unterminated_csv_field");
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === undefined) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (!header) header = row.map((x) => x.replace(/^\uFEFF/, ""));
      else if (row.some(Boolean)) {
        if (row.length !== header.length) throw Error("csv_column_count");
        yield Object.fromEntries(header.map((h, j) => [h, row[j]!]));
      }
      row = [];
    } else field += c;
  }
}

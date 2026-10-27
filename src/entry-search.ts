export interface SearchEntry {
  id: string;
  title: string;
  releaseYear?: number | null;
  aliases?: string[];
}
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
/** Titles plus years disambiguate remakes; source IDs remain the submitted identity. */
export function searchEntries<T extends SearchEntry>(
  entries: readonly T[],
  query: string,
  played: readonly string[] = [],
  limit = 30,
): T[] {
  const q = fold(query.trim()),
    tokens = q.split(/\s+/).filter(Boolean),
    excluded = new Set(played);
  return entries
    .filter(
      (e) =>
        !excluded.has(e.id) &&
        tokens.every((t) =>
          fold(
            [e.title, ...(e.aliases ?? []), e.releaseYear ?? ""].join(" "),
          ).includes(t),
        ),
    )
    .sort(
      (a, b) =>
        Number(fold(b.title).startsWith(q)) -
          Number(fold(a.title).startsWith(q)) ||
        a.title.localeCompare(b.title) ||
        (a.releaseYear ?? 0) - (b.releaseYear ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

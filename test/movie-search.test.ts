import { test } from "node:test";
import assert from "node:assert/strict";
import { searchEntries } from "../src/entry-search.ts";
test("movie search disambiguates identical titles and remakes by year and stable ID", () => {
  const movies = [
    { id: "a", title: "The Host", releaseYear: 2006 },
    { id: "b", title: "The Host", releaseYear: 2013 },
  ];
  assert.deepEqual(
    searchEntries(movies, "the host").map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    searchEntries(movies, "host 2013").map((x) => x.id),
    ["b"],
  );
  assert.deepEqual(
    searchEntries(movies, "host", ["a"]).map((x) => x.id),
    ["b"],
  );
});
test("movie original titles and accent-insensitive names remain searchable", () => {
  const movies = [
    {
      id: "1",
      title: "Amélie",
      releaseYear: 2001,
      aliases: ["Le Fabuleux Destin d’Amélie Poulain"],
    },
  ];
  assert.equal(searchEntries(movies, "amelie").length, 1);
  assert.equal(searchEntries(movies, "fabuleux 2001").length, 1);
  assert.equal(searchEntries(movies, "2002").length, 0);
});

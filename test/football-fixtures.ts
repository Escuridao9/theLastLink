// Synthetic rules fixtures only; these are never part of the published catalogue.
import {
  normalizeFootball,
  type FootballObservation,
  type ObservedCareer,
} from '../src/football/normalize.ts';

export function career(
  person = 'Q1001',
  club = 'Q101',
  extra: Partial<ObservedCareer> = {},
): ObservedCareer {
  return {
    humanConfirmed: true,
    person: `http://www.wikidata.org/entity/${person}`,
    personLabel: `Synthetic ${person}`,
    club: `http://www.wikidata.org/entity/${club}`,
    property: 'P54',
    occupationRoot: 'Q937857',
    appearances: '12',
    statement: `http://www.wikidata.org/entity/statement/${person}-${club.slice(1)}-ab12`,
    rank: 'http://wikiba.se/ontology#NormalRank',
    ...extra,
  };
}
export function observation(rows: ObservedCareer[]): FootballObservation {
  return {
    source: 'Wikidata',
    license: 'CC0-1.0',
    collectedAt: '2026-10-28T10:00:00Z',
    clubs: Array.from({ length: 6 }, (_, i) => ({
      wikidataId: `Q${101 + i}`,
      name: `Synthetic club ${i}`,
      aliases: [],
      country: 'Synthetic country',
      region: 'Europe',
      familiar: i === 0,
    })),
    rows,
  };
}
export function footballFixture() {
  return normalizeFootball(
    observation([
      // One person across five clubs, including a player-to-manager bridge.
      ...['Q101', 'Q102', 'Q103', 'Q104', 'Q105'].map((club, i) =>
        career('Q1001', club, i === 1 ? { property: 'P286', occupationRoot: 'Q628099' } : {}),
      ),
      career('Q1001', 'Q101', {
        property: 'P286',
        occupationRoot: 'Q628099',
        statement: 'Q101-dead-beef',
      }),
      // A second shared person must be consumed as well, even if the first is exhausted.
      career('Q1002', 'Q104'),
      career('Q1002', 'Q105'),
      // Matching display names must never merge these different identities.
      career('Q1003', 'Q101', { personLabel: 'Same name' }),
      career('Q1004', 'Q106', { personLabel: 'Same name' }),
    ]),
    'football-synthetic-v1',
  ).dataset;
}

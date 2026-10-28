/** Read-only, resumable CC0 source collection. This never publishes a catalogue. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const cache = new URL('.cache/football/', root);
await mkdir(cache, { recursive: true });
const clubs = JSON.parse(await readFile(new URL('scripts/football/clubs.json', root), 'utf8'));
const agent =
  'TheLastLink/1.0 (https://github.com/Escuridao9/theLastLink; educational CC0 collection)';
const hashes = [];
async function get(url) {
  const hash = createHash('sha256').update(url).digest('hex');
  const file = new URL(hash + '.json', cache);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': agent,
            Accept: 'application/sparql-results+json, application/json',
          },
          signal: AbortSignal.timeout(55000),
        });
        if (response.status === 429) {
          const seconds = Math.max(60, Number(response.headers.get('retry-after')) || 60);
          if (attempt === 2)
            throw Error(
              'Source rate limit. Resume collection later; cached responses are preserved.',
            );
          console.log('Wikidata rate limit: pausing for ' + seconds + ' seconds.');
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
          continue;
        }
        if (!response.ok) throw Error('Source HTTP ' + response.status);
        raw = await response.text();
        JSON.parse(raw);
        await writeFile(file, raw);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
      }
    }
  }
  hashes.push({
    requestSha256: hash,
    responseSha256: createHash('sha256').update(raw).digest('hex'),
  });
  const data = JSON.parse(raw);
  if (data.error) throw Error('Wikidata: ' + data.error.code);
  return data;
}
const entities = {};
for (let start = 0; start < clubs.length; start += 30) {
  const chunk = clubs.slice(start, start + 30).filter((c) => !c.wikidataId);
  const params = new URLSearchParams({
    action: 'wbgetentities',
    sites: 'enwiki',
    titles: chunk.map((c) => c.article).join('|'),
    props: 'labels|descriptions|claims|aliases|sitelinks',
    languages: 'en|pt',
    format: 'json',
    redirects: 'yes',
  });
  Object.assign(entities, (await get('https://www.wikidata.org/w/api.php?' + params)).entities);
}
const explicit = clubs.filter((c) => c.wikidataId);
if (explicit.length) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: explicit.map((c) => c.wikidataId).join('|'),
    props: 'labels|descriptions|claims|aliases|sitelinks',
    languages: 'en|pt',
    format: 'json',
  });
  Object.assign(entities, (await get('https://www.wikidata.org/w/api.php?' + params)).entities);
}
const resolved = clubs.map((c) => {
  const entity = c.wikidataId
    ? entities[c.wikidataId]
    : Object.values(entities).find((e) => e.sitelinks?.enwiki?.title === c.article);
  if (!entity || 'missing' in entity || !/^Q[1-9]\d*$/.test(entity.id))
    throw Error('Review unresolved club identity: ' + c.article);
  const country = entity.claims?.P17?.find((s) => s.rank !== 'deprecated')?.mainsnak?.datavalue
    ?.value?.id;
  return {
    ...c,
    wikidataId: entity.id,
    sourceRevision: entity.lastrevid ?? null,
    sourceLabel: entity.labels?.en?.value ?? c.name,
    description: entity.descriptions?.en?.value ?? '',
    countryId: country ?? null,
    aliases: [
      ...new Set(
        [
          entity.labels?.en?.value,
          ...(entity.aliases?.en ?? []).map((a) => a.value),
          ...(entity.aliases?.pt ?? []).map((a) => a.value),
        ].filter((x) => typeof x === 'string' && x.length < 80),
      ),
    ],
    founding:
      entity.claims?.P571?.find((s) => s.rank !== 'deprecated')?.mainsnak?.datavalue?.value?.time ??
      null,
  };
});
if (new Set(resolved.map((c) => c.wikidataId)).size !== clubs.length)
  throw Error('Two selected clubs resolve to one identity. Review them.');
const countryIds = [...new Set(resolved.map((c) => c.countryId).filter(Boolean))];
const countryParams = new URLSearchParams({
  action: 'wbgetentities',
  ids: countryIds.join('|'),
  props: 'labels',
  languages: 'en',
  format: 'json',
});
const countryEntities = (await get('https://www.wikidata.org/w/api.php?' + countryParams)).entities;
for (const c of resolved) c.country = countryEntities[c.countryId]?.labels?.en?.value ?? '';
await writeFile(new URL('resolved-clubs.json', cache), JSON.stringify(resolved, null, 2) + '\n');
// QLever is a documented alternative Wikidata endpoint. Standard SPARQL avoids the WDQS-only label service.
const endpoint = 'https://qlever.dev/api/wikidata';
const prefixes = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX pqv: <http://www.wikidata.org/prop/qualifier/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;
const rows = [];
for (const property of ['P54', 'P286']) {
  const occupation = property === 'P54' ? 'Q937857' : 'Q628099';
  const chunkSize = property === 'P54' ? 10 : 30;
  for (let start = 0; start < resolved.length; start += chunkSize) {
    const chunk = resolved.slice(start, start + chunkSize);
    const relation =
      property === 'P54'
        ? '?statement ps:P54 ?club . ?person p:P54 ?statement .'
        : '?club p:P286 ?statement . ?statement ps:P286 ?person .';
    const query =
      prefixes +
      `SELECT ?person ?personLabel ?club ?statement ?rank ?start ?startPrecision ?end ?endPrecision ?role ?roleLabel ?appearances ?reference WHERE {
      VALUES ?club { ${chunk.map((c) => 'wd:' + c.wikidataId).join(' ')} }
      ${relation}
      ?person wdt:P31 wd:Q5 .
      ?person wdt:P106/wdt:P279* wd:${occupation} .
      ?statement wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
      OPTIONAL { ?statement pq:P580 ?start . OPTIONAL { ?statement pqv:P580/wikibase:timePrecision ?startPrecision } }
      OPTIONAL { ?statement pq:P582 ?end . OPTIONAL { ?statement pqv:P582/wikibase:timePrecision ?endPrecision } }
      OPTIONAL { ?statement pq:P1350 ?appearances }
      OPTIONAL { ?statement (pq:P2868|pq:P3831) ?role . OPTIONAL { ?role rdfs:label ?roleLabel . FILTER(LANG(?roleLabel) = "en") } }
      OPTIONAL { ?statement prov:wasDerivedFrom ?reference }
      OPTIONAL { ?person rdfs:label ?enName . FILTER(LANG(?enName) = "en") }
      OPTIONAL { ?person rdfs:label ?ptName . FILTER(LANG(?ptName) = "pt") }
      BIND(COALESCE(?enName, ?ptName) AS ?personLabel)
    }`;
    const data = await get(endpoint + '?' + new URLSearchParams({ query, format: 'json' }));
    const batch = data.results.bindings.map((row) => ({
      ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])),
      property,
      occupationRoot: occupation,
      humanConfirmed: true,
    }));
    rows.push(...batch);
    console.log(
      `${property}: ${start + 1}–${start + chunk.length}/${resolved.length} clubs · ${batch.length} observed source rows`,
    );
  }
}
const freshnessQuery =
  'PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX schema: <http://schema.org/> SELECT * WHERE { { SELECT (MIN(?date_modified) AS ?updates_complete_until) { wikibase:Dump schema:dateModified ?date_modified } } UNION { wikibase:Dump wikibase:updatesCompleteUntil ?updates_complete_until } } ORDER BY DESC(?updates_complete_until) LIMIT 1';
const freshness = await get(
  endpoint + '?' + new URLSearchParams({ query: freshnessQuery, format: 'json' }),
);
const output = {
  source: 'Wikidata',
  endpoint,
  license: 'CC0-1.0',
  collectedAt: new Date().toISOString(),
  sourceUpdatesCompleteUntil: freshness.results.bindings[0]?.updates_complete_until?.value ?? null,
  clubs: resolved,
  rows,
  sourceHashes: hashes,
};
await writeFile(new URL('observed.json', cache), JSON.stringify(output) + '\n');
const roles = new Map();
for (const row of rows) if (row.role) roles.set(row.role, row.roleLabel ?? row.role);
console.log(
  JSON.stringify(
    {
      clubs: resolved.length,
      sourceRows: rows.length,
      roles: Object.fromEntries(roles),
      output: fileURLToPath(new URL('observed.json', cache)),
      published: false,
    },
    null,
    2,
  ),
);

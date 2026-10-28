/** Explicit local preparation step. Collecting observations never publishes anything. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeFootball, type FootballObservation } from '../../src/football/normalize.ts';
import { FootballConnectionEngine } from '../../src/football/engine.ts';
const root = new URL('../../', import.meta.url);
const observed = JSON.parse(
  readFileSync(new URL('.cache/football/observed.json', root), 'utf8'),
) as FootballObservation;
const id =
  process.argv.find((arg) => arg.startsWith('--dataset-id='))?.slice('--dataset-id='.length) ??
  'football-clubs-2026-10-28-v1';
if (!/^football-clubs-\d{4}-\d{2}-\d{2}-v[1-9]\d*$/.test(id))
  throw Error('Choose an explicit football catalogue version ID.');
const result = normalizeFootball(observed, id);
const engine = new FootballConnectionEngine(result.dataset);
const components = engine.connectedComponents();
const neighbours = result.dataset.clubs.map((c) => ({
  id: c.id,
  title: c.title,
  country: c.country,
  region: c.region,
  players: c.credits.player.length,
  managers: c.credits.manager.length,
  connections: engine.neighbors(c.id).length,
}));
const updatesCompleteUntil = observed.sourceUpdatesCompleteUntil ?? null;
const out = new URL('data/football/published/' + id + '/', root);
const write = process.argv.includes('--write');
const dataset = result.dataset;
// One club and person per line keeps the frozen data inspectable without adding a build dependency.
const { clubs, entities, ...head } = dataset;
const body =
  JSON.stringify(head).slice(0, -1) +
  ',\n"clubs":[\n' +
  clubs.map((c) => JSON.stringify(c)).join(',\n') +
  '\n],\n"entities":{\n' +
  Object.entries(entities)
    .map(([id, p]) => JSON.stringify(id) + ':' + JSON.stringify(p))
    .join(',\n') +
  '\n}}\n';
if (write) {
  const path = new URL('catalogue.json', out);
  if (existsSync(path) && readFileSync(path, 'utf8') !== body)
    throw Error(
      'This catalogue version already exists. Choose a new --dataset-id; published versions are immutable.',
    );
  mkdirSync(out, { recursive: true });
  writeFileSync(path, body);
  writeFileSync(
    new URL('quarantine.jsonl', out),
    result.quarantine.map((q) => JSON.stringify(q)).join('\n') + '\n',
  );
}
const manifest = {
  datasetId: dataset.datasetId,
  source: 'Wikidata',
  sourceEndpoint: observed.endpoint,
  sourceLicense: dataset.sourceLicense,
  sourceDate: dataset.sourceDate,
  sourceUpdatesCompleteUntil: updatesCompleteUntil,
  sha256: createHash('sha256').update(body).digest('hex'),
  clubs: clubs.length,
  ...result.audit,
  regions: Object.fromEntries(
    [...new Set(clubs.map((c) => c.region))].map((r) => [
      r,
      clubs.filter((c) => c.region === r).length,
    ]),
  ),
  components: components.map((c) => c.length),
  largestComponent: components[0]?.length ?? 0,
  isolates: neighbours.filter((n) => n.connections === 0).map((n) => n.id),
  averageConnections: neighbours.reduce((n, c) => n + c.connections, 0) / neighbours.length,
  sourceHashes: observed.sourceHashes,
  clubCoverage: neighbours,
};
if (write) writeFileSync(new URL('manifest.json', out), JSON.stringify(manifest, null, 2) + '\n');
const familiar = {
  poolId: 'football-familiar-2026-10-28-v1',
  catalogueId: dataset.datasetId,
  mode: 'familiar',
  label: 'Familiar favourites',
  selectionNotes:
    'A curated, unranked selection of internationally recognizable major clubs, with Portuguese and worldwide representation. Only the first club is restricted; the complete published catalogue remains playable.',
  entries: observed.clubs
    .filter((c) => c.familiar)
    .map((c) => ({ id: 'wikidata:club:' + c.wikidataId, title: c.name }))
    .filter((c) => engine.neighbors(c.id).length > 0),
};
if (write) {
  mkdirSync(new URL('data/openers/', root), { recursive: true });
  writeFileSync(
    new URL('data/openers/football-familiar-v1.json', root),
    JSON.stringify(familiar, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify(
    {
      clubs: manifest.clubs,
      people: manifest.people,
      playerCredits: manifest.playerCredits,
      managerCredits: manifest.managerCredits,
      quarantinedClaims: manifest.quarantinedClaims,
      components: manifest.components,
      averageConnections: manifest.averageConnections,
      familiar: familiar.entries.length,
      sourceUpdatesCompleteUntil: updatesCompleteUntil,
    },
    null,
    2,
  ),
);

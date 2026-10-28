/** Build only from the frozen local catalogue. No API keys or network access. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import { MovieConnectionEngine } from '../src/movies/engine.ts';
import type {
  FootballDataset,
  FootballClub,
  FootballRole,
  CareerEvidence,
} from '../src/football/types.ts';
import type { MovieDataset } from '../src/movies/types.ts';
const root = new URL('../', import.meta.url),
  id = 'football-clubs-2026-10-28-v1';
const source = new URL(`data/football/published/${id}/catalogue.json`, root);
const raw = readFileSync(source, 'utf8');
const data = JSON.parse(raw) as FootballDataset;
const manifest = JSON.parse(
  readFileSync(new URL(`data/football/published/${id}/manifest.json`, root), 'utf8'),
) as { sha256: string; playerCredits: number; managerCredits: number };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
if (data.datasetId !== id || sha(raw) !== manifest.sha256)
  throw Error(
    'Frozen Football catalogue hash mismatch. Prepare a new version instead of editing published data.',
  );
const engine = new FootballConnectionEngine(data),
  component = new Set(engine.connectedComponents()[0]);
const roles = ['player', 'manager'] as const;
const uiEvidence = (e: CareerEvidence, role: FootballRole, person: string) => ({
  property: e.property,
  statementId: e.statementId,
  sourceUrl: data.entities[person]!.sourceUrl,
  job: `${role === 'player' ? 'Senior player' : 'Head manager'} · ${e.start?.slice(0, 4) ?? '?'}–${e.end?.slice(0, 4) ?? '?'}`,
});
const view = (c: FootballClub, index: number) => ({
  id: c.id,
  category: 'football' as const,
  title: c.title,
  aliases: c.aliases,
  countries: [c.country],
  region: c.region,
  ...(c.foundedYear ? { foundedYear: c.foundedYear } : {}),
  externalIds: c.externalIds,
  detailShard: index,
  credits: { player: [], manager: [] },
});
const games = data.clubs.map(view);
const snapshot = {
  datasetId: id,
  category: 'football',
  sourceDate: data.sourceDate,
  games,
  entities: {},
};
function write(path: string, value: unknown) {
  const url = new URL(path, root);
  mkdirSync(new URL('.', url), { recursive: true });
  writeFileSync(url, JSON.stringify(value) + '\n');
}
write('web/public/football-index-v1.json', snapshot);
for (const [index, club] of data.clubs.entries()) {
  const people = Object.fromEntries(
    roles.flatMap((role) => club.credits[role].map((c) => [c.entityId, data.entities[c.entityId]])),
  );
  const credits = Object.fromEntries(
    roles.map((role) => [
      role,
      club.credits[role].map((c) => ({
        entityId: c.entityId,
        sourceCredits: c.sourceCredits.map((e) => uiEvidence(e, role, c.entityId)),
      })),
    ]),
  );
  write(`web/public/football/${id}/credits-${index}.json`, {
    [club.id]: {
      ...games[index],
      credits,
      people,
      coverage: club.coverage,
      provenance: club.provenance,
    },
  });
}
interface Pool {
  poolId: string;
  catalogueId: string;
  mode: 'familiar';
  label: string;
  selectionNotes: string;
  entries: { id: string; title: string }[];
}
const pools = ['movies', 'football'].map(
  (category) =>
    JSON.parse(
      readFileSync(new URL(`data/openers/${category}-familiar-v1.json`, root), 'utf8'),
    ) as Pool,
);
const movies = JSON.parse(
  readFileSync(new URL('data/movies/published/movies-tmdb-2017-v1/catalogue.json', root), 'utf8'),
) as MovieDataset;
const movieEngine = new MovieConnectionEngine(movies);
for (const pool of pools) {
  const e = pool.catalogueId === id ? engine : movieEngine;
  if (
    new Set(pool.entries.map((e) => e.id)).size !== pool.entries.length ||
    pool.entries.length < 2 ||
    pool.entries.some((p) => !e.gameIds().includes(p.id) || !e.neighbors(p.id).length)
  )
    throw Error('Opening pool contains an unknown, duplicate or unplayable entry.');
}
write(
  'web/public/opening-pools-v1.json',
  Object.fromEntries(
    pools.map((p) => [
      p.catalogueId,
      [{ mode: p.mode, label: p.label, pool_id: p.poolId, entries: p.entries.length }],
    ]),
  ),
);

// The preview is populated with actual legal source-backed moves, while player state stays mocked.
const history = ['Q18656', 'Q8682', 'Q483020', 'Q7156', 'Q1543', 'Q9616', 'Q1130849', 'Q9617'].map(
  (q) => 'wikidata:club:' + q,
);
let state = engine.createMatch(history[0]!);
const named = (connectors: ReturnType<typeof engine.sharedConnectors>) =>
  connectors.map((c) => ({ ...c, name: data.entities[c.entityId]!.name }));
const turns = [
  {
    index: 0,
    playerId: null as string | null,
    entryId: history[0]!,
    connectors: [] as ReturnType<typeof named>,
    acceptedAt: '2026-10-28T10:00:00.000Z',
  },
];
for (const [offset, entryId] of history.slice(1).entries()) {
  const result = engine.applyMove(state, entryId);
  if (!result.ok) throw Error('Invalid Football preview history: ' + result.reason);
  state = result.state;
  turns.push({
    index: state.version,
    playerId: state.version % 2 ? 'preview-alex' : 'preview-diogo',
    entryId,
    connectors: named(result.connectors),
    acceptedAt: new Date(Date.parse('2026-10-28T10:00:00Z') + (offset + 1) * 7000).toISOString(),
  });
}
write('web/public/design-review/football-fixture.json', { state, turns });
const receiptsPath = new URL('web/public/design-review/move-receipts.json', root);
const receipts = JSON.parse(readFileSync(receiptsPath, 'utf8'));
receipts.football = {
  version: state.version,
  moves: Object.fromEntries(
    data.clubs.map((c) => {
      const result = engine.applyMove(state, c.id);
      return [c.id, { ...result, connectors: named(result.connectors) }];
    }),
  ),
};
writeFileSync(receiptsPath, JSON.stringify(receipts) + '\n');

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function migration(name: string, sql: string) {
  const path = new URL('supabase/migrations/' + name, root);
  if (existsSync(path) && readFileSync(path, 'utf8') !== sql)
    throw Error(
      'Generated migration already exists with different bytes: ' +
        name +
        '. Use a new catalogue/pool version.',
    );
  writeFileSync(path, sql);
}
const unpublished = `exists(select 1 from public.catalogues where id=${literal(id)} and not published)`;
const entries = data.clubs.map((c) => ({
  id: c.id,
  title: c.title,
  release_year: null,
  external_ids: c.externalIds,
  seed_eligible: component.has(c.id) && engine.neighbors(c.id).length > 0,
}));
const meta = `-- Frozen, compact Football metadata. Full career evidence is retained in data/football/published/${id}/.\nbegin;\ninsert into public.catalogues(id,category_id,sha256,snapshot) values(${literal(id)},'football',${literal(manifest.sha256)},${literal(JSON.stringify(snapshot))}::jsonb) on conflict(id) do nothing;\ndo $$begin if not exists(select 1 from public.catalogues where id=${literal(id)} and category_id='football' and sha256=${literal(manifest.sha256)}) then raise exception 'football_catalogue_version_conflict'; end if; end$$;\ninsert into public.entries(catalogue_id,id,title,release_year,external_ids,seed_eligible)\nselect ${literal(id)},x.id,x.title,x.release_year,x.external_ids,x.seed_eligible from jsonb_to_recordset(${literal(JSON.stringify(entries))}::jsonb) as x(id text,title text,release_year int,external_ids jsonb,seed_eligible boolean) where ${unpublished} on conflict do nothing;\ncommit;\n`;
migration('20261028100100_football_catalogue_metadata.sql', meta);
const entityRows = Object.values(data.entities).map((p) => ({
  id: p.id,
  name: p.name,
  external_ids: p.externalIds,
}));
const creditRows = data.clubs.flatMap((c) =>
  roles.flatMap((role) =>
    c.credits[role].map((credit) => ({
      entry_id: c.id,
      entity_id: credit.entityId,
      role,
      provenance: {
        source: 'Wikidata',
        personName: data.entities[credit.entityId]!.name,
        sourceCredits: credit.sourceCredits.map((e) => uiEvidence(e, role, credit.entityId)),
        coverageComplete: false,
      },
    })),
  ),
);
const ordered = creditRows
  .slice()
  .sort((a, b) =>
    a.entry_id < b.entry_id
      ? -1
      : a.entry_id > b.entry_id
        ? 1
        : a.entity_id < b.entity_id
          ? -1
          : a.entity_id > b.entity_id
            ? 1
            : a.role < b.role
              ? -1
              : a.role > b.role
                ? 1
                : 0,
  );
const relationSignature = md5(
  ordered.map((c) => c.entry_id + '|' + c.entity_id + '|' + c.role).join('\n'),
);
let chunkIndex = 0;
function chunks<T>(rows: T[], kind: 'people' | 'careers') {
  let batch: T[] = [],
    bytes = 0;
  const flush = () => {
    if (!batch.length) return;
    const timestamp = new Date(Date.UTC(2026, 9, 28, 10, 2, chunkIndex++))
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, '');
    const payload = literal(JSON.stringify(batch));
    const body =
      kind === 'people'
        ? `insert into public.connector_entities(id,name,external_ids) select x.id,x.name,x.external_ids from jsonb_to_recordset(${payload}::jsonb) as x(id text,name text,external_ids jsonb) on conflict do nothing;`
        : `insert into public.entry_credits(catalogue_id,entry_id,entity_id,role,provenance) select ${literal(id)},x.entry_id,x.entity_id,x.role,x.provenance from jsonb_to_recordset(${payload}::jsonb) as x(entry_id text,entity_id text,role text,provenance jsonb) where ${unpublished} on conflict do nothing;`;
    migration(
      `${timestamp}_football_${kind}_${chunkIndex.toString().padStart(2, '0')}.sql`,
      `-- Bounded ${kind} import chunk; safe to retry after an interrupted unpublished import.\nbegin;\n${body}\ncommit;\n`,
    );
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const length = Buffer.byteLength(JSON.stringify(row), 'utf8') + 2;
    if (bytes + length > 750000) flush();
    batch.push(row);
    bytes += length;
  }
  flush();
}
chunks(entityRows, 'people');
chunks(creditRows, 'careers');
let final = `-- Verify all imported relationships before atomically enabling Football and familiar opening pools.\nbegin;\n`;
for (const pool of pools) {
  const ids = pool.entries.map((e) => e.id).sort();
  final += `insert into public.opening_pools(id,catalogue_id,mode,label,selection_notes,manifest_sha256) values(${literal(pool.poolId)},${literal(pool.catalogueId)},'familiar',${literal(pool.label)},${literal(pool.selectionNotes)},${literal(sha(JSON.stringify(ids)))}) on conflict do nothing;\n`;
  final += `insert into public.opening_pool_entries(pool_id,catalogue_id,entry_id) select ${literal(pool.poolId)},${literal(pool.catalogueId)},x from jsonb_array_elements_text(${literal(JSON.stringify(ids))}::jsonb) x where exists(select 1 from public.opening_pools where id=${literal(pool.poolId)} and not published) on conflict do nothing;\n`;
}
final += `do $$\nbegin\n if (select count(*) from public.entries where catalogue_id=${literal(id)})<>${entries.length} then raise exception 'football_entry_count_mismatch'; end if;\n if (select count(*) from public.entry_credits where catalogue_id=${literal(id)})<>${creditRows.length} then raise exception 'football_credit_count_mismatch'; end if;\n if (select md5(string_agg(entry_id||'|'||entity_id||'|'||role,E'\\n' order by entry_id collate "C",entity_id collate "C",role collate "C")) from public.entry_credits where catalogue_id=${literal(id)})<>${literal(relationSignature)} then raise exception 'football_relationship_signature_mismatch'; end if;\n if not exists(select 1 from public.catalogues where id=${literal(id)} and sha256=${literal(manifest.sha256)}) then raise exception 'football_source_hash_mismatch'; end if;\n`;
for (const pool of pools) {
  const ids = pool.entries.map((e) => e.id).sort();
  final += ` if (select count(*) from public.opening_pool_entries where pool_id=${literal(pool.poolId)})<>${ids.length} or (select md5(string_agg(entry_id,E'\\n' order by entry_id collate "C")) from public.opening_pool_entries where pool_id=${literal(pool.poolId)})<>${literal(md5(ids.join('\n')))} then raise exception 'opening_pool_signature_mismatch'; end if;\n`;
  final += ` if exists(select 1 from public.opening_pool_entries pe join public.entries e on e.catalogue_id=pe.catalogue_id and e.id=pe.entry_id where pe.pool_id=${literal(pool.poolId)} and (not e.seed_eligible or not game_private.has_opening(pe.catalogue_id,pe.entry_id))) then raise exception 'unplayable_familiar_seed'; end if;\n`;
}
final += ` update public.catalogues set published=true where id=${literal(id)} and not published;\n update public.opening_pools set published=true where id in (${pools.map((p) => literal(p.poolId)).join(',')}) and not published;\nend $$;\ncommit;\n`;
migration('20261028101000_publish_football_and_opening_pools.sql', final);
const maxMigration = Math.max(
  ...readdirSync(new URL('supabase/migrations/', root))
    .filter((n) => n.startsWith('20261028'))
    .map((n) => Buffer.byteLength(readFileSync(new URL('supabase/migrations/' + n, root), 'utf8'))),
);
console.log(
  JSON.stringify(
    {
      clubs: data.clubs.length,
      people: entityRows.length,
      credits: creditRows.length,
      pools: pools.map((p) => ({ category: p.catalogueId, entries: p.entries.length })),
      dataChunks: chunkIndex,
      maxMigrationBytes: maxMigration,
      relationSignature,
      previewHistory: history.length,
      previewExhausted: Object.entries(state.usage)
        .filter(([, n]) => n === 3)
        .map(([id]) => data.entities[id]!.name),
    },
    null,
    2,
  ),
);

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ConnectionEngine } from '../src/engine.ts';
import type { Dataset, ConnectorType } from '../src/types.ts';

// Deliberately explicit approval list. No research assertion is approved by default.
// Names resolve ONLY inside the stated game's existing canonical credit records.
const reviewed: Record<string, Partial<Record<ConnectorType, string[]>>> = {
  'Abzû': { developer: ['Giant Squid'], composer: ['Austin Wintory'] },
  'Bastion': { developer: ['Supergiant Games'], composer: ['Darren Korb'], voiceActor: ['Logan Cunningham'] },
  'Bloodborne': { developer: ['FromSoftware'], composer: ['Ryan Amon', 'Yuka Kitamura', 'Tsukasa Saitoh', 'Cris Velasco', 'Michael Wandmacher'] },
  'Chrono Trigger': { developer: ['Square'], composer: ['Yasunori Mitsuda', 'Nobuo Uematsu', 'Noriko Matsueda'] },
  'Dark Souls': { developer: ['FromSoftware'], composer: ['Motoi Sakuraba'] },
  "Demon's Souls": { developer: ['FromSoftware'], composer: ['Shunsuke Kida'] },
  'Death Stranding': { developer: ['Kojima Productions'], composer: ['Ludvig Forssell'], voiceActor: ['Troy Baker'] },
  'Dishonored': { developer: ['Arkane Studios'], composer: ['Daniel Licht'], voiceActor: ['Gregg Berger'] },
  'Dragon Age: Origins': { developer: ['BioWare'], composer: ['Inon Zur'] },
  'Elden Ring': { developer: ['FromSoftware'], composer: ['Yuka Kitamura', 'Tsukasa Saitoh', 'Shoi Miyazawa', 'Yoshimi Kudo'] },
  'Fallout 3': { developer: ['Bethesda Game Studios'], composer: ['Inon Zur'] },
  'Fallout 4': { developer: ['Bethesda Game Studios'], composer: ['Inon Zur'], voiceActor: ['Stephen Russell', 'Courtenay Taylor'] },
  'Final Fantasy VII': { developer: ['Square'], composer: ['Nobuo Uematsu'], character: ['Cloud Strife', 'Sephiroth'] },
  'Final Fantasy X': { developer: ['Square'], composer: ['Nobuo Uematsu', 'Masashi Hamauzu', 'Junya Nakano'], voiceActor: ['Gregg Berger', 'Corey Burton'] },
  'God of War': { developer: ['Santa Monica Studio'], composer: ['Bear McCreary'], voiceActor: ['Troy Baker', 'Nolan North', 'Corey Burton'] },
  'Hades': { developer: ['Supergiant Games'], composer: ['Darren Korb'], voiceActor: ['Logan Cunningham', 'Darren Korb'] },
  'Half-Life': { developer: ['Valve Corporation'], composer: ['Kelly Bailey'], character: ['Gordon Freeman', 'G-Man', 'Barney Calhoun'] },
  'Half-Life 2': { developer: ['Valve Corporation'], composer: ['Kelly Bailey'], character: ['Gordon Freeman', 'G-Man', 'Barney Calhoun'] },
  'Journey': { developer: ['thatgamecompany'], composer: ['Austin Wintory'] },
  'Kingdom Hearts': { developer: ['Square'], composer: ['Yoko Shimomura'], voiceActor: ['Corey Burton'], character: ['Sora', 'Cloud Strife', 'Sephiroth'] },
  'Left 4 Dead 2': { developer: ['Valve Corporation'], composer: ['Mike Morasky'] },
  'Mass Effect': { developer: ['BioWare'], composer: ['Jack Wall', 'Sam Hulick', 'Richard Jacques'], voiceActor: ['Jennifer Hale', 'Mark Meer', 'Keith David'], character: ['Commander Shepard', 'Garrus Vakarian', "Tali'Zorah", "Liara T'Soni"] },
  'Mass Effect 2': { developer: ['BioWare'], composer: ['Jack Wall', 'Sam Hulick'], voiceActor: ['Jennifer Hale', 'Mark Meer', 'Courtenay Taylor'], character: ['Commander Shepard', 'Garrus Vakarian', "Tali'Zorah", "Liara T'Soni"] },
  'Metal Gear Solid V: The Phantom Pain': { developer: ['Kojima Productions'], composer: ['Justin Burnett', 'Harry Gregson-Williams', 'Daniel James', 'Ludvig Forssell'], voiceActor: ['Troy Baker', 'Robin Atkin Downes'] },
  'NieR: Automata': { developer: ['PlatinumGames'], composer: ['Keiichi Okabe', 'Keigo Hoashi'] },
  'Portal': { developer: ['Valve Corporation'], composer: ['Kelly Bailey', 'Mike Morasky'], voiceActor: ['Ellen McLain'], character: ['Chell', 'GLaDOS'] },
  'Portal 2': { developer: ['Valve Corporation'], composer: ['Mike Morasky'], voiceActor: ['Ellen McLain', 'Stephen Merchant', 'J. K. Simmons'], character: ['Chell', 'GLaDOS'] },
  'Street Fighter II': { developer: ['Capcom'], composer: ['Yoko Shimomura', 'Isao Abe'], character: ['Ryu', 'Ken Masters'] },
  'Super Mario 64': { developer: ['Nintendo Entertainment Analysis & Development'], composer: ['Koji Kondo'], voiceActor: ['Charles Martinet'], character: ['Mario', 'Princess Peach', 'Bowser'] },
  'Super Smash Bros. Ultimate': { developer: ['Sora Ltd.', 'Bandai Namco Studios'], composer: ['Hideki Sakamoto'], voiceActor: ['Charles Martinet'], character: ['Mario', 'Princess Peach', 'Bowser', 'Cloud Strife', 'Sephiroth', 'Sora', 'Ryu', 'Ken Masters'] },
  'The Elder Scrolls IV: Oblivion': { developer: ['Bethesda Game Studios'], composer: ['Jeremy Soule'], voiceActor: ['Lynda Carter'] },
  'The Elder Scrolls V: Skyrim': { developer: ['Bethesda Game Studios'], composer: ['Jeremy Soule'], voiceActor: ['Charles Martinet', 'Stephen Russell', 'Lynda Carter', 'Robin Atkin Downes'] },
  'The Last of Us': { developer: ['Naughty Dog'], composer: ['Gustavo Santaolalla'], voiceActor: ['Troy Baker', 'Nolan North', 'Robin Atkin Downes'] },
  "Uncharted 4: A Thief's End": { developer: ['Naughty Dog'], composer: ['Henry Jackman'], voiceActor: ['Troy Baker', 'Nolan North', 'Robin Atkin Downes'] },
  'Transistor': { developer: ['Supergiant Games'], composer: ['Darren Korb'] },
};

const root = new URL('../', import.meta.url);
const research: Dataset = JSON.parse(readFileSync(new URL('data/snapshots/50-enriched.json', root), 'utf8'));
const infoboxes = JSON.parse(readFileSync(new URL('data/enrichment/infobox-credit-candidates.json', root), 'utf8')) as { gameId: string; type: string; fieldWikitext: string; source: unknown }[];
const approvals: unknown[] = [];
const games = Object.entries(reviewed).map(([title, roles]) => {
  const source = research.games.find(g => g.title === title);
  if (!source) throw Error(`Unresolved game: ${title}`);
  const credits = Object.fromEntries((['developer', 'composer', 'voiceActor', 'character'] as const).map(role => {
    const records = (roles[role] ?? []).map(name => {
      const matches = source.credits[role].filter(c => research.entities[c.entityId]?.name === name);
      if (!matches.length || new Set(matches.map(c => c.entityId)).size !== 1) throw Error(`Ambiguous credit ${title}: ${role} ${name}`);
      const record = structuredClone(matches[0]!);
      const supportingField = infoboxes.find(c => c.gameId === source.id && c.type === role);
      approvals.push({ gameId: source.id, title, role, entityId: record.entityId, name,
        decision: 'approved_for_published_catalogue', reviewedAt: '2026-10-21', reviewer: 'Codex source-record review',
        scope: 'Eligible recorded credits only; no assertion of exhaustive real-world coverage. Original release developer; selected game credit identities. SSBU includes released DLC fighters.',
        evidence: record, supportingField: supportingField ?? null });
      return record;
    });
    return [role, records];
  }));
  return { ...structuredClone(source), credits } as typeof source;
});
const ids = new Set(games.flatMap(g => Object.values(g.credits).flat().map(c => c.entityId)));
const dataset: Dataset = { schemaVersion: 1, datasetId: 'games-reviewed-2026-10-21-v1',
  policy: 'Only these published eligible credits count. All shared canonical entities in the same role count once each per move. Lists are selective, not exhaustive real-world credits.',
  approvalStatus: 'reviewed_prototype', license: 'Wikidata CC0; Wikipedia-derived additions CC-BY-SA-4.0; see DATA_LICENSE.md',
  entities: Object.fromEntries([...ids].sort().map(id => [id, research.entities[id]!])), games };
const engine = new ConnectionEngine(dataset);
const seedPool = engine.connectedComponents()[0]!.filter(id => engine.availableMoves(engine.createMatch(id)).length > 0);
if (seedPool.length < 2) throw Error('Catalogue has no playable component');
const stringify = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
mkdirSync(new URL('data/playable/', root), { recursive: true });
mkdirSync(new URL('web/public/', root), { recursive: true });
const body = stringify(dataset);
writeFileSync(new URL('data/playable/catalogue-v1.json', root), body);
writeFileSync(new URL('web/public/catalogue-v1.json', root), body);
writeFileSync(new URL('data/playable/approval-manifest.json', root), stringify({ datasetId: dataset.datasetId, approvals }));
const edges = engine.graph();
writeFileSync(new URL('data/playable/import-v1.json', root), stringify({ dataset, edges, seedPool, sha256: createHash('sha256').update(body).digest('hex') }));
writeFileSync(new URL('data/playable/summary.json', root), stringify({ datasetId: dataset.datasetId, games: games.length, eligibleCredits: approvals.length,
  entities: ids.size, edges: edges.length, components: engine.connectedComponents().map(c => c.length), seedPool: seedPool.length,
  engineSha256: createHash('sha256').update(readFileSync(new URL('src/engine.ts', root))).digest('hex') }));
console.log(`${games.length} reviewed games; ${approvals.length} eligible credit records; ${edges.length} edges; ${seedPool.length} starting games.`);

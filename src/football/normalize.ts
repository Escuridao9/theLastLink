import type { CareerEvidence, FootballClub, FootballDataset, FootballRole } from './types.ts';
export interface ObservedClub {
  name: string;
  wikidataId: string;
  aliases: string[];
  country: string;
  region: string;
  familiar: boolean;
  founding?: string | null;
}
export interface ObservedCareer {
  humanConfirmed?: boolean;
  person?: string;
  personLabel?: string;
  club?: string;
  property?: string;
  occupationRoot?: string;
  statement?: string;
  rank?: string;
  start?: string;
  end?: string;
  startPrecision?: string;
  endPrecision?: string;
  role?: string;
  roleLabel?: string;
  appearances?: string;
  reference?: string;
}
export interface FootballObservation {
  source: string;
  license: string;
  collectedAt: string;
  clubs: ObservedClub[];
  rows: ObservedCareer[];
  endpoint?: string;
  sourceUpdatesCompleteUntil?: string | null;
  sourceHashes?: { requestSha256: string; responseSha256: string }[];
}
export interface QuarantinedCareer {
  person: string;
  club: string;
  statement: string;
  reason: string;
}
const qid = (value: string | undefined): string | null =>
  /^Q[1-9]\d*$/.test(value?.split('/').at(-1) ?? '') ? value!.split('/').at(-1)! : null;
const year = (value: string | undefined): number | null => {
  const match = value?.match(/^\+?(\d{4})-/);
  return match ? Number(match[1]) : null;
};
function future(start: string | undefined, precision: string | undefined, date: string): boolean {
  if (!start) return false;
  const clean = start.replace(/^\+/, '');
  const width = Number(precision ?? 9) >= 11 ? 10 : Number(precision ?? 9) >= 10 ? 7 : 4;
  return clean.slice(0, width) > date.slice(0, width);
}
/** Source properties and canonical IDs determine eligibility. Names never create a relationship. */
export function normalizeFootball(observed: FootballObservation, datasetId: string) {
  if (
    observed.source !== 'Wikidata' ||
    observed.license !== 'CC0-1.0' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(observed.collectedAt)
  )
    throw Error('invalid_football_observation');
  const sourceDate = observed.collectedAt.slice(0, 10);
  const clubs: FootballClub[] = observed.clubs.map((c) => {
    if (!/^Q[1-9]\d*$/.test(c.wikidataId) || !c.name.trim() || !c.country || !c.region)
      throw Error('invalid_club_identity');
    const founded = year(c.founding ?? undefined);
    return {
      id: 'wikidata:club:' + c.wikidataId,
      category: 'football',
      title: c.name,
      aliases: [...new Set(c.aliases)].filter((a) => a !== c.name),
      country: c.country,
      region: c.region,
      ...(founded && founded >= 1800 && founded <= Number(sourceDate.slice(0, 4))
        ? { foundedYear: founded }
        : {}),
      externalIds: { wikidata: c.wikidataId },
      credits: { player: [], manager: [] },
      coverage: {
        player: { status: 'not_observed', complete: false },
        manager: { status: 'not_observed', complete: false },
      },
      provenance: {
        source: 'Wikidata',
        sourceUrl: 'https://www.wikidata.org/wiki/' + c.wikidataId,
        importedAt: observed.collectedAt,
      },
    };
  });
  if (new Set(clubs.map((c) => c.id)).size !== clubs.length) throw Error('duplicate_club_identity');
  const byQ = new Map(clubs.map((c) => [c.externalIds.wikidata, c]));
  const dataset: FootballDataset = {
    schemaVersion: 1,
    datasetId,
    category: 'football',
    policyVersion: 'senior-clubs-person-v1',
    sourceDate,
    sourceLicense: 'CC0-1.0',
    eligibleRoles: ['player', 'manager'],
    scope: {
      teams: 'Curated major senior men’s clubs worldwide; no national, youth or reserve teams.',
      players:
        'P54 club membership, football-player occupation and a positive recorded appearance total. Zero and unknown appearance totals are not published.',
      managers:
        'P286 head-manager appointments with football-coach occupation. Caretaker managers qualify; directors and broader unspecified coaching roles do not.',
      crossRolePeople: true,
    },
    clubs,
    entities: {},
  };
  const quarantine = new Map<string, QuarantinedCareer>();
  const credits = new Map<string, Map<string, CareerEvidence>>();
  const acceptedClaims = new Set<string>();
  for (const row of observed.rows) {
    const personQ = qid(row.person),
      clubQ = qid(row.club),
      club = byQ.get(clubQ ?? '');
    const statement = row.statement?.split('/').at(-1) ?? '';
    const reject = (reason: string) => {
      quarantine.set(statement + '|' + reason, {
        person: personQ ?? row.person ?? '',
        club: clubQ ?? row.club ?? '',
        statement,
        reason,
      });
    };
    if (!personQ || !club || !/^Q[1-9]\d*-[0-9a-f-]+$/i.test(statement)) {
      reject('invalid_or_out_of_scope_identity');
      continue;
    }
    if (row.humanConfirmed !== true) {
      reject('unverified_human_identity');
      continue;
    }
    if (!row.personLabel?.trim() || /^Q\d+$/.test(row.personLabel)) {
      reject('missing_person_label');
      continue;
    }
    if (row.rank?.endsWith('DeprecatedRank') || row.rank === 'deprecated') {
      reject('deprecated_claim');
      continue;
    }
    if ((row.start && year(row.start) === null) || (row.end && year(row.end) === null)) {
      reject('invalid_career_date');
      continue;
    }
    if (future(row.start, row.startPrecision, sourceDate)) {
      reject('future_appointment');
      continue;
    }
    if (row.start && row.end && year(row.start)! > year(row.end)!) {
      reject('conflicting_career_dates');
      continue;
    }
    const roleQ = qid(row.role);
    const role: FootballRole = row.property === 'P54' ? 'player' : 'manager';
    if (role === 'player') {
      if (row.occupationRoot !== 'Q937857') {
        reject('unverified_football_player_role');
        continue;
      }
      if (row.appearances === undefined) {
        reject('unknown_senior_appearances');
        continue;
      }
      if (!/^\+?\d+(?:\.0+)?$/.test(row.appearances) || Number(row.appearances) <= 0) {
        reject('zero_or_invalid_appearances');
        continue;
      }
      if (roleQ && !['Q584540', 'Q15991269'].includes(roleQ)) {
        reject('unsupported_player_role_qualifier');
        continue;
      }
    } else {
      if (row.property !== 'P286' || row.occupationRoot !== 'Q628099') {
        reject('unverified_head_manager_role');
        continue;
      }
      if (roleQ && roleQ !== 'Q1050607') {
        reject('unsupported_manager_role_qualifier');
        continue;
      }
    }
    const entityId = 'wikidata:' + personQ;
    dataset.entities[entityId] ??= {
      id: entityId,
      name: row.personLabel.trim(),
      sourceUrl: 'https://www.wikidata.org/wiki/' + personQ,
      externalIds: { wikidata: personQ },
    };
    const key = club.id + '|' + role + '|' + entityId;
    let sources = credits.get(key);
    if (!sources) {
      sources = new Map();
      credits.set(key, sources);
    }
    const time = (value: string, precision: string | undefined) =>
      value
        .replace(/^\+/, '')
        .slice(0, Number(precision ?? 9) >= 11 ? 10 : Number(precision ?? 9) >= 10 ? 7 : 4);
    const evidence: CareerEvidence = sources.get(statement) ?? {
      statementId: statement,
      property: row.property as CareerEvidence['property'],
      rank: row.rank?.endsWith('PreferredRank') ? 'preferred' : 'normal',
      references: [],
      ...(row.start ? { start: time(row.start, row.startPrecision) } : {}),
      ...(row.end ? { end: time(row.end, row.endPrecision) } : {}),
      ...(row.startPrecision ? { startPrecision: Number(row.startPrecision) } : {}),
      ...(row.endPrecision ? { endPrecision: Number(row.endPrecision) } : {}),
      ...(role === 'player' ? { appearances: Number(row.appearances) } : {}),
    };
    const reference = row.reference?.replace(/^https?:\/\/www\.wikidata\.org\/reference\//, '');
    if (reference && !evidence.references.includes(reference)) evidence.references.push(reference);
    sources.set(statement, evidence);
    acceptedClaims.add(statement);
  }
  for (const [key, sources] of credits) {
    const [clubId, role, entityId] = key.split('|') as [string, FootballRole, string];
    const club = clubs.find((c) => c.id === clubId)!;
    const sourceCredits = [...sources.values()].sort((a, b) =>
      a.statementId.localeCompare(b.statementId),
    );
    for (const source of sourceCredits) source.references.sort();
    club.credits[role].push({ entityId, sourceCredits });
    club.coverage[role].status = 'observed';
  }
  for (const club of clubs)
    for (const role of ['player', 'manager'] as const)
      club.credits[role].sort((a, b) => a.entityId.localeCompare(b.entityId));
  dataset.entities = Object.fromEntries(
    Object.entries(dataset.entities).sort(([a], [b]) => a.localeCompare(b)),
  );
  // A claim can have multiple qualifier/reference rows. One qualifying past spell is
  // sufficient evidence of membership; do not also count its other rows as excluded claims.
  const quarantined = [...quarantine.values()]
    .filter((q) => !acceptedClaims.has(q.statement))
    .sort((a, b) => a.statement.localeCompare(b.statement) || a.reason.localeCompare(b.reason));
  const reasons: Record<string, number> = {};
  for (const q of quarantined) reasons[q.reason] = (reasons[q.reason] ?? 0) + 1;
  return {
    dataset,
    quarantine: quarantined,
    audit: {
      observedRows: observed.rows.length,
      distinctObservedClaims: new Set(observed.rows.map((r) => r.statement)).size,
      acceptedClaims: acceptedClaims.size,
      people: Object.keys(dataset.entities).length,
      playerCredits: clubs.reduce((n, c) => n + c.credits.player.length, 0),
      managerCredits: clubs.reduce((n, c) => n + c.credits.manager.length, 0),
      quarantinedClaims: new Set(quarantined.map((q) => q.statement)).size,
      reasons,
      independentHistoricalVerification: false,
      complete: false,
    },
  };
}

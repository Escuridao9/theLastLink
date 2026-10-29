import type {
  CareerEvidence,
  FootballClub,
  FootballDataset,
  FootballRole,
} from '../src/football/types.ts';

/** The browser and PostgreSQL publication share the same compact Football view. */
export function footballPresentation(data: FootballDataset) {
  const games = data.clubs.map((club: FootballClub, index: number) => ({
    id: club.id,
    category: 'football' as const,
    title: club.title,
    aliases: club.aliases,
    countries: [club.country],
    region: club.region,
    ...(club.foundedYear ? { foundedYear: club.foundedYear } : {}),
    externalIds: club.externalIds,
    detailShard: index,
    credits: { player: [], manager: [] },
  }));
  const snapshot = {
    datasetId: data.datasetId,
    category: 'football',
    sourceDate: data.sourceDate,
    games,
    entities: {},
  };
  const uiEvidence = (evidence: CareerEvidence, role: FootballRole, person: string) => ({
    property: evidence.property,
    statementId: evidence.statementId,
    sourceUrl: data.entities[person]!.sourceUrl,
    job: `${role === 'player' ? 'Senior player' : 'Head manager'} · ${evidence.start?.slice(0, 4) ?? '?'}–${evidence.end?.slice(0, 4) ?? '?'}`,
  });
  return { games, snapshot, uiEvidence };
}

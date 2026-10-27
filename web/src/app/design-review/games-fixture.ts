// Review-only history replayed through the preserved Games engine.
export const GAMES_REVIEW = {
  state: {
    datasetId: 'games-reviewed-2026-10-21-v1',
    category: 'games',
    currentGameId: 'wikidata:Q717600',
    history: [
      'wikidata:Q761815',
      'wikidata:Q214232',
      'wikidata:Q223381',
      'wikidata:Q18345138',
      'wikidata:Q24666782',
      'wikidata:Q717600',
    ],
    usage: {
      'wikidata:Q312327': 2,
      'wikidata:Q739552': 2,
      'wikidata:Q965261': 1,
      'wikidata:Q1147551': 2,
      'wikidata:Q59780390': 1,
    },
    version: 5,
  },
  turns: [
    {
      index: 0,
      playerId: null,
      entryId: 'wikidata:Q761815',
      connectors: [],
      acceptedAt: '2026-10-22T12:00:00Z',
    },
    {
      index: 1,
      playerId: 'preview-alex',
      entryId: 'wikidata:Q214232',
      connectors: [
        {
          entityId: 'wikidata:Q312327',
          types: ['composer'],
          name: 'Nobuo Uematsu',
        },
        {
          entityId: 'wikidata:Q739552',
          types: ['developer'],
          name: 'Square',
        },
      ],
      acceptedAt: '2026-10-22T12:00:09.000Z',
    },
    {
      index: 2,
      playerId: 'preview-diogo',
      entryId: 'wikidata:Q223381',
      connectors: [
        {
          entityId: 'wikidata:Q312327',
          types: ['composer'],
          name: 'Nobuo Uematsu',
        },
        {
          entityId: 'wikidata:Q739552',
          types: ['developer'],
          name: 'Square',
        },
      ],
      acceptedAt: '2026-10-22T12:00:18.000Z',
    },
    {
      index: 3,
      playerId: 'preview-alex',
      entryId: 'wikidata:Q18345138',
      connectors: [
        {
          entityId: 'wikidata:Q965261',
          types: ['voiceActor'],
          name: 'Corey Burton',
        },
      ],
      acceptedAt: '2026-10-22T12:00:27.000Z',
    },
    {
      index: 4,
      playerId: 'preview-diogo',
      entryId: 'wikidata:Q24666782',
      connectors: [
        {
          entityId: 'wikidata:Q1147551',
          types: ['voiceActor'],
          name: 'Troy Baker',
        },
      ],
      acceptedAt: '2026-10-22T12:00:36.000Z',
    },
    {
      index: 5,
      playerId: 'preview-alex',
      entryId: 'wikidata:Q717600',
      connectors: [
        {
          entityId: 'wikidata:Q1147551',
          types: ['voiceActor'],
          name: 'Troy Baker',
        },
        {
          entityId: 'wikidata:Q59780390',
          types: ['composer'],
          name: 'Ludvig Forssell',
        },
      ],
      acceptedAt: '2026-10-22T12:00:45.000Z',
    },
  ],
};

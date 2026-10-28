# Football data audit — 28 October 2026

## Published scope

This bounded collection publishes 90 curated major senior men's clubs across six geographic regions: Europe 44, South America 15, North America 7, Africa 9, Asia 12 and Oceania 3. Regions describe geography rather than confederation membership. National, youth and reserve teams are excluded. The selection is editorial and does not claim an objective worldwide ranking.

Dataset: `football-clubs-2026-10-28-v1`.

| Measure | Count |
| --- | ---: |
| Clubs | 90 |
| Canonical people | 22,974 |
| Player–club credits | 30,467 |
| Head-manager–club credits | 819 |
| Accepted career statements | 34,039 |
| Observed response rows | 60,605 |
| Distinct observed statements | 59,777 |
| Quarantined statements | 25,738 |
| Structural connected components | 1 |
| Largest component | 90 clubs |
| Isolated clubs | 0 |
| Mean distinct connected clubs | 48.27 |
| Familiar starter clubs | 27 |

Structural measurements ignore match history and connector exhaustion. They establish the graph's reachability, not match length, difficulty or human performance under a 20-second timer. Every shipped Football preview transition is separately replayed under the actual connector limit and no-repeat rules.

## Sources and provenance

The source is [Wikidata structured data](https://www.wikidata.org/wiki/Wikidata:Licensing), licensed CC0. The main public Query Service was rate limited; collection switched to the [QLever Wikidata endpoint documented by Wikidata](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/Alternative_endpoints). The endpoint reported updates complete through `2026-10-28T10:28:26Z`. This is the source freshness signal, not an assertion that career histories are complete as of that instant.

Canonical club IDs resolve through Wikidata identities and verified article mappings, with explicit disambiguation for Corinthians, LDU Quito and Al Nassr. Canonical human IDs are confirmed as human entities. Matching names do not merge people. Club identity, source statement GUIDs, available date precision, source ranks and reference hashes are retained. Reference hashes resolve under `https://www.wikidata.org/reference/`; person and club source links resolve under `https://www.wikidata.org/wiki/`.

The frozen `catalogue.json`, `manifest.json` and `quarantine.jsonl` are under `data/football/published/football-clubs-2026-10-28-v1/`. The manifest includes source-response hashes and per-club coverage. Raw resumable observations stay in ignored `.cache/football/` and are not required to build or play. SQL and public detail shards are derived from the frozen catalogue.

## Eligibility and uncertainty

Players require [P54, member of sports team](https://www.wikidata.org/wiki/Property:P54), football-player occupation evidence and a positive recorded P1350 appearance total. This conservative condition excludes contracts or membership claims without evidence of an appearance; it also omits real players whose appearances are absent from the source. Youth/reserve identities and unsupported role qualifiers do not qualify. Amateur senior playing careers can qualify; current and historical senior spells are included, and loans with positive appearances qualify.

Managers require [P286, head coach](https://www.wikidata.org/wiki/Property:P286), attached to the selected club, plus association-football-coach occupation evidence. Caretaker appointments qualify. The broader P6087 coach property is not treated as proof of head-manager status. Assistant coaches, directors and unspecified staff jobs do not qualify. This leaves significant historical manager gaps; a missing observed manager credit does not mean the club had none.

Deprecated statements, unresolved identities, unconfirmed humans, missing person labels, future appointments, malformed dates and conflicting career years are not published. Missing dates remain unknown. Year/month/date precision is preserved rather than inventing exact dates. Multiple source rows and separate spells are deduplicated into one person–club–role relationship while retaining the accepted statement evidence.

| Quarantine reason | Statements |
| --- | ---: |
| Unknown senior appearance total | 21,329 |
| Zero or invalid appearance total | 3,987 |
| Missing person label | 349 |
| Invalid career date | 52 |
| Unverified human identity | 13 |
| Conflicting career years | 9 |
| Future appointment | 1 |

A source-backed statement is not an independent historical verification. The catalogue explicitly records `complete: false` and `independentHistoricalVerification: false`. Coverage is particularly sparse for several non-European clubs and historical managers. A single legal neighbor does not imply a balanced or beginner-friendly start; each familiar starter is checked for playable neighbors, not promised a difficulty level.

## Effect of missing data

Missing careers can reject a real connection. Because every shared eligible person must be consumed and any exhausted person blocks a move, a missing shared person can also cause a false acceptance or under-count usage. A correct rules engine cannot repair missing source evidence. The public catalogue and attribution page disclose this limitation. A broadly competitive release needs a curated correction process, versioned updates and deeper verification of club career coverage. Corrections must not mutate running matches or old catalogue versions.

## Familiar pools

`data/openers/football-familiar-v1.json` contains 27 recognizable clubs, with Portuguese and worldwide representation. `movies-familiar-v1.json` contains 55 recognizable existing published films across decades and genres. Neither is a live popularity chart, nor an expansion of the Movies catalogue. Every member has an exact canonical ID, a matching published title and at least one legal opening move.

The server randomly chooses a seed from the host's saved pool and chooses the first player independently. Later moves may use any entry in the match's pinned category catalogue. This does not change the timer, exhausted-connector checks, no-repeat rule, or permission model.

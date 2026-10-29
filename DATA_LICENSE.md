# Data provenance, attribution and reuse

Application source is covered by the MIT licence in `LICENSE`.

## Wikidata statements

The original 50-game raw snapshot, new Wikidata game statements and retained Wikidata JSON responses are made available under [Wikidata's CC0 data terms](https://www.wikidata.org/wiki/Wikidata:Data_access#Using_Wikidata's_data). Source URLs, exact statement IDs, revisions, retrieval metadata and available qualifiers/reference snaks are retained. CC0 does not certify factual correctness or completeness. No game artwork or soundtrack audio is included.

## Wikipedia-derived enrichment

The accepted Wikipedia-derived credit additions and supporting field/excerpt adaptations are attributed to **English Wikipedia contributors**, and are made available under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/), consistent with [Wikimedia's reuse terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content). This is a conservative licensing treatment of the adapted material; no claim is made that all underlying individual facts are copyrightable.

Every Wikipedia source record includes its page title, pinned revision URL, history URL, attribution and license. The change consists of extracting, normalizing, selecting and identity-matching credit assertions; article prose has not been copied wholesale. Reuse the enrichment with its attribution, source links and share-alike terms. The combined enriched catalogue retains CC0 provenance for Wikidata statements and CC-BY-SA-4.0 provenance for Wikipedia adaptations; do not label the entire enriched export CC0.

Primary-source corroboration records link to the publisher, developer or composer's own page. They contain factual observations and original paraphrases rather than full articles, images or audio. These sources verify individual credits only. Their websites' other content is not relicensed by this package.

## Providers not imported

No authenticated IGDB, RAWG, MobyGames, MusicBrainz or VNDB catalogue responses are included. Free API access is not blanket permission to redistribute a provider database. RAWG's published terms restrict redistribution and require backlinks in projects using its data; this study did not import RAWG records. Optional credential probes save diagnostics only.

## Limitations and generated results

Credits marked `source_asserted` are confirmed against retrieved source assertions, not necessarily complete or independently corroborated. `primary_source_verified_credit` applies to the named individual credit, not the entire game's credits. All game/type completeness flags remain false. Unresolved and unapproved candidates remain separate from playable assertions.

Fixtures in `test/fixtures.ts` are synthetic and never enter real catalogue snapshots. Simulation outputs are generated over the frozen incomplete datasets and are not observed human match records. Experimental rule counterfactuals are not application rules.

## Movies — TMDB archive and future owner-run API imports

The movie source is **TMDB 5000 Movie Dataset**, Kaggle `tmdb/tmdb-movie-metadata`, **version 2**, updated **2017-09-28**. Source metadata is retained in `research/tmdb-kaggle-metadata.json`; its license field is **Other (specified in description)** and its description invokes TMDB's terms. Do not label it CC0, Apache or MIT based on a third-party tutorial's code license. The removed earlier IMDb version is not used.

This product uses the TMDB API but is not endorsed or certified by TMDB.

TMDB's official FAQ states free noncommercial use with attribution; commercial data/API use requires the relevant agreement. Its attribution notice and unmodified provider logo appear at `/credits`. Read https://developer.themoviedb.org/docs/faq and https://www.themoviedb.org/api-terms-of-use for the applicable terms before a different use. No posters, stills, audio or film footage are included.

The source archive, source metadata and normalized publication retain original cast/crew information, source/version IDs, per-film payload hashes and explicit coverage limitations. The normalized publication and generated SQL are transformations of those source assertions, not a new unrestricted data licence or a claim of complete, independently verified screen credits. A full retrieved cast/crew array does not prove real-world completeness. Missing roles remain unknown, not confirmed absent.

The optional TMDB client utility supports explicit, locally configured requests with cache/backoff; the deployed website and normal builds do not invoke it. Fixtures in the Movies tests are synthetic and never enter the published catalogue. See [source metadata](research/tmdb-kaggle-metadata.json), [setup](docs/SETUP.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Football

The published Football catalogue uses Wikidata structured data under CC0, collected through Wikidata and its QLever endpoint on 28 October 2026. Canonical identities, career statement evidence, available dates and reference hashes remain in the frozen publication. Ambiguous claims remain quarantined. Coverage is incomplete, especially for managers; see the [Football audit](docs/FOOTBALL_DATA_REPORT.md). Source collection and publication are deliberate maintenance, not automatic player requests.

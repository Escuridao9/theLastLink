# UI and multiplayer

The interface uses the charcoal, coral, and lilac visual language across Home,
category selection, catalogues, room setup, lobby, match, results, and credits.
Music is visibly unavailable. Games and Movies have separate catalogues and rooms.

## Routes

Angular uses hash routing. On GitHub Pages, routes follow the repository base
path, for example `/theLastLink/#/play`. Direct links and refreshes do not require
GitHub Pages to resolve a server route.

| Hash route | Screen |
| --- | --- |
| `#/` | Homepage |
| `#/play` | Category selection |
| `#/catalogue?category=movies` | Movies catalogue |
| `#/catalogue?category=games` | Games catalogue |
| `#/rooms?category=games` | Create or join a Games room |
| `#/rooms/:id` | Multiplayer lobby |
| `#/match/:id` | Active match |
| `#/results/:id` | Match result and recap |
| `#/credits` | Data and asset attribution |
| `#/design-review` | Explicitly labeled local visual preview |

The category URL `#/play/games` redirects to `#/rooms?category=games`.

## Live route behavior

Normal routes use `BackendService`, `MatchService`, and `CatalogueService`.
Supabase Auth establishes a player session. Commands go to the authenticated
`match-api` function and are authorized and applied by PostgreSQL. Realtime
notifications trigger authorized snapshot refreshes; snapshots also refresh
periodically and after the browser comes back online or becomes visible.

The server supplies the room code and match ID. Both players must join before
the host can start. The active player answers through title autocomplete. The
client displays the server deadline with a clock offset; PostgreSQL decides
whether an answer arrived in time and who won. The expiry worker also runs
independently of the browser.

Invalid answers preserve the current turn and deadline. Accepted answers consume
every shared eligible canonical connector, once per entity, from the shared
three-use allowance. Any exhausted shared connector blocks the whole move.
Played titles cannot repeat. Legal traps are accepted and give the opponent the
full 20-second turn. A timeout ends the single-round Sudden Death match.

The match view resets its autocomplete when the turn changes and retains a
receipt ID for safely retrying a lost answer response. Results display the
server's winner, end reason, history, and connector counters.

## Local visual preview

Run `npm --prefix web start` from the repository root and open the address Angular
prints. Append `/#/design-review` to explore the same components with labeled
local example players, matches, results, and error/loading/empty states.

The preview providers are scoped to the `design-review` route. They use local
catalogue assets and scripted example state; they do not sign in, invoke an
Edge Function, or create a Supabase Realtime channel. The preview toolbar offers
the Home → Category → Room → Lobby → Match → Result journey, Games and Movies,
and victory/defeat states. A paused example timer is explicitly labeled.

Preview answer receipts are generated through the same connection engines and
are checked against the published catalogues by `test/visual-review.test.ts`.
The preview is for presentation and interaction review, not live multiplayer
verification. Unit-test doubles exist only in spec files.

## Two-player verification

Use two different browsers, or one regular and one private window, so the players
have independent Supabase sessions. Two private windows in one browser can share
the same session.

1. Open normal routes in both browsers with your public Supabase configuration.
2. Choose Games, enter a player name, and create a room in the first browser.
3. Join that room using its code or invite link and a different name in the second.
4. Confirm both names appear in both lobbies and that only the host can start.
5. Start and confirm both clients display the same title and active player.
6. Let a turn expire. Both clients must show the same winner and timeout result.
7. Start a new room to check a valid answer, an invalid answer, a repeated title,
   and connector usage. Invalid answers must not reset the deadline or counters.
8. Refresh during an active match. Restore the same identity and match state.
9. Check reconnection after a brief offline period. The server deadline continues.
10. Repeat room creation, joining, starting, and timeout results for Movies.
11. Check catalogue search, credit roles, keyboard selection, and mobile layouts.
12. Refresh direct catalogue, lobby, match, and results hash URLs on GitHub Pages.

Automated tests and local previews do not certify hosted Auth, Realtime delivery,
simultaneous database connections, or real human performance under the timer.
Record those live verification results separately.

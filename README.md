# zjmj — Zung Jung Mahjong

A web app for playing the Zung Jung (中庸) variation of Mahjong online. Four players
to a room, Tenhou-inspired minimalist interface. ~~Version 0.0.~~ Now moving towards Version 0.1

## Structure

- `shared/` — rules engine used by both server and client: tiles, wall building
  (dice, breakpoint, dealing), hand decomposition and win detection, the full
  44-pattern Zung Jung scoring table with Freedom of Count and limit handling,
  the Formal Competition payoff scheme with same-round immunity, the match
  record format (`.txt` serialization + replay), and the client/server protocol
  types. Heavily unit-tested.
- `server/` — Node.js + TypeScript authoritative game server: WebSocket
  real-time play (lobby, rooms, claims with interception priority and timers,
  dummy bots), SQLite persistence (built-in `node:sqlite`, no native deps), and
  a REST API for statistics and the records archive.
- `client/` — TypeScript + Vite web client (no framework): home page, lobby
  with room settings sliders, the 2D game board (colored seat quadrants, dice
  animation, windmill discard areas, claim keywords, timers), statistics page,
  and the records archive with a play-by-play replay viewer.
- `client/public/tiles/` — tile face SVGs.

## Requirements

Node.js **22.5+** (uses the built-in `node:sqlite`; developed on Node 25).

## Development

```sh
npm install
npm test               # rules engine + server match simulation tests

# terminal 1 — game server on :8787
npm run dev:server

# terminal 2 — vite dev server on :5173 (proxies /api and /ws to :8787)
npm run dev:client
```

Open http://localhost:5173. Multiple browser profiles/windows = multiple players
(guest identity is stored in localStorage per profile).

## Production

```sh
npm run build          # typechecks + bundles server and client
npm start              # serves the built client and the API/WS on $PORT (default 8787)
```

Deploy anywhere that runs Node with WebSocket support (Azure App Service with
"Web sockets" enabled, Railway, Render, Fly.io, or a VM). Set `PORT` as needed
and point the `zjmj.app` DNS at it; TLS comes from the platform. `ZJMJ_DB`
overrides the SQLite file path (default `server/zjmj.db`). Set
`PLAYFAB_TITLE_ID` and `PLAYFAB_SECRET_KEY` (see `.env.example`; locally they
load from the repo-root `.env`).

## Accounts (v0.1)

- PlayFab is the account system; **all PlayFab calls go through the game
  server** (the client never talks to PlayFab). Guests get a PlayFab player
  via `Server/LoginWithServerCustomId` on their device id; accounts are
  username+password (`Client/RegisterPlayFabUser`, no email yet).
- The server issues its own opaque session tokens (SQLite `sessions` table,
  sent in the WebSocket hello), so PlayFab's 24h ticket expiry never surfaces.
  Signing in revokes the account's other sessions: one device at a time.
- Creating an account migrates the guest's stats/records (SQLite re-key) and
  settings (PlayFab user data copy) to the new account.
- PlayFab has no email-less password mutation, so **change password =
  verify old password → snapshot settings → `Admin/DeleteMasterPlayerAccount`
  → re-register the same username** (frees in ~3s) → restore data under the
  new PlayFabId. Plain `DeletePlayer` would keep the username reserved.
- PlayFab usernames are 3–20 chars, strictly alphanumeric. Client player
  creation is disabled on the title; keep it that way.
- Player settings (tile indices, default room sliders) live in PlayFab user
  data under the `settings` key, cached in localStorage.

## Notes / current scope
- Room #0 is always open and locked to default settings (4 rounds, 15s
  thinking time, chicken hand scores 1, par 25); up to 4 user-created rooms.
- Missing players are filled by dummy bots that always discard the drawn tile
  and never claim. If a human leaves mid-match a bot takes over their seat;
  a match abandoned by all humans is discarded (not archived).
- Matches finished by at least one human are archived; play-by-play replay and
  spec-format `.txt` download are available on the Records page.

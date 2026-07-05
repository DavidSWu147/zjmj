# zjmj — Zung Jung Mahjong

A web app for playing the Zung Jung (中庸) variation of Mahjong online. Four players
to a room, Tenhou-inspired minimalist interface. Version 0.0.

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
overrides the SQLite file path (default `server/zjmj.db`).

## Notes / current scope (v0.0)

- Guest-only identity (localStorage). PlayFab/accounts come later; stats and
  records are keyed to the per-browser guest id.
- Room #0 is always open and locked to default settings (4 rounds, 15s
  thinking time, chicken hand scores 1, par 25); up to 4 user-created rooms.
- Missing players are filled by dummy bots that always discard the drawn tile
  and never claim. If a human leaves mid-match a bot takes over their seat;
  a match abandoned by all humans is discarded (not archived).
- Matches finished by at least one human are archived; play-by-play replay and
  spec-format `.txt` download are available on the Records page.

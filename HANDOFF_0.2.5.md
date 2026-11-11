# Handoff: zjmj after v0.2.4, for whoever builds v0.2.5

Written 2026-11-11. Covers everything done between commit `c5776f9` (end of
v0.2.3) and `961124c`. The spec for 0.2.4 is `pending_updates_0.2.4.txt`;
this file records what was actually built, what David changed his mind
about, and what is still open.

## State of the repo

- Branch `main`, version `0.2.4` in the root, client and server `package.json`.
- `origin/main` is at `ab57da3` and that is what zjmj.app runs.
- **One local commit is not pushed: `961124c`** (contested-claim text
  timing, server-side). It has not been tried in a live game. David pushes
  himself; never push for him.
- Deploy: `.github/workflows/main_zjmj.yml` builds and deploys to Azure on
  every push to `main` (about 4 minutes). Other branches do not deploy,
  unless someone runs the workflow manually on them.
- `client/dist` is gitignored. `npm run dev:server` (:8787) serves that
  prebuilt folder, so rebuild the client after changes or :8787 shows old
  code and an old version number. Vite dev (:5173) is always live source.

## What v0.2.4 contains

Numbers refer to `pending_updates_0.2.4.txt`.

1. **Highest scoring hand on Statistics.** Hands are not stored. `computeStats`
   (`server/src/api.ts`) finds the best win under the active filters (ties:
   later match, then later game) and replays only that game with `replayGame`
   (`shared/src/records.ts`). Returns `bestHand`, or null if the record
   cannot be replayed. `bestHand.winBy` is the literal win type.
2. **Playstyle tile and best hand** take no part in the same-tile hover glow
   (`installTileHighlight` exclusion list in `client/src/tileui.ts`).
3. **All bot claims are shown**, voice and text. `deferClaimResolution` makes
   the bot batch register every claim before anything resolves.
   Text timing rule (David's, final): a losing claim's text always leaves
   before the winning one. A loser already visible 0.9 s goes at resolution;
   one outranked at once lingers for the remainder. A contested winning
   pung/chow stays 0.5 s longer; mahjong and kong keep 1.6 s. See
   `LOSING_CLAIM_MIN_VISIBLE_MS` in `server/src/game.ts`. This is the
   unpushed commit.
4. **Melds called on a drawn-and-discarded tile are faded**, on the live
   board and in hand review. Not on the scoring screen or the stats hand.
5. **Records list** has Scoring and Flowers columns (0/1/2).
6. **Rejoin.** A player who leaves with X shows "(away)" and gets a Rejoin
   button in the lobby. One clearable `leftIds` set in `server/src/match.ts`;
   a player seated again at match end is not an abandoner. The rule for
   aborting an abandoned match is unchanged.
7. **Hide/show the scoring and match-over panels.** Button in the panel's
   bottom-right corner beside the countdown; icon is a wide rectangle with a
   slash from top right to bottom left. `resultFoot()` in
   `client/src/views/game.ts`, `.overlay.panel-hidden` in `style.css`.
8. **Auto Mode toggles no longer snap a discard in flight.**
9. **Auto Mode grey yields to the player's own 26+ celebration**, and
   player-set Auto Mode switches off when the scoring screen appears.
10. **Extra thinking time.** Click the central circle on any timed move. All
    four seats must agree; bot-held seats agree at once. Each grant resets
    the clock to 600 s plus that phase's normal time; at most 3 per move.
    Server: `handleTimeRequest`, `sweepTimeAgreement`, `extendDeadline` in
    `server/src/game.ts`. View field `timeRequest`.
11. **Walls-off layout** always reserves room for a small kong's pocket.
12. **Own username** above the player's hand, on the board's centre line,
    14–18 px. Sits above the hotkey caps when hotkeys are on. Hidden if a
    small kong's pocket overlaps it.
13. **Auto button is disabled on the scoring screen.**

Also changed after release:
- Bonus tiles are never faded beside a winning hand (scoring screen, stats,
  hand review).
- Hand review labels read "SELF-DRAW 自摸 · n pts" / "MAHJONG 和 · n pts" and
  "DISCARDER 放銃". The scoring screen and stats caption keep mixed case.
- In hand review only, a winning tile taken off a drawn-and-discarded tile is
  faded (`ReplayStep.claimedWin`).

## Things David tried and rejected. Do not bring them back unasked.

- The 👁 emoji fade button and the ghosted, see-through panel. He wanted a
  real hide, and a different icon and position (item 7 above).
- A winning tile turned sideways for wins on a discard. Rejected on all three
  screens; the win-type text is what tells the two apart.
- The username hanging under the wall or discards, and the username centred
  over the hand strip. It must share the top opponent's vertical line.

## Open items

- **Push and check `961124c`.** Play against ChickenBots: pung while a bot
  wants to chow, and win by mahjong when a bot also calls mahjong. The losing
  text should go first. There is no automated test for this ordering.
- **Own bonus tiles can overlap the left wall.** Only when the player's
  second row of bonus tiles fills up in a near-square window: 8 tiles at 4:3
  or 5:4, 7 at about 1.13, 6 at square. Never at 16:10 or wider. Opponents'
  bonus tiles never collide. David said to leave it for now. Reproduce with
  `client/repro/layout012.html?s=bonuswalls&b=8,0,0,0`.
- **Hand review still fades melds** called on a drawn-and-discarded tile.
  David once said that fade belongs to the game screen only, but also asked
  for the faded winning tile in hand review. Ask before changing either.
- **Known and accepted:** a player can leave most of a match, rejoin before
  the end, and keep tournament Rank Points. Same exposure as a disconnect.
- **Countdown on re-render.** The scoring-screen countdown is rebuilt from the
  last server timestamp, so any client-only re-render there makes it jump
  back up. Item 13 removed the one known trigger; settings changes made
  during the scoring screen could still do it.
- `pending_updates_0.2.4.txt` item 7 still describes the original fade
  wording. No `pending_updates_0.2.5.txt` exists yet.

## How to verify changes

- `npm test` at the root: shared (60 tests) and server (63). The greedy-match
  tests take about 47 s each; give new ones a 90 s timeout.
- Typecheck: `npx tsc -p tsconfig.json --noEmit` in `client/` and `server/`.
- Layout: `npx vite --port 5199` in `client/`, then
  `repro/layout012.html?s=<scenario>` driven by playwright (a client
  devDependency). Scenarios set `window.reproDone`. Measure DOM rectangles;
  do not judge by eye alone. Added this version: `ownkong`, `result`,
  `bonuswalls` (`b=` bonus per seat, `m=none|kongs|small`, `lp=`). Seed
  settings through localStorage key `zjmj-settings` before load, for example
  `{"physicalWalls":false}`.
- Live app: `PORT=8899 ZJMJ_DB=<scratch file> npx tsx src/index.ts` in
  `server/` after building the client. Never point it at the real database.
  A "1 round" match is four games, about 11 minutes on autoplay. To get a
  finished match quickly, play one in-process with fast timings and save it
  with `Db.saveMatch`; every seat must be connected at the end or the player
  is recorded as having abandoned and the match is hidden from Records.
- New required fields on `GameView` must be added by hand to the view
  literals in `client/repro/*.ts`, which are not typechecked.

## Traps met this version

- A server change that alters the deadline or anything in the view must
  broadcast (`host.onChange()`). A silent time-extension grant once left
  every client's clock running down against a deadline that no longer
  existed.
- Setting `card.innerHTML` wipes children appended earlier. Append buttons
  after it.
- An element that stays visible when its panel hides must not change size, or
  the centred card shifts and the button moves. The hidden-state pill is
  drawn with box-shadows for that reason.
- TypeScript narrows a `let` assigned only inside a `forEach` callback to
  `never` afterwards. Keep such values in an object property.
- In the bot claim batch and the robbing batch, resolving in the middle of
  the loop drops the remaining bots.

## Working with David

- He reviews by playing and looking, and judges visual details closely.
  Expect several small rounds on anything visible. Show a screenshot or exact
  measurements when you can.
- When a spec line can be read two ways, ask. He answers quickly and
  precisely.
- Commit locally in small commits with plain messages. He pushes.
- He does not want features re-added after he has removed them, or extras he
  did not ask for. Flag any unrequested choice in your summary.

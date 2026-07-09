/**
 * Deterministic repro for the "discard flight lags one meld behind" report.
 * Renders the real game view twice: pre-claim (opposite opponent: 1 meld,
 * 10 tiles) and post-resolution (2 melds, 7 tiles, +1 discard), then reports
 * where the discard flight actually starts vs the current hand center.
 */
import '../src/style.css';
import { GameView, MeldView } from '../../shared/src/protocol';
import { renderGame } from '../src/views/game';

const app = document.getElementById('app')!;
const out = document.getElementById('out')!;

const chow: MeldView = { kind: 'chow', tiles: ['B1', 'B2', 'B3'], rotated: 0, faceDown: [] };
const pung: MeldView = { kind: 'pung', tiles: ['C5', 'C5', 'C5'], rotated: 2, faceDown: [] };

function seat(handCount: number, melds: MeldView[], discards: { tile: string; fromDraw: boolean }[]) {
  return {
    name: 'opp',
    isBot: false,
    connected: true,
    score: 0,
    handCount,
    hasDrawn: false,
    melds,
    discards,
    bonus: [] as string[],
  };
}

function baseView(): GameView {
  return {
    phase: 'postDiscard',
    now: Date.now(),
    claimGapMs: 1500,
    reveal: null,
    gameNumber: 'E1',
    gameNumberZh: '東一',
    remaining: 40,
    mySeat: 0,
    turnSeat: 2,
    seats: [
      seat(13, [], []),
      seat(13, [], [{ tile: 'C5', fromDraw: false }]),
      seat(10, [chow], []),
      seat(13, [], []),
    ],
    myHand: ['B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'D7', 'D8', 'D9', 'E '],
    myDrawn: null,
    selected: null,
    deadline: null,
    phaseDuration: null,
    lastDiscard: { seat: 1, tile: 'C5' },
    claims: [{ seat: 2, kind: 'pung' }],
    myOptions: {},
    pendingClaim: null,
    winFlash: null,
    gameResult: null,
    matchResult: null,
  };
}

const v1 = baseView();

const v2 = baseView();
v2.seats[1] = seat(13, [], []); // claimed tile left the discarder's pile
v2.seats[2] = seat(7, [chow, pung], [{ tile: 'D9', fromDraw: false }]);
v2.claims = [];
v2.lastDiscard = { seat: 2, tile: 'D9' };
v2.now = Date.now() + 50;

renderGame(app, v1);

// Give layout a beat, then render the resolution state and inspect flights.
requestAnimationFrame(() => {
  renderGame(app, v2);
  const board = app.querySelector<HTMLElement>('.board')!;
  const bR = board.getBoundingClientRect();

  // Expected source: center of the CURRENT (7-tile) hand of seat 2.
  let ux1 = Infinity;
  let ux2 = -Infinity;
  let uy = 0;
  let count = 0;
  board.querySelectorAll('[data-hb="2"]').forEach((t) => {
    const r = t.getBoundingClientRect();
    ux1 = Math.min(ux1, r.left);
    ux2 = Math.max(ux2, r.right);
    uy = r.top + r.height / 2;
    count++;
  });
  const expected = { x: (ux1 + ux2) / 2 - bR.left, y: uy - bR.top };

  // Actual source: the discard flight clone's start = dest center + translate.
  const layer = app.querySelector<HTMLElement>('.flight-layer')!;
  const lines: string[] = [`hand backs found: ${count}`];
  layer.querySelectorAll<HTMLElement>('.flight').forEach((clone) => {
    const cR = clone.getBoundingClientRect();
    const m = clone.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    const dx = m ? Number(m[1]) : 0;
    const dy = m ? Number(m[2]) : 0;
    const src = { x: cR.left - bR.left + cR.width / 2 + dx, y: cR.top - bR.top + cR.height / 2 + dy };
    const dest = { x: cR.left - bR.left + cR.width / 2, y: cR.top - bR.top + cR.height / 2 };
    lines.push(
      `flight dest=(${dest.x.toFixed(0)},${dest.y.toFixed(0)}) start=(${src.x.toFixed(0)},${src.y.toFixed(0)})`,
    );
  });
  lines.push(`expected hand-center source=(${expected.x.toFixed(0)},${expected.y.toFixed(0)})`);
  out.textContent = lines.join('\n');
  (window as unknown as { reproDone: boolean }).reproDone = true;
});

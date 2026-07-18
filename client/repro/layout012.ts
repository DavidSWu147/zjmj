/**
 * Visual stress scenarios for the v0.1.2 layout changes: 3x6 discard areas
 * with overflow, the real-life wall pinwheel, bonus-tile rows (own two-row
 * stack, opponents' inset rows past small-kong pockets), drawn-slot anchored
 * hands, and the hand-area gold win flash.
 *
 * Pick a scenario with ?s=walls | kongs | flash | stability (default walls).
 */
import '../src/style.css';
import { GameView, MeldView, SeatView } from '../../shared/src/protocol';
import { renderGame } from '../src/views/game';

const app = document.getElementById('app')!;
const out = document.getElementById('out')!;

const chow: MeldView = { kind: 'chow', tiles: ['B1', 'B2', 'B3'], rotated: 0, faceDown: [] };
const smallKong: MeldView = {
  kind: 'kong',
  kongType: 'small',
  tiles: ['C5', 'C5', 'C5', 'C5'],
  rotated: 2,
  faceDown: [],
  stacked: true,
};
const bigKong = (t: string): MeldView => ({
  kind: 'kong',
  kongType: 'big',
  tiles: [t, t, t, t],
  rotated: 3,
  faceDown: [],
});

function seat(
  handCount: number,
  melds: MeldView[],
  discards: { tile: string; fromDraw: boolean }[],
  bonus: string[] = [],
  hasDrawn = false,
): SeatView {
  return { name: 'opp', isBot: false, connected: true, score: 0, handCount, hasDrawn, melds, discards, bonus };
}

const run = (n: number, t: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ tile: t(i), fromDraw: i % 3 === 0 }));

function baseView(): GameView {
  return {
    phase: 'preDiscard',
    settings: {
      rounds: 4,
      thinkingTime: 30,
      chickenHand: 'one',
      par: 25,
      scoring: 'original',
      bonusTiles: 'full',
    },
    room: null,
    now: Date.now(),
    dice: null,
    claimGapMs: 1500,
    reveal: null,
    gameNumber: 'E1',
    gameNumberZh: '東一',
    remaining: 40,
    // Bonus-tile wall (72 columns), nearly full so the pinwheel shows.
    wall: { breakSeat: 2, cols: 72, diceSum: 9, livePointer: 54, kongDrawn: 1 },
    mySeat: 0,
    turnSeat: 2,
    seats: [
      seat(13, [], run(20, (i) => `D${(i % 9) + 1}`), ['F1', 'A2', 'F3', 'A4', 'F2', 'A1']),
      seat(7, [smallKong, chow], run(8, (i) => `B${(i % 9) + 1}`), ['F4', 'A3']),
      seat(7, [chow, smallKong], run(19, (i) => `C${(i % 9) + 1}`), ['A2', 'F1', 'F2'], true),
      seat(7, [smallKong, chow], run(6, (i) => `C${(i % 9) + 1}`), ['A1'], true),
    ],
    myHand: ['B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'D7', 'D8', 'D9', 'E '],
    myDrawn: 'W ',
    selected: null,
    deadline: null,
    phaseDuration: null,
    lastDiscard: null,
    claims: [],
    myOptions: {},
    pendingClaim: null,
    winFlash: null,
    gameResult: null,
    matchResult: null,
  };
}

const scenario = new URLSearchParams(location.search).get('s') ?? 'walls';
const done = () => ((window as unknown as { reproDone: boolean }).reproDone = true);

if (scenario === 'walls') {
  renderGame(app, baseView());
  requestAnimationFrame(done);
} else if (scenario === 'wallsplain') {
  // No bonus tiles: 17-column walls, side walls run beside the top strip.
  const v = baseView();
  v.wall = { breakSeat: 2, cols: 68, diceSum: 9, livePointer: 54, kongDrawn: 1 };
  for (const s of v.seats) s.bonus = [];
  renderGame(app, v);
  requestAnimationFrame(done);
} else if (scenario === 'kongs') {
  // Every player melds four big kongs: hands must extend away from the
  // fixed drawn-tile spot instead of drifting or colliding.
  const v = baseView();
  const kongs = [bigKong('B9'), bigKong('C9'), bigKong('D9'), bigKong('E ')];
  v.seats[1] = seat(1, kongs, run(4, (i) => `B${i + 1}`), [], true);
  v.seats[2] = seat(1, kongs, run(4, (i) => `C${i + 1}`), [], true);
  v.seats[3] = seat(1, kongs, run(4, (i) => `D${i + 1}`), [], true);
  v.seats[0].melds = kongs;
  v.myHand = ['E '];
  renderGame(app, v);
  requestAnimationFrame(done);
} else if (scenario === 'flash') {
  const v = baseView();
  v.winFlash = { seat: 0, value: 45 };
  renderGame(app, v);
  requestAnimationFrame(done);
} else if (scenario === 'bonusanim') {
  // Item 4: a drawn bonus tile must fly to the bonus row, then the
  // replacement must follow from the dead wall — two explicit flights.
  const v1 = baseView();
  v1.seats[2].hasDrawn = false;
  renderGame(app, v1);
  requestAnimationFrame(() => {
    const v2 = baseView();
    v2.seats[2] = { ...v2.seats[2], bonus: [...v2.seats[2].bonus, 'F3'], hasDrawn: true };
    v2.remaining = 39;
    v2.wall = { ...v2.wall!, kongDrawn: 4 };
    v2.now += 50;
    renderGame(app, v2);
    const flights = app.querySelectorAll('.flight').length;
    out.textContent = `flights launched: ${flights}\n`;
    done();
  });
} else if (scenario === 'konganim') {
  // A concealed kong is declared while the seat holds a drawn tile, so the
  // drawn flag never flips: the replacement draw must still animate from
  // the dead wall (4 meld-tile flights + 1 draw flight).
  const v1 = baseView();
  v1.seats[2] = seat(13, [], [], [], true);
  renderGame(app, v1);
  requestAnimationFrame(() => {
    const v2 = baseView();
    v2.seats[2] = seat(
      9,
      [{ kind: 'kong', kongType: 'concealed', tiles: ['C7', 'C7', 'C7', 'C7'], rotated: -1, faceDown: [0, 3] }],
      [],
      [],
      true,
    );
    v2.remaining = 39;
    v2.wall = { ...v2.wall!, kongDrawn: 2 };
    v2.now += 50;
    renderGame(app, v2);
    const flights = app.querySelectorAll('.flight').length;
    out.textContent = `flights launched: ${flights}\n`;
    done();
  });
} else if (scenario === 'shiftanim') {
  // An opponent discards from hand while holding a drawn tile: the end back
  // flies to the pile AND the drawn tile slides into its spot (2 flights).
  const v1 = baseView();
  v1.seats[2] = seat(13, [], [], [], true);
  renderGame(app, v1);
  requestAnimationFrame(() => {
    const v2 = baseView();
    v2.seats[2] = seat(13, [], [{ tile: 'C7', fromDraw: false }], [], false);
    v2.now += 50;
    renderGame(app, v2);
    const flights = app.querySelectorAll('.flight').length;
    out.textContent = `flights launched: ${flights}\n`;
    done();
  });
} else if (scenario === 'stability') {
  // Item 5: draws and discards must not move a single already-placed hand
  // tile, for any player. Render, then re-render with every seat's drawn
  // state toggled and compare positions of all hand tiles and backs.
  const v1 = baseView();
  v1.seats[2].hasDrawn = false;
  v1.seats[3].hasDrawn = false;
  v1.myDrawn = null;
  renderGame(app, v1);

  const posOf = (): Map<string, string> => {
    const m = new Map<string, string>();
    app.querySelectorAll<HTMLElement>('[data-hb], .hand-tile:not([data-drawn])').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      m.set(`${el.dataset.hb ?? 'own'}:${i}`, `${r.left.toFixed(2)},${r.top.toFixed(2)}`);
    });
    return m;
  };

  requestAnimationFrame(() => {
    const before = posOf();
    const v2 = baseView(); // all seats now hold a drawn tile
    v2.seats[1].hasDrawn = true;
    v2.remaining = 39;
    v2.now += 50;
    renderGame(app, v2);
    requestAnimationFrame(() => {
      const after = posOf();
      let moved = 0;
      for (const [k, p] of before) {
        if (after.get(k) !== p) {
          moved++;
          out.textContent += `MOVED ${k}: ${p} -> ${after.get(k)}\n`;
        }
      }
      out.textContent += `tiles compared: ${before.size}, moved: ${moved}\n`;
      done();
    });
  });
}

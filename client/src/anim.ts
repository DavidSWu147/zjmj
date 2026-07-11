import { GameView } from '../../shared/src/protocol';
import { Tile } from '../../shared/src/tiles';
import { Deg, orientedTile } from './tileui';

/**
 * Tile flight animations between board states.
 *
 * The board re-renders on every server update, so flights live in a separate
 * overlay layer that is never wiped. Each flight remembers a CSS selector for
 * its destination; after every re-render the destinations are re-hidden in
 * the fresh DOM so a broadcast mid-flight (someone passing, selecting a tile,
 * a keyword change) no longer snaps tiles to their final position.
 */

export const MELD_MS = 380;
export const DRAW_MS = 300;
/** Bonus tile set-aside: quick, but never instant (an explicit beat). */
export const BONUS_MS = 220;
/** Stagger between a bonus set-aside and the next flight in the chain. */
export const BONUS_STEP = 200;
/** Drawn tile sliding into the hand after a from-hand discard. */
export const SHIFT_MS = 200;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardSnapshot {
  gameNumber: string;
  remaining: number;
  kongDrawn: number;
  discardCounts: number[];
  meldCounts: number[];
  meldTileLens: number[][];
  bonusCounts: number[];
  drawnFlags: boolean[];
  lastDiscardRect: (Rect | null)[];
  stripRect: (Rect | null)[];
  drawnRect: (Rect | null)[];
}

interface Flight {
  clone: HTMLElement;
  destSel: string;
  endsAt: number;
}

let overlay: HTMLElement | null = null;
let curBoard: HTMLElement | null = null;
let flights: Flight[] = [];

export function setFlightLayer(layer: HTMLElement): void {
  overlay = layer;
}

export function clearFlights(): void {
  for (const f of flights) f.clone.remove();
  flights = [];
}

/** After each re-render: re-hide destinations of live flights in the new DOM. */
export function reapplyFlights(board: HTMLElement): void {
  curBoard = board;
  const now = Date.now();
  flights = flights.filter((f) => {
    if (now >= f.endsAt) {
      f.clone.remove();
      return false;
    }
    const dest = board.querySelector<HTMLElement>(f.destSel);
    if (!dest) {
      // The tile moved on (e.g. the flying discard got claimed): snap.
      f.clone.remove();
      return false;
    }
    dest.style.visibility = 'hidden';
    return true;
  });
}

export function rectOf(el: Element | null, board: HTMLElement): Rect | null {
  if (!el) return null;
  const b = board.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
}

function drawnSel(seat: number, mySeat: number): string {
  return seat === mySeat ? '[data-drawn]' : `[data-odrawn="${seat}"]`;
}

/**
 * Union of the seat's concealed hand tiles in the CURRENT board (opponent
 * backs, or the local player's clickable tiles). Measured live at flight
 * time — a claim melds and discards in one update, so the previous render's
 * hand center would be stale (the pre-meld 13-tile position).
 */
function handUnion(board: HTMLElement, seat: number, mySeat: number): Rect | null {
  const sel =
    seat === mySeat ? `[data-strip="${seat}"] .hand-tile:not([data-drawn])` : `[data-hb="${seat}"]`;
  let u: Rect | null = null;
  board.querySelectorAll(sel).forEach((t) => {
    const r = rectOf(t, board);
    if (!r) return;
    if (!u) u = { ...r };
    else {
      const x2 = Math.max(u.x + u.w, r.x + r.w);
      const y2 = Math.max(u.y + u.h, r.y + r.h);
      u.x = Math.min(u.x, r.x);
      u.y = Math.min(u.y, r.y);
      u.w = x2 - u.x;
      u.h = y2 - u.y;
    }
  });
  return u;
}

/**
 * Where an opponent's discard appears to come from: the rightmost concealed
 * tile of their hand (from the owner's perspective), never the drawn tile.
 * Right and top strips are laid out reversed, so the owner's right end is the
 * first back in DOM order there and the last one on the left strip.
 */
function oppRightmostBack(board: HTMLElement, seat: number, mySeat: number): Rect | null {
  const backs = board.querySelectorAll<HTMLElement>(`[data-hb="${seat}"]`);
  if (backs.length === 0) return null;
  const rel = (seat - mySeat + 4) % 4;
  return rectOf(rel === 3 ? backs[backs.length - 1] : backs[0], board);
}

export function takeSnapshot(board: HTMLElement, view: GameView): BoardSnapshot {
  const lastDiscardRect: (Rect | null)[] = [];
  const stripRect: (Rect | null)[] = [];
  const drawnRect: (Rect | null)[] = [];
  for (let s = 0; s < 4; s++) {
    const n = view.seats[s].discards.length;
    lastDiscardRect.push(rectOf(board.querySelector(`[data-ds="${s}-${n - 1}"]`), board));
    stripRect.push(rectOf(board.querySelector(`[data-strip="${s}"]`), board));
    drawnRect.push(rectOf(board.querySelector(drawnSel(s, view.mySeat)), board));
  }
  return {
    gameNumber: view.gameNumber,
    remaining: view.remaining,
    kongDrawn: view.wall?.kongDrawn ?? 0,
    discardCounts: view.seats.map((sv) => sv.discards.length),
    meldCounts: view.seats.map((sv) => sv.melds.length),
    meldTileLens: view.seats.map((sv) => sv.melds.map((m) => m.tiles.length)),
    bonusCounts: view.seats.map((sv) => (sv.bonus ?? []).length),
    drawnFlags: view.seats.map((sv, s) => (s === view.mySeat ? view.myDrawn !== null : sv.hasDrawn)),
    lastDiscardRect,
    stripRect,
    drawnRect,
  };
}

function degOfSeat(seat: number, mySeat: number): Deg {
  const rel = (seat - mySeat + 4) % 4;
  return ([0, 270, 180, 90] as Deg[])[rel];
}

function degOfEl(el: Element): Deg {
  const m = el.className.match(/tor-(\d+)/);
  return (m ? Number(m[1]) : 0) as Deg;
}

function fly(
  board: HTMLElement,
  tile: Tile | null,
  from: Rect,
  destSel: string,
  ms: number,
  fromDeg: Deg,
  delay = 0,
): void {
  if (!overlay) return;
  const dest = board.querySelector<HTMLElement>(destSel);
  if (!dest) return;
  const to = rectOf(dest, board);
  if (!to || to.w === 0) return;
  const toDeg = degOfEl(dest);
  dest.style.visibility = 'hidden';

  const clone = document.createElement('div');
  clone.className = 'flight';
  const shortSide = Math.min(to.w, to.h);
  clone.style.setProperty('--tw', `${toDeg % 180 === 0 ? to.w : to.h}px`);
  clone.appendChild(orientedTile(tile, toDeg, tile === null ? { back: true } : {}));
  clone.style.left = `${to.x}px`;
  clone.style.top = `${to.y}px`;
  clone.style.width = `${to.w}px`;
  clone.style.height = `${to.h}px`;

  const dx = from.x + from.w / 2 - (to.x + to.w / 2);
  const dy = from.y + from.h / 2 - (to.y + to.h / 2);
  let dr = fromDeg - toDeg;
  if (dr > 180) dr -= 360;
  if (dr < -180) dr += 360;
  const sc = Math.max(0.4, Math.min(2.5, Math.min(from.w, from.h) / shortSide || 1));
  clone.style.transform = `translate(${dx}px, ${dy}px) rotate(${dr}deg) scale(${sc})`;
  if (delay > 0) clone.style.visibility = 'hidden'; // queued behind another flight
  overlay.appendChild(clone);

  const rec: Flight = { clone, destSel, endsAt: Date.now() + delay + ms + 150 };
  flights.push(rec);

  const go = () =>
    requestAnimationFrame(() => {
      clone.style.removeProperty('visibility');
      clone.style.transition = `transform ${ms}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
      clone.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
    });
  if (delay > 0) setTimeout(go, delay);
  else go();
  const finish = () => {
    const i = flights.indexOf(rec);
    if (i >= 0) flights.splice(i, 1);
    clone.remove();
    curBoard?.querySelector<HTMLElement>(destSel)?.style.removeProperty('visibility');
  };
  clone.addEventListener('transitionend', finish);
  setTimeout(finish, delay + ms + 150);
}

/** Point rect at the midpoint of the control panel edge facing a seat. */
function panelEdge(board: HTMLElement, seat: number, mySeat: number, size: Rect): Rect | null {
  const panel = rectOf(board.querySelector('.cpanel'), board);
  if (!panel) return null;
  const rel = (seat - mySeat + 4) % 4;
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;
  const pts: [number, number][] = [
    [cx, panel.y + panel.h],
    [panel.x + panel.w, cy],
    [cx, panel.y],
    [panel.x, cy],
  ];
  const [mx, my] = pts[rel];
  return { x: mx - size.w / 2, y: my - size.h / 2, w: size.w, h: size.h };
}

/**
 * Diffs the previous state against the new one and launches flights.
 * `discardMs` matches the server's uniform claim window; `ownClickRect` is
 * where the local player's clicked tile was.
 */
export function animateTransition(
  board: HTMLElement,
  prev: BoardSnapshot | null,
  view: GameView,
  ownClickRect: Rect | null,
  discardMs: number,
): void {
  curBoard = board;
  if (!prev || prev.gameNumber !== view.gameNumber) return;

  // A pile that shrank means its newest tile was claimed or won.
  let claimedFrom = -1;
  for (let s = 0; s < 4; s++) {
    if (view.seats[s].discards.length < prev.discardCounts[s]) claimedFrom = s;
  }

  let meldGrew = false;
  for (let s = 0; s < 4; s++) {
    const sv = view.seats[s];
    const isMe = s === view.mySeat;
    const hasDrawnNow = isMe ? view.myDrawn !== null : sv.hasDrawn;

    // Drawn bonus tiles: the server settles the whole chain in one update,
    // but the set-aside is animated explicitly — each new bonus tile flies
    // from the drawn spot (or the dead wall for chained replacements) to
    // its slot in the seat's bonus row, one quick beat apiece.
    const bonus = sv.bonus ?? [];
    const newBonus = Math.max(0, bonus.length - (prev.bonusCounts[s] ?? bonus.length));
    if (newBonus > 0) {
      const wallBack = rectOf(board.querySelector('[data-wallback]'), board);
      for (let k = 0; k < newBonus; k++) {
        const bi = bonus.length - newBonus + k;
        const destSel = `[data-bonus="${s}-${bi}"]`;
        const dest = board.querySelector<HTMLElement>(destSel);
        const size = dest ? rectOf(dest, board) : null;
        if (!size) continue;
        const from =
          (k === 0 ? prev.drawnRect[s] : null) ??
          wallBack ??
          panelEdge(board, s, view.mySeat, size);
        if (from) {
          fly(board, bonus[bi], from, destSel, BONUS_MS, degOfSeat(s, view.mySeat), k * BONUS_STEP);
        }
      }
    }

    // Fresh draw: a quick slide from the wall — the live wall's front tile
    // (or the dead-wall end for kong/bonus replacements) when the physical
    // walls are rendered, the panel edge otherwise. A replacement draw that
    // followed a bonus reveal waits for the set-aside beat(s) to play out.
    // A concealed/small kong is declared while already holding a drawn tile,
    // so the drawn flag never flips for its replacement — the seat's meld
    // growth in the same wall-consuming update marks that draw instead.
    const kongGrew =
      sv.melds.length > prev.meldCounts[s] ||
      sv.melds.some((m, mi) => m.tiles.length > (prev.meldTileLens[s][mi] ?? m.tiles.length));
    if (hasDrawnNow && (!prev.drawnFlags[s] || kongGrew) && view.remaining < prev.remaining) {
      const sel = drawnSel(s, view.mySeat);
      const dest = board.querySelector<HTMLElement>(sel);
      const size = dest ? rectOf(dest, board) : null;
      if (size) {
        const fromDead = newBonus > 0 || (view.wall?.kongDrawn ?? 0) > prev.kongDrawn;
        const from =
          rectOf(board.querySelector(fromDead ? '[data-wallback]' : '[data-wallfront]'), board) ??
          panelEdge(board, s, view.mySeat, size);
        if (from) {
          const delay = newBonus > 0 ? newBonus * BONUS_STEP + 60 : 0;
          fly(board, isMe ? view.myDrawn : null, from, sel, DRAW_MS, degOfSeat(s, view.mySeat), delay);
        }
      }
    }

    // New discard: slide from the hand (or the drawn slot for a tsumogiri)
    // to the pile over the claim window. When a meld appeared in this same
    // update (chow/pung + discard resolve together), the hand was re-laid
    // out around the new meld, so any position captured earlier — including
    // the local player's click — is stale; use the live hand center instead.
    const n = sv.discards.length;
    const meldJustGrew = sv.melds.length > prev.meldCounts[s];
    if (n === prev.discardCounts[s] + 1) {
      const d = sv.discards[n - 1];
      const from =
        (d.fromDraw ? prev.drawnRect[s] : null) ??
        (isMe && !meldJustGrew ? ownClickRect : null) ??
        (isMe ? handUnion(board, s, view.mySeat) : oppRightmostBack(board, s, view.mySeat)) ??
        handUnion(board, s, view.mySeat) ??
        prev.stripRect[s];
      if (from) {
        fly(board, d.tile, from, `[data-ds="${s}-${n - 1}"]`, discardMs, degOfSeat(s, view.mySeat));
      }
      // From-hand discard by an opponent who held a drawn tile: the end back
      // (where the discard flight starts) is really the tile that left, so
      // the drawn tile slides over into its place — quick, but not instant.
      // fly() hides the destination back until the slide lands, which is
      // exactly the "tile was taken out" gap.
      const drawnFrom = prev.drawnRect[s];
      if (!isMe && !d.fromDraw && prev.drawnFlags[s] && !hasDrawnNow && drawnFrom) {
        fly(board, null, drawnFrom, `[data-hbend="${s}"]`, SHIFT_MS, degOfSeat(s, view.mySeat));
      }
    }

    // New meld: claimed tile from the pile, the others from the owner's hand.
    if (sv.melds.length === prev.meldCounts[s] + 1) {
      meldGrew = true;
      const mi = sv.melds.length - 1;
      const meld = sv.melds[mi];
      const root = board.querySelector(`[data-meld="${s}-${mi}"]`);
      root?.querySelectorAll<HTMLElement>('[data-mt]').forEach((tor) => {
        const ti = Number(tor.dataset.mt);
        const isClaimed = tor.dataset.claimed === '1' && claimedFrom >= 0;
        const from = isClaimed ? prev.lastDiscardRect[claimedFrom] : prev.stripRect[s];
        const fromDeg = degOfSeat(isClaimed ? claimedFrom : s, view.mySeat);
        const face = meld.faceDown.includes(ti) ? null : meld.tiles[ti];
        if (from) {
          fly(board, face, from, `[data-meld="${s}-${mi}"] [data-mt="${ti}"]`, MELD_MS, fromDeg);
        }
      });
    } else if (sv.melds.length === prev.meldCounts[s]) {
      // Small exposed kong: the 4th tile flies into the pocket.
      sv.melds.forEach((m, mi) => {
        const before = prev.meldTileLens[s][mi] ?? m.tiles.length;
        if (m.tiles.length > before) {
          meldGrew = true;
          const from = prev.stripRect[s];
          if (from) {
            fly(
              board,
              m.tiles[m.tiles.length - 1],
              from,
              `[data-meld="${s}-${mi}"] [data-pocket]`,
              MELD_MS,
              degOfSeat(s, view.mySeat),
            );
          }
        }
      });
    }
  }

  // Win on discard: a pile lost its tile without a meld growing — it travels
  // to the winner (whose hand is being revealed).
  if (claimedFrom >= 0 && !meldGrew && view.phase === 'gameEnd') {
    const winner = view.reveal?.seat ?? view.claims.find((c) => c.kind === 'mahjong')?.seat ?? -1;
    const from = prev.lastDiscardRect[claimedFrom];
    if (winner >= 0 && from) {
      const sel = drawnSel(winner, view.mySeat);
      const face = winner === view.mySeat ? view.myDrawn : (view.reveal?.drawn ?? null);
      if (board.querySelector(sel)) {
        fly(board, face, from, sel, MELD_MS, degOfSeat(claimedFrom, view.mySeat));
      }
    }
  }
}

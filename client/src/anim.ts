import { GameView } from '../../shared/src/protocol';
import { Tile } from '../../shared/src/tiles';
import { Deg, orientedTile } from './tileui';

/**
 * Tile flight animations between board states. The board fully re-renders on
 * every server update, so movement is animated FLIP-style: rects of interest
 * are captured after each render, and when the next state shows a tile that
 * moved (hand → discard pile, pile → meld, pile → winner), a floating clone
 * travels from the old rect to the new element while the destination is
 * hidden.
 */

/** Discard slide spans the uniform claim window (spec: 1.5 seconds). */
export const DISCARD_MS = 1500;
/** Meld/win movements are speedy but not instantaneous. */
export const MELD_MS = 380;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardSnapshot {
  gameNumber: string;
  discardCounts: number[];
  meldCounts: number[];
  meldTileLens: number[][];
  lastDiscardRect: (Rect | null)[];
  stripRect: (Rect | null)[];
}

export function rectOf(el: Element | null, board: HTMLElement): Rect | null {
  if (!el) return null;
  const b = board.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
}

export function takeSnapshot(board: HTMLElement, view: GameView): BoardSnapshot {
  const lastDiscardRect: (Rect | null)[] = [];
  const stripRect: (Rect | null)[] = [];
  for (let s = 0; s < 4; s++) {
    const n = view.seats[s].discards.length;
    lastDiscardRect.push(rectOf(board.querySelector(`[data-ds="${s}-${n - 1}"]`), board));
    stripRect.push(rectOf(board.querySelector(`[data-strip="${s}"]`), board));
  }
  return {
    gameNumber: view.gameNumber,
    discardCounts: view.seats.map((sv) => sv.discards.length),
    meldCounts: view.seats.map((sv) => sv.melds.length),
    meldTileLens: view.seats.map((sv) => sv.melds.map((m) => m.tiles.length)),
    lastDiscardRect,
    stripRect,
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
  dest: Element,
  ms: number,
  fromDeg: Deg,
): void {
  const to = rectOf(dest, board);
  if (!to || to.w === 0) return;
  const toDeg = degOfEl(dest);
  const d = dest as HTMLElement;
  d.style.visibility = 'hidden';

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
  board.appendChild(clone);

  requestAnimationFrame(() => {
    clone.style.transition = `transform ${ms}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
    clone.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    d.style.visibility = '';
    clone.remove();
  };
  clone.addEventListener('transitionend', finish);
  setTimeout(finish, ms + 150);
}

/**
 * Diffs the previous state against the new one and launches flights.
 * `ownClickRect` is the rect of the tile the local player clicked to discard.
 */
export function animateTransition(
  board: HTMLElement,
  prev: BoardSnapshot | null,
  view: GameView,
  ownClickRect: Rect | null,
): void {
  if (!prev || prev.gameNumber !== view.gameNumber) return;

  // A pile that shrank means its newest tile was claimed or won.
  let claimedFrom = -1;
  for (let s = 0; s < 4; s++) {
    if (view.seats[s].discards.length < prev.discardCounts[s]) claimedFrom = s;
  }

  let meldGrew = false;
  for (let s = 0; s < 4; s++) {
    // New discard: slide from the hand to the pile over the claim window.
    const n = view.seats[s].discards.length;
    if (n === prev.discardCounts[s] + 1) {
      const dest = board.querySelector(`[data-ds="${s}-${n - 1}"]`);
      const from = (s === view.mySeat ? ownClickRect : null) ?? prev.stripRect[s];
      if (dest && from) {
        fly(board, view.seats[s].discards[n - 1].tile, from, dest, DISCARD_MS, degOfSeat(s, view.mySeat));
      }
    }

    // New meld: claimed tile from the pile, the others from the owner's hand.
    if (view.seats[s].melds.length === prev.meldCounts[s] + 1) {
      meldGrew = true;
      const mi = view.seats[s].melds.length - 1;
      const meld = view.seats[s].melds[mi];
      const root = board.querySelector(`[data-meld="${s}-${mi}"]`);
      root?.querySelectorAll('[data-mt]').forEach((tor) => {
        const ti = Number((tor as HTMLElement).dataset.mt);
        const isClaimed = (tor as HTMLElement).dataset.claimed === '1' && claimedFrom >= 0;
        const from = isClaimed ? prev.lastDiscardRect[claimedFrom] : prev.stripRect[s];
        const fromDeg = degOfSeat(isClaimed ? claimedFrom : s, view.mySeat);
        const face = meld.faceDown.includes(ti) ? null : meld.tiles[ti];
        if (from) fly(board, face, from, tor, MELD_MS, fromDeg);
      });
    } else if (view.seats[s].melds.length === prev.meldCounts[s]) {
      // Small exposed kong: the 4th tile flies into the pocket.
      view.seats[s].melds.forEach((m, mi) => {
        const before = prev.meldTileLens[s][mi] ?? m.tiles.length;
        if (m.tiles.length > before) {
          meldGrew = true;
          const pocket = board.querySelector(`[data-meld="${s}-${mi}"] [data-pocket]`);
          const from = prev.stripRect[s];
          if (pocket && from) {
            fly(board, m.tiles[m.tiles.length - 1], from, pocket, MELD_MS, degOfSeat(s, view.mySeat));
          }
        }
      });
    }
  }

  // Win on discard / robbed kong: a pile lost its tile without a meld
  // growing — it travels to the winner.
  if (claimedFrom >= 0 && !meldGrew && view.phase === 'gameEnd') {
    const winClaim = view.claims.find((c) => c.kind === 'mahjong');
    const from = prev.lastDiscardRect[claimedFrom];
    if (winClaim && from) {
      const winner = winClaim.seat;
      const dest =
        winner === view.mySeat
          ? board.querySelector('[data-drawn]')
          : board.querySelector(`[data-strip="${winner}"] .tor:last-of-type`) ??
            board.querySelector(`[data-strip="${winner}"]`);
      if (dest) {
        const face = winner === view.mySeat ? view.myDrawn : null;
        fly(board, face, from, dest, MELD_MS, degOfSeat(claimedFrom, view.mySeat));
      }
    }
  }
}

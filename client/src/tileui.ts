import { MeldView } from '../../shared/src/protocol';
import { Tile } from '../../shared/src/tiles';

const SUIT_DIR: Record<string, string> = { B: 'bamboo', C: 'character', D: 'dot' };
const WINDS = ['E', 'S', 'W', 'N'];

export function tileSrc(t: Tile): string {
  const suit = t[0];
  if (t[1] !== ' ') {
    return `/tiles/${SUIT_DIR[suit]}/0${t[1]}.svg`;
  }
  if (WINDS.includes(suit)) return `/tiles/wind/${suit}.svg`;
  return `/tiles/dragon/${suit}.svg`;
}

export interface TileOpts {
  back?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  highlight?: boolean;
}

/** Builds a tile element; size comes from the CSS var --tw on an ancestor. */
export function tileEl(t: Tile | null, opts: TileOpts = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tile';
  if (opts.back || t === null) {
    el.classList.add('tile-back');
  } else {
    el.dataset.t = t; // face-up tiles participate in same-tile highlighting
    const img = document.createElement('img');
    img.src = tileSrc(t);
    img.alt = t.trim();
    img.draggable = false;
    el.appendChild(img);
  }
  if (opts.selected) el.classList.add('tile-selected');
  if (opts.dimmed) el.classList.add('tile-dimmed');
  if (opts.highlight) el.classList.add('tile-highlight');
  return el;
}

export function tileRow(tiles: (Tile | null)[], opts: TileOpts = {}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  for (const t of tiles) row.appendChild(tileEl(t, opts));
  return row;
}

/**
 * Hovering any face-up tile highlights every visible identical tile
 * (including itself) in gold. Installed once, document-wide, so it works on
 * the game board, result screens, and the records viewer alike.
 */
export function installTileHighlight(): void {
  let lit: HTMLElement[] = [];
  const clear = () => {
    for (const el of lit) el.classList.remove('tile-same');
    lit = [];
  };
  document.addEventListener('pointerover', (e) => {
    const target = e.target as HTMLElement | null;
    const tile = target?.closest?.<HTMLElement>('.tile[data-t]') ?? null;
    clear();
    if (!tile) return;
    const code = tile.dataset.t!;
    document.querySelectorAll<HTMLElement>(`.tile[data-t="${CSS.escape(code)}"]`).forEach((el) => {
      el.classList.add('tile-same');
      lit.push(el);
    });
  });
  document.addEventListener('pointerleave', clear);
}

export type Deg = 0 | 90 | 180 | 270;

/**
 * A tile inside a layout box that matches its visual orientation, so rotated
 * tiles occupy their true footprint (CSS transforms alone do not affect
 * layout). deg 90/270 swap the box's width and height.
 */
export function orientedTile(t: Tile | null, deg: Deg, opts: TileOpts = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `tor tor-${deg}`;
  wrap.appendChild(tileEl(t, opts));
  return wrap;
}

/**
 * Renders a meld for the player at relative screen position `rel`
 * (0 = bottom/self, 1 = right, 2 = top, 3 = left).
 *
 * - Tiles run in the owner's left-to-right order, mapped to screen order.
 * - The claimed tile is rotated 90°; its OUTER long edge lines up with the
 *   outer short edges of the upright tiles (alignment via flex + true boxes).
 * - A small exposed kong's 4th tile is rotated too and sits in the "pocket"
 *   beside the claimed tile, toward the board center.
 */
export function meldEl(m: MeldView, rel: 0 | 1 | 2 | 3): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `meld meld-r${rel}`;
  const baseDeg: Deg = ([0, 270, 180, 90] as Deg[])[rel];
  const rotDeg: Deg = (((baseDeg + 90) % 360) as Deg);

  const pieces: HTMLElement[] = [];
  m.tiles.forEach((t, i) => {
    if (m.stacked && i === m.tiles.length - 1) return; // pocket tile, drawn with the rotated one
    const isRot = m.rotated === i;
    const opts: TileOpts = { back: m.faceDown.includes(i) };
    if (!isRot) {
      const el = orientedTile(t, baseDeg, opts);
      el.dataset.mt = String(i);
      pieces.push(el);
      return;
    }
    if (m.stacked) {
      // Small exposed kong: rotated pair stacked toward the board center.
      const stack = document.createElement('div');
      stack.className = `kong-pocket kong-pocket-r${rel}`;
      const claimed = orientedTile(t, rotDeg, opts);
      claimed.dataset.mt = String(i);
      claimed.dataset.claimed = '1';
      const pocket = orientedTile(m.tiles[m.tiles.length - 1], rotDeg, {});
      pocket.dataset.pocket = '1';
      // The pocket tile sits on the board-center side of the claimed tile:
      // bottom seat: center is up (column, pocket first); right seat: center
      // is left (row, pocket first); top/left seats: the reverse.
      if (rel === 0 || rel === 1) stack.append(pocket, claimed);
      else stack.append(claimed, pocket);
      pieces.push(stack);
    } else {
      const el = orientedTile(t, rotDeg, opts);
      el.dataset.mt = String(i);
      el.dataset.claimed = '1';
      pieces.push(el);
    }
  });
  // Owner's left-to-right maps to: bottom -> screen left-to-right,
  // right -> screen bottom-to-top, top -> screen right-to-left,
  // left -> screen top-to-bottom.
  const ordered = rel === 1 || rel === 2 ? pieces.reverse() : pieces;
  for (const p of ordered) wrap.appendChild(p);
  return wrap;
}

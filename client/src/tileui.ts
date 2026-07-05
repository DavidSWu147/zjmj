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
  rotated?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  highlight?: boolean;
  stackedExtra?: Tile | null;
}

/** Builds a tile element; size comes from the CSS var --tw on an ancestor. */
export function tileEl(t: Tile | null, opts: TileOpts = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tile';
  if (opts.back || t === null) {
    el.classList.add('tile-back');
  } else {
    const img = document.createElement('img');
    img.src = tileSrc(t);
    img.alt = t.trim();
    img.draggable = false;
    el.appendChild(img);
  }
  if (opts.rotated) el.classList.add('tile-rot');
  if (opts.selected) el.classList.add('tile-selected');
  if (opts.dimmed) el.classList.add('tile-dimmed');
  if (opts.highlight) el.classList.add('tile-highlight');
  if (opts.stackedExtra) {
    const extra = tileEl(opts.stackedExtra, {});
    extra.classList.add('tile-stacked');
    el.appendChild(extra);
  }
  return el;
}

export function tileRow(tiles: (Tile | null)[], opts: TileOpts = {}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  for (const t of tiles) row.appendChild(tileEl(t, opts));
  return row;
}

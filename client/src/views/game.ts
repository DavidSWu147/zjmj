import { GameAction, GameView, MeldView } from '../../../shared/src/protocol';
import { Tile } from '../../../shared/src/tiles';
import { net } from '../net';
import { tileEl } from '../tileui';
import { escapeHtml } from './play';

/** Seat colors by current seat wind (spec: E green, S vermilion, W cream, N blue). */
const SEAT_COLORS = ['var(--seat-e)', 'var(--seat-s)', 'var(--seat-w)', 'var(--seat-n)'];
const SEAT_LETTERS = ['E', 'S', 'W', 'N'];
const SEAT_ZH = ['東', '南', '西', '北'];
const KW_LABEL: Record<string, { en: string; zh: string; cls: string }> = {
  chow: { en: 'CHOW', zh: '吃', cls: 'chow' },
  pung: { en: 'PUNG', zh: '碰', cls: 'pung' },
  kong: { en: 'KONG', zh: '槓', cls: 'kong' },
  mahjong: { en: 'MAHJONG', zh: '和', cls: 'mahjong' },
};

let selKey: string | null = null;
let lastDiscardTotals: number[] = [0, 0, 0, 0];
let lastGameNumber = '';
let resizeHooked = false;

function act(action: GameAction): void {
  net.send({ type: 'action', action });
}

export function renderGame(el: HTMLElement, view: GameView): void {
  if (!resizeHooked) {
    resizeHooked = true;
    window.addEventListener('resize', () => {
      const v = net.state.gameView;
      if (v && location.hash.includes('play')) renderGame(el, v);
    });
  }
  if (view.gameNumber !== lastGameNumber) {
    lastGameNumber = view.gameNumber;
    lastDiscardTotals = [0, 0, 0, 0];
    selKey = null;
  }
  if (view.selected === null && view.pendingClaim === null) selKey = null;

  el.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'board';
  el.appendChild(board);

  const W = el.clientWidth || window.innerWidth;
  const H = el.clientHeight || window.innerHeight;
  const cx = W / 2;
  const cy = H * 0.46;
  const P = Math.min(W, H) * 0.335;
  const tw = Math.min(W / 21, H * 0.075); // own hand tile width
  const th = (tw * 4) / 3;
  const dt = P / 5.6; // discard tile width (6 per row, slight windmill overhang)
  const dh = (dt * 4) / 3;
  const gap = Math.max(5, P * 0.03);

  board.style.setProperty('--tw', `${tw}px`);

  // ── central control panel ─────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'cpanel';
  panel.style.left = `${cx - P / 2}px`;
  panel.style.top = `${cy - P / 2}px`;
  panel.style.width = `${P}px`;
  panel.style.height = `${P}px`;
  // Quadrants: rel 0 bottom, 1 right, 2 top, 3 left (diagonal split).
  const QUAD_CLIP = [
    'polygon(0% 100%, 50% 50%, 100% 100%)',
    'polygon(100% 0%, 50% 50%, 100% 100%)',
    'polygon(0% 0%, 50% 50%, 100% 0%)',
    'polygon(0% 0%, 50% 50%, 0% 100%)',
  ];
  const LABEL_POS: [string, string][] = [
    ['left: 50%; bottom: 4%; transform: translateX(-50%)', ''],
    ['right: 3%; top: 50%; transform: translateY(-50%)', ''],
    ['left: 50%; top: 4%; transform: translateX(-50%)', ''],
    ['left: 3%; top: 50%; transform: translateY(-50%)', ''],
  ];
  for (let rel = 0; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const quad = document.createElement('div');
    quad.className = 'quad' + (view.turnSeat === seat && !view.gameResult ? ' active' : '');
    quad.style.background = SEAT_COLORS[seat];
    quad.style.clipPath = QUAD_CLIP[rel];
    panel.appendChild(quad);
    const label = document.createElement('div');
    label.className = 'quad-label';
    label.style.cssText = LABEL_POS[rel][0];
    label.innerHTML = `<span class="seat-letter">${SEAT_LETTERS[seat]}</span><span class="seat-score">${view.seats[seat].score}</span>`;
    label.title = `${SEAT_ZH[seat]} · ${escapeHtml(view.seats[seat].name)}`;
    panel.appendChild(label);
  }
  // Center circle: game number + tiles remaining, or dice while dealing.
  const circle = document.createElement('div');
  circle.className = 'ccircle';
  if (view.phase === 'dealing' && view.dice) {
    const grid = document.createElement('div');
    grid.className = 'dice-grid';
    view.dice.forEach((d, i) => {
      const die = document.createElement('div');
      die.className = 'die';
      die.textContent = String(d);
      grid.appendChild(die);
      // Top two dice land first, then the bottom two (spec).
      setTimeout(() => die.classList.add('shown'), i < 2 ? 350 : 1500);
    });
    circle.appendChild(grid);
  } else {
    circle.innerHTML = `<div class="gnum">${view.gameNumber}</div><div class="rem">${String(view.remaining).padStart(2, '0')}</div>`;
    circle.title = view.gameNumberZh;
  }
  panel.appendChild(circle);
  board.appendChild(panel);

  // ── timer bar ─────────────────────────────────────────────────────
  if (view.deadline && view.phaseDuration && !view.gameResult) {
    const bar = document.createElement('div');
    bar.className = 'timerbar';
    bar.style.left = `${cx - P / 2}px`;
    bar.style.top = `${cy + P / 2 + 2}px`;
    bar.style.width = `${P}px`;
    const fill = document.createElement('div');
    fill.className = 'fill';
    const remainMs = Math.max(0, view.deadline - Date.now());
    fill.style.transform = `scaleX(${Math.min(1, remainMs / view.phaseDuration)})`;
    bar.appendChild(fill);
    board.appendChild(bar);
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${remainMs}ms linear`;
      fill.style.transform = 'scaleX(0)';
    });
  }

  // ── discard zones (windmill) ──────────────────────────────────────
  const rot = (x: number, y: number, k: number): [number, number] => {
    let px = x;
    let py = y;
    for (let i = 0; i < k; i++) {
      const nx = cx + (py - cy);
      const ny = cy - (px - cx);
      px = nx;
      py = ny;
    }
    return [px, py];
  };
  for (let rel = 0; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const zone = document.createElement('div');
    zone.className = 'discard-zone';
    zone.style.setProperty('--tw', `${dt}px`);
    const discards = view.seats[seat].discards;
    const grew = discards.length > lastDiscardTotals[seat];
    lastDiscardTotals[seat] = discards.length;
    discards.forEach((d, i) => {
      const row = Math.min(3, Math.floor(i / 6));
      const col = row < 3 ? i % 6 : i - 18;
      // Bottom-zone coordinates: right edge aligns with the panel's right edge.
      const x0 = cx + P / 2 - 6 * dt + col * dt;
      const y0 = cy + P / 2 + gap + row * dh;
      const [x, y] = rot(x0 + dt / 2, y0 + dh / 2, rel);
      const t = tileEl(d.tile, { dimmed: !d.fromDraw ? false : true });
      t.style.left = `${x - dt / 2}px`;
      t.style.top = `${y - dh / 2}px`;
      t.style.setProperty('--rot', `rotate(${-90 * rel}deg)`);
      t.style.transform = `rotate(${-90 * rel}deg)`;
      const isNewest =
        i === discards.length - 1 &&
        grew &&
        view.lastDiscard !== null &&
        view.lastDiscard.seat === seat &&
        view.phase === 'postDiscard';
      if (isNewest) t.classList.add('discard-new');
      zone.appendChild(t);
    });
    board.appendChild(zone);
  }

  // ── opponent hands + melds ────────────────────────────────────────
  const oppTw = tw * 0.6;
  for (let rel = 1; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const sv = view.seats[seat];
    const wrap = document.createElement('div');
    wrap.className = 'opp-hand' + (rel !== 2 ? ' vertical' : '');
    wrap.style.setProperty('--tw', `${oppTw}px`);
    const pieces: HTMLElement[] = [];
    // Melds go to the player's relative left of their hand tiles.
    for (const m of sv.melds) {
      pieces.push(meldEl(m, -90 * rel));
    }
    if (pieces.length > 0) {
      const gapEl = document.createElement('div');
      gapEl.style.width = gapEl.style.height = `${oppTw * 0.5}px`;
      pieces.push(gapEl);
    }
    for (let i = 0; i < sv.handCount; i++) {
      pieces.push(tileEl(null, { back: true }));
    }
    if (sv.hasDrawn) {
      const g = document.createElement('div');
      g.style.width = g.style.height = `${oppTw * 0.4}px`;
      pieces.push(g);
      pieces.push(tileEl(null, { back: true }));
    }
    // Order along the strip: for the right player their left is our bottom,
    // so reverse so melds end up on their relative left.
    const ordered = rel === 1 ? pieces.reverse() : pieces;
    for (const p of ordered) wrap.appendChild(p);

    const oth = (oppTw * 4) / 3;
    if (rel === 2) {
      wrap.style.top = `${Math.max(6, cy - P / 2 - gap - 4 * dh - oth - 14)}px`;
      wrap.style.left = '50%';
      wrap.style.transform = 'translateX(-50%)';
    } else if (rel === 1) {
      wrap.style.right = '8px';
      wrap.style.top = '50%';
      wrap.style.transform = 'translateY(-50%)';
    } else {
      wrap.style.left = '8px';
      wrap.style.top = '50%';
      wrap.style.transform = 'translateY(-50%)';
    }
    // Name tag
    const tag = document.createElement('div');
    tag.textContent = `${sv.name}${sv.connected ? '' : ' (away)'}`;
    tag.style.cssText =
      'position:absolute;font-size:11px;color:#dfe7e2;text-shadow:0 1px 2px #000;white-space:nowrap;';
    if (rel === 2) tag.style.cssText += 'left:50%;transform:translateX(-50%);bottom:-16px;';
    else if (rel === 1) tag.style.cssText += 'right:2px;top:-18px;';
    else tag.style.cssText += 'left:2px;top:-18px;';
    wrap.appendChild(tag);
    board.appendChild(wrap);
  }

  // ── own hand ──────────────────────────────────────────────────────
  const mine = view.seats[view.mySeat];
  const handWrap = document.createElement('div');
  handWrap.className = 'hand-area';
  handWrap.style.bottom = '10px';
  handWrap.style.left = '50%';

  const canDiscard = !!view.myOptions.discard;
  const clickTile = (key: string, tile: Tile, fromDrawn: boolean) => {
    if (!canDiscard) return;
    if (selKey === key) {
      act({ kind: 'discard', tile, fromDrawn });
      selKey = null;
    } else {
      selKey = key;
      act({ kind: 'select', tile, fromDrawn });
      renderGame(el, view);
    }
  };

  for (const m of mine.melds) {
    handWrap.appendChild(meldEl(m, 0));
    const g = document.createElement('div');
    g.className = 'meld-gap';
    handWrap.appendChild(g);
  }
  view.myHand.forEach((t, i) => {
    const key = `h${i}`;
    const tile = tileEl(t, { selected: selKey === key });
    tile.classList.add('hand-tile');
    tile.addEventListener('click', () => clickTile(key, t, false));
    handWrap.appendChild(tile);
  });
  if (view.myDrawn !== null) {
    const g = document.createElement('div');
    g.className = 'drawn-gap';
    handWrap.appendChild(g);
    const tile = tileEl(view.myDrawn, { selected: selKey === 'drawn' });
    tile.classList.add('hand-tile');
    tile.addEventListener('click', () => clickTile('drawn', view.myDrawn!, true));
    handWrap.appendChild(tile);
  }
  board.appendChild(handWrap);
  // Center the hand strip.
  requestAnimationFrame(() => {
    handWrap.style.left = `${Math.max(8, (W - handWrap.offsetWidth) / 2)}px`;
  });

  // ── claim keywords ────────────────────────────────────────────────
  const KW_POS: [number, number][] = [
    [cx + P / 2 + dh, cy + P / 2 + gap + 1.2 * dh],
    [cx + P / 2 + gap + 1.2 * dh, cy - P / 2 - dh],
    [cx - P / 2 - dh, cy - P / 2 - gap - 1.2 * dh],
    [cx - P / 2 - gap - 1.2 * dh, cy + P / 2 + dh],
  ];
  for (const c of view.claims) {
    const rel = (c.seat - view.mySeat + 4) % 4;
    const kw = KW_LABEL[c.kind];
    const w = document.createElement('div');
    w.className = 'claim-word';
    w.style.color = `var(--kw-${kw.cls})`;
    w.textContent = `${kw.en} ${kw.zh}`;
    const [x, y] = KW_POS[rel];
    w.style.left = `${x}px`;
    w.style.top = `${y}px`;
    w.style.transform = 'translate(-50%,-50%)';
    board.appendChild(w);
  }

  // ── pending claim preview ─────────────────────────────────────────
  if (view.pendingClaim) {
    const pv = document.createElement('div');
    pv.className = 'variant-bar';
    pv.style.right = '18px';
    pv.style.bottom = `${th + 84}px`;
    pv.style.setProperty('--tw', `${tw * 0.7}px`);
    const lbl = document.createElement('span');
    lbl.textContent = 'Claiming:';
    lbl.style.alignSelf = 'center';
    lbl.style.color = 'var(--text-dim)';
    pv.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'tile-row';
    for (const t of view.pendingClaim.tiles) row.appendChild(tileEl(t));
    pv.appendChild(row);
    board.appendChild(pv);
  }

  // ── action buttons ────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'action-bar';
  bar.style.right = '18px';
  bar.style.bottom = `${th + 30}px`;
  const btn = (cls: string, en: string, zh: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `action-btn ${cls}`;
    b.innerHTML = `${en}<span class="zh">${zh}</span>`;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };
  const o = view.myOptions;

  const showVariants = (
    items: { label: HTMLElement; fn: () => void }[],
  ): void => {
    const vb = document.createElement('div');
    vb.className = 'variant-bar';
    vb.style.right = '18px';
    vb.style.bottom = `${th + 92}px`;
    vb.style.setProperty('--tw', `${tw * 0.72}px`);
    for (const it of items) {
      const opt = document.createElement('div');
      opt.className = 'variant-opt';
      opt.appendChild(it.label);
      opt.addEventListener('click', () => {
        vb.remove();
        it.fn();
      });
      vb.appendChild(opt);
    }
    board.appendChild(vb);
  };

  if (o.kongs && o.kongs.length > 0 && view.phase !== 'robbing') {
    btn('kong', 'KONG', '槓', () => {
      if (o.kongs!.length === 1) {
        act({ kind: 'kong', tile: o.kongs![0].tile, variant: o.kongs![0].variant });
      } else {
        showVariants(
          o.kongs!.map((k) => ({
            label: kongPreview(k.tile, k.variant),
            fn: () => act({ kind: 'kong', tile: k.tile, variant: k.variant }),
          })),
        );
      }
    });
  }
  if (o.mahjong) {
    btn('mahjong', 'MAHJONG', '自摸', () => act({ kind: 'mahjong' }));
  }
  if (o.claim) {
    const c = o.claim;
    if (c.chows && c.chows.length > 0) {
      btn('chow', 'CHOW', '吃', () => {
        if (c.chows!.length === 1) {
          act({ kind: 'claim', claim: 'chow', chowLow: c.chows![0] });
        } else {
          showVariants(
            c.chows!.map((low) => ({
              label: chowPreview(low),
              fn: () => act({ kind: 'claim', claim: 'chow', chowLow: low }),
            })),
          );
        }
      });
    }
    if (c.pung) btn('pung', 'PUNG', '碰', () => act({ kind: 'claim', claim: 'pung' }));
    if (c.kong) btn('kong', 'KONG', '槓', () => act({ kind: 'claim', claim: 'kong' }));
    if (c.mahjong) btn('mahjong', 'MAHJONG', '和', () => act({ kind: 'claim', claim: 'mahjong' }));
    btn('pass', 'PASS', '過', () => act({ kind: 'claim', claim: 'pass' }));
  }
  if (bar.children.length > 0) board.appendChild(bar);

  // ── leave button ──────────────────────────────────────────────────
  const leave = document.createElement('button');
  leave.textContent = 'Leave';
  leave.style.cssText = 'position:absolute;top:10px;left:10px;z-index:9;opacity:.75;';
  leave.addEventListener('click', () => {
    if (confirm('Leave the match? A bot will take your seat.')) {
      net.send({ type: 'leaveMatch' });
      net.state.gameView = null;
      location.hash = '#/play';
    }
  });
  board.appendChild(leave);

  // ── result overlays ───────────────────────────────────────────────
  if (view.matchResult) {
    board.appendChild(matchResultOverlay(view));
  } else if (view.gameResult) {
    board.appendChild(gameResultOverlay(view));
  }
}

function chowPreview(low: Tile): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  const idx = 'BCD'.indexOf(low[0]) * 9 + Number(low[1]) - 1;
  for (let k = 0; k < 3; k++) {
    const t = `${'BCD'[Math.floor((idx + k) / 9)]}${((idx + k) % 9) + 1}`;
    row.appendChild(tileEl(t));
  }
  return row;
}

function kongPreview(tile: Tile, variant: 'concealed' | 'small'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  for (let k = 0; k < 4; k++) {
    row.appendChild(tileEl(tile, { back: variant === 'concealed' && (k === 0 || k === 3) }));
  }
  return row;
}

function meldEl(m: MeldView, rotDeg: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'meld';
  if (rotDeg !== 0) wrap.style.transform = `rotate(${rotDeg}deg)`;
  m.tiles.forEach((t, i) => {
    if (m.stacked && i === m.tiles.length - 1) return; // rendered stacked below
    const isBack = m.faceDown.includes(i);
    const isRot = m.rotated === i;
    const opts = {
      back: isBack,
      rotated: isRot,
      stackedExtra: m.stacked && isRot ? m.tiles[m.tiles.length - 1] : null,
    };
    wrap.appendChild(tileEl(t, opts));
  });
  return wrap;
}

function deltaCell(view: GameView, seat: number, delta: number, extraTag = ''): string {
  const name = escapeHtml(view.seats[seat].name);
  const cls = delta > 0 ? 'win-gold' : delta < 0 ? 'lose-gray' : '';
  const sign = delta > 0 ? '+' : '';
  return `<div class="delta-cell">
    <div class="nm">${SEAT_LETTERS[seat]} · ${name}</div>
    <div class="dv ${cls}">${sign}${delta}</div>
    ${extraTag}
  </div>`;
}

function gameResultOverlay(view: GameView): HTMLElement {
  const r = view.gameResult!;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'result-card';

  if (r.draw) {
    card.innerHTML = `<h2 class="draw-green">Drawn Game 流局</h2>
      <p style="color:var(--text-dim)">The live wall is exhausted. Nobody scores.</p>
      <div class="result-next">Next game in ${r.nextIn}s…</div>`;
    overlay.appendChild(card);
    return overlay;
  }

  const winnerName = escapeHtml(view.seats[r.winnerSeat!].name);
  const winByText =
    r.winBy === 'self'
      ? '<span class="win-gold">Self-Draw 自摸</span>'
      : `Mahjong 和 — <span class="lose-gray">Discarder 放銃: ${
          r.responsibleSeat !== null && r.responsibleSeat !== undefined
            ? escapeHtml(view.seats[r.responsibleSeat].name)
            : 'nobody (same-round immunity)'
        }</span>`;
  card.innerHTML = `<h2><span class="win-gold">${winnerName}</span> wins!</h2>
    <div>${winByText}</div>`;

  if (r.winningHand) {
    const handRow = document.createElement('div');
    handRow.className = 'result-hand';
    for (const m of r.winningHand.melds) handRow.appendChild(meldEl(m, 0));
    if (r.winningHand.melds.length > 0) {
      const g = document.createElement('div');
      g.style.width = '14px';
      handRow.appendChild(g);
    }
    for (const t of r.winningHand.concealed) handRow.appendChild(tileEl(t));
    const g2 = document.createElement('div');
    g2.style.width = '14px';
    handRow.appendChild(g2);
    handRow.appendChild(tileEl(r.winningHand.winTile, { highlight: true }));
    card.appendChild(handRow);
  }

  const table = document.createElement('table');
  table.className = 'pattern-list';
  for (const p of r.patterns ?? []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td style="color:var(--text-dim)">${p.zh}</td><td class="pts">${p.points}</td>`;
    table.appendChild(tr);
  }
  card.appendChild(table);

  const total = document.createElement('div');
  total.className = 'result-total';
  const limitNote =
    r.limit === 'compound'
      ? ' (compound limit 320)'
      : r.limit === 'listed'
        ? ' (listed limit hand)'
        : '';
  total.textContent = `Total: ${r.total} points${limitNote}`;
  card.appendChild(total);

  const deltas = document.createElement('div');
  deltas.className = 'result-deltas';
  deltas.innerHTML = [0, 1, 2, 3].map((s) => deltaCell(view, s, r.deltas[s])).join('');
  card.appendChild(deltas);

  const next = document.createElement('div');
  next.className = 'result-next';
  next.textContent = `Next game in ${r.nextIn}s…`;
  card.appendChild(next);

  overlay.appendChild(card);
  return overlay;
}

function matchResultOverlay(view: GameView): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'result-card';
  const rows = view
    .matchResult!.standings.map((s) => {
      const cls = s.result === 'WIN' ? 'win-gold' : s.result === 'LOSE' ? 'lose-gray' : 'draw-green';
      return `<tr>
        <td>${escapeHtml(s.name)}${s.isBot ? ' 🤖' : ''}</td>
        <td class="pts">${s.score > 0 ? '+' : ''}${s.score}</td>
        <td class="pts ${cls}" style="font-weight:800">${s.result}</td>
      </tr>`;
    })
    .join('');
  card.innerHTML = `<h2>Match Over 終局</h2>
    <table class="pattern-list">${rows}</table>
    <div class="dialog-btns"><button id="tolobby">Back to Lobby</button></div>`;
  card.querySelector('#tolobby')!.addEventListener('click', () => {
    net.send({ type: 'leaveMatch' });
    net.state.gameView = null;
    net.state.inMatch = false;
    location.hash = '#/play';
    location.reload();
  });
  overlay.appendChild(card);
  return overlay;
}

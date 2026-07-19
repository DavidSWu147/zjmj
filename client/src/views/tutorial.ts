import { GameAction, GameView } from '../../../shared/src/protocol';
import { net } from '../net';

/**
 * The tutorial overlay (v0.3): a linear script of steps over the rigged
 * server match. Info steps narrate and advance on "Next"; action steps
 * permit exactly one forced move (everything else is blocked in act());
 * wait steps auto-advance when the board reaches a scripted state. The
 * conditions mirror server/test/tutorial.test.ts, which proves the rigged
 * walls drive the bots through exactly these beats.
 */

interface Step {
  /** Narration; may reference the highlighted elements. */
  text: string;
  /** Info step: shows a Next button and blocks all input. */
  next?: boolean;
  /** Action step: the one player move this step permits. */
  allow?: (a: GameAction, v: GameView) => boolean;
  /** Auto-advance once this holds (checked on every server view). */
  until?: (v: GameView) => boolean;
  /** Next also advances the match past the scoring screen (v0.2.1 #12);
   *  the button appears only once the scoring screen is up. */
  advanceGame?: boolean;
  /** Next exits the tutorial (final step, over the standings screen). */
  exit?: boolean;
  /** CSS selectors glowing while the step is active. */
  highlight?: string[];
}

const my = (v: GameView) => v.seats[v.mySeat];
const discarded = (v: GameView, tile: string, n = 1) =>
  my(v).discards.filter((d) => d.tile === tile).length >= n;
const melds = (v: GameView) => my(v).melds;
const kongs = (v: GameView) => melds(v).filter((m) => m.kind === 'kong').length;
const myTurn = (v: GameView) =>
  v.phase === 'preDiscard' && v.turnSeat === v.mySeat && !!v.myOptions.discard;

const allowDiscard =
  (tile: string) =>
  (a: GameAction): boolean =>
    a.kind === 'discard' && a.tile === tile;
const allowClaim =
  (claim: 'pung' | 'kong' | 'mahjong') =>
  (a: GameAction): boolean =>
    a.kind === 'claim' && a.claim === claim;

const info = (text: string, highlight?: string[]): Step => ({ text, next: true, highlight });
const wait = (text: string, until: (v: GameView) => boolean): Step => ({ text, until });

const HAND = (t: string) => `.hand-area [data-t="${t}"]`;
/** Highlights only the LAST matching tile (e.g. the 2nd C5 of a pair). */
const HAND_LAST = (t: string) => `${HAND(t)}::last`;

const STEPS: Step[] = [
  // ── Game E1: the basics ─────────────────────────────────────────────
  info(
    'Welcome to Mahjong! Four players share a wall of 136 tiles: three number ' +
      'suits — Bamboo, Characters, and Dots, each running 1–9 — plus the honor ' +
      'tiles: four Winds (East, South, West, North) and three Dragons (Red, ' +
      'Green, White). There are exactly 4 copies of every tile.',
  ),
  info(
    'If the Chinese tile faces are unfamiliar, open Settings (the gear, top ' +
      'left) at any time and turn on “English indices” — Character and Wind ' +
      'tiles then show a small index in their corner, where it is needed ' +
      'most (Bamboo and Dot ranks are countable at a glance — though note ' +
      'the 1 Bamboo is traditionally drawn as a bird!). Settings also lets ' +
      'you restyle the tile faces, tile backs, and table felt to your ' +
      'liking. The ? button reopens the pattern tables.',
    ['.top-btn.gear'],
  ),
  info(
    'This is your hand of 13 tiles. The goal: four SETS and a PAIR — 14 tiles ' +
      'counting the winning one. A set is a TRIPLET (three identical tiles — ' +
      'you hold N N N) or a SEQUENCE (three consecutive tiles of one suit — ' +
      'your Characters 5-6-7). You also hold a PAIR of Dot 1s.',
    [HAND('N '), HAND_LAST('C5'), HAND('C6'), HAND('C7'), HAND('D1')],
  ),
  info(
    'The dial in the middle shows the game number and the count of tiles left ' +
      'in the wall. On your turn you draw one tile, then discard one — play ' +
      'moves counter-clockwise.',
    ['.ccircle'],
  ),
  {
    text:
      'You drew Bamboo 7 — useful! The lone South wind is not: you can never ' +
      'make sequences with honors, only pairs, or triplets which are less ' +
      'likely. Discard S: click it once to lift it, then click again to ' +
      'confirm.',
    allow: allowDiscard('S '),
    until: (v) => discarded(v, 'S '),
    highlight: [HAND('S ')],
  },
  wait('The bots take their turns — watch the discards pile up in the middle…', (v) =>
    !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'D1',
  ),
  info(
    'ChickenBot1 just discarded a Dot 1 — and you hold two! You may PUNG: ' +
      'claim any player’s discard to complete a triplet. The claimed set is ' +
      'laid face-up; open melds stay on the table for everyone to see.',
  ),
  {
    text: 'Click PUNG to claim the Dot 1.',
    allow: allowClaim('pung'),
    until: (v) => v.pendingClaim?.kind === 'pung',
    highlight: ['.action-btn.pung'],
  },
  {
    text: 'After a claim you still discard. The lone Dot 2 does the least work — discard it.',
    allow: allowDiscard('D2'),
    until: (v) => melds(v).some((m) => m.kind === 'pung'),
    highlight: [HAND('D2')],
  },
  wait('Play continues…', (v) => (v.myOptions.claim?.chows ?? []).includes('B1')),
  info(
    'ChickenBot3 discarded a Bamboo 2 — you hold B1 and B3. You may CHOW: ' +
      'claim a discard to complete a SEQUENCE. Unlike Pung, a Chow may only ' +
      'take from the player on your LEFT.',
  ),
  {
    text: 'Click CHOW to claim the Bamboo 2.',
    allow: (a) => a.kind === 'claim' && a.claim === 'chow' && a.chowLow === 'B1',
    until: (v) => v.pendingClaim?.kind === 'chow',
    highlight: ['.action-btn.chow'],
  },
  {
    text:
      'Now discard Bamboo 7. That leaves you READY: either Character 5 or ' +
      'Character 8 completes your hand. (Discarding C5 instead would wait ' +
      'only on B7 — half the winning chances.)',
    allow: allowDiscard('B7'),
    until: (v) => melds(v).length === 2,
    highlight: [HAND('B7')],
  },
  wait('You are ready. Wait for a winning tile…', (v) => !!v.myOptions.claim?.mahjong),
  {
    text: 'ChickenBot1 discarded Character 8 — your hand is complete. Click MAHJONG!',
    allow: allowClaim('mahjong'),
    until: (v) => v.gameResult !== null || v.phase === 'gameEnd',
    highlight: ['.action-btn.mahjong'],
  },
  {
    text:
      'You won! But with no scoring pattern this is a CHICKEN HAND — worth a ' +
      'measly 1 point, paid by all three opponents. Winning is good; winning ' +
      'with PATTERNS is far better. Click Next when you are ready for the ' +
      'second game.',
    next: true,
    advanceGame: true,
  },

  // ── Game E2: claim precedence and Kongs ─────────────────────────────
  wait(
    'Seats rotate every game — you now sit North. Watch the first discards…',
    (v) => !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'B9',
  ),
  info(
    'ChickenBot2 discarded Bamboo 9. The bot on its right wants to CHOW it — ' +
      'but you hold B9 B9 and can PUNG. When claims clash, PUNG BEATS CHOW ' +
      '(and MAHJONG beats both). Your claim will snatch the tile away.',
  ),
  {
    text: 'Click PUNG.',
    allow: allowClaim('pung'),
    until: (v) => v.pendingClaim?.kind === 'pung',
    highlight: ['.action-btn.pung'],
  },
  {
    text: 'Discard the lone Red Dragon.',
    allow: allowDiscard('R '),
    until: (v) => melds(v).some((m) => m.kind === 'pung'),
    highlight: [HAND('R ')],
  },
  wait('Play continues…', (v) => myTurn(v) && v.myDrawn === 'R '),
  {
    text:
      'Ha — you drew the very Red Dragon you just discarded! It happens all ' +
      'the time in Mahjong. Discard it again.',
    allow: allowDiscard('R '),
    until: (v) => discarded(v, 'R ', 2),
    highlight: [HAND('R ')],
  },
  wait('Play continues…', (v) => (v.myOptions.claim?.chows ?? []).includes('D4')),
  info(
    'ChickenBot3 discarded a Dot 5, and you can Chow it two ways: 3-4-5 or ' +
      '4-5-6. When a claim is ambiguous you choose the shape.',
  ),
  {
    text: 'Click CHOW, then pick the 4-5-6 sequence.',
    allow: (a) => a.kind === 'claim' && a.claim === 'chow' && a.chowLow === 'D4',
    until: (v) => v.pendingClaim?.kind === 'chow',
    highlight: ['.action-btn.chow'],
  },
  {
    text: 'Discard Bamboo 5. You are ready again — Dot 2 would finish the hand. Or would it…',
    allow: allowDiscard('B5'),
    until: (v) => melds(v).length === 2,
    highlight: [HAND('B5')],
  },
  wait('Play continues…', (v) => myTurn(v) && v.myDrawn === 'C4'),
  info(
    'You drew the FOURTH Character 4! Four identical tiles can form a KONG. ' +
      'A CONCEALED Kong from your own hand turns the two tiles on the ends ' +
      'face down, ' +
      'counts as a concealed triplet, and every Kong scores a pattern (One ' +
      'Kong: 5 points). A Kong draws a replacement tile from the dead wall.',
  ),
  {
    text: 'Click KONG.',
    allow: (a) => a.kind === 'kong' && a.tile === 'C4' && a.variant === 'concealed',
    until: (v) => kongs(v) >= 1,
    highlight: ['.action-btn.kong'],
  },
  {
    text:
      'Your replacement draw is a third South wind! Discard the Dot 3: ' +
      'although there is one less copy of D1 than D2 out there, with S S S ' +
      'in hand you hold TWO concealed triplets (worth 5 points — and a ' +
      'concealed Kong counts as one too).',
    allow: allowDiscard('D3'),
    until: (v) => discarded(v, 'D3'),
    highlight: [HAND('D3')],
  },
  wait('Play continues…', (v) => !!v.myOptions.claim?.kong && v.lastDiscard?.tile === 'S '),
  info(
    'ChickenBot1 discarded the FOURTH South wind — and you hold S S S. ' +
      'Claiming a discard onto a concealed triplet makes a BIG EXPOSED KONG. ' +
      'Although it is no longer concealed, all Kongs are still considered ' +
      'triplets.',
  ),
  {
    text: 'Click KONG to claim it.',
    allow: allowClaim('kong'),
    until: (v) => kongs(v) >= 2,
    highlight: ['.action-btn.kong'],
  },
  wait('Another replacement tile comes off the dead wall…', (v) =>
    myTurn(v) && (v.myOptions.kongs ?? []).some((k) => k.tile === 'B9' && k.variant === 'small'),
  ),
  info(
    'The dead wall gives you the fourth Bamboo 9 — and your B9 Pung is already ' +
      'on the table. Adding the fourth tile upgrades it to a SMALL EXPOSED ' +
      'KONG. Beware: unlike a concealed Kong, this one can be ROBBED — an ' +
      'opponent who could win on B9 may steal it for the win!',
  ),
  {
    text: 'Click KONG. (Nobody is waiting on B9 — this one is safe.)',
    allow: (a) => a.kind === 'kong' && a.tile === 'B9' && a.variant === 'small',
    until: (v) => kongs(v) >= 3,
    highlight: ['.action-btn.kong'],
  },
  wait('One more replacement draw…', (v) => myTurn(v) && !!v.myOptions.mahjong),
  {
    text:
      'The replacement is Dot 1 — pairing your last tile. Click MAHJONG: a ' +
      'SELF-DRAWN win, straight off the Kong replacement!',
    allow: (a) => a.kind === 'mahjong',
    until: (v) => v.gameResult !== null || v.phase === 'gameEnd',
    highlight: ['.action-btn.mahjong'],
  },
  {
    text:
      'A humongous 130-point hand: Three Kongs (120) plus Win on Kong (10). ' +
      'On a self-drawn win, every opponent pays the full value — 130 each! ' +
      'Click Next to continue.',
    next: true,
    advanceGame: true,
  },

  // ── Game E3: Mixed One-Suit and the par score ───────────────────────
  info(
    'Game 3 — you sit West now. Look at your hand: almost every tile is ' +
      'Bamboo! A hand of one suit plus honors scores MIXED ONE-SUIT, worth 40 ' +
      'points. Let’s go for it: keep Bamboo and honors, shed everything else.',
  ),
  wait('Your turn is coming…', (v) => myTurn(v) && v.myDrawn === 'B9'),
  {
    text: 'You drew Bamboo 9. Discard the off-suit Character 5.',
    allow: allowDiscard('C5'),
    until: (v) => discarded(v, 'C5'),
    highlight: [HAND('C5')],
  },
  wait('Play continues…', (v) => myTurn(v) && v.myDrawn === 'B9'),
  {
    text: 'Another Bamboo 9! Now discard the Dot 3.',
    allow: allowDiscard('D3'),
    until: (v) => discarded(v, 'D3'),
    highlight: [HAND('D3')],
  },
  wait('Play continues…', (v) => !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'E '),
  info(
    'ChickenBot1 discarded an East wind — you hold E E. Pung it! A wind ' +
      'triplet scores extra only if it is YOUR seat wind, and you sit West, ' +
      'so this one adds nothing by itself — but it feeds the hand, and honors ' +
      'go with any suit for the purposes of Mixed One-Suit.',
  ),
  {
    text: 'Click PUNG.',
    allow: allowClaim('pung'),
    until: (v) => v.pendingClaim?.kind === 'pung',
    highlight: ['.action-btn.pung'],
  },
  {
    text:
      'Discard the Dot 8 — your last off-suit tile. You are READY: another ' +
      'Bamboo 3 or Bamboo 6 completes the pair.',
    allow: allowDiscard('D8'),
    until: (v) => melds(v).length === 1 && discarded(v, 'D8'),
    highlight: [HAND('D8')],
  },
  wait('Wait for the winning tile…', (v) => !!v.myOptions.claim?.mahjong),
  {
    text: 'ChickenBot3 dropped a Bamboo 6 — click MAHJONG!',
    allow: allowClaim('mahjong'),
    until: (v) => v.gameResult !== null || v.phase === 'gameEnd',
    highlight: ['.action-btn.mahjong'],
  },
  {
    text:
      'Mixed One-Suit: 40 points. Now watch the payments — Zung Jung’s PAR ' +
      'SCORE is 25. Small hands (like your 1-point chicken hand) are paid ' +
      'equally by all three opponents. Above par, the two bystanders pay ' +
      'only 25 each and the DISCARDER shoulders the rest: 70 here. Careless ' +
      'discards are expensive! Click Next for the final game.',
    next: true,
    advanceGame: true,
  },

  // ── Game E4: the irregular hands ────────────────────────────────────
  info(
    'Last game! Two special hands ignore the 4-sets-and-a-pair rule. SEVEN ' +
      'PAIRS (30 points): seven pairs — your opponents have secretly ' +
      'been chasing it all tutorial. And THIRTEEN TERMINALS (160): one of ' +
      'every 1, every 9, and every honor, plus a duplicate of any of them.',
  ),
  info(
    'Look at your starting hand of 13 tiles: eleven of the thirteen ' +
      'already! You are missing ' +
      'Character 9 and the East wind. Never discard your unique terminals or ' +
      'honors — each one is irreplaceable now.',
  ),
  wait('Your turn is coming…', (v) => myTurn(v) && v.myDrawn === 'C9'),
  {
    text: 'You drew Character 9! Discard the Character 4.',
    allow: allowDiscard('C4'),
    until: (v) => discarded(v, 'C4'),
    highlight: [HAND('C4')],
  },
  wait('Play continues…', (v) => myTurn(v) && v.myDrawn === 'E '),
  {
    text:
      'The East wind — your thirteenth! Discard Character 7. You now hold all ' +
      '13 uniques: if ANY of them pairs up you win. A thirteen-way wait!',
    allow: allowDiscard('C7'),
    until: (v) => discarded(v, 'C7'),
    highlight: [HAND('C7')],
  },
  wait('Wait for any of the thirteen…', (v) => myTurn(v) && !!v.myOptions.mahjong),
  {
    text: 'A second Character 1 — click MAHJONG! Thirteen Terminals, 160 points.',
    allow: (a) => a.kind === 'mahjong',
    until: (v) => v.gameResult !== null || v.phase === 'gameEnd',
    highlight: ['.action-btn.mahjong'],
  },
  {
    text:
      'Thirteen Terminals — 160 points, self-drawn, so everyone pays in ' +
      'full. Click Next to see the final standings.',
    next: true,
    advanceGame: true,
  },
  {
    text:
      'That’s the tutorial — you won every game! You can replay it from the ' +
      'Help page any time. When you are ready, play real matches from the ' +
      'Lobby (bots fill the empty seats), and register an account to earn ' +
      'achievements and enter the Saturday tournaments. Good luck!',
    next: true,
    exit: true,
  },
];

let active = false;
let stepIdx = 0;

export function tutorialStart(): void {
  active = true;
  stepIdx = 0;
}

export function tutorialStop(): void {
  active = false;
}

export function tutorialActive(): boolean {
  return active;
}

/** act() consults this: only the current step's forced move goes through. */
export function tutorialAllows(a: GameAction, v: GameView): boolean {
  if (!active) return true;
  if (a.kind === 'select') return true; // lifting tiles is always harmless
  return !!STEPS[stepIdx]?.allow?.(a, v);
}

/**
 * Whether an action-bar button may react at all (v0.2.1 #6): a button whose
 * every possible action the current step blocks does nothing — it must not
 * even open the chow/kong variant chooser.
 */
export function tutorialAllowsButton(kind: string, v: GameView): boolean {
  if (!active) return true;
  const allow = STEPS[stepIdx]?.allow;
  if (!allow) return false;
  const probes: GameAction[] = [];
  if (kind === 'chow') {
    for (const low of v.myOptions.claim?.chows ?? []) {
      probes.push({ kind: 'claim', claim: 'chow', chowLow: low });
    }
  } else if (kind === 'pung') {
    probes.push({ kind: 'claim', claim: 'pung' });
  } else if (kind === 'kong') {
    probes.push({ kind: 'claim', claim: 'kong' });
    for (const k of v.myOptions.kongs ?? []) {
      probes.push({ kind: 'kong', tile: k.tile, variant: k.variant });
    }
  } else if (kind === 'mahjong') {
    probes.push({ kind: 'mahjong' }, { kind: 'claim', claim: 'mahjong' });
  } else if (kind === 'pass') {
    probes.push({ kind: 'claim', claim: 'pass' });
  }
  return probes.some((p) => allow(p, v));
}

/**
 * Called at the end of every board render of a tutorial view: advances
 * through satisfied wait-steps, then draws the instruction panel and the
 * highlights into the freshly built board.
 */
export function tutorialOnRender(
  view: GameView,
  board: HTMLElement,
  hooks: { rerender: () => void; exit: () => void },
): void {
  if (!active) return;
  for (let guard = 0; guard < STEPS.length; guard++) {
    const s = STEPS[stepIdx];
    if (s?.until && s.until(view)) stepIdx++;
    else break;
  }
  const step = STEPS[stepIdx];
  if (!step) return;

  const panel = document.createElement('div');
  panel.className = 'tutorial-panel';
  // Position (v0.2.1 fix): sit just right of the left opponent's strip,
  // narrow enough to stay clear of the pinwheel's left wall band, and above
  // everything at the bottom (the player's wall band and hand) — all
  // measured from the freshly rendered board.
  const W = board.clientWidth || window.innerWidth;
  const H = board.clientHeight || window.innerHeight;
  const bRect = board.getBoundingClientRect();
  // Left edge: just right of the left opponent's strip — at most the fixed
  // 96px, but tighter on small screens where the strip is narrower
  // (v0.2.2 #3: on mobile the panel started too far right).
  let left = 96;
  for (const el of board.querySelectorAll('.opp-hand')) {
    const r = el.getBoundingClientRect();
    const midX = r.left + r.width / 2 - bRect.left;
    const midY = r.top + r.height / 2 - bRect.top;
    if (midX < W / 4 && midY > H * 0.2 && midY < H * 0.8) {
      left = Math.min(left, r.right - bRect.left + 10);
    }
  }
  // Width: capped by the leftmost wall/discard column in the board's left
  // half (the vertical left wall band, when walls are drawn) — and always
  // by the central control panel, which the left column's discards may not
  // yet reach (v0.2.2 #3).
  let rightLimit = left + Math.min(360, W * 0.34);
  const cpanel = board.querySelector('.cpanel');
  if (cpanel) {
    rightLimit = Math.min(rightLimit, cpanel.getBoundingClientRect().left - bRect.left - 12);
  }
  for (const el of board.querySelectorAll('.discard-zone .tor')) {
    const r = el.getBoundingClientRect();
    const midX = r.left + r.width / 2 - bRect.left;
    const midY = r.top + r.height / 2 - bRect.top;
    if (midX < W / 2 && midY > H * 0.25 && midY < H * 0.8) {
      rightLimit = Math.min(rightLimit, r.left - bRect.left - 12);
    }
  }
  const width = Math.max(160, rightLimit - left);
  panel.style.left = `${left}px`;
  panel.style.width = `${width}px`;
  // Bottom: above anything occupying the panel's horizontal span — and
  // never below the hand row's worst-case top: the floor assumes a small
  // exposed kong's pocket (two upright short sides deep) even when none is
  // melded, so the panel fully clears the hand with room to spare
  // (v0.2.2 #3).
  let limit = H - 16;
  for (const el of board.querySelectorAll('.discard-zone .tor, .hand-area, .opp-hand')) {
    const r = el.getBoundingClientRect();
    const top = r.top - bRect.top;
    const l = r.left - bRect.left;
    const rgt = r.right - bRect.left;
    if (top > H * 0.5 && l < left + width && rgt > left) limit = Math.min(limit, top);
  }
  const hand = board.querySelector('.hand-area');
  if (hand) {
    const tw = Math.min(W / 21, H * 0.075); // own tile width (mirrors game.ts)
    const r = hand.getBoundingClientRect();
    limit = Math.min(limit, r.top - bRect.top, r.bottom - bRect.top - (2 * tw + 1));
  }
  panel.style.bottom = `${H - limit + 20}px`;
  const body = document.createElement('div');
  body.className = 'tp-text';
  body.textContent = step.text;
  panel.appendChild(body);
  // A game-advancing Next appears only once its scoring/standings screen is
  // up (v0.2.1 #12) — never during the win-flash pause.
  const gatedAway =
    (step.advanceGame && view.gameResult === null && view.matchResult === null) ||
    (step.exit && view.matchResult === null);
  if (step.next && !gatedAway) {
    const btn = document.createElement('button');
    btn.className = 'tp-next';
    btn.textContent = step.exit ? 'Finish ▸' : 'Next ▸';
    btn.addEventListener('click', () => {
      if (step.exit) {
        hooks.exit();
        return;
      }
      if (step.advanceGame) net.send({ type: 'tutorialNext' });
      stepIdx++;
      hooks.rerender();
    });
    panel.appendChild(btn);
  }
  const tag = document.createElement('div');
  tag.className = 'tp-tag';
  tag.textContent = `Tutorial · step ${stepIdx + 1}/${STEPS.length}`;
  panel.prepend(tag);
  board.appendChild(panel);

  for (const sel of step.highlight ?? []) {
    if (sel.endsWith('::last')) {
      const els = board.querySelectorAll(sel.slice(0, -'::last'.length));
      els[els.length - 1]?.classList.add('tutorial-glow');
    } else {
      board.querySelectorAll(sel).forEach((el) => el.classList.add('tutorial-glow'));
    }
  }
}

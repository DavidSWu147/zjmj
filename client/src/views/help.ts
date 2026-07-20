import { ADJUSTED_POINTS, OPTIONAL_PATTERN_IDS, PATTERN_IDS, PATTERNS } from '../../../shared/src/scoring';
import { Tile } from '../../../shared/src/tiles';
import { net } from '../net';
import { tileSrc } from '../tileui';
import { tutorialStart } from './tutorial';

/**
 * Explanations for the standard patterns (v0.2.3 #1), following the official
 * "The Patterns in Zung Jung" text.
 */
const STANDARD_DESCS: Record<string, string> = {
  chicken: 'A winning hand that scores no patterns at all. Whether it is allowed, and its value, depend on the room settings.',
  '1.1': 'The hand contains 4 sequences; no triplets/kong. There are no other restrictions as to the eyes pair, single call, or concealed hand.',
  '1.2': 'A regular hand which is concealed, without melding any exposed sets before winning. Winning on discard is okay. Concealed kong are okay.',
  '1.3': 'The hand consists entirely of middle number tiles (2 to 8); no terminals or honors.',
  '2.1.1': 'The hand consists entirely of number tiles in one suit, plus honor tiles.',
  '2.1.2': 'The hand consists entirely of number tiles in one suit.',
  '2.2': 'A 9-way call hand, with “1112345678999” in one suit in your hand, and winning on any one tile in the same suit.',
  '3.1R': 'A triplet/kong of Red Dragons.',
  '3.1G': 'A triplet/kong of Green Dragons.',
  '3.1O': 'A triplet/kong of White Dragons.',
  '3.1S': 'A triplet/kong of your Seat Wind (your own Wind). In Zung Jung the Prevailing Wind is not recognized.',
  '3.2.1': 'Two triplet/kong of Dragons, plus a pair of Dragons as the eyes. This hand always includes two Dragon triplets, so it scores at least 40+10+10 = 60 points.',
  '3.2.2': 'Three triplet/kong of Dragons. This hand always includes three Dragon triplets, so it scores at least 130+10+10+10 = 160 points.',
  '3.3.1': 'Two triplet/kong of Winds, plus a pair of Winds as the eyes.',
  '3.3.2': 'Three triplet/kong of Winds.',
  '3.3.3': 'Three triplet/kong of Winds, plus a pair of Winds as the eyes.',
  '3.3.4': 'Four triplet/kong of Winds.',
  '3.4': 'The hand consists entirely of honor tiles.',
  '4.1': 'The hand contains 4 sets of triplets/kong; no sequences.',
  '4.2.1': 'The hand contains two concealed triplets/concealed kong.',
  '4.2.2': 'The hand contains three concealed triplets/concealed kong.',
  '4.2.3': 'The hand contains four concealed triplets/concealed kong.',
  '4.3.1': 'The hand contains one kong — irrespective of whether it is exposed or concealed (same below).',
  '4.3.2': 'The hand contains two kong.',
  '4.3.3': 'The hand contains three kong.',
  '4.3.4': 'The hand contains four kong.',
  '5.1.1': 'Two sequences in the same suit in the same numbers. (Identical sets are sets in the same suit in the same numbers; only sequences can be identical.)',
  '5.1.2': 'The hand contains two groups of “Two Identical Sequences”.',
  '5.1.3': 'Three sequences in the same suit in the same numbers.',
  '5.1.4': 'Four sequences in the same suit in the same numbers.',
  '6.1': 'Three sequences in the same numbers across three different suits. (In Zung Jung all 3 suits must be present; 2-suit patterns are not recognized.)',
  '6.2.1': 'Two triplets/kong in the same number in two different suits, and the eye pair in the same number in the third suit.',
  '6.2.2': 'Three triplets/kong in the same number across three different suits.',
  '7.1': 'A “123” sequence, a “456” sequence, and a “789” sequence, all in the same suit. The hand must contain exactly the three sequences listed.',
  '7.2.1': 'Three triplets/kong in consecutive numbers in the same suit.',
  '7.2.2': 'Four triplets/kong in consecutive numbers in the same suit.',
  '8.1.1': 'Every one of the 4 sets in the hand, as well as the pair of eyes, includes a terminal tile (a 1 or 9) or an honor tile.',
  '8.1.2': 'Every one of the 4 sets in the hand, as well as the pair of eyes, includes a terminal number tile (a 1 or 9).',
  '8.1.3': 'An “All Triplets” or “Seven Pairs” hand which consists entirely of terminal tiles and honor tiles. (Not applicable to a “Thirteen Terminals” hand.)',
  '8.1.4': 'The hand consists entirely of terminal number tiles.',
  '9.1.1': 'Self-draw win on the “seabed” tile (the last tile in the wall, excluding the king’s tiles).',
  '9.1.2': 'Winning on a discarded “riverbed” tile (the last discard by the player who has drawn the seabed tile).',
  '9.2': 'Self-draw win on a “supplement” tile (after declaring a kong). If the supplement tile is also the seabed tile, both patterns can be counted.',
  '9.3': 'Winning by robbing a kong (when another player makes a “small exposed kong”).',
  '9.4.1': 'East winning with his initial 14-tile hand. (This pattern is invalid if East has made a concealed kong.)',
  '9.4.2': 'A non-East player calling with his initial 13-tile hand, and winning on East’s very first discard. (Invalid if East has made a concealed kong.)',
  '10.1': 'Among the 13 types of terminals and honors, the hand contains one pair of one type, and one tile each of the other 12 types. (Irregular hands do not count for “Concealed Hand”.)',
  '10.2': 'The hand consists of seven pairs. Four identical tiles can count as two pairs as long as kong is not declared. A Seven Pairs hand cannot count patterns which specifically require triplets, kong, or sequences, but can count other patterns without such requirements.',
};

/**
 * Example hands, exactly the ones illustrated in the official pattern text:
 * comma-separated sets; a trailing '*' / '+' reproduces the doc's
 * "(eyes)" / "(eye)" label on that set.
 */
const EXAMPLES: Record<string, string> = {
  '3.2.1': 'O O O, R R R, G G*',
  '3.2.2': 'O O O, G G G, R R R',
  '3.3.1': 'W W W, N N N, E E*',
  '3.3.2': 'E E E, S S S, N N N',
  '3.3.3': 'E E E, W W W, N N N, S S*',
  '3.3.4': 'E E E, S S S, W W W, N N N',
  '5.1.1': 'D3 D4 D5, D3 D4 D5',
  '5.1.2': 'D3 D4 D5, D3 D4 D5, C7 C8 C9, C7 C8 C9',
  '5.1.3': 'D3 D4 D5, D3 D4 D5, D3 D4 D5',
  '5.1.4': 'D3 D4 D5, D3 D4 D5, D3 D4 D5, D3 D4 D5',
  '6.1': 'D3 D4 D5, B3 B4 B5, C3 C4 C5',
  '6.2.1': 'D4 D4 D4, C4 C4 C4, B4 B4+',
  '6.2.2': 'D4 D4 D4, C4 C4 C4, B4 B4 B4',
  '7.1': 'C1 C2 C3, C4 C5 C6, C7 C8 C9',
  '7.2.1': 'C4 C4 C4, C5 C5 C5, C6 C6 C6',
  '7.2.2': 'C4 C4 C4, C5 C5 C5, C6 C6 C6, C7 C7 C7',
  '8.1.1': 'B1 B1 B1, C1 C2 C3, D7 D8 D9, R R R, C9 C9',
  '8.1.2': 'B1 B2 B3, C1 C1 C1, C7 C8 C9, D9 D9 D9, B1 B1',
  '8.1.3': 'B9 B9 B9, C1 C1 C1, W W W, G G G, D1 D1',
  '8.1.4': 'B1 B1 B1, C9 C9 C9, D1 D1 D1, D9 D9 D9, B9 B9',
  '10.2': 'B2 B2, C6 C6, D1 D1, D7 D7, O O, W W, N N',
  // Optional patterns (1.4 has no example in the doc).
  '2.3': 'B3 B4 B5, D7 D8 D9, S S S, G G G, C6 C6',
  '8.2': 'B1 B1 B1, C2 C2 C2, D8 D8 D8, B9 B9 B9, C8 C8',
  '8.3': 'B1 B2 B3, C5 C6 C7, D9 D9 D9, W W W, B4 B4',
};

/**
 * Renders an example hand. The tiles deliberately carry no data-t: help
 * illustrations neither trigger nor receive the same-tile hover highlight
 * (v0.2.3 #1).
 */
function exHtml(spec: string, cls = ''): string {
  const sets = spec.split(',').map((g) => {
    let s = g.trim();
    const label = s.endsWith('*') ? '(eyes)' : s.endsWith('+') ? '(eye)' : null;
    if (label) s = s.slice(0, -1).trim();
    const imgs = s
      .split(/\s+/)
      .map((code) => {
        const t = (code.length === 1 ? `${code} ` : code) as Tile;
        return `<span class="tile"><img src="${tileSrc(t)}" alt="${code}" draggable="false"></span>`;
      })
      .join('');
    return `<span class="ex-set">${imgs}${label ? `<span class="ex-eyes">${label}</span>` : ''}</span>`;
  });
  return `<div class="help-ex${cls ? ` ${cls}` : ''}">${sets.join('')}</div>`;
}

/** The four optional patterns (playable under "Adjusted Scoring with Extra Patterns"). */
const OPTIONAL_PATTERNS: { id: string; name: string; zh: string; points: number; desc: string }[] = [
  {
    id: '1.4', name: 'Two Suits Only', zh: '缺一門', points: 5,
    desc: 'Only tiles from two of the number suits: no third suit, no honors. Compatible with Seven Pairs.',
  },
  {
    id: '2.3', name: 'Five Suits', zh: '五門齊', points: 20,
    desc: 'All three number suits, plus winds and dragons — the four melds and pair each from a different “suit”. Incompatible with Thirteen Terminals and Seven Pairs.',
  },
  {
    id: '8.2', name: 'All Edge Tiles', zh: '全邊張', points: 125,
    desc: 'Only number tiles 1, 2, 8, and 9; no honors, so no sequences are possible. Compatible with Seven Pairs.',
  },
  {
    id: '8.3', name: 'Four Unlike', zh: '四不像', points: 10,
    desc: 'One meld with a 1, one meld with a 9, one middle-number meld, and one wind or dragon meld. With a wind meld the pair must not be winds or a number already used by a sequence meld (dragons always OK); with a dragon meld the pair must be your Seat Wind or a number not used by a sequence meld. Incompatible with Seven Pairs.',
  },
];

/** Bonus tile (flowers & seasons) patterns — category 11, all cumulative. */
const BONUS_PATTERNS: { id: string; name: string; zh: string; points: string; desc: string }[] = [
  {
    id: '11.1.1', name: 'Improper Flower/Season', zh: '偏花', points: '2 per tile',
    desc: 'A flower/season tile not proper to your seat.',
  },
  {
    id: '11.1.2', name: 'Proper Flower/Season', zh: '正花', points: '4 per tile',
    desc: 'Your seat’s own flower/season: East 1 (Plum/Spring), South 2 (Orchid/Summer), West 3 (Chrysanthemum/Autumn), North 4 (Bamboo/Winter).',
  },
  {
    id: '11.2.1', name: 'Four Flowers', zh: '齊四花', points: '10',
    desc: 'The complete set of all 4 Flower tiles.',
  },
  {
    id: '11.2.2', name: 'Four Seasons', zh: '齊四季', points: '10',
    desc: 'The complete set of all 4 Season tiles.',
  },
];

const ADJUSTED_CHANGES: { id: string; from: number; to: number }[] = Object.entries(
  ADJUSTED_POINTS,
).map(([id, to]) => ({ id, from: PATTERNS[id].points, to }));

type Tab = 'standard' | 'optional' | 'bonus';

/**
 * The tabbed help content (pattern tables), shared by the Help page and the
 * in-match Help panel. `tabsInto` hosts the tab buttons (e.g. the page head);
 * defaults to the top of `body` itself.
 */
export function buildHelpContent(body: HTMLElement, tabsInto?: HTMLElement): void {
  const tabRow = document.createElement('div');
  tabRow.className = 'help-tabs';
  tabRow.innerHTML = `
    <button data-tab="standard">Zung Jung Patterns 中庸牌型</button>
    <button data-tab="optional">Optional Patterns 選用牌型</button>
    <button data-tab="bonus">Bonus Tiles 花牌</button>
  `;
  const content = document.createElement('div');
  (tabsInto ?? body).appendChild(tabRow);
  body.appendChild(content);
  const tabs = tabRow.querySelectorAll<HTMLButtonElement>('button');

  const show = (tab: Tab) => {
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'standard') content.innerHTML = standardHtml();
    else if (tab === 'optional') content.innerHTML = optionalHtml();
    else content.innerHTML = bonusHtml();
    body.scrollTop = 0;
  };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
  show('standard');
}

export function renderHelp(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Help 說明</h1>
      <span class="spacer"></span>
      <div id="tabs-slot"></div>
    </div>
    <div class="page-body" id="body"></div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  buildHelpContent(
    el.querySelector<HTMLElement>('#body')!,
    el.querySelector<HTMLElement>('#tabs-slot')!,
  );
  // The tutorial launcher (v0.3) leads the tab row — Help page only, never
  // the in-match panel (players must not abandon a live match for it).
  const tut = document.createElement('button');
  tut.className = 'tutorial-btn';
  tut.textContent = 'Tutorial 教學';
  tut.title = 'Learn how to play Mahjong in a guided practice match';
  tut.addEventListener('click', () => {
    tutorialStart();
    net.send({ type: 'startTutorial' });
    location.hash = '#/play';
  });
  el.querySelector('.help-tabs')!.prepend(tut);
  root.appendChild(el);
}

function standardHtml(): string {
  // Only the standard Zung Jung table: the optional patterns and the bonus
  // tile (category 11) patterns live on their own tabs.
  const orderedIds = [
    'chicken',
    ...PATTERN_IDS.filter(
      (id) =>
        id !== 'chicken' &&
        !(OPTIONAL_PATTERN_IDS as readonly string[]).includes(id) &&
        !id.startsWith('11.'),
    ),
  ];
  const rows = orderedIds
    .map((id) => {
      const p = PATTERNS[id];
      const desc = STANDARD_DESCS[id];
      const ex = EXAMPLES[id];
      return `<tr>
        <td style="color:var(--text-dim)">${id === 'chicken' ? '0.0' : id}</td>
        <td>${p.name}</td>
        <td style="color:var(--text-dim)">${p.zh}</td>
        <td class="num">${p.points}</td>
      </tr>${
        desc || ex
          ? `<tr><td></td><td colspan="3" class="desc">${desc ?? ''}${ex ? exHtml(ex) : ''}</td></tr>`
          : ''
      }`;
    })
    .join('');
  return `
    <div class="help-note">The standard Zung Jung (中庸) scoring table. Chicken Hand's value
      and the par score depend on the room settings.</div>
    <table class="data" style="max-width:760px">
      <tr><th>#</th><th>Pattern</th><th></th><th class="num">Points</th></tr>
      ${rows}
    </table>`;
}

function optionalHtml(): string {
  const rows = OPTIONAL_PATTERNS.map(
    (p) => `<tr>
      <td style="color:var(--text-dim)">${p.id}</td>
      <td>${p.name}</td>
      <td style="color:var(--text-dim)">${p.zh}</td>
      <td class="num">${p.points}</td>
    </tr>
    <tr><td></td><td colspan="3" class="desc">${p.desc}${EXAMPLES[p.id] ? exHtml(EXAMPLES[p.id]) : ''}</td></tr>`,
  ).join('');
  const changes = ADJUSTED_CHANGES.map((c) => {
    const p = PATTERNS[c.id];
    return `<tr>
      <td style="color:var(--text-dim)">${c.id}</td>
      <td>${p.name}</td>
      <td style="color:var(--text-dim)">${p.zh}</td>
      <td class="num">${c.from} → ${c.to}</td>
    </tr>`;
  }).join('');
  return `
    <div class="help-note">Four extra patterns playable with the
      <b>Adjusted Scoring with Extra Patterns</b> room option. Adjusted Scoring also
      re-values a few standard patterns, listed below.</div>
    <table class="data" style="max-width:760px">
      <tr><th>#</th><th>Pattern</th><th></th><th class="num">Points</th></tr>
      ${rows}
    </table>
    <h2 style="margin:22px 0 10px;font-size:16px">Adjusted point values 調整分值</h2>
    <table class="data" style="max-width:760px">
      <tr><th>#</th><th>Pattern</th><th></th><th class="num">Original → Adjusted</th></tr>
      ${changes}
    </table>`;
}

function bonusHtml(): string {
  const rows = BONUS_PATTERNS.map(
    (p) => `<tr>
      <td style="color:var(--text-dim)">${p.id}</td>
      <td>${p.name}</td>
      <td style="color:var(--text-dim)">${p.zh}</td>
      <td class="num">${p.points}</td>
    </tr>
    <tr><td></td><td colspan="3" class="desc">${p.desc}</td></tr>`,
  ).join('');
  return `
    <div class="help-note">Flowers and seasons are an optional room setting (off by default;
      can be worth half or full value). Bonus tiles are set aside and replaced from the dead
      wall. Their patterns form category 11 and are all cumulative with no exclusions.
      A hand with any bonus tiles is not a chicken hand — but if Chicken Hand is not allowed,
      bonus tiles alone are not enough: at least one pattern from the first 10 categories is
      required to declare Mahjong.</div>
    ${exHtml('F1 F2 F3 F4, A1 A2 A3 A4', 'help-ex-big')}
    <table class="data" style="max-width:760px">
      <tr><th>#</th><th>Pattern</th><th></th><th class="num">Points</th></tr>
      ${rows}
    </table>`;
}

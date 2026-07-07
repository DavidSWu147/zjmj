import { PATTERN_IDS, PATTERNS } from '../../../shared/src/scoring';

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
    desc: 'One meld with a 1, one meld with a 9, one middle-number meld, one wind meld; the pair must not be winds or a number already used by a sequence. Incompatible with Seven Pairs.',
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

const ADJUSTED_CHANGES: { id: string; from: number; to: number }[] = [
  { id: '2.1.2', from: 80, to: 90 },
  { id: '4.2.2', from: 30, to: 40 },
  { id: '5.1.2', from: 60, to: 70 },
  { id: '6.1', from: 35, to: 30 },
  { id: '8.1.2', from: 50, to: 60 },
  { id: '9.4.1', from: 155, to: 160 },
  { id: '9.4.2', from: 155, to: 160 },
];

type Tab = 'standard' | 'optional' | 'bonus';

export function renderHelp(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Help 說明</h1>
      <span class="spacer"></span>
      <div class="help-tabs">
        <button data-tab="standard">Zung Jung Patterns 中庸牌型</button>
        <button data-tab="optional">Optional Patterns 選用牌型</button>
        <button data-tab="bonus">Bonus Tiles 花牌</button>
      </div>
    </div>
    <div class="page-body" id="body"></div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  const body = el.querySelector<HTMLElement>('#body')!;
  const tabs = el.querySelectorAll<HTMLButtonElement>('.help-tabs button');

  const show = (tab: Tab) => {
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'standard') body.innerHTML = standardHtml();
    else if (tab === 'optional') body.innerHTML = optionalHtml();
    else body.innerHTML = bonusHtml();
    body.scrollTop = 0;
  };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
  show('standard');
  root.appendChild(el);
}

function standardHtml(): string {
  const orderedIds = ['chicken', ...PATTERN_IDS.filter((id) => id !== 'chicken')];
  const rows = orderedIds
    .map((id) => {
      const p = PATTERNS[id];
      return `<tr>
        <td style="color:var(--text-dim)">${id === 'chicken' ? '0.0' : id}</td>
        <td>${p.name}</td>
        <td style="color:var(--text-dim)">${p.zh}</td>
        <td class="num">${p.points}</td>
      </tr>`;
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
    <tr><td></td><td colspan="3" class="desc">${p.desc}</td></tr>`,
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
    <table class="data" style="max-width:760px">
      <tr><th>#</th><th>Pattern</th><th></th><th class="num">Points</th></tr>
      ${rows}
    </table>`;
}

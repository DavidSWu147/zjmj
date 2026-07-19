import { OPTIONAL_PATTERN_IDS, PATTERN_IDS, PATTERNS } from '../../../shared/src/scoring';
import { Tile } from '../../../shared/src/tiles';
import { apiGet, apiPost } from '../account';
import { net } from '../net';
import { tileEl } from '../tileui';

interface StatsResponse {
  patternCounts: Record<string, number>;
  matches: {
    played: Record<string, number>;
    finished: Record<string, number>;
    won: Record<string, number>;
    drawn: Record<string, number>;
  };
  games: {
    total: number;
    pointsWon: number;
    pointsLost: number;
    draws: number;
    selfDrawWins: number;
    wins: number;
    discarderCount: number;
    lostBySelfDraw: number;
    winValuesSelf: number[];
    winValuesDiscard: number[];
    dealInValues: number[];
    remainingSum: number;
    remainingCount: number;
    remainingWinsSum: number;
    remainingWinsCount: number;
  };
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits).replace(/\.00$/, '') : '—';
const avg = (xs: number[]): string => (xs.length ? fmt(xs.reduce((a, b) => a + b, 0) / xs.length) : '—');
const ratio = (sum: number, count: number): string => (count > 0 ? fmt(sum / count) : '—');
const pct = (num: number, den: number): string => (den > 0 ? `${((100 * num) / den).toFixed(1)}%` : '—');

/**
 * The v0.2 filter groups: "All" plus the three options of every gameplay
 * setting (thinking time excluded), with Match Type in its place.
 */
const FILTER_GROUPS: { key: string; label: string; opts: { v: string; label: string }[] }[] = [
  {
    key: 'len',
    label: 'Match Length',
    opts: [
      { v: '1', label: '1 round' },
      { v: '2', label: '2 rounds' },
      { v: '4', label: '4 rounds' },
    ],
  },
  {
    key: 'type',
    label: 'Match Type',
    opts: [
      { v: 'bot', label: 'Bot Match' },
      { v: 'normal', label: 'Normal Match' },
      { v: 'tournament', label: 'Tournament Match' },
    ],
  },
  {
    key: 'chicken',
    label: 'Chicken Hand',
    opts: [
      { v: 'notAllowed', label: 'Not Allowed' },
      { v: 'zero', label: 'Scores 0' },
      { v: 'one', label: 'Scores 1' },
    ],
  },
  {
    key: 'par',
    label: 'Par Score',
    opts: [
      { v: '25', label: '25' },
      { v: '30/25', label: '30/25' },
      { v: '30', label: '30' },
    ],
  },
  {
    key: 'scoring',
    label: 'Scoring',
    opts: [
      { v: 'original', label: 'Original' },
      { v: 'adjusted', label: 'Adjusted' },
      { v: 'adjustedExtra', label: 'Extra Patterns' },
    ],
  },
  {
    key: 'bonus',
    label: 'Bonus Tiles',
    opts: [
      { v: 'none', label: 'None' },
      { v: 'half', label: 'Half Value' },
      { v: 'full', label: 'Full Value' },
    ],
  },
];

/** Games needed before the playstyle is computed and shown (v0.2.2 #4). */
const PLAYSTYLE_MIN_GAMES = 100;

interface Playstyle {
  atk: number;
  spd: number;
  def: number;
  tile: Tile;
  name: string;
  zh: string;
}

/**
 * The player's playstyle (v0.2.2 #4). Each attribute is a weighted sum of
 * linear contributions: a statistic maps onto [min, max] (values beyond
 * either end are capped) and yields that fraction of the component's
 * weight. Defense's ranges run high-to-low: lower statistics mean a
 * stronger attribute.
 */
function computePlaystyle(s: StatsResponse): Playstyle {
  const N = s.games.total;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const part = (v: number, min: number, max: number, weight: number) =>
    Math.min(1, Math.max(0, (v - min) / (max - min))) * weight;

  const atkRaw =
    part(s.games.pointsWon / N, 0, 60, 60) +
    part(mean(s.games.winValuesSelf), 0, 60, 10) +
    part(mean(s.games.winValuesDiscard), 0, 60, 30);
  const spdRaw =
    part((100 * s.games.wins) / N, 0, 50, 60) +
    part(
      s.games.remainingWinsCount ? s.games.remainingWinsSum / s.games.remainingWinsCount : 0,
      0,
      60,
      40,
    );
  // Zero deal-ins leaves the "average opponent hand" component at its best.
  const defRaw =
    part(s.games.pointsLost / N, 60, 0, 30) +
    part((100 * s.games.discarderCount) / N, 37.5, 0, 30) +
    part(mean(s.games.dealInValues), 60, 0, 40);

  // Scores run 01–99: round, then pull the extremes off 00 and 100.
  const score = (raw: number) => Math.min(99, Math.max(1, Math.round(raw)));
  const atk = score(atkRaw);
  const spd = score(spdRaw);
  const def = score(defRaw);

  const ranked = (
    [
      { key: 'atk', v: atk },
      { key: 'spd', v: spd },
      { key: 'def', v: def },
    ] as const
  )
    .slice()
    .sort((a, b) => b.v - a.v);
  const DRAGONS = {
    atk: { tile: 'R ', name: 'Red Dragon', zh: '紅中' },
    spd: { tile: 'G ', name: 'Green Dragon', zh: '發財' },
    def: { tile: 'O ', name: 'White Dragon', zh: '白板' },
  } as const;
  const WINDS_BY_PAIR: Record<string, { tile: Tile; name: string; zh: string }> = {
    'atk+spd': { tile: 'S ', name: 'South Wind', zh: '南風' },
    'def+spd': { tile: 'W ', name: 'West Wind', zh: '西風' },
    'atk+def': { tile: 'N ', name: 'North Wind', zh: '北風' },
  };

  // Balanced attributes (spread ≤ 30) → East Wind. Otherwise one dominant
  // attribute → its dragon; two → the wind of the high pair.
  let id: { tile: Tile; name: string; zh: string };
  if (ranked[0].v - ranked[2].v <= 30) {
    id = { tile: 'E ', name: 'East Wind', zh: '東風' };
  } else if (ranked[0].v - ranked[1].v >= ranked[1].v - ranked[2].v) {
    id = DRAGONS[ranked[0].key];
  } else {
    const pair = [ranked[0].key, ranked[1].key].sort().join('+');
    id = WINDS_BY_PAIR[pair];
  }
  return { atk, spd, def, ...id };
}

export function renderStats(root: HTMLElement): void {
  const filter: Record<string, string> = {
    len: 'all',
    type: 'all',
    chicken: 'all',
    par: 'all',
    scoring: 'all',
    bonus: 'all',
  };

  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Statistics 統計</h1>
      <span class="spacer"></span>
      <button id="reset" class="danger-btn" title="Start counting statistics from zero. Records are not affected.">Reset statistics</button>
    </div>
    <div class="page-body stats-body">
      <div class="stats-filters" id="filters"></div>
      <div id="body">Loading…</div>
    </div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  el.querySelector('#reset')!.addEventListener('click', () => {
    if (!confirm('Reset statistics? Counting starts over from zero. Your match records are kept.')) return;
    apiPost('/api/stats/reset')
      .then(() => {
        net.toast('Statistics reset.');
        load();
      })
      .catch(() => net.toast('Could not reset statistics.'));
  });
  root.appendChild(el);

  // Filter radio groups (v0.2): "All" leads each group; any change reloads.
  const filtersEl = el.querySelector<HTMLElement>('#filters')!;
  for (const grp of FILTER_GROUPS) {
    const row = document.createElement('div');
    row.className = 'filter-group';
    const opts = [{ v: 'all', label: 'All' }, ...grp.opts];
    row.innerHTML = `<span class="fg-label">${grp.label}</span>${opts
      .map(
        (o) => `<label class="fg-opt"><input type="radio" name="f-${grp.key}" value="${o.v}"${
          o.v === 'all' ? ' checked' : ''
        } />${o.label}</label>`,
      )
      .join('')}`;
    row.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.addEventListener('change', () => {
        filter[grp.key] = input.value;
        load();
      });
    });
    filtersEl.appendChild(row);
  }

  const body = el.querySelector<HTMLElement>('#body')!;
  const load = () => {
    const qs = Object.entries(filter)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    apiGet<StatsResponse>(`/api/stats?${qs}`)
      .then((s) => draw(s))
      .catch(() => {
        body.textContent = 'Could not load statistics.';
      });
  };

  const draw = (s: StatsResponse) => {
    const N = s.games.total;
    const highScore = Math.max(0, ...s.games.winValuesSelf, ...s.games.winValuesDiscard);
    const card = (k: string, v: string) =>
      `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`;

    // Match-length rows appear only under the "All" or matching filter.
    const lengths = (['1', '2', '4'] as const).filter(
      (len) => filter.len === 'all' || filter.len === len,
    );
    const matchRows = lengths
      .map(
        (len) => `<tr>
          <td>${len} round${len === '1' ? '' : 's'} ${{ '1': '東風戰', '2': '半莊戰', '4': '一莊戰' }[len]}</td>
          <td class="num">${s.matches.played[len] ?? 0}</td>
          <td class="num">${s.matches.finished[len] ?? 0}</td>
          <td class="num">${s.matches.won[len] ?? 0}</td>
          <td class="num">${s.matches.drawn[len] ?? 0}</td>
        </tr>`,
      )
      .join('');

    // Chicken Hand leads the table as 0.0 (it is the non-pattern) — hidden
    // when filtering on "Chicken Hand: Not Allowed". The optional patterns
    // show only under All/Extra Patterns; the category-11 bonus patterns
    // hide under "No Bonus Tiles".
    const orderedIds = ['chicken', ...PATTERN_IDS.filter((id) => id !== 'chicken')].filter((id) => {
      if (id === 'chicken') return filter.chicken !== 'notAllowed';
      if ((OPTIONAL_PATTERN_IDS as readonly string[]).includes(id)) {
        return filter.scoring === 'all' || filter.scoring === 'adjustedExtra';
      }
      if (id.startsWith('11.')) return filter.bonus !== 'none';
      return true;
    });
    const patternRows = orderedIds
      .map((id) => {
        const p = PATTERNS[id];
        return `<tr>
          <td style="color:var(--text-dim)">${id === 'chicken' ? '0.0' : id}</td>
          <td>${p.name}</td>
          <td style="color:var(--text-dim)">${p.zh}</td>
          <td class="num">${s.patternCounts[id] ?? 0}</td>
        </tr>`;
      })
      .join('');

    body.innerHTML = `
      <h2 style="margin:6px 0 10px;font-size:16px">Matches</h2>
      <table class="data" style="max-width:640px">
        <tr><th>Length</th><th class="num">Played</th><th class="num">Finished</th><th class="num">Won</th><th class="num">Drawn</th></tr>
        ${matchRows}
      </table>

      <h2 style="margin:22px 0 10px;font-size:16px">Games (N = ${N})</h2>
      <div class="stat-grid" style="margin-bottom:10px">
        ${card('High Score 最高和牌', `${highScore || '—'} <span style="font-size:13px;color:var(--text-dim)">(max 480)</span>`)}
      </div>
      <div class="stat-grid">
        ${card('Total points won', `${s.games.pointsWon} <span style="font-size:13px;color:var(--text-dim)">(avg ${N ? fmt(s.games.pointsWon / N) : '—'})</span>`)}
        ${card('Total points lost', `${s.games.pointsLost} <span style="font-size:13px;color:var(--text-dim)">(avg ${N ? fmt(s.games.pointsLost / N) : '—'})</span>`)}
        ${card('Games drawn', `${s.games.draws} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.draws, N)})</span>`)}
        ${card('Games won', `${s.games.wins} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.wins, N)})</span>`)}
        ${card('Won by self-draw', `${s.games.selfDrawWins} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.selfDrawWins, N)})</span>`)}
        ${card('Dealt into a win 放銃', `${s.games.discarderCount} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.discarderCount, N)})</span>`)}
        ${card('Lost by self-draw', `${s.games.lostBySelfDraw} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.lostBySelfDraw, N)})</span>`)}
        ${card('Avg winning hand (self-draw)', avg(s.games.winValuesSelf))}
        ${card('Avg winning hand (on discard)', avg(s.games.winValuesDiscard))}
        ${card('Avg opponent hand when dealing in', avg(s.games.dealInValues))}
        ${card('Avg remaining tiles in wall', ratio(s.games.remainingSum, s.games.remainingCount))}
        ${card('Avg remaining tiles on wins', ratio(s.games.remainingWinsSum, s.games.remainingWinsCount))}
      </div>

      <h2 style="margin:22px 0 10px;font-size:16px">Playstyle 打法</h2>
      ${
        N >= PLAYSTYLE_MIN_GAMES
          ? `<div class="playstyle" id="playstyle"></div>`
          : `<div class="playstyle playstyle-locked">Play more games to view your personal playstyle!</div>`
      }

      <h2 style="margin:22px 0 10px;font-size:16px">Patterns Achieved</h2>
      <table class="data" style="max-width:760px">
        <tr><th>#</th><th>Pattern</th><th></th><th class="num">Count</th></tr>
        ${patternRows}
      </table>
    `;

    // Playstyle (v0.2.2 #4/#5): the overall honor tile on the left, the
    // three attribute bars (dragon colors; White shown as blue) to its right.
    const psEl = body.querySelector<HTMLElement>('#playstyle');
    if (psEl) {
      const ps = computePlaystyle(s);
      const bar = (label: string, v: number, color: string) => `
        <div class="ps-row" style="--ps-color:${color}">
          <span class="ps-k">${label}</span>
          <span class="ps-n">${String(v).padStart(2, '0')}</span>
          <div class="ps-bar"><div class="ps-fill" style="width:${v}%"></div></div>
        </div>`;
      psEl.innerHTML = `
        <div class="ps-id">
          <div class="ps-tile-slot"></div>
          <div class="ps-name">${ps.name}<span class="zh">${ps.zh}</span></div>
        </div>
        <div class="ps-bars">
          ${bar('ATK 攻', ps.atk, '#e0483e')}
          ${bar('SPD 速', ps.spd, '#3fae5a')}
          ${bar('DEF 防', ps.def, '#4a90e2')}
        </div>`;
      psEl.querySelector('.ps-tile-slot')!.appendChild(tileEl(ps.tile, { noIndex: true }));
    }
  };

  load();
}

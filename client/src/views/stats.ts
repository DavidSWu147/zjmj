import { PATTERN_IDS, PATTERNS } from '../../../shared/src/scoring';
import { apiGet, apiPost } from '../account';
import { net } from '../net';

interface StatsResponse {
  patternCounts: Record<string, number>;
  matches: {
    played: Record<string, number>;
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
    winValuesSelf: number[];
    winValuesDiscard: number[];
    dealInValues: number[];
  };
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits).replace(/\.00$/, '') : '—';
const avg = (xs: number[]): string => (xs.length ? fmt(xs.reduce((a, b) => a + b, 0) / xs.length) : '—');
const pct = (num: number, den: number): string => (den > 0 ? `${((100 * num) / den).toFixed(1)}%` : '—');

export function renderStats(root: HTMLElement, scope: 'standard' | 'custom' = 'standard'): void {
  const custom = scope === 'custom';
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>${custom ? 'Custom-Settings Statistics 自訂統計' : 'Statistics 統計'}</h1>
      <span class="spacer"></span>
      <button id="scope" title="${
        custom
          ? 'Back to matches played under standard settings'
          : 'Matches played under settings that differ from Room #0 defaults (length and thinking time aside)'
      }">${custom ? '← Standard settings' : 'Custom settings →'}</button>
      <button id="reset" class="danger-btn" title="Start counting statistics from zero. Records are not affected.">Reset statistics</button>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  el.querySelector('#scope')!.addEventListener('click', () => {
    location.hash = custom ? '#/stats' : '#/stats/custom';
  });
  el.querySelector('#reset')!.addEventListener('click', () => {
    if (!confirm('Reset statistics? Counting starts over from zero. Your match records are kept.')) return;
    apiPost('/api/stats/reset')
      .then(() => {
        net.toast('Statistics reset.');
        root.innerHTML = '';
        renderStats(root, scope);
      })
      .catch(() => net.toast('Could not reset statistics.'));
  });
  root.appendChild(el);

  apiGet<StatsResponse>(`/api/stats?scope=${scope}`)
    .then((s: StatsResponse) => {
      const body = el.querySelector('#body')!;
      const N = s.games.total;
      const highScore = Math.max(0, ...s.games.winValuesSelf, ...s.games.winValuesDiscard);
      const card = (k: string, v: string) =>
        `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`;

      const matchRows = (['1', '2', '4'] as const)
        .map(
          (len) => `<tr>
            <td>${len} round${len === '1' ? '' : 's'} ${{ '1': '東風戰', '2': '半莊戰', '4': '一莊戰' }[len]}</td>
            <td class="num">${s.matches.played[len] ?? 0}</td>
            <td class="num">${s.matches.won[len] ?? 0}</td>
            <td class="num">${s.matches.drawn[len] ?? 0}</td>
          </tr>`,
        )
        .join('');

      // Chicken Hand leads the table as 0.0 (issue: it is the non-pattern).
      const orderedIds = ['chicken', ...PATTERN_IDS.filter((id) => id !== 'chicken')];
      const patternRows = orderedIds.map((id) => {
        const p = PATTERNS[id];
        const label = id === 'chicken' ? '0.0' : id;
        return `<tr>
          <td style="color:var(--text-dim)">${label}</td>
          <td>${p.name}</td>
          <td style="color:var(--text-dim)">${p.zh}</td>
          <td class="num">${s.patternCounts[id] ?? 0}</td>
        </tr>`;
      }).join('');

      body.innerHTML = `
        <h2 style="margin:6px 0 10px;font-size:16px">Matches</h2>
        <table class="data" style="max-width:560px">
          <tr><th>Length</th><th class="num">Played</th><th class="num">Won</th><th class="num">Drawn</th></tr>
          ${matchRows}
        </table>

        <h2 style="margin:22px 0 10px;font-size:16px">Games (N = ${N})</h2>
        <div class="stat-grid">
          ${card('High Score 最高和牌', `${highScore || '—'} <span style="font-size:13px;color:var(--text-dim)">(max 480)</span>`)}
          ${card('Total points won', `${s.games.pointsWon} <span style="font-size:13px;color:var(--text-dim)">(avg ${N ? fmt(s.games.pointsWon / N) : '—'})</span>`)}
          ${card('Total points lost', `${s.games.pointsLost} <span style="font-size:13px;color:var(--text-dim)">(avg ${N ? fmt(s.games.pointsLost / N) : '—'})</span>`)}
          ${card('Games drawn', `${s.games.draws} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.draws, N)})</span>`)}
          ${card('Games won', `${s.games.wins} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.wins, N)})</span>`)}
          ${card('Won by self-draw', `${s.games.selfDrawWins} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.selfDrawWins, N)})</span>`)}
          ${card('Dealt into a win 放銃', `${s.games.discarderCount} <span style="font-size:13px;color:var(--text-dim)">(${pct(s.games.discarderCount, N)})</span>`)}
          ${card('Avg winning hand (self-draw)', avg(s.games.winValuesSelf))}
          ${card('Avg winning hand (on discard)', avg(s.games.winValuesDiscard))}
          ${card('Avg opponent hand when dealing in', avg(s.games.dealInValues))}
        </div>

        <h2 style="margin:22px 0 10px;font-size:16px">Patterns Achieved</h2>
        <table class="data" style="max-width:760px">
          <tr><th>#</th><th>Pattern</th><th></th><th class="num">Count</th></tr>
          ${patternRows}
        </table>
      `;
    })
    .catch(() => {
      el.querySelector('#body')!.textContent = 'Could not load statistics.';
    });
}

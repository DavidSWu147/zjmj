import { PATTERN_IDS, PATTERNS } from '../../../shared/src/scoring';
import { playerId } from '../identity';

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

export function renderStats(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Statistics 統計</h1>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  root.appendChild(el);

  fetch(`/api/stats/${playerId()}`)
    .then((r) => r.json())
    .then((s: StatsResponse) => {
      const body = el.querySelector('#body')!;
      const N = s.games.total;
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

      const patternRows = PATTERN_IDS.map((id) => {
        const p = PATTERNS[id];
        const label = id === 'chicken' ? '—' : id.replace(/^(\d+)\.(.+)$/, '$1.$2');
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

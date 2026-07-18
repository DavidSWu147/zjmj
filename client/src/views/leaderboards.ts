import { apiGet } from '../account';

interface LeaderRow {
  name: string;
  points: number;
}

interface LeaderboardsResponse {
  /** Current week id: the Saturday date the week started on. */
  week: string;
  /** Current month ('YYYY-MM') the Monthly tab covers. */
  month: string;
  weekly: LeaderRow[];
  monthly: LeaderRow[];
  allTime: LeaderRow[];
}

type Tab = 'weekly' | 'monthly' | 'allTime';

export function renderLeaderboards(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Leaderboards 排行榜</h1>
      <span class="spacer"></span>
      <div class="help-tabs" id="tabs">
        <button data-tab="weekly">Weekly Leaders 週榜</button>
        <button data-tab="monthly">Monthly Leaders 月榜</button>
        <button data-tab="allTime">All Time Leaders 總榜</button>
      </div>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  root.appendChild(el);

  const body = el.querySelector<HTMLElement>('#body')!;
  const tabs = el.querySelectorAll<HTMLButtonElement>('#tabs button');

  apiGet<LeaderboardsResponse>('/api/leaderboards')
    .then((data) => {
      const show = (tab: Tab): void => {
        tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        const rows = data[tab];
        const scopeNote =
          tab === 'weekly'
            ? `Current week (starting Saturday ${data.week})`
            : tab === 'monthly'
              ? `Weekly tournaments of ${data.month}`
              : 'All weekly tournaments';
        const table =
          rows.length === 0
            ? `<div class="help-note">No tournament results yet. Rank Points are earned in
                Weekly Tournament matches, playable on Saturdays.</div>`
            : `<table class="data" style="max-width:560px">
                <tr><th>#</th><th>Player</th><th class="num">Rank Points</th></tr>
                ${rows
                  .map(
                    (r, i) => `<tr>
                      <td style="color:var(--text-dim)">${i + 1}.</td>
                      <td>${escapeHtml(r.name)}</td>
                      <td class="num">${r.points}</td>
                    </tr>`,
                  )
                  .join('')}
              </table>`;
        body.innerHTML = `
          <div class="help-note">${scopeNote} — registered users ranked by Rank Points from
            Weekly Tournament matches (max(50, final score + 500) per finished match).</div>
          ${table}
        `;
        body.scrollTop = 0;
      };
      tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
      show('weekly');
    })
    .catch(() => {
      body.textContent = 'Could not load the leaderboards.';
    });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

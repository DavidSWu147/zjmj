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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The Saturday ('YYYY-MM-DD') on or before the given UTC date. */
function saturdayOnOrBefore(d: Date): string {
  const days = (d.getUTCDay() + 1) % 7; // Sat=0, Sun=1, … Fri=6
  return new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

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
        <button id="past">Past Leaderboards 歷史榜</button>
      </div>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  root.appendChild(el);

  const body = el.querySelector<HTMLElement>('#body')!;
  const tabs = el.querySelectorAll<HTMLButtonElement>('#tabs button[data-tab]');
  const pastBtn = el.querySelector<HTMLButtonElement>('#past')!;

  apiGet<LeaderboardsResponse>('/api/leaderboards')
    .then((data) => {
      // Past Leaderboards (v0.2.2 #9): the calendar's cursor month and the
      // selected past scope. The current week/month (server clock) bound
      // navigation — the future holds no leaderboards.
      let calOpen = false;
      let calYear = Number(data.month.slice(0, 4));
      let calMonth = Number(data.month.slice(5, 7)) - 1; // 0-based
      let pastSel: { kind: 'month'; month: string } | { kind: 'week'; week: string } | null = null;
      let pastRows: LeaderRow[] = [];

      const table = (rows: LeaderRow[]): string =>
        rows.length === 0
          ? `<div class="help-note">No tournament results for this period. Rank Points are
              earned in Weekly Tournament matches, playable on Saturdays.</div>`
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

      const calendarHtml = (): string => {
        const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
        const first = new Date(Date.UTC(calYear, calMonth, 1));
        const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
        // Columns run Sat..Fri — tournament weeks start on Saturday.
        const lead = (first.getUTCDay() + 1) % 7;
        const cells: { day: number | null; date: Date | null }[] = [];
        for (let i = 0; i < lead; i++) cells.push({ day: null, date: null });
        for (let d = 1; d <= daysInMonth; d++) {
          cells.push({ day: d, date: new Date(Date.UTC(calYear, calMonth, d)) });
        }
        while (cells.length % 7 !== 0) cells.push({ day: null, date: null });
        const weekRows: string[] = [];
        for (let r = 0; r < cells.length / 7; r++) {
          const row = cells.slice(r * 7, r * 7 + 7);
          const anchor = row.find((c) => c.date !== null)!;
          const week = saturdayOnOrBefore(anchor.date!);
          const future = week > data.week;
          const selected = pastSel?.kind === 'week' && pastSel.week === week;
          weekRows.push(`<tr class="cal-week${future ? ' future' : ''}${selected ? ' selected' : ''}"
              ${future ? '' : `data-week="${week}"`}>
            ${row.map((c) => `<td>${c.day ?? ''}</td>`).join('')}
          </tr>`);
        }
        const atNow = monthStr >= data.month;
        const monthSelected = pastSel?.kind === 'month' && pastSel.month === monthStr;
        return `
          <div class="cal" id="cal">
            <div class="cal-head">
              <button id="cal-prev" title="Previous month">◀</button>
              <button id="cal-title" class="${monthSelected ? 'selected' : ''}"
                data-month="${monthStr}"
                title="Show this month's leaderboard">${MONTH_NAMES[calMonth]} ${calYear}</button>
              <button id="cal-next" title="Next month" ${atNow ? 'disabled' : ''}>▶</button>
            </div>
            <table class="cal-grid">
              <tr><th>Sa</th><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th></tr>
              ${weekRows.join('')}
            </table>
            <div class="help-note">Click the month name for that month's leaderboard,
              or a week's row for that week (weeks start on Saturday).</div>
          </div>`;
      };

      const draw = (tab: Tab | null): void => {
        tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        pastBtn.classList.toggle('active', calOpen);
        let scopeNote: string;
        let rows: LeaderRow[];
        if (tab) {
          rows = data[tab];
          scopeNote =
            tab === 'weekly'
              ? `Current week (starting Saturday ${data.week})`
              : tab === 'monthly'
                ? `Weekly tournaments of ${data.month}`
                : 'All weekly tournaments';
        } else if (pastSel) {
          rows = pastRows;
          scopeNote =
            pastSel.kind === 'week'
              ? `Week starting Saturday ${pastSel.week}`
              : `Weekly tournaments of ${pastSel.month}`;
        } else {
          rows = [];
          scopeNote = 'Pick a month or week from the calendar.';
        }
        body.innerHTML = `
          ${calOpen ? calendarHtml() : ''}
          <div class="help-note">${scopeNote} — registered users ranked by Rank Points from
            Weekly Tournament matches (max(50, final score + 500) per finished match).</div>
          ${tab || pastSel ? table(rows) : ''}
        `;
        body.scrollTop = 0;
        if (calOpen) hookCalendar();
      };

      const loadPast = (sel: NonNullable<typeof pastSel>): void => {
        const qs = sel.kind === 'week' ? `week=${sel.week}` : `month=${sel.month}`;
        apiGet<{ rows: LeaderRow[] }>(`/api/leaderboards/past?${qs}`)
          .then((r) => {
            pastSel = sel;
            pastRows = r.rows;
            draw(null);
          })
          .catch(() => {
            body.textContent = 'Could not load that leaderboard.';
          });
      };

      const hookCalendar = (): void => {
        body.querySelector('#cal-prev')?.addEventListener('click', () => {
          calMonth--;
          if (calMonth < 0) {
            calMonth = 11;
            calYear--;
          }
          draw(null);
        });
        body.querySelector('#cal-next')?.addEventListener('click', () => {
          calMonth++;
          if (calMonth > 11) {
            calMonth = 0;
            calYear++;
          }
          draw(null);
        });
        body.querySelector<HTMLElement>('#cal-title')?.addEventListener('click', (e) => {
          loadPast({ kind: 'month', month: (e.currentTarget as HTMLElement).dataset.month! });
        });
        body.querySelectorAll<HTMLElement>('.cal-week[data-week]').forEach((row) => {
          row.addEventListener('click', () => loadPast({ kind: 'week', week: row.dataset.week! }));
        });
      };

      tabs.forEach((b) =>
        b.addEventListener('click', () => {
          calOpen = false;
          pastSel = null;
          draw(b.dataset.tab as Tab);
        }),
      );
      pastBtn.addEventListener('click', () => {
        calOpen = !calOpen;
        if (!calOpen) {
          pastSel = null;
          draw('weekly');
        } else {
          draw(null);
        }
      });
      draw('weekly');
    })
    .catch(() => {
      body.textContent = 'Could not load the leaderboards.';
    });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

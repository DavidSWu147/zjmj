import { MatchRecord, ReplayStep, replayGame } from '../../../shared/src/records';
import { MeldView } from '../../../shared/src/protocol';
import { playerId } from '../identity';
import { tileEl } from '../tileui';
import { escapeHtml } from './play';

interface MatchListEntry {
  matchId: number;
  createdAt: number;
  matchLength: number;
  players: { name: string; isBot: boolean }[];
  finalScores: number[];
  mySeat: number;
  myScore: number;
  myResult: 'WIN' | 'LOSE' | 'DRAW';
}

const SEAT_LETTERS = ['E', 'S', 'W', 'N'];

export function renderRecords(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Records 牌譜</h1>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  root.appendChild(el);

  fetch(`/api/records/${playerId()}`)
    .then((r) => r.json())
    .then((list: MatchListEntry[]) => {
      const body = el.querySelector('#body')!;
      if (list.length === 0) {
        body.innerHTML = '<p style="color:var(--text-dim)">No finished matches yet. Play some Mahjong!</p>';
        return;
      }
      const rows = list
        .map((m) => {
          const date = new Date(m.createdAt).toLocaleString();
          const players = m.players
            .map((p, i) => `${escapeHtml(p.name)}${p.isBot ? '🤖' : ''} ${m.finalScores[i] > 0 ? '+' : ''}${m.finalScores[i]}`)
            .join(' · ');
          const cls = m.myResult === 'WIN' ? 'win-gold' : m.myResult === 'LOSE' ? 'lose-gray' : 'draw-green';
          return `<tr class="record-row" data-id="${m.matchId}">
            <td>${date}</td>
            <td class="num">${m.matchLength}</td>
            <td>${players}</td>
            <td class="num ${cls}" style="font-weight:700">${m.myResult}</td>
          </tr>`;
        })
        .join('');
      body.innerHTML = `<table class="data">
        <tr><th>Date</th><th class="num">Rounds</th><th>Players (final score)</th><th class="num">Result</th></tr>
        ${rows}
      </table>`;
      body.querySelectorAll<HTMLElement>('.record-row').forEach((r) => {
        r.addEventListener('click', () => (location.hash = `#/records/${r.dataset.id}`));
      });
    })
    .catch(() => {
      el.querySelector('#body')!.textContent = 'Could not load records.';
    });
}

export function renderRecordViewer(root: HTMLElement, matchId: number): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Records</button>
      <h1 id="title">Match ${matchId}</h1>
      <span class="spacer"></span>
      <a id="dl" href="/api/record/${matchId}/txt" download><button>Download .txt</button></a>
    </div>
    <div class="page-body" id="body" style="overflow:hidden">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = '#/records'));
  root.appendChild(el);

  fetch(`/api/record/${matchId}`)
    .then((r) => {
      if (!r.ok) throw new Error('not found');
      return r.json();
    })
    .then((rec: MatchRecord) => buildViewer(el.querySelector('#body')!, rec))
    .catch(() => {
      el.querySelector('#body')!.textContent = 'Match not found.';
    });
}

function buildViewer(body: HTMLElement, rec: MatchRecord): void {
  let gameIdx = 0;
  let steps: ReplayStep[] = [];
  let stepIdx = 0;

  body.innerHTML = `
    <div class="viewer">
      <div class="viewer-controls">
        <select id="gamesel">${rec.games
          .map((g, i) => `<option value="${i}">${g.gameNumber} — ${gameSummary(rec, i)}</option>`)
          .join('')}</select>
        <button id="prev">◀</button>
        <button id="next">▶</button>
        <input type="range" id="scrub" min="0" max="0" value="0" />
        <span id="steplabel" style="color:var(--text-dim);font-size:13px"></span>
      </div>
      <div class="viewer-body">
        <div class="viewer-table" id="table"></div>
        <div class="viewer-log" id="log"></div>
      </div>
    </div>
  `;

  const gamesel = body.querySelector<HTMLSelectElement>('#gamesel')!;
  const scrub = body.querySelector<HTMLInputElement>('#scrub')!;
  const stepLabel = body.querySelector<HTMLElement>('#steplabel')!;
  const table = body.querySelector<HTMLElement>('#table')!;
  const log = body.querySelector<HTMLElement>('#log')!;

  const loadGame = (gi: number) => {
    gameIdx = gi;
    steps = replayGame(rec.games[gi]);
    stepIdx = steps.length - 1;
    scrub.max = String(steps.length - 1);
    scrub.value = String(stepIdx);
    render();
  };

  const render = () => {
    const step = steps[stepIdx];
    const game = rec.games[gameIdx];
    stepLabel.textContent = `${stepIdx}/${steps.length - 1}`;
    scrub.value = String(stepIdx);

    table.innerHTML = '';
    for (let seat = 0; seat < 4; seat++) {
      const player = rec.players[(seat + gameIdx) % 4];
      const seatDiv = document.createElement('div');
      seatDiv.className = 'viewer-seat';
      const isWinner = stepIdx === steps.length - 1 && game.result.winnerSeat === seat;
      if (isWinner) seatDiv.classList.add('winner');
      const head = document.createElement('div');
      head.className = 'head';
      head.innerHTML = `<b style="color:var(--text)">${SEAT_LETTERS[seat]}</b>
        <span>${escapeHtml(player.name)}${player.isBot ? ' 🤖' : ''}</span>
        ${isWinner ? `<span class="win-gold">MAHJONG ${game.result.value} pts</span>` : ''}
        ${stepIdx === steps.length - 1 && game.result.responsibleSeat === seat ? '<span class="lose-gray">Discarder 放銃</span>' : ''}`;
      seatDiv.appendChild(head);

      const rows = document.createElement('div');
      rows.className = 'rows';
      const handLine = document.createElement('div');
      handLine.className = 'hand-line';
      const meldRow = document.createElement('div');
      meldRow.className = 'tile-row';
      for (const m of step.melds[seat]) meldRow.appendChild(meldElLite(m));
      if (step.melds[seat].length > 0) handLine.appendChild(meldRow);
      const handRow = document.createElement('div');
      handRow.className = 'tile-row';
      for (const t of step.hands[seat]) handRow.appendChild(tileEl(t));
      handLine.appendChild(handRow);
      if (step.drawn[seat]) {
        const drawnRow = document.createElement('div');
        drawnRow.className = 'tile-row';
        drawnRow.style.marginLeft = '8px';
        drawnRow.appendChild(tileEl(step.drawn[seat], { highlight: true }));
        handLine.appendChild(drawnRow);
      }
      rows.appendChild(handLine);

      const disc = document.createElement('div');
      disc.className = 'discards';
      for (const d of step.discards[seat]) disc.appendChild(tileEl(d.tile, { dimmed: d.fromDraw }));
      rows.appendChild(disc);
      seatDiv.appendChild(rows);
      table.appendChild(seatDiv);
    }

    log.innerHTML = '';
    steps.forEach((s, i) => {
      const line = document.createElement('div');
      line.textContent = i === 0 ? '— deal —' : s.text;
      if (i === stepIdx) line.classList.add('cur');
      line.addEventListener('click', () => {
        stepIdx = i;
        render();
      });
      log.appendChild(line);
    });
    const cur = log.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };

  gamesel.addEventListener('change', () => loadGame(Number(gamesel.value)));
  body.querySelector('#prev')!.addEventListener('click', () => {
    if (stepIdx > 0) {
      stepIdx--;
      render();
    }
  });
  body.querySelector('#next')!.addEventListener('click', () => {
    if (stepIdx < steps.length - 1) {
      stepIdx++;
      render();
    }
  });
  scrub.addEventListener('input', () => {
    stepIdx = Number(scrub.value);
    render();
  });

  loadGame(0);
}

function gameSummary(rec: MatchRecord, gi: number): string {
  const r = rec.games[gi].result;
  if (r.winnerSeat === null) return 'draw 流局';
  const winner = rec.players[(r.winnerSeat + gi) % 4];
  return `${winner.name} +${r.value} (${r.winBy === 'self' ? '自摸' : '和'})`;
}

function meldElLite(m: MeldView): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'meld';
  m.tiles.forEach((t, i) => {
    if (m.stacked && i === m.tiles.length - 1) return;
    wrap.appendChild(
      tileEl(t, {
        back: m.faceDown.includes(i),
        rotated: m.rotated === i,
        stackedExtra: m.stacked && m.rotated === i ? m.tiles[m.tiles.length - 1] : null,
      }),
    );
  });
  return wrap;
}

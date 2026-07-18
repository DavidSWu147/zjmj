import './style.css';
import { net } from './net';
import { syncSettingsFromServer } from './settings';
import { installTileHighlight } from './tileui';
import { renderHome } from './views/home';
import { renderPlay } from './views/play';
import { renderStats } from './views/stats';
import { renderRecords, renderRecordViewer } from './views/records';
import { renderSettings } from './views/settings';
import { renderHelp } from './views/help';
import { renderLeaderboards } from './views/leaderboards';
import { renderAchievements } from './views/achievements';

const app = document.getElementById('app')!;

const onHomePage = (): boolean => {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash === '' || hash === 'home';
};

/**
 * v0.2: landing on the home page exits any room you were waiting in — the
 * old behavior silently kept the player squatting in the room. Matches (and
 * spectating) are untouched.
 */
function leaveRoomIfOnHome(): void {
  if (onHomePage() && net.state.myRoom !== null && !net.state.inMatch) {
    net.send({ type: 'leaveRoom' });
  }
}

function route(): void {
  const hash = location.hash.replace(/^#\/?/, '');
  app.innerHTML = '';
  if (hash === 'play') {
    renderPlay(app);
  } else if (hash === 'stats') {
    renderStats(app);
  } else if (hash === 'stats/custom') {
    renderStats(app, 'custom');
  } else if (hash === 'records') {
    renderRecords(app);
  } else if (hash === 'records/upload') {
    renderRecordViewer(app, 'upload');
  } else if (hash.startsWith('records/')) {
    renderRecordViewer(app, Number(hash.slice('records/'.length)));
  } else if (hash === 'settings') {
    renderSettings(app);
  } else if (hash === 'help') {
    renderHelp(app);
  } else if (hash === 'leaderboards') {
    renderLeaderboards(app);
  } else if (hash === 'achievements') {
    renderAchievements(app);
  } else {
    leaveRoomIfOnHome();
    renderHome(app);
  }
}

console.log(`zjmj client build ${__BUILD_TIME__}`);
window.addEventListener('hashchange', route);
installTileHighlight();
net.connect();
void syncSettingsFromServer();
net.onUpdate(() => {
  // A lobby update can reveal we are still in a room while sitting on the
  // home page (e.g. reconnect): leave it (v0.2).
  leaveRoomIfOnHome();
  // Global toast display.
  let toast = document.getElementById('toast');
  if (net.state.toast) {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = net.state.toast;
    toast.classList.add('show');
  } else if (toast) {
    toast.classList.remove('show');
  }
});
route();

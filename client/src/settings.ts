import { DEFAULT_PLAYER_SETTINGS, PlayerSettings } from '../../shared/src/protocol';
import { currentAuth, ensureAuth } from './account';

const SETTINGS_KEY = 'zjmj-settings';

type Listener = () => void;
const listeners = new Set<Listener>();

let cache: PlayerSettings = load();
let saveTimer: number | null = null;

function load(): PlayerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? merge(JSON.parse(raw) as Partial<PlayerSettings>) : structuredClone(DEFAULT_PLAYER_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_PLAYER_SETTINGS);
  }
}

/** Fills any missing fields with defaults so old saved blobs stay valid. */
function merge(partial: Partial<PlayerSettings>): PlayerSettings {
  const def = structuredClone(DEFAULT_PLAYER_SETTINGS);
  const merged = {
    ...def,
    ...partial,
    keyBindings: { ...def.keyBindings, ...(partial.keyBindings ?? {}) },
    defaultRoom: { ...def.defaultRoom, ...(partial.defaultRoom ?? {}) },
  };
  // Saved blobs may carry retired thinking-time options (10s pre-0.1.1).
  if (![7.5, 15, 30].includes(merged.defaultRoom.thinkingTime)) {
    merged.defaultRoom.thinkingTime = 15;
  }
  return merged;
}

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSettings(): PlayerSettings {
  return cache;
}

/** Applies a change locally at once and saves to the server debounced. */
export function updateSettings(patch: Partial<PlayerSettings>): void {
  cache = merge({ ...cache, ...patch });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cache));
  for (const fn of listeners) fn();
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveToServer();
  }, 800);
}

async function saveToServer(): Promise<void> {
  const auth = currentAuth();
  if (!auth) return;
  await fetch('/api/auth/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ settings: cache }),
  }).catch(() => {});
}

/** Adopts the server copy (account settings roam across devices). */
export async function syncSettingsFromServer(): Promise<void> {
  const auth = await ensureAuth().catch(() => null);
  if (!auth) return;
  try {
    const res = await fetch('/api/auth/settings', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return;
    const json = (await res.json()) as { settings: Partial<PlayerSettings> | null };
    if (json.settings) {
      cache = merge(json.settings);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(cache));
      for (const fn of listeners) fn();
    }
  } catch {
    // offline: local cache is fine
  }
}

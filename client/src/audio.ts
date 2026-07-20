import { getSettings, onSettingsChange } from './settings';

/**
 * Audio engine (v0.2.2 #10–14). BGM plays during matches only; menus and
 * the lobby loop a silent mp3 instead, which keeps the audio element
 * "warm" (a user gesture has already unlocked it) so the real music can
 * start the moment a match begins.
 */

// The BGM playlist is the src/assets/bgm folder itself: every mp3 in it is
// playlisted, resolved at build time.
const BGM_TRACKS = Object.values(
  import.meta.glob('./assets/bgm/*.mp3', { eager: true, query: '?url', import: 'default' }),
) as string[];

const SILENT_URL = '/audio/silent.mp3';

let bgm: HTMLAudioElement | null = null;
let inGame = false;
let trackIdx = 0;

const bgmVolume = (): number => Math.min(100, Math.max(0, getSettings().bgmVolume)) / 100;
const sfxVolume = (): number => Math.min(100, Math.max(0, getSettings().sfxVolume)) / 100;

function ensureBgm(): HTMLAudioElement {
  if (!bgm) {
    bgm = new Audio();
    // Playlist advance; a single track simply restarts.
    bgm.addEventListener('ended', () => {
      if (inGame && BGM_TRACKS.length > 0) {
        trackIdx = (trackIdx + 1) % BGM_TRACKS.length;
        bgm!.src = BGM_TRACKS[trackIdx];
        void bgm!.play().catch(() => {});
      }
    });
    // Browsers block audio until a user gesture: retry on the next pointer
    // press if the element is stuck paused.
    document.addEventListener('pointerdown', () => {
      if (bgm && bgm.paused && bgm.src) void bgm.play().catch(() => {});
    });
    onSettingsChange(() => {
      if (bgm) bgm.volume = inGame ? bgmVolume() : 0;
    });
  }
  return bgm;
}

/** Switches between the in-match playlist and the silent menu loop. */
export function updateAudioScene(nowInGame: boolean): void {
  const el = ensureBgm();
  if (inGame === nowInGame && el.src !== '') return;
  inGame = nowInGame;
  if (inGame && BGM_TRACKS.length > 0) {
    el.loop = false;
    el.volume = bgmVolume();
    el.src = BGM_TRACKS[trackIdx % BGM_TRACKS.length];
  } else {
    el.loop = true;
    el.volume = 0;
    el.src = SILENT_URL;
  }
  void el.play().catch(() => {});
}

export type ClaimSound = 'chow' | 'pung' | 'kong' | 'mahjong' | 'selfdraw';

// ── SFX via WebAudio (v0.2.3 #5/#6) ─────────────────────────────────
// Decoded buffers start with no perceptible latency, and — unlike a fresh
// HTMLAudio element — may be triggered by server events (an OPPONENT's
// claim) on mobile: the context is unlocked once by any user gesture and
// stays usable afterwards. Clips are pre-fetched so nothing is loaded on
// the play path.

const CLAIM_KINDS: ClaimSound[] = ['chow', 'pung', 'kong', 'mahjong', 'selfdraw'];

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let preloadedVoice = 0;

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    const resume = () => {
      if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
  }
  return ctx;
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const buf = await ensureCtx().decodeAudioData(await res.arrayBuffer());
    buffers.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

function startBuffer(buf: AudioBuffer): AudioBufferSourceNode {
  const c = ensureCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = sfxVolume();
  src.connect(gain);
  gain.connect(c.destination);
  src.start();
  return src;
}

function playSfx(url: string): void {
  const buf = buffers.get(url);
  if (buf) {
    startBuffer(buf);
  } else {
    // Not preloaded (first hit): fetch, then play — still fire-and-forget.
    void loadBuffer(url).then((b) => b && startBuffer(b));
  }
}

const voiceUrl = (voice: number, kind: ClaimSound): string => `/audio/sfx/voice${voice}/${kind}.mp3`;

/** Pre-fetches every clip the game can fire: dice, discard, claim voice. */
export function preloadSfx(): void {
  const voice = getSettings().claimsVoice;
  if (voice !== preloadedVoice) {
    preloadedVoice = voice;
    for (const kind of CLAIM_KINDS) void loadBuffer(voiceUrl(voice, kind));
  }
  void loadBuffer('/audio/sfx/dice.mp3');
  void loadBuffer('/audio/sfx/discard.mp3');
}

/** A claim call in the selected Claims Voice (v0.2.2 #11/#13). */
export function playClaim(kind: ClaimSound): void {
  playSfx(voiceUrl(getSettings().claimsVoice, kind));
}

/** Dice roll / tile discard — silent placeholders for now (v0.2.2 #14). */
export function playDice(): void {
  playSfx('/audio/sfx/dice.mp3');
}
export function playDiscard(): void {
  playSfx('/audio/sfx/discard.mp3');
}

// Preload once at startup and again whenever the settings change (a new
// Claims Voice needs its clips fetched before its first call fires).
preloadSfx();
onSettingsChange(preloadSfx);

let preview: AudioBufferSourceNode | null = null;

/** The full run of a voice's claim words (settings page, v0.2.2 #13). */
export function playVoicePreview(voice: number): void {
  try {
    preview?.stop();
  } catch {
    /* already ended */
  }
  preview = null;
  void loadBuffer(`/audio/sfx/voice${voice}/preview.mp3`).then((buf) => {
    if (buf) preview = startBuffer(buf);
  });
}

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

function playSfx(url: string): void {
  const a = new Audio(url);
  a.volume = sfxVolume();
  void a.play().catch(() => {});
}

/** A claim call in the selected Claims Voice (v0.2.2 #11/#13). */
export function playClaim(kind: ClaimSound): void {
  playSfx(`/audio/sfx/voice${getSettings().claimsVoice}/${kind}.mp3`);
}

/** Dice roll / tile discard — silent placeholders for now (v0.2.2 #14). */
export function playDice(): void {
  playSfx('/audio/sfx/dice.mp3');
}
export function playDiscard(): void {
  playSfx('/audio/sfx/discard.mp3');
}

let preview: HTMLAudioElement | null = null;

/** The full run of a voice's claim words (settings page, v0.2.2 #13). */
export function playVoicePreview(voice: number): void {
  preview?.pause();
  preview = new Audio(`/audio/sfx/voice${voice}/preview.mp3`);
  preview.volume = sfxVolume();
  void preview.play().catch(() => {});
}

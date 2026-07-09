import { RoomSettings } from '../../../shared/src/protocol';
import { ScoringMode } from '../../../shared/src/scoring';

export const LENGTHS: { v: 1 | 2 | 4; label: string }[] = [
  { v: 1, label: '1 round (東風戰)' },
  { v: 2, label: '2 rounds (半莊戰)' },
  { v: 4, label: '4 rounds (一莊戰)' },
];
export const TIMES: { v: 7.5 | 10 | 15; label: string }[] = [
  { v: 7.5, label: '7.5 seconds' },
  { v: 10, label: '10 seconds' },
  { v: 15, label: '15 seconds' },
];
export const CHICKENS: { v: RoomSettings['chickenHand']; label: string }[] = [
  { v: 'notAllowed', label: 'Not allowed' },
  { v: 'zero', label: 'Scores 0 points' },
  { v: 'one', label: 'Scores 1 point' },
];
export const PARS: { v: RoomSettings['par']; label: string }[] = [
  { v: 25, label: '25 points' },
  { v: '30/25', label: '30 points unless exact then 25' },
  { v: 30, label: '30 points' },
];
export const SCORINGS: { v: ScoringMode; label: string }[] = [
  { v: 'original', label: 'Original Scoring' },
  { v: 'adjusted', label: 'Adjusted Scoring' },
  { v: 'adjustedExtra', label: 'Adjusted Scoring with Extra Patterns' },
];
export const BONUSES: { v: NonNullable<RoomSettings['bonusTiles']>; label: string }[] = [
  { v: 'none', label: 'No Bonus Tiles' },
  { v: 'half', label: 'Bonus Tiles worth Half' },
  { v: 'full', label: 'Bonus Tiles worth Full' },
];

/**
 * Renders the four room-setting sliders into `container`, initialized from
 * `initial`. Returns a reader for the current values; `onChange` fires on
 * every slider move.
 */
export function buildRoomSliders(
  container: HTMLElement,
  initial: RoomSettings,
  onChange?: (s: RoomSettings) => void,
): { read: () => RoomSettings } {
  const groups = [
    { key: 'rounds', label: 'Match Length', opts: LENGTHS, def: LENGTHS.findIndex((o) => o.v === initial.rounds) },
    { key: 'thinkingTime', label: 'Thinking Time', opts: TIMES, def: TIMES.findIndex((o) => o.v === initial.thinkingTime) },
    { key: 'chickenHand', label: 'Chicken Hand (雞和)', opts: CHICKENS, def: CHICKENS.findIndex((o) => o.v === initial.chickenHand) },
    { key: 'par', label: 'Par Score', opts: PARS, def: PARS.findIndex((o) => o.v === initial.par) },
    { key: 'scoring', label: 'Scoring', opts: SCORINGS, def: SCORINGS.findIndex((o) => o.v === (initial.scoring ?? 'original')) },
    { key: 'bonusTiles', label: 'Bonus Tiles (花牌)', opts: BONUSES, def: BONUSES.findIndex((o) => o.v === (initial.bonusTiles ?? 'none')) },
  ] as const;

  const values: Record<string, number> = {};
  const read = (): RoomSettings => ({
    rounds: LENGTHS[values.rounds].v,
    thinkingTime: TIMES[values.thinkingTime].v,
    chickenHand: CHICKENS[values.chickenHand].v,
    par: PARS[values.par].v,
    scoring: SCORINGS[values.scoring].v,
    bonusTiles: BONUSES[values.bonusTiles].v,
  });

  for (const grp of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';
    wrap.innerHTML = `
      <label>${grp.label}</label>
      <input type="range" min="0" max="${grp.opts.length - 1}" step="1" value="${Math.max(0, grp.def)}" />
      <div class="slider-value"></div>
    `;
    const input = wrap.querySelector<HTMLInputElement>('input')!;
    const valEl = wrap.querySelector<HTMLElement>('.slider-value')!;
    const show = () => {
      values[grp.key] = Number(input.value);
      valEl.textContent = grp.opts[Number(input.value)].label;
    };
    input.addEventListener('input', () => {
      show();
      onChange?.(read());
    });
    show();
    container.appendChild(wrap);
  }
  return { read };
}

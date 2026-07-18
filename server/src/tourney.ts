/**
 * Weekly Tournament clock (v0.2). All boundaries use a fixed UTC-7 offset
 * (the spec says "PST"; per David, UTC-7 for now). The tournament window is
 * all of Saturday: Saturday 00:00 to Sunday 00:00.
 */
const TZ_OFFSET_MS = 7 * 3600 * 1000;

/** Dev/testing only: shifts the tournament clock, e.g. to fake a Saturday. */
const CLOCK_OFFSET_MS = Number(process.env.ZJMJ_CLOCK_OFFSET_MS ?? 0) || 0;

function shifted(now: number): Date {
  return new Date(now + CLOCK_OFFSET_MS - TZ_OFFSET_MS);
}

/** Is the join/start window open right now (it is Saturday, UTC-7)? */
export function tournamentWindowOpen(now = Date.now()): boolean {
  return shifted(now).getUTCDay() === 6;
}

/**
 * The current tournament week's identifier: the date ('YYYY-MM-DD', UTC-7)
 * of the most recent Saturday — the week "starts Saturday midnight".
 */
export function currentWeekId(now = Date.now()): string {
  const d = shifted(now);
  const daysSinceSaturday = (d.getUTCDay() + 1) % 7;
  return new Date(d.getTime() - daysSinceSaturday * 86_400_000).toISOString().slice(0, 10);
}

export function previousWeekId(now = Date.now()): string {
  return currentWeekId(now - 7 * 86_400_000);
}

/** 'YYYY-MM' of the current month (UTC-7): the Monthly Leaders scope. */
export function currentMonthPrefix(now = Date.now()): string {
  return shifted(now).toISOString().slice(0, 7);
}

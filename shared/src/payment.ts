export type ParSetting = 25 | '30/25' | 30;

/**
 * Zung Jung Formal Competition payoff: the winner always receives 3x the hand
 * value. Returns score deltas indexed by seat (0..3).
 *
 * - Self-draw, or no responsible player (same-round immunity): each opponent
 *   pays 1x the value.
 * - Win on discard with a responsible player: for hands at or below par each
 *   opponent pays 1x; above par the two others pay par each and the
 *   responsible player pays the balance.
 * - Par "30 unless exact then 25": a hand of exactly 30 won by discard makes
 *   the responsible player pay 40 and the others 25 each; otherwise par 30.
 */
export function computePayments(opts: {
  value: number;
  winnerSeat: number;
  winBy: 'discard' | 'self';
  responsibleSeat: number | null;
  par: ParSetting;
}): number[] {
  const { value, winnerSeat, winBy, responsibleSeat, par } = opts;
  const deltas = [0, 0, 0, 0];
  const others = [0, 1, 2, 3].filter((s) => s !== winnerSeat);

  const paySplit = (perOther: (seat: number) => number) => {
    for (const s of others) {
      const p = perOther(s);
      deltas[s] -= p;
      deltas[winnerSeat] += p;
    }
  };

  if (winBy === 'self' || responsibleSeat === null) {
    paySplit(() => value);
    return deltas;
  }

  const parValue = par === '30/25' ? 30 : par;
  if (par === '30/25' && value === 30) {
    paySplit((s) => (s === responsibleSeat ? 40 : 25));
  } else if (value <= parValue) {
    paySplit(() => value);
  } else {
    paySplit((s) => (s === responsibleSeat ? 3 * value - 2 * parValue : parValue));
  }
  return deltas;
}

/**
 * Same-round immunity: who is responsible for a discard win?
 *
 * The window starts at (and includes) the winner's previous discard and runs
 * until just before the winning discard. If the winner's previous discard was
 * the winning tile, no one is responsible. Otherwise the first player in the
 * window who discarded the winning tile is responsible; failing that, the
 * final discarder is.
 *
 * `discardLog` is the game's chronological discard list *including* the
 * winning discard as its last entry.
 */
export function findResponsible(
  discardLog: { seat: number; tile: string }[],
  winnerSeat: number,
  winTile: string,
): number | null {
  const last = discardLog.length - 1;
  let windowStart = 0;
  for (let i = last - 1; i >= 0; i--) {
    if (discardLog[i].seat === winnerSeat) {
      windowStart = i;
      break;
    }
  }
  for (let i = windowStart; i < last; i++) {
    const d = discardLog[i];
    if (d.tile === winTile) {
      if (i >= windowStart && d.seat === winnerSeat && i === windowStart) return null;
      if (d.seat !== winnerSeat) return d.seat;
    }
  }
  return discardLog[last].seat;
}

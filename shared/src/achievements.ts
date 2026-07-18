/** Achievement catalogue (v0.2). Registered users only. */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'breaking-the-wall',
    name: 'Breaking the Wall',
    desc:
      'Play a match of any length to the end where all four players are registered humans — ' +
      'no guests, no bots, and no player leaving the match early.',
  },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

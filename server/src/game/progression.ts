// Character growth shared by the profile and the arena.

export interface Stats {
  strength: number; // bullet damage
  agility: number; // movement speed
  intuition: number; // reload speed
  endurance: number; // max HP
}

export const BASE_STATS: Stats = { strength: 3, agility: 3, intuition: 3, endurance: 3 };

export function maxHpFor(stats: Stats): number {
  return 2400 + stats.endurance * 200;
}

export function xpToNextLevel(level: number): number {
  return level * 50;
}

/** Applies earned XP; each level-up grants one free stat point. */
export function applyXp(level: number, xp: number, gained: number) {
  let lvl = level;
  let total = xp + gained;
  let levelsGained = 0;
  while (total >= xpToNextLevel(lvl)) {
    total -= xpToNextLevel(lvl);
    lvl += 1;
    levelsGained += 1;
  }
  return { level: lvl, xp: total, levelsGained };
}

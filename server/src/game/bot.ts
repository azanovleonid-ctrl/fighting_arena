import { BASE_STATS, type Rng, type Stats } from "./engine.js";

const NAMES = ["Громила", "Тень", "Бешеный Пёс", "Кузнец", "Вихрь", "Молчун", "Медведь", "Лис"];

/** A bot roughly as strong as a player of the given level: base stats plus one random point per level. */
export function makeBot(level: number, rng: Rng): { name: string; stats: Stats } {
  const stats = { ...BASE_STATS };
  const keys = Object.keys(stats) as (keyof Stats)[];
  for (let i = 1; i < level; i++) stats[keys[Math.floor(rng() * keys.length)]] += 1;
  return { name: NAMES[Math.floor(rng() * NAMES.length)], stats };
}

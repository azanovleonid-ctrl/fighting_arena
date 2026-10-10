// The 8 brawlers from docs/design.md, numbers for level 1.
export type BrawlerId = "hammer" | "spark" | "boomer" | "tinker" | "shade" | "thunder" | "blizzard" | "arrow";

export interface Brawler {
  id: BrawlerId;
  name: string;
  role: string;
  hp: number;
  speed: number;
  range: number;
  reloadMs: number;
  /** Damage of one projectile (or of the whole hit for melee and bombs). */
  damage: number;
  /** Hits on enemy brawlers needed to fill the super. */
  hitsToSuper: number;
  /** Projectile speed for straight shots. */
  shotSpeed: number;
}

export const BRAWLERS: Record<BrawlerId, Brawler> = {
  hammer: { id: "hammer", name: "Кувалда", role: "Танк", hp: 6000, speed: 245, range: 150, reloadMs: 1600, damage: 1500, hitsToSuper: 5, shotSpeed: 0 },
  spark: { id: "spark", name: "Искра", role: "Ближний бой", hp: 4600, speed: 235, range: 330, reloadMs: 1500, damage: 330, hitsToSuper: 23, shotSpeed: 920 },
  boomer: { id: "boomer", name: "Бумер", role: "Боец", hp: 3900, speed: 240, range: 520, reloadMs: 1500, damage: 600, hitsToSuper: 12, shotSpeed: 720 },
  tinker: { id: "tinker", name: "Винтик", role: "Инженер", hp: 3600, speed: 235, range: 520, reloadMs: 1200, damage: 360, hitsToSuper: 15, shotSpeed: 950 },
  shade: { id: "shade", name: "Тень", role: "Убийца", hp: 3500, speed: 265, range: 210, reloadMs: 1000, damage: 520, hitsToSuper: 10, shotSpeed: 1150 },
  thunder: { id: "thunder", name: "Гром", role: "Метатель", hp: 3400, speed: 225, range: 470, reloadMs: 1800, damage: 1150, hitsToSuper: 5, shotSpeed: 0 },
  blizzard: { id: "blizzard", name: "Вьюга", role: "Контроль", hp: 3400, speed: 235, range: 560, reloadMs: 1400, damage: 900, hitsToSuper: 7, shotSpeed: 850 },
  arrow: { id: "arrow", name: "Стрела", role: "Снайпер", hp: 3200, speed: 240, range: 620, reloadMs: 1250, damage: 380, hitsToSuper: 10, shotSpeed: 1050 },
};

export const BRAWLER_IDS = Object.keys(BRAWLERS) as BrawlerId[];

export const isBrawler = (v: unknown): v is BrawlerId => typeof v === "string" && v in BRAWLERS;

/** Level multiplier for HP, damage and turret HP: +8% per level above 1. */
export const levelMult = (level: number) => 1 + 0.08 * (Math.min(9, Math.max(1, level)) - 1);

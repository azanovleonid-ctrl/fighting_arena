// Pure turn-based combat rules. No I/O here, so the server and tests share one source of truth.

export const ZONES = ["head", "chest", "belly", "waist", "legs"] as const;
export type Zone = (typeof ZONES)[number];

export const BLOCKS_PER_TURN = 2;
export const MAX_ROUNDS = 50;

export interface Stats {
  strength: number; // damage
  agility: number; // dodge chance
  intuition: number; // crit chance
  endurance: number; // max HP
}

export interface Fighter {
  name: string;
  stats: Stats;
  hp: number;
  maxHp: number;
}

export interface Move {
  attack: Zone;
  blocks: Zone[];
}

export type HitOutcome = "hit" | "crit" | "blocked" | "crit_through_block" | "dodged";

export interface Strike {
  attacker: "player" | "opponent";
  zone: Zone;
  outcome: HitOutcome;
  damage: number;
}

export interface Round {
  number: number;
  playerMove: Move;
  opponentMove: Move;
  strikes: Strike[];
  playerHp: number;
  opponentHp: number;
}

export type FightResult = "win" | "loss" | "draw";

export interface FightState {
  player: Fighter;
  opponent: Fighter;
  rounds: Round[];
  result: FightResult | null;
}

export type Rng = () => number;

export const BASE_STATS: Stats = { strength: 3, agility: 3, intuition: 3, endurance: 3 };

export function maxHpFor(stats: Stats): number {
  return 40 + stats.endurance * 10;
}

export function makeFighter(name: string, stats: Stats): Fighter {
  const maxHp = maxHpFor(stats);
  return { name, stats, hp: maxHp, maxHp };
}

export function newFight(player: Fighter, opponent: Fighter): FightState {
  return { player, opponent, rounds: [], result: null };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function dodgeChance(attacker: Stats, defender: Stats): number {
  return clamp(0.05 + 0.04 * (defender.agility - attacker.agility), 0, 0.4);
}

export function critChance(attacker: Stats, defender: Stats): number {
  return clamp(0.05 + 0.04 * (attacker.intuition - defender.intuition), 0, 0.4);
}

export function isValidMove(move: Move): boolean {
  return (
    ZONES.includes(move.attack) &&
    move.blocks.length === BLOCKS_PER_TURN &&
    new Set(move.blocks).size === move.blocks.length &&
    move.blocks.every((z) => ZONES.includes(z))
  );
}

function strike(
  attacker: Fighter,
  defender: Fighter,
  attack: Zone,
  defenderBlocks: Zone[],
  rng: Rng,
): Omit<Strike, "attacker"> {
  const crit = rng() < critChance(attacker.stats, defender.stats);
  const baseDamage = attacker.stats.strength * 2 + 1 + Math.floor(rng() * 4);
  if (defenderBlocks.includes(attack)) {
    // Only a critical hit breaks through a block, and it loses its crit bonus doing so.
    return crit
      ? { zone: attack, outcome: "crit_through_block", damage: baseDamage }
      : { zone: attack, outcome: "blocked", damage: 0 };
  }
  if (rng() < dodgeChance(attacker.stats, defender.stats)) {
    return { zone: attack, outcome: "dodged", damage: 0 };
  }
  return crit
    ? { zone: attack, outcome: "crit", damage: Math.round(baseDamage * 1.5) }
    : { zone: attack, outcome: "hit", damage: baseDamage };
}

/** Resolves one simultaneous exchange and returns the new state; the input is not mutated. */
export function playRound(state: FightState, playerMove: Move, opponentMove: Move, rng: Rng): FightState {
  if (state.result) throw new Error("Fight is already finished");
  if (!isValidMove(playerMove) || !isValidMove(opponentMove)) throw new Error("Invalid move");

  const p = state.player;
  const o = state.opponent;
  const byPlayer = { attacker: "player" as const, ...strike(p, o, playerMove.attack, opponentMove.blocks, rng) };
  const byOpponent = { attacker: "opponent" as const, ...strike(o, p, opponentMove.attack, playerMove.blocks, rng) };

  const player = { ...p, hp: Math.max(0, p.hp - byOpponent.damage) };
  const opponent = { ...o, hp: Math.max(0, o.hp - byPlayer.damage) };
  const round: Round = {
    number: state.rounds.length + 1,
    playerMove,
    opponentMove,
    strikes: [byPlayer, byOpponent],
    playerHp: player.hp,
    opponentHp: opponent.hp,
  };
  const rounds = [...state.rounds, round];

  let result: FightResult | null = null;
  if (player.hp === 0 && opponent.hp === 0) result = "draw";
  else if (opponent.hp === 0) result = "win";
  else if (player.hp === 0) result = "loss";
  else if (rounds.length >= MAX_ROUNDS) result = "draw";

  return { player, opponent, rounds, result };
}

export function randomMove(rng: Rng): Move {
  const pick = () => ZONES[Math.floor(rng() * ZONES.length)];
  const attack = pick();
  const blocks: Zone[] = [];
  while (blocks.length < BLOCKS_PER_TURN) {
    const z = pick();
    if (!blocks.includes(z)) blocks.push(z);
  }
  return { attack, blocks };
}

/** XP earned for a finished fight. */
export function xpFor(result: FightResult): number {
  return result === "win" ? 20 : result === "draw" ? 8 : 5;
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

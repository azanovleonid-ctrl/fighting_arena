import { describe, expect, it } from "vitest";
import {
  applyXp,
  BASE_STATS,
  isValidMove,
  makeFighter,
  MAX_ROUNDS,
  newFight,
  playRound,
  randomMove,
  type Move,
} from "../src/game/engine.js";

// rng that returns the given values in order, then repeats the last one.
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const fight = () => newFight(makeFighter("A", BASE_STATS), makeFighter("B", BASE_STATS));
const move = (attack: Move["attack"], blocks: Move["blocks"]): Move => ({ attack, blocks });

describe("engine", () => {
  it("hits an unblocked zone for strength-based damage", () => {
    // player: no crit, damage roll 0, no dodge; opponent: same
    const s = playRound(fight(), move("head", ["legs", "waist"]), move("chest", ["legs", "waist"]), seq(0.99, 0, 0.99, 0.99, 0, 0.99));
    expect(s.rounds[0].strikes.map((x) => x.outcome)).toEqual(["hit", "hit"]);
    expect(s.player.hp).toBe(70 - 7);
    expect(s.opponent.hp).toBe(70 - 7);
    expect(s.result).toBeNull();
  });

  it("blocks a guarded zone unless the hit is critical", () => {
    const blocked = playRound(fight(), move("head", ["legs", "waist"]), move("legs", ["head", "chest"]), seq(0.99, 0, 0.99, 0));
    expect(blocked.rounds[0].strikes.map((x) => x.outcome)).toEqual(["blocked", "blocked"]);
    const crit = playRound(fight(), move("head", ["legs", "waist"]), move("legs", ["head", "chest"]), seq(0, 0));
    expect(crit.rounds[0].strikes[0].outcome).toBe("crit_through_block");
    expect(crit.opponent.hp).toBe(63);
  });

  it("ends in a win when the opponent drops to zero", () => {
    let s = fight();
    s = { ...s, opponent: { ...s.opponent, hp: 5 } };
    s = playRound(s, move("head", ["chest", "belly"]), move("head", ["chest", "belly"]), seq(0.99, 0, 0.99, 0.99, 0, 0.99));
    expect(s.opponent.hp).toBe(0);
    expect(s.result).toBe("win");
    expect(() => playRound(s, randomMove(Math.random), randomMove(Math.random), Math.random)).toThrow();
  });

  it("declares a draw after the round limit", () => {
    let s = fight();
    const both = move("head", ["head", "chest"]);
    for (let i = 0; i < MAX_ROUNDS; i++) s = playRound(s, both, both, () => 0.99);
    expect(s.result).toBe("draw");
  });

  it("rejects invalid moves", () => {
    expect(isValidMove(move("head", ["head", "head"]))).toBe(false);
    expect(isValidMove(move("head", ["chest"]))).toBe(false);
    for (let i = 0; i < 100; i++) expect(isValidMove(randomMove(Math.random))).toBe(true);
  });

  it("levels up and carries leftover xp", () => {
    expect(applyXp(1, 40, 20)).toEqual({ level: 2, xp: 10, levelsGained: 1 });
    expect(applyXp(1, 0, 5)).toEqual({ level: 1, xp: 5, levelsGained: 0 });
  });
});

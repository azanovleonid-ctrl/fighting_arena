// Arenas from docs/design.md: 30 × 30 tiles of 60 world pixels, edges walled.
// Tiles: '#' wall, 'b' bush (hides whoever stands in it), 'x' box (3600 HP, breaks), '.' floor.
export const TILE = 60;
export const ARENA_TILES = 30;
export const ARENA_SIZE = TILE * ARENA_TILES; // 1800
export const CENTER = ARENA_SIZE / 2;
export const BOX_HP = 3600;

export interface Vec {
  x: number;
  y: number;
}

/** Builds a 30 × 30 layout from its 15 × 15 top-left quarter mirrored on both axes. */
function mirror(quarter: string[]): string[] {
  const top = quarter.map((row) => row + [...row].reverse().join(""));
  return [...top, ...[...top].reverse()];
}

function edit(layout: string[], cells: [number, number][], ch: string): string[] {
  const grid = layout.map((row) => [...row]);
  for (const [c, r] of cells) grid[r][c] = ch;
  return grid.map((row) => row.join(""));
}

/** Tiles (col, row) whose centers lie within `radius` of a point. */
function tilesAround(p: Vec, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < ARENA_TILES; r++) {
    for (let c = 0; c < ARENA_TILES; c++) {
      if (Math.hypot(c * TILE + TILE / 2 - p.x, r * TILE + TILE / 2 - p.y) <= radius) out.push([c, r]);
    }
  }
  return out;
}

/** Survival spawns: 6 points on a circle of radius 690 around the center. */
export const SURVIVAL_SPAWNS: Vec[] = Array.from({ length: 6 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return { x: Math.round(CENTER + Math.cos(a) * 690), y: Math.round(CENTER + Math.sin(a) * 690) };
});

/** Team spawns: blue (team 0) at the bottom, red (team 1) at the top, 3 in a row 180 apart. */
export const TEAM_SPAWNS: Vec[][] = [
  [720, 900, 1080].map((x) => ({ x, y: ARENA_SIZE - 240 })),
  [720, 900, 1080].map((x) => ({ x, y: 240 })),
];

/** Survival arenas: spawn areas and the center are cleared, 4 boxes guard the center. */
function survivalArena(quarter: string[]): string[] {
  let layout = mirror(quarter);
  for (const s of SURVIVAL_SPAWNS) layout = edit(layout, tilesAround(s, 95), ".");
  layout = edit(layout, tilesAround({ x: CENTER, y: CENTER }, 130), ".");
  return edit(layout, [[12, 12], [17, 12], [12, 17], [17, 17]], "x");
}

/** Ball and beacon arenas: field narrowed to columns 6–23, the 6 × 6 center is always free. */
function fieldArena(quarter: string[]): string[] {
  const layout = mirror(quarter).map((row) => "#".repeat(6) + row.slice(6, 24) + "#".repeat(6));
  const center: [number, number][] = [];
  for (let r = 12; r < 18; r++) for (let c = 12; c < 18; c++) center.push([c, r]);
  return edit(layout, center, ".");
}

const SURVIVAL_QUARTERS = [
  [
    "###############",
    "#..............",
    "#..............",
    "#...bbb........",
    "#...bbb...##...",
    "#.........##...",
    "#..##.....x....",
    "#..##..........",
    "#.......bb.....",
    "#...x...bb..###",
    "#..............",
    "#.###.....x....",
    "#......bb......",
    "#......bb......",
    "#..............",
  ],
  [
    "###############",
    "#..............",
    "#.......bbb....",
    "#..##...bbb....",
    "#..#...........",
    "#..#......####.",
    "#.....x........",
    "#.bb...........",
    "#.bb....##.x...",
    "#.......##.....",
    "#....x.........",
    "#...........bb.",
    "#...###.....bb.",
    "#..............",
    "#..............",
  ],
];

// Columns 0–5 are walled off anyway; posts at column 10 frame an 8-tile goal opening (columns 11–18).
const BALL_QUARTER = [
  "###############",
  "#.........#....",
  "#.........#....",
  "#..............",
  "#..............",
  "#.......bb.....",
  "#.......bb..##.",
  "#..............",
  "#..............",
  "#......##......",
  "#......##...bb.",
  "#...........bb.",
  "#..............",
  "#..............",
  "#..............",
];

const BEACON_QUARTER = [
  "###############",
  "#..............",
  "#..............",
  "#..............",
  "#.......bbb....",
  "#..........##..",
  "#......##......",
  "#......#.......",
  "#.........bb...",
  "#.........bb...",
  "#.....###......",
  "#..............",
  "#........b.....",
  "#........b.....",
  "#..............",
];

export const SURVIVAL_LAYOUTS = SURVIVAL_QUARTERS.map(survivalArena);
export const BALL_LAYOUT = fieldArena(BALL_QUARTER);
export const BEACON_LAYOUT = fieldArena(BEACON_QUARTER);

/** Ball goals: 240-wide rectangles at the top and bottom edge of the field. Team 0 defends the bottom. */
export const GOAL_HALF_WIDTH = 120;
export const GOAL_DEPTH = 60;
export function goalRect(team: number) {
  const y0 = team === 0 ? ARENA_SIZE - TILE - GOAL_DEPTH : TILE;
  return { x0: CENTER - GOAL_HALF_WIDTH, x1: CENTER + GOAL_HALF_WIDTH, y0, y1: y0 + GOAL_DEPTH };
}

/** One match's copy of an arena: boxes break, so every match gets its own. */
export class ArenaMap {
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  private readonly grid: string[][];
  /** Remaining HP per box, keyed by tile index (row · cols + col). */
  readonly boxes = new Map<number, number>();

  constructor(readonly layout: string[]) {
    this.cols = layout[0].length;
    this.rows = layout.length;
    this.width = this.cols * TILE;
    this.height = this.rows * TILE;
    this.grid = layout.map((row) => [...row]);
    this.grid.forEach((row, r) => row.forEach((ch, c) => ch === "x" && this.boxes.set(r * this.cols + c, BOX_HP)));
  }

  tileAt(x: number, y: number): string {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return "#";
    return this.grid[r][c];
  }

  isWall = (x: number, y: number) => this.tileAt(x, y) === "#";
  isBush = (x: number, y: number) => this.tileAt(x, y) === "b";
  /** Walls and unbroken boxes block movement and bullets. */
  isSolid = (x: number, y: number) => {
    const t = this.tileAt(x, y);
    return t === "#" || t === "x";
  };

  boxIndexAt(x: number, y: number): number | null {
    if (this.tileAt(x, y) !== "x") return null;
    return Math.floor(y / TILE) * this.cols + Math.floor(x / TILE);
  }

  boxCenter(index: number): Vec {
    return { x: (index % this.cols) * TILE + TILE / 2, y: Math.floor(index / this.cols) * TILE + TILE / 2 };
  }

  /** Damages a box; returns true when it broke. */
  damageBox(index: number, damage: number): boolean {
    const hp = this.boxes.get(index);
    if (hp === undefined) return false;
    if (hp - damage > 0) {
      this.boxes.set(index, hp - damage);
      return false;
    }
    this.boxes.delete(index);
    this.grid[Math.floor(index / this.cols)][index % this.cols] = ".";
    return true;
  }

  /** Box indexes whose tile overlaps a circle. */
  boxesInCircle(x: number, y: number, radius: number): number[] {
    const out: number[] = [];
    for (const index of this.boxes.keys()) {
      const b = this.boxCenter(index);
      const nx = Math.max(b.x - TILE / 2, Math.min(x, b.x + TILE / 2));
      const ny = Math.max(b.y - TILE / 2, Math.min(y, b.y + TILE / 2));
      if (Math.hypot(x - nx, y - ny) <= radius) out.push(index);
    }
    return out;
  }

  /** True when no wall or box blocks the straight line between two points. */
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 15);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolid(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  /** Pushes a circle out of any wall or box tiles it overlaps. Returns the corrected position. */
  resolveWalls(x: number, y: number, radius: number): Vec {
    let px = x;
    let py = y;
    const c0 = Math.floor((px - radius) / TILE);
    const c1 = Math.floor((px + radius) / TILE);
    const r0 = Math.floor((py - radius) / TILE);
    const r1 = Math.floor((py + radius) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const inside = r >= 0 && r < this.rows && c >= 0 && c < this.cols;
        if (inside && this.grid[r][c] !== "#" && this.grid[r][c] !== "x") continue;
        const left = c * TILE;
        const top = r * TILE;
        const nx = Math.max(left, Math.min(px, left + TILE));
        const ny = Math.max(top, Math.min(py, top + TILE));
        const dx = px - nx;
        const dy = py - ny;
        const d = Math.hypot(dx, dy);
        if (d >= radius) continue;
        if (d > 0) {
          px = nx + (dx / d) * radius;
          py = ny + (dy / d) * radius;
        } else {
          // Center is inside the tile: push out along the shortest axis.
          const outs = [
            { d: px - left, x: left - radius, y: py },
            { d: left + TILE - px, x: left + TILE + radius, y: py },
            { d: py - top, x: px, y: top - radius },
            { d: top + TILE - py, x: px, y: top + TILE + radius },
          ].sort((a, b) => a.d - b.d);
          px = outs[0].x;
          py = outs[0].y;
        }
      }
    }
    return { x: px, y: py };
  }

  /** Nearest open floor point to `p` (used after jumps that land on a wall). */
  nearestOpen(p: Vec, radius: number): Vec {
    if (!this.isSolid(p.x, p.y)) return this.resolveWalls(p.x, p.y, radius);
    for (let ring = 1; ring < 6; ring++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const q = { x: p.x + Math.cos(a) * ring * TILE * 0.6, y: p.y + Math.sin(a) * ring * TILE * 0.6 };
        if (!this.isSolid(q.x, q.y)) return this.resolveWalls(q.x, q.y, radius);
      }
    }
    return p;
  }
}

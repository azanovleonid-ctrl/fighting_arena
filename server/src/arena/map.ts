// Arena layouts: '#' wall, 'b' bush (hides whoever stands in it), '.' floor,
// 'S' spawn (free-for-all), '1' / '2' team spawns, 'A' / 'B' goal of team 1 / team 2.
export const TILE = 64;

const BRAWL_LAYOUT = [
  "##############################",
  "#S.........bbb....bbb.......S#",
  "#..........bbb....bbb........#",
  "#...###..............###.....#",
  "#...#......##....##......#...#",
  "#...#..bb..##....##..bb..#...#",
  "#......bb............bb......#",
  "#bb..........####..........bb#",
  "#bb....##....#..#....##....bb#",
  "#S.....##..........S.##.....S#",
  "#......##....#..#....##......#",
  "#bb..........####..........bb#",
  "#bb....bb............bb....bb#",
  "#......bb..##....##..bb......#",
  "#...#......##....##......#...#",
  "#...#....................#...#",
  "#...###......bbbb......###...#",
  "#............bbbb............#",
  "#.......S..............S.....#",
  "##############################",
];

// Left half of the football pitch; the right half is its mirror with team 2 spawns.
const PITCH_LEFT = [
  "..............",
  "....bb........",
  "....bb....##..",
  "..1.......##..",
  "..............",
  "......##......",
  "......##......",
  "..1...........",
  "..............",
  "......##......",
  "......##......",
  "..............",
  "..1.......##..",
  "....bb....##..",
  "....bb........",
  "..............",
];
const GOAL_ROWS = [7, 8, 9, 10];

function buildFootballLayout(): string[] {
  const width = PITCH_LEFT[0].length * 2 + 4;
  const rows = ["#".repeat(width)];
  PITCH_LEFT.forEach((left, i) => {
    const right = [...left].reverse().join("").replaceAll("1", "2");
    const goal = GOAL_ROWS.includes(i + 1);
    rows.push("#" + (goal ? "A" : "#") + left + right + (goal ? "B" : "#") + "#");
  });
  rows.push("#".repeat(width));
  return rows;
}

export class ArenaMap {
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;

  constructor(readonly layout: string[]) {
    this.cols = layout[0].length;
    this.rows = layout.length;
    this.width = this.cols * TILE;
    this.height = this.rows * TILE;
  }

  tileAt(x: number, y: number): string {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return "#";
    return this.layout[r][c];
  }

  isWall = (x: number, y: number) => this.tileAt(x, y) === "#";
  isBush = (x: number, y: number) => this.tileAt(x, y) === "b";

  /** Centers of all tiles marked with `mark`. */
  points(mark: string): { x: number; y: number }[] {
    return this.layout.flatMap((row, r) =>
      [...row].flatMap((ch, c) => (ch === mark ? [{ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }] : [])),
    );
  }

  /** True when no wall blocks the straight line between two points. */
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 16);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  /** Pushes a circle out of any wall tiles it overlaps. Returns the corrected position. */
  resolveWalls(x: number, y: number, radius: number): { x: number; y: number } {
    let px = x;
    let py = y;
    const c0 = Math.floor((px - radius) / TILE);
    const c1 = Math.floor((px + radius) / TILE);
    const r0 = Math.floor((py - radius) / TILE);
    const r1 = Math.floor((py + radius) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r >= 0 && r < this.rows && c >= 0 && c < this.cols && this.layout[r][c] !== "#") continue;
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
}

export const BRAWL_MAP = new ArenaMap(BRAWL_LAYOUT);
export const FOOTBALL_MAP = new ArenaMap(buildFootballLayout());

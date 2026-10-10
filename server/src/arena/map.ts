// Arena layout: '#' wall, 'b' bush (hides whoever stands in it), 'S' spawn point, '.' floor.
export const TILE = 64;

export const LAYOUT = [
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

export const COLS = LAYOUT[0].length;
export const ROWS = LAYOUT.length;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

export function tileAt(x: number, y: number): string {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return "#";
  return LAYOUT[r][c];
}

export const isWall = (x: number, y: number) => tileAt(x, y) === "#";
export const isBush = (x: number, y: number) => tileAt(x, y) === "b";

export const SPAWNS: { x: number; y: number }[] = LAYOUT.flatMap((row, r) =>
  [...row].flatMap((ch, c) => (ch === "S" ? [{ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }] : [])),
);

/** True when no wall blocks the straight line between two points. */
export function lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(dist / 16);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

/** Pushes a circle out of any wall tiles it overlaps. Returns the corrected position. */
export function resolveWalls(x: number, y: number, radius: number): { x: number; y: number } {
  let px = x;
  let py = y;
  const c0 = Math.floor((px - radius) / TILE);
  const c1 = Math.floor((px + radius) / TILE);
  const r0 = Math.floor((py - radius) / TILE);
  const r1 = Math.floor((py + radius) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && LAYOUT[r][c] !== "#") continue;
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

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const snap = (v: number, grid: number): number => Math.round(v / grid) * grid;

export const snapIf = (v: number, grid: number, on: boolean): number => (on ? snap(v, grid) : v);

export const snapPoint = (p: Point, grid: number, on: boolean): Point =>
  on ? { x: snap(p.x, grid), y: snap(p.y, grid) } : p;

const TAN_22_5 = Math.tan(Math.PI / 8);

/**
 * Locks a line's direction to 0, 45 or 90 degrees (Shift while drawing).
 * Diagonals keep equal |dx| and |dy| so grid-snapped ends stay on the grid.
 */
export function lockAngle(dx: number, dy: number): Point {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay <= ax * TAN_22_5) return { x: dx, y: 0 };
  if (ax <= ay * TAN_22_5) return { x: 0, y: dy };
  const d = Math.max(ax, ay);
  return { x: Math.sign(dx) * d, y: Math.sign(dy) * d };
}

/** Rectangle from two corners, in any drag direction. */
export function boxFromCorners(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Square-up a drag (Shift for a circle): keeps the anchor corner, uses the larger side. */
export function squareCorner(a: Point, b: Point): Point {
  const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Reading order for a free-form page: top to bottom, then left to right,
 * treating elements whose tops are within `band` px as one row
 * (SPEC: Export, Markdown).
 */
export function readingOrder<T extends { x: number; y: number }>(
  items: readonly T[],
  band = 20,
): T[] {
  const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: T[] = [];
  let row: T[] = [];
  let rowTop = 0;
  for (const it of byTop) {
    if (row.length && it.y - rowTop > band) {
      out.push(...row.sort((a, b) => a.x - b.x));
      row = [];
    }
    if (!row.length) rowTop = it.y;
    row.push(it);
  }
  out.push(...row.sort((a, b) => a.x - b.x));
  return out;
}

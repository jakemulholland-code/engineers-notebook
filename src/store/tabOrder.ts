import type { TabConfig } from "../model/config";

/**
 * Moves `id` to insertion slot `slot`, where slots sit between the items of `ids`
 * (0 is before the first, `ids.length` after the last). Unknown ids leave the list as is.
 */
export function moveToSlot(ids: readonly string[], id: string, slot: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const clamped = Math.max(0, Math.min(ids.length, Math.round(slot)));
  const to = clamped > from ? clamped - 1 : clamped;
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** Gives visible tabs the orders 0, 1, 2... in `visibleIds` order; archived tabs follow. */
export function applyTabOrder(
  tabs: readonly TabConfig[],
  visibleIds: readonly string[],
): TabConfig[] {
  const rank = new Map(visibleIds.map((id, i) => [id, i]));
  const archived = tabs.filter((t) => !rank.has(t.id)).sort((a, b) => a.order - b.order);
  const archivedRank = new Map(archived.map((t, i) => [t.id, visibleIds.length + i]));
  return tabs.map((t) => ({ ...t, order: rank.get(t.id) ?? archivedRank.get(t.id) ?? t.order }));
}

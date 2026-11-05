/** Undo/redo stack of snapshots. Pure, so it is easy to test. */
export const HISTORY_LIMIT = 100;

export type History<T> = { past: T[]; future: T[] };

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Records `before` as an undo step; any redo steps are discarded. */
export function record<T>(h: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...h.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.past.length === 0) return null;
  const value = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, value };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.future.length === 0) return null;
  const [value, ...future] = h.future;
  return { history: { past: [...h.past, current], future }, value };
}

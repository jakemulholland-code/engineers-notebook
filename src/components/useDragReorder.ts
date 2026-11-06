import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

/** Pointer travel before a press becomes a drag, so ordinary clicks still work. */
const THRESHOLD = 6;

type Drag = { id: string; slot: number };

/**
 * Vertical drag-to-reorder with pointer events. HTML drag and drop is avoided because the
 * desktop shell takes over drag events for file drops on Windows.
 *
 * Items in the list carry `data-reorder-id`; `start(id)` goes on whatever the user grabs.
 * `onMove(id, slot)` gets an insertion slot: 0 is above the first item, n below the last.
 */
export function useDragReorder<T extends HTMLElement>(onMove: (id: string, slot: number) => void) {
  const listRef = useRef<T>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const swallowClick = useRef(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const slotAt = useCallback((y: number): number => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? [])];
    const i = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? items.length : i;
  }, []);

  const start = useCallback(
    (id: string) => (e: PointerEvent) => {
      if (e.button !== 0) return;
      const y0 = e.clientY;
      let active = false;
      const move = (ev: globalThis.PointerEvent) => {
        if (!active && Math.abs(ev.clientY - y0) < THRESHOLD) return;
        active = true;
        ev.preventDefault();
        setDrag({ id, slot: slotAt(ev.clientY) });
      };
      const end = (ev: globalThis.PointerEvent) => {
        cleanup();
        setDrag(null);
        if (!active) return;
        // The click that follows pointerup must not also open the tab.
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false), 0);
        if (ev.type === "pointerup") onMove(id, slotAt(ev.clientY));
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !active) return;
        ev.stopPropagation();
        active = false;
        cleanup();
        setDrag(null);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", key, true);
        stop.current = null;
      };
      stop.current?.();
      stop.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      window.addEventListener("keydown", key, true);
    },
    [onMove, slotAt],
  );

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** "before" or "after" for the item next to the drop slot; nothing where the drop is a no-op. */
  const dropMark = (ids: readonly string[], index: number): "before" | "after" | undefined => {
    if (!drag) return undefined;
    const from = ids.indexOf(drag.id);
    if (drag.slot === from || drag.slot === from + 1) return undefined;
    if (drag.slot === index) return "before";
    if (drag.slot === ids.length && index === ids.length - 1) return "after";
    return undefined;
  };

  return { listRef, drag, start, onClickCapture, dropMark };
}

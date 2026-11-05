import { useEffect, useMemo, useState } from "react";
import type { DateTag } from "../model/page";
import { backend } from "../storage/backend";
import { REMINDERS_CACHE_FILE, useNotebook, visibleTabs } from "../store/notebook";
import { toYmd } from "./dates";
import { buildIndex, type ReminderIndex, type ReminderItem } from "./index";

/**
 * The live reminders index, built from every loaded page in every visible tab.
 * Until all tabs have loaded, the index saved last session stands in for it.
 */
export function useReminderIndex(): { index: ReminderIndex; complete: boolean } {
  const tabs = useNotebook((s) => s.tabs);
  const config = useNotebook((s) => s.config);
  const cached = useNotebook((s) => s.cachedReminders);
  return useMemo(() => {
    const vis = visibleTabs(config);
    const ids = new Set(vis.map((t) => t.id));
    const complete = vis.every((t) => tabs[t.id] && tabs[t.id].status !== "loading");
    if (!complete && cached) {
      return {
        complete,
        index: {
          items: cached.items.filter((i) => ids.has(i.tabId)),
          pages: cached.pages.filter((p) => ids.has(p.tabId)),
        },
      };
    }
    const index = buildIndex(
      vis.flatMap((t) => {
        const st = tabs[t.id];
        return st?.status === "ok" ? [{ tabId: t.id, pages: st.pages.map((p) => p.page) }] : [];
      }),
    );
    return { index, complete };
  }, [tabs, config, cached]);
}

/** Saves the index to app data (debounced) so the next startup can show it at once. */
export function usePersistReminderCache() {
  const { index, complete } = useReminderIndex();
  useEffect(() => {
    if (!complete) return;
    const t = setTimeout(() => {
      void backend.writeAppFile(REMINDERS_CACHE_FILE, JSON.stringify(index)).catch(() => undefined);
    }, 2000);
    return () => clearTimeout(t);
  }, [index, complete]);
}

/** Today's date as YYYY-MM-DD, refreshed every minute so midnight rolls over. */
export function useToday(): string {
  const [today, setToday] = useState(() => toYmd(new Date()));
  useEffect(() => {
    const id = setInterval(() => setToday(toYmd(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

/** Ticks a reminder on or off in its source page (and its checklist box, if it has one). */
export function setReminderDone(
  item: Pick<ReminderItem, "tabId" | "pageId" | "elementId" | "itemId">,
  done: boolean,
) {
  const now = new Date().toISOString();
  const apply = (tag: DateTag): DateTag => {
    const next = { ...tag, done, doneAt: done ? now : undefined };
    if (!done) delete next.doneAt;
    return next;
  };
  useNotebook.getState().updatePageIn(item.tabId, item.pageId, (p) => ({
    ...p,
    elements: p.elements.map((el) => {
      if (el.id !== item.elementId) return el;
      if (item.itemId && el.type === "checklist") {
        return {
          ...el,
          updatedAt: now,
          items: el.items.map((i) =>
            i.id === item.itemId && i.date ? { ...i, done, date: apply(i.date) } : i,
          ),
        };
      }
      return el.date ? { ...el, updatedAt: now, date: apply(el.date) } : el;
    }),
  }));
}

import { addDays, endOfWeek, format } from "date-fns";
import type { DateTag, Element, Page } from "../model/page";
import { daysBetween, fromYmd, isOverdue, startOfToday, type DateKind } from "./dates";

export const ITEM_TEXT_LIMIT = 120;
export const DEFAULT_STALE_DAYS = 21;

/** One dated element or checklist item, wherever it lives. */
export type ReminderItem = {
  key: string;
  tabId: string;
  pageId: string;
  pageTitle: string;
  elementId: string;
  itemId?: string;
  text: string;
  tag: DateTag;
};

export type PageSummary = {
  tabId: string;
  pageId: string;
  title: string;
  updatedAt: string;
  hasOpenDates: boolean;
};

export type ReminderIndex = { items: ReminderItem[]; pages: PageSummary[] };

export type TabPages = { tabId: string; pages: Page[] };

const LABELS: Record<Element["type"], string> = {
  stroke: "Drawing",
  line: "Line",
  arrow: "Arrow",
  rect: "Box",
  ellipse: "Circle",
  text: "Note",
  checklist: "Checklist",
  image: "Image",
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const trimText = (s: string, limit = ITEM_TEXT_LIMIT) => {
  const c = clean(s);
  return c.length > limit ? `${c.slice(0, limit - 1).trimEnd()}…` : c;
};

/** Rough page-space box, good enough to find a label written inside a shape. */
function roughBox(el: Element): { x: number; y: number; w: number; h: number } | null {
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "image":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    default:
      return null;
  }
}

/** Readable text for a dated element: its own words, or a label written inside it. */
export function describeElement(el: Element, page: Page): string {
  switch (el.type) {
    case "text":
      return trimText(el.text) || LABELS.text;
    case "checklist":
      return trimText(el.items.map((i) => i.text).join(", ")) || LABELS.checklist;
    default: {
      const box = roughBox(el);
      if (box) {
        const inside = page.elements.find(
          (o) =>
            o.type === "text" &&
            o.x >= box.x &&
            o.x <= box.x + box.w &&
            o.y >= box.y &&
            o.y <= box.y + box.h,
        );
        if (inside && inside.type === "text" && clean(inside.text))
          return trimText(`${LABELS[el.type]}: ${inside.text}`);
      }
      return `${LABELS[el.type]} on ${page.title || "untitled page"}`;
    }
  }
}

export function buildIndex(tabs: TabPages[]): ReminderIndex {
  const items: ReminderItem[] = [];
  const pages: PageSummary[] = [];
  for (const { tabId, pages: tabPages } of tabs) {
    for (const page of tabPages) {
      let hasOpenDates = false;
      const add = (el: Element, tag: DateTag, text: string, itemId?: string) => {
        if (!tag.done) hasOpenDates = true;
        items.push({
          key: `${tabId}:${page.id}:${el.id}${itemId ? `:${itemId}` : ""}`,
          tabId,
          pageId: page.id,
          pageTitle: page.title,
          elementId: el.id,
          itemId,
          text,
          tag,
        });
      };
      for (const el of page.elements) {
        if (el.date) add(el, el.date, describeElement(el, page));
        if (el.type === "checklist") {
          for (const item of el.items)
            if (item.date) add(el, item.date, trimText(item.text) || "Checklist item", item.id);
        }
      }
      pages.push({
        tabId,
        pageId: page.id,
        title: page.title,
        updatedAt: page.updatedAt,
        hasOpenDates,
      });
    }
  }
  return { items, pages };
}

// ----- grouping -----

export type GroupId =
  "overdue" | "this_week" | "next_week" | "later" | "waiting" | "stale" | "done";

export type GroupedItem = ReminderItem & { overdue: boolean; daysWaited?: number };
export type StaleRow = PageSummary & { daysSince: number };

export type ReminderGroup =
  | { id: Exclude<GroupId, "stale">; title: string; note: string; items: GroupedItem[] }
  | { id: "stale"; title: string; note: string; pages: StaleRow[] };

export type ReminderFilter = {
  tabId?: string;
  kind?: DateKind;
  showDone: boolean;
  staleDays?: number;
};

const byDate = (a: ReminderItem, b: ReminderItem) =>
  a.tag.date.localeCompare(b.tag.date) || a.text.localeCompare(b.text);

/**
 * Groups, in order: Overdue, This week (to Sunday), Next week, Later,
 * Waiting on others, Not touched in 3 weeks, and Done (when shown).
 * Empty groups are left out.
 */
export function groupReminders(
  index: ReminderIndex,
  now: Date,
  filter: ReminderFilter,
): ReminderGroup[] {
  const today = startOfToday(now);
  const sunday = endOfWeek(today, { weekStartsOn: 1 });
  const nextMonday = addDays(startOfToday(sunday), 1);
  const nextSunday = addDays(startOfToday(sunday), 7);
  const staleDays = filter.staleDays ?? DEFAULT_STALE_DAYS;
  const fmt = (d: Date) => format(d, "EEE d MMM");

  const items = index.items
    .filter((i) => !filter.tabId || i.tabId === filter.tabId)
    .filter((i) => !filter.kind || i.tag.kind === filter.kind)
    .filter((i) => filter.showDone || !i.tag.done)
    .sort(byDate);

  const buckets: Record<Exclude<GroupId, "stale">, GroupedItem[]> = {
    overdue: [],
    this_week: [],
    next_week: [],
    later: [],
    waiting: [],
    done: [],
  };

  for (const item of items) {
    const overdue = isOverdue(item.tag, today);
    const g: GroupedItem = { ...item, overdue };
    if (item.tag.done) {
      buckets.done.push(g);
    } else if (item.tag.kind === "waiting_on") {
      buckets.waiting.push({ ...g, daysWaited: Math.max(0, daysBetween(item.tag.date, today)) });
    } else {
      const d = fromYmd(item.tag.date);
      if (overdue) buckets.overdue.push(g);
      else if (d <= sunday) buckets.this_week.push(g);
      else if (d <= nextSunday) buckets.next_week.push(g);
      else buckets.later.push(g);
    }
  }

  const stale: StaleRow[] = filter.kind
    ? []
    : index.pages
        .filter((p) => !filter.tabId || p.tabId === filter.tabId)
        .filter((p) => !p.hasOpenDates)
        .map((p) => ({ ...p, daysSince: daysBetween(p.updatedAt.slice(0, 10), today) }))
        .filter((p) => p.daysSince > staleDays)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  const groups: ReminderGroup[] = [
    {
      id: "overdue",
      title: "Overdue",
      note: "Past their date and not ticked off.",
      items: buckets.overdue,
    },
    {
      id: "this_week",
      title: "This week",
      note: `Up to ${fmt(sunday)}.`,
      items: buckets.this_week,
    },
    {
      id: "next_week",
      title: "Next week",
      note: `${fmt(nextMonday)} to ${fmt(nextSunday)}.`,
      items: buckets.next_week,
    },
    { id: "later", title: "Later", note: `After ${fmt(nextSunday)}.`, items: buckets.later },
    {
      id: "waiting",
      title: "Waiting on others",
      note: "Ball is in someone else’s court.",
      items: buckets.waiting,
    },
    {
      id: "stale",
      title: `Not touched in ${Math.round(staleDays / 7)} weeks`,
      note: "No date set, and the page hasn’t been edited lately.",
      pages: stale,
    },
    { id: "done", title: "Done", note: "Ticked off.", items: buckets.done },
  ];
  return groups.filter((g) => (g.id === "stale" ? g.pages.length > 0 : g.items.length > 0));
}

export function overdueCount(index: ReminderIndex, now: Date): number {
  return index.items.filter((i) => isOverdue(i.tag, now)).length;
}

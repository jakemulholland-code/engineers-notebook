import { addDays, format, subDays } from "date-fns";
import type { TabConfig } from "../model/config";
import type { DateTag, Element, Page } from "../model/page";
import type { Meeting } from "../model/meeting";
import { readingOrder } from "../model/readingOrder";
import { daysBetween, fromYmd, startOfToday, toYmd } from "../reminders/dates";
import { describeElement } from "../reminders/index";

/** Where a summary item points back to: a page (and element), or a meeting. */
export type Ref =
  | { tabId: string; pageId: string; elementId?: string; itemId?: string; meetingId?: undefined }
  | {
      tabId: string;
      meetingId: string;
      pageId?: undefined;
      elementId?: undefined;
      itemId?: undefined;
    };

export type CatchUpInput = {
  tabs: { tab: TabConfig; pages: Page[]; meetings?: Meeting[] }[];
  now: Date;
  lookAheadDays: number;
  staleDays: number;
  /** Only this tab, or all included tabs. */
  tabId?: string;
  recentDays?: number;
  /** Rough limit for the recent-pages section (SPEC: about 30,000 characters). */
  charBudget?: number;
  staleExcerpt?: number;
  /** Rough limit for meeting notes sent in full, newest first. */
  meetingBudget?: number;
};

export type CatchUpContext = {
  text: string;
  refs: Record<string, Ref>;
  stats: {
    dated: number;
    recentPages: number;
    stalePages: number;
    truncated: boolean;
    /** Meetings sent in full (older ones go as titles only). */
    meetings?: number;
  };
};

/** Meetings listed by title once the full-text budget is used up. */
const MAX_MEETING_TITLES = 30;

const KIND: Record<DateTag["kind"], string> = {
  due: "Due",
  follow_up: "Follow up",
  waiting_on: "Waiting on",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function when(tag: DateTag, today: Date): string {
  const d = daysBetween(tag.date, today); // positive = in the past
  if (tag.kind === "waiting_on")
    return d <= 0 ? "waiting since today" : `waiting ${d} day${d === 1 ? "" : "s"}`;
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} overdue`;
  if (d === 0) return "today";
  return `in ${-d} day${d === -1 ? "" : "s"}`;
}

/** The readable lines of one element, for page contents. */
function elementLines(el: Element): { text: string; itemId?: string }[] {
  switch (el.type) {
    case "text": {
      const t = oneLine(el.text);
      return t ? [{ text: el.heading ? `## ${t}` : t }] : [];
    }
    case "checklist":
      return el.items
        .filter((i) => oneLine(i.text))
        .map((i) => ({ text: `- [${i.done ? "x" : " "}] ${oneLine(i.text)}`, itemId: i.id }));
    case "image":
      return [{ text: "(pasted image)" }];
    default:
      return [];
  }
}

export function pagePlainText(page: Page): string {
  return readingOrder(page.elements)
    .flatMap(elementLines)
    .map((l) => l.text)
    .join("\n");
}

/**
 * Builds the compact text sent to the model (SPEC: What gets sent). Tabs marked
 * "Exclude from AI" and archived tabs are never read at all.
 */
export function buildCatchUpContext(input: CatchUpInput): CatchUpContext {
  const today = startOfToday(input.now);
  const recentDays = input.recentDays ?? 30;
  const budget = input.charBudget ?? 30_000;
  const excerpt = input.staleExcerpt ?? 300;
  const refs: Record<string, Ref> = {};
  let n = 0;
  const ref = (r: Ref) => {
    const id = `r${++n}`;
    refs[id] = r;
    return id;
  };

  const included = input.tabs.filter(
    ({ tab }) => !tab.excludeFromAi && !tab.archived && (!input.tabId || tab.id === input.tabId),
  );

  // ----- dated items -----
  type Dated = { line: string; date: string };
  const dated: Dated[] = [];
  const openDates = new Set<string>(); // page ids with any open date
  for (const { tab, pages } of included) {
    for (const page of pages) {
      for (const el of page.elements) {
        const add = (tag: DateTag, text: string, itemId?: string) => {
          if (tag.done) return;
          openDates.add(page.id);
          if (!tag.includeInSummary) return;
          const r = ref({ tabId: tab.id, pageId: page.id, elementId: el.id, itemId });
          dated.push({
            date: tag.date,
            line: `[${r}] ${KIND[tag.kind]} ${tag.date} (${when(tag, today)}) · ${tab.name} › ${page.title || "Untitled page"} · ${text}`,
          });
        };
        if (el.date) add(el.date, describeElement(el, page));
        if (el.type === "checklist")
          for (const i of el.items) if (i.date) add(i.date, oneLine(i.text), i.id);
      }
    }
  }
  dated.sort((a, b) => a.date.localeCompare(b.date));

  // ----- recently edited pages, newest first, within the character budget -----
  const recentCutoff = subDays(today, recentDays).toISOString();
  const recent = included
    .flatMap(({ tab, pages }) => pages.map((page) => ({ tab, page })))
    .filter(({ page }) => page.updatedAt >= recentCutoff)
    .sort((a, b) => b.page.updatedAt.localeCompare(a.page.updatedAt));

  const recentBlocks: string[] = [];
  let used = 0;
  let truncated = false;
  let recentCount = 0;
  for (const { tab, page } of recent) {
    if (used >= budget) {
      truncated = true;
      break;
    }
    const pr = ref({ tabId: tab.id, pageId: page.id });
    const lines = [
      `### [${pr}] ${tab.name} › ${page.title || "Untitled page"} (edited ${page.updatedAt.slice(0, 10)})`,
    ];
    for (const el of readingOrder(page.elements)) {
      for (const l of elementLines(el)) {
        const r = ref({ tabId: tab.id, pageId: page.id, elementId: el.id, itemId: l.itemId });
        lines.push(`[${r}] ${l.text}`);
      }
    }
    let block = lines.join("\n");
    if (used + block.length > budget) {
      block = `${block.slice(0, Math.max(0, budget - used))}\n… (cut short)`;
      truncated = true;
    }
    recentBlocks.push(block);
    used += block.length;
    recentCount++;
  }

  // ----- pages left alone, with no open dates -----
  const staleCutoff = subDays(today, input.staleDays).toISOString();
  const stale = included
    .flatMap(({ tab, pages }) => pages.map((page) => ({ tab, page })))
    .filter(({ page }) => page.updatedAt < staleCutoff && !openDates.has(page.id))
    .sort((a, b) => a.page.updatedAt.localeCompare(b.page.updatedAt))
    .map(({ tab, page }) => {
      const r = ref({ tabId: tab.id, pageId: page.id });
      const body = oneLine(pagePlainText(page)).slice(0, excerpt);
      return `[${r}] ${tab.name} › ${page.title || "Untitled page"} (last edited ${page.updatedAt.slice(0, 10)}): ${body || "(no text)"}`;
    });

  // ----- meeting notes, newest first: in full within their budget, then titles only -----
  const meetingBudget = input.meetingBudget ?? 20_000;
  const meetings = included
    .flatMap(({ tab, meetings: list }) =>
      (list ?? []).filter((m) => m.includeInAi).map((meeting) => ({ tab, meeting })),
    )
    .sort(
      (a, b) =>
        b.meeting.date.localeCompare(a.meeting.date) ||
        b.meeting.createdAt.localeCompare(a.meeting.createdAt),
    );
  const meetingBlocks: string[] = [];
  const meetingTitles: string[] = [];
  let meetingUsed = 0;
  for (const { tab, meeting } of meetings) {
    const r = ref({ tabId: tab.id, meetingId: meeting.id });
    const head = `${tab.name} › ${meeting.title} (meeting on ${meeting.date})`;
    if (meetingUsed >= meetingBudget) {
      if (meetingTitles.length < MAX_MEETING_TITLES) meetingTitles.push(`[${r}] ${head}`);
      else truncated = true;
      continue;
    }
    const body = meeting.body.replace(/\n{3,}/g, "\n\n").trim() || "(no notes)";
    let block = `### [${r}] ${head}\n${body}`;
    if (meetingUsed + block.length > meetingBudget) {
      block = `${block.slice(0, Math.max(0, meetingBudget - meetingUsed))}\n… (cut short)`;
      truncated = true;
    }
    meetingBlocks.push(block);
    meetingUsed += block.length;
  }

  const horizon = addDays(today, input.lookAheadDays);
  const tabLabel = input.tabId ? (included[0]?.tab.name ?? "one tab") : "all included tabs";
  const text = [
    `Today: ${format(today, "EEE d MMM yyyy")} (${toYmd(today)}).`,
    `Looking ahead: the next ${input.lookAheadDays} days, to ${format(horizon, "EEE d MMM yyyy")} (${toYmd(horizon)}).`,
    `Tabs: ${tabLabel}.`,
    "",
    "## Dated items (open)",
    dated.length ? dated.map((d) => d.line).join("\n") : "(none)",
    "",
    `## Pages edited in the last ${recentDays} days, newest first`,
    recentBlocks.length ? recentBlocks.join("\n\n") : "(none)",
    "",
    "## Meeting notes (pasted in from Granola and similar), newest first",
    meetingBlocks.length ? meetingBlocks.join("\n\n") : "(none)",
    ...(meetingTitles.length ? ["", "Older meetings, titles only:", meetingTitles.join("\n")] : []),
    "",
    `## Pages not touched for over ${input.staleDays} days, with no open dates`,
    stale.length ? stale.join("\n") : "(none)",
  ].join("\n");

  return {
    text,
    refs,
    stats: {
      dated: dated.length,
      recentPages: recentCount,
      stalePages: stale.length,
      truncated,
      meetings: meetingBlocks.length,
    },
  };
}

/** For tests and the panel's footnote: the date a "today" string refers to. */
export const ymdToDate = fromYmd;

import { describe, expect, it } from "vitest";
import type { DateTag, Element, Page } from "../model/page";
import { formatLong, isOverdue, parseUkDate, pillLabel } from "./dates";
import { buildIndex, describeElement, groupReminders, overdueCount, trimText } from "./index";

// Thursday 5 November 2026, mid-afternoon local time.
const TODAY = new Date(2026, 10, 5, 15, 30);

describe("parseUkDate", () => {
  const cases: [string, string | null][] = [
    ["12/11", "2026-11-12"],
    ["12/11/26", "2026-11-12"],
    ["12/11/2027", "2027-11-12"],
    ["1/2", "2027-02-01"], // more than two months ago this year, so next year
    ["2/10", "2026-10-02"], // a month ago stays this year (overdue)
    ["12 Nov", "2026-11-12"],
    ["12th November", "2026-11-12"],
    ["Thu 12 Nov 2026", "2026-11-12"], // our own display format parses back
    ["nov 12", "2026-11-12"],
    ["2026-11-12", "2026-11-12"],
    ["today", "2026-11-05"],
    ["tomorrow", "2026-11-06"],
    ["thu", "2026-11-05"], // today is Thursday
    ["next thu", "2026-11-12"],
    ["fri", "2026-11-06"],
    ["mon", "2026-11-09"],
    ["next mon", "2026-11-09"],
    ["Monday", "2026-11-09"],
    ["in 2 weeks", "2026-11-19"],
    ["2w", "2026-11-19"],
    ["3d", "2026-11-08"],
    ["in 1 month", "2026-12-05"],
    ["31/2", null],
    ["32/1", null],
    ["someday", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected}`, () => expect(parseUkDate(input, TODAY)).toBe(expected));
  }

  it("formats dates the UK way", () => {
    expect(formatLong("2026-11-12")).toBe("Thu 12 Nov 2026");
    expect(pillLabel({ kind: "due", date: "2026-11-09" }, TODAY)).toBe("Due Mon 9 Nov");
    expect(pillLabel({ kind: "follow_up", date: "2027-01-04" }, TODAY)).toBe(
      "Follow up Mon 4 Jan 2027",
    );
    expect(pillLabel({ kind: "waiting_on", date: "2026-10-30" }, TODAY)).toBe(
      "Waiting since Fri 30 Oct",
    );
  });

  it("treats yesterday as overdue but not waiting items or done items", () => {
    expect(isOverdue({ kind: "due", date: "2026-11-04", done: false }, TODAY)).toBe(true);
    expect(isOverdue({ kind: "due", date: "2026-11-05", done: false }, TODAY)).toBe(false);
    expect(isOverdue({ kind: "waiting_on", date: "2026-10-01", done: false }, TODAY)).toBe(false);
    expect(isOverdue({ kind: "due", date: "2026-11-01", done: true }, TODAY)).toBe(false);
  });
});

// ----- fixture notebook -----

const T = "2026-11-01T10:00:00.000Z";
const tag = (kind: DateTag["kind"], date: string, done = false): DateTag => ({
  kind,
  date,
  includeInSummary: true,
  done,
});
const text = (id: string, words: string, date?: DateTag, x = 0, y = 0): Element => ({
  id,
  type: "text",
  text: words,
  w: 300,
  fontSize: 17,
  colour: "#fff",
  heading: false,
  x,
  y,
  rotation: 0,
  createdAt: T,
  updatedAt: T,
  date,
});
const page = (id: string, title: string, elements: Element[], updatedAt = T): Page => ({
  schemaVersion: 1,
  id,
  title,
  createdAt: T,
  updatedAt,
  elements,
});

const fixture = [
  {
    tabId: "grade-a",
    pages: [
      page("p1", "Faceted navigation audit", [
        text("a", "Send redirect map for review", tag("due", "2026-11-02")), // overdue
        text("b", "Chase dev on the schema fix", tag("follow_up", "2026-11-03")), // overdue
        text("c", "Pull figures for the monthly report", tag("due", "2026-11-06")), // this week (Fri)
        text("d", "Finish backlink notes", tag("due", "2026-11-08")), // this week (Sun)
        text("e", "Today's item", tag("due", "2026-11-05")), // this week (today)
        {
          id: "cl",
          type: "checklist",
          w: 300,
          x: 0,
          y: 0,
          rotation: 0,
          createdAt: T,
          updatedAt: T,
          items: [
            {
              id: "i1",
              text: "Brief dev on noindex vs canonical",
              done: false,
              date: tag("follow_up", "2026-11-12"),
            }, // next week
            { id: "i2", text: "Already done", done: true, date: tag("due", "2026-11-01", true) }, // done
            { id: "i3", text: "No date", done: false },
          ],
        },
      ]),
    ],
  },
  {
    tabId: "quest",
    pages: [
      page("p2", "Migration", [
        text("f", "Faceted navigation audit", tag("due", "2026-11-09")), // next week (Mon)
        text("g", "Product feed access from the client", tag("waiting_on", "2026-10-30")), // waiting, 6 days
        text("h", "Q1 plan", tag("due", "2026-11-16")), // later (Mon after next week)
      ]),
      page("p3", "Page speed notes", [text("x", "Undated thoughts")], "2026-10-09T09:00:00.000Z"), // stale (27 days)
      page("p4", "Recent undated", [text("y", "Fresh")], "2026-10-20T09:00:00.000Z"), // 16 days: not stale
      page(
        "p5",
        "Old but dated",
        [text("z", "Dated", tag("due", "2026-12-01"))],
        "2026-09-01T09:00:00.000Z",
      ), // has open date: not stale
    ],
  },
];

const index = buildIndex(fixture);
const keys = (g: ReturnType<typeof groupReminders>[number]) =>
  g.id === "stale" ? g.pages.map((p) => p.pageId) : g.items.map((i) => i.itemId ?? i.elementId);

describe("reminder groups", () => {
  it("indexes every dated element and checklist item", () => {
    expect(index.items).toHaveLength(11);
    expect(index.items.find((i) => i.itemId === "i1")?.text).toBe(
      "Brief dev on noindex vs canonical",
    );
  });

  it("puts items in the spec's groups and order", () => {
    const groups = groupReminders(index, TODAY, { showDone: false });
    expect(groups.map((g) => g.id)).toEqual([
      "overdue",
      "this_week",
      "next_week",
      "later",
      "waiting",
      "stale",
    ]);
    const byId = Object.fromEntries(groups.map((g) => [g.id, keys(g)]));
    expect(byId.overdue).toEqual(["a", "b"]);
    expect(byId.this_week).toEqual(["e", "c", "d"]);
    expect(byId.next_week).toEqual(["f", "i1"]);
    expect(byId.later).toEqual(["h", "z"]);
    expect(byId.waiting).toEqual(["g"]);
    expect(byId.stale).toEqual(["p3"]);
  });

  it("describes the week boundaries in the notes", () => {
    const groups = groupReminders(index, TODAY, { showDone: false });
    expect(groups.find((g) => g.id === "this_week")?.note).toBe("Up to Sun 8 Nov.");
    expect(groups.find((g) => g.id === "next_week")?.note).toBe("Mon 9 Nov to Sun 15 Nov.");
  });

  it("shows days waited", () => {
    const waiting = groupReminders(index, TODAY, { showDone: false }).find(
      (g) => g.id === "waiting",
    );
    expect(waiting && waiting.id !== "stale" && waiting.items[0].daysWaited).toBe(6);
  });

  it("shows done items only when asked, in their own group", () => {
    const groups = groupReminders(index, TODAY, { showDone: true });
    const done = groups.find((g) => g.id === "done");
    expect(done && keys(done)).toEqual(["i2"]);
  });

  it("filters by kind and hides the stale group then", () => {
    const groups = groupReminders(index, TODAY, { showDone: false, kind: "follow_up" });
    expect(groups.map((g) => g.id)).toEqual(["overdue", "next_week"]);
  });

  it("filters by tab", () => {
    const groups = groupReminders(index, TODAY, { showDone: false, tabId: "quest" });
    expect(groups.flatMap(keys).sort()).toEqual(["f", "g", "h", "p3", "z"]);
  });

  it("counts overdue items for the badge", () => {
    expect(overdueCount(index, TODAY)).toBe(2);
  });

  it("names shapes by the label written inside them", () => {
    const box: Element = {
      id: "r",
      type: "rect",
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      colour: "#fff",
      width: 2,
      dashed: false,
      rotation: 0,
      createdAt: T,
      updatedAt: T,
    };
    const p = page("pp", "Sketch", [box, text("l", "Category page", undefined, 120, 120)]);
    expect(describeElement(box, p)).toBe("Box: Category page");
    expect(describeElement(box, page("pq", "Sketch", [box]))).toBe("Box on Sketch");
  });

  it("trims item text to 120 characters", () => {
    expect(trimText("x".repeat(200))).toHaveLength(120);
  });
});

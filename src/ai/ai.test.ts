import { describe, expect, it } from "vitest";
import type { TabConfig } from "../model/config";
import type { DateTag, Element, Page } from "../model/page";
import { readingOrder } from "../model/readingOrder";
import { buildCatchUpContext } from "./payload";
import { parseSummary, splitRefs, summaryAsText } from "./summary";

const NOW = new Date(2026, 10, 5, 11, 14); // Thu 5 Nov 2026
const T = (d: string) => `${d}T09:00:00.000Z`;
const tag = (kind: DateTag["kind"], date: string, extra: Partial<DateTag> = {}): DateTag => ({
  kind,
  date,
  includeInSummary: true,
  done: false,
  ...extra,
});
const text = (
  id: string,
  words: string,
  x: number,
  y: number,
  date?: DateTag,
  heading = false,
): Element => ({
  id,
  type: "text",
  text: words,
  w: 300,
  fontSize: 17,
  colour: "#fff",
  heading,
  x,
  y,
  rotation: 0,
  createdAt: T("2026-11-01"),
  updatedAt: T("2026-11-01"),
  date,
});
const page = (id: string, title: string, updated: string, elements: Element[]): Page => ({
  schemaVersion: 1,
  id,
  title,
  createdAt: T("2026-09-01"),
  updatedAt: T(updated),
  elements,
});
const tab = (id: string, name: string, excludeFromAi = false): TabConfig => ({
  id,
  name,
  colour: "#fff",
  folder: `C:/${name}`,
  order: 0,
  archived: false,
  excludeFromAi,
});

const tabs = [
  {
    tab: tab("ga", "Grade A Technology"),
    pages: [
      page("p1", "Faceted navigation audit", "2026-11-04", [
        text("h", "Next steps", 540, 396, undefined, true),
        text("n1", "Filter URLs are getting crawled", 60, 140, tag("due", "2026-11-09")),
        text("n2", "Check with dev", 960, 430),
        text(
          "hidden",
          "Private aside",
          60,
          600,
          tag("follow_up", "2026-11-12", { includeInSummary: false }),
        ),
        {
          id: "cl",
          type: "checklist",
          w: 340,
          x: 540,
          y: 430,
          rotation: 0,
          createdAt: T("2026-11-01"),
          updatedAt: T("2026-11-01"),
          items: [
            { id: "i1", text: "Pull facet URLs", done: true },
            {
              id: "i2",
              text: "Brief dev on noindex",
              done: false,
              date: tag("follow_up", "2026-11-12"),
            },
          ],
        },
      ]),
      page("p2", "Page speed notes", "2026-10-09", [
        text("s", "LCP is the problem on product pages. ".repeat(20), 0, 0),
      ]),
    ],
  },
  {
    tab: tab("sec", "Secret Client", true),
    pages: [
      page("p3", "Confidential merger plan", "2026-11-05", [
        text("x", "Do not share: Project Falcon", 0, 0, tag("due", "2026-11-01")),
      ]),
    ],
  },
  {
    tab: tab("q", "Quest Hardware"),
    pages: [
      page("p4", "Migration", "2026-10-30", [
        text("w", "Product feed access from the client", 0, 0, tag("waiting_on", "2026-10-30")),
        text("o", "Send redirect map", 0, 60, tag("due", "2026-11-02")),
        text("d", "Old done thing", 0, 120, tag("due", "2026-10-01", { done: true })),
      ]),
    ],
  },
];

const ctx = buildCatchUpContext({ tabs, now: NOW, lookAheadDays: 14, staleDays: 21 });

describe("catch-up payload", () => {
  it("leaves excluded tabs out entirely", () => {
    expect(ctx.text).not.toContain("Secret Client");
    expect(ctx.text).not.toContain("Confidential");
    expect(ctx.text).not.toContain("Falcon");
    expect(Object.values(ctx.refs).some((r) => r.tabId === "sec")).toBe(false);
  });

  it("states today, the window and the tab filter", () => {
    expect(ctx.text).toContain("Today: Thu 5 Nov 2026 (2026-11-05).");
    expect(ctx.text).toContain("to Thu 19 Nov 2026 (2026-11-19)");
    expect(ctx.text).toContain("Tabs: all included tabs.");
  });

  it("lists open dated items with how late or how long, sorted by date", () => {
    const dated = ctx.text.split("## Dated items (open)\n")[1].split("\n\n")[0].split("\n");
    expect(dated[0]).toMatch(
      /Waiting on 2026-10-30 \(waiting 6 days\) · Quest Hardware › Migration · Product feed/,
    );
    expect(dated[1]).toMatch(/Due 2026-11-02 \(3 days overdue\)/);
    expect(dated.some((l) => l.includes("Due 2026-11-09 (in 4 days)"))).toBe(true);
    expect(dated.some((l) => l.includes("Brief dev on noindex"))).toBe(true);
    expect(ctx.text).not.toContain("Old done thing (");
    expect(ctx.stats.dated).toBe(4);
  });

  it("respects Include in catch-up summaries", () => {
    expect(ctx.text.split("## Pages edited")[0]).not.toContain("Private aside");
  });

  it("gives every line a ref that points back to its source", () => {
    const m = ctx.text.match(/\[(r\d+)\] Check with dev/);
    expect(m).toBeTruthy();
    expect(ctx.refs[m![1]]).toEqual({ tabId: "ga", pageId: "p1", elementId: "n2" });
    const item = ctx.text.match(/\[(r\d+)\] - \[ \] Brief dev on noindex/);
    expect(ctx.refs[item![1]]).toMatchObject({ elementId: "cl", itemId: "i2" });
  });

  it("puts recent pages newest first in reading order", () => {
    const recent = ctx.text.split("## Pages edited in the last 30 days, newest first\n")[1];
    expect(recent.indexOf("Faceted navigation audit")).toBeLessThan(recent.indexOf("Migration"));
    const block = recent.split("### ")[1];
    expect(block.indexOf("Filter URLs")).toBeLessThan(block.indexOf("## Next steps"));
    expect(block.indexOf("## Next steps")).toBeLessThan(block.indexOf("Check with dev"));
  });

  it("sends only title and 300 characters of untouched pages", () => {
    const stale = ctx.text.split("with no open dates\n")[1];
    expect(stale).toMatch(/Grade A Technology › Page speed notes \(last edited 2026-10-09\)/);
    expect(stale.length).toBeLessThan(450);
    expect(ctx.stats.stalePages).toBe(1);
  });

  it("trims recent pages to the character budget", () => {
    const small = buildCatchUpContext({
      tabs,
      now: NOW,
      lookAheadDays: 14,
      staleDays: 21,
      charBudget: 120,
    });
    expect(small.stats.truncated).toBe(true);
    expect(small.text).toContain("… (cut short)");
  });

  it("can narrow to one tab", () => {
    const one = buildCatchUpContext({
      tabs,
      now: NOW,
      lookAheadDays: 14,
      staleDays: 21,
      tabId: "q",
    });
    expect(one.text).toContain("Tabs: Quest Hardware.");
    expect(one.text).not.toContain("Grade A");
  });

  it("never includes an excluded tab even when it is the chosen filter", () => {
    const sec = buildCatchUpContext({
      tabs,
      now: NOW,
      lookAheadDays: 14,
      staleDays: 21,
      tabId: "sec",
    });
    expect(sec.text).not.toContain("Falcon");
  });
});

describe("summary parsing", () => {
  const refs = { r1: {}, r2: {}, r3: {} };

  it("accepts the JSON shape, orders sections and drops unknown refs", () => {
    const raw = JSON.stringify({
      sections: [
        { title: "Coming up", items: [{ text: "Audit due Mon 9 Nov.", ref: "r2" }] },
        {
          title: "Do these first",
          items: [
            { text: "Redirect map is late.", ref: "[r1]" },
            { text: "Made up", ref: "r99" },
            { text: "No ref" },
          ],
        },
        { title: "Waiting on others", items: [{ text: "Only invented", ref: "r42" }] },
      ],
    });
    const p = parseSummary(raw, refs);
    expect(p.kind).toBe("sections");
    if (p.kind !== "sections") return;
    expect(p.sections.map((s) => s.title)).toEqual(["Do these first", "Coming up"]);
    expect(p.sections[0].items).toEqual([{ text: "Redirect map is late.", ref: "r1" }]);
    expect(p.dropped).toBe(3);
  });

  it("copes with code fences and chatter around the JSON", () => {
    const p = parseSummary(
      'Here you go:\n```json\n{"sections":[{"title":"Coming up","items":[{"text":"x","ref":"r3"}]}]}\n```',
      refs,
    );
    expect(p.kind).toBe("sections");
  });

  it("falls back to the raw text when it is not the JSON we asked for", () => {
    expect(parseSummary("Sorry, I can't help with that.", refs)).toEqual({
      kind: "raw",
      text: "Sorry, I can't help with that.",
    });
    expect(parseSummary('{"summary": "nope"}', refs).kind).toBe("raw");
  });

  it("splits chat answers into text and known refs", () => {
    expect(splitRefs("Send the map [r1] and chase [r99].", refs)).toEqual([
      { text: "Send the map" },
      { ref: "r1" },
      { text: " and chase" },
      { text: "." },
    ]);
  });

  it("copies as plain text", () => {
    const p = parseSummary(
      '{"sections":[{"title":"Coming up","items":[{"text":"Audit due","ref":"r2"}]}]}',
      refs,
    );
    expect(summaryAsText(p)).toBe("Coming up\n- Audit due");
  });
});

describe("reading order", () => {
  it("reads rows top to bottom, then left to right within 20 px", () => {
    const els = [
      { id: "c", x: 500, y: 105 },
      { id: "a", x: 60, y: 100 },
      { id: "b", x: 300, y: 118 },
      { id: "d", x: 10, y: 200 },
    ];
    expect(readingOrder(els).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });
});

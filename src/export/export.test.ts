import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { DateTag, Element, Page } from "../model/page";
import { buildIndex, groupReminders } from "../reminders/index";
import { pageToMarkdown, remindersMarkdown } from "./markdown";
import { safeName, uniqueNamer } from "./names";
import {
  A4_LANDSCAPE,
  addNotebookPage,
  contentsPageCount,
  imageBox,
  insertContents,
  newPdf,
  safeText,
  textPdf,
} from "./pdf";

const T = "2026-10-28T09:15:00.000Z";
const tag = (kind: DateTag["kind"], date: string, done = false): DateTag => ({
  kind,
  date,
  includeInSummary: true,
  done,
});
const base = { rotation: 0, createdAt: T, updatedAt: T };

const page: Page = {
  schemaVersion: 1,
  id: "p1",
  title: "Faceted navigation audit",
  createdAt: T,
  updatedAt: "2026-11-04T10:00:00.000Z",
  elements: [
    { ...base, id: "img", type: "image", asset: "assets/abc.png", w: 400, h: 220, x: 60, y: 360 },
    {
      ...base,
      id: "h",
      type: "text",
      text: "Next steps",
      w: 340,
      fontSize: 28,
      colour: "#fff",
      heading: true,
      x: 540,
      y: 396,
    },
    {
      ...base,
      id: "c",
      type: "checklist",
      w: 340,
      x: 540,
      y: 430,
      items: [
        { id: "i1", text: "Pull facet URLs from the crawl", done: true },
        {
          id: "i2",
          text: "Brief dev on noindex vs canonical",
          done: false,
          date: tag("follow_up", "2026-11-12"),
        },
      ],
    },
    {
      ...base,
      id: "n",
      type: "text",
      text: "Filter URLs are getting crawled\n# not a heading",
      w: 360,
      fontSize: 17,
      colour: "#fff",
      heading: false,
      x: 60,
      y: 140,
      date: tag("due", "2026-11-09"),
    },
    {
      ...base,
      id: "r",
      type: "rect",
      w: 160,
      h: 80,
      colour: "#fff",
      width: 2,
      dashed: false,
      x: 540,
      y: 140,
      date: tag("waiting_on", "2026-10-30"),
    },
    {
      ...base,
      id: "l",
      type: "text",
      text: "Category page",
      w: 140,
      fontSize: 15,
      colour: "#fff",
      heading: false,
      x: 560,
      y: 160,
    },
    {
      ...base,
      id: "s",
      type: "stroke",
      tool: "pen",
      points: [0, 0, 0.5, 10, 10, 0.5],
      colour: "#fff",
      width: 4,
      opacity: 1,
      x: 0,
      y: 0,
    },
  ] as Element[],
};

const opts = {
  tabName: "Grade A Technology",
  fileBase: "2026-10-28-faceted-navigation-audit",
  includeImages: true,
  includeDone: true,
};

describe("Markdown export", () => {
  const { markdown, assets } = pageToMarkdown(page, opts);

  it("starts with front matter", () => {
    expect(
      markdown.startsWith(
        '---\ntitle: "Faceted navigation audit"\ntab: "Grade A Technology"\ncreated: 2026-10-28T09:15:00.000Z\nupdated: 2026-11-04T10:00:00.000Z\n---\n',
      ),
    ).toBe(true);
  });

  it("puts the page snapshot first", () => {
    const body = markdown.split("---\n")[2];
    expect(
      body.indexOf("![Page snapshot](assets/2026-10-28-faceted-navigation-audit-snapshot.png)"),
    ).toBeLessThan(body.indexOf("Filter URLs"));
  });

  it("writes text in reading order with headings, checklists and inline dates", () => {
    const order = [
      "Filter URLs",
      "Box: Category page",
      "Category page",
      "![Image](assets/abc.png)",
      "## Next steps",
      "- [x] Pull facet URLs",
      "- [ ] Brief dev",
    ];
    const idx = order.map((s) => markdown.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(markdown).toContain("- [ ] Brief dev on noindex vs canonical (Follow up: 2026-11-12)");
    expect(markdown).toContain("(Due: 2026-11-09)");
    expect(markdown).toContain("Box: Category page (Waiting on: 2026-10-30)");
  });

  it("keeps typed text from becoming Markdown syntax", () => {
    expect(markdown).toContain("Filter URLs are getting crawled  \n\\# not a heading");
  });

  it("lists pasted images to copy", () => {
    expect(assets).toEqual(["assets/abc.png"]);
  });

  it("can leave out images and done items", () => {
    const r = pageToMarkdown(page, { ...opts, includeImages: false, includeDone: false });
    expect(r.markdown).not.toContain("![");
    expect(r.markdown).not.toContain("Pull facet URLs");
    expect(r.assets).toEqual([]);
  });

  it("writes Reminders as task lists", () => {
    const groups = groupReminders(
      buildIndex([{ tabId: "ga", pages: [page] }]),
      new Date(2026, 10, 5),
      { showDone: false },
    );
    const md = remindersMarkdown(groups, () => "Grade A Technology", new Date(2026, 10, 5));
    expect(md).toContain("# Reminders");
    expect(md).toContain("## Next week");
    expect(md).toContain(
      "- [ ] Brief dev on noindex vs canonical (Follow up: 2026-11-12) · Grade A Technology › Faceted navigation audit",
    );
    expect(md).toContain("## Waiting on others");
    expect(md).toMatch(/Waiting on: 2026-10-30, 6 days/);
  });
});

describe("names", () => {
  it("makes Windows-safe names", () => {
    expect(safeName('Grade A: "Tech"/QA?')).toBe("Grade A- -Tech--QA-");
    expect(safeName("CON")).toBe("CON_");
    expect(safeName("trailing dots...")).toBe("trailing dots");
    expect(safeName("   ")).toBe("Untitled");
  });

  it("keeps names unique, ignoring case", () => {
    const next = uniqueNamer();
    expect([next("Notes"), next("notes"), next("Notes")]).toEqual([
      "Notes",
      "notes (2)",
      "Notes (3)",
    ]);
  });
});

// A real 2x1 PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mNkYPj/n4GBgQEADQMCAZ8jUbAAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const colours = { background: "#0C1332", text: "#E9EDFD", muted: "#B9C6E6" };

describe("PDF export", () => {
  it("fits the 1600x1100 sheet inside landscape A4 with room for header and footer", () => {
    const b = imageBox();
    expect(b.w / b.h).toBeCloseTo(1600 / 1100, 5);
    expect(b.x).toBeGreaterThanOrEqual(24);
    expect(b.y).toBeGreaterThanOrEqual(26);
    expect(b.y + b.h).toBeLessThanOrEqual(A4_LANDSCAPE[1] - 30);
  });

  it("builds landscape A4 pages and a contents page in front", async () => {
    const { doc, fonts } = await newPdf("Grade A Technology");
    for (let i = 0; i < 3; i++) {
      await addNotebookPage(
        doc,
        fonts,
        PNG,
        { tabName: "Grade A", pageTitle: `Page ${i}`, created: "Wed 28 Oct 2026" },
        colours,
        i + 2,
        4,
      );
    }
    insertContents(
      doc,
      fonts,
      colours,
      "Grade A",
      "Exported",
      [1, 2, 3].map((n) => ({ title: `Page ${n}`, created: "x", pageNumber: n + 1 })),
      4,
    );
    const loaded = await PDFDocument.load(await doc.save());
    expect(loaded.getPageCount()).toBe(4);
    for (const p of loaded.getPages()) {
      const { width, height } = p.getSize();
      expect(width).toBeCloseTo(841.89, 1);
      expect(height).toBeCloseTo(595.28, 1);
    }
    expect(contentsPageCount(3)).toBe(1);
    expect(contentsPageCount(50)).toBe(3);
  });

  it("replaces characters the standard fonts cannot draw", async () => {
    const { fonts } = await newPdf("x");
    expect(safeText(fonts.regular, "Café “quotes” 🚀 中")).toBe("Café “quotes” ? ?");
  });

  it("wraps long text documents across pages", async () => {
    const bytes = await textPdf(
      "Reminders",
      [
        {
          heading: "Overdue",
          lines: Array.from({ length: 80 }, (_, i) => `Item ${i} ${"word ".repeat(30)}`),
        },
      ],
      colours,
    );
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(2);
  });
});

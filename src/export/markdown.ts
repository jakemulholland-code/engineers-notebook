import { format } from "date-fns";
import type { DateTag, Element, Page } from "../model/page";
import { readingOrder } from "../model/readingOrder";
import { KIND_LABEL, formatShort } from "../reminders/dates";
import { describeElement, type ReminderGroup } from "../reminders/index";

export type MarkdownOptions = {
  tabName: string;
  /** The page file name without `.page.json`; names the snapshot image. */
  fileBase: string;
  includeImages: boolean;
  includeDone: boolean;
};

export const snapshotPath = (fileBase: string) => `assets/${fileBase}-snapshot.png`;

/** Stops typed text being read as Markdown syntax at the start of a line. */
function escapeLine(line: string): string {
  return line.replace(/^(\s*)([#>+*-]|\d+[.)])(\s)/, "$1\\$2$3");
}

const yaml = (s: string) => JSON.stringify(s);

function dateNote(tag: DateTag | undefined, includeDone: boolean): string {
  if (!tag) return "";
  if (tag.done && !includeDone) return "";
  return ` (${KIND_LABEL[tag.kind]}: ${tag.date}${tag.done ? ", done" : ""})`;
}

function paragraph(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => escapeLine(l.trimEnd()))
    .join("  \n");
}

/** One element as Markdown, or nothing for undated drawings. */
function elementMarkdown(
  el: Element,
  page: Page,
  opts: MarkdownOptions,
  assets: string[],
): string | null {
  switch (el.type) {
    case "text": {
      if (!el.text.trim()) return null;
      const note = dateNote(el.date, opts.includeDone);
      if (el.heading) return `## ${el.text.replace(/\s+/g, " ").trim()}${note}`;
      return `${paragraph(el.text.trim())}${note}`;
    }
    case "checklist": {
      const lines = el.items
        .filter((i) => opts.includeDone || !i.done)
        .map(
          (i) =>
            `- [${i.done ? "x" : " "}] ${i.text.replace(/\s+/g, " ").trim()}${dateNote(i.date, opts.includeDone)}`,
        );
      const note = dateNote(el.date, opts.includeDone);
      if (!lines.length && !note) return null;
      return [...lines, ...(note ? [`Checklist${note}`] : [])].join("\n");
    }
    case "image": {
      if (!opts.includeImages) return null;
      assets.push(el.asset);
      return `![Image](${el.asset})${dateNote(el.date, opts.includeDone)}`;
    }
    default: {
      const note = dateNote(el.date, opts.includeDone);
      return note ? `${describeElement(el, page)}${note}` : null;
    }
  }
}

/**
 * A page as Markdown (SPEC: Export, Markdown): front matter, the page snapshot
 * first, then text in reading order. Returns the pasted images to copy.
 */
export function pageToMarkdown(
  page: Page,
  opts: MarkdownOptions,
): { markdown: string; assets: string[] } {
  const assets: string[] = [];
  const blocks: string[] = [];
  for (const el of readingOrder(page.elements)) {
    const md = elementMarkdown(el, page, opts, assets);
    if (md) blocks.push(md);
  }
  const front = [
    "---",
    `title: ${yaml(page.title || "Untitled page")}`,
    `tab: ${yaml(opts.tabName)}`,
    `created: ${page.createdAt}`,
    `updated: ${page.updatedAt}`,
    "---",
  ].join("\n");
  const parts = [front, "", `# ${page.title || "Untitled page"}`, ""];
  if (opts.includeImages) parts.push(`![Page snapshot](${snapshotPath(opts.fileBase)})`, "");
  parts.push(blocks.length ? blocks.join("\n\n") : "_No text on this page._", "");
  return { markdown: parts.join("\n"), assets: [...new Set(assets)] };
}

/** Reminders as task lists, one section per group. */
export function remindersMarkdown(
  groups: ReminderGroup[],
  tabName: (tabId: string) => string,
  today: Date,
): string {
  const out = ["# Reminders", "", `Exported ${format(today, "EEE d MMM yyyy")}.`, ""];
  if (!groups.length) out.push("Nothing dated.", "");
  for (const g of groups) {
    out.push(`## ${g.title}`, "");
    if (g.id === "stale") {
      for (const p of g.pages) {
        out.push(
          `- ${p.title || "Untitled page"} (${tabName(p.tabId)}, last edited ${formatShort(p.updatedAt.slice(0, 10), today)})`,
        );
      }
    } else {
      for (const i of g.items) {
        const extra =
          g.id === "waiting" && i.daysWaited !== undefined ? `, ${i.daysWaited} days` : "";
        out.push(
          `- [${i.tag.done ? "x" : " "}] ${i.text} (${KIND_LABEL[i.tag.kind]}: ${i.tag.date}${extra}) · ${tabName(i.tabId)} › ${i.pageTitle || "Untitled page"}`,
        );
      }
    }
    out.push("");
  }
  return out.join("\n");
}

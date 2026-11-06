import { newId, slugify } from "./page";
import { parseUkDate, toYmd } from "../reminders/dates";

/**
 * Meeting notes pasted in from Granola (or anywhere), one Markdown file each in
 * `<notes>/meetings/<date>-<slug>.md`. The file is readable on its own: a short
 * front matter block, then the notes exactly as pasted.
 */
export type Meeting = {
  id: string;
  title: string;
  /** The day of the meeting, YYYY-MM-DD. */
  date: string;
  source: string;
  /** Sent to the AI for catch-ups and questions. */
  includeInAi: boolean;
  createdAt: string;
  updatedAt: string;
  body: string;
};

export type LoadedMeeting = { fileName: string; meeting: Meeting };

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Front matter values are written as JSON, so any title or quote round-trips safely. */
export function serialiseMeeting(m: Meeting): string {
  const fields: [string, unknown][] = [
    ["id", m.id],
    ["title", m.title],
    ["date", m.date],
    ["source", m.source],
    ["includeInAi", m.includeInAi],
    ["createdAt", m.createdAt],
    ["updatedAt", m.updatedAt],
  ];
  const head = fields.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
  const body = m.body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return `---\n${head}\n---\n\n${body}\n`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a meeting file. Files without front matter (dropped in by hand) still load:
 * the title comes from the first line and the date from the file name.
 */
export function parseMeeting(text: string, fileName: string, now: Date = new Date()): Meeting {
  const fromName = fileName.match(/^(\d{4}-\d{2}-\d{2})-?(.*)\.md$/i);
  const fallbackDate = fromName?.[1] ?? toYmd(now);
  const match = text.match(FRONT);
  const raw: Record<string, unknown> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (!kv) continue;
      try {
        raw[kv[1]] = JSON.parse(kv[2]);
      } catch {
        raw[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  const body = (match ? text.slice(match[0].length) : text)
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "");
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const stamp = now.toISOString();
  const date = str(raw.date, fallbackDate);
  return {
    id: str(raw.id, `file:${fileName}`),
    title: str(
      raw.title,
      titleFromPaste(body) ?? (fromName?.[2] || fileName.replace(/\.md$/i, "")),
    ),
    date: ISO_DAY.test(date) ? date : fallbackDate,
    source: str(raw.source, "pasted"),
    includeInAi: raw.includeInAi !== false,
    createdAt: str(raw.createdAt, stamp),
    updatedAt: str(raw.updatedAt, str(raw.createdAt, stamp)),
    body,
  };
}

export function createMeeting(
  input: { title: string; date: string; body: string; source?: string },
  now: Date = new Date(),
): Meeting {
  const iso = now.toISOString();
  return {
    id: newId(),
    title: input.title.trim() || "Meeting",
    date: input.date,
    source: input.source ?? "granola",
    includeInAi: true,
    createdAt: iso,
    updatedAt: iso,
    body: input.body.replace(/\r\n/g, "\n").replace(/\s+$/, ""),
  };
}

/** `<date>-<slug>.md`, with -2, -3... when the name is taken. */
export function meetingFileName(
  m: Pick<Meeting, "date" | "title">,
  taken: ReadonlySet<string>,
): string {
  const stem = `${m.date}-${slugify(m.title)}`;
  let name = `${stem}.md`;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.md`;
  return name;
}

/**
 * The notes for display, without the leading lines that only repeat what the header
 * already shows: the title, and a short line holding the meeting's date (Granola copies
 * start with both). The file itself keeps everything as pasted.
 */
export function notesForDisplay(m: Pick<Meeting, "title" | "date" | "body">): string {
  const lines = m.body.split("\n");
  const plain = (l: string) =>
    l
      .replace(/^\s*#+\s*/, "")
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .trim();
  let i = 0;
  while (i < lines.length) {
    const l = plain(lines[i]);
    const repeatsTitle = l.toLowerCase() === m.title.trim().toLowerCase();
    const repeatsDate = l.length > 0 && l.length <= 80 && dateFromPaste(l) === m.date;
    if (l === "" || repeatsTitle || repeatsDate) i++;
    else break;
  }
  return lines.slice(i).join("\n");
}

/** The first non-empty line of pasted notes, without Markdown heading marks, as a title. */
export function titleFromPaste(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*#+\s*/, "")
        .replace(/^\*\*(.*)\*\*$/, "$1")
        .trim(),
    )
    .find((l) => l.length > 0);
  return line ? line.slice(0, 100) : undefined;
}

const MONTH_DATE =
  /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4})\b/i;
const MONTH_FIRST =
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}))\b/i;
const ISO_IN_TEXT = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * A meeting date written near the top of pasted notes ("Thu 5 Nov 2026", "November 5, 2026",
 * "2026-11-05"). Only full dates with a year count, so nothing is guessed from "today".
 */
export function dateFromPaste(text: string, now: Date = new Date()): string | undefined {
  const head = text.split(/\r?\n/).slice(0, 6).join(" ");
  const iso = head.match(ISO_IN_TEXT)?.[1];
  if (iso && parseUkDate(iso, now) === iso) return iso;
  const dm = head.match(MONTH_DATE)?.[1];
  if (dm)
    return (
      parseUkDate(dm.replace(/(\d)(st|nd|rd|th)/i, "$1").replace(/\.|,/g, ""), now) ?? undefined
    );
  const md = head.match(MONTH_FIRST);
  if (md) {
    const month = md[1].split(/\s+/)[0].replace(/\./, "");
    return parseUkDate(`${md[2]} ${month} ${md[3]}`, now) ?? undefined;
  }
  return undefined;
}

import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, isValid } from "date-fns";
import type { DateTag } from "../model/page";

export type DateKind = DateTag["kind"];

export const KIND_LABEL: Record<DateKind, string> = {
  due: "Due",
  follow_up: "Follow up",
  waiting_on: "Waiting on",
};

/** Local calendar date as YYYY-MM-DD. */
export function toYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD as a local Date at midnight. */
export function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const startOfToday = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** "Thu 12 Nov 2026" (UK `ddd d MMM yyyy`). */
export const formatLong = (ymd: string) => format(fromYmd(ymd), "EEE d MMM yyyy");

/** "Mon 9 Nov", adding the year only when it is not the current one. */
export function formatShort(ymd: string, today: Date): string {
  const d = fromYmd(ymd);
  return format(d, d.getFullYear() === today.getFullYear() ? "EEE d MMM" : "EEE d MMM yyyy");
}

/** Pill text: "Due Mon 9 Nov", "Follow up Thu 12 Nov", "Waiting since Fri 30 Oct". */
export function pillLabel(tag: Pick<DateTag, "kind" | "date">, today: Date): string {
  const when = formatShort(tag.date, today);
  return tag.kind === "waiting_on" ? `Waiting since ${when}` : `${KIND_LABEL[tag.kind]} ${when}`;
}

export function isOverdue(tag: Pick<DateTag, "kind" | "date" | "done">, today: Date): boolean {
  return !tag.done && tag.kind !== "waiting_on" && fromYmd(tag.date) < startOfToday(today);
}

export const daysBetween = (fromYmdStr: string, today: Date) =>
  differenceInCalendarDays(startOfToday(today), fromYmd(fromYmdStr));

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** The next given weekday: on or after today, or strictly after with `next`. */
export function nextWeekday(today: Date, weekday: number, strictlyAfter: boolean): Date {
  const base = startOfToday(today);
  let diff = (weekday - base.getDay() + 7) % 7;
  if (diff === 0 && strictlyAfter) diff = 7;
  return addDays(base, diff);
}

function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return isValid(date) && date.getFullYear() === y && date.getMonth() === m && date.getDate() === d
    ? date
    : null;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Day and month with no year: this year, unless that is more than two months ago. */
function withoutYear(today: Date, m: number, d: number): Date | null {
  const base = startOfToday(today);
  const thisYear = makeDate(base.getFullYear(), m, d);
  if (!thisYear) return makeDate(base.getFullYear() + 1, m, d);
  return differenceInCalendarDays(base, thisYear) > 60
    ? makeDate(base.getFullYear() + 1, m, d)
    : thisYear;
}

/**
 * Parses what people type into the date field, UK style:
 * "12/11", "12/11/26", "12 Nov", "Thu 12 Nov 2026", "2026-11-12", "today", "tomorrow",
 * "thu", "next mon", "in 2 weeks", "3d", "2w". Returns YYYY-MM-DD or null.
 */
export function parseUkDate(input: string, today: Date = new Date()): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, "");
  if (!s) return null;
  const base = startOfToday(today);
  const out = (d: Date | null) => (d ? toYmd(d) : null);

  if (s === "today" || s === "tod") return toYmd(base);
  if (["tomorrow", "tmrw", "tmr", "tom"].includes(s)) return toYmd(addDays(base, 1));
  if (s === "yesterday") return toYmd(addDays(base, -1));

  let m = s.match(/^(?:in )?(\d+) ?(d|day|days|w|wk|wks|week|weeks|m|month|months)$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2][0];
    return toYmd(
      unit === "d" ? addDays(base, n) : unit === "w" ? addWeeks(base, n) : addMonths(base, n),
    );
  }

  m = s.match(/^(next )?([a-z]+)$/);
  if (m && m[2] in WEEKDAYS) return toYmd(nextWeekday(base, WEEKDAYS[m[2]], !!m[1]));
  if (s === "next week") return toYmd(nextWeekday(base, 1, true));

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return out(makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return out(m[3] ? makeDate(fullYear(Number(m[3])), mo, d) : withoutYear(base, mo, d));
  }

  // "12 nov", "12th november 2026", "thu 12 nov 2026"
  m = s.match(/^(?:[a-z]+ )?(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{2}|\d{4}))?$/);
  if (m && m[2] in MONTHS) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]];
    return out(m[3] ? makeDate(fullYear(Number(m[3])), mo, d) : withoutYear(base, mo, d));
  }

  // "nov 12", "november 12 2026"
  m = s.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/);
  if (m && m[1] in MONTHS) {
    const d = Number(m[2]);
    const mo = MONTHS[m[1]];
    return out(m[3] ? makeDate(fullYear(Number(m[3])), mo, d) : withoutYear(base, mo, d));
  }
  return null;
}

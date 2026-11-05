import { z } from "zod";

/** The newest page schema this build understands. */
export const PAGE_SCHEMA_VERSION = 1 as const;

/** Fixed sheet size in page coordinates (SPEC: Visual design). */
export const PAGE_WIDTH = 1600;
export const PAGE_HEIGHT = 1100;

const isoDateTime = z.string().min(1);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const DateTagSchema = z.object({
  kind: z.enum(["due", "follow_up", "waiting_on"]),
  date: ymd,
  includeInSummary: z.boolean(),
  done: z.boolean(),
  doneAt: isoDateTime.optional(),
});

const base = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  date: DateTagSchema.optional(),
};

const StrokeSchema = z.object({
  ...base,
  type: z.literal("stroke"),
  tool: z.enum(["pen", "brush"]),
  points: z.array(z.number()),
  colour: z.string(),
  width: z.number(),
  opacity: z.number(),
});

const linePoints = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const LineSchema = z.object({
  ...base,
  type: z.literal("line"),
  points: linePoints,
  colour: z.string(),
  width: z.number(),
});
const ArrowSchema = LineSchema.extend({ type: z.literal("arrow") });

const RectSchema = z.object({
  ...base,
  type: z.literal("rect"),
  w: z.number(),
  h: z.number(),
  colour: z.string(),
  width: z.number(),
  dashed: z.boolean(),
});
const EllipseSchema = RectSchema.extend({ type: z.literal("ellipse") });

const TextSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string(),
  w: z.number(),
  fontSize: z.number(),
  colour: z.string(),
  heading: z.boolean(),
});

const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  done: z.boolean(),
  date: DateTagSchema.optional(),
});

const ChecklistSchema = z.object({
  ...base,
  type: z.literal("checklist"),
  w: z.number(),
  items: z.array(ChecklistItemSchema),
});

const ImageSchema = z.object({
  ...base,
  type: z.literal("image"),
  asset: z.string().regex(/^assets\/[^/\\]+$/, "Expected assets/<file>"),
  w: z.number(),
  h: z.number(),
});

export const ElementSchema = z.discriminatedUnion("type", [
  StrokeSchema,
  LineSchema,
  ArrowSchema,
  RectSchema,
  EllipseSchema,
  TextSchema,
  ChecklistSchema,
  ImageSchema,
]);

export const PageSchema = z.object({
  schemaVersion: z.literal(PAGE_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  elements: z.array(ElementSchema),
});

export type DateTag = z.infer<typeof DateTagSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type ElementType = Element["type"];
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type Page = z.infer<typeof PageSchema>;

export type ParsedPage =
  | { ok: true; page: Page; readOnly: boolean; warning?: string }
  | { ok: false; error: string };

/**
 * Parse a page file. A page written by a newer app (higher schemaVersion) opens
 * read-only: we show whatever elements we recognise and refuse to save.
 */
export function parsePage(text: string): ParsedPage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "The page file is not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "The page file is not a JSON object." };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number") {
    return { ok: false, error: "The page file has no schemaVersion." };
  }

  if (version > PAGE_SCHEMA_VERSION) {
    return parseFuturePage(raw as Record<string, unknown>, version);
  }

  const result = PageSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") || "page";
    return { ok: false, error: `The page file is invalid at ${where}: ${issue?.message ?? "unknown"}` };
  }
  return { ok: true, page: result.data, readOnly: false };
}

function parseFuturePage(raw: Record<string, unknown>, version: number): ParsedPage {
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const now = new Date().toISOString();
  const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
  const elements: Element[] = [];
  for (const el of rawElements) {
    const r = ElementSchema.safeParse(el);
    if (r.success) elements.push(r.data);
  }
  const skipped = rawElements.length - elements.length;
  return {
    ok: true,
    readOnly: true,
    warning:
      `This page was saved by a newer version of the app (schema ${version}). It is open read-only.` +
      (skipped > 0 ? ` ${skipped} item(s) could not be shown.` : ""),
    page: {
      schemaVersion: PAGE_SCHEMA_VERSION,
      id: str(raw.id, "unknown"),
      title: str(raw.title, "Untitled"),
      createdAt: str(raw.createdAt, now),
      updatedAt: str(raw.updatedAt, now),
      elements,
    },
  };
}

export function serialisePage(page: Page): string {
  return JSON.stringify(page, null, 2) + "\n";
}

export function newId(): string {
  return crypto.randomUUID();
}

export function createPage(now: Date = new Date(), title = "Untitled page"): Page {
  const iso = now.toISOString();
  return { schemaVersion: PAGE_SCHEMA_VERSION, id: newId(), title, createdAt: iso, updatedAt: iso, elements: [] };
}

/** Lower-case, ASCII, hyphen-separated slug; never empty. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** `<created YYYY-MM-DD>-<slug>.page.json`, using the local date the page was created. */
export function pageFileName(page: Pick<Page, "createdAt" | "title">, suffix = ""): string {
  const d = new Date(page.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = Number.isNaN(d.getTime())
    ? page.createdAt.slice(0, 10)
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${day}-${slugify(page.title)}${suffix}.page.json`;
}

/** Picks a file name that does not clash with `taken` (adds -2, -3, ...). */
export function uniquePageFileName(
  page: Pick<Page, "createdAt" | "title">,
  taken: ReadonlySet<string>,
): string {
  let name = pageFileName(page);
  for (let n = 2; taken.has(name); n++) name = pageFileName(page, `-${n}`);
  return name;
}

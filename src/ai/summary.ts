import { z } from "zod";
import { SECTION_TITLES } from "./prompts";

export type SummaryItem = { text: string; ref: string };
export type SummarySection = { title: string; items: SummaryItem[] };

export type ParsedSummary =
  { kind: "sections"; sections: SummarySection[]; dropped: number } | { kind: "raw"; text: string };

const ResponseSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      items: z.array(z.object({ text: z.string(), ref: z.string().optional() }).passthrough()),
    }),
  ),
});

const normRef = (r: string | undefined) => (r ?? "").trim().replace(/^\[|\]$/g, "");

/** Pulls the JSON object out of a reply that may be wrapped in a code fence or prose. */
function extractJson(raw: string): unknown {
  const unfenced = raw.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  return JSON.parse(unfenced.slice(start, end + 1));
}

/**
 * Validates the model's reply. Items whose ref is missing or unknown are
 * dropped; if the reply is not the expected JSON, the raw text is kept to show
 * instead of an error (SPEC: What comes back).
 */
export function parseSummary(raw: string, knownRefs: Record<string, unknown>): ParsedSummary {
  let data: z.infer<typeof ResponseSchema>;
  try {
    const r = ResponseSchema.safeParse(extractJson(raw));
    if (!r.success) return { kind: "raw", text: raw.trim() };
    data = r.data;
  } catch {
    return { kind: "raw", text: raw.trim() };
  }

  let dropped = 0;
  const byTitle = new Map<string, SummaryItem[]>();
  for (const s of data.sections) {
    const title = s.title.trim();
    const items: SummaryItem[] = [];
    for (const it of s.items) {
      const ref = normRef(it.ref);
      if (!ref || !(ref in knownRefs) || !it.text.trim()) {
        dropped++;
        continue;
      }
      items.push({ text: it.text.trim(), ref });
    }
    byTitle.set(title, [...(byTitle.get(title) ?? []), ...items]);
  }

  const order = (t: string) => {
    const i = (SECTION_TITLES as readonly string[]).indexOf(t);
    return i < 0 ? SECTION_TITLES.length : i;
  };
  const sections = [...byTitle.entries()]
    .map(([title, items]) => ({ title, items }))
    .filter((s) => s.items.length > 0)
    .sort((a, b) => order(a.title) - order(b.title));
  return { kind: "sections", sections, dropped };
}

/** Splits a chat answer into text and [rN] references, dropping refs that do not exist. */
export function splitRefs(
  text: string,
  knownRefs: Record<string, unknown>,
): ({ text: string } | { ref: string })[] {
  const out: ({ text: string } | { ref: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(/\s?\[(r\d+)\]/g)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx) });
    if (m[1] in knownRefs) out.push({ ref: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Plain text for Copy summary. */
export function summaryAsText(s: ParsedSummary): string {
  if (s.kind === "raw") return s.text;
  return s.sections
    .map((sec) => `${sec.title}\n${sec.items.map((i) => `- ${i.text}`).join("\n")}`)
    .join("\n\n");
}

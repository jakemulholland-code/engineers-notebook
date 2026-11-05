const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A folder or file name that is safe on Windows (and elsewhere). */
export function safeName(name: string, fallback = "Untitled"): string {
  let s = [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 ? "-" : ch))
    .join("")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim();
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `${s}_`;
  return s;
}

/** Makes names unique within one export, adding " (2)", " (3)", ... */
export function uniqueNamer() {
  const used = new Set<string>();
  return (name: string) => {
    let n = 1;
    let candidate = name;
    while (used.has(candidate.toLowerCase())) candidate = `${name} (${++n})`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

export const pageBase = (fileName: string) => fileName.replace(/\.page\.json$/, "");

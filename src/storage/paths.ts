/** Joins path parts using the separator style of the first part (Windows or POSIX). */
export function joinPath(first: string, ...rest: string[]): string {
  const sep = first.includes("\\") && !first.includes("/") ? "\\" : "/";
  const trimmed = first.replace(/[\\/]+$/, "");
  return [trimmed, ...rest.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ""))].join(sep);
}

export function notesPathFor(folder: string): string {
  return joinPath(folder, "notes");
}

export function pagePath(notesPath: string, fileName: string): string {
  return joinPath(notesPath, "pages", fileName);
}

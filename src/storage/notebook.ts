import { parsePage, serialisePage, type Page } from "../model/page";
import { backend } from "./backend";
import { notesPathFor, pagePath } from "./paths";

export type LoadedPage = {
  fileName: string;
  page: Page;
  readOnly: boolean;
  warning?: string;
};

/**
 * The exact text the app last read from or wrote to each page file, keyed by path. A watcher
 * event whose file still holds this text came from the app itself, not from outside.
 */
const knownText = new Map<string, string>();

export function knownDiskText(path: string): string | undefined {
  return knownText.get(path);
}

export function rememberDiskText(path: string, text: string): void {
  knownText.set(path, text);
}

export function forgetDiskText(path: string): void {
  knownText.delete(path);
}

export type TabLoadResult =
  | { status: "ok"; notesPath: string; pages: LoadedPage[]; errors: string[] }
  | { status: "missing"; notesPath: string };

/**
 * Reads every page in a client's notes folder. A missing folder is reported,
 * never recreated (SPEC: Saving rules).
 */
export async function loadTab(folder: string): Promise<TabLoadResult> {
  const notesPath = notesPathFor(folder);
  if (!(await backend.pathExists(notesPath))) return { status: "missing", notesPath };

  const names = await backend.listPageFiles(notesPath);
  const pages: LoadedPage[] = [];
  const errors: string[] = [];
  for (const fileName of names) {
    try {
      const path = pagePath(notesPath, fileName);
      const text = await backend.readTextFile(path);
      rememberDiskText(path, text);
      const parsed = parsePage(text);
      if (parsed.ok) {
        pages.push({
          fileName,
          page: parsed.page,
          readOnly: parsed.readOnly,
          warning: parsed.warning,
        });
      } else {
        errors.push(`${fileName}: ${parsed.error}`);
      }
    } catch (e) {
      errors.push(`${fileName}: ${String(e)}`);
    }
  }
  pages.sort((a, b) => a.page.createdAt.localeCompare(b.page.createdAt));
  return { status: "ok", notesPath, pages, errors };
}

export async function savePage(notesPath: string, fileName: string, page: Page): Promise<void> {
  const path = pagePath(notesPath, fileName);
  const text = serialisePage(page);
  // Remember before writing, so the watcher event for this write is recognised as ours.
  rememberDiskText(path, text);
  await backend.writeTextAtomic(path, text);
}

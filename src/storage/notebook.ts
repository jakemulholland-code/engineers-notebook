import { parsePage, serialisePage, type Page } from "../model/page";
import { backend } from "./backend";
import { notesPathFor, pagePath } from "./paths";

export type LoadedPage = {
  fileName: string;
  page: Page;
  readOnly: boolean;
  warning?: string;
};

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
      const text = await backend.readTextFile(pagePath(notesPath, fileName));
      const parsed = parsePage(text);
      if (parsed.ok) {
        pages.push({ fileName, page: parsed.page, readOnly: parsed.readOnly, warning: parsed.warning });
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
  await backend.writeTextAtomic(pagePath(notesPath, fileName), serialisePage(page));
}

import { parsePage, serialisePage, type Page } from "../model/page";
import { parseMeeting, serialiseMeeting, type LoadedMeeting, type Meeting } from "../model/meeting";
import { backend } from "./backend";
import { joinPath, notesPathFor, pagePath } from "./paths";

export function meetingPath(notesPath: string, fileName: string): string {
  return joinPath(notesPath, "meetings", fileName);
}

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
  | {
      status: "ok";
      notesPath: string;
      pages: LoadedPage[];
      meetings: LoadedMeeting[];
      errors: string[];
    }
  | { status: "missing"; notesPath: string };

/** Newest meeting first; same day, most recently added first. */
export function sortMeetings(list: LoadedMeeting[]): LoadedMeeting[] {
  return [...list].sort(
    (a, b) =>
      b.meeting.date.localeCompare(a.meeting.date) ||
      b.meeting.createdAt.localeCompare(a.meeting.createdAt),
  );
}

/** Reads `<notes>/meetings/*.md`. Unreadable files are reported, never changed. */
export async function loadMeetings(
  notesPath: string,
): Promise<{ meetings: LoadedMeeting[]; errors: string[] }> {
  const meetings: LoadedMeeting[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const fileName of await backend.listMeetingFiles(notesPath)) {
    try {
      const text = await backend.readTextFile(meetingPath(notesPath, fileName));
      const meeting = parseMeeting(text, fileName);
      // A copied file keeps its id; give the copy its own so both can be opened.
      if (seen.has(meeting.id)) meeting.id = `file:${fileName}`;
      seen.add(meeting.id);
      meetings.push({ fileName, meeting });
    } catch (e) {
      errors.push(`meetings/${fileName}: ${String(e)}`);
    }
  }
  return { meetings: sortMeetings(meetings), errors };
}

export async function saveMeeting(
  notesPath: string,
  fileName: string,
  meeting: Meeting,
): Promise<void> {
  await backend.writeMeetingFile(notesPath, fileName, serialiseMeeting(meeting));
}

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
  const m = await loadMeetings(notesPath).catch((e) => ({
    meetings: [] as LoadedMeeting[],
    errors: [`meetings: ${String(e)}`],
  }));
  return { status: "ok", notesPath, pages, meetings: m.meetings, errors: [...errors, ...m.errors] };
}

export async function savePage(notesPath: string, fileName: string, page: Page): Promise<void> {
  const path = pagePath(notesPath, fileName);
  const text = serialisePage(page);
  // Remember before writing, so the watcher event for this write is recognised as ours.
  rememberDiskText(path, text);
  await backend.writeTextAtomic(path, text);
}

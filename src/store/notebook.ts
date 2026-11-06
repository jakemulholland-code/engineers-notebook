import { create } from "zustand";
import { defaultConfig, parseConfig, type AppConfig, type TabConfig } from "../model/config";
import {
  createPage,
  newId,
  pageFileName,
  parsePage,
  uniquePageFileName,
  type Element,
  type Page,
} from "../model/page";
import {
  emptyHistory,
  record,
  redo as redoStep,
  undo as undoStep,
  type History,
} from "../canvas/history";
import { duplicate } from "../canvas/elements";
import { applyTabOrder, moveToSlot } from "./tabOrder";
import { backend } from "../storage/backend";
import {
  forgetDiskText,
  knownDiskText,
  loadTab,
  rememberDiskText,
  saveMeeting,
  savePage,
  sortMeetings,
  type LoadedPage,
} from "../storage/notebook";
import { pagePath } from "../storage/paths";
import type { ReminderIndex } from "../reminders/index";
import { createMeeting, meetingFileName, type LoadedMeeting, type Meeting } from "../model/meeting";

export const REMINDERS_CACHE_FILE = "reminders-cache.json";

export const AUTOSAVE_DELAY_MS = 800;

export type TabState =
  | { status: "loading" }
  | { status: "missing"; notesPath: string }
  | {
      status: "ok";
      notesPath: string;
      pages: LoadedPage[];
      /** Meeting notes, newest first. */
      meetings: LoadedMeeting[];
      errors: string[];
    };

export type MeetingEdit = Partial<Pick<Meeting, "title" | "date" | "body" | "includeInAi">>;

export type View = { kind: "tab"; tabId: string } | { kind: "reminders" } | { kind: "empty" };

export type SaveState =
  | { kind: "saved"; at?: Date }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "read-only"; reason: string }
  | { kind: "error"; message: string };

type NotebookStore = {
  ready: boolean;
  config: AppConfig;
  tabs: Record<string, TabState>;
  currentPage: Record<string, string>;
  view: View;
  save: SaveState;
  settingsOpen: boolean;
  notice: string | null;

  init(): Promise<void>;
  updateConfig(mutate: (c: AppConfig) => AppConfig): Promise<void>;
  addClient(input: {
    name: string;
    colour: string;
    folder: string;
    notesPath: string;
  }): Promise<void>;
  changeFolder(tabId: string, folder: string, notesPath: string): Promise<void>;
  /**
   * "Move existing notes": saves pending edits, copies the tab's notes folder into
   * `<folder>/notes`, verifies it, bins the old copy and points the tab at the new folder.
   * Throws (with the original untouched) if the move cannot be done safely.
   */
  moveNotes(tabId: string, folder: string): Promise<void>;
  /** Renames a tab (and its `notebook.json`). Blank names are ignored. */
  renameTab(tabId: string, name: string): Promise<void>;
  setTabColour(tabId: string, colour: string): Promise<void>;
  /** Hides a tab from the side; its files are untouched. Opens a neighbour if it was open. */
  archiveTab(tabId: string): Promise<void>;
  /** Brings an archived tab back at the end of the list and opens it. */
  restoreTab(tabId: string): Promise<void>;
  /** Moves a visible tab to an insertion slot (0 = top, n = bottom). */
  moveTab(tabId: string, slot: number): Promise<void>;
  reloadTab(tabId: string): Promise<void>;
  openTab(tabId: string): void;
  openReminders(): void;
  setSettingsOpen(open: boolean): void;
  dismissNotice(): void;
  newPage(): Promise<void>;
  /** Copies a page (fresh ids, today's date) and opens the copy. */
  duplicatePage(tabId: string, pageId: string): Promise<void>;
  /** Moves a page's file to the Recycle Bin and opens a neighbouring page. */
  deletePage(tabId: string, pageId: string): Promise<boolean>;
  /** Sets a page's title; the autosave renames its file to match. */
  renamePage(tabId: string, pageId: string, title: string): void;
  pageListOpen: boolean;
  /** The open tab shows its meeting notes instead of its pages. */
  meetingsOpen: boolean;
  /** The meeting shown in the Meetings view. */
  selectedMeeting: string | null;
  showMeetings(open: boolean): void;
  /** Opens a tab's Meetings view on one meeting (from the catch-up panel, say). */
  openMeeting(tabId: string, meetingId: string): void;
  /** Saves a new meeting into the tab's `notes/meetings` and selects it; returns its id. */
  addMeeting(tabId: string, input: { title: string; date: string; body: string }): Promise<string>;
  /** Saves changes at once, renaming the file when the date or title changes. */
  updateMeeting(tabId: string, meetingId: string, edit: MeetingEdit): Promise<void>;
  /** Moves the meeting's file to the Recycle Bin. */
  deleteMeeting(tabId: string, meetingId: string): Promise<void>;
  setPageListOpen(open: boolean): void;
  goToPage(delta: number): void;
  updatePage(mutate: (p: Page) => Page): void;
  /** Changes any loaded page (not just the current one) and autosaves it. */
  updatePageIn(tabId: string, pageId: string, mutate: (p: Page) => Page): void;
  /** Opens a page, optionally centring on and flashing one element. */
  openPageAt(tabId: string, pageId: string, elementId?: string): void;
  flash: { elementId: string; nonce: number } | null;
  clearFlash(): void;
  /** The reminders index saved last session, shown until every tab has loaded. */
  cachedReminders: ReminderIndex | null;
  /** Changes the current page's elements as one undoable step. */
  editElements(mutate: (els: Element[]) => Element[]): void;
  undo(): void;
  redo(): void;
  /** Bumped whenever undo/redo availability may have changed. */
  historyTick: number;
  flushSaves(): Promise<void>;
  /**
   * Applies page files changed outside the app (from the folder watcher). Pages without
   * unsaved edits are reloaded, added or removed; pages with unsaved edits keep the in-app
   * version and show a notice.
   */
  applyOutsideChanges(notesPath: string, fileNames: string[], rescan?: boolean): Promise<void>;
};

const histories = new Map<string, History<Element[]>>();

export function historyFor(pageId: string | undefined): { canUndo: boolean; canRedo: boolean } {
  const h = pageId ? histories.get(pageId) : undefined;
  return { canUndo: !!h && h.past.length > 0, canRedo: !!h && h.future.length > 0 };
}

const sameElements = (a: Element[], b: Element[]) =>
  a.length === b.length && a.every((el, i) => el === b[i]);

export const visibleTabs = (c: AppConfig): TabConfig[] =>
  c.tabs.filter((t) => !t.archived).sort((a, b) => a.order - b.order);

export function currentPageOf(s: Pick<NotebookStore, "view" | "tabs" | "currentPage">): {
  tabId: string;
  loaded: LoadedPage;
  index: number;
  count: number;
} | null {
  if (s.view.kind !== "tab") return null;
  const tabId = s.view.tabId;
  const t = s.tabs[tabId];
  if (!t || t.status !== "ok" || t.pages.length === 0) return null;
  const id = s.currentPage[tabId];
  let index = t.pages.findIndex((p) => p.page.id === id);
  if (index < 0) index = t.pages.length - 1;
  return { tabId, loaded: t.pages[index], index, count: t.pages.length };
}

// ----- autosave plumbing (module scope, outside React) -----

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, () => Promise<void>>();
/** Saves that have started writing and not finished yet, by `${tabId}:${pageId}`. */
const inFlight = new Map<string, Promise<void>>();
/** Outside changes are applied one batch at a time per notes folder. */
const outsideQueue = new Map<string, Promise<void>>();
/** Notes folders being watched, by tab id. */
const watched = new Map<string, string>();

function scheduleSave(key: string, run: () => Promise<void>) {
  const old = timers.get(key);
  if (old) clearTimeout(old);
  pending.set(key, run);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const job = pending.get(key);
      pending.delete(key);
      void job?.();
    }, AUTOSAVE_DELAY_MS),
  );
}

export const useNotebook = create<NotebookStore>((set, get) => {
  async function persistConfig(config: AppConfig) {
    await backend.writeAppConfig(JSON.stringify(config, null, 2) + "\n");
  }

  function setTab(tabId: string, state: TabState) {
    set((s) => ({ tabs: { ...s.tabs, [tabId]: state } }));
  }

  function rememberLast(tabId: string, pageId?: string) {
    const c = get().config;
    if (c.lastOpened.tabId === tabId && c.lastOpened.pageId === pageId) return;
    void get().updateConfig((cfg) => ({ ...cfg, lastOpened: { tabId, pageId } }));
  }

  function savePageNow(tabId: string, pageId: string): Promise<void> {
    const key = `${tabId}:${pageId}`;
    const run = writePage(tabId, pageId).finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
    inFlight.set(key, run);
    return run;
  }

  async function writePage(tabId: string, pageId: string) {
    const tab = get().tabs[tabId];
    if (!tab || tab.status !== "ok") return;
    const loaded = tab.pages.find((p) => p.page.id === pageId);
    if (!loaded || loaded.readOnly) return;
    set({ save: { kind: "saving" } });
    try {
      // Renaming a page renames the file (SPEC: Saving rules).
      let fileName = loaded.fileName;
      const stem = pageFileName(loaded.page).replace(/\.page\.json$/, "");
      const matches = new RegExp(
        `^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.page\\.json$`,
      );
      if (!matches.test(fileName)) {
        const taken = new Set(tab.pages.filter((p) => p !== loaded).map((p) => p.fileName));
        const next = uniquePageFileName(loaded.page, taken);
        const from = pagePath(tab.notesPath, fileName);
        // The old file may have been deleted outside the app; then just write the new one.
        if (await backend.pathExists(from)) {
          await backend.renameFile(from, pagePath(tab.notesPath, next));
        }
        forgetDiskText(from);
        fileName = next;
        await savePage(tab.notesPath, fileName, loaded.page);
      } else {
        await savePage(tab.notesPath, fileName, loaded.page);
      }
      const cur = get().tabs[tabId];
      if (cur?.status === "ok") {
        setTab(tabId, {
          ...cur,
          pages: cur.pages.map((p) => (p.page.id === pageId ? { ...p, fileName } : p)),
        });
      }
      set({ save: pending.size === 0 ? { kind: "saved", at: new Date() } : { kind: "unsaved" } });
    } catch (e) {
      set({ save: { kind: "error", message: String(e) } });
    }
  }

  /** Takes a page out of a tab's state and, if it was open, opens its neighbour. */
  function dropPage(tabId: string, pageId: string) {
    histories.delete(pageId);
    const cur = get().tabs[tabId];
    if (cur?.status !== "ok") return;
    const index = cur.pages.findIndex((p) => p.page.id === pageId);
    if (index < 0) return;
    const pages = cur.pages.filter((p) => p.page.id !== pageId);
    setTab(tabId, { ...cur, pages });
    if (get().currentPage[tabId] !== pageId && pages.length > 0) return;
    const next = pages[Math.min(index, pages.length - 1)];
    set((s) => {
      const currentPage = { ...s.currentPage };
      if (next) currentPage[tabId] = next.page.id;
      else delete currentPage[tabId];
      return { currentPage };
    });
    const view = get().view;
    if (view.kind === "tab" && view.tabId === tabId) {
      rememberLast(tabId, next?.page.id);
      set({
        save: next?.readOnly
          ? { kind: "read-only", reason: next.warning ?? "" }
          : { kind: "saved" },
      });
    }
  }

  /** Best effort: the app config is the source of truth for names and colours. */
  function syncNotebookMeta(tabId: string) {
    const tab = get().config.tabs.find((t) => t.id === tabId);
    const state = get().tabs[tabId];
    if (!tab || state?.status !== "ok") return;
    void backend.updateNotebookMeta(state.notesPath, tab.name, tab.colour).catch(() => undefined);
  }

  function watchFolder(tabId: string, notesPath: string | null) {
    const old = watched.get(tabId);
    if (old === notesPath) return;
    if (old) {
      watched.delete(tabId);
      void backend.unwatchNotesFolder(old).catch(() => undefined);
    }
    if (notesPath) {
      watched.set(tabId, notesPath);
      void backend.watchNotesFolder(notesPath).catch(() => watched.delete(tabId));
    }
  }

  /** One changed file: reload, add or remove its page, unless the app has unsaved edits. */
  async function applyOutsideFile(tabId: string, fileName: string) {
    const start = get().tabs[tabId];
    if (start?.status !== "ok") return;
    const path = pagePath(start.notesPath, fileName);

    // Let any save of this file finish first, so the app's own write never looks external.
    const before = start.pages.find((p) => p.fileName === fileName);
    const writing = before && inFlight.get(`${tabId}:${before.page.id}`);
    if (writing) await writing.catch(() => undefined);

    const exists = await backend.pathExists(path);
    const text = exists ? await backend.readTextFile(path).catch(() => null) : null;
    if (exists && text === null) return;
    if (text !== null && text === knownDiskText(path)) return;

    const tab = get().tabs[tabId];
    if (tab?.status !== "ok") return;
    const unsaved = (pageId: string) =>
      pending.has(`${tabId}:${pageId}`) || inFlight.has(`${tabId}:${pageId}`);
    const byName = tab.pages.find((p) => p.fileName === fileName);

    if (text === null) {
      // Removed or renamed outside the app.
      if (!byName) return;
      if (unsaved(byName.page.id)) {
        set({
          notice: `"${byName.page.title}" was deleted outside the app while you had unsaved changes. Your version was kept and will be saved again.`,
        });
        return;
      }
      forgetDiskText(path);
      dropPage(tabId, byName.page.id);
      return;
    }

    const parsed = parsePage(text);
    if (!parsed.ok) return; // half-written by a sync tool, or not a page: wait for the next change
    const page = parsed.page;
    const byId = tab.pages.find((p) => p.page.id === page.id);
    const target = byName ?? byId;

    if (target && unsaved(target.page.id)) {
      set({
        notice: `"${target.page.title}" was changed outside the app while you had unsaved changes. Your version was kept.`,
      });
      return;
    }
    if (!byName && byId && (await backend.pathExists(pagePath(tab.notesPath, byId.fileName)))) {
      // A copy of an open page under another name (same page id): leave it alone.
      return;
    }

    rememberDiskText(path, text);
    if (byName && byName.page.id !== page.id) {
      // The file now holds a different page, so the old one has gone from disk.
      dropPage(tabId, byName.page.id);
    }
    const fresh = get().tabs[tabId];
    if (fresh?.status !== "ok") return;
    const entry: LoadedPage = {
      fileName,
      page,
      readOnly: parsed.readOnly,
      warning: parsed.warning,
    };
    const pages = [...fresh.pages.filter((p) => p.page.id !== page.id), entry].sort((a, b) =>
      a.page.createdAt.localeCompare(b.page.createdAt),
    );
    histories.delete(page.id); // undo steps from before the reload no longer apply
    setTab(tabId, { ...fresh, pages });
    if (entry.readOnly && get().currentPage[tabId] === page.id) {
      set({ save: { kind: "read-only", reason: entry.warning ?? "" } });
    }
    set((s) => ({ historyTick: s.historyTick + 1 }));
  }

  /** Adds a new page to a tab, opens it and writes its file. */
  async function addPage(tabId: string, page: Page) {
    const tab = get().tabs[tabId];
    if (!tab || tab.status !== "ok") return;
    const taken = new Set(tab.pages.map((p) => p.fileName));
    const fileName = uniquePageFileName(page, taken);
    setTab(tabId, { ...tab, pages: [...tab.pages, { fileName, page, readOnly: false }] });
    set((s) => ({ currentPage: { ...s.currentPage, [tabId]: page.id } }));
    rememberLast(tabId, page.id);
    try {
      await savePage(tab.notesPath, fileName, page);
      set({ save: { kind: "saved", at: new Date() } });
    } catch (e) {
      set({ save: { kind: "error", message: String(e) } });
    }
  }

  return {
    ready: false,
    config: defaultConfig(),
    tabs: {},
    currentPage: {},
    view: { kind: "empty" },
    save: { kind: "saved" },
    settingsOpen: false,
    notice: null,

    async init() {
      const config = parseConfig(await backend.readAppConfig());
      const tabs = visibleTabs(config);
      const last = config.lastOpened;
      const startTab = tabs.find((t) => t.id === last.tabId) ?? tabs[0];
      // Show the shell straight away; tabs fill in as their folders are read.
      set({
        config,
        tabs: Object.fromEntries(tabs.map((t) => [t.id, { status: "loading" } as TabState])),
        view: startTab ? { kind: "tab", tabId: startTab.id } : { kind: "empty" },
        currentPage: startTab && last.pageId ? { [startTab.id]: last.pageId } : {},
        ready: true,
      });
      try {
        const cached = await backend.readAppFile(REMINDERS_CACHE_FILE);
        if (cached) set({ cachedReminders: JSON.parse(cached) as ReminderIndex });
      } catch {
        // A missing or broken cache only means a slower first Reminders view.
      }
      await Promise.all(tabs.map((t) => get().reloadTab(t.id)));
    },

    async updateConfig(mutate) {
      const config = mutate(get().config);
      set({ config });
      await persistConfig(config);
    },

    async addClient({ name, colour, folder, notesPath }) {
      const id = newId();
      const order = Math.max(-1, ...get().config.tabs.map((t) => t.order)) + 1;
      const tab: TabConfig = {
        id,
        name,
        colour,
        folder,
        order,
        archived: false,
        excludeFromAi: false,
      };
      await get().updateConfig((c) => ({ ...c, tabs: [...c.tabs, tab] }));
      setTab(id, { status: "loading" });
      await get().reloadTab(id);
      void notesPath;
      get().openTab(id);
    },

    async moveNotes(tabId, folder) {
      const state = get().tabs[tabId];
      if (state?.status !== "ok") throw new Error("The current notes folder cannot be found.");
      await get().flushSaves();
      // Windows will not move a folder that is being watched.
      watchFolder(tabId, null);
      let r;
      try {
        r = await backend.moveNotes(state.notesPath, folder);
      } catch (e) {
        watchFolder(tabId, state.notesPath);
        throw e;
      }
      await get().changeFolder(tabId, folder, r.notesPath);
      const files = r.files === 1 ? "1 file" : `${r.files} files`;
      set({
        notice: r.oldLeftBehind
          ? `Moved and checked ${files} in ${r.notesPath}. The old notes folder could not go to the Recycle Bin (${r.oldLeftBehind}); delete ${state.notesPath} yourself once you have checked the new one.`
          : `Moved and checked ${files} in ${r.notesPath}. The old notes folder is in the Recycle Bin.`,
      });
    },

    async renameTab(tabId, name) {
      const clean = name.trim();
      const tab = get().config.tabs.find((t) => t.id === tabId);
      if (!clean || !tab || tab.name === clean) return;
      await get().updateConfig((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, name: clean } : t)),
      }));
      syncNotebookMeta(tabId);
    },

    async setTabColour(tabId, colour) {
      const tab = get().config.tabs.find((t) => t.id === tabId);
      if (!tab || tab.colour === colour) return;
      await get().updateConfig((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, colour } : t)),
      }));
      syncNotebookMeta(tabId);
    },

    async archiveTab(tabId) {
      const before = visibleTabs(get().config);
      const index = before.findIndex((t) => t.id === tabId);
      if (index < 0) return;
      const name = before[index].name;
      await get().updateConfig((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, archived: true } : t)),
      }));
      const view = get().view;
      if (view.kind === "tab" && view.tabId === tabId) {
        const rest = before.filter((t) => t.id !== tabId);
        const next = rest[Math.min(index, rest.length - 1)];
        if (next) get().openTab(next.id);
        else set({ view: { kind: "empty" }, pageListOpen: false });
      }
      set({
        notice: `Archived "${name}". Its files are untouched; restore it from Settings, Clients and folders.`,
      });
    },

    async restoreTab(tabId) {
      const tab = get().config.tabs.find((t) => t.id === tabId);
      if (!tab?.archived) return;
      const order = Math.max(-1, ...visibleTabs(get().config).map((t) => t.order)) + 1;
      if (get().notice?.startsWith(`Archived "${tab.name}"`)) set({ notice: null });
      await get().updateConfig((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, archived: false, order } : t)),
      }));
      const state = get().tabs[tabId];
      if (!state || state.status !== "ok") {
        setTab(tabId, { status: "loading" });
        await get().reloadTab(tabId);
      }
      get().openTab(tabId);
    },

    async moveTab(tabId, slot) {
      const ids = visibleTabs(get().config).map((t) => t.id);
      const next = moveToSlot(ids, tabId, slot);
      if (next.every((id, i) => id === ids[i])) return;
      await get().updateConfig((c) => ({ ...c, tabs: applyTabOrder(c.tabs, next) }));
    },

    async changeFolder(tabId, folder) {
      await get().updateConfig((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, folder } : t)),
      }));
      await get().reloadTab(tabId);
    },

    async reloadTab(tabId) {
      const tab = get().config.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      try {
        const r = await loadTab(tab.folder);
        if (r.status === "missing") {
          watchFolder(tabId, null);
          setTab(tabId, { status: "missing", notesPath: r.notesPath });
        } else {
          setTab(tabId, {
            status: "ok",
            notesPath: r.notesPath,
            pages: r.pages,
            meetings: r.meetings,
            errors: r.errors,
          });
          watchFolder(tabId, r.notesPath);
          if (r.errors.length) set({ notice: `Some pages could not be opened: ${r.errors[0]}` });
        }
      } catch (e) {
        set({ notice: `Could not open ${tab.name}: ${String(e)}` });
        watchFolder(tabId, null);
        setTab(tabId, { status: "missing", notesPath: tab.folder });
      }
    },

    openTab(tabId) {
      set({ view: { kind: "tab", tabId }, pageListOpen: false, meetingsOpen: false });
      const cur = currentPageOf(get());
      rememberLast(tabId, cur?.loaded.page.id);
      const ro = cur?.loaded.readOnly;
      set({
        save: ro ? { kind: "read-only", reason: cur?.loaded.warning ?? "" } : { kind: "saved" },
      });
      if (ro && cur?.loaded.warning) set({ notice: cur.loaded.warning });
    },

    openReminders() {
      set({ view: { kind: "reminders" }, pageListOpen: false, meetingsOpen: false });
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    dismissNotice() {
      set({ notice: null });
    },

    async newPage() {
      const view = get().view;
      if (view.kind !== "tab") return;
      await addPage(view.tabId, createPage());
    },

    async duplicatePage(tabId, pageId) {
      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") return;
      const source = tab.pages.find((p) => p.page.id === pageId);
      if (!source || source.readOnly) return;
      const page: Page = {
        ...createPage(new Date(), `${source.page.title} (copy)`),
        elements: source.page.elements.map((el) => duplicate(el, 0, 0)),
      };
      await addPage(tabId, page);
    },

    async deletePage(tabId, pageId) {
      // Finish any pending save first, so the copy in the Recycle Bin is the latest.
      const key = `${tabId}:${pageId}`;
      const job = pending.get(key);
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      pending.delete(key);
      if (job) await job();
      await inFlight.get(key)?.catch(() => undefined);

      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") return false;
      const loaded = tab.pages.find((p) => p.page.id === pageId);
      if (!loaded || loaded.readOnly) return false;
      const path = pagePath(tab.notesPath, loaded.fileName);
      try {
        await backend.trashPageFile(path);
      } catch (e) {
        set({ notice: String(e) });
        return false;
      }
      forgetDiskText(path);
      dropPage(tabId, pageId);
      return true;
    },

    renamePage(tabId, pageId, title) {
      const clean = title.trim();
      const tab = get().tabs[tabId];
      const loaded = tab?.status === "ok" ? tab.pages.find((p) => p.page.id === pageId) : undefined;
      if (!clean || !loaded || loaded.page.title === clean) return;
      get().updatePageIn(tabId, pageId, (p) => ({ ...p, title: clean }));
    },

    pageListOpen: false,
    setPageListOpen(open) {
      set({ pageListOpen: open });
    },

    meetingsOpen: false,
    selectedMeeting: null,

    showMeetings(open) {
      if (get().view.kind !== "tab") return;
      set({ meetingsOpen: open, pageListOpen: false });
    },

    openMeeting(tabId, meetingId) {
      set({
        view: { kind: "tab", tabId },
        meetingsOpen: true,
        pageListOpen: false,
        selectedMeeting: meetingId,
      });
      rememberLast(tabId, get().currentPage[tabId]);
    },

    async addMeeting(tabId, input) {
      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") throw new Error("This tab's notes folder cannot be found.");
      const meeting = createMeeting(input);
      const fileName = meetingFileName(meeting, new Set(tab.meetings.map((m) => m.fileName)));
      await saveMeeting(tab.notesPath, fileName, meeting);
      const cur = get().tabs[tabId];
      if (cur?.status === "ok") {
        setTab(tabId, { ...cur, meetings: sortMeetings([...cur.meetings, { fileName, meeting }]) });
      }
      set({ selectedMeeting: meeting.id });
      return meeting.id;
    },

    async updateMeeting(tabId, meetingId, edit) {
      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") throw new Error("This tab's notes folder cannot be found.");
      const loaded = tab.meetings.find((m) => m.meeting.id === meetingId);
      if (!loaded) return;
      const next: Meeting = {
        ...loaded.meeting,
        ...edit,
        title: (edit.title ?? loaded.meeting.title).trim() || "Meeting",
        // A file dropped in by hand gets a proper id the first time it is saved.
        id: loaded.meeting.id.startsWith("file:") ? newId() : loaded.meeting.id,
        updatedAt: new Date().toISOString(),
      };
      const others = new Set(tab.meetings.filter((m) => m !== loaded).map((m) => m.fileName));
      const stem = (n: string) => n.replace(/(-\d+)?\.md$/i, "");
      let fileName = loaded.fileName;
      if (stem(meetingFileName(next, new Set())) !== stem(loaded.fileName)) {
        fileName = meetingFileName(next, others);
        await backend.renameMeetingFile(tab.notesPath, loaded.fileName, fileName);
      }
      await saveMeeting(tab.notesPath, fileName, next);
      const cur = get().tabs[tabId];
      if (cur?.status === "ok") {
        setTab(tabId, {
          ...cur,
          meetings: sortMeetings(
            cur.meetings.map((m) => (m.meeting.id === meetingId ? { fileName, meeting: next } : m)),
          ),
        });
      }
      if (get().selectedMeeting === meetingId) set({ selectedMeeting: next.id });
    },

    async deleteMeeting(tabId, meetingId) {
      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") return;
      const index = tab.meetings.findIndex((m) => m.meeting.id === meetingId);
      if (index < 0) return;
      await backend.trashMeetingFile(tab.notesPath, tab.meetings[index].fileName);
      const cur = get().tabs[tabId];
      if (cur?.status !== "ok") return;
      const meetings = cur.meetings.filter((m) => m.meeting.id !== meetingId);
      setTab(tabId, { ...cur, meetings });
      if (get().selectedMeeting === meetingId) {
        set({
          selectedMeeting: meetings[Math.min(index, meetings.length - 1)]?.meeting.id ?? null,
        });
      }
    },

    goToPage(delta) {
      const cur = currentPageOf(get());
      if (!cur) return;
      const tab = get().tabs[cur.tabId];
      if (tab?.status !== "ok") return;
      const next = Math.min(cur.count - 1, Math.max(0, cur.index + delta));
      const target = tab.pages[next];
      set((s) => ({ currentPage: { ...s.currentPage, [cur.tabId]: target.page.id } }));
      rememberLast(cur.tabId, target.page.id);
      set({
        save: target.readOnly
          ? { kind: "read-only", reason: target.warning ?? "" }
          : { kind: "saved" },
        notice: target.readOnly && target.warning ? target.warning : get().notice,
      });
    },

    updatePage(mutate) {
      const cur = currentPageOf(get());
      if (!cur) return;
      get().updatePageIn(cur.tabId, cur.loaded.page.id, mutate);
    },

    updatePageIn(tabId, pageId, mutate) {
      const tab = get().tabs[tabId];
      if (tab?.status !== "ok") return;
      const loaded = tab.pages.find((p) => p.page.id === pageId);
      if (!loaded || loaded.readOnly) return;
      const updated = { ...mutate(loaded.page), updatedAt: new Date().toISOString() };
      setTab(tabId, {
        ...tab,
        pages: tab.pages.map((p) => (p.page.id === pageId ? { ...p, page: updated } : p)),
      });
      set({ save: { kind: "unsaved" } });
      scheduleSave(`${tabId}:${pageId}`, () => savePageNow(tabId, pageId));
    },

    flash: null,
    clearFlash() {
      set({ flash: null });
    },

    openPageAt(tabId, pageId, elementId) {
      set((s) => ({
        view: { kind: "tab", tabId },
        meetingsOpen: false,
        currentPage: { ...s.currentPage, [tabId]: pageId },
        flash: elementId ? { elementId, nonce: Date.now() } : null,
      }));
      rememberLast(tabId, pageId);
      const cur = currentPageOf(get());
      set({
        save: cur?.loaded.readOnly
          ? { kind: "read-only", reason: cur.loaded.warning ?? "" }
          : { kind: "saved" },
      });
    },

    cachedReminders: null,

    historyTick: 0,

    editElements(mutate) {
      const cur = currentPageOf(get());
      if (!cur || cur.loaded.readOnly) return;
      const before = cur.loaded.page.elements;
      const after = mutate(before);
      if (sameElements(before, after)) return;
      const id = cur.loaded.page.id;
      histories.set(id, record(histories.get(id) ?? emptyHistory(), before));
      get().updatePage((p) => ({ ...p, elements: after }));
      set((s) => ({ historyTick: s.historyTick + 1 }));
    },

    undo() {
      const cur = currentPageOf(get());
      if (!cur || cur.loaded.readOnly) return;
      const id = cur.loaded.page.id;
      const step = undoStep(
        histories.get(id) ?? emptyHistory<Element[]>(),
        cur.loaded.page.elements,
      );
      if (!step) return;
      histories.set(id, step.history);
      get().updatePage((p) => ({ ...p, elements: step.value }));
      set((s) => ({ historyTick: s.historyTick + 1 }));
    },

    redo() {
      const cur = currentPageOf(get());
      if (!cur || cur.loaded.readOnly) return;
      const id = cur.loaded.page.id;
      const step = redoStep(
        histories.get(id) ?? emptyHistory<Element[]>(),
        cur.loaded.page.elements,
      );
      if (!step) return;
      histories.set(id, step.history);
      get().updatePage((p) => ({ ...p, elements: step.value }));
      set((s) => ({ historyTick: s.historyTick + 1 }));
    },

    async applyOutsideChanges(notesPath, fileNames, rescan = false) {
      const tabId = Object.entries(get().tabs).find(
        ([, t]) => t.status === "ok" && t.notesPath === notesPath,
      )?.[0];
      if (!tabId) return;
      const prev = outsideQueue.get(notesPath) ?? Promise.resolve();
      const run = prev.then(async () => {
        if (rescan && !(await backend.pathExists(notesPath))) {
          await get().reloadTab(tabId); // shows "Folder not found"
          return;
        }
        for (const name of fileNames) {
          try {
            await applyOutsideFile(tabId, name);
          } catch {
            // One unreadable file must not stop the others.
          }
        }
      });
      outsideQueue.set(
        notesPath,
        run.catch(() => undefined),
      );
      await run;
    },

    async flushSaves() {
      const jobs = [...pending.values()];
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pending.clear();
      await Promise.all(jobs.map((j) => j()));
    },
  };
});

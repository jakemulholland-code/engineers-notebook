import { create } from "zustand";
import { defaultConfig, parseConfig, type AppConfig, type TabConfig } from "../model/config";
import { createPage, newId, pageFileName, uniquePageFileName, type Element, type Page } from "../model/page";
import { emptyHistory, record, redo as redoStep, undo as undoStep, type History } from "../canvas/history";
import { backend } from "../storage/backend";
import { loadTab, savePage, type LoadedPage } from "../storage/notebook";
import { pagePath } from "../storage/paths";

export const AUTOSAVE_DELAY_MS = 800;

export type TabState =
  | { status: "loading" }
  | { status: "missing"; notesPath: string }
  | { status: "ok"; notesPath: string; pages: LoadedPage[]; errors: string[] };

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
  addClient(input: { name: string; colour: string; folder: string; notesPath: string }): Promise<void>;
  changeFolder(tabId: string, folder: string, notesPath: string): Promise<void>;
  reloadTab(tabId: string): Promise<void>;
  openTab(tabId: string): void;
  openReminders(): void;
  setSettingsOpen(open: boolean): void;
  dismissNotice(): void;
  newPage(): Promise<void>;
  goToPage(delta: number): void;
  updatePage(mutate: (p: Page) => Page): void;
  /** Changes the current page's elements as one undoable step. */
  editElements(mutate: (els: Element[]) => Element[]): void;
  undo(): void;
  redo(): void;
  /** Bumped whenever undo/redo availability may have changed. */
  historyTick: number;
  flushSaves(): Promise<void>;
};

const histories = new Map<string, History<Element[]>>();

export function historyFor(pageId: string | undefined): { canUndo: boolean; canRedo: boolean } {
  const h = pageId ? histories.get(pageId) : undefined;
  return { canUndo: !!h && h.past.length > 0, canRedo: !!h && h.future.length > 0 };
}

const sameElements = (a: Element[], b: Element[]) => a.length === b.length && a.every((el, i) => el === b[i]);

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

  async function savePageNow(tabId: string, pageId: string) {
    const tab = get().tabs[tabId];
    if (!tab || tab.status !== "ok") return;
    const loaded = tab.pages.find((p) => p.page.id === pageId);
    if (!loaded || loaded.readOnly) return;
    set({ save: { kind: "saving" } });
    try {
      // Renaming a page renames the file (SPEC: Saving rules).
      let fileName = loaded.fileName;
      const stem = pageFileName(loaded.page).replace(/\.page\.json$/, "");
      const matches = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.page\\.json$`);
      if (!matches.test(fileName)) {
        const taken = new Set(tab.pages.filter((p) => p !== loaded).map((p) => p.fileName));
        const next = uniquePageFileName(loaded.page, taken);
        await backend.renameFile(pagePath(tab.notesPath, fileName), pagePath(tab.notesPath, next));
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
      set({ config });
      const tabs = visibleTabs(config);
      await Promise.all(tabs.map((t) => get().reloadTab(t.id)));
      const last = config.lastOpened;
      const startTab = tabs.find((t) => t.id === last.tabId) ?? tabs[0];
      if (startTab) {
        set((s) => ({
          view: { kind: "tab", tabId: startTab.id },
          currentPage: last.pageId ? { ...s.currentPage, [startTab.id]: last.pageId } : s.currentPage,
        }));
      }
      set({ ready: true });
    },

    async updateConfig(mutate) {
      const config = mutate(get().config);
      set({ config });
      await persistConfig(config);
    },

    async addClient({ name, colour, folder, notesPath }) {
      const id = newId();
      const order = Math.max(-1, ...get().config.tabs.map((t) => t.order)) + 1;
      const tab: TabConfig = { id, name, colour, folder, order, archived: false, excludeFromAi: false };
      await get().updateConfig((c) => ({ ...c, tabs: [...c.tabs, tab] }));
      setTab(id, { status: "loading" });
      await get().reloadTab(id);
      void notesPath;
      get().openTab(id);
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
          setTab(tabId, { status: "missing", notesPath: r.notesPath });
        } else {
          setTab(tabId, { status: "ok", notesPath: r.notesPath, pages: r.pages, errors: r.errors });
          if (r.errors.length) set({ notice: `Some pages could not be opened: ${r.errors[0]}` });
        }
      } catch (e) {
        set({ notice: `Could not open ${tab.name}: ${String(e)}` });
        setTab(tabId, { status: "missing", notesPath: tab.folder });
      }
    },

    openTab(tabId) {
      set({ view: { kind: "tab", tabId } });
      const cur = currentPageOf(get());
      rememberLast(tabId, cur?.loaded.page.id);
      const ro = cur?.loaded.readOnly;
      set({ save: ro ? { kind: "read-only", reason: cur?.loaded.warning ?? "" } : { kind: "saved" } });
      if (ro && cur?.loaded.warning) set({ notice: cur.loaded.warning });
    },

    openReminders() {
      set({ view: { kind: "reminders" } });
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
      const tab = get().tabs[view.tabId];
      if (!tab || tab.status !== "ok") return;
      const page = createPage();
      const taken = new Set(tab.pages.map((p) => p.fileName));
      const fileName = uniquePageFileName(page, taken);
      setTab(view.tabId, { ...tab, pages: [...tab.pages, { fileName, page, readOnly: false }] });
      set((s) => ({ currentPage: { ...s.currentPage, [view.tabId]: page.id } }));
      rememberLast(view.tabId, page.id);
      try {
        await savePage(tab.notesPath, fileName, page);
        set({ save: { kind: "saved", at: new Date() } });
      } catch (e) {
        set({ save: { kind: "error", message: String(e) } });
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
        save: target.readOnly ? { kind: "read-only", reason: target.warning ?? "" } : { kind: "saved" },
        notice: target.readOnly && target.warning ? target.warning : get().notice,
      });
    },

    updatePage(mutate) {
      const cur = currentPageOf(get());
      if (!cur || cur.loaded.readOnly) return;
      const tab = get().tabs[cur.tabId];
      if (tab?.status !== "ok") return;
      const updated = { ...mutate(cur.loaded.page), updatedAt: new Date().toISOString() };
      setTab(cur.tabId, {
        ...tab,
        pages: tab.pages.map((p) => (p.page.id === updated.id ? { ...p, page: updated } : p)),
      });
      set({ save: { kind: "unsaved" } });
      const { tabId } = cur;
      scheduleSave(`${tabId}:${updated.id}`, () => savePageNow(tabId, updated.id));
    },

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
      const step = undoStep(histories.get(id) ?? emptyHistory<Element[]>(), cur.loaded.page.elements);
      if (!step) return;
      histories.set(id, step.history);
      get().updatePage((p) => ({ ...p, elements: step.value }));
      set((s) => ({ historyTick: s.historyTick + 1 }));
    },

    redo() {
      const cur = currentPageOf(get());
      if (!cur || cur.loaded.readOnly) return;
      const id = cur.loaded.page.id;
      const step = redoStep(histories.get(id) ?? emptyHistory<Element[]>(), cur.loaded.page.elements);
      if (!step) return;
      histories.set(id, step.history);
      get().updatePage((p) => ({ ...p, elements: step.value }));
      set((s) => ({ historyTick: s.historyTick + 1 }));
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

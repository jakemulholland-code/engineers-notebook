import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { PaperStage } from "../canvas/PaperStage";
import { SettingsPanel } from "../components/SettingsPanel";
import { StatusBar } from "../components/StatusBar";
import { Tabs } from "../components/Tabs";
import { Toolbar } from "../components/Toolbar";
import { CloseIcon } from "../components/Icons";
import { backend } from "../storage/backend";
import { currentPageOf, useNotebook } from "../store/notebook";
import { TOOL_KEYS, useTools } from "../store/tools";
import { usePersistReminderCache } from "../reminders/useReminders";
import { RemindersView } from "./RemindersView";
import { MeetingsView } from "./MeetingsView";
import { CatchUpPanel } from "../components/CatchUpPanel";
import { ExportDialog, useExportDialog } from "../components/ExportDialog";
import { useUpdates } from "./updates";

/** "Version x is ready" with Install and restart, or Later. */
function UpdatePrompt() {
  const { state, dismissed, install, dismiss } = useUpdates();
  if (dismissed || (state.kind !== "available" && state.kind !== "installing")) return null;
  return (
    <div className="notice update-notice" role="status">
      <span>
        {state.kind === "available"
          ? `Version ${state.version} of Engineer’s Notebook is ready to install.`
          : `Installing the update${state.percent !== null ? ` (${state.percent}%)` : ""}. The app will restart.`}
      </span>
      {state.kind === "available" && (
        <>
          <button className="small-button" onClick={dismiss}>
            Later
          </button>
          <button className="pill primary" onClick={() => void install()}>
            Install and restart
          </button>
        </>
      )}
    </div>
  );
}

const RING_COUNT = 14;

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
  );
}

export function App() {
  const ready = useNotebook((s) => s.ready);
  const init = useNotebook((s) => s.init);
  const notice = useNotebook((s) => s.notice);
  const dismissNotice = useNotebook((s) => s.dismissNotice);

  useEffect(() => {
    void init();
  }, [init]);

  usePersistReminderCache();

  // Check GitHub Releases for a newer version once the notebook is open (installed builds only).
  useEffect(() => {
    if (!ready || import.meta.env.DEV) return;
    if (useNotebook.getState().config.general.checkForUpdates) void useUpdates.getState().check();
  }, [ready]);

  // Save anything pending before the window closes. Tauri then destroys the window, which needs
  // the core:window:allow-destroy permission. A failed or slow save must never stop the close.
  useEffect(() => {
    if (!backend.isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const off = await win.onCloseRequested(async () => {
        try {
          await Promise.race([
            useNotebook.getState().flushSaves(),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        } catch (e) {
          console.error("Saving before close failed", e);
        }
      });
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Page files changed outside the app (OneDrive, Dropbox, another editor).
  useEffect(() => {
    if (!backend.isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const off = await listen<{ notesPath: string; files: string[]; rescan: boolean }>(
        "notes-changed",
        (e) =>
          void useNotebook
            .getState()
            .applyOutsideChanges(e.payload.notesPath, e.payload.files, e.payload.rescan),
      );
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useNotebook.getState();
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        s.setSettingsOpen(!s.settingsOpen);
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        useExportDialog.getState().setOpen(true);
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault(); // never the browser's print dialog
        if (s.view.kind === "tab" && !s.settingsOpen && !useExportDialog.getState().open) {
          s.setPageListOpen(!s.pageListOpen);
        }
        return;
      }
      if (
        isTyping(e.target) ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        s.settingsOpen ||
        s.pageListOpen ||
        useExportDialog.getState().open
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        void s.updateConfig((c) => ({
          ...c,
          general: { ...c.general, lockToGrid: !c.general.lockToGrid },
        }));
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) useTools.getState().setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        {ready ? <MainView /> : <div className="placeholder-view">Opening notebook</div>}
        <CatchUpPanel />
      </main>
      <StatusBar />
      <SettingsPanel />
      <ExportDialog />
      <UpdatePrompt />
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="icon-button small" aria-label="Dismiss" onClick={dismissNotice}>
            <CloseIcon size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function MainView() {
  const view = useNotebook((s) => s.view);
  const tabs = useNotebook((s) => s.tabs);
  const config = useNotebook((s) => s.config);
  const openSettings = useNotebook((s) => s.setSettingsOpen);
  const newPage = useNotebook((s) => s.newPage);
  const updatePage = useNotebook((s) => s.updatePage);
  const meetingsOpen = useNotebook((s) => s.meetingsOpen);
  const cur = useNotebook(useShallow(currentPageOf));

  let content: ReactNode;
  if (view.kind === "empty") {
    content = (
      <div className="empty-state">
        <div>
          <h2>Add your first client</h2>
          <p>
            Each tab is tied to a folder on disk. Choose a client folder in Settings and the app
            will keep its notes there.
          </p>
          <div className="actions">
            <button className="pill primary" onClick={() => openSettings(true)}>
              Open settings
            </button>
          </div>
        </div>
      </div>
    );
  } else if (view.kind === "reminders") {
    content = <RemindersView />;
  } else {
    const tabState = tabs[view.tabId];
    const tab = config.tabs.find((t) => t.id === view.tabId);
    if (!tabState || tabState.status === "loading") {
      content = <div className="placeholder-view">Opening {tab?.name}</div>;
    } else if (tabState.status === "missing") {
      content = (
        <div className="empty-state">
          <div>
            <h2>Folder not found</h2>
            <p>
              {tabState.notesPath} is not available. The drive may be unplugged or the folder moved.
              The app will not create a new one on its own.
            </p>
            <div className="actions">
              <button className="pill primary" onClick={() => openSettings(true)}>
                Choose it again
              </button>
              <button
                className="pill ghost"
                onClick={() => void useNotebook.getState().reloadTab(view.tabId)}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    } else if (meetingsOpen) {
      content = <MeetingsView tabId={view.tabId} />;
    } else if (!cur) {
      content = (
        <div className="empty-state">
          <div>
            <h2>No pages yet</h2>
            <p>Start the first page for {tab?.name}.</p>
            <div className="actions">
              <button className="pill primary" onClick={() => void newPage()}>
                New page
              </button>
            </div>
          </div>
        </div>
      );
    } else {
      content = (
        <PaperStage
          page={cur.loaded.page}
          readOnly={cur.loaded.readOnly}
          notesPath={tabState.notesPath}
          onTitleChange={(title) => updatePage((p) => ({ ...p, title }))}
        />
      );
    }
  }

  return (
    <>
      <section className="sheet" aria-label="Page">
        <div className="rings" aria-hidden="true">
          {Array.from({ length: RING_COUNT }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        {content}
      </section>
      <Tabs />
    </>
  );
}

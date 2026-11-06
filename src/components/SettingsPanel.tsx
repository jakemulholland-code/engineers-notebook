import { useCallback, useEffect, useState } from "react";
import { INK_COLOURS, type TabConfig } from "../model/config";
import { backend } from "../storage/backend";
import { notesPathFor } from "../storage/paths";
import { useNotebook, visibleTabs } from "../store/notebook";
import { CloseIcon, GripIcon } from "./Icons";
import { ColourPicker } from "./ColourPicker";
import { useDragReorder } from "./useDragReorder";
import { AiSection } from "./AiSettings";
import { ExportSection } from "./ExportSettings";
import { GeneralSection } from "./GeneralSettings";

type Section = "clients" | "ai" | "export" | "general";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "clients", label: "Clients and folders" },
  { id: "ai", label: "AI" },
  { id: "export", label: "Export" },
  { id: "general", label: "General" },
];

export function SettingsPanel() {
  const open = useNotebook((s) => s.settingsOpen);
  const setOpen = useNotebook((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>("clients");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="side-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.id} aria-current={section === s.id} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-section">
            {section === "clients" && <ClientsSection />}
            {section === "ai" && <AiSection />}
            {section === "export" && <ExportSection />}
            {section === "general" && <GeneralSection />}
          </div>
        </div>
      </aside>
    </>
  );
}

function ClientsSection() {
  const config = useNotebook((s) => s.config);
  const tabs = useNotebook((s) => s.tabs);
  const updateConfig = useNotebook((s) => s.updateConfig);
  const changeFolder = useNotebook((s) => s.changeFolder);
  const [adding, setAdding] = useState(config.tabs.length === 0);
  const [error, setError] = useState<string | null>(null);
  const list = visibleTabs(config);
  const ids = list.map((t) => t.id);
  const archived = config.tabs
    .filter((t) => t.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const moveTab = useNotebook((s) => s.moveTab);
  const onMove = useCallback((id: string, slot: number) => void moveTab(id, slot), [moveTab]);
  const { listRef, drag, start, onClickCapture, dropMark } = useDragReorder<HTMLDivElement>(onMove);

  const [changing, setChanging] = useState<Changing | null>(null);

  async function onChangeFolder(t: TabConfig) {
    setError(null);
    setChanging(null);
    const folder = await backend.chooseFolder(`Choose a new folder for ${t.name}`);
    if (!folder) return;
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (norm(folder) === norm(t.folder)) {
      setError(`${t.name} already uses that folder.`);
      return;
    }
    const hasNotes = await backend.pathExists(notesPathFor(folder));
    const canMove = tabs[t.id]?.status === "ok";
    setChanging({ tab: t, folder, hasNotes, canMove });
  }

  /** "Point at the new folder only": the existing notes stay where they are. */
  async function pointAt(t: TabConfig, folder: string) {
    setError(null);
    try {
      const r = await backend.prepareClientFolder(folder, t.name, t.colour, false);
      if (
        r.status === "foreign" &&
        !window.confirm(
          `${r.notesPath} already exists and was not made by this app. Add notebook files to it?`,
        )
      ) {
        return;
      }
      if (r.status === "foreign") await backend.prepareClientFolder(folder, t.name, t.colour, true);
      await changeFolder(t.id, folder, r.notesPath);
      setChanging(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <h3>Clients and folders</h3>
      <p className="lead">
        Each tab is tied to a folder. The app keeps its pages in a <code>notes</code> folder inside
        it.
      </p>

      {list.length === 0 && !adding && <p className="lead">No clients yet.</p>}

      <div
        className={`client-list${drag ? " reordering" : ""}`}
        ref={listRef}
        onClickCapture={onClickCapture}
      >
        {list.map((t, i) => {
          const st = tabs[t.id];
          const missing = st?.status === "missing";
          return (
            <div
              className={`client-row${drag?.id === t.id ? " dragging" : ""}`}
              key={t.id}
              data-reorder-id={t.id}
              data-drop={dropMark(ids, i)}
            >
              <button
                type="button"
                className="grip"
                aria-label={`Move ${t.name}. Drag, or use the up and down arrow keys.`}
                title="Drag to reorder"
                onPointerDown={start(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  const target = e.currentTarget.closest("[data-reorder-id]");
                  // Read the order now, not from the last render, so quick presses all count.
                  const from = visibleTabs(useNotebook.getState().config).findIndex(
                    (x) => x.id === t.id,
                  );
                  void moveTab(t.id, e.key === "ArrowUp" ? from - 1 : from + 2);
                  // Moving the row in the page drops focus; put it back before the next press.
                  requestAnimationFrame(() =>
                    target?.querySelector<HTMLButtonElement>(".grip")?.focus(),
                  );
                }}
              >
                <GripIcon size={18} />
              </button>
              <span className="marker" style={{ background: t.colour }} aria-hidden="true" />
              <div className="meta">
                <strong>{t.name}</strong>
                <span title={notesPathFor(t.folder)}>
                  {missing ? "Folder not found: " : ""}
                  {notesPathFor(t.folder)}
                </span>
              </div>
              <div className="row-actions">
                <label
                  className="exclude-ai"
                  title="Never send this tab's notes to the AI provider"
                >
                  <input
                    type="checkbox"
                    checked={t.excludeFromAi}
                    onChange={(e) =>
                      void updateConfig((c) => ({
                        ...c,
                        tabs: c.tabs.map((x) =>
                          x.id === t.id ? { ...x, excludeFromAi: e.target.checked } : x,
                        ),
                      }))
                    }
                  />
                  Exclude from AI
                </label>
                <button
                  className="small-button"
                  disabled={missing}
                  onClick={() =>
                    void backend
                      .openInExplorer(notesPathFor(t.folder))
                      .catch((e) => setError(String(e)))
                  }
                >
                  Open folder
                </button>
                <button className="small-button" onClick={() => void onChangeFolder(t)}>
                  Change folder
                </button>
                <button
                  className="small-button"
                  onClick={() => void useNotebook.getState().archiveTab(t.id)}
                >
                  Archive
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {changing && (
        <ChangeFolderCard
          key={`${changing.tab.id}:${changing.folder}`}
          changing={changing}
          onPoint={() => pointAt(changing.tab, changing.folder)}
          onDone={() => setChanging(null)}
        />
      )}

      {error && <p className="form-error">{error}</p>}

      {archived.length > 0 && (
        <section className="archived-clients" aria-labelledby="archived-heading">
          <h4 id="archived-heading">Archived</h4>
          <p className="lead">Hidden from the tabs. Their folders and pages are untouched.</p>
          {archived.map((t) => (
            <div className="client-row archived" key={t.id}>
              <span className="marker" style={{ background: t.colour }} aria-hidden="true" />
              <div className="meta">
                <strong>{t.name}</strong>
                <span title={notesPathFor(t.folder)}>{notesPathFor(t.folder)}</span>
              </div>
              <div className="row-actions">
                <button
                  className="small-button"
                  onClick={() => {
                    void useNotebook.getState().restoreTab(t.id);
                  }}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {adding ? (
        <AddClientForm onDone={() => setAdding(false)} canCancel={list.length > 0} />
      ) : (
        <button className="pill primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          Add client
        </button>
      )}
    </>
  );
}

type Changing = { tab: TabConfig; folder: string; hasNotes: boolean; canMove: boolean };

/** Change folder: move the existing notes across, or just point the tab at the new folder. */
function ChangeFolderCard({
  changing,
  onPoint,
  onDone,
}: {
  changing: Changing;
  onPoint(): Promise<void>;
  onDone(): void;
}) {
  const { tab, folder, hasNotes, canMove } = changing;
  const [mode, setMode] = useState<"move" | "point">(canMove && !hasNotes ? "move" : "point");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oldNotes = notesPathFor(tab.folder);
  const newNotes = notesPathFor(folder);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "move") {
        await useNotebook.getState().moveNotes(tab.id, folder);
        onDone();
      } else {
        await onPoint();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form-card change-folder"
      aria-label={`Change folder for ${tab.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <h3>Change folder for {tab.name}</h3>
      <p className="lead">
        New folder: <span className="path-preview">{folder}</span>
      </p>
      <fieldset className="choices" disabled={busy}>
        <legend className="visually-hidden">What to do with the existing notes</legend>
        <label className={canMove ? "" : "disabled"}>
          <input
            type="radio"
            name="change-folder"
            checked={mode === "move"}
            disabled={!canMove}
            onChange={() => setMode("move")}
          />
          <span>
            <strong>Move existing notes</strong>
            <span className="hint">
              {canMove
                ? `Copies ${oldNotes} to ${newNotes}, checks every file, then moves the old folder to the Recycle Bin.`
                : "The current notes folder cannot be found, so there is nothing to move."}
              {canMove && hasNotes
                ? " The new folder already has a notes folder; moving only works if it is empty."
                : ""}
            </span>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="change-folder"
            checked={mode === "point"}
            onChange={() => setMode("point")}
          />
          <span>
            <strong>Point at the new folder only</strong>
            <span className="hint">
              {hasNotes
                ? `Opens the notes already in ${newNotes}. The current notes stay where they are.`
                : `Starts an empty notes folder in ${newNotes}. The current notes stay where they are.`}
            </span>
          </span>
        </label>
      </fieldset>
      {busy && mode === "move" && (
        <p className="lead" role="status">
          Moving and checking notes…
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="pill ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="pill primary" disabled={busy}>
          {mode === "move" ? "Move notes" : "Change folder"}
        </button>
      </div>
    </form>
  );
}

function AddClientForm({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const addClient = useNotebook((s) => s.addClient);
  const [name, setName] = useState("");
  const [colour, setColour] = useState<string>(INK_COLOURS[1].value);
  const [folder, setFolder] = useState<string | null>(null);
  const [foreignPath, setForeignPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    setError(null);
    setForeignPath(null);
    const f = await backend.chooseFolder("Choose the client folder");
    if (f) setFolder(f);
  }

  async function confirm(allowForeign: boolean) {
    if (!folder || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.prepareClientFolder(folder, name.trim(), colour, allowForeign);
      if (r.status === "foreign") {
        setForeignPath(r.notesPath);
        return;
      }
      await addClient({ name: name.trim(), colour, folder, notesPath: r.notesPath });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form-card"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm(false);
      }}
    >
      <h3>Add client</h3>
      <label className="field">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Grade A Technology"
          autoFocus
        />
      </label>
      <div className="field">
        <span id="colour-label">Colour</span>
        <ColourPicker value={colour} onChange={setColour} labelledBy="colour-label" />
      </div>
      <div className="field">
        Folder
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="small-button" onClick={() => void choose()}>
            Choose folder
          </button>
          {folder && <span className="path-preview">{notesPathFor(folder)}</span>}
        </div>
      </div>

      {foreignPath && (
        <div className="form-warning" role="alert">
          {foreignPath} already exists and was not made by this app. The app will add{" "}
          <code>notebook.json</code>, <code>pages</code> and <code>assets</code> to it and leave
          your existing files alone.
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="small-button" onClick={() => setForeignPath(null)}>
              Choose another folder
            </button>
            <button type="button" className="small-button" onClick={() => void confirm(true)}>
              Use this folder
            </button>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        {canCancel && (
          <button type="button" className="pill ghost" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="pill primary" disabled={busy || !folder || !name.trim()}>
          Add client
        </button>
      </div>
    </form>
  );
}

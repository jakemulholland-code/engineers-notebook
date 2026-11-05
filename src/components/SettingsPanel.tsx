import { useEffect, useState } from "react";
import { INK_COLOURS, type TabConfig } from "../model/config";
import { backend } from "../storage/backend";
import { notesPathFor } from "../storage/paths";
import { useNotebook, visibleTabs } from "../store/notebook";
import { CloseIcon } from "./Icons";

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
          <button className="icon-button" aria-label="Close settings" onClick={() => setOpen(false)}>
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
            {section === "ai" && <ComingLater title="AI" milestone="milestone 4" />}
            {section === "export" && <ComingLater title="Export" milestone="milestone 5" />}
            {section === "general" && <GeneralSection />}
          </div>
        </div>
      </aside>
    </>
  );
}

function ComingLater({ title, milestone }: { title: string; milestone: string }) {
  return (
    <>
      <h3>{title}</h3>
      <p className="lead">These settings arrive in {milestone}.</p>
    </>
  );
}

function GeneralSection() {
  const general = useNotebook((s) => s.config.general);
  const updateConfig = useNotebook((s) => s.updateConfig);
  const [configPath, setConfigPath] = useState("");
  useEffect(() => {
    void backend.appConfigPath().then(setConfigPath);
  }, []);
  return (
    <>
      <h3>General</h3>
      <p className="lead">App settings are stored in {configPath || "the app data folder"}.</p>
      <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10, color: "var(--text)" }}>
        <input
          type="checkbox"
          checked={general.lockToGrid}
          onChange={(e) =>
            void updateConfig((c) => ({ ...c, general: { ...c.general, lockToGrid: e.target.checked } }))
          }
          style={{ width: 18, height: 18, accentColor: "var(--mint)" }}
        />
        Lock to grid by default
      </label>
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

  async function onChangeFolder(t: TabConfig) {
    setError(null);
    const folder = await backend.chooseFolder(`Choose a new folder for ${t.name}`);
    if (!folder) return;
    try {
      const r = await backend.prepareClientFolder(folder, t.name, t.colour, false);
      if (r.status === "foreign" && !window.confirm(`${r.notesPath} already exists and was not made by this app. Add notebook files to it?`)) {
        return;
      }
      if (r.status === "foreign") await backend.prepareClientFolder(folder, t.name, t.colour, true);
      await changeFolder(t.id, folder, r.notesPath);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <h3>Clients and folders</h3>
      <p className="lead">
        Each tab is tied to a folder. The app keeps its pages in a <code>notes</code> folder inside it.
      </p>

      {list.length === 0 && !adding && <p className="lead">No clients yet.</p>}

      {list.map((t) => {
        const st = tabs[t.id];
        const missing = st?.status === "missing";
        return (
          <div className="client-row" key={t.id}>
            <span className="marker" style={{ background: t.colour }} aria-hidden="true" />
            <div className="meta">
              <strong>{t.name}</strong>
              <span title={notesPathFor(t.folder)}>
                {missing ? "Folder not found: " : ""}
                {notesPathFor(t.folder)}
              </span>
            </div>
            <div className="row-actions">
              <button className="small-button" disabled={missing} onClick={() => void backend.openInExplorer(notesPathFor(t.folder)).catch((e) => setError(String(e)))}>
                Open folder
              </button>
              <button className="small-button" onClick={() => void onChangeFolder(t)}>
                Change folder
              </button>
              <button
                className="small-button"
                onClick={() =>
                  void updateConfig((c) => ({
                    ...c,
                    tabs: c.tabs.map((x) => (x.id === t.id ? { ...x, archived: true } : x)),
                  }))
                }
              >
                Archive
              </button>
            </div>
          </div>
        );
      })}

      {error && <p className="form-error">{error}</p>}

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
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grade A Technology" autoFocus />
      </label>
      <div className="field">
        <span id="colour-label">Colour</span>
        <div className="colour-picker swatches" role="group" aria-labelledby="colour-label">
          {INK_COLOURS.map((c) => (
            <button
              type="button"
              key={c.id}
              className="swatch"
              aria-label={c.label}
              aria-pressed={colour === c.value}
              style={{ background: c.value }}
              onClick={() => setColour(c.value)}
            />
          ))}
          <input type="color" aria-label="Custom colour" value={colour} onChange={(e) => setColour(e.target.value)} />
        </div>
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
          {foreignPath} already exists and was not made by this app. The app will add <code>notebook.json</code>,{" "}
          <code>pages</code> and <code>assets</code> to it and leave your existing files alone.
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

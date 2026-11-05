import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useUpdates } from "../app/updates";
import { INK_COLOURS, STROKE_WIDTHS, type AppConfig } from "../model/config";
import { backend } from "../storage/backend";
import { useNotebook } from "../store/notebook";

const GRID_SIZES = [10, 20, 25, 40];

export function GeneralSection() {
  const general = useNotebook((s) => s.config.general);
  const updateConfig = useNotebook((s) => s.updateConfig);
  const set = (patch: Partial<AppConfig["general"]>) =>
    void updateConfig((c) => ({ ...c, general: { ...c.general, ...patch } }));
  const [configPath, setConfigPath] = useState("");
  const [version, setVersion] = useState("");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const updates = useUpdates();

  useEffect(() => {
    void backend.appConfigPath().then(setConfigPath);
    if (!backend.isTauri) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()).then(setVersion);
    void import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  const toggleAutostart = async (on: boolean) => {
    try {
      const a = await import("@tauri-apps/plugin-autostart");
      if (on) await a.enable();
      else await a.disable();
      setAutostart(await a.isEnabled());
      set({ startWithWindows: on });
    } catch (e) {
      setMessage(`Could not change Start with Windows: ${String(e)}`);
    }
  };

  const u = updates.state;
  const updateText =
    u.kind === "checking"
      ? "Checking…"
      : u.kind === "none"
        ? `You have the latest version (checked at ${format(u.at, "HH:mm")}).`
        : u.kind === "available"
          ? `Version ${u.version} is available.`
          : u.kind === "installing"
            ? `Installing${u.percent !== null ? ` (${u.percent}%)` : ""}…`
            : u.kind === "error"
              ? u.message
              : "";

  return (
    <>
      <h3>General</h3>
      <p className="lead">App settings are stored in {configPath || "the app data folder"}.</p>

      <div className="settings-grid">
        <label className="field">
          Grid size
          <select
            value={general.gridSize}
            onChange={(e) => set({ gridSize: Number(e.target.value) })}
          >
            {GRID_SIZES.map((g) => (
              <option key={g} value={g}>
                {g} px{g === 20 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={general.lockToGrid}
            onChange={(e) => set({ lockToGrid: e.target.checked })}
          />
          Lock to grid by default
        </label>
        <div className="field">
          <span id="default-ink">Default ink colour</span>
          <div className="swatches" role="group" aria-labelledby="default-ink">
            {INK_COLOURS.map((c) => (
              <button
                key={c.id}
                className="swatch"
                aria-label={`${c.label} ink`}
                aria-pressed={general.inkColour.toLowerCase() === c.value.toLowerCase()}
                style={{ background: c.value }}
                onClick={() => set({ inkColour: c.value })}
              />
            ))}
          </div>
        </div>
        <label className="field">
          Default stroke width
          <select
            value={general.strokeWidth}
            onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
          >
            {STROKE_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w} px
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Dates</span>
          <span className="current-model">
            UK format, for example {format(new Date(), "EEE d MMM yyyy")}. Weeks start on Monday.
          </span>
        </div>
      </div>

      <h3 className="sub">Start-up and updates</h3>
      <div className="settings-grid">
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!autostart}
            disabled={autostart === null}
            onChange={(e) => void toggleAutostart(e.target.checked)}
          />
          Start with Windows
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={general.checkForUpdates}
            onChange={(e) => set({ checkForUpdates: e.target.checked })}
          />
          Check for updates on launch
        </label>
        <div className="field">
          <span>Version {version || "(browser preview)"}</span>
          <span className="inline-row">
            <button
              className="small-button"
              disabled={!backend.isTauri || u.kind === "checking" || u.kind === "installing"}
              onClick={() => void updates.check()}
            >
              Check now
            </button>
            {u.kind === "available" && (
              <button className="small-button" onClick={() => void updates.install()}>
                Install and restart
              </button>
            )}
          </span>
          {updateText && (
            <span role="status" className={u.kind === "error" ? "form-error" : "hint"}>
              {updateText}
            </span>
          )}
        </div>
      </div>

      <h3 className="sub">Backup</h3>
      <p className="lead">
        Your notes live in each client’s folder. These cover the app’s own setup, which has no API
        keys in it.
      </p>
      <span className="inline-row">
        <button
          className="small-button"
          onClick={() =>
            void invokeOrPreview("open_app_dir").catch((e) =>
              setMessage(`Could not open the folder: ${String(e)}`),
            )
          }
        >
          Open app data folder
        </button>
        <button
          className="small-button"
          onClick={() =>
            void backend
              .chooseFolder("Choose where to save the settings backup")
              .then(async (folder) => {
                if (!folder) return;
                const path = await invokeOrPreview<string>("backup_config", {
                  folder,
                  date: format(new Date(), "yyyy-MM-dd"),
                });
                setMessage(`Saved ${path}`);
              })
              .catch((e) => setMessage(`Could not save the backup: ${String(e)}`))
          }
        >
          Export settings as JSON
        </button>
      </span>
      {message && (
        <p role="status" className="hint" style={{ marginTop: 10 }}>
          {message}
        </p>
      )}
    </>
  );
}

async function invokeOrPreview<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!backend.isTauri) throw new Error("Needs the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

import { useEffect, useState } from "react";
import type { ExportSettings } from "../model/config";
import { backend } from "../storage/backend";
import { useNotebook } from "../store/notebook";
import { defaultDestination, useExportDialog } from "./ExportDialog";

export function ExportSection() {
  const ex = useNotebook((s) => s.config.export);
  const updateConfig = useNotebook((s) => s.updateConfig);
  const setOpenSettings = useNotebook((s) => s.setSettingsOpen);
  const set = (patch: Partial<ExportSettings>) =>
    void updateConfig((c) => ({ ...c, export: { ...c.export, ...patch } }));
  const [fallback, setFallback] = useState("");
  useEffect(() => {
    void defaultDestination("").then(setFallback);
  }, []);

  return (
    <>
      <h3>Export</h3>
      <p className="lead">
        Defaults for the export dialog (Ctrl+Shift+E). Each export goes into a new folder named with
        the date, so nothing is overwritten.
      </p>
      <div className="settings-grid">
        <label className="field">
          Default format
          <select
            value={ex.format}
            onChange={(e) => set({ format: e.target.value as ExportSettings["format"] })}
          >
            <option value="markdown">Markdown</option>
            <option value="pdf">PDF</option>
            <option value="both">Both</option>
          </select>
        </label>
        <div className="field">
          <span>Default destination</span>
          <span className="inline-row">
            <code className="path-preview">{ex.destination || `${fallback} (Documents)`}</code>
            <button
              className="small-button"
              onClick={() =>
                void backend
                  .chooseFolder("Choose the default export folder")
                  .then((f) => f && set({ destination: f }))
              }
            >
              Choose folder
            </button>
            {ex.destination && (
              <button className="small-button" onClick={() => set({ destination: "" })}>
                Use Documents
              </button>
            )}
          </span>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ex.includeImages}
            onChange={(e) => set({ includeImages: e.target.checked })}
          />
          Include images
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ex.includeDone}
            onChange={(e) => set({ includeDone: e.target.checked })}
          />
          Include done items
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ex.printerFriendly}
            onChange={(e) => set({ printerFriendly: e.target.checked })}
          />
          <span>
            Printer friendly PDF
            <span className="hint">
              White paper, light blue grid and dark ink, so pages don’t use a lot of toner.
            </span>
          </span>
        </label>
        <span className="inline-row">
          <button
            className="pill primary"
            onClick={() => {
              setOpenSettings(false);
              useExportDialog.getState().setOpen(true);
            }}
          >
            Export now
          </button>
        </span>
      </div>
    </>
  );
}

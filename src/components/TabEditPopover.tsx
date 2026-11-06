import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNotebook } from "../store/notebook";
import { ColourPicker } from "./ColourPicker";

/** Rename a tab and change its colour, beside the tab it belongs to. */
export function TabEditPopover({
  tabId,
  anchor,
  focus,
  onClose,
}: {
  tabId: string;
  anchor: DOMRect;
  focus: "name" | "colour";
  onClose(): void;
}) {
  const tab = useNotebook((s) => s.config.tabs.find((t) => t.id === tabId));
  const [name, setName] = useState(tab?.name ?? "");
  const [colour, setColour] = useState(tab?.colour ?? "#01C6A3");
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el =
      focus === "name"
        ? ref.current?.querySelector<HTMLInputElement>("input[type=text]")
        : (ref.current?.querySelector<HTMLButtonElement>(".swatch[aria-pressed=true]") ??
          ref.current?.querySelector<HTMLInputElement>("input[type=color]"));
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === "text") el.select();
  }, [focus]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  if (!tab) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const s = useNotebook.getState();
    await s.renameTab(tabId, name);
    await s.setTabColour(tabId, colour);
    onClose();
  };

  const width = Math.min(340, window.innerWidth - 32);
  return (
    <form
      ref={ref}
      className="tab-edit"
      role="dialog"
      aria-label={`Edit ${tab.name}`}
      onSubmit={(e) => void save(e)}
      style={{
        width,
        right: Math.max(16, window.innerWidth - anchor.left + 10),
        top: Math.max(16, Math.min(anchor.top, window.innerHeight - 260)),
      }}
    >
      <h3>Edit tab</h3>
      <label className="field">
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span id="tab-edit-colour">Colour</span>
        <ColourPicker value={colour} onChange={setColour} labelledBy="tab-edit-colour" />
      </div>
      <div className="form-actions">
        <button type="button" className="pill ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="pill primary" disabled={!name.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

import { beforeAll, describe, expect, it } from "vitest";
import { backend } from "../storage/backend";
import { useNotebook } from "./notebook";

// Runs against the in-memory backend; the Rust copy-and-verify step has its own tests.

const OLD = "C:/Demo/Move/Old";
const NEW = "C:/Demo/Move/New";
const BUSY = "C:/Demo/Move/Busy";
const state = () => useNotebook.getState();
const tabId = () => state().config.tabs[0].id;
const tab = () => {
  const t = state().tabs[tabId()];
  if (t?.status !== "ok") throw new Error("tab not loaded");
  return t;
};

describe("move existing notes", () => {
  beforeAll(async () => {
    const r = await backend.prepareClientFolder(OLD, "Move", "#8FB8FF", false);
    await state().addClient({
      name: "Move",
      colour: "#8FB8FF",
      folder: OLD,
      notesPath: r.notesPath,
    });
    await state().newPage();
    // An edit still waiting for autosave must be saved before the copy is made.
    state().updatePage((p) => ({ ...p, title: "Moved page" }));
  });

  it("refuses a destination that already has notes, and changes nothing", async () => {
    await backend.writeTextAtomic(`${BUSY}/notes/pages/x.page.json`, "{}");
    await expect(state().moveNotes(tabId(), BUSY)).rejects.toThrow(/not empty/);
    expect(state().config.tabs[0].folder).toBe(OLD);
    expect(tab().notesPath).toBe(`${OLD}/notes`);
    expect(await backend.listPageFiles(`${OLD}/notes`)).toHaveLength(1);
  });

  it("moves the notes, points the tab at the new folder and says so", async () => {
    await state().moveNotes(tabId(), NEW);
    expect(state().config.tabs[0].folder).toBe(NEW);
    expect(tab().notesPath).toBe(`${NEW}/notes`);
    expect(tab().pages.map((p) => p.page.title)).toEqual(["Moved page"]);
    const moved = await backend.listPageFiles(`${NEW}/notes`);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/-moved-page\.page\.json$/);
    expect(await backend.pathExists(`${OLD}/notes`)).toBe(false);
    expect(state().notice).toMatch(/Moved and checked .* Recycle Bin/);
  });
});

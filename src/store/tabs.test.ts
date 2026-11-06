import { beforeAll, describe, expect, it } from "vitest";
import { backend } from "../storage/backend";
import type { TabConfig } from "../model/config";
import { useNotebook, visibleTabs } from "./notebook";
import { applyTabOrder, moveToSlot } from "./tabOrder";

describe("moveToSlot", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves up and down by insertion slot", () => {
    expect(moveToSlot(ids, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveToSlot(ids, "a", 4)).toEqual(["b", "c", "d", "a"]);
    expect(moveToSlot(ids, "a", 2)).toEqual(["b", "a", "c", "d"]);
    expect(moveToSlot(ids, "d", 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("treats the slots either side of an item as no move", () => {
    expect(moveToSlot(ids, "b", 1)).toEqual(ids);
    expect(moveToSlot(ids, "b", 2)).toEqual(ids);
  });
  it("clamps out-of-range slots and ignores unknown ids", () => {
    expect(moveToSlot(ids, "b", -3)).toEqual(["b", "a", "c", "d"]);
    expect(moveToSlot(ids, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveToSlot(ids, "z", 0)).toEqual(ids);
  });
});

describe("applyTabOrder", () => {
  const tab = (id: string, order: number, archived = false): TabConfig => ({
    id,
    name: id,
    colour: "#fff",
    folder: `C:/${id}`,
    order,
    archived,
    excludeFromAi: false,
  });
  it("numbers visible tabs in order and keeps archived ones after them", () => {
    const tabs = [tab("a", 0), tab("x", 1, true), tab("b", 5), tab("c", 9)];
    const out = applyTabOrder(tabs, ["c", "a", "b"]);
    expect(Object.fromEntries(out.map((t) => [t.id, t.order]))).toEqual({ c: 0, a: 1, b: 2, x: 3 });
  });
});

describe("tab actions", () => {
  const state = () => useNotebook.getState();
  const names = () => visibleTabs(state().config).map((t) => t.name);
  const idOf = (name: string) => state().config.tabs.find((t) => t.name === name)!.id;

  beforeAll(async () => {
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      const folder = `C:/Demo/Tabs/${name}`;
      const r = await backend.prepareClientFolder(folder, name, "#01C6A3", false);
      await state().addClient({ name, colour: "#01C6A3", folder, notesPath: r.notesPath });
    }
  });

  it("renames a tab, ignoring blank names", async () => {
    await state().renameTab(idOf("Bravo"), "  Bravo Ltd  ");
    await state().renameTab(idOf("Bravo Ltd"), "   ");
    expect(names()).toEqual(["Alpha", "Bravo Ltd", "Charlie"]);
  });

  it("changes a tab's colour", async () => {
    await state().setTabColour(idOf("Alpha"), "#FF5C86");
    expect(state().config.tabs.find((t) => t.name === "Alpha")!.colour).toBe("#FF5C86");
  });

  it("reorders tabs and saves the order", async () => {
    await state().moveTab(idOf("Charlie"), 0);
    expect(names()).toEqual(["Charlie", "Alpha", "Bravo Ltd"]);
    const saved = JSON.parse((await backend.readAppConfig())!) as { tabs: TabConfig[] };
    expect(
      saved.tabs
        .filter((t) => !t.archived)
        .sort((a, b) => a.order - b.order)
        .map((t) => t.name),
    ).toEqual(["Charlie", "Alpha", "Bravo Ltd"]);
  });

  it("archives the open tab and opens its neighbour", async () => {
    state().openTab(idOf("Alpha"));
    await state().archiveTab(idOf("Alpha"));
    expect(names()).toEqual(["Charlie", "Bravo Ltd"]);
    expect(state().view).toEqual({ kind: "tab", tabId: idOf("Bravo Ltd") });
    expect(state().notice).toMatch(/Archived "Alpha"/);
  });

  it("restores an archived tab at the end and opens it", async () => {
    await state().restoreTab(idOf("Alpha"));
    expect(names()).toEqual(["Charlie", "Bravo Ltd", "Alpha"]);
    expect(state().view).toEqual({ kind: "tab", tabId: idOf("Alpha") });
    expect(state().tabs[idOf("Alpha")]?.status).toBe("ok");
    expect(state().notice).toBeNull(); // the "Archived" notice no longer applies
  });

  it("archiving the last visible tab leaves the empty state", async () => {
    for (const name of ["Charlie", "Bravo Ltd", "Alpha"]) await state().archiveTab(idOf(name));
    expect(names()).toEqual([]);
    expect(state().view).toEqual({ kind: "empty" });
  });
});

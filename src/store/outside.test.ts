import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backend } from "../storage/backend";
import { pagePath } from "../storage/paths";
import { createPage, serialisePage, type Page } from "../model/page";
import { currentPageOf, useNotebook } from "./notebook";

// Simulates edits made outside the app (another editor, OneDrive, Dropbox) by writing
// straight to the in-memory backend, then feeding the watcher's file names to the store.

const FOLDER = "C:/Demo/Outside";
const NOTES = `${FOLDER}/notes`;

const state = () => useNotebook.getState();
function tab() {
  const tabId = state().config.tabs[0].id;
  const t = state().tabs[tabId];
  if (t?.status !== "ok") throw new Error("tab not loaded");
  return { tabId, pages: t.pages };
}
const byTitle = (title: string) => tab().pages.find((p) => p.page.title === title);
const writeOutside = (fileName: string, text: string) =>
  backend.writeTextAtomic(pagePath(NOTES, fileName), text);
const changed = (...files: string[]) => state().applyOutsideChanges(NOTES, files);

async function addPage(title: string, at: string): Promise<{ fileName: string; page: Page }> {
  await state().newPage();
  const { tabId, pages } = tab();
  const last = pages[pages.length - 1];
  state().updatePageIn(tabId, last.page.id, (p) => ({ ...p, title, createdAt: at }));
  await state().flushSaves();
  const saved = tab().pages.find((p) => p.page.id === last.page.id);
  if (!saved) throw new Error("page missing");
  return { fileName: saved.fileName, page: saved.page };
}

describe("changes made outside the app", () => {
  beforeAll(async () => {
    const r = await backend.prepareClientFolder(FOLDER, "Outside", "#E8A828", false);
    await state().addClient({
      name: "Outside",
      colour: "#E8A828",
      folder: FOLDER,
      notesPath: r.notesPath,
    });
    await addPage("Alpha", "2026-11-01T09:00:00.000Z");
    await addPage("Bravo", "2026-11-02T09:00:00.000Z");
  });

  beforeEach(() => state().dismissNotice());

  it("ignores the app's own saves", async () => {
    const before = byTitle("Bravo");
    await changed(before!.fileName);
    expect(byTitle("Bravo")).toBe(before);
    expect(state().notice).toBeNull();
  });

  it("reloads a page with no unsaved edits", async () => {
    const alpha = byTitle("Alpha")!;
    const edited: Page = {
      ...alpha.page,
      elements: [
        {
          id: "outside-1",
          type: "text",
          x: 40,
          y: 40,
          rotation: 0,
          createdAt: "2026-11-06T10:00:00.000Z",
          updatedAt: "2026-11-06T10:00:00.000Z",
          text: "Added on the laptop",
          w: 200,
          fontSize: 16,
          colour: "#F4F7FF",
          heading: false,
        },
      ],
      updatedAt: "2026-11-06T10:00:00.000Z",
    };
    await writeOutside(alpha.fileName, serialisePage(edited));
    await changed(alpha.fileName);
    const after = byTitle("Alpha")!;
    expect(after.page.elements.map((e) => e.id)).toEqual(["outside-1"]);
    expect(after.fileName).toBe(alpha.fileName);
    expect(state().notice).toBeNull();
  });

  it("keeps unsaved edits and shows a notice", async () => {
    const bravo = byTitle("Bravo")!;
    const { tabId } = tab();
    state().updatePageIn(tabId, bravo.page.id, (p) => ({ ...p, title: "Bravo" }));
    await writeOutside(bravo.fileName, serialisePage({ ...bravo.page, elements: [] }));
    // Make the outside version differ from what the app last wrote.
    await writeOutside(
      bravo.fileName,
      serialisePage({ ...bravo.page, updatedAt: "2026-11-06T11:00:00.000Z" }),
    );
    await changed(bravo.fileName);
    expect(state().notice).toMatch(/"Bravo" was changed outside the app/);
    expect(byTitle("Bravo")!.page.updatedAt).not.toBe("2026-11-06T11:00:00.000Z");
    // The in-app version wins on the next save.
    await state().flushSaves();
    const disk = await backend.readTextFile(pagePath(NOTES, byTitle("Bravo")!.fileName));
    expect(disk).not.toContain("2026-11-06T11:00:00.000Z");
  });

  it("ignores a half-written file", async () => {
    const alpha = byTitle("Alpha")!;
    await writeOutside(alpha.fileName, '{"schemaVersion": 1, "id": ');
    await changed(alpha.fileName);
    expect(byTitle("Alpha")).toBe(alpha);
    // Put it back for the other tests.
    await writeOutside(alpha.fileName, serialisePage(alpha.page));
    await changed(alpha.fileName);
  });

  it("adds a page created outside, in date order", async () => {
    const page = { ...createPage(new Date("2026-11-01T12:00:00.000Z")), title: "From laptop" };
    await writeOutside("2026-11-01-from-laptop.page.json", serialisePage(page));
    await changed("2026-11-01-from-laptop.page.json");
    expect(tab().pages.map((p) => p.page.title)).toEqual(["Alpha", "From laptop", "Bravo"]);
  });

  it("follows a page renamed outside", async () => {
    const page = byTitle("From laptop")!;
    await backend.renameFile(
      pagePath(NOTES, page.fileName),
      pagePath(NOTES, "2026-11-01-renamed.page.json"),
    );
    await changed(page.fileName, "2026-11-01-renamed.page.json");
    const titles = tab().pages.filter((p) => p.page.id === page.page.id);
    expect(titles).toHaveLength(1);
    expect(titles[0].fileName).toBe("2026-11-01-renamed.page.json");
  });

  it("leaves a copy with the same page id alone", async () => {
    const alpha = byTitle("Alpha")!;
    await writeOutside("2026-11-01-alpha-copy.page.json", serialisePage(alpha.page));
    await changed("2026-11-01-alpha-copy.page.json");
    expect(tab().pages.filter((p) => p.page.id === alpha.page.id)).toHaveLength(1);
    expect(byTitle("Alpha")!.fileName).toBe(alpha.fileName);
    await backend.trashPageFile(pagePath(NOTES, "2026-11-01-alpha-copy.page.json"));
  });

  it("removes a page deleted outside and opens its neighbour", async () => {
    const page = byTitle("From laptop")!;
    const { tabId } = tab();
    state().openPageAt(tabId, page.page.id);
    await backend.trashPageFile(pagePath(NOTES, page.fileName));
    await changed(page.fileName);
    expect(byTitle("From laptop")).toBeUndefined();
    expect(currentPageOf(state())?.loaded.page.title).toBe("Bravo");
  });

  it("keeps a page deleted outside while it has unsaved edits", async () => {
    const bravo = byTitle("Bravo")!;
    const { tabId } = tab();
    state().updatePageIn(tabId, bravo.page.id, (p) => ({ ...p, title: "Bravo kept" }));
    await backend.trashPageFile(pagePath(NOTES, bravo.fileName));
    await changed(bravo.fileName);
    expect(state().notice).toMatch(/was deleted outside the app/);
    expect(byTitle("Bravo kept")).toBeDefined();
    await state().flushSaves();
    expect(await backend.listPageFiles(NOTES)).toContain(byTitle("Bravo kept")!.fileName);
  });
});

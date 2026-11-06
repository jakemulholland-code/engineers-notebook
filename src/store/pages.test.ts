import { beforeAll, describe, expect, it } from "vitest";
import { backend } from "../storage/backend";
import { pagePath } from "../storage/paths";
import { editedLabel } from "../components/pageListFormat";
import { currentPageOf, useNotebook } from "./notebook";
import type { Element } from "../model/page";

// Runs against the in-memory backend (no Tauri in Node), so nothing touches disk.

const FOLDER = "C:/Demo/Page list";
const NOTES = `${FOLDER}/notes`;

function tab() {
  const s = useNotebook.getState();
  const tabId = s.config.tabs[0].id;
  const t = s.tabs[tabId];
  if (t?.status !== "ok") throw new Error("tab not loaded");
  return { tabId, pages: t.pages };
}

const files = () => backend.listPageFiles(NOTES);

describe("page list actions", () => {
  beforeAll(async () => {
    const r = await backend.prepareClientFolder(FOLDER, "Page list", "#01C6A3", false);
    await useNotebook.getState().addClient({
      name: "Page list",
      colour: "#01C6A3",
      folder: FOLDER,
      notesPath: r.notesPath,
    });
    await useNotebook.getState().newPage();
    const { tabId, pages } = tab();
    const text: Element = {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      rotation: 0,
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-01T09:00:00.000Z",
      text: "Brief dev",
      w: 200,
      fontSize: 16,
      colour: "#F4F7FF",
      heading: false,
    };
    useNotebook.getState().updatePageIn(tabId, pages[0].page.id, (p) => ({
      ...p,
      title: "Audit",
      elements: [text],
    }));
    await useNotebook.getState().flushSaves();
  });

  it("renames a page and its file", async () => {
    const { tabId, pages } = tab();
    useNotebook.getState().renamePage(tabId, pages[0].page.id, "  Faceted navigation audit  ");
    await useNotebook.getState().flushSaves();
    const after = tab().pages[0];
    expect(after.page.title).toBe("Faceted navigation audit");
    expect(after.fileName).toMatch(/-faceted-navigation-audit\.page\.json$/);
    expect(await files()).toEqual([after.fileName]);
  });

  it("ignores blank and unchanged titles", () => {
    const { tabId, pages } = tab();
    const before = pages[0].page;
    useNotebook.getState().renamePage(tabId, before.id, "   ");
    useNotebook.getState().renamePage(tabId, before.id, before.title);
    expect(tab().pages[0].page).toBe(before);
  });

  it("duplicates a page with fresh ids and opens the copy", async () => {
    const { tabId, pages } = tab();
    const source = pages[0].page;
    await useNotebook.getState().duplicatePage(tabId, source.id);
    const after = tab().pages;
    expect(after).toHaveLength(2);
    const copy = after[1].page;
    expect(copy.title).toBe("Faceted navigation audit (copy)");
    expect(copy.id).not.toBe(source.id);
    expect(copy.elements).toHaveLength(1);
    expect(copy.elements[0].id).not.toBe(source.elements[0].id);
    expect(copy.elements[0]).toMatchObject({ type: "text", text: "Brief dev", x: 100, y: 100 });
    expect(currentPageOf(useNotebook.getState())?.loaded.page.id).toBe(copy.id);
    expect(await files()).toHaveLength(2);
  });

  it("deletes the current page through the bin and opens its neighbour", async () => {
    const { tabId, pages } = tab();
    const [first, copy] = pages;
    // An unsaved edit is written before the file goes to the bin.
    useNotebook.getState().updatePageIn(tabId, copy.page.id, (p) => ({ ...p, title: "Gone" }));
    expect(await useNotebook.getState().deletePage(tabId, copy.page.id)).toBe(true);
    expect(tab().pages.map((p) => p.page.id)).toEqual([first.page.id]);
    expect(currentPageOf(useNotebook.getState())?.loaded.page.id).toBe(first.page.id);
    expect(await files()).toEqual([first.fileName]);
    expect(await backend.pathExists(pagePath(NOTES, first.fileName))).toBe(true);
  });

  it("deleting the last page leaves an empty tab", async () => {
    const { tabId, pages } = tab();
    expect(await useNotebook.getState().deletePage(tabId, pages[0].page.id)).toBe(true);
    expect(tab().pages).toEqual([]);
    expect(currentPageOf(useNotebook.getState())).toBeNull();
    expect(await files()).toEqual([]);
  });
});

describe("editedLabel", () => {
  const now = new Date(2026, 10, 6, 15, 0);
  it("says today and yesterday with a time", () => {
    expect(editedLabel(new Date(2026, 10, 6, 9, 5).toISOString(), now)).toBe(
      "Edited today at 09:05",
    );
    expect(editedLabel(new Date(2026, 10, 5, 23, 59).toISOString(), now)).toBe(
      "Edited yesterday at 23:59",
    );
  });
  it("uses the UK date otherwise", () => {
    expect(editedLabel(new Date(2026, 9, 28, 12).toISOString(), now)).toBe(
      "Edited Wed 28 Oct 2026",
    );
    expect(editedLabel("not a date", now)).toBe("");
  });
});

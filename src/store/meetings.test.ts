import { beforeAll, describe, expect, it } from "vitest";
import { backend } from "../storage/backend";
import { meetingPath } from "../storage/notebook";
import { useNotebook } from "./notebook";

// Runs against the in-memory backend, so nothing touches disk.

const FOLDER = "C:/Demo/Meetings";
const NOTES = `${FOLDER}/notes`;
const state = () => useNotebook.getState();
const tabId = () => state().config.tabs[0].id;
const meetings = () => {
  const t = state().tabs[tabId()];
  if (t?.status !== "ok") throw new Error("tab not loaded");
  return t.meetings;
};
const files = () => backend.listMeetingFiles(NOTES);

describe("meetings in a client tab", () => {
  let first = "";

  beforeAll(async () => {
    const r = await backend.prepareClientFolder(FOLDER, "Meetings", "#01C6A3", false);
    await state().addClient({
      name: "Meetings",
      colour: "#01C6A3",
      folder: FOLDER,
      notesPath: r.notesPath,
    });
  });

  it("adds a meeting as a Markdown file and selects it", async () => {
    first = await state().addMeeting(tabId(), {
      title: "Weekly sync",
      date: "2026-11-05",
      body: "- Send the brief\n- Book the crit",
    });
    expect(await files()).toEqual(["2026-11-05-weekly-sync.md"]);
    const text = await backend.readTextFile(meetingPath(NOTES, "2026-11-05-weekly-sync.md"));
    expect(text).toContain('title: "Weekly sync"');
    expect(text).toContain("- Send the brief");
    expect(state().selectedMeeting).toBe(first);
  });

  it("keeps meetings newest first", async () => {
    await state().addMeeting(tabId(), { title: "Kick-off", date: "2026-10-28", body: "Scope" });
    await state().addMeeting(tabId(), { title: "Crit", date: "2026-11-06", body: "Feedback" });
    expect(meetings().map((m) => m.meeting.title)).toEqual(["Crit", "Weekly sync", "Kick-off"]);
  });

  it("renames the file when the title or date changes", async () => {
    await state().updateMeeting(tabId(), first, {
      title: "Weekly sync with Sam",
      date: "2026-11-04",
    });
    expect(await files()).toContain("2026-11-04-weekly-sync-with-sam.md");
    expect(await files()).not.toContain("2026-11-05-weekly-sync.md");
    const m = meetings().find((x) => x.meeting.id === first)!;
    expect(m.meeting.title).toBe("Weekly sync with Sam");
  });

  it("saves the include-in-catch-up switch", async () => {
    await state().updateMeeting(tabId(), first, { includeInAi: false });
    const text = await backend.readTextFile(
      meetingPath(NOTES, "2026-11-04-weekly-sync-with-sam.md"),
    );
    expect(text).toContain("includeInAi: false");
  });

  it("loads meetings back, including a file dropped in by hand", async () => {
    await backend.writeMeetingFile(NOTES, "2026-10-01-old-call.md", "# Old call\n\nNotes");
    await state().reloadTab(tabId());
    expect(meetings().map((m) => m.meeting.title)).toEqual([
      "Crit",
      "Weekly sync with Sam",
      "Kick-off",
      "Old call",
    ]);
    expect(meetings().find((m) => m.meeting.id === first)?.meeting.includeInAi).toBe(false);
  });

  it("gives a dropped-in file a real id when it is first saved", async () => {
    const dropped = meetings().find((m) => m.meeting.title === "Old call")!;
    state().openMeeting(tabId(), dropped.meeting.id);
    await state().updateMeeting(tabId(), dropped.meeting.id, { body: "Notes, tidied" });
    const after = meetings().find((m) => m.meeting.title === "Old call")!;
    expect(after.meeting.id.startsWith("file:")).toBe(false);
    expect(state().selectedMeeting).toBe(after.meeting.id);
  });

  it("deletes a meeting and selects its neighbour", async () => {
    state().openMeeting(tabId(), first);
    await state().deleteMeeting(tabId(), first);
    expect(await files()).not.toContain("2026-11-04-weekly-sync-with-sam.md");
    expect(meetings().map((m) => m.meeting.title)).toEqual(["Crit", "Kick-off", "Old call"]);
    expect(state().selectedMeeting).toBe(meetings()[1].meeting.id);
  });

  it("opening a page leaves the Meetings view", () => {
    expect(state().meetingsOpen).toBe(true);
    state().openTab(tabId());
    expect(state().meetingsOpen).toBe(false);
  });
});

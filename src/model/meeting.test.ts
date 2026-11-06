import { describe, expect, it } from "vitest";
import {
  createMeeting,
  dateFromPaste,
  meetingFileName,
  parseMeeting,
  serialiseMeeting,
  titleFromPaste,
} from "./meeting";

const now = new Date(2026, 10, 6, 12);

describe("meeting files", () => {
  it("round-trips through Markdown with front matter", () => {
    const m = createMeeting(
      {
        title: 'Weekly "sync": Grade A',
        date: "2026-11-05",
        body: "## Actions\n- Jake: send the brief\r\n- Sam: confirm budget\n\n",
      },
      now,
    );
    const text = serialiseMeeting(m);
    expect(text.startsWith("---\nid: ")).toBe(true);
    expect(text).toContain('title: "Weekly \\"sync\\": Grade A"');
    expect(text.endsWith("- Sam: confirm budget\n")).toBe(true);
    const back = parseMeeting(text, "2026-11-05-weekly-sync.md", now);
    expect(back).toEqual({
      ...m,
      body: "## Actions\n- Jake: send the brief\n- Sam: confirm budget",
    });
  });

  it("reads a Markdown file dropped in by hand", () => {
    const m = parseMeeting(
      "# Kick-off with Quest\n\nScope agreed.\n",
      "2026-10-28-kickoff.md",
      now,
    );
    expect(m).toMatchObject({
      id: "file:2026-10-28-kickoff.md",
      title: "Kick-off with Quest",
      date: "2026-10-28",
      source: "pasted",
      includeInAi: true,
      body: "# Kick-off with Quest\n\nScope agreed.",
    });
  });

  it("falls back sensibly on odd front matter", () => {
    const m = parseMeeting(
      "---\ntitle: Plain title\ndate: soon\nincludeInAi: false\n---\nNotes",
      "x.md",
      now,
    );
    expect(m.title).toBe("Plain title");
    expect(m.date).toBe("2026-11-06"); // not a date, and none in the file name
    expect(m.includeInAi).toBe(false);
    expect(m.body).toBe("Notes");
  });

  it("names files by date and title without clashes", () => {
    const m = { date: "2026-11-05", title: "Weekly sync" };
    expect(meetingFileName(m, new Set())).toBe("2026-11-05-weekly-sync.md");
    expect(meetingFileName(m, new Set(["2026-11-05-weekly-sync.md"]))).toBe(
      "2026-11-05-weekly-sync-2.md",
    );
  });
});

describe("filling the form from pasted notes", () => {
  it("takes the title from the first line", () => {
    expect(titleFromPaste("\n\n# Quarterly review  \nMore")).toBe("Quarterly review");
    expect(titleFromPaste("**Design crit**\n- item")).toBe("Design crit");
    expect(titleFromPaste("   \n  ")).toBeUndefined();
  });

  it("finds a full date near the top, UK or US order", () => {
    expect(dateFromPaste("Weekly sync\nThu 5 Nov 2026 · 10:00", now)).toBe("2026-11-05");
    expect(dateFromPaste("Weekly sync\n5th November 2026", now)).toBe("2026-11-05");
    expect(dateFromPaste("Weekly sync\nNovember 5, 2026", now)).toBe("2026-11-05");
    expect(dateFromPaste("Sync 2026-11-04", now)).toBe("2026-11-04");
  });

  it("does not guess without a year", () => {
    expect(dateFromPaste("Weekly sync\nThursday\nnext steps by Friday", now)).toBeUndefined();
    expect(dateFromPaste("Call on 5 Nov", now)).toBeUndefined();
  });
});

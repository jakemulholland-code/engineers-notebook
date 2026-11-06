import { describe, expect, it } from "vitest";
import type { TabConfig } from "../model/config";
import { createMeeting, type Meeting } from "../model/meeting";
import { buildCatchUpContext } from "./payload";

const now = new Date(2026, 10, 6, 12);
const tab = (id: string, extra: Partial<TabConfig> = {}): TabConfig => ({
  id,
  name: id === "a" ? "Grade A" : "Quest",
  colour: "#01C6A3",
  folder: `C:/${id}`,
  order: 0,
  archived: false,
  excludeFromAi: false,
  ...extra,
});
const meeting = (title: string, date: string, body: string, extra: Partial<Meeting> = {}) => ({
  ...createMeeting({ title, date, body }, now),
  ...extra,
});

describe("meetings in the catch-up payload", () => {
  const sync = meeting("Weekly sync", "2026-11-05", "## Actions\n- Jake: send the brief");
  const kickoff = meeting("Kick-off", "2026-10-28", "Scope agreed");
  const hidden = meeting("Private chat", "2026-11-06", "Not for the AI", { includeInAi: false });
  const other = meeting("Quest call", "2026-11-04", "Quest notes");

  const build = (extra: Parameters<typeof buildCatchUpContext>[0]["tabs"] = []) =>
    buildCatchUpContext({
      tabs: [{ tab: tab("a"), pages: [], meetings: [kickoff, sync, hidden] }, ...extra],
      now,
      lookAheadDays: 14,
      staleDays: 21,
    });

  it("sends included meetings in full, newest first, each with a ref", () => {
    const ctx = build();
    const section = ctx.text.split("## Meeting notes")[1];
    expect(section.indexOf("Weekly sync")).toBeLessThan(section.indexOf("Kick-off"));
    expect(section).toContain("- Jake: send the brief");
    expect(ctx.text).not.toContain("Not for the AI");
    const ref = Object.entries(ctx.refs).find(([, r]) => r.meetingId === sync.id)?.[0];
    expect(ref).toBeDefined();
    expect(ctx.text).toContain(`### [${ref}] Grade A › Weekly sync (meeting on 2026-11-05)`);
    expect(ctx.stats.meetings).toBe(2);
  });

  it("never reads meetings from excluded or archived tabs", () => {
    const ctx = build([
      { tab: tab("q", { excludeFromAi: true }), pages: [], meetings: [other] },
      { tab: tab("r", { archived: true }), pages: [], meetings: [other] },
    ]);
    expect(ctx.text).not.toContain("Quest notes");
    expect(Object.values(ctx.refs).some((r) => r.meetingId === other.id)).toBe(false);
  });

  it("lists older meetings by title once the budget is used", () => {
    const ctx = buildCatchUpContext({
      tabs: [{ tab: tab("a"), pages: [], meetings: [kickoff, sync] }],
      now,
      lookAheadDays: 14,
      staleDays: 21,
      meetingBudget: 60,
    });
    expect(ctx.text).toContain("Older meetings, titles only:");
    expect(ctx.text).toMatch(/\[r\d+\] Grade A › Kick-off \(meeting on 2026-10-28\)/);
    expect(ctx.text).not.toContain("Scope agreed");
    expect(ctx.stats.truncated).toBe(true);
  });

  it("only one tab when asked", () => {
    const ctx = buildCatchUpContext({
      tabs: [
        { tab: tab("a"), pages: [], meetings: [sync] },
        { tab: tab("q"), pages: [], meetings: [other] },
      ],
      now,
      lookAheadDays: 14,
      staleDays: 21,
      tabId: "q",
    });
    expect(ctx.text).toContain("Quest notes");
    expect(ctx.text).not.toContain("send the brief");
  });
});

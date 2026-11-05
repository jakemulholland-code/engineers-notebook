import { describe, expect, it } from "vitest";
import { PageSchema, type Element } from "../model/page";
import {
  applyTransform,
  checklistFromLines,
  duplicate,
  makeChecklist,
  makeLine,
  makeShape,
  makeStroke,
  makeText,
  restyle,
  strokePath,
} from "./elements";
import { boxFromCorners, lockAngle, snap, snapPoint, squareCorner } from "./geometry";
import { HISTORY_LIMIT, emptyHistory, record, redo, undo } from "./history";

const validPage = (elements: Element[]) =>
  PageSchema.safeParse({
    schemaVersion: 1,
    id: "p",
    title: "t",
    createdAt: "x",
    updatedAt: "x",
    elements,
  }).success;

describe("grid snapping", () => {
  it("snaps to the nearest 20 px", () => {
    expect(snap(29, 20)).toBe(20);
    expect(snap(31, 20)).toBe(40);
    expect(snap(-11, 20)).toBe(-20);
  });

  it("leaves points alone when off (Alt held or lock off)", () => {
    expect(snapPoint({ x: 33, y: 7 }, 20, false)).toEqual({ x: 33, y: 7 });
    expect(snapPoint({ x: 33, y: 7 }, 20, true)).toEqual({ x: 40, y: 0 });
  });
});

describe("Shift-locked lines", () => {
  it("locks to 0, 90 and 45 degrees", () => {
    expect(lockAngle(100, 10)).toEqual({ x: 100, y: 0 });
    expect(lockAngle(-8, 100)).toEqual({ x: 0, y: 100 });
    expect(lockAngle(80, -100)).toEqual({ x: 100, y: -100 });
  });

  it("keeps grid points on the grid at 45 degrees", () => {
    const p = lockAngle(60, 80);
    expect(p.x % 20).toBe(0);
    expect(p.y % 20).toBe(0);
  });
});

describe("boxes", () => {
  it("normalises a drag in any direction", () => {
    expect(boxFromCorners({ x: 100, y: 80 }, { x: 40, y: 20 })).toEqual({
      x: 40,
      y: 20,
      w: 60,
      h: 60,
    });
  });

  it("squares a circle drag", () => {
    expect(squareCorner({ x: 0, y: 0 }, { x: 40, y: -100 })).toEqual({ x: 100, y: -100 });
  });
});

describe("undo history", () => {
  it("undoes and redoes in order", () => {
    let h = emptyHistory<number>();
    h = record(h, 1);
    h = record(h, 2);
    const u1 = undo(h, 3)!;
    expect(u1.value).toBe(2);
    const u2 = undo(u1.history, 2)!;
    expect(u2.value).toBe(1);
    expect(undo(u2.history, 1)).toBeNull();
    const r1 = redo(u2.history, 1)!;
    expect(r1.value).toBe(2);
  });

  it("drops redo after a new change", () => {
    let h = record(emptyHistory<number>(), 1);
    h = undo(h, 2)!.history;
    h = record(h, 1);
    expect(redo(h, 5)).toBeNull();
  });

  it(`keeps at least ${HISTORY_LIMIT} steps`, () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 150; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(50);
  });
});

describe("element factories", () => {
  it("builds valid elements of every drawable type", () => {
    const els: Element[] = [
      makeStroke("pen", [10, 10, 0.5, 20, 25, 0.6, 30, 30, 0.7], "#fff", 4),
      makeStroke("brush", [0, 0, 0.5, 5, 5, 0.5], "#fff", 4),
      makeLine("line", 0, 0, 100, 0, "#fff", 2),
      makeLine("arrow", 0, 0, 100, 40, "#fff", 2),
      makeShape("rect", { x: 0, y: 0, w: 40, h: 20 }, "#fff", 2, true),
      makeShape("ellipse", { x: 0, y: 0, w: 40, h: 40 }, "#fff", 2, false),
      makeText(60, 140, "#fff", false, "Hello"),
      makeChecklist(0, 0, ["a", "b"]),
    ];
    expect(validPage(els)).toBe(true);
  });

  it("stores stroke points relative to the first point", () => {
    const s = makeStroke("pen", [100, 200, 0.5, 110, 205, 0.6], "#fff", 4);
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.points).toEqual([0, 0, 0.5, 10, 5, 0.6]);
  });

  it("makes brush strokes wide and 40% opacity", () => {
    const b = makeStroke("brush", [0, 0, 0.5], "#fff", 4);
    expect(b.opacity).toBe(0.4);
    expect(b.width).toBeGreaterThan(4);
  });

  it("produces an outline path for a stroke", () => {
    const s = makeStroke("pen", [0, 0, 0.5, 10, 10, 0.5, 20, 5, 0.5], "#fff", 4);
    expect(strokePath(s)).toMatch(/^M.*Z$/);
  });
});

describe("transforms", () => {
  it("bakes scale into a box and snaps when unrotated", () => {
    const r = makeShape("rect", { x: 40, y: 40, w: 100, h: 60 }, "#fff", 2, false);
    const out = applyTransform(r, { x: 43, y: 38, rotation: 0, scaleX: 1.37, scaleY: 1 }, 20);
    expect(out).toMatchObject({ x: 40, y: 40, w: 140, h: 60 });
  });

  it("does not snap when the grid is off", () => {
    const r = makeShape("rect", { x: 40, y: 40, w: 100, h: 60 }, "#fff", 2, false);
    const out = applyTransform(r, { x: 43, y: 38, rotation: 0, scaleX: 1.37, scaleY: 1 }, null);
    expect(out).toMatchObject({ x: 43, y: 38, w: 137 });
  });

  it("does not snap rotated elements", () => {
    const r = makeShape("rect", { x: 40, y: 40, w: 100, h: 60 }, "#fff", 2, false);
    const out = applyTransform(r, { x: 43, y: 38, rotation: 30, scaleX: 1, scaleY: 1 }, 20);
    expect(out).toMatchObject({ x: 43, y: 38, rotation: 30 });
  });

  it("scales stroke points but not pressure", () => {
    const s = makeStroke("pen", [0, 0, 0.5, 10, 10, 0.8], "#fff", 4);
    const out = applyTransform(s, { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 3 }, null);
    expect(out.type === "stroke" && out.points).toEqual([0, 0, 0.5, 20, 30, 0.8]);
  });

  it("only changes width for text", () => {
    const t = makeText(0, 0, "#fff", false, "x");
    const out = applyTransform(t, { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 5 }, null);
    expect(out).toMatchObject({ w: t.w * 2, fontSize: t.fontSize });
  });
});

describe("duplicate, restyle, checklist edits", () => {
  it("duplicates with new ids including checklist items", () => {
    const c = makeChecklist(0, 0, ["a"]);
    const d = duplicate(c, 20, 20);
    expect(d.id).not.toBe(c.id);
    expect(d.type === "checklist" && d.items[0].id).not.toBe(c.items[0].id);
    expect(d).toMatchObject({ x: 20, y: 20 });
  });

  it("leaves images alone when restyled", () => {
    const img = {
      ...makeShape("rect", { x: 0, y: 0, w: 1, h: 1 }, "#fff", 2, false),
      type: "image" as const,
      asset: "assets/a.png",
    };
    const { colour: _c, width: _w, dashed: _d, ...rest } = img;
    void _c;
    void _w;
    void _d;
    expect(restyle(rest, { colour: "#000" })).toBe(rest);
  });

  it("keeps ticks by position when editing checklist lines", () => {
    const items = [
      { id: "1", text: "a", done: true },
      { id: "2", text: "b", done: false },
    ];
    const out = checklistFromLines(items, ["a edited", "b", "c"]);
    expect(out[0]).toMatchObject({ id: "1", text: "a edited", done: true });
    expect(out[2]).toMatchObject({ text: "c", done: false });
  });
});

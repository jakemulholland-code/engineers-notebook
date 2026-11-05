import { getStroke } from "perfect-freehand";
import { newId, type ChecklistItem, type Element } from "../model/page";
import { snap } from "./geometry";

type ElementOf<T extends Element["type"]> = Extract<Element, { type: T }>;

export const TEXT_STYLE = {
  note: { fontSize: 17, w: 360 },
  heading: { fontSize: 28, w: 600 },
  checklist: { fontSize: 16, w: 360 },
} as const;

export const BRUSH_OPACITY = 0.4;
/** Brush is a wide highlighter: its width is a multiple of the chosen stroke width. */
export const BRUSH_WIDTH_FACTOR = 5;

const stamp = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
};

/**
 * Builds a stroke from absolute page points `[x, y, pressure, ...]`.
 * The element's x/y is the first point; stored points are relative to it.
 */
export function makeStroke(
  tool: "pen" | "brush",
  absolute: number[],
  colour: string,
  width: number,
): ElementOf<"stroke"> {
  const ox = absolute[0];
  const oy = absolute[1];
  const points: number[] = [];
  for (let i = 0; i + 2 < absolute.length; i += 3) {
    points.push(round(absolute[i] - ox), round(absolute[i + 1] - oy), round(absolute[i + 2], 3));
  }
  return {
    id: newId(),
    type: "stroke",
    tool,
    x: ox,
    y: oy,
    rotation: 0,
    points,
    colour,
    width: tool === "brush" ? width * BRUSH_WIDTH_FACTOR : width,
    opacity: tool === "brush" ? BRUSH_OPACITY : 1,
    ...stamp(),
  };
}

export function makeLine(
  type: "line" | "arrow",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  width: number,
): ElementOf<"line"> | ElementOf<"arrow"> {
  const base = {
    id: newId(),
    x: x1,
    y: y1,
    rotation: 0,
    points: [0, 0, x2 - x1, y2 - y1] as [number, number, number, number],
    colour,
    width,
    ...stamp(),
  };
  return type === "line" ? { ...base, type: "line" } : { ...base, type: "arrow" };
}

export function makeShape(
  type: "rect" | "ellipse",
  box: { x: number; y: number; w: number; h: number },
  colour: string,
  width: number,
  dashed: boolean,
): ElementOf<"rect"> | ElementOf<"ellipse"> {
  const base = {
    id: newId(),
    x: box.x,
    y: box.y,
    rotation: 0,
    w: box.w,
    h: box.h,
    colour,
    width,
    dashed,
    ...stamp(),
  };
  return type === "rect" ? { ...base, type: "rect" } : { ...base, type: "ellipse" };
}

export function makeText(
  x: number,
  y: number,
  colour: string,
  heading: boolean,
  text = "",
): ElementOf<"text"> {
  const s = heading ? TEXT_STYLE.heading : TEXT_STYLE.note;
  return {
    id: newId(),
    type: "text",
    x,
    y,
    rotation: 0,
    text,
    w: s.w,
    fontSize: s.fontSize,
    colour,
    heading,
    ...stamp(),
  };
}

export function makeChecklist(
  x: number,
  y: number,
  texts: string[] = [""],
): ElementOf<"checklist"> {
  return {
    id: newId(),
    type: "checklist",
    x,
    y,
    rotation: 0,
    w: TEXT_STYLE.checklist.w,
    items: texts.map((text) => ({ id: newId(), text, done: false })),
    ...stamp(),
  };
}

export function makeImage(
  asset: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ElementOf<"image"> {
  return { id: newId(), type: "image", asset, x, y, rotation: 0, w, h, ...stamp() };
}

/** Rebuilds checklist items from edited lines, keeping ids, ticks and dates by position. */
export function checklistFromLines(previous: ChecklistItem[], lines: string[]): ChecklistItem[] {
  return lines.map((text, i) => {
    const prev = previous[i];
    return prev ? { ...prev, text } : { id: newId(), text, done: false };
  });
}

export type TransformInput = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

/**
 * Bakes a Konva transform (position, rotation, scale) into the element so the
 * stored element never carries a scale. Snaps to the grid when asked and the
 * element is not rotated.
 */
export function applyTransform(el: Element, t: TransformInput, grid: number | null): Element {
  const sx = Math.abs(t.scaleX);
  const sy = Math.abs(t.scaleY);
  const rotation = round(t.rotation, 2);
  const square = grid !== null && Math.round(rotation) % 360 === 0;
  const g = (v: number) => (square && grid ? Math.max(grid, snap(v, grid)) : v);
  const pos = (v: number) => (square && grid ? snap(v, grid) : v);
  const updatedAt = new Date().toISOString();
  const common = { x: pos(t.x), y: pos(t.y), rotation, updatedAt };

  switch (el.type) {
    case "rect":
    case "ellipse":
    case "image":
      return { ...el, ...common, w: g(el.w * sx), h: g(el.h * sy) };
    case "text":
    case "checklist":
      return { ...el, ...common, w: g(el.w * sx) };
    case "stroke": {
      const points = el.points.map((v, i) =>
        i % 3 === 0 ? round(v * sx) : i % 3 === 1 ? round(v * sy) : v,
      );
      return { ...el, ...common, points };
    }
    case "line":
    case "arrow": {
      const [a, b, c, d] = el.points;
      const end = [c * sx, d * sy];
      const snapped = square && grid ? [snap(end[0], grid), snap(end[1], grid)] : end;
      return { ...el, ...common, points: [a * sx, b * sy, snapped[0], snapped[1]] };
    }
  }
}

export function translate(el: Element, dx: number, dy: number): Element {
  return { ...el, x: el.x + dx, y: el.y + dy, updatedAt: new Date().toISOString() };
}

/** A copy with fresh ids, offset by (dx, dy). Dates are kept but reset to not done. */
export function duplicate(el: Element, dx: number, dy: number): Element {
  const t = stamp();
  const copy: Element = { ...el, id: newId(), x: el.x + dx, y: el.y + dy, ...t };
  if (copy.type === "checklist") {
    copy.items = copy.items.map((i) => ({ ...i, id: newId() }));
  }
  return copy;
}

/** Applies ink colour / stroke width to elements that have them. */
export function restyle(el: Element, style: { colour?: string; width?: number }): Element {
  const updatedAt = new Date().toISOString();
  switch (el.type) {
    case "image":
      return el;
    case "checklist":
      return el;
    case "text":
      return style.colour ? { ...el, colour: style.colour, updatedAt } : el;
    case "stroke": {
      const width =
        style.width !== undefined
          ? el.tool === "brush"
            ? style.width * BRUSH_WIDTH_FACTOR
            : style.width
          : el.width;
      return { ...el, colour: style.colour ?? el.colour, width, updatedAt };
    }
    default:
      return {
        ...el,
        colour: style.colour ?? el.colour,
        width: style.width ?? el.width,
        updatedAt,
      };
  }
}

// ----- stroke outlines -----

const outlineCache = new WeakMap<object, string>();

/** SVG path data for a freehand stroke, cached per element object. */
export function strokePath(el: ElementOf<"stroke">): string {
  const hit = outlineCache.get(el);
  if (hit !== undefined) return hit;
  const pts: [number, number, number][] = [];
  let simulated = true;
  for (let i = 0; i + 2 < el.points.length; i += 3) {
    const p = el.points[i + 2];
    if (p !== 0.5) simulated = false;
    pts.push([el.points[i], el.points[i + 1], p]);
  }
  const outline = getStroke(pts, {
    size: el.tool === "brush" ? el.width : el.width * 1.6,
    thinning: el.tool === "brush" ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: simulated,
    last: true,
  });
  const d = pathFromOutline(outline);
  outlineCache.set(el, d);
  return d;
}

export function pathFromOutline(outline: number[][]): string {
  if (outline.length === 0) return "";
  let d = `M${outline[0][0].toFixed(1)},${outline[0][1].toFixed(1)}`;
  for (let i = 1; i < outline.length; i++)
    d += `L${outline[i][0].toFixed(1)},${outline[i][1].toFixed(1)}`;
  return d + "Z";
}

function round(v: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

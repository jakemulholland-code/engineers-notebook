import Konva from "konva";
import { format } from "date-fns";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { PAGE_HEIGHT, PAGE_WIDTH, type Element, type Page } from "../model/page";
import { useNotebook } from "../store/notebook";
import { MAX_ZOOM, MIN_ZOOM, useTools } from "../store/tools";
import { importImage, placedSize } from "./assets";
import { ElementNode, clearMeasureCache, token } from "./ElementNode";
import {
  applyTransform,
  checklistFromLines,
  duplicate,
  makeChecklist,
  makeImage,
  makeLine,
  makeShape,
  makeStroke,
  makeText,
  translate,
} from "./elements";
import { boxFromCorners, lockAngle, snap, snapPoint, squareCorner, type Point } from "./geometry";
import { TextEditor } from "./TextEditor";
import { PaperBackground, TITLE_X, TITLE_Y, drawOrder } from "./PageScene";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { DatePopover } from "../components/DatePopover";
import { useExportDialog } from "../components/ExportDialog";
import { useToday } from "../reminders/useReminders";
import type { DateTag } from "../model/page";
import { ToolOptions } from "./ToolOptions";

const PAN_MARGIN = 200;
const ERASER_RADIUS = 6;

// Very high-density screens (3x) make every layer a huge canvas; 2x is still sharp
// and keeps pan and zoom smooth.
Konva.pixelRatio = Math.min(2, window.devicePixelRatio || 1);

type Draft =
  | { kind: "stroke"; tool: "pen" | "brush"; pts: number[] }
  | { kind: "shape"; type: "line" | "arrow" | "rect" | "ellipse"; start: Point; end: Point }
  | { kind: "marquee"; start: Point; end: Point; additive: boolean; base: string[] }
  | { kind: "erase"; last: Point };

type Editing = { el: Extract<Element, { type: "text" | "checklist" }>; isNew: boolean };

type Props = {
  page: Page;
  readOnly: boolean;
  notesPath: string;
  onTitleChange(title: string): void;
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function PaperStage({ page, readOnly, notesPath, onTitleChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  // Pan and zoom live in a ref and are applied to the Konva stage directly (and to
  // the HTML overlays through CSS variables), so moving the view never re-renders React.
  const view = useRef({ x: 0, y: 0, zoom: useTools.getState().zoom });
  const [panning, setPanning] = useState<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const [spaceDown, setSpaceDown] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [, setFontTick] = useState(0);

  const setZoom = useTools((s) => s.setZoom);
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);
  const selectedIds = useTools((s) => s.selectedIds);
  const setSelected = useTools((s) => s.setSelected);
  const general = useNotebook((s) => s.config.general);
  const editElements = useNotebook((s) => s.editElements);

  const grid = general.gridSize;
  // Refs mirror values that stable callbacks need to read.
  const live = useRef({
    lock: general.lockToGrid,
    grid,
    alt: false,
    selected: selectedIds,
    elements: page.elements,
  });
  live.current.lock = general.lockToGrid;
  live.current.grid = grid;
  live.current.selected = selectedIds;
  live.current.elements = page.elements;
  const lastPointer = useRef<Point | null>(null);
  const erased = useRef(new Set<string>());

  const colours = useMemo(
    () => ({
      paper: token("--paper"),
      minor: token("--grid-minor"),
      major: token("--grid-major"),
      mint: token("--mint"),
      desk: token("--desk"),
    }),
    [],
  );

  // ---------- view: size, pan, zoom ----------

  const sizeRef = useRef(size);
  sizeRef.current = size;

  /** Keeps the sheet reachable: at least PAN_MARGIN of it stays in view. */
  const clamp = useCallback((p: Point, z: number) => {
    const s = sizeRef.current;
    const minX = Math.min(0, s.w - PAGE_WIDTH * z - PAN_MARGIN);
    const minY = Math.min(0, s.h - PAGE_HEIGHT * z - PAN_MARGIN);
    return {
      x: Math.min(PAN_MARGIN, Math.max(minX, p.x)),
      y: Math.min(PAN_MARGIN, Math.max(minY, p.y)),
    };
  }, []);

  // While a wheel zoom is in progress the page is drawn from a cached bitmap
  // (one image instead of every vector), then redrawn sharp once the wheel stops.
  const contentRef = useRef<Konva.Group>(null);
  const zoomSettle = useRef<number | undefined>(undefined);
  const cacheDuringZoom = useCallback(() => {
    const g = contentRef.current;
    if (!g) return;
    if (!g.isCached())
      g.cache({
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        pixelRatio: 2,
        imageSmoothingEnabled: true,
      });
    window.clearTimeout(zoomSettle.current);
    zoomSettle.current = window.setTimeout(() => {
      g.clearCache();
      g.getLayer()?.batchDraw();
    }, 160);
  }, []);

  const applyView = useCallback(
    (x: number, y: number, zoomIn: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomIn));
      const c = clamp({ x, y }, z);
      view.current = { x: c.x, y: c.y, zoom: z };
      const st = stageRef.current;
      if (st) {
        st.position(c);
        st.scale({ x: z, y: z });
        st.batchDraw();
      }
      const w = wrapRef.current;
      if (w) {
        w.style.setProperty("--pan-x", `${c.x}px`);
        w.style.setProperty("--pan-y", `${c.y}px`);
        w.style.setProperty("--zoom", String(z));
      }
      if (useTools.getState().zoom !== z) setZoom(z); // status bar only
    },
    [clamp, setZoom],
  );

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Measure now, so anything that centres the view on mount uses the real size.
    const r = el.getBoundingClientRect();
    sizeRef.current = { w: r.width, h: r.height };
    setSize(sizeRef.current);
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-clamp when the window resizes.
  useLayoutEffect(() => {
    const v = view.current;
    applyView(v.x, v.y, v.zoom);
  }, [size, applyView]);

  useLayoutEffect(() => {
    applyView(0, 0, view.current.zoom);
    setSelected([]);
    setEditing(null);
    setDraft(null);
    setDating(null);
    setMenu(null);
  }, [page.id, setSelected, applyView]);

  useEffect(() => {
    void document.fonts.ready.then(() => {
      clearMeasureCache();
      setFontTick((n) => n + 1);
      stageRef.current?.batchDraw();
    });
  }, []);

  const toPage = useCallback((evt?: Event): Point | null => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return null;
    if (evt) stage.setPointersPositions(evt);
    return layer.getRelativePointerPosition();
  }, []);

  const viewCentre = (): Point => {
    const v = view.current;
    return { x: (size.w / 2 - v.x) / v.zoom, y: (size.h / 2 - v.y) / v.zoom };
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const v = view.current;
    if (e.evt.ctrlKey) {
      const pointer = stage.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.evt.deltaY * 0.0015)),
      );
      const world = { x: (pointer.x - v.x) / v.zoom, y: (pointer.y - v.y) / v.zoom };
      cacheDuringZoom();
      applyView(pointer.x - world.x * next, pointer.y - world.y * next, next);
    } else {
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
      applyView(v.x - dx, v.y - dy, v.zoom);
    }
  };

  useEffect(() => {
    if (!panning) return;
    const move = (e: PointerEvent) =>
      applyView(
        panning.px + e.clientX - panning.x,
        panning.py + e.clientY - panning.y,
        view.current.zoom,
      );
    const up = () => setPanning(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [panning, applyView]);

  // ---------- element callbacks (stable, so memoised nodes don't re-render) ----------

  const dragBound = useCallback((abs: Konva.Vector2d) => {
    const st = stageRef.current;
    const { lock, alt, grid: g } = live.current;
    if (!st || !lock || alt) return abs;
    const z = st.scaleX();
    return {
      x: snap((abs.x - st.x()) / z, g) * z + st.x(),
      y: snap((abs.y - st.y()) / z, g) * z + st.y(),
    };
  }, []);

  const dragCommitQueued = useRef(false);
  const onDragEnd = useCallback(() => {
    if (dragCommitQueued.current) return;
    dragCommitQueued.current = true;
    requestAnimationFrame(() => {
      dragCommitQueued.current = false;
      const layer = layerRef.current;
      if (!layer) return;
      const nodes = new Map<string, Konva.Node>();
      for (const n of layer.find(".element")) nodes.set(n.id(), n);
      editElements((els) =>
        els.map((el) => {
          const n = nodes.get(el.id);
          if (!n || (n.x() === el.x && n.y() === el.y)) return el;
          return { ...el, x: n.x(), y: n.y(), updatedAt: new Date().toISOString() };
        }),
      );
    });
  }, [editElements]);

  const onDblClick = useCallback((id: string) => {
    if (useTools.getState().tool !== "select") return;
    const el = live.current.elements.find((e) => e.id === id);
    if (el && (el.type === "text" || el.type === "checklist")) setEditing({ el, isNew: false });
  }, []);

  const onToggleItem = useCallback(
    (elementId: string, itemId: string) => {
      const now = new Date().toISOString();
      editElements((els) =>
        els.map((el) => {
          if (el.id !== elementId || el.type !== "checklist") return el;
          return {
            ...el,
            updatedAt: now,
            items: el.items.map((i) => {
              if (i.id !== itemId) return i;
              const done = !i.done;
              // Ticking a dated item marks its date done (SPEC: Dates and Reminders).
              const date = i.date ? { ...i.date, done, doneAt: done ? now : undefined } : undefined;
              return date ? { ...i, done, date } : { ...i, done };
            }),
          };
        }),
      );
    },
    [editElements],
  );

  // ---------- dates ----------

  const today = useToday();
  const [dating, setDating] = useState<{
    elementId: string;
    itemId?: string;
    x: number;
    y: number;
  } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    elementId: string;
    itemId?: string;
  } | null>(null);

  /** Opens "Date this item" under an element (or one checklist row). */
  const openDating = useCallback((elementId: string, itemId?: string) => {
    const layer = layerRef.current;
    const node = layer?.findOne<Konva.Group>(`#${elementId}`);
    if (!layer || !node) return;
    const target = (itemId && node.findOne(`.ci-${itemId}`)) || node;
    const r = target.getClientRect({ relativeTo: layer });
    setMenu(null);
    setDating({ elementId, itemId, x: r.x, y: r.y + r.height });
  }, []);

  const datingTag = useMemo(() => {
    if (!dating) return undefined;
    const el = page.elements.find((e) => e.id === dating.elementId);
    if (!el) return undefined;
    if (dating.itemId && el.type === "checklist")
      return el.items.find((i) => i.id === dating.itemId)?.date;
    return el.date;
  }, [dating, page.elements]);

  const writeDate = (target: { elementId: string; itemId?: string }, tag: DateTag | undefined) => {
    const now = new Date().toISOString();
    editElements((els) =>
      els.map((el) => {
        if (el.id !== target.elementId) return el;
        if (target.itemId && el.type === "checklist") {
          return {
            ...el,
            updatedAt: now,
            items: el.items.map((i) =>
              // An item's date follows its tick box.
              i.id !== target.itemId
                ? i
                : { ...i, date: tag ? { ...tag, done: i.done } : undefined },
            ),
          };
        }
        return { ...el, date: tag, updatedAt: now };
      }),
    );
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (readOnly) return;
    const node = e.target.findAncestor(".element", true);
    if (!node) {
      setMenu(null);
      return;
    }
    const id = node.id();
    if (!live.current.selected.includes(id)) setSelected([id]);
    const row = e.target.findAncestor(".checklist-item", true);
    const itemId = row
      ?.name()
      .split(" ")
      .find((n) => n.startsWith("ci-"))
      ?.slice(3);
    setMenu({ x: e.evt.clientX, y: e.evt.clientY, elementId: id, itemId });
  };

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const el = page.elements.find((x) => x.id === menu.elementId);
    if (!el) return [];
    const items: MenuItem[] = [];
    if (menu.itemId && el.type === "checklist") {
      const item = el.items.find((i) => i.id === menu.itemId);
      items.push({
        label: item?.date ? "Edit date for this item" : "Add date to this item",
        onSelect: () => openDating(el.id, menu.itemId),
      });
    }
    items.push({ label: el.date ? "Edit date" : "Add date", onSelect: () => openDating(el.id) });
    items.push({
      label: "Duplicate",
      onSelect: () => {
        const copy = duplicate(el, grid, grid);
        editElements((els) => [...els, copy]);
        setSelected([copy.id]);
      },
    });
    items.push({
      label: "Delete",
      danger: true,
      onSelect: () => {
        editElements((els) => els.filter((x) => x.id !== el.id));
        setSelected([]);
      },
    });
    return items;
  };

  // ---------- flash an element opened from Reminders ----------

  const flash = useNotebook((s) => s.flash);
  const [flashBox, setFlashBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    key: number;
  } | null>(null);
  const flashRef = useRef<Konva.Rect>(null);

  useEffect(() => {
    if (!flash) return;
    const layer = layerRef.current;
    const node = layer?.findOne(`#${flash.elementId}`);
    useNotebook.getState().clearFlash();
    if (!layer || !node) return;
    const r = node.getClientRect({ relativeTo: layer });
    const z = view.current.zoom;
    const s = sizeRef.current;
    applyView(s.w / 2 - (r.x + r.width / 2) * z, s.h / 2 - (r.y + r.height / 2) * z, z);
    setTool("select");
    setSelected([flash.elementId]);
    setFlashBox({ x: r.x - 10, y: r.y - 10, w: r.width + 20, h: r.height + 20, key: flash.nonce });
  }, [flash, page.id, applyView, setTool, setSelected]);

  useEffect(() => {
    const n = flashRef.current;
    if (!n || !flashBox) return;
    n.opacity(1);
    const tween = new Konva.Tween({
      node: n,
      duration: 1.8,
      opacity: 0,
      easing: Konva.Easings.EaseIn,
      onFinish: () => setFlashBox(null),
    });
    tween.play();
    return () => tween.destroy();
  }, [flashBox]);

  // ---------- selection transformer ----------

  const selectedEls = useMemo(
    () => page.elements.filter((e) => selectedIds.includes(e.id)),
    [page.elements, selectedIds],
  );
  const textOnly =
    selectedEls.length > 0 && selectedEls.every((e) => e.type === "text" || e.type === "checklist");

  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    const nodes = selectedIds
      .filter((id) => id !== editing?.el.id)
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(tool === "select" ? nodes : []);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, page.elements, editing, tool]);

  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const updates = new Map<
      string,
      { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
    >();
    for (const n of tr.nodes()) {
      updates.set(n.id(), {
        x: n.x(),
        y: n.y(),
        rotation: n.rotation(),
        scaleX: n.scaleX(),
        scaleY: n.scaleY(),
      });
      n.scale({ x: 1, y: 1 });
    }
    const g = live.current.lock && !live.current.alt ? grid : null;
    editElements((els) =>
      els.map((el) => (updates.has(el.id) ? applyTransform(el, updates.get(el.id)!, g) : el)),
    );
  };

  // ---------- drawing gestures ----------

  const snapOn = (alt: boolean) => general.lockToGrid && !alt;

  const eraseAlong = (from: Point, to: Point) => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return;
    const toAbs = layer.getAbsoluteTransform();
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / 4));
    const r = ERASER_RADIUS / view.current.zoom;
    let changed = false;
    for (let s = 0; s <= steps; s++) {
      const p = {
        x: from.x + ((to.x - from.x) * s) / steps,
        y: from.y + ((to.y - from.y) * s) / steps,
      };
      for (const [ox, oy] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        const hit = stage.getIntersection(toAbs.point({ x: p.x + ox, y: p.y + oy }));
        const g = hit?.findAncestor(".element", true);
        if (g && !erased.current.has(g.id())) {
          erased.current.add(g.id());
          g.visible(false);
          changed = true;
        }
      }
    }
    if (changed) layer.batchDraw();
  };

  const finishDraft = (d: Draft, end: Point | null, evt: PointerEvent | null) => {
    setDraft(null);
    const ink = general.inkColour;
    const width = general.strokeWidth;
    const shift = evt?.shiftKey ?? false;
    switch (d.kind) {
      case "stroke":
        if (d.pts.length >= 3) {
          const el = makeStroke(d.tool, d.pts, ink, width);
          editElements((els) => [...els, el]);
        }
        break;
      case "shape": {
        const { start, end: e } = d;
        if (d.type === "line" || d.type === "arrow") {
          if (Math.hypot(e.x - start.x, e.y - start.y) < 4) break;
          const el = makeLine(d.type, start.x, start.y, e.x, e.y, ink, width);
          editElements((els) => [...els, el]);
        } else {
          const box = boxFromCorners(start, e);
          if (box.w < 4 && box.h < 4) break;
          const el = makeShape(d.type, box, ink, width, useTools.getState().shapeDashed);
          editElements((els) => [...els, el]);
        }
        break;
      }
      case "marquee": {
        const layer = layerRef.current;
        if (!layer) break;
        const box = boxFromCorners(d.start, end ?? d.end);
        if (box.w < 3 && box.h < 3) break;
        const hits: string[] = [];
        for (const n of layer.find(".element")) {
          const r = n.getClientRect({ relativeTo: layer });
          if (
            r.x <= box.x + box.w &&
            box.x <= r.x + r.width &&
            r.y <= box.y + box.h &&
            box.y <= r.y + r.height
          )
            hits.push(n.id());
        }
        setSelected(d.additive || shift ? [...new Set([...d.base, ...hits])] : hits);
        break;
      }
      case "erase": {
        const gone = new Set(erased.current);
        erased.current.clear();
        if (gone.size) editElements((els) => els.filter((el) => !gone.has(el.id)));
        break;
      }
    }
  };

  // Gestures continue on window so they survive leaving the canvas. Listeners are
  // attached synchronously on pointer down (not in an effect) so a very quick
  // down-move-up never misses its pointer up.
  const draftRef = useRef<Draft | null>(null);
  const updateDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  };
  const gesture = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }>({
    move: () => {},
    up: () => {},
  });
  const startGesture = (d: Draft) => {
    updateDraft(d);
    const move = (e: PointerEvent) => gesture.current.move(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      gesture.current.up(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  {
    const move = (evt: PointerEvent) => {
      const p = toPage(evt);
      const d = draftRef.current;
      if (!p || !d) return;
      lastPointer.current = p;
      live.current.alt = evt.altKey;
      switch (d.kind) {
        case "stroke": {
          const n = d.pts.length;
          if (Math.hypot(p.x - d.pts[n - 3], p.y - d.pts[n - 2]) < 0.75) return;
          const pressure = evt.pointerType === "pen" ? evt.pressure : 0.5;
          updateDraft({ ...d, pts: [...d.pts, p.x, p.y, pressure] });
          break;
        }
        case "shape": {
          let end = snapPoint(p, grid, snapOn(evt.altKey));
          if (evt.shiftKey && (d.type === "line" || d.type === "arrow")) {
            const l = lockAngle(end.x - d.start.x, end.y - d.start.y);
            end = { x: d.start.x + l.x, y: d.start.y + l.y };
          } else if (evt.shiftKey) {
            end = squareCorner(d.start, end);
          }
          updateDraft({ ...d, end });
          break;
        }
        case "marquee":
          updateDraft({ ...d, end: p });
          break;
        case "erase":
          eraseAlong(d.last, p);
          updateDraft({ ...d, last: p });
          break;
      }
    };
    const up = (evt: PointerEvent) => {
      move(evt); // include the final position
      const d = draftRef.current;
      draftRef.current = null;
      if (d) finishDraft(d, toPage(evt), evt);
    };
    gesture.current = { move, up };
  }

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    if (evt.button === 1 || (evt.button === 0 && spaceDown)) {
      evt.preventDefault();
      setPanning({ x: evt.clientX, y: evt.clientY, px: view.current.x, py: view.current.y });
      return;
    }
    if (evt.button !== 0 || readOnly || editing) return;
    const p = toPage();
    if (!p) return;
    lastPointer.current = p;
    live.current.alt = evt.altKey;
    const snapped = snapPoint(p, grid, snapOn(evt.altKey));

    switch (tool) {
      case "select": {
        if (e.target.findAncestor("Transformer", true)) return;
        const node = e.target.findAncestor(".element", true);
        const sel = live.current.selected;
        if (node) {
          const id = node.id();
          if (evt.shiftKey)
            setSelected(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
          else if (!sel.includes(id)) setSelected([id]);
          return;
        }
        if (!evt.shiftKey) setSelected([]);
        startGesture({
          kind: "marquee",
          start: p,
          end: p,
          additive: evt.shiftKey,
          base: evt.shiftKey ? sel : [],
        });
        return;
      }
      case "eraser":
        erased.current.clear();
        eraseAlong(p, p);
        startGesture({ kind: "erase", last: p });
        return;
      case "pen":
      case "brush":
        startGesture({
          kind: "stroke",
          tool,
          pts: [p.x, p.y, evt.pointerType === "pen" ? evt.pressure : 0.5],
        });
        return;
      case "line":
      case "arrow":
      case "rect":
      case "ellipse":
        startGesture({ kind: "shape", type: tool, start: snapped, end: snapped });
        return;
      case "text": {
        evt.preventDefault(); // keep focus in the editor that is about to open
        const kind = useTools.getState().textKind;
        const el =
          kind === "checklist"
            ? makeChecklist(snapped.x, snapped.y, [""])
            : makeText(snapped.x, snapped.y, general.inkColour, kind === "heading");
        setEditing({ el, isNew: true });
        return;
      }
      case "image":
        return;
    }
  };

  const onStageMove = () => {
    const p = toPage();
    if (p) lastPointer.current = p;
  };

  const commitEditing = (text: string) => {
    const cur = editing;
    setEditing(null);
    if (!cur) return;
    const { el, isNew } = cur;
    const now = new Date().toISOString();
    let next: Element | null;
    if (el.type === "text") {
      const t = text.replace(/\s+$/, "");
      next = t.trim() ? { ...el, text: t, updatedAt: now } : null;
    } else {
      const lines = text
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() !== "");
      next = lines.length
        ? { ...el, items: checklistFromLines(el.items, lines), updatedAt: now }
        : null;
    }
    if (isNew) {
      if (next) editElements((els) => [...els, next]);
    } else {
      editElements((els) =>
        next ? els.map((x) => (x.id === el.id ? next : x)) : els.filter((x) => x.id !== el.id),
      );
    }
  };

  // ---------- images: picker, paste, drop ----------

  const placeImage = useCallback(
    async (blob: Blob, at: Point) => {
      try {
        const { rel, width, height } = await importImage(notesPath, blob);
        const { w, h } = placedSize(width, height);
        const p = snapPoint(at, live.current.grid, live.current.lock);
        const el = makeImage(rel, p.x, p.y, w, h);
        editElements((els) => [...els, el]);
        useTools.getState().setTool("select");
        setSelected([el.id]);
      } catch (e) {
        useNotebook.setState({ notice: `Could not add the image: ${String(e)}` });
      }
    },
    [notesPath, editElements, setSelected],
  );

  useEffect(() => {
    if (tool !== "image") return;
    if (!readOnly) fileRef.current?.click();
    setTool(useTools.getState().previousTool);
  }, [tool, readOnly, setTool]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly || isTyping(e.target) || useNotebook.getState().settingsOpen || !e.clipboardData)
        return;
      const at = lastPointer.current ?? viewCentre();
      const file = [...e.clipboardData.items]
        .find((i) => i.kind === "file" && i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void placeImage(file, at);
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text.trim()) {
        e.preventDefault();
        const p = snapPoint(at, grid, general.lockToGrid);
        const el = makeText(
          p.x,
          p.y,
          general.inkColour,
          false,
          text.replace(/\r\n/g, "\n").trimEnd(),
        );
        editElements((els) => [...els, el]);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (readOnly) return;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    const at = toPage(e.nativeEvent) ?? viewCentre();
    void (async () => {
      for (let i = 0; i < files.length; i++)
        await placeImage(files[i], { x: at.x + i * grid, y: at.y + i * grid });
    })();
  };

  // ---------- keyboard ----------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        live.current.alt = true;
        e.preventDefault();
      }
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        applyView(0, 0, 1);
        return;
      }
      if (
        isTyping(e.target) ||
        useNotebook.getState().settingsOpen ||
        useNotebook.getState().pageListOpen ||
        useExportDialog.getState().open
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const store = useNotebook.getState();
      const sel = new Set(live.current.selected);

      if (ctrl && k === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      } else if (ctrl && k === "a") {
        e.preventDefault();
        setTool("select");
        setSelected(live.current.elements.map((el) => el.id));
      } else if (readOnly) {
        return;
      } else if (!ctrl && k === "d" && sel.size === 1) {
        e.preventDefault();
        openDating([...sel][0]);
      } else if (ctrl && k === "d") {
        e.preventDefault();
        if (!sel.size) return;
        const copies = live.current.elements
          .filter((el) => sel.has(el.id))
          .map((el) => duplicate(el, grid, grid));
        store.editElements((els) => [...els, ...copies]);
        setSelected(copies.map((c) => c.id));
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.size) {
        e.preventDefault();
        store.editElements((els) => els.filter((el) => !sel.has(el.id)));
        setSelected([]);
      } else if (e.key.startsWith("Arrow") && sel.size) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : grid;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        store.editElements((els) => els.map((el) => (sel.has(el.id) ? translate(el, dx, dy) : el)));
      } else if (e.key === "Escape") {
        setSelected([]);
        draftRef.current = null;
        setDraft(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") live.current.alt = false;
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [applyView, setTool, setSelected, grid, readOnly, openDating]);

  // ---------- render ----------

  const ordered = useMemo(() => drawOrder(page.elements), [page.elements]);

  const draftElement: Element | null = useMemo(() => {
    if (!draft) return null;
    const ink = general.inkColour;
    const width = general.strokeWidth;
    if (draft.kind === "stroke") return makeStroke(draft.tool, draft.pts, ink, width);
    if (draft.kind === "shape") {
      if (draft.type === "line" || draft.type === "arrow")
        return makeLine(
          draft.type,
          draft.start.x,
          draft.start.y,
          draft.end.x,
          draft.end.y,
          ink,
          width,
        );
      return makeShape(
        draft.type,
        boxFromCorners(draft.start, draft.end),
        ink,
        width,
        useTools.getState().shapeDashed,
      );
    }
    return null;
  }, [draft, general.inkColour, general.strokeWidth]);

  // Memoised so panning and zooming (which re-render this component) never
  // touch the element nodes: React reuses the same element objects and skips them.
  const draggable = tool === "select" && !readOnly;
  const editingId = editing?.el.id;
  const elementNodes = useMemo(
    () =>
      ordered.map((el) => (
        <ElementNode
          key={el.id}
          el={el}
          notesPath={notesPath}
          draggable={draggable}
          hidden={editingId === el.id}
          dragBoundFunc={dragBound}
          onDragEnd={onDragEnd}
          onDblClick={onDblClick}
          onToggleItem={readOnly ? undefined : onToggleItem}
          onPillClick={readOnly ? undefined : openDating}
          today={today}
        />
      )),
    [
      ordered,
      notesPath,
      draggable,
      editingId,
      dragBound,
      onDragEnd,
      onDblClick,
      onToggleItem,
      openDating,
      today,
      readOnly,
    ],
  );

  const interactive = tool === "select" || tool === "eraser";
  const cursor = panning
    ? "grabbing"
    : spaceDown
      ? "grab"
      : tool === "select"
        ? "default"
        : tool === "text"
          ? "text"
          : "crosshair";
  const started = format(new Date(page.createdAt), "EEE d MMM yyyy");

  return (
    <div
      ref={wrapRef}
      className="paper-viewport"
      style={{ cursor }}
      // The view pans through the stage, never by native scrolling (focusing an
      // overlay input can otherwise scroll this overflow-hidden box).
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onStageMove}
        onContextMenu={onContextMenu}
      >
        {/* Two layers only: each layer is a full-size canvas the browser composites every frame. */}
        <Layer ref={layerRef} listening={interactive}>
          <Group ref={contentRef}>
            <PaperBackground grid={grid} />
            {elementNodes}
          </Group>
        </Layer>

        <Layer>
          {draftElement && (
            <Group listening={false}>
              <ElementNode
                el={draftElement}
                notesPath={notesPath}
                draggable={false}
                hidden={false}
                today={today}
              />
            </Group>
          )}
          {flashBox && (
            <Rect
              key={flashBox.key}
              ref={flashRef}
              x={flashBox.x}
              y={flashBox.y}
              width={flashBox.w}
              height={flashBox.h}
              cornerRadius={8}
              stroke={colours.mint}
              strokeWidth={3}
              shadowColor={colours.mint}
              shadowBlur={16}
              listening={false}
            />
          )}
          {draft?.kind === "marquee" && (
            <Rect
              {...(() => {
                const b = boxFromCorners(draft.start, draft.end);
                return { x: b.x, y: b.y, width: b.w, height: b.h };
              })()}
              stroke={colours.mint}
              strokeWidth={1 / view.current.zoom}
              dash={[6 / view.current.zoom, 4 / view.current.zoom]}
              fill="rgba(1,198,163,0.08)"
              listening={false}
            />
          )}
          <Transformer
            ref={trRef}
            rotateEnabled
            flipEnabled={false}
            keepRatio={false}
            ignoreStroke
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            enabledAnchors={
              textOnly
                ? ["middle-left", "middle-right"]
                : [
                    "top-left",
                    "top-center",
                    "top-right",
                    "middle-left",
                    "middle-right",
                    "bottom-left",
                    "bottom-center",
                    "bottom-right",
                  ]
            }
            anchorSize={10}
            anchorCornerRadius={2}
            anchorStroke={colours.mint}
            anchorFill={colours.desk}
            anchorStrokeWidth={1.5}
            borderStroke={colours.mint}
            borderDash={[6, 4]}
            padding={6}
            boundBoxFunc={(oldBox, newBox) =>
              Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox
            }
            onTransformEnd={onTransformEnd}
            onDragEnd={onDragEnd}
          />
        </Layer>
      </Stage>

      <div className="paper-overlay">
        <div
          className="page-title"
          style={{
            left: `calc(var(--pan-x) + ${TITLE_X}px * var(--zoom))`,
            top: `calc(var(--pan-y) + ${TITLE_Y}px * var(--zoom))`,
            transform: "scale(var(--zoom))",
          }}
        >
          <label className="visually-hidden" htmlFor="page-title-input">
            Page title
          </label>
          <input
            id="page-title-input"
            value={page.title}
            readOnly={readOnly}
            onChange={(e) => onTitleChange(e.target.value)}
            spellCheck
          />
          <p>Page started {started}</p>
        </div>
        {editing && <TextEditor key={editing.el.id} el={editing.el} onCommit={commitEditing} />}
        <ToolOptions />
        {dating && (
          <DatePopover
            key={`${dating.elementId}:${dating.itemId ?? ""}`}
            tag={datingTag}
            style={{
              left: `clamp(8px, calc(var(--pan-x) + ${dating.x}px * var(--zoom)), calc(100% - 596px))`,
              top: `max(8px, min(calc(var(--pan-y) + ${dating.y}px * var(--zoom) + 8px), calc(100% - 270px)))`,
            }}
            onClose={() => setDating(null)}
            onRemove={() => {
              writeDate(dating, undefined);
              setDating(null);
            }}
            onSave={(tag) => {
              writeDate(dating, tag);
              setDating(null);
            }}
          />
        )}
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void placeImage(f, lastPointer.current ?? viewCentre());
        }}
      />
    </div>
  );
}

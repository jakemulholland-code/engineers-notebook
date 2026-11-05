import type Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Rect, Shape, Stage } from "react-konva";
import { format } from "date-fns";
import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "../model/page";
import { MAX_ZOOM, MIN_ZOOM, useTools } from "../store/tools";

/** Colours are read from the design tokens so Konva matches the CSS. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const TITLE_X = 60;
const TITLE_Y = 40;
const PAN_MARGIN = 200;

type Props = {
  page: Page;
  readOnly: boolean;
  gridSize: number;
  onTitleChange(title: string): void;
};

export function PaperStage({ page, readOnly, gridSize, onTitleChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const zoom = useTools((s) => s.zoom);
  const setZoom = useTools((s) => s.setZoom);
  const [panning, setPanning] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [colours] = useState(() => ({
    paper: token("--paper"),
    minor: token("--grid-minor"),
    major: token("--grid-major"),
  }));

  // Keep the sheet reachable: clamp the pan so at least PAN_MARGIN of it stays in view.
  const clamp = useCallback(
    (p: { x: number; y: number }, z: number) => {
      const w = PAGE_WIDTH * z;
      const h = PAGE_HEIGHT * z;
      const minX = Math.min(0, size.w - w - PAN_MARGIN);
      const minY = Math.min(0, size.h - h - PAN_MARGIN);
      return {
        x: Math.min(PAN_MARGIN, Math.max(minX, p.x)),
        y: Math.min(PAN_MARGIN, Math.max(minY, p.y)),
      };
    },
    [size],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset the view when switching pages.
  useEffect(() => {
    setPos({ x: 0, y: 0 });
  }, [page.id]);

  // Ctrl+0 resets zoom; Space held enables drag-to-pan.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPos({ x: 0, y: 0 });
      }
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setZoom]);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    if (e.evt.ctrlKey) {
      const pointer = stage.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      const factor = Math.exp(-e.evt.deltaY * 0.0015);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      const world = { x: (pointer.x - pos.x) / zoom, y: (pointer.y - pos.y) / zoom };
      setZoom(next);
      setPos(clamp({ x: pointer.x - world.x * next, y: pointer.y - world.y * next }, next));
    } else {
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
      setPos((p) => clamp({ x: p.x - dx, y: p.y - dy }, zoom));
    }
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown)) {
      e.evt.preventDefault();
      setPanning({ x: e.evt.clientX, y: e.evt.clientY, px: pos.x, py: pos.y });
    }
  };

  useEffect(() => {
    if (!panning) return;
    const move = (e: MouseEvent) =>
      setPos(clamp({ x: panning.px + e.clientX - panning.x, y: panning.py + e.clientY - panning.y }, zoom));
    const up = () => setPanning(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [panning, clamp, zoom]);

  const started = format(new Date(page.createdAt), "EEE d MMM yyyy");

  return (
    <div
      ref={wrapRef}
      className="paper-viewport"
      style={{ cursor: panning ? "grabbing" : spaceDown ? "grab" : "default" }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={pos.x}
        y={pos.y}
        scaleX={zoom}
        scaleY={zoom}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT} fill={colours.paper} />
          <Shape
            perfectDrawEnabled={false}
            sceneFunc={(ctx) => {
              const c = ctx._context;
              c.lineWidth = 1;
              const draw = (step: number, colour: string, skip?: number) => {
                c.beginPath();
                c.strokeStyle = colour;
                for (let x = 0; x <= PAGE_WIDTH; x += step) {
                  if (skip && x % skip === 0) continue;
                  c.moveTo(x + 0.5, 0);
                  c.lineTo(x + 0.5, PAGE_HEIGHT);
                }
                for (let y = 0; y <= PAGE_HEIGHT; y += step) {
                  if (skip && y % skip === 0) continue;
                  c.moveTo(0, y + 0.5);
                  c.lineTo(PAGE_WIDTH, y + 0.5);
                }
                c.stroke();
              };
              draw(gridSize, colours.minor, gridSize * 5);
              draw(gridSize * 5, colours.major);
            }}
          />
        </Layer>
      </Stage>

      <div className="paper-overlay">
        <div
          className="page-title"
          style={{ left: pos.x + TITLE_X * zoom, top: pos.y + TITLE_Y * zoom, transform: `scale(${zoom})` }}
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
      </div>
    </div>
  );
}

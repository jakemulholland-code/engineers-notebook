import Konva from "konva";
import { memo } from "react";
import { Arrow, Ellipse, Group, Image as KImage, Line, Path, Rect, Text } from "react-konva";
import type { DateTag, Element } from "../model/page";
import { fromYmd, isOverdue, pillLabel } from "../reminders/dates";
import { useAsset } from "./assets";
import { TEXT_STYLE, strokePath } from "./elements";
import { cssVar, screenTheme, useCanvasTheme, type CanvasTheme } from "./theme";

/** Reads a design token (CSS variable) so canvas colours match the chrome. */
export const token = cssVar;

export const FONT_BODY = "Satoshi, 'Helvetica Neue', Arial, sans-serif";
export const FONT_DISPLAY = "'Bricolage Grotesque', Satoshi, sans-serif";
export const LINE_HEIGHT = 1.4;
export const HEADING_LINE_HEIGHT = 1.15;
export const CHECK_SIZE = 18;
export const CHECK_GAP = 10;
export const ROW_GAP = 10;
export const PILL_H = 24;
const PILL_GAP = 10;
const PILL_FONT = 13;

const HIT = 14;

// ----- text measuring -----

let measurer: Konva.Text | null = null;
const measureCache = new Map<string, number>();
export function clearMeasureCache() {
  measureCache.clear();
}

type Font = {
  fontSize: number;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: number;
  letterSpacing?: number;
};

function measurerWith(font: Font): Konva.Text {
  measurer ??= new Konva.Text({ wrap: "word" });
  measurer.setAttrs({
    fontFamily: font.fontFamily ?? FONT_BODY,
    fontStyle: font.fontStyle ?? "normal",
    lineHeight: font.lineHeight ?? LINE_HEIGHT,
    letterSpacing: font.letterSpacing ?? 0,
    fontSize: font.fontSize,
  });
  return measurer;
}

export function measureTextHeight(text: string, width: number, font: Font): number {
  const k = `h|${JSON.stringify(font)}|${width}|${text}`;
  const hit = measureCache.get(k);
  if (hit !== undefined) return hit;
  const m = measurerWith(font);
  m.setAttrs({ text: text || " ", width });
  const h = m.height();
  measureCache.set(k, h);
  return h;
}

function measureTextWidth(text: string, font: Font): number {
  const k = `w|${JSON.stringify(font)}|${text}`;
  const hit = measureCache.get(k);
  if (hit !== undefined) return hit;
  const w = measurerWith(font).measureSize(text).width;
  measureCache.set(k, w);
  return w;
}

const textFont = (el: Extract<Element, { type: "text" }>): Font =>
  el.heading
    ? {
        fontSize: el.fontSize,
        fontFamily: FONT_DISPLAY,
        fontStyle: "600",
        lineHeight: HEADING_LINE_HEIGHT,
        letterSpacing: -0.02 * el.fontSize,
      }
    : { fontSize: el.fontSize };

export function checklistRows(el: Extract<Element, { type: "checklist" }>) {
  const fontSize = TEXT_STYLE.checklist.fontSize;
  const textW = Math.max(40, el.w - CHECK_SIZE - CHECK_GAP);
  let y = 0;
  return el.items.map((item) => {
    const textH = Math.max(CHECK_SIZE + 2, measureTextHeight(item.text, textW, { fontSize }));
    const h = textH + (item.date ? PILL_H + 8 : 0);
    const row = { item, y, h, textH, textW, fontSize };
    y += h + ROW_GAP;
    return row;
  });
}

/** Where an element's date pill goes: just below its bottom-left, in local coords. */
export function pillAnchor(el: Element): { x: number; y: number } {
  const below = (y: number) => y + PILL_GAP;
  switch (el.type) {
    case "text":
      return { x: 0, y: below(measureTextHeight(el.text, el.w, textFont(el))) };
    case "checklist": {
      const rows = checklistRows(el);
      const last = rows[rows.length - 1];
      return { x: 0, y: below(last ? last.y + last.h : CHECK_SIZE) };
    }
    case "rect":
    case "ellipse":
    case "image":
      return { x: 0, y: below(el.h) };
    case "line":
    case "arrow":
      return {
        x: Math.min(el.points[0], el.points[2]),
        y: below(Math.max(el.points[1], el.points[3]) + el.width),
      };
    case "stroke": {
      let minX = 0;
      let maxY = 0;
      for (let i = 0; i + 1 < el.points.length; i += 3) {
        minX = Math.min(minX, el.points[i]);
        maxY = Math.max(maxY, el.points[i + 1]);
      }
      return { x: minX, y: below(maxY + el.width / 2) };
    }
  }
}

// ----- date pill -----

export function pillColours(
  tag: DateTag,
  today: Date,
  t: CanvasTheme = screenTheme,
): { stroke: string; fill: string; text: string } {
  if (tag.done)
    return { stroke: t.token("--line-strong"), fill: "transparent", text: t.token("--text-muted") };
  if (isOverdue(tag, today))
    return {
      stroke: t.token("--pink"),
      fill: t.token("--pink-wash"),
      text: t.token("--pink-pale"),
    };
  if (tag.kind === "due")
    return {
      stroke: t.token("--gold"),
      fill: t.token("--gold-wash"),
      text: t.token("--gold-soft"),
    };
  if (tag.kind === "follow_up")
    return {
      stroke: t.token("--pale-blue"),
      fill: t.token("--pale-blue-wash"),
      text: t.token("--pale-blue-soft"),
    };
  return {
    stroke: t.token("--text-muted"),
    fill: t.token("--muted-wash"),
    text: t.token("--text"),
  };
}

type PillProps = {
  tag: DateTag;
  today: string;
  x: number;
  y: number;
  onClick?: () => void;
};

function Pill({ tag, today, x, y, onClick }: PillProps) {
  const todayDate = fromYmd(today);
  const label = pillLabel(tag, todayDate);
  const font: Font = { fontSize: PILL_FONT, fontStyle: "bold", lineHeight: 1 };
  const w = 30 + measureTextWidth(label, font) + 12;
  const theme = useCanvasTheme();
  const c = pillColours(tag, todayDate, theme);
  const handle = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    onClick?.();
  };
  return (
    <Group x={x} y={y} name="date-pill" onClick={handle} onTap={handle}>
      <Rect
        width={w}
        height={PILL_H}
        cornerRadius={PILL_H / 2}
        stroke={c.stroke}
        strokeWidth={1.5}
        fill={c.fill}
      />
      <Rect
        x={11}
        y={6}
        width={12}
        height={11}
        cornerRadius={2}
        stroke={c.text}
        strokeWidth={1.4}
      />
      <Line points={[11, 9.5, 23, 9.5]} stroke={c.text} strokeWidth={1.4} />
      <Text
        x={30}
        y={(PILL_H - PILL_FONT) / 2 + 0.5}
        text={label}
        fontSize={PILL_FONT}
        fontStyle="bold"
        fontFamily={FONT_BODY}
        lineHeight={1}
        fill={c.text}
        textDecoration={tag.done ? "line-through" : ""}
      />
    </Group>
  );
}

// ----- the node -----

type Props = {
  el: Element;
  notesPath: string;
  draggable: boolean;
  hidden: boolean;
  /** Today's date (YYYY-MM-DD), so pills turn pink when overdue. */
  today: string;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDblClick?: (id: string) => void;
  onToggleItem?: (elementId: string, itemId: string) => void;
  onPillClick?: (elementId: string, itemId?: string) => void;
};

function ElementNodeImpl(p: Props) {
  const { el } = p;
  const anchor = el.date ? pillAnchor(el) : null;
  return (
    <Group
      id={el.id}
      name="element"
      x={el.x}
      y={el.y}
      rotation={el.rotation}
      draggable={p.draggable}
      visible={!p.hidden}
      dragBoundFunc={p.dragBoundFunc}
      onDragEnd={p.onDragEnd}
      onDblClick={() => p.onDblClick?.(el.id)}
      onDblTap={() => p.onDblClick?.(el.id)}
    >
      <Body {...p} />
      {el.date && anchor && (
        <Pill
          tag={el.date}
          today={p.today}
          x={anchor.x}
          y={anchor.y}
          onClick={() => p.onPillClick?.(el.id)}
        />
      )}
    </Group>
  );
}

export const ElementNode = memo(ElementNodeImpl);

function Body({ el, notesPath, today, onToggleItem, onPillClick }: Props) {
  const t = useCanvasTheme();
  switch (el.type) {
    case "stroke":
      return (
        <Path
          data={strokePath(el)}
          fill={t.ink(el.colour)}
          opacity={el.opacity}
          strokeWidth={0}
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      );
    case "line":
      return (
        <Line
          points={el.points}
          stroke={t.ink(el.colour)}
          strokeWidth={el.width}
          lineCap="round"
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
        />
      );
    case "arrow":
      return (
        <Arrow
          points={el.points}
          stroke={t.ink(el.colour)}
          fill={t.ink(el.colour)}
          strokeWidth={el.width}
          pointerLength={8 + el.width * 2}
          pointerWidth={8 + el.width * 2}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
        />
      );
    case "rect":
      return (
        <Rect
          width={el.w}
          height={el.h}
          stroke={t.ink(el.colour)}
          strokeWidth={el.width}
          dash={el.dashed ? [el.width * 3, el.width * 2.5] : undefined}
          cornerRadius={4}
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          x={el.w / 2}
          y={el.h / 2}
          radiusX={el.w / 2}
          radiusY={el.h / 2}
          stroke={t.ink(el.colour)}
          strokeWidth={el.width}
          dash={el.dashed ? [el.width * 3, el.width * 2.5] : undefined}
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
        />
      );
    case "text": {
      const f = textFont(el);
      return (
        <Text
          text={el.text}
          width={el.w}
          fontSize={f.fontSize}
          fontFamily={f.fontFamily ?? FONT_BODY}
          fontStyle={f.fontStyle ?? "normal"}
          letterSpacing={f.letterSpacing ?? 0}
          lineHeight={f.lineHeight ?? LINE_HEIGHT}
          fill={t.ink(el.colour)}
          wrap="word"
        />
      );
    }
    case "checklist":
      return (
        <Checklist el={el} today={today} onToggleItem={onToggleItem} onPillClick={onPillClick} />
      );
    case "image":
      return <ImageBody el={el} notesPath={notesPath} />;
  }
}

function Checklist({
  el,
  today,
  onToggleItem,
  onPillClick,
}: {
  el: Extract<Element, { type: "checklist" }>;
  today: string;
  onToggleItem?: (elementId: string, itemId: string) => void;
  onPillClick?: (elementId: string, itemId?: string) => void;
}) {
  const t = useCanvasTheme();
  const ink = t.token("--ink-white");
  const mint = t.token("--mint");
  const muted = t.token("--text-muted");
  const rows = checklistRows(el);
  const total = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : CHECK_SIZE;
  return (
    <>
      {/* Invisible backing so the whole list is clickable and draggable. */}
      <Rect width={el.w} height={total} fill="rgba(0,0,0,0.001)" />
      {rows.map(({ item, y, textH, textW, fontSize }) => (
        <Group key={item.id} y={y} name={`checklist-item ci-${item.id}`}>
          <Group
            name="checkbox"
            onClick={(e) => {
              e.cancelBubble = true;
              onToggleItem?.(el.id, item.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onToggleItem?.(el.id, item.id);
            }}
          >
            <Rect
              y={2}
              width={CHECK_SIZE}
              height={CHECK_SIZE}
              stroke={item.done ? mint : ink}
              strokeWidth={2}
              hitStrokeWidth={8}
              fill="rgba(0,0,0,0.001)"
            />
            {item.done && (
              <Line
                points={[4, 11, 8, 15, 14, 6]}
                stroke={mint}
                strokeWidth={2}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </Group>
          <Text
            x={CHECK_SIZE + CHECK_GAP}
            text={item.text}
            width={textW}
            fontSize={fontSize}
            fontFamily={FONT_BODY}
            lineHeight={LINE_HEIGHT}
            fill={item.done ? muted : ink}
            textDecoration={item.done ? "line-through" : ""}
            wrap="word"
          />
          {item.date && (
            <Pill
              tag={item.date}
              today={today}
              x={CHECK_SIZE + CHECK_GAP}
              y={textH + 6}
              onClick={() => onPillClick?.(el.id, item.id)}
            />
          )}
        </Group>
      ))}
    </>
  );
}

function ImageBody({
  el,
  notesPath,
}: {
  el: Extract<Element, { type: "image" }>;
  notesPath: string;
}) {
  const t = useCanvasTheme();
  const img = useAsset(notesPath, el.asset);
  if (!t.images) return null;
  if (!img) {
    return (
      <Rect
        width={el.w}
        height={el.h}
        stroke={t.token("--line-strong")}
        dash={[6, 6]}
        strokeWidth={2}
      />
    );
  }
  return (
    <KImage
      image={img}
      width={el.w}
      height={el.h}
      shadowColor="#040818"
      shadowOpacity={0.45}
      shadowBlur={18}
      shadowOffsetY={6}
      perfectDrawEnabled={false}
    />
  );
}

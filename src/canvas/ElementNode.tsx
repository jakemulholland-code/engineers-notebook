import Konva from "konva";
import { memo } from "react";
import { Arrow, Ellipse, Group, Image as KImage, Line, Path, Rect, Text } from "react-konva";
import type { Element } from "../model/page";
import { useAsset } from "./assets";
import { TEXT_STYLE, strokePath } from "./elements";

/** Reads a design token (CSS variable) so canvas colours match the chrome. */
const tokenCache = new Map<string, string>();
export function token(name: string): string {
  let v = tokenCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    tokenCache.set(name, v);
  }
  return v;
}

export const FONT_BODY = "Satoshi, 'Helvetica Neue', Arial, sans-serif";
export const FONT_DISPLAY = "'Bricolage Grotesque', Satoshi, sans-serif";
export const LINE_HEIGHT = 1.4;
export const CHECK_SIZE = 18;
export const CHECK_GAP = 10;
export const ROW_GAP = 10;

const HIT = 14;

// ----- text measuring for checklist rows -----

let measurer: Konva.Text | null = null;
const measureCache = new Map<string, number>();
export function clearMeasureCache() {
  measureCache.clear();
}
export function measureTextHeight(text: string, width: number, fontSize: number): number {
  const k = `${fontSize}|${width}|${text}`;
  const hit = measureCache.get(k);
  if (hit !== undefined) return hit;
  measurer ??= new Konva.Text({ fontFamily: FONT_BODY, lineHeight: LINE_HEIGHT, wrap: "word" });
  measurer.setAttrs({ text: text || " ", width, fontSize });
  const h = measurer.height();
  measureCache.set(k, h);
  return h;
}

export function checklistRows(el: Extract<Element, { type: "checklist" }>) {
  const fontSize = TEXT_STYLE.checklist.fontSize;
  const textW = Math.max(40, el.w - CHECK_SIZE - CHECK_GAP);
  let y = 0;
  return el.items.map((item) => {
    const h = Math.max(CHECK_SIZE + 2, measureTextHeight(item.text, textW, fontSize));
    const row = { item, y, h, textW, fontSize };
    y += h + ROW_GAP;
    return row;
  });
}

// ----- the node -----

type Props = {
  el: Element;
  notesPath: string;
  draggable: boolean;
  hidden: boolean;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDblClick?: (id: string) => void;
  onToggleItem?: (elementId: string, itemId: string) => void;
};

function ElementNodeImpl({ el, notesPath, draggable, hidden, dragBoundFunc, onDragEnd, onDblClick, onToggleItem }: Props) {
  return (
    <Group
      id={el.id}
      name="element"
      x={el.x}
      y={el.y}
      rotation={el.rotation}
      draggable={draggable}
      visible={!hidden}
      dragBoundFunc={dragBoundFunc}
      onDragEnd={onDragEnd}
      onDblClick={() => onDblClick?.(el.id)}
      onDblTap={() => onDblClick?.(el.id)}
    >
      <Body el={el} notesPath={notesPath} onToggleItem={onToggleItem} />
    </Group>
  );
}

export const ElementNode = memo(ElementNodeImpl);

function Body({
  el,
  notesPath,
  onToggleItem,
}: {
  el: Element;
  notesPath: string;
  onToggleItem?: (elementId: string, itemId: string) => void;
}) {
  switch (el.type) {
    case "stroke":
      return (
        <Path
          data={strokePath(el)}
          fill={el.colour}
          opacity={el.opacity}
          strokeWidth={0}
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      );
    case "line":
      return (
        <Line points={el.points} stroke={el.colour} strokeWidth={el.width} lineCap="round" hitStrokeWidth={HIT} perfectDrawEnabled={false} />
      );
    case "arrow":
      return (
        <Arrow
          points={el.points}
          stroke={el.colour}
          fill={el.colour}
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
          stroke={el.colour}
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
          stroke={el.colour}
          strokeWidth={el.width}
          dash={el.dashed ? [el.width * 3, el.width * 2.5] : undefined}
          hitStrokeWidth={HIT}
          perfectDrawEnabled={false}
        />
      );
    case "text":
      return (
        <Text
          text={el.text}
          width={el.w}
          fontSize={el.fontSize}
          fontFamily={el.heading ? FONT_DISPLAY : FONT_BODY}
          fontStyle={el.heading ? "600" : "normal"}
          letterSpacing={el.heading ? -0.02 * el.fontSize : 0}
          lineHeight={el.heading ? 1.15 : LINE_HEIGHT}
          fill={el.colour}
          wrap="word"
        />
      );
    case "checklist":
      return <Checklist el={el} onToggleItem={onToggleItem} />;
    case "image":
      return <ImageBody el={el} notesPath={notesPath} />;
  }
}

function Checklist({
  el,
  onToggleItem,
}: {
  el: Extract<Element, { type: "checklist" }>;
  onToggleItem?: (elementId: string, itemId: string) => void;
}) {
  const ink = token("--ink-white");
  const mint = token("--mint");
  const muted = token("--text-muted");
  const rows = checklistRows(el);
  const total = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : CHECK_SIZE;
  return (
    <>
      {/* Invisible backing so the whole list is clickable and draggable. */}
      <Rect width={el.w} height={total} fill="rgba(0,0,0,0.001)" />
      {rows.map(({ item, y, textW, fontSize }) => (
        <Group key={item.id} y={y}>
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
            <Rect y={2} width={CHECK_SIZE} height={CHECK_SIZE} stroke={item.done ? mint : ink} strokeWidth={2} hitStrokeWidth={8} fill="rgba(0,0,0,0.001)" />
            {item.done && <Line points={[4, 11, 8, 15, 14, 6]} y={0} stroke={mint} strokeWidth={2} lineCap="round" lineJoin="round" />}
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
        </Group>
      ))}
    </>
  );
}

function ImageBody({ el, notesPath }: { el: Extract<Element, { type: "image" }>; notesPath: string }) {
  const img = useAsset(notesPath, el.asset);
  if (!img) {
    return <Rect width={el.w} height={el.h} stroke={token("--line-strong")} dash={[6, 6]} strokeWidth={2} />;
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

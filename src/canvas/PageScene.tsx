import { format } from "date-fns";
import { useMemo } from "react";
import { Group, Rect, Shape, Text } from "react-konva";
import { PAGE_HEIGHT, PAGE_WIDTH, type Element, type Page } from "../model/page";
import { ElementNode, FONT_BODY, FONT_DISPLAY } from "./ElementNode";
import { useCanvasTheme } from "./theme";

export const TITLE_X = 60;
export const TITLE_Y = 40;
const TITLE_SIZE = 36;
const SUBTITLE_SIZE = 14;

const isBrush = (el: Element) => el.type === "stroke" && el.tool === "brush";

/** Brush strokes first so highlighting sits under everything else (SPEC: Paint brush). */
export function drawOrder(elements: Element[]): Element[] {
  return [...elements.filter(isBrush), ...elements.filter((el) => !isBrush(el))];
}

/** The sheet and its grid, drawn on the stage so it scales with zoom. */
export function PaperBackground({ grid }: { grid: number }) {
  const t = useCanvasTheme();
  const paper = t.token("--paper");
  const minor = t.token("--grid-minor");
  const major = t.token("--grid-major");
  return (
    <>
      <Rect x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT} fill={paper} listening={false} />
      <Shape
        listening={false}
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
          draw(grid, minor, grid * 5);
          draw(grid * 5, major);
        }}
      />
    </>
  );
}

/**
 * The page title and "Page started" line, drawn in Konva for exports. On screen
 * the same text is an editable HTML input laid over the canvas at the same spot.
 */
export function PageTitle({ page }: { page: Page }) {
  const t = useCanvasTheme();
  return (
    <Group x={TITLE_X} y={TITLE_Y} listening={false}>
      <Text
        text={page.title}
        fontFamily={FONT_DISPLAY}
        fontStyle="600"
        fontSize={TITLE_SIZE}
        letterSpacing={-0.03 * TITLE_SIZE}
        lineHeight={1.1}
        fill={t.token("--ink-white")}
        width={900}
        wrap="none"
        ellipsis
      />
      <Text
        y={TITLE_SIZE * 1.1 + 8}
        text={`Page started ${format(new Date(page.createdAt), "EEE d MMM yyyy")}`}
        fontFamily={FONT_BODY}
        fontSize={SUBTITLE_SIZE}
        lineHeight={1.2}
        fill={t.token("--text-muted")}
      />
    </Group>
  );
}

/** A whole page, read-only: what exports and snapshots draw. */
export function PageScene({
  page,
  notesPath,
  grid,
  today,
}: {
  page: Page;
  notesPath: string;
  grid: number;
  today: string;
}) {
  const ordered = useMemo(() => drawOrder(page.elements), [page.elements]);
  return (
    <>
      <PaperBackground grid={grid} />
      <PageTitle page={page} />
      {ordered.map((el) => (
        <ElementNode
          key={el.id}
          el={el}
          notesPath={notesPath}
          draggable={false}
          hidden={false}
          today={today}
        />
      ))}
    </>
  );
}

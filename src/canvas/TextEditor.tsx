import { useLayoutEffect, useRef, useState } from "react";
import type { Element } from "../model/page";
import { TEXT_STYLE } from "./elements";
import { CHECK_GAP, CHECK_SIZE, FONT_BODY, FONT_DISPLAY, LINE_HEIGHT } from "./ElementNode";

type Editable = Extract<Element, { type: "text" | "checklist" }>;

type Props = {
  el: Editable;
  onCommit(text: string): void;
};

/**
 * An HTML textarea laid exactly over a text or checklist element while it is
 * being edited. Checklists edit as one item per line.
 */
export function TextEditor({ el, onCommit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(() =>
    el.type === "text" ? el.text : el.items.map((i) => i.text).join("\n"),
  );

  const isChecklist = el.type === "checklist";
  const offsetX = isChecklist ? CHECK_SIZE + CHECK_GAP : 0;
  const fontSize = el.type === "text" ? el.fontSize : TEXT_STYLE.checklist.fontSize;
  const heading = el.type === "text" && el.heading;

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${t.scrollHeight}px`;
  }, [value]);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };

  return (
    <div
      className="text-editor"
      style={{
        // --pan-x, --pan-y and --zoom are set on the viewport by PaperStage.
        left: `calc(var(--pan-x) + ${el.x}px * var(--zoom))`,
        top: `calc(var(--pan-y) + ${el.y}px * var(--zoom))`,
        transform: `scale(var(--zoom)) rotate(${el.rotation}deg)`,
      }}
    >
      <textarea
        ref={ref}
        aria-label={isChecklist ? "Checklist items, one per line" : "Text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        spellCheck
        style={{
          marginLeft: offsetX,
          width: el.w - offsetX,
          fontSize,
          fontFamily: heading ? FONT_DISPLAY : FONT_BODY,
          fontWeight: heading ? 600 : 400,
          letterSpacing: heading ? `${-0.02 * fontSize}px` : 0,
          lineHeight: heading
            ? 1.15
            : isChecklist
              ? `${fontSize * LINE_HEIGHT + 10}px`
              : LINE_HEIGHT,
          color: el.type === "text" ? el.colour : "var(--ink-white)",
        }}
      />
    </div>
  );
}

import { useTools, type TextKind } from "../store/tools";

const TEXT_KINDS: { id: TextKind; label: string }[] = [
  { id: "note", label: "Note" },
  { id: "heading", label: "Heading" },
  { id: "checklist", label: "Checklist" },
];

/** Small flyout for the Box/Circle outline style and the Text kind. */
export function ToolOptions() {
  const tool = useTools((s) => s.tool);
  const dashed = useTools((s) => s.shapeDashed);
  const setDashed = useTools((s) => s.setShapeDashed);
  const textKind = useTools((s) => s.textKind);
  const setTextKind = useTools((s) => s.setTextKind);

  if (tool === "rect" || tool === "ellipse") {
    return (
      <div className="tool-options" role="radiogroup" aria-label="Outline">
        <button role="radio" aria-checked={!dashed} onClick={() => setDashed(false)}>
          Solid
        </button>
        <button role="radio" aria-checked={dashed} onClick={() => setDashed(true)}>
          Dashed
        </button>
      </div>
    );
  }
  if (tool === "text") {
    return (
      <div className="tool-options" role="radiogroup" aria-label="Text kind">
        {TEXT_KINDS.map((k) => (
          <button
            key={k.id}
            role="radio"
            aria-checked={textKind === k.id}
            onClick={() => setTextKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
    );
  }
  return null;
}

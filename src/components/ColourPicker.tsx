import { INK_COLOURS } from "../model/config";

/** The five ink colours plus a custom picker (SPEC: Settings, Add client). */
export function ColourPicker({
  value,
  onChange,
  labelledBy,
}: {
  value: string;
  onChange(colour: string): void;
  labelledBy: string;
}) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    <div className="colour-picker swatches" role="group" aria-labelledby={labelledBy}>
      {INK_COLOURS.map((c) => (
        <button
          type="button"
          key={c.id}
          className="swatch"
          aria-label={c.label}
          aria-pressed={same(value, c.value)}
          style={{ background: c.value }}
          onClick={() => onChange(c.value)}
        />
      ))}
      <input
        type="color"
        aria-label="Custom colour"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

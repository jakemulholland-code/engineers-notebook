import { useEffect, useRef } from "react";

export type MenuItem = { label: string; onSelect(): void; danger?: boolean };

/** A small right-click menu at a screen position. Closes on Escape or an outside click. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - items.length * 44 - 16),
      }}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
        if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? "danger" : undefined}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

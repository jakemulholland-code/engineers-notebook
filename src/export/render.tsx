import type Konva from "konva";
import { createRoot } from "react-dom/client";
import { Layer, Stage } from "react-konva";
import { loadAsset } from "../canvas/assets";
import { PageScene } from "../canvas/PageScene";
import { ThemeContext, printTheme, screenTheme } from "../canvas/theme";
import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "../model/page";
import { toYmd } from "../reminders/dates";

export type RenderOptions = {
  theme: "screen" | "print";
  /** 2 for exports (SPEC: rendered from Konva at 2x). */
  pixelRatio: number;
  includeImages: boolean;
  grid: number;
  today?: string;
};

// setTimeout rather than requestAnimationFrame, which pauses in a hidden window.
const tick = (ms = 16) => new Promise((r) => setTimeout(r, ms));

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Draws a whole page off screen with the same components as the live canvas and
 * returns it as PNG bytes. Waits for fonts and pasted images so nothing is missing.
 */
export async function renderPagePng(
  page: Page,
  notesPath: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  await document.fonts.ready;
  const images = page.elements.filter((e) => e.type === "image");
  const wanted = opts.includeImages ? images.length : 0;
  if (wanted)
    await Promise.all(
      images.map((i) =>
        i.type === "image" ? loadAsset(notesPath, i.asset).catch(() => null) : null,
      ),
    );

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-${PAGE_WIDTH * 4}px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  let stage: Konva.Stage | null = null;
  const theme = {
    ...(opts.theme === "print" ? printTheme : screenTheme),
    images: opts.includeImages,
  };

  try {
    root.render(
      <ThemeContext.Provider value={theme}>
        <Stage
          width={PAGE_WIDTH}
          height={PAGE_HEIGHT}
          listening={false}
          ref={(s) => {
            stage = s;
          }}
        >
          <Layer>
            <PageScene
              page={page}
              notesPath={notesPath}
              grid={opts.grid}
              today={opts.today ?? toYmd(new Date())}
            />
          </Layer>
        </Stage>
      </ThemeContext.Provider>,
    );
    // Wait for the first commit, then for any pasted images to swap in for their placeholders.
    const deadline = performance.now() + 4000;
    await tick();
    for (;;) {
      const s = stage as Konva.Stage | null;
      const loaded = s ? s.find("Image").filter((n) => !!(n as Konva.Image).image()).length : -1;
      if ((s && loaded >= wanted) || performance.now() > deadline) break;
      await tick();
    }
    const s = stage as Konva.Stage | null;
    if (!s) throw new Error("The page could not be drawn");
    s.draw();
    return dataUrlToBytes(s.toDataURL({ pixelRatio: opts.pixelRatio, mimeType: "image/png" }));
  } finally {
    root.unmount();
    host.remove();
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

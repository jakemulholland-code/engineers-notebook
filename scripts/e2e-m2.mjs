// Milestone 2 end-to-end check: canvas tools against the real app.
// Start the app as described in README ("End-to-end checks"), then: node scripts/e2e-m2.mjs
import fs from "node:fs";
import path from "node:path";
import { checker, connect, setupClient, sleep } from "./e2e-lib.mjs";

const { check, finish } = checker();
const { browser, page } = await connect();
const { notes, pages } = await setupClient(page, "Canvas client");

await page.click("text=New page");
await page.waitForSelector("#page-title-input");
await page.keyboard.press("Control+0");
await sleep(300);

const vp = await page.locator(".paper-viewport").boundingBox();
const at = (x, y) => ({ x: vp.x + x, y: vp.y + y }); // page coords at 100% zoom, no pan

const blur = () =>
  page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
const key = async (k) => {
  await blur();
  await page.keyboard.press(k);
  await sleep(120);
};
async function drag(from, to, { steps = 10, hold = [] } = {}) {
  for (const h of hold) await page.keyboard.down(h);
  const a = at(from[0], from[1]);
  const b = at(to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
  for (const h of hold) await page.keyboard.up(h);
  await sleep(150);
}
async function click(x, y, opts) {
  const p = at(x, y);
  await page.mouse.click(p.x, p.y, opts);
  await sleep(150);
}
function readPage() {
  const f = fs
    .readdirSync(pages)
    .filter((n) => n.endsWith(".page.json"))
    .sort()[0];
  return JSON.parse(fs.readFileSync(path.join(pages, f), "utf8"));
}
async function saved() {
  await sleep(1300);
  return readPage();
}
const ofType = (p, t) => p.elements.filter((e) => e.type === t);
const onGrid = (...v) => v.every((n) => Math.abs(n % 20) < 1e-6);

// ---------- drawing tools ----------
await key("p");
await drag([200, 300], [400, 360]);
await key("b");
await drag([200, 400], [420, 402]);
let p = await saved();
const pen = p.elements.find((e) => e.type === "stroke" && e.tool === "pen");
const brush = p.elements.find((e) => e.type === "stroke" && e.tool === "brush");
check(
  "pen draws a stroke",
  pen && pen.points.length >= 9 && pen.points.length % 3 === 0,
  pen?.points.length,
);
check(
  "pen stroke not snapped point by point",
  pen && pen.x === 200 && pen.points.some((v, i) => i % 3 !== 2 && !onGrid(v)),
);
check(
  "brush is wide and 40% opacity",
  brush && brush.opacity === 0.4 && brush.width > pen.width,
  `${brush?.width}`,
);

await key("l");
await drag([203, 507], [397, 513]);
await drag([203, 607], [389, 641], { hold: ["Shift"] });
await drag([203, 707], [397, 713], { hold: ["Alt"] });
await key("a");
await drag([443, 251], [517, 249]);
p = await saved();
const lines = ofType(p, "line");
check(
  "line start and end snap to grid",
  lines[0] && onGrid(lines[0].x, lines[0].y, lines[0].points[2], lines[0].points[3]),
  JSON.stringify(lines[0]?.points),
);
check(
  "Shift locks line to 0/45/90",
  lines[1] && lines[1].points[3] === 0,
  JSON.stringify(lines[1]?.points),
);
check("Alt ignores the grid", lines[2] && lines[2].x === 203, lines[2]?.x);
check("arrow drawn", ofType(p, "arrow").length === 1);

await key("r");
await drag([603, 203], [797, 297]);
await page.click(".tool-options >> text=Dashed");
await drag([1003, 203], [1097, 297]);
await page.click(".tool-options >> text=Solid");
await key("o");
await drag([1203, 203], [1290, 250], { hold: ["Shift"] });
p = await saved();
const rects = ofType(p, "rect");
check(
  "box snaps to grid",
  rects[0] && rects[0].x === 600 && rects[0].y === 200 && rects[0].w === 200 && rects[0].h === 100,
  JSON.stringify(rects[0] && [rects[0].x, rects[0].y, rects[0].w, rects[0].h]),
);
check("dashed box from flyout", rects[1]?.dashed === true && rects[0]?.dashed === false);
const ell = ofType(p, "ellipse")[0];
check("Shift draws a circle", ell && ell.w === ell.h, ell && `${ell.w}x${ell.h}`);

// ---------- text ----------
await key("t");
await page.click(".tool-options >> text=Note");
await click(903, 403);
await page.keyboard.type("Hello note");
await page.keyboard.press("Escape");
await sleep(150);
await page.click(".tool-options >> text=Heading");
await click(903, 503);
await page.keyboard.type("Big heading");
await page.keyboard.press("Escape");
await sleep(150);
await page.click(".tool-options >> text=Checklist");
await click(903, 603);
await page.keyboard.type("First item");
await page.keyboard.press("Enter");
await page.keyboard.type("Second item");
await page.keyboard.press("Escape");
await sleep(150);
p = await saved();
const texts = ofType(p, "text");
check(
  "note placed at snapped click",
  texts[0]?.text === "Hello note" && texts[0].x === 900 && texts[0].y === 400 && !texts[0].heading,
  JSON.stringify(texts.map((t) => [t.text, t.x, t.y, t.heading])),
);
check("heading created", texts[1]?.text === "Big heading" && texts[1].heading === true);
const list = ofType(p, "checklist")[0];
check(
  "checklist with two items",
  list?.items.length === 2 && list.items[1].text === "Second item",
  JSON.stringify(list?.items.map((i) => i.text)),
);

// tick the first item (select tool)
await key("v");
await sleep(200);
await click(909, 612);
p = await saved();
check("ticking a checklist item saves done", ofType(p, "checklist")[0]?.items[0].done === true);

// double-click to edit text
await page.mouse.dblclick(at(920, 410).x, at(920, 410).y);
await sleep(200);
await page.keyboard.press("End");
await page.keyboard.type(" edited");
await page.keyboard.press("Escape");
p = await saved();
check("double-click edits text", ofType(p, "text")[0]?.text === "Hello note edited");

// ---------- select, move, resize, rotate ----------
await click(600, 250); // left edge of the first box
await drag([600, 250], [633, 277]);
p = await saved();
let box = ofType(p, "rect")[0];
check("move snaps to grid", box && box.x === 640 && box.y === 220, box && `${box.x},${box.y}`);

// resize with the middle-right anchor (padding 6)
const right = [box.x + box.w + 6, box.y + box.h / 2];
await drag(right, [right[0] + 47, right[1]]);
p = await saved();
box = ofType(p, "rect")[0];
check(
  "resize snaps width to grid",
  box && box.w === 240 && box.h === 100,
  box && `${box.w}x${box.h}`,
);

// rotate with the rotation handle (50 px above the top edge, plus padding)
const rot = [box.x + box.w / 2, box.y - 6 - 50];
await drag(rot, [rot[0] + 120, rot[1] + 40]);
p = await saved();
box = ofType(p, "rect")[0];
check("rotate handle rotates", box && box.rotation !== 0, box?.rotation);

// ---------- undo / redo ----------
await key("Control+z");
p = await saved();
check("undo reverts the rotation", ofType(p, "rect")[0]?.rotation === 0);
await key("Control+y");
p = await saved();
check("redo restores it", ofType(p, "rect")[0]?.rotation !== 0);

// ---------- keyboard: nudge, duplicate, delete, select all ----------
await key("Control+z"); // unrotate for predictable nudges
const before = ofType(await saved(), "rect")[0];
await key("ArrowRight");
await key("Shift+ArrowDown");
p = await saved();
box = ofType(p, "rect")[0];
check(
  "arrow nudges a grid square, Shift nudges 1 px",
  box.x === before.x + 20 && box.y === before.y + 1,
  `${box.x - before.x},${box.y - before.y}`,
);

const count = (await saved()).elements.length;
await key("Control+d");
p = await saved();
check("Ctrl+D duplicates", p.elements.length === count + 1);
await key("Delete");
p = await saved();
check("Delete removes the selection", p.elements.length === count);

await key("Control+a");
await key("Delete");
p = await saved();
check("Ctrl+A then Delete clears the page", p.elements.length === 0);
await key("Control+z");
p = await saved();
check("undo brings everything back", p.elements.length === count);

// ---------- marquee ----------
await key("Escape");
await drag([180, 480], [420, 740]); // around the three lines
await key("Delete");
p = await saved();
check("marquee selects the lines", ofType(p, "line").length === 0, ofType(p, "line").length);
await key("Control+z");

// ---------- eraser ----------
await key("e");
await drag([300, 260], [300, 420], { steps: 20 }); // across the pen stroke
p = await saved();
check(
  "eraser removes whole elements it touches",
  !p.elements.some((e) => e.type === "stroke" && e.tool === "pen"),
);

// ---------- paste and drop ----------
await key("v");
await key("Escape");
await page.mouse.move(at(1203, 703).x, at(1203, 703).y);
await sleep(100);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "Pasted line");
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
});
p = await saved();
const pasted = ofType(p, "text").find((t) => t.text === "Pasted line");
check(
  "pasting text makes a text box at the cursor",
  pasted && pasted.x === 1200 && pasted.y === 700,
  pasted && `${pasted.x},${pasted.y}`,
);

const makePng = (w, h, colour) =>
  page.evaluate(
    async ({ w, h, colour }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      window.__testFile = new File([blob], "shot.png", { type: "image/png" });
    },
    { w, h, colour },
  );
const pasteFile = () =>
  page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__testFile);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });

await page.mouse.move(at(103, 803).x, at(103, 803).y);
await makePng(1600, 900, "#8fa3cc");
await pasteFile();
await sleep(400);
await page.mouse.move(at(503, 803).x, at(503, 803).y);
await pasteFile();
p = await saved();
const imgs = ofType(p, "image");
const assetFiles = fs.readdirSync(path.join(notes, "assets")).filter((f) => f.endsWith(".png"));
check(
  "pasted image placed at the cursor",
  imgs[0] && imgs[0].x === 100 && imgs[0].y === 800,
  imgs[0] && `${imgs[0].x},${imgs[0].y}`,
);
check(
  "pasted image scaled to at most 800 px wide",
  imgs[0]?.w === 800 && imgs[0].h === 450,
  imgs[0] && `${imgs[0].w}x${imgs[0].h}`,
);
check(
  "image saved to assets/<sha256>.png",
  imgs[0] &&
    /^assets\/[0-9a-f]{64}\.png$/.test(imgs[0].asset) &&
    fs.existsSync(path.join(notes, imgs[0].asset)),
);
check(
  "same image pasted twice is stored once",
  imgs.length === 2 && assetFiles.length === 1,
  `${imgs.length} images, ${assetFiles.length} files`,
);

await makePng(300, 200, "#ff5c86");
await page.evaluate(
  ({ x, y }) => {
    const dt = new DataTransfer();
    dt.items.add(window.__testFile);
    const target = document.querySelector(".paper-viewport");
    target.dispatchEvent(
      new DragEvent("dragover", {
        dataTransfer: dt,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  },
  at(1003, 803),
);
p = await saved();
const dropped = ofType(p, "image").find((i) => i.w === 300);
check(
  "dropping an image file places it",
  dropped && dropped.x === 1000 && dropped.y === 800,
  dropped && `${dropped.x},${dropped.y}`,
);

// ---------- zoom limits ----------
await page.mouse.move(at(600, 400).x, at(600, 400).y);
await page.keyboard.down("Control");
for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 400);
await page.keyboard.up("Control");
await sleep(200);
const minZoom = await page.locator(".statusbar >> text=/\\d+%$/").innerText();
await page.keyboard.down("Control");
for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
await page.keyboard.up("Control");
await sleep(200);
const maxZoom = await page.locator(".statusbar >> text=/\\d+%$/").innerText();
check(
  "zoom bottoms out at 25% and tops out at 300%",
  minZoom === "25%" && maxZoom === "300%",
  `${minZoom} / ${maxZoom}`,
);
await key("Control+0");

// ---------- performance: 500 strokes ----------
const now = new Date().toISOString();
const strokes = Array.from({ length: 500 }, (_, i) => {
  const pts = [];
  for (let k = 0; k < 40; k++) pts.push(k * 6, Math.sin(k / 3 + i) * 20, 0.5);
  return {
    id: `s${i}`,
    type: "stroke",
    tool: i % 7 === 0 ? "brush" : "pen",
    x: 40 + (i % 20) * 75,
    y: 40 + Math.floor(i / 20) * 42,
    rotation: 0,
    points: pts,
    colour: "#F4F7FF",
    width: i % 7 === 0 ? 20 : 4,
    opacity: i % 7 === 0 ? 0.4 : 1,
    createdAt: now,
    updatedAt: now,
  };
});
const heavy = {
  schemaVersion: 1,
  id: "heavy",
  title: "Five hundred strokes",
  createdAt: "2026-11-06T09:00:00.000Z",
  updatedAt: now,
  elements: strokes,
};
fs.writeFileSync(
  path.join(pages, "2026-11-06-five-hundred-strokes.page.json"),
  JSON.stringify(heavy),
);
await page.reload();
await page.waitForSelector("#page-title-input");
await blur();
if ((await page.inputValue("#page-title-input")) !== "Five hundred strokes") {
  await page.click('button[aria-label="Next page"]');
  await sleep(500);
}
check(
  "500-stroke page opens",
  (await page.inputValue("#page-title-input")) === "Five hundred strokes",
);
await sleep(500);

const stats = await page.evaluate(async () => {
  const vp = document.querySelector(".paper-viewport").getBoundingClientRect();
  const frames = [];
  let last = performance.now();
  let running = true;
  const loop = (t) => {
    frames.push(t - last);
    last = t;
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const wheel = (dy, ctrl) =>
    document.querySelector(".paper-viewport canvas").dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: dy,
        ctrlKey: ctrl,
        clientX: vp.x + vp.width / 2,
        clientY: vp.y + vp.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  const wait = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 60; i++) {
    wheel(i < 30 ? 60 : -60, true); // zoom out then in
    await wait();
  }
  for (let i = 0; i < 60; i++) {
    wheel(i < 30 ? 25 : -25, false); // pan down then up
    await wait();
  }
  running = false;
  const f = frames.slice(2).sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  return {
    frames: f.length,
    avgMs: avg,
    p95Ms: f[Math.floor(f.length * 0.95)],
    maxMs: f[f.length - 1],
  };
});
check(
  "pan and zoom stay smooth with 500 strokes (avg < 25 ms, p95 < 40 ms per frame)",
  stats.avgMs < 25 && stats.p95Ms < 40,
  `avg ${stats.avgMs.toFixed(1)} ms, p95 ${stats.p95Ms.toFixed(1)} ms, max ${stats.maxMs.toFixed(1)} ms over ${stats.frames} frames`,
);

await page.screenshot({ path: path.join(path.dirname(pages), "..", "..", "m2-heavy.png") });
await page.click('button[aria-label="Previous page"]');
await sleep(600);
await page.screenshot({ path: path.join(path.dirname(pages), "..", "..", "m2-tools.png") });

await browser.close();
process.exit(finish() ? 1 : 0);

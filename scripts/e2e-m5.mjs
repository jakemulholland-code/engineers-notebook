// Milestone 5 end-to-end check: export (Markdown, PDF, both; page, tab, all),
// visual match with the screen, printer friendly, and AI page snapshots.
// Start the app exactly as for e2e-m4 (with the mock AI host and test keyring), then:
//   node scripts/e2e-m5.mjs
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { checker, connect, scratch, sleep } from "./e2e-lib.mjs";
import { startMockAi } from "./mock-ai.mjs";

const { check, finish } = checker();
const mock = await startMockAi(9455);
const { browser, page } = await connect();

const now = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const iso = now.toISOString();
const base = { rotation: 0, createdAt: iso, updatedAt: iso };

// ---------- fixtures ----------
async function makeClient(name) {
  const folder = path.join(scratch, name);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  await page.evaluate(
    ({ folder, name }) =>
      window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
        folder,
        name,
        colour: "#01C6A3",
        allowForeign: false,
      }),
    { folder, name },
  );
  return path.join(folder, "notes");
}
const writePage = (notes, file, p) =>
  fs.writeFileSync(path.join(notes, "pages", file), JSON.stringify(p, null, 2));

const gaNotes = await makeClient("Grade A Technology");
const qNotes = await makeClient("Quest Hardware");
const asset = await page.evaluate(async (notesPath) => {
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 220;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#eef1f8";
  ctx.fillRect(0, 0, 400, 220);
  ctx.fillStyle = "#8fa3cc";
  for (let i = 0; i < 10; i++) ctx.fillRect(20 + i * 36, 200 - i * 15, 24, i * 15);
  const b64 = c.toDataURL("image/png").split(",")[1];
  return window.__TAURI_INTERNALS__.invoke("save_asset", { notesPath, dataBase64: b64 });
}, gaNotes);

const audit = {
  schemaVersion: 1,
  id: "audit",
  title: "Faceted navigation audit",
  createdAt: "2026-10-28T09:15:00.000Z",
  updatedAt: iso,
  elements: [
    {
      ...base,
      id: "note",
      type: "text",
      text: "Filter URLs are getting crawled and indexed.",
      w: 360,
      fontSize: 17,
      colour: "#F4F7FF",
      heading: false,
      x: 60,
      y: 140,
      date: {
        kind: "due",
        date: ymd(new Date(now.getTime() + 4 * 864e5)),
        includeInSummary: true,
        done: false,
      },
    },
    {
      ...base,
      id: "box",
      type: "rect",
      w: 160,
      h: 80,
      colour: "#F4F7FF",
      width: 2,
      dashed: false,
      x: 540,
      y: 140,
    },
    {
      ...base,
      id: "lbl",
      type: "text",
      text: "Category page",
      w: 140,
      fontSize: 15,
      colour: "#F4F7FF",
      heading: false,
      x: 560,
      y: 170,
    },
    {
      ...base,
      id: "arr",
      type: "arrow",
      points: [0, 0, 80, 0],
      colour: "#F4F7FF",
      width: 2,
      x: 700,
      y: 180,
    },
    {
      ...base,
      id: "pink",
      type: "stroke",
      tool: "pen",
      points: [0, 0, 0.5, 40, -8, 0.5, 80, 20, 0.5, 60, 60, 0.5, 10, 50, 0.5],
      colour: "#FF5C86",
      width: 4,
      opacity: 1,
      x: 960,
      y: 280,
    },
    {
      ...base,
      id: "hl",
      type: "stroke",
      tool: "brush",
      points: [0, 0, 0.5, 300, 4, 0.5],
      colour: "#E8A828",
      width: 20,
      opacity: 0.4,
      x: 60,
      y: 660,
    },
    { ...base, id: "img", type: "image", asset, w: 400, h: 220, x: 60, y: 360 },
    {
      ...base,
      id: "h",
      type: "text",
      text: "Next steps",
      w: 340,
      fontSize: 28,
      colour: "#F4F7FF",
      heading: true,
      x: 540,
      y: 396,
    },
    {
      ...base,
      id: "cl",
      type: "checklist",
      w: 380,
      x: 540,
      y: 440,
      items: [
        { id: "i1", text: "Pull facet URLs from the crawl", done: true },
        {
          id: "i2",
          text: "Brief dev on noindex vs canonical",
          done: false,
          date: { kind: "follow_up", date: "2026-11-12", includeInSummary: true, done: false },
        },
      ],
    },
  ],
};
writePage(gaNotes, "2026-10-28-faceted-navigation-audit.page.json", audit);
writePage(gaNotes, "2026-10-30-meeting-notes.page.json", {
  schemaVersion: 1,
  id: "meet",
  title: "Meeting notes",
  createdAt: "2026-10-30T09:00:00.000Z",
  updatedAt: iso,
  elements: [
    {
      ...base,
      id: "m1",
      type: "text",
      text: "Agreed the crawl budget plan.",
      w: 400,
      fontSize: 17,
      colour: "#01C6A3",
      heading: false,
      x: 60,
      y: 140,
    },
  ],
});
writePage(qNotes, "2026-11-01-migration.page.json", {
  schemaVersion: 1,
  id: "mig",
  title: "Migration",
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: iso,
  elements: [
    {
      ...base,
      id: "q1",
      type: "text",
      text: "Send redirect map",
      w: 300,
      fontSize: 17,
      colour: "#F4F7FF",
      heading: false,
      x: 60,
      y: 140,
    },
  ],
});

const exportsDir = path.join(scratch, "exports");
fs.rmSync(exportsDir, { recursive: true, force: true });
fs.mkdirSync(exportsDir, { recursive: true });
const cfgPath = path.join(scratch, "appdata", "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "ga",
    name: "Grade A Technology",
    colour: "#01C6A3",
    folder: path.dirname(gaNotes),
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
  {
    id: "q",
    name: "Quest Hardware",
    colour: "#8FB8FF",
    folder: path.dirname(qNotes),
    order: 1,
    archived: false,
    excludeFromAi: false,
  },
];
cfg.lastOpened = { tabId: "ga", pageId: "audit" };
cfg.export = {
  format: "both",
  destination: exportsDir,
  includeImages: true,
  includeDone: true,
  printerFriendly: false,
};
cfg.ai = {
  provider: "openrouter",
  models: { openrouter: "mock/vision-model" },
  customBaseUrl: "",
  lookAheadDays: 14,
  staleDays: 21,
  includeSnapshots: true,
  temperature: 0.3,
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
fs.rmSync(path.join(scratch, "appdata", "models-cache.json"), { force: true });
await page.reload();
await page.waitForSelector("#page-title-input");
await sleep(800);

// ---------- helpers ----------
const today = ymd(now);
async function doExport({ scope, format, printer = false }) {
  await page.keyboard.press("Escape");
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
  await page.keyboard.press("Control+Shift+E");
  await page.waitForSelector(".export-dialog");
  await page.click(`.export-dialog label:has-text("${scope}") input`);
  await page.click(
    `.export-dialog fieldset:has(legend:text("Format")) label:has-text("${format}") input`,
  );
  const pf = page.locator('.export-dialog label:has-text("Printer friendly") input');
  if (!(await pf.isDisabled()) && (await pf.isChecked()) !== printer) await pf.click();
  await page.click('.export-dialog button[type="submit"]');
  await page.waitForSelector('.export-dialog button:has-text("Open folder")', { timeout: 60_000 });
  const root = await page.innerText(".export-progress code.path");
  await page.click('.export-dialog button:has-text("Close")');
  return root.trim();
}
const list = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(path.relative(dir, f).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.sort();
};
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const pdfInfo = async (file) => {
  const d = await PDFDocument.load(fs.readFileSync(file));
  return { pages: d.getPageCount(), sizes: d.getPages().map((p) => p.getSize()) };
};
const isA4Landscape = (s) => Math.abs(s.width - 841.89) < 0.5 && Math.abs(s.height - 595.28) < 0.5;

// ---------- 1. this page, both formats ----------
const r1 = await doExport({ scope: "This page", format: "Both" });
check(
  "export folder is notebook-export-<today> inside the destination",
  r1 === path.join(exportsDir, `notebook-export-${today}`),
  r1,
);
const f1 = list(r1);
const pageBase = "Grade A Technology/2026-10-28-faceted-navigation-audit";
check(
  "page scope writes .md, .pdf, snapshot and pasted image",
  [
    `${pageBase}.md`,
    `${pageBase}.pdf`,
    `Grade A Technology/assets/2026-10-28-faceted-navigation-audit-snapshot.png`,
    `Grade A Technology/${asset}`,
    "Reminders.md",
    "Reminders.pdf",
  ].every((f) => f1.includes(f)),
  f1.join(", "),
);
check("page scope writes no combined PDF", !f1.some((f) => f.includes("all pages")));
const md = fs.readFileSync(path.join(r1, `${pageBase}.md`), "utf8");
check(
  "Markdown has front matter",
  md.startsWith(
    '---\ntitle: "Faceted navigation audit"\ntab: "Grade A Technology"\ncreated: 2026-10-28T09:15:00.000Z',
  ),
);
check(
  "Markdown starts with the page snapshot",
  md.indexOf("![Page snapshot](assets/2026-10-28-faceted-navigation-audit-snapshot.png)") <
    md.indexOf("Filter URLs"),
);
check(
  "Markdown checklist and inline dates",
  md.includes("- [ ] Brief dev on noindex vs canonical (Follow up: 2026-11-12)") &&
    md.includes("- [x] Pull facet URLs from the crawl"),
);
check("Markdown links the pasted image", md.includes(`![Image](${asset})`));
const reminders = fs.readFileSync(path.join(r1, "Reminders.md"), "utf8");
check(
  "Reminders.md lists groups as task lists",
  reminders.includes("# Reminders") && /- \[ \] Brief dev on noindex/.test(reminders),
);
const snap = pngSize(
  path.join(r1, "Grade A Technology/assets/2026-10-28-faceted-navigation-audit-snapshot.png"),
);
check(
  "pages are rendered at 2x (3200 x 2200)",
  snap.w === 3200 && snap.h === 2200,
  `${snap.w} x ${snap.h}`,
);
const p1 = await pdfInfo(path.join(r1, `${pageBase}.pdf`));
check(
  "page PDF is one landscape A4 page",
  p1.pages === 1 && isA4Landscape(p1.sizes[0]),
  JSON.stringify(p1.sizes[0]),
);
const rp = await pdfInfo(path.join(r1, "Reminders.pdf"));
check("Reminders.pdf is landscape A4", rp.pages >= 1 && isA4Landscape(rp.sizes[0]));

// ---------- 2. this tab, PDF only ----------
const r2 = await doExport({ scope: "This tab", format: "PDF" });
check(
  "a second export the same day gets a new folder (no overwrite)",
  r2.endsWith(`notebook-export-${today}-2`),
  r2,
);
const f2 = list(r2);
check(
  "tab PDF export: one PDF per page, a combined PDF and Reminders.pdf, no Markdown",
  [
    `${pageBase}.pdf`,
    "Grade A Technology/2026-10-30-meeting-notes.pdf",
    "Grade A Technology/Grade A Technology - all pages.pdf",
    "Reminders.pdf",
  ].every((f) => f2.includes(f)) && !f2.some((f) => f.endsWith(".md")),
  f2.join(", "),
);
const combined = await pdfInfo(
  path.join(r2, "Grade A Technology/Grade A Technology - all pages.pdf"),
);
check(
  "combined PDF = contents page + each page, all landscape A4",
  combined.pages === 3 && combined.sizes.every(isA4Landscape),
  combined.pages,
);
check("tab scope leaves other tabs out", !f2.some((f) => f.startsWith("Quest Hardware")));

// ---------- 3. all tabs, Markdown only ----------
const r3 = await doExport({ scope: "All tabs", format: "Markdown" });
const f3 = list(r3);
check(
  "all tabs: a folder per tab with Markdown, no PDFs",
  f3.includes(`${pageBase}.md`) &&
    f3.includes("Quest Hardware/2026-11-01-migration.md") &&
    !f3.some((f) => f.endsWith(".pdf")),
  f3.join(", "),
);

// ---------- 4. printer friendly ----------
const r4 = await doExport({ scope: "This page", format: "Both", printer: true });
const printSnap = fs
  .readFileSync(
    path.join(r4, "Grade A Technology/assets/2026-10-28-faceted-navigation-audit-snapshot.png"),
  )
  .toString("base64");
const screenSnap = fs
  .readFileSync(
    path.join(r1, "Grade A Technology/assets/2026-10-28-faceted-navigation-audit-snapshot.png"),
  )
  .toString("base64");

const sample = (b64, points) =>
  page.evaluate(
    async ({ b64, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    },
    { b64, points },
  );
// At 2x: (60,60) is plain paper; (201,60) is on the 100 px major grid line; (260,300) is inside the white note text area.
const [paperP, gridP] = await sample(printSnap, [
  [60, 60],
  [201, 60],
]);
const [paperS] = await sample(screenSnap, [[60, 60]]);
check(
  "printer friendly paper is white",
  paperP.every((v) => v >= 250),
  JSON.stringify(paperP),
);
check(
  "printer friendly grid is light blue",
  gridP[2] > gridP[0] && gridP[2] > 200 && gridP[0] < 240,
  JSON.stringify(gridP),
);
check(
  "screen export keeps the dark blue paper",
  Math.abs(paperS[0] - 0x16) < 4 &&
    Math.abs(paperS[1] - 0x37) < 4 &&
    Math.abs(paperS[2] - 0x64) < 4,
  JSON.stringify(paperS),
);
const darkInk = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(120, 280, 600, 40).data; // the first note's text, at 2x
  let min = 255;
  for (let i = 0; i < d.length; i += 4) min = Math.min(min, (d[i] + d[i + 1] + d[i + 2]) / 3);
  return min;
}, printSnap);
check("printer friendly ink is dark", darkInk < 90, darkInk);
const pf = await pdfInfo(path.join(r4, `${pageBase}.pdf`));
check("printer friendly PDF is landscape A4", pf.pages === 1 && isA4Landscape(pf.sizes[0]));

// ---------- 5. the export looks like the screen ----------
await page.keyboard.press("Escape");
await page.click('button[aria-label="Select"]');
await page.keyboard.press("Escape");
await page.evaluate(
  () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
);
await page.keyboard.press("Control+0");
await sleep(600);
const live = (await page.locator(".paper-viewport").screenshot({ scale: "css" })).toString(
  "base64",
);
const diff = await page.evaluate(
  async ({ live, snap }) => {
    const load = async (b64) => {
      const i = new Image();
      i.src = `data:image/png;base64,${b64}`;
      await i.decode();
      return i;
    };
    const a = await load(live);
    const b = await load(snap);
    const w = Math.min(a.width, 1600);
    const h = Math.min(a.height, 1100);
    const ca = document.createElement("canvas");
    ca.width = w;
    ca.height = h;
    ca.getContext("2d").drawImage(a, 0, 0);
    const cb = document.createElement("canvas");
    cb.width = w;
    cb.height = h;
    cb.getContext("2d").drawImage(b, 0, 0, 1600, 1100); // 2x export shown at 1x, like the screen at 100%
    const da = ca.getContext("2d").getImageData(0, 0, w, h).data;
    const db = cb.getContext("2d").getImageData(0, 0, w, h).data;
    let off = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(
        Math.abs(da[i] - db[i]),
        Math.abs(da[i + 1] - db[i + 1]),
        Math.abs(da[i + 2] - db[i + 2]),
      );
      if (d > 48) off++;
    }
    return { w, h, share: off / (w * h) };
  },
  { live, snap: screenSnap },
);
check(
  "exported page matches the screen (under 2% of pixels differ noticeably)",
  diff.share < 0.02,
  `${(diff.share * 100).toFixed(2)}% of ${diff.w}x${diff.h}`,
);

// ---------- 6. AI page snapshots ----------
await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("save_key", {
    provider: "openrouter",
    key: "test-snapshots-WXYZ",
  }),
);
await page.click('.toolbar >> text="Catch me up"');
await page.waitForSelector(".catch-up");
mock.reset();
await page.click(".foot-buttons .pill >> nth=0");
await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
  timeout: 60_000,
});
await sleep(300);
let req = [...mock.requests].reverse().find((r) => r.method === "POST");
const parts = req?.body?.messages?.[1]?.content;
const imgs = Array.isArray(parts) ? parts.filter((p) => p.type === "image_url") : [];
check(
  "vision model gets page snapshots (at most 5)",
  imgs.length >= 1 && imgs.length <= 5,
  imgs.length,
);
check(
  "snapshots are PNGs of whole pages",
  imgs.every((p) => p.image_url.url.startsWith("data:image/png;base64,")),
);
check(
  "and the prompt names them",
  JSON.stringify(parts).includes("Snapshots of these pages are attached"),
);
check(
  "panel says snapshots were included",
  (await page.innerText(".catch-up .footnote")).includes("page snapshot"),
);

const cfg2 = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
cfg2.ai.models.openrouter = "mock/text-model";
fs.writeFileSync(cfgPath, JSON.stringify(cfg2, null, 2));
await page.reload();
await page.waitForSelector("#page-title-input");
await page.click('.toolbar >> text="Catch me up"');
mock.reset();
await page.click(".foot-buttons .pill >> nth=0");
await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
  timeout: 60_000,
});
await sleep(300);
req = [...mock.requests].reverse().find((r) => r.method === "POST");
check("text-only model gets no snapshots", typeof req?.body?.messages?.[1]?.content === "string");
check(
  "and the panel says why",
  (await page.innerText(".catch-up .footnote")).includes(
    "No page snapshots: the model does not take images",
  ),
);
await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("remove_key", { provider: "openrouter" }),
);

await page.click('button[aria-label="Close catch-up"]');
await page.keyboard.press("Control+Shift+E");
await page.waitForSelector(".export-dialog");
await page.screenshot({ path: path.join(scratch, "m5-dialog.png") });
await page.keyboard.press("Escape");

await browser.close();
await mock.close();
process.exit(finish() ? 1 : 0);

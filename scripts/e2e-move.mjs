// End-to-end check for Change folder (move existing notes, or point at the new folder only)
// against the real Tauri app.
//
// 1. Start the app with a scratch app-data folder and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata-move"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-move.mjs
//
// The native folder picker cannot be driven over the debugging port, so the script queues
// a scratch folder in `window.__e2eFolders`, which dev builds of `chooseFolder` answer from
// (src/storage/backend.ts). Everything after the picker is real.
// Uses only folders under test-fixtures/_scratch; the moved-away notes folder goes to the
// Windows Recycle Bin and is checked there.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const appData = process.env.ENGINEERS_NOTEBOOK_APP_DIR ?? path.join(scratch, "appdata-move");
const base = path.join(scratch, "clients-move");
const OLD = path.join(base, "Old place");
const NEW = path.join(base, "New place");
const BUSY = path.join(base, "Busy place");
const BLANK = path.join(base, "Blank place");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
/** Relative path -> sha256 for every file under a folder. */
function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else
        out[r] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(dir, r)))
          .digest("hex");
    }
  };
  walk("");
  return out;
}
const binnedFrom = (folder) =>
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') + '|' + $_.Name }",
    ],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .some((l) => l.toLowerCase() === `${folder}|notes`.toLowerCase());

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      return await chromium.connectOverCDP("http://127.0.0.1:9333");
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("Could not reach the WebView2 debugging port");
}

const browser = await connect();
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector(".app", { timeout: 60_000 });

/** The next folder picker returns `folder` instead of opening (dev builds only). */
const answerFolderDialog = (folder) =>
  page.evaluate((f) => {
    window.__e2eFolders = [f];
  }, folder);
const notice = async () =>
  (await page.isVisible(".notice")) ? ((await page.textContent(".notice span")) ?? "") : "";
const count = async () => (await page.textContent(".statusbar button.count"))?.trim() ?? "";

// --- A client in "Old place" with two pages (and a .bak from a second save).
fs.rmSync(base, { recursive: true, force: true });
for (const f of [OLD, NEW, BUSY, BLANK]) fs.mkdirSync(f, { recursive: true });
fs.mkdirSync(path.join(BUSY, "notes"), { recursive: true });
fs.writeFileSync(path.join(BUSY, "notes", "keep-me.txt"), "someone else's notes");
await page.evaluate(
  (folder) =>
    window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
      folder,
      name: "Mover",
      colour: "#8FB8FF",
      allowForeign: false,
    }),
  OLD,
);
const cfgPath = path.join(appData, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-mover",
    name: "Mover",
    colour: "#8FB8FF",
    folder: OLD,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
];
cfg.lastOpened = { tabId: "tab-mover" };
fs.mkdirSync(appData, { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
await page.reload();
await page.waitForSelector(".tabs >> text=Mover");
await page.click(".empty-state >> text=New page");
await page.click(".statusbar [aria-label='New page']");
const oldNotes = path.join(OLD, "notes");
const pageCount = () =>
  fs.readdirSync(path.join(oldNotes, "pages")).filter((n) => n.endsWith(".page.json")).length;
check("two pages written", await waitFor(() => pageCount() === 2));
await page.keyboard.press("Control+P");
await page.click(".page-list li:nth-child(1) [aria-label^='Rename']");
await page.fill(".page-list li.editing input", "Before the move");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
await waitFor(() =>
  fs.readdirSync(path.join(oldNotes, "pages")).some((n) => n.includes("before-the-move")),
);
await sleep(1200);
const before = snapshot(oldNotes);
check("snapshot taken", Object.keys(before).length >= 4, Object.keys(before).join(", "));

// --- Refused: the destination already has a non-empty notes folder.
await page.keyboard.press("Control+,");
await page.waitForSelector(".client-list");
await answerFolderDialog(BUSY);
await page.click(".client-row >> text=Change folder");
await page.waitForSelector(".change-folder");
check(
  "busy folder defaults to point-at",
  await page.isChecked(".change-folder label:has-text('Point at the new folder only') input"),
);
await page.click(".change-folder label:has-text('Move existing notes')");
await page.click(".change-folder >> text=Move notes");
check(
  "move into a non-empty notes folder is refused",
  await waitFor(async () =>
    ((await page.textContent(".change-folder .form-error").catch(() => "")) ?? "").includes(
      "not empty",
    ),
  ),
);
check(
  "nothing changed after the refusal",
  JSON.stringify(snapshot(oldNotes)) === JSON.stringify(before) &&
    fs.readFileSync(path.join(BUSY, "notes", "keep-me.txt"), "utf8") === "someone else's notes" &&
    !fs.existsSync(path.join(BUSY, "notes", "pages")),
);
await page.click(".change-folder >> text=Cancel");

// --- Move to an empty folder: copy, verify, bin the old one.
await answerFolderDialog(NEW);
await page.click(".client-row >> text=Change folder");
await page.waitForSelector(".change-folder");
check(
  "empty folder defaults to move",
  await page.isChecked(".change-folder label:has-text('Move existing notes') input"),
);
await page.click(".change-folder >> text=Move notes");
check(
  "notice confirms the move",
  await waitFor(async () => (await notice()).includes("Moved and checked")),
  await notice(),
);
const newNotes = path.join(NEW, "notes");
const after = fs.existsSync(newNotes) ? snapshot(newNotes) : {};
check(
  "every file arrived unchanged",
  JSON.stringify(after) === JSON.stringify(before),
  `${Object.keys(after).length} of ${Object.keys(before).length}`,
);
check("old notes folder is gone", !fs.existsSync(oldNotes));
check("old notes folder is in the Recycle Bin", binnedFrom(OLD));
check(
  "Settings shows the new path",
  (await page
    .isVisible(`.client-row >> text=${newNotes.replace(/\\/g, "\\\\")}`)
    .catch(() => false)) ||
    ((await page.textContent(".client-list .client-row .meta span")) ?? "").includes("New place"),
);
await page.keyboard.press("Escape");
check(
  "pages still open",
  (await count()) === "Page 2 of 2" || (await count()).endsWith("of 2"),
  await count(),
);

// --- The new folder is watched: an outside edit there reloads.
const target = fs
  .readdirSync(path.join(newNotes, "pages"))
  .find((n) => n.includes("before-the-move"));
const json = JSON.parse(fs.readFileSync(path.join(newNotes, "pages", target), "utf8"));
json.title = "Edited after the move";
fs.writeFileSync(path.join(newNotes, "pages", target), JSON.stringify(json, null, 2) + "\n");
const titles = async () => {
  await page.keyboard.press("Control+P");
  await page.waitForSelector(".page-list");
  const t = await page.locator(".page-list .title").allTextContents();
  await page.keyboard.press("Escape");
  return t;
};
check(
  "new folder is watched",
  await waitFor(async () => (await titles()).includes("Edited after the move")),
);

// --- Point at a blank folder: notes stay where they are.
await page.keyboard.press("Control+,");
await page.waitForSelector(".client-list");
await answerFolderDialog(BLANK);
await page.click(".client-row >> text=Change folder");
await page.waitForSelector(".change-folder");
await page.click(".change-folder label:has-text('Point at the new folder only')");
await page.screenshot({ path: path.join(scratch, "change-folder.png") });
await page.click(".change-folder button[type=submit]");
check(
  "point-at creates an empty notes folder",
  await waitFor(() => fs.existsSync(path.join(BLANK, "notes", "notebook.json"))),
);
await page.keyboard.press("Escape");
check(
  "tab now shows the blank folder",
  await waitFor(async () => await page.isVisible(".empty-state >> text=No pages yet")),
);
check("moved notes left untouched", fs.readdirSync(path.join(newNotes, "pages")).length >= 2);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

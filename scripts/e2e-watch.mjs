// End-to-end check for watching notes folders against the real Tauri app.
//
// 1. Start the app with a scratch app-data folder and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata-watch"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-watch.mjs
//
// Edits page files directly on disk, as OneDrive, Dropbox or another editor would, and checks
// the app reloads them, adds and removes pages, and keeps unsaved edits with a notice.
// Uses only folders under test-fixtures/_scratch, never real client folders.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const appData = process.env.ENGINEERS_NOTEBOOK_APP_DIR ?? path.join(scratch, "appdata-watch");
const client = path.join(scratch, "client-watch");
const pagesDir = path.join(client, "notes", "pages");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageFiles = () =>
  fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter((n) => n.endsWith(".page.json")) : [];
const readPage = (name) => JSON.parse(fs.readFileSync(path.join(pagesDir, name), "utf8"));
const writePage = (name, page) =>
  fs.writeFileSync(path.join(pagesDir, name), JSON.stringify(page, null, 2) + "\n");
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};

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

const count = async () => (await page.textContent(".statusbar button.count"))?.trim() ?? "";
const notice = async () =>
  (await page.isVisible(".notice")) ? ((await page.textContent(".notice span")) ?? "") : "";
async function titles() {
  await page.keyboard.press("Control+P");
  await page.waitForSelector(".page-list");
  const t = await page.locator(".page-list .page-open .title").allTextContents();
  await page.keyboard.press("Escape");
  return t;
}

// --- A fresh client folder with one page made in the app.
fs.rmSync(client, { recursive: true, force: true });
fs.mkdirSync(client, { recursive: true });
await page.evaluate(
  (folder) =>
    window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
      folder,
      name: "Watch",
      colour: "#FF5C86",
      allowForeign: false,
    }),
  client,
);
const cfgPath = path.join(appData, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-watch",
    name: "Watch",
    colour: "#FF5C86",
    folder: client,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
];
cfg.lastOpened = { tabId: "tab-watch" };
fs.mkdirSync(appData, { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
await page.reload();
await page.waitForSelector(".tabs >> text=Watch");
await page.click(".empty-state >> text=New page");
check("first page written", await waitFor(() => pageFiles().length === 1));

// --- The app's own saves (including a rename) never look like outside changes.
await page.keyboard.press("Control+P");
await page.click(".page-list [aria-label^='Rename']");
await page.fill(".page-list li.editing input", "Site audit");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
check(
  "own rename saved",
  await waitFor(() => pageFiles().some((n) => n.endsWith("-site-audit.page.json"))),
  pageFiles().join(),
);
await sleep(2000);
check("no notice for the app's own saves", (await notice()) === "", await notice());
check("still one page", (await count()) === "Page 1 of 1", await count());

// --- Edited outside with no unsaved edits: reloaded quietly.
const [mainFile] = pageFiles();
const outside = readPage(mainFile);
outside.title = "Site audit (edited on laptop)";
outside.updatedAt = new Date().toISOString();
writePage(mainFile, outside);
check(
  "outside edit reloads the page",
  await waitFor(async () => (await titles()).includes("Site audit (edited on laptop)"), 6000),
);
check("no notice for a clean reload", (await notice()) === "", await notice());

// --- A page file added outside appears; removing it takes it away again.
const added = {
  ...outside,
  id: crypto.randomUUID(),
  title: "Added on laptop",
  createdAt: new Date(Date.now() + 1000).toISOString(),
  elements: [],
};
const addedName = mainFile.replace(/-[^-]+(-[^-]+)*\.page\.json$/, "-added-on-laptop.page.json");
writePage(addedName, added);
check(
  "page added outside appears",
  await waitFor(async () => (await count()).endsWith("of 2"), 6000),
  await count(),
);
fs.rmSync(path.join(pagesDir, addedName));
check(
  "page removed outside disappears",
  await waitFor(async () => (await count()) === "Page 1 of 1", 6000),
  await count(),
);

// --- Edited outside while the app has unsaved edits: the app keeps its version.
await page.keyboard.press("Control+P");
await page.click(".page-list [aria-label^='Rename']");
await page.fill(".page-list li.editing input", "Kept in app");
await page.keyboard.press("Enter");
await page.keyboard.press("Escape");
const clash = readPage(mainFile);
clash.title = "Clashing laptop edit";
clash.updatedAt = new Date().toISOString();
writePage(mainFile, clash);
check(
  "notice when unsaved edits clash",
  await waitFor(async () => (await notice()).includes("was changed outside the app"), 6000),
  await notice(),
);
check(
  "in-app version saved over the clash",
  await waitFor(() => pageFiles().some((n) => readPage(n).title === "Kept in app"), 6000),
  pageFiles().join(),
);
check("app shows its own title", (await titles()).includes("Kept in app"));

await page.screenshot({ path: path.join(scratch, "watch-notice.png") });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

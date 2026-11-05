// End-to-end check for milestone 1 against the real Tauri app.
//
// 1. Start the app with a scratch app-data folder and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-m1.mjs
//
// Uses only folders under test-fixtures/_scratch, never real client folders.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const client = path.join(scratch, "client-a");
const notes = path.join(client, "notes");
const pages = path.join(notes, "pages");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// --- Add a client through the same Tauri command the Settings flow uses.
fs.mkdirSync(client, { recursive: true });
const prep = await page.evaluate(
  (folder) =>
    window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
      folder,
      name: "Client A",
      colour: "#01C6A3",
      allowForeign: false,
    }),
  client,
);
check("prepare_client_folder reports created", prep.status === "created", prep.status);
for (const p of ["pages", "assets", "notebook.json"]) {
  check(`notes/${p} exists`, fs.existsSync(path.join(notes, p)));
}

// Register the tab in app config and reload so the app picks it up.
const cfgPath = path.join(scratch, "appdata", "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-a",
    name: "Client A",
    colour: "#01C6A3",
    folder: client,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
];
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
await page.reload();
await page.waitForSelector("text=Client A");
check("tab shows in the tab list", await page.isVisible(".tabs >> text=Client A"));

// --- New page is written to disk.
await page.click("text=New page");
await page.waitForSelector("#page-title-input");
await sleep(500);
let files = fs.readdirSync(pages).filter((f) => f.endsWith(".page.json"));
check("new page file written", files.length === 1, files.join(", "));

// --- Title edit autosaves after ~800 ms and renames the file.
await page.fill("#page-title-input", "E2E faceted audit");
await sleep(400);
files = fs.readdirSync(pages).filter((f) => f.endsWith(".page.json"));
check(
  "no save before the 800 ms debounce",
  files.some((f) => f.endsWith("-untitled-page.page.json")),
  files.join(", "),
);
await sleep(1200);
files = fs.readdirSync(pages).filter((f) => f.endsWith(".page.json"));
const renamed = files.find((f) => f.endsWith("-e2e-faceted-audit.page.json"));
check("file renamed to match title", !!renamed, files.join(", "));
const saved = renamed ? JSON.parse(fs.readFileSync(path.join(pages, renamed), "utf8")) : null;
check("saved JSON has new title", saved?.title === "E2E faceted audit");
check(
  "a .bak of the previous version exists",
  !!renamed && fs.existsSync(path.join(pages, `${renamed}.bak`)),
);
check("no temp files left", !fs.readdirSync(pages).some((f) => f.endsWith(".tmp")));

// --- Reload from disk.
await page.reload();
await page.waitForSelector("#page-title-input");
check(
  "title survives reload",
  (await page.inputValue("#page-title-input")) === "E2E faceted audit",
);

// --- Future schema version opens read-only and is not overwritten.
const future = {
  ...saved,
  id: "future-page",
  title: "From the future",
  schemaVersion: 99,
  createdAt: "2030-01-01T10:00:00.000Z",
};
const futureName = "2030-01-01-from-the-future.page.json";
fs.writeFileSync(path.join(pages, futureName), JSON.stringify(future));
await page.reload();
await page.waitForSelector("#page-title-input");
// Pages sort by created date, so the future page is last. Go there.
await page.click('button[aria-label="Next page"]');
await sleep(300);
const ro = await page.getAttribute("#page-title-input", "readonly");
check("future-version page opens read-only", ro !== null);
const before = fs.readFileSync(path.join(pages, futureName), "utf8");
await sleep(1200);
check(
  "future-version page untouched on disk",
  fs.readFileSync(path.join(pages, futureName), "utf8") === before,
);

await page.screenshot({ path: path.join(scratch, "m1-screenshot.png") });
await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

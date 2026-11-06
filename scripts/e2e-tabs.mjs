// End-to-end check for the tab menu, reordering and archiving against the real Tauri app.
//
// 1. Start the app with a scratch app-data folder and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata-tabs"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-tabs.mjs
//
// Uses only folders under test-fixtures/_scratch, never real client folders.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const appData = process.env.ENGINEERS_NOTEBOOK_APP_DIR ?? path.join(scratch, "appdata-tabs");
const base = path.join(scratch, "clients-tabs");
const NAMES = ["Alpha", "Bravo", "Charlie"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
const cfgPath = path.join(appData, "config.json");
const savedOrder = () =>
  JSON.parse(fs.readFileSync(cfgPath, "utf8"))
    .tabs.filter((t) => !t.archived)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.name);
const notebookJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(base, name, "notes", "notebook.json"), "utf8"));

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

const shown = () => page.locator(".tab-list .tab .name").allTextContents();
const tab = (name) => page.locator(".tab-list .tab", { hasText: name });
async function menu(name, item) {
  await tab(name).click({ button: "right" });
  await page.waitForSelector(".context-menu");
  if (item) await page.click(`.context-menu >> text=${item}`);
}

// --- Three fresh client folders.
fs.rmSync(base, { recursive: true, force: true });
const tabs = [];
for (const [i, name] of NAMES.entries()) {
  const folder = path.join(base, name);
  fs.mkdirSync(folder, { recursive: true });
  await page.evaluate(
    (f) =>
      window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
        folder: f.folder,
        name: f.name,
        colour: "#01C6A3",
        allowForeign: false,
      }),
    { folder, name },
  );
  tabs.push({
    id: `tab-${name.toLowerCase()}`,
    name,
    colour: "#01C6A3",
    folder,
    order: i,
    archived: false,
    excludeFromAi: false,
  });
}
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = tabs;
cfg.lastOpened = { tabId: "tab-alpha" };
fs.mkdirSync(appData, { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
await page.reload();
await page.waitForSelector(".tab-list .tab >> text=Charlie");
check("three tabs shown", (await shown()).join() === "Alpha,Bravo,Charlie", (await shown()).join());

// --- Right-click menu.
await menu("Bravo");
const items = await page.locator(".context-menu button").allTextContents();
check(
  "menu has rename, colour, folder and archive",
  items.join() === "Rename,Change colour,Open folder in Explorer,Archive",
  items.join(),
);
await page.keyboard.press("Escape");
check("Escape closes the menu", !(await page.isVisible(".context-menu")));

// --- Rename and change colour, kept in notebook.json too.
await menu("Bravo", "Rename");
await page.waitForSelector(".tab-edit");
check(
  "rename focuses the name",
  await page.evaluate(() => document.activeElement?.getAttribute("type") === "text"),
);
await page.fill(".tab-edit input[type=text]", "Bravo Ltd");
await page.click(".tab-edit >> text=Save");
check("tab renamed", await waitFor(async () => (await shown()).includes("Bravo Ltd")));
check(
  "notebook.json name updated",
  await waitFor(() => notebookJson("Bravo").name === "Bravo Ltd"),
  notebookJson("Bravo").name,
);

await menu("Charlie", "Change colour");
await page.waitForSelector(".tab-edit");
await page.click(".tab-edit .swatch[aria-label=Gold]");
await page.click(".tab-edit >> text=Save");
const marker = async (name) =>
  tab(name)
    .locator(".marker")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
check(
  "tab colour changed",
  await waitFor(async () => (await marker("Charlie")) === "rgb(232, 168, 40)"),
  await marker("Charlie"),
);
check(
  "notebook.json colour updated",
  await waitFor(() => notebookJson("Charlie").colour.toUpperCase() === "#E8A828"),
  notebookJson("Charlie").colour,
);
await menu("Alpha", "Rename");
await page.waitForSelector(".tab-edit");
await page.keyboard.press("Escape");
check("Escape cancels editing", !(await page.isVisible(".tab-edit")));
check("name unchanged after cancel", (await shown()).includes("Alpha"));

// --- Drag Charlie to the top.
const from = await tab("Charlie").boundingBox();
const to = await tab("Alpha").boundingBox();
await page.mouse.move(from.x + 40, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(from.x + 40, from.y + from.height / 2 - 10, { steps: 3 });
await page.mouse.move(to.x + 40, to.y + 4, { steps: 8 });
check("drop line shows while dragging", await page.isVisible(".tab-list .tab[data-drop=before]"));
await page.mouse.up();
check(
  "drag moves the tab",
  await waitFor(async () => (await shown()).join() === "Charlie,Alpha,Bravo Ltd"),
  (await shown()).join(),
);
check("order saved", savedOrder().join() === "Charlie,Alpha,Bravo Ltd", savedOrder().join());
check(
  "drag does not open the tab",
  (await page.getAttribute(".tab-list .tab >> nth=0", "aria-current")) === null,
);

// --- A plain click still opens a tab; Alt+Down moves it.
await tab("Alpha").click();
check("click opens a tab", (await tab("Alpha").getAttribute("aria-current")) === "page");
await page.keyboard.press("Alt+ArrowDown");
check(
  "Alt+Down moves the focused tab",
  await waitFor(async () => (await shown()).join() === "Charlie,Bravo Ltd,Alpha"),
  (await shown()).join(),
);
check(
  "focus stays on the moved tab",
  await page.evaluate(() => document.activeElement?.textContent?.includes("Alpha") ?? false),
);

// --- Reorder from Settings with the grip and arrow keys.
await page.keyboard.press("Control+,");
await page.waitForSelector(".client-list");
await page.focus(".client-list .client-row >> nth=2 >> .grip");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
check(
  "Settings grip moves a client",
  await waitFor(() => savedOrder().join() === "Alpha,Charlie,Bravo Ltd"),
  savedOrder().join(),
);
await page.keyboard.press("Escape");

// --- Archive and restore.
await menu("Charlie", "Archive");
check(
  "archived tab leaves the side",
  await waitFor(async () => !(await shown()).includes("Charlie")),
);
check(
  "notice explains how to restore",
  (await page.textContent(".notice span")).includes("restore"),
);
check(
  "archived folder untouched",
  fs.existsSync(path.join(base, "Charlie", "notes", "notebook.json")),
);
await page.keyboard.press("Control+,");
await page.waitForSelector(".archived-clients");
check("Settings lists archived tabs", await page.isVisible(".archived-clients >> text=Charlie"));
await page.click(".archived-clients >> text=Restore");
check(
  "restore brings it back at the end",
  await waitFor(async () => (await shown()).join() === "Alpha,Bravo Ltd,Charlie"),
  (await shown()).join(),
);
check(
  "restored tab is open",
  await waitFor(async () => (await tab("Charlie").getAttribute("aria-current")) === "page"),
);
check("archive notice cleared on restore", !(await page.isVisible(".notice")));
await page.keyboard.press("Escape");

await menu("Bravo Ltd", "Rename");
await page.waitForSelector(".tab-edit");
await page.screenshot({ path: path.join(scratch, "tab-edit.png") });
await page.keyboard.press("Escape");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

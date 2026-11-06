// End-to-end check for the page list against the real Tauri app.
//
// 1. Start the app with a scratch app-data folder and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata-pages"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-pages.mjs
//
// Uses only folders under test-fixtures/_scratch, never real client folders. Deleted pages
// go to the Windows Recycle Bin (named "...-e2e-...") and are checked there.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const appData = process.env.ENGINEERS_NOTEBOOK_APP_DIR ?? path.join(scratch, "appdata-pages");
const client = path.join(scratch, "client-pages");
const pagesDir = path.join(client, "notes", "pages");
const stamp = Date.now().toString(36);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageFiles = () =>
  fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter((n) => n.endsWith(".page.json")) : [];
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
const inRecycleBin = (fragment) =>
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.Name }`,
    ],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .some((n) => n.includes(fragment));

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

// --- A fresh client folder, registered in the scratch config.
fs.rmSync(client, { recursive: true, force: true });
fs.mkdirSync(client, { recursive: true });
await page.evaluate(
  (folder) =>
    window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
      folder,
      name: "Page list",
      colour: "#8FB8FF",
      allowForeign: false,
    }),
  client,
);
const cfgPath = path.join(appData, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-pages",
    name: "Page list",
    colour: "#8FB8FF",
    folder: client,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
];
cfg.lastOpened = { tabId: "tab-pages" };
fs.mkdirSync(appData, { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
await page.reload();
await page.waitForSelector(".tabs >> text=Page list");

await page.click(".empty-state >> text=New page");
check("first page written", await waitFor(() => pageFiles().length === 1), pageFiles().join());

// --- Ctrl+P opens the list; Escape closes it; the page count toggles it.
await page.keyboard.press("Control+P");
check("Ctrl+P opens the page list", await page.isVisible(".page-list"));
check(
  "current page is focused",
  await page.evaluate(() => document.activeElement?.classList.contains("current") ?? false),
);
await page.keyboard.press("Escape");
check("Escape closes it", !(await page.isVisible(".page-list")));
await page.click(".statusbar button.count");
check("page count opens it", await page.isVisible(".page-list"));
await page.click(".statusbar button.count");
check("page count closes it again", !(await page.isVisible(".page-list")));

// --- Rename from the list renames the file.
const title = `Faceted audit e2e ${stamp}`;
await page.keyboard.press("Control+P");
await page.click(".page-list [aria-label^='Rename']");
await page.fill(".page-list li.editing input", title);
await page.keyboard.press("Enter");
const slug = `faceted-audit-e2e-${stamp}`;
check(
  "rename renames the file",
  await waitFor(() => pageFiles().some((n) => n.endsWith(`-${slug}.page.json`))),
  pageFiles().join(),
);
check("list shows the new title", await page.isVisible(`.page-list >> text=${title}`));

// --- Duplicate makes a second file and opens it.
await page.click(".page-list [aria-label^='Duplicate']");
check("duplicate writes a file", await waitFor(() => pageFiles().length === 2), pageFiles().join());
check(
  "list closes after duplicate",
  await waitFor(async () => !(await page.isVisible(".page-list"))),
);
check(
  "copy is open",
  (await page.textContent(".statusbar button.count"))?.trim() === "Page 2 of 2",
);

// --- Open page 1 from the list.
await page.keyboard.press("Control+P");
await page.click(".page-list li:nth-child(1) .page-open");
check(
  "open from list",
  (await page.textContent(".statusbar button.count"))?.trim() === "Page 1 of 2",
);

// --- Delete the copy: confirm, file goes to the Recycle Bin, not hard deleted.
await page.keyboard.press("Control+P");
const copyName = pageFiles().find((n) => n.includes("copy"));
await page.click(".page-list li:nth-child(2) [aria-label^='Delete']");
check("delete asks first", await page.isVisible(".page-list li.confirming"));
await page.keyboard.press("Escape");
check("Escape cancels the delete", !(await page.isVisible(".page-list li.confirming")));
check("nothing deleted after cancel", pageFiles().length === 2);
await page.click(".page-list li:nth-child(2) [aria-label^='Delete']");
await page.click(".page-list li.confirming >> text=Delete page");
check(
  "file leaves the pages folder",
  await waitFor(() => pageFiles().length === 1),
  pageFiles().join(),
);
check(
  "file is in the Recycle Bin",
  !!copyName && inRecycleBin(copyName.replace(/\.page\.json$/, "")),
  copyName,
);
check("list shows one page", (await page.locator(".page-list li").count()) === 1);
check(
  "page 1 still open",
  (await page.textContent(".statusbar button.count"))?.trim() === "Page 1 of 1",
);

await page.screenshot({ path: path.join(scratch, "page-list.png") });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

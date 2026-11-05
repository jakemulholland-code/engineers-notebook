// Shared helpers for the end-to-end scripts. They drive the real Tauri app over
// WebView2's remote debugging port and only ever touch test-fixtures/_scratch.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const scratch = path.join(root, "test-fixtures", "_scratch");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function checker() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    return failed;
  };
  return { check, finish };
}

export async function connect() {
  for (let i = 0; i < 180; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
      const page = browser.contexts()[0].pages()[0];
      await page.waitForSelector(".app", { timeout: 60_000 });
      return { browser, page };
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("Could not reach the WebView2 debugging port");
}

/** Creates a client folder through the app's own command and registers it as the only tab. */
export async function setupClient(page, name) {
  const client = path.join(scratch, name);
  fs.rmSync(client, { recursive: true, force: true });
  fs.mkdirSync(client, { recursive: true });
  await page.evaluate(
    ({ folder, name }) =>
      window.__TAURI_INTERNALS__.invoke("prepare_client_folder", {
        folder,
        name,
        colour: "#01C6A3",
        allowForeign: false,
      }),
    { folder: client, name },
  );
  const cfgPath = path.join(scratch, "appdata", "config.json");
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  cfg.tabs = [
    {
      id: `tab-${name}`,
      name,
      colour: "#01C6A3",
      folder: client,
      order: 0,
      archived: false,
      excludeFromAi: false,
    },
  ];
  cfg.lastOpened = {};
  cfg.general = {
    ...(cfg.general ?? {}),
    lockToGrid: true,
    gridSize: 20,
    inkColour: "#F4F7FF",
    strokeWidth: 4,
  };
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  await page.reload();
  await page.waitForSelector(`.tabs >> text=${name}`);
  return { client, notes: path.join(client, "notes"), pages: path.join(client, "notes", "pages") };
}

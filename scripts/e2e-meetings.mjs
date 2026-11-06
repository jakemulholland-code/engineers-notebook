// End-to-end check for meeting notes (pasted in from Granola) against the real Tauri app,
// including what the AI is sent. Uses the local mock of the AI providers.
//
// 1. Start the app with a scratch app-data folder, the mock AI host, a test keyring entry
//    and WebView2 remote debugging:
//      $env:ENGINEERS_NOTEBOOK_APP_DIR = "<repo>/test-fixtures/_scratch/appdata-meetings"
//      $env:ENGINEERS_NOTEBOOK_AI_HOST = "http://127.0.0.1:9455"
//      $env:ENGINEERS_NOTEBOOK_KEYRING_SERVICE = "engineers-notebook-e2e"
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//      npm run tauri dev
// 2. node scripts/e2e-meetings.mjs
//
// Uses only folders under test-fixtures/_scratch, never real client folders.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { startMockAi } from "./mock-ai.mjs";

const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, "test-fixtures", "_scratch");
const appData = process.env.ENGINEERS_NOTEBOOK_APP_DIR ?? path.join(scratch, "appdata-meetings");
const base = path.join(scratch, "clients-meetings");
const CLIENT = path.join(base, "Grade A");
const SECRET = path.join(base, "Secret");
const meetingsDir = path.join(CLIENT, "notes", "meetings");

const GRANOLA = `Weekly sync with Grade A
Thu 5 Nov 2026 · 10:00

## Summary
Agreed to move the facet audit to next sprint.

## Action items
- **Jake**: send the redirect map to Sam
- Sam: confirm the crawl budget`;

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
const meetingFiles = () =>
  fs.existsSync(meetingsDir) ? fs.readdirSync(meetingsDir).filter((n) => n.endsWith(".md")) : [];

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

const mock = await startMockAi(9455);
const browser = await connect();
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector(".app", { timeout: 60_000 });

// --- Two clients: one normal, one excluded from AI with a meeting of its own.
fs.rmSync(base, { recursive: true, force: true });
for (const [folder, name] of [
  [CLIENT, "Grade A"],
  [SECRET, "Secret"],
]) {
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
}
fs.mkdirSync(path.join(SECRET, "notes", "meetings"), { recursive: true });
fs.writeFileSync(
  path.join(SECRET, "notes", "meetings", "2026-11-04-board.md"),
  "# Board call\n\nSecret merger plans\n",
);
const cfgPath = path.join(appData, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-a",
    name: "Grade A",
    colour: "#01C6A3",
    folder: CLIENT,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
  {
    id: "tab-s",
    name: "Secret",
    colour: "#FF5C86",
    folder: SECRET,
    order: 1,
    archived: false,
    excludeFromAi: true,
  },
];
cfg.lastOpened = { tabId: "tab-a" };
cfg.ai = {
  provider: "openrouter",
  models: { openrouter: "mock/text-model" },
  customBaseUrl: "",
  lookAheadDays: 14,
  staleDays: 21,
  includeSnapshots: false,
  temperature: 0.3,
};
fs.mkdirSync(appData, { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
fs.rmSync(path.join(appData, "catch-up.json"), { force: true });
await page.reload();
await page.waitForSelector(".tabs >> text=Grade A");
await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("save_key", { provider: "openrouter", key: "test-key-WXYZ" }),
);

// --- Switch to Meetings: empty state opens the Add meeting form.
check("status bar has a Meetings switch", await page.isVisible(".view-switch >> text=Meetings"));
await page.click(".view-switch >> text=Meetings");
await page.waitForSelector(".meetings-sheet");
check(
  "no meetings yet shows the add form",
  await page.isVisible(".meeting-form >> text=Add meeting"),
);

// --- Paste Granola notes: title and date fill themselves in.
await page.evaluate((text) => {
  const ta = document.querySelector(".meeting-form textarea");
  ta.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  ta.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  );
}, GRANOLA);
await page.fill(".meeting-form textarea", GRANOLA);
check(
  "title filled from the paste",
  (await page.inputValue(".meeting-form input[type=text] >> nth=0")) === "Weekly sync with Grade A",
  await page.inputValue(".meeting-form input[type=text] >> nth=0"),
);
check(
  "date filled from the paste",
  (await page.inputValue(".meeting-form input[type=text] >> nth=1")) === "Thu 5 Nov 2026",
  await page.inputValue(".meeting-form input[type=text] >> nth=1"),
);
await page.click(".meeting-form >> text=Save meeting");
check(
  "saved as Markdown in notes/meetings",
  await waitFor(() => meetingFiles().includes("2026-11-05-weekly-sync-with-grade-a.md")),
  meetingFiles().join(),
);
const saved = fs.readFileSync(
  path.join(meetingsDir, "2026-11-05-weekly-sync-with-grade-a.md"),
  "utf8",
);
check("file keeps the notes as pasted", saved.includes("- **Jake**: send the redirect map to Sam"));
check(
  "reading view shows the notes",
  await page.isVisible(".meeting-text >> text=send the redirect map to Sam"),
);
check("bold renders as bold", await page.isVisible(".meeting-text li strong >> text=Jake"));
check(
  "switch shows the count",
  (await page.textContent(".view-switch button >> nth=1"))?.includes("(1)"),
);

// --- A second meeting, then edit it.
await page.click(".meetings-head >> text=Add meeting");
await page.fill(".meeting-form input[type=text] >> nth=0", "Kick-off");
await page.fill(".meeting-form input[type=text] >> nth=1", "28/10/2026");
await page.fill(".meeting-form textarea", "Scope: facets and redirects.");
await page.click(".meeting-form >> text=Save meeting");
await page.waitForSelector(".meeting-read >> text=Kick-off");
const order = await page.locator(".meeting-row .meeting-name").allTextContents();
check("newest first", order.join() === "Weekly sync with Grade A,Kick-off", order.join());
await page.click(".meeting-read >> text=Edit");
await page.fill(".meeting-form input[type=text] >> nth=0", "Project kick-off");
await page.click(".meeting-form >> text=Save changes");
check(
  "editing the title renames the file",
  await waitFor(
    () =>
      meetingFiles().includes("2026-10-28-project-kick-off.md") &&
      !meetingFiles().includes("2026-10-28-kick-off.md"),
  ),
  meetingFiles().join(),
);

// --- What the AI is sent.
await page.click('.toolbar >> text="Catch me up"');
await page.waitForSelector(".catch-up");
mock.reset();
let meetingRef = "";
mock.setMode({
  kind: "reply",
  fn: (system, userText) => {
    meetingRef = userText.match(/### \[(r\d+)\] Grade A › Weekly sync with Grade A/)?.[1] ?? "";
    return JSON.stringify({
      sections: [
        {
          title: "You might have forgotten",
          items: [
            { text: "Send the redirect map to Sam, agreed in the 5 Nov sync.", ref: meetingRef },
          ],
        },
      ],
    });
  },
});
await page.click(".foot-buttons .pill >> nth=0");
await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
  timeout: 30_000,
});
const sent = JSON.stringify(mock.requests.filter((r) => r.method === "POST").map((r) => r.body));
check(
  "meeting notes reach the AI",
  sent.includes("send the redirect map to Sam") && sent.includes("Meeting notes"),
);
check("excluded tab's meetings are not sent", !sent.includes("Secret merger plans"));
check("meeting has a ref", !!meetingRef, meetingRef);
check(
  "summary item links to the meeting",
  await page.isVisible(".catch-up-section >> text=Grade A meeting"),
);
check(
  "footnote counts meetings",
  (await page.textContent(".catch-up .footnote"))?.includes("Read 2 meetings in full"),
);

// Open the Pages view first, so following the link has to switch back.
await page.click(".catch-up .source-chip >> text=Grade A meeting");
check(
  "meeting link opens that meeting",
  await waitFor(
    async () => (await page.textContent(".meeting-read h2")) === "Weekly sync with Grade A",
  ),
);

// --- Excluding one meeting from the AI.
await page.click(".meeting-read label.include-ai");
check(
  "include switch saved to the file",
  await waitFor(() =>
    fs
      .readFileSync(path.join(meetingsDir, "2026-11-05-weekly-sync-with-grade-a.md"), "utf8")
      .includes("includeInAi: false"),
  ),
);
mock.reset();
mock.setMode({ kind: "ok" });
await page.click(".foot-buttons .pill >> nth=0");
await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
  timeout: 30_000,
});
const sent2 = JSON.stringify(mock.requests.filter((r) => r.method === "POST").map((r) => r.body));
check(
  "switched-off meeting is not sent",
  !sent2.includes("send the redirect map to Sam") && sent2.includes("Scope: facets and redirects."),
);
await page.keyboard.press("Escape");
await page.screenshot({ path: path.join(scratch, "meetings.png") });

// --- Delete goes to the Recycle Bin; Pages switch goes back.
await page.click(".meeting-row >> text=Project kick-off");
await page.click(".meeting-read >> text=Delete");
await page.click(".meeting-confirm >> text=Delete meeting");
check(
  "delete removes the file",
  await waitFor(() => !meetingFiles().includes("2026-10-28-project-kick-off.md")),
  meetingFiles().join(),
);
await page.click(".view-switch >> text=Pages");
check("Pages switch goes back", !(await page.isVisible(".meetings-sheet")));

await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("remove_key", { provider: "openrouter" }),
);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
await mock.close();
process.exit(failed.length ? 1 : 0);

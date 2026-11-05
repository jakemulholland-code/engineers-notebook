// Milestone 4 end-to-end check: keys, the four provider adapters, the catch-up
// panel and Ask, against the real app talking to a local mock of each API.
//
// Start the app with (PowerShell):
//   $env:ENGINEERS_NOTEBOOK_APP_DIR = "$PWD\test-fixtures\_scratch\appdata"
//   $env:ENGINEERS_NOTEBOOK_AI_HOST = "http://127.0.0.1:9455"
//   $env:ENGINEERS_NOTEBOOK_KEYRING_SERVICE = "engineers-notebook-e2e"
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//   npm run tauri dev *> test-fixtures\_scratch\app.log
// then: node scripts/e2e-m4.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checker, connect, scratch, sleep } from "./e2e-lib.mjs";
import { startMockAi } from "./mock-ai.mjs";

const { check, finish } = checker();
const mock = await startMockAi(9455);
const { browser, page } = await connect();
const KEYRING_SERVICE = "engineers-notebook-e2e";

// ---------- two clients: one normal, one excluded from AI ----------
const now = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOffset = (n) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const iso = now.toISOString();
const el = (id, text, x, y, date) => ({
  id,
  type: "text",
  text,
  w: 300,
  fontSize: 17,
  colour: "#F4F7FF",
  heading: false,
  x,
  y,
  rotation: 0,
  createdAt: iso,
  updatedAt: iso,
  ...(date ? { date: { kind: "due", date, includeInSummary: true, done: false } } : {}),
});

async function makeClient(name, title, elements) {
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
  const p = {
    schemaVersion: 1,
    id: `page-${name.replace(/\W/g, "")}`,
    title,
    createdAt: iso,
    updatedAt: iso,
    elements,
  };
  fs.writeFileSync(
    path.join(folder, "notes", "pages", `${ymd(now)}-page.page.json`),
    JSON.stringify(p, null, 2),
  );
  return folder;
}

const aiFolder = await makeClient("AI client", "Redirect plan", [
  el("send", "Send redirect map", 60, 140, dayOffset(-1)),
  el("audit", "Faceted navigation audit", 60, 240, dayOffset(4)),
  el("dev", "Check with dev", 600, 140),
]);
const secretFolder = await makeClient("Secret Client", "Confidential merger plan", [
  el("falcon", "Project Falcon launch", 60, 140, dayOffset(1)),
]);

const cfgPath = path.join(scratch, "appdata", "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
cfg.tabs = [
  {
    id: "tab-ai",
    name: "AI client",
    colour: "#01C6A3",
    folder: aiFolder,
    order: 0,
    archived: false,
    excludeFromAi: false,
  },
  {
    id: "tab-secret",
    name: "Secret Client",
    colour: "#FF5C86",
    folder: secretFolder,
    order: 1,
    archived: false,
    excludeFromAi: true,
  },
];
cfg.lastOpened = { tabId: "tab-ai" };
cfg.ai = {
  provider: "openrouter",
  models: {},
  customBaseUrl: "",
  lookAheadDays: 14,
  staleDays: 21,
  includeSnapshots: false,
  temperature: 0.3,
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
fs.rmSync(path.join(scratch, "appdata", "models-cache.json"), { force: true });
fs.rmSync(path.join(scratch, "appdata", "catch-up.json"), { force: true });
await page.reload();
await page.waitForSelector(".tabs >> text=AI client");
await page.waitForSelector("#page-title-input");

// ---------- helpers ----------
const keys = {};
const openSettingsAi = async () => {
  if (!(await page.isVisible(".side-panel"))) await page.click('button[aria-label="Settings"]');
  await page.click('.settings-nav >> text="AI"');
  await sleep(200);
};
const closeSettings = async () => {
  if (await page.isVisible(".side-panel")) await page.click('button[aria-label="Close settings"]');
  await sleep(150);
};
const openPanel = async () => {
  if (!(await page.isVisible(".catch-up"))) await page.click('.toolbar >> text="Catch me up"');
  await page.waitForSelector(".catch-up");
};
const summarise = async () => {
  await page.click(".foot-buttons .pill >> nth=0");
  await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
    timeout: 30_000,
  });
  await sleep(200);
};
const credentialTargets = () => {
  try {
    return execSync("cmdkey /list", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((l) => l.includes(KEYRING_SERVICE));
  } catch {
    return [];
  }
};
const lastCompletion = () => [...mock.requests].reverse().find((r) => r.method === "POST");

// Start clean: remove test keys a crashed earlier run may have left (test service only).
await page.evaluate(async () => {
  for (const provider of ["openrouter", "openai", "anthropic", "gemini", "custom"])
    await window.__TAURI_INTERNALS__.invoke("remove_key", { provider });
});

// ---------- each provider: key, models, test connection, summary ----------
const providers = [
  {
    id: "openrouter",
    label: "OpenRouter",
    model: "Mock Vision",
    auth: (h, k) => h.authorization === `Bearer ${k}` && h["x-title"] === "Engineer's Notebook",
  },
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-5-mock",
    auth: (h, k) => h.authorization === `Bearer ${k}`,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    model: "Claude Mock",
    auth: (h, k) => h["x-api-key"] === k && h["anthropic-version"] === "2026-10-21",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    model: "Gemini Mock",
    auth: (h, k) => h["x-goog-api-key"] === k,
  },
];

for (const p of providers) {
  await openSettingsAi();
  await page.selectOption('label.field:has-text("Provider") select', p.id);
  await sleep(300);
  const key = `test-${p.id}-${Math.random().toString(36).slice(2, 10)}WXYZ`;
  keys[p.id] = key;
  await page.fill(`input[aria-label="${p.label} API key"]`, key);
  await page.click('button:has-text("Save key")');
  await page.waitForSelector(".key-saved");
  check(
    `${p.label}: key saved shows only the last four`,
    (await page.innerText(".key-saved")).includes("••••WXYZ"),
  );
  await page.waitForSelector(`.model-row:has-text("${p.model}")`, { timeout: 15_000 });
  if (p.id === "openrouter") {
    check(
      "OpenRouter: image-capable models are flagged",
      await page.isVisible('.model-row:has-text("Mock Vision") .badge-images'),
    );
  }
  if (p.id === "openai")
    check(
      "OpenAI: non-chat models are filtered out",
      !(await page.isVisible('.model-row:has-text("embedding")')),
    );
  await page.click(`.model-row:has-text("${p.model}")`);
  await sleep(200);
  await page.click('button:has-text("Test connection")');
  await page.waitForSelector(".test-ok, .settings-section .form-error", { timeout: 15_000 });
  const testText = await page.innerText('.settings-section [role="status"]');
  check(
    `${p.label}: Test connection succeeds`,
    /Connected to .* in \d+ ms/.test(testText),
    testText,
  );
  check(`${p.label}: sends the key the provider's way`, p.auth(lastCompletion().headers, key));

  await closeSettings();
  await openPanel();
  mock.reset();
  await summarise();
  const sections = await page.locator(".catch-up-section h3").allInnerTexts();
  check(
    `${p.label}: returns a catch-up summary`,
    sections.includes("Do these first") && sections.includes("You might have forgotten"),
    sections.join(", "),
  );
  const sent = JSON.stringify(lastCompletion()?.body ?? {});
  check(
    `${p.label}: excluded tab never in the request`,
    !sent.includes("Falcon") && !sent.includes("Secret Client") && !sent.includes("Confidential"),
  );
  check(`${p.label}: dated item is in the request`, sent.includes("Send redirect map"));
  if (p.id === "anthropic")
    check("Anthropic: temperature is not sent", !("temperature" in lastCompletion().body));
  if (p.id === "openai")
    check(
      "OpenAI: uses max_completion_tokens and JSON mode",
      lastCompletion().body.max_completion_tokens > 0 &&
        lastCompletion().body.response_format?.type === "json_object",
    );
  if (p.id === "gemini")
    check(
      "Gemini: streams with alt=sse and JSON mime type",
      lastCompletion().path.includes(":streamGenerateContent") &&
        lastCompletion().body.generationConfig.responseMimeType === "application/json",
    );
  await page.click('button[aria-label="Close catch-up"]');
}

check(
  "invalid refs are dropped",
  await (async () => {
    await openPanel();
    const t = await page.innerText(".catch-up .footnote");
    return (
      t.includes("1 item without a valid link was left out") &&
      !(await page.isVisible('.catch-up li:has-text("Invented item")'))
    );
  })(),
);

// ---------- summary links ----------
await page.click('button[aria-label="Close catch-up"]');
await page.click(".tab.reminders");
await sleep(300);
await openPanel();
await page.click('.catch-up-section[data-tone="first"] .source-chip >> nth=0');
await page.waitForSelector("#page-title-input");
await sleep(500);
check(
  "summary chip opens the right page",
  (await page.inputValue("#page-title-input")) === "Redirect plan",
);
check(
  "and selects the element (Select tool active)",
  (await page.getAttribute('button[aria-label="Select"]', "aria-pressed")) === "true",
);
const selected = await page.evaluate(() => {
  const st = window.Konva?.stages?.[0];
  const tr = st?.findOne("Transformer");
  return tr?.nodes().map((n) => n.id()) ?? [];
});
check(
  "the flashed element is the dated one",
  selected.length === 1 && selected[0] === "send",
  JSON.stringify(selected),
);

// ---------- Ask about your notes ----------
await page.fill("#ask-notes", "What did I promise?");
await page.press("#ask-notes", "Enter");
await page.waitForSelector(".chat .turn.assistant:has-text('redirect map')", { timeout: 15_000 });
await sleep(300);
check(
  "Ask answers with a link back to the note",
  await page.isVisible(".chat .turn.assistant .source-chip"),
);
const chatReq = lastCompletion();
const chatSystem = chatReq.body.systemInstruction?.parts?.[0]?.text ?? "";
check(
  "Ask sends the notes and the question",
  chatSystem.includes("<notes>") && JSON.stringify(chatReq.body).includes("What did I promise?"),
);
check("Ask also leaves the excluded tab out", !JSON.stringify(chatReq.body).includes("Falcon"));

// ---------- errors map to plain messages ----------
await openSettingsAi();
await page.selectOption('label.field:has-text("Provider") select', "openrouter");
await closeSettings();
await openPanel();
const errorCase = async (m) => {
  mock.setMode({ kind: "status", once: true, ...m });
  await summarise();
  return (await page.innerText(".catch-up-error").catch(() => "")) || "";
};
let msg = await errorCase({ status: 401 });
check("401 says the key was not accepted", msg.includes("did not accept the API key"), msg);
msg = await errorCase({ status: 402 });
check("402 says there is no credit", msg.includes("no credit"), msg);
msg = await errorCase({ status: 429, retryAfter: 7 });
check("429 gives the provider's retry time", msg.includes("Try again in 7 seconds"), msg);
check(
  "and the retry button waits for it",
  /Try again in \d+s/.test(await page.innerText(".catch-up-error button")),
);
msg = await errorCase({ status: 404, message: "model not found" });
check("404 says the model was not found", msg.includes("could not find the model"), msg);
const before = mock.requests.length;
await sleep(1500);
check(
  "no automatic retry loop",
  mock.requests.length === before,
  `${mock.requests.length - before} extra requests`,
);

// ---------- Stop ----------
await sleep(6000); // let the retry countdown finish
mock.setMode({ kind: "slow" });
mock.reset();
await page.click(".foot-buttons .pill >> nth=0");
await page.waitForSelector(".catch-up-progress");
await sleep(900);
await page.click('.foot-buttons >> text="Stop"');
await page.waitForFunction(() => !document.querySelector(".catch-up-progress"), null, {
  timeout: 5000,
});
await sleep(500);
check("Stop ends the request without an error", !(await page.isVisible(".catch-up-error")));
check(
  "Stop closes the connection to the provider",
  mock.requests.some((r) => r.closedEarly),
);
mock.setMode({ kind: "ok" });

// ---------- non-JSON reply shows as text ----------
mock.setMode({ kind: "garbage" });
await summarise();
check(
  "a non-JSON reply is shown as written, not an error",
  (await page.isVisible(".catch-up .raw")) && !(await page.isVisible(".catch-up-error")),
);
mock.setMode({ kind: "ok" });
await summarise();

// ---------- custom provider, no key ----------
await openSettingsAi();
await page.selectOption('label.field:has-text("Provider") select', "custom");
await page.fill('input[placeholder="http://localhost:1234/v1"]', "http://127.0.0.1:9455/v1");
await page.click('.field:has-text("Base URL") button:has-text("Save")');
await page.waitForSelector('.model-row:has-text("gpt-5-mock")', { timeout: 15_000 });
await page.click('.model-row:has-text("gpt-5-mock")');
await page.click('button:has-text("Test connection")');
await page.waitForSelector(".test-ok, .settings-section .form-error", { timeout: 15_000 });
check("Custom (OpenAI-compatible) works without a key", await page.isVisible(".test-ok"));
check("custom provider sends no Authorization header", !lastCompletion().headers.authorization);

// ---------- keys: Credential Manager only, never in files or logs ----------
const targets = credentialTargets();
check(
  "keys are in Windows Credential Manager",
  ["openrouter", "openai", "anthropic", "gemini"].every((p) => targets.some((t) => t.includes(p))),
  targets.length,
);

const filesToScan = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else filesToScan.push(f);
  }
};
walk(scratch);
const leaks = filesToScan.filter((f) => {
  const t = fs.readFileSync(f, "latin1");
  return Object.values(keys).some((k) => t.includes(k));
});
check(
  "no key appears in any file, config or app log",
  leaks.length === 0,
  leaks.map((f) => path.relative(scratch, f)).join(", ") || `${filesToScan.length} files scanned`,
);
check(
  "the app log was scanned",
  filesToScan.some((f) => f.endsWith("app.log")),
);

// Remove the test keys again through the app.
for (const p of providers) {
  await page.selectOption('label.field:has-text("Provider") select', p.id);
  await page.waitForSelector(".key-saved");
  await page.click('.field button:has-text("Remove")');
  await page.waitForSelector(`input[aria-label="${p.label} API key"]`);
}
check(
  "Remove deletes keys from Credential Manager",
  credentialTargets().length === 0,
  credentialTargets().join(" | "),
);

await page.screenshot({ path: path.join(scratch, "m4-settings.png") });
await closeSettings();
await openSettingsAi();
await page.selectOption('label.field:has-text("Provider") select', "openrouter");
await closeSettings();
await openPanel();
await page.screenshot({ path: path.join(scratch, "m4-panel.png") });

await browser.close();
await mock.close();
process.exit(finish() ? 1 : 0);

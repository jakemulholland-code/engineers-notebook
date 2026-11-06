// Release check: an installed older version finds the newest published GitHub
// release, installs it from the in-app prompt and restarts on the new version.
// Run after publishing the newer release:  node scripts/e2e-update.mjs
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { checker, sleep } from "./e2e-lib.mjs";

const { check, finish } = checker();
const exe = path.join(process.env.LOCALAPPDATA, "Engineers Notebook", "engineers-notebook.exe");
const PORT = 9334;
const versionOf = (file) =>
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-Item '${file}').VersionInfo.ProductVersion`],
    { encoding: "utf8" },
  ).trim();
const running = () => {
  try {
    return execFileSync("tasklist", ["/FI", "IMAGENAME eq engineers-notebook.exe", "/NH"], {
      encoding: "utf8",
    }).includes("engineers-notebook.exe");
  } catch {
    return false;
  }
};

check("an installed copy exists", fs.existsSync(exe), exe);
const before = versionOf(exe);
console.log(`installed version before: ${before}`);

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      const p = b.contexts()[0]?.pages()[0];
      if (p) return { b, p };
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error("The installed app did not open");
}

// Open the installed app (remote debugging so the check can press the button).
const child = spawn(exe, [], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
});
child.unref();
let { b, p } = await connect();
await p.waitForSelector(".app", { timeout: 30_000 });

await p.waitForSelector(".update-notice", { timeout: 60_000 }).catch(() => null);
const notice = (await p.innerText(".update-notice").catch(() => "")) || "";
check(
  "the installed app offers the newer version",
  /Version 0\.1\.\d+ of Engineer.s Notebook is ready to install/.test(notice),
  notice,
);
await p.click('.update-notice button:has-text("Install and restart")');
await sleep(1500);

// The passive installer closes the app, installs and the app relaunches.
for (let i = 0; i < 120 && versionOf(exe) === before; i++) await sleep(1000);
const after = versionOf(exe);
check(
  "the installed program was replaced by the newer version",
  after !== before && after.startsWith("0.1."),
  `${before} -> ${after}`,
);

let reopened = false;
for (let i = 0; i < 60 && !reopened; i++) {
  reopened = running();
  if (!reopened) await sleep(1000);
}
check("the app restarted after updating", reopened);

// Read the version the running app reports in Settings > General.
try {
  await b.close().catch(() => undefined);
  ({ b, p } = await connect());
  await p.waitForSelector(".app", { timeout: 30_000 });
  await p.click('button[aria-label="Settings"]');
  await p.click('.settings-nav >> text="General"');
  await p.waitForSelector(`text=Version ${after}`, { timeout: 15_000 });
  check("Settings shows the new version", true, after);
  await p.screenshot({ path: path.join(process.env.TEMP, "engineers-notebook-updated.png") });
  await b.close();
} catch (e) {
  check("Settings shows the new version", false, String(e).split("\n")[0]);
}

process.exit(finish() ? 1 : 0);

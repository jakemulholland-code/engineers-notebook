// Milestone 3 end-to-end check: dates, the date popover and Reminders, against the real app.
// Start the app as described in README ("End-to-end checks"), then: node scripts/e2e-m3.mjs
import fs from "node:fs";
import path from "node:path";
import { checker, connect, scratch, setupClient, sleep } from "./e2e-lib.mjs";

const { check, finish } = checker();
const { browser, page } = await connect();
const { pages } = await setupClient(page, "Dates client");

// Expected dates, computed the same way the app does (local calendar days).
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const base = new Date();
base.setHours(0, 0, 0, 0);
const plus = (n) => ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
const nextMonday = plus((1 - base.getDay() + 7) % 7 || 7);

await page.click("text=New page");
await page.waitForSelector("#page-title-input");
await page.fill("#page-title-input", "Dates page");
await page.keyboard.press("Control+0");
await sleep(300);

const vp = await page.locator(".paper-viewport").boundingBox();
const at = (x, y) => ({ x: vp.x + x, y: vp.y + y });
const blur = () =>
  page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
const key = async (k) => {
  await blur();
  await page.keyboard.press(k);
  await sleep(150);
};
const click = async (x, y, opts) => {
  const p = at(x, y);
  await page.mouse.click(p.x, p.y, opts);
  await sleep(200);
};
const readPage = () => {
  const f = fs.readdirSync(pages).filter((n) => n.endsWith(".page.json"))[0];
  return JSON.parse(fs.readFileSync(path.join(pages, f), "utf8"));
};
const saved = async () => {
  await sleep(1300);
  return readPage();
};
const byText = (p, t) => p.elements.find((e) => e.type === "text" && e.text === t);
const popover = ".date-popover";

// ---------- add a date with D and a typed date ----------
await key("t");
await click(203, 203);
await page.keyboard.type("Send redirect map");
await page.keyboard.press("Escape");
await sleep(150);
await key("v");
await click(230, 212);
await key("d");
check("D opens the date popover", await page.isVisible(popover));
await page.fill(`${popover} input[type=text]`, "next mon");
check(
  "typed date is read back",
  (await page.innerText(".date-hint")).includes("Reads as"),
  await page.innerText(".date-hint"),
);
await page.keyboard.press("Enter");
let p = await saved();
let t = byText(p, "Send redirect map");
check(
  "typed 'next mon' saves a Due date",
  t?.date?.kind === "due" &&
    t.date.date === nextMonday &&
    t.date.includeInSummary === true &&
    t.date.done === false,
  JSON.stringify(t?.date),
);

// ---------- clicking the pill reopens it; edit kind, quick pick, summary flag ----------
await click(225, 246); // the pill sits ~10 px under the text
check("clicking the pill reopens the popover", await page.isVisible(popover));
await page.click(`${popover} [role=radio] >> text=Follow up`);
await page.click(`${popover} >> text=In 2 weeks`);
await page.uncheck(`${popover} .include input`);
await page.click(`${popover} >> text=Save date`);
p = await saved();
t = byText(p, "Send redirect map");
check(
  "edit: Follow up, in 2 weeks, excluded from summaries",
  t?.date?.kind === "follow_up" && t.date.date === plus(14) && t.date.includeInSummary === false,
  JSON.stringify(t?.date),
);

// ---------- invalid input is refused ----------
await key("d");
await page.fill(`${popover} input[type=text]`, "someday soon");
check("unrecognised date disables Save", await page.isDisabled(`${popover} >> text=Save date`));
await page.click(`${popover} >> text=Remove date`);
p = await saved();
check(
  "Remove date clears it",
  byText(p, "Send redirect map") && !byText(p, "Send redirect map").date,
);

// ---------- overdue date ----------
await key("d");
await page.fill(`${popover} input[type=text]`, "yesterday");
await page.keyboard.press("Enter");
p = await saved();
check(
  "yesterday saves as an overdue Due date",
  byText(p, "Send redirect map")?.date?.date === plus(-1),
);
check(
  "Reminders tab shows an overdue badge of 1",
  (await page.innerText(".tab.reminders .badge").catch(() => "")) === "1",
);

// ---------- box with a Waiting on date ----------
await key("r");
const a = at(603, 403);
const b = at(797, 497);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 6 });
await page.mouse.up();
await sleep(200);
await key("v");
await click(600, 450);
await key("d");
await page.click(`${popover} [role=radio] >> text=Waiting on`);
await page.click(`${popover} [aria-label="Show calendar"]`);
check("calendar opens", await page.isVisible(".calendar"));
await page.click(`${popover} >> text=Save date`);
p = await saved();
const box = p.elements.find((e) => e.type === "rect");
check(
  "Waiting on defaults to today",
  box?.date?.kind === "waiting_on" && box.date.date === plus(0),
  JSON.stringify(box?.date),
);

// ---------- checklist item date via right-click ----------
await key("t");
await page.click(".tool-options >> text=Checklist");
await click(903, 203);
await page.keyboard.type("Item one");
await page.keyboard.press("Enter");
await page.keyboard.type("Item two");
await page.keyboard.press("Escape");
await sleep(150);
await key("v");
await click(960, 212, { button: "right" });
check("right-click shows a context menu", await page.isVisible(".context-menu"));
await page.click(".context-menu >> text=Add date to this item");
await page.click(`${popover} >> text=Tomorrow`);
await page.click(`${popover} >> text=Save date`);
p = await saved();
let list = p.elements.find((e) => e.type === "checklist");
check(
  "checklist item carries its own date",
  list?.items[0].date?.date === plus(1) && !list.items[1].date && !list.date,
  JSON.stringify(list?.items.map((i) => i.date?.date ?? null)),
);
await page.screenshot({ path: path.join(scratch, "m3-page.png") });

// ---------- Reminders ----------
await page.click(".tab.reminders");
await page.waitForSelector(".reminders-sheet");
await sleep(300);
const groupText = async (g) =>
  (await page
    .locator(`.reminder-group[data-group="${g}"]`)
    .innerText()
    .catch(() => "")) || "";
check(
  "Overdue group lists the overdue note",
  (await groupText("overdue")).includes("Send redirect map"),
);
const tomorrowGroup =
  (await groupText("this_week")).includes("Item one") ||
  (await groupText("next_week")).includes("Item one");
check("checklist item listed under this week or next week", tomorrowGroup);
check(
  "Waiting on group shows days waited",
  (await groupText("waiting")).includes("Waiting since") &&
    (await groupText("waiting")).includes("(0 days)"),
);
check(
  "status bar counts items",
  (await page.innerText(".statusbar")).includes("3 items, 1 overdue"),
  await page.innerText(".statusbar"),
);
await page.screenshot({ path: path.join(scratch, "m3-reminders.png") });

await page.click(".segmented >> text=Waiting on");
await sleep(200);
const onlyWaiting = await page.locator(".reminder-group").count();
check(
  "kind filter narrows to one group",
  onlyWaiting === 1 && (await groupText("waiting")) !== "",
  onlyWaiting,
);
await page.click(".segmented >> text=All");
await sleep(200);

// Tick the checklist item from Reminders.
await page.click('input[aria-label="Mark done: Item one"]');
p = await saved();
list = p.elements.find((e) => e.type === "checklist");
check(
  "ticking in Reminders updates the source page file",
  list?.items[0].done === true && list.items[0].date?.done === true && !!list.items[0].date?.doneAt,
  JSON.stringify(list?.items[0]),
);
check(
  "done item leaves the list",
  !(await page.isVisible('input[aria-label="Mark done: Item one"]')),
);
await page.check(".show-done input");
await sleep(200);
check("Show done reveals it in Done", (await groupText("done")).includes("Item one"));
await page.click('input[aria-label="Mark done: Item one"]');
p = await saved();
list = p.elements.find((e) => e.type === "checklist");
check(
  "unticking reopens it",
  list?.items[0].done === false &&
    list.items[0].date?.done === false &&
    !list.items[0].date?.doneAt,
);

// Tick the overdue one: badge goes away.
await page.click('input[aria-label="Mark done: Send redirect map"]');
await sleep(300);
check("badge clears when nothing is overdue", !(await page.isVisible(".tab.reminders .badge")));
await page.click('input[aria-label="Mark done: Send redirect map"]');
await sleep(1300);

// Open page jumps back and selects the element.
await page.locator(".reminder-row", { hasText: "Waiting since" }).locator("text=Open page").click();
await page.waitForSelector("#page-title-input");
await sleep(400);
check(
  "Open page returns to the page",
  (await page.inputValue("#page-title-input")) === "Dates page",
);
check(
  "and switches to Select so the item is highlighted",
  (await page.getAttribute('button[aria-label="Select"]', "aria-pressed")) === "true",
);
await sleep(300);
await page.screenshot({ path: path.join(scratch, "m3-flash.png") });

// ---------- stale pages ----------
const staleTitle = "Old forgotten page";
const now = new Date().toISOString();
fs.writeFileSync(
  path.join(pages, "2026-09-01-old-forgotten-page.page.json"),
  JSON.stringify({
    schemaVersion: 1,
    id: "stale-1",
    title: staleTitle,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    elements: [],
  }),
);
await sleep(2600); // let the reminders cache be written before reloading
const cachePath = path.join(scratch, "appdata", "reminders-cache.json");
check(
  "reminders index cached in app data",
  fs.existsSync(cachePath) && JSON.parse(fs.readFileSync(cachePath, "utf8")).items.length >= 3,
);
await page.reload();
await page.waitForSelector(".tab.reminders");
await page.click(".tab.reminders");
await page.waitForSelector(".reminders-sheet");
await sleep(500);
check(
  "an old undated page shows under Not touched in 3 weeks",
  (await groupText("stale")).includes(staleTitle),
);
void now;

await browser.close();
process.exit(finish() ? 1 : 0);

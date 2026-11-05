# Engineer's Notebook: Build Spec

Nov 5, 2026 · @Jake

## Overview

Build a desktop notebook app that looks like an engineer's notebook (dark blue paper, white grid), stores notes as files in a folder per client, and uses an AI model to summarise what needs coming back to. It ships from a GitHub repo as an installable Windows app that can be pinned to the taskbar. The approved mockups are the visual reference: [Engineer's Notebook Mockups](https://claude.ai/artifact/CZkrbgpc2z77TZGNN4yrMd) (client page with date popover, Reminders, AI catch-up).

**Goals for v1**

- Tabs down the right side, one per client or project, plus a dedicated Reminders tab.
- A free-form page where you can draw, type, paste images and add shapes anywhere, with a lock-to-grid toggle.
- Any item can carry a date (Due, Follow up, Waiting on), feeding Reminders and the AI catch-up.
- Each client tab is tied to a folder on disk; the app creates a `notes` folder there and reads and writes pages from it.
- AI catch-up works with OpenRouter, OpenAI, Anthropic and Google Gemini, chosen in Settings.
- Export all notes, a client or a page as Markdown, PDF or both.

**Not in v1**

- Sync between machines, sharing or collaboration (the folders can live in OneDrive or Dropbox if needed).
- Handwriting recognition. Pen strokes are not read by the AI unless the optional page-snapshot feature in the AI section is turned on.
- A mobile app.

## Tech stack

Use Tauri 2 with a React and TypeScript front end. It gives real folder access, OS keychain storage for API keys and a small Windows installer, which a browser PWA cannot do reliably.

| Area | Choice | Why |
| --- | --- | --- |
| Desktop shell | Tauri 2 (Rust backend, WebView2 on Windows) | Native file system and dialogs, installer of a few MB, pins to the taskbar like any app. Electron is the fallback if Rust becomes a blocker. |
| Front end | React 18, TypeScript (strict), Vite | Standard, well supported by Tauri templates. |
| Canvas | Konva via `react-konva`, with `perfect-freehand` for pen strokes | MIT licensed and fully custom, so it can match the mockups exactly. Avoid tldraw (production use needs a licence key) and Excalidraw (hand-drawn look is hard to restyle). |
| App state | Zustand | Small, simple store for tabs, pages, tools and settings. |
| Files | `@tauri-apps/plugin-fs` and `plugin-dialog` | Folder picker per client, read and write page files. |
| Secrets | Rust `keyring` crate behind Tauri commands | API keys go in Windows Credential Manager, never in a JSON file or localStorage. |
| AI requests | Made from Rust with `reqwest` | Keeps the key out of the web view and avoids CORS problems with provider APIs. |
| PDF | `pdf-lib`, pages rendered from Konva at 2x | Runs locally, no print dialog needed. |
| Dates | `date-fns` | Parsing, formatting and week grouping in UK format. |
| Tests | Vitest for logic, Playwright optional for UI | Cover the file format, reminders grouping, exporters and AI adapters. |

Target Windows 10 and 11 first. Keep code cross-platform so a macOS build works later without rewrites.

## Repo structure and setup

Scaffold with `npm create tauri-app@latest` (React, TypeScript, Vite), name the repo `engineers-notebook`, and keep this layout:

```
engineers-notebook/
  CLAUDE.md                 # working rules for Claude Code (copy of the last section of this spec)
  SPEC.md                   # this spec, exported as Markdown
  README.md                 # install, dev and release steps
  src/
    app/                    # App shell, layout, routing between tabs, Reminders, Settings
    canvas/                 # Konva stage, tools, selection, snapping, paste handling
    components/             # Toolbar, Tabs, DatePopover, CatchUpPanel, SettingsPanel
    store/                  # Zustand stores: notebook, tools, settings
    model/                  # TypeScript types and schema validation for page files
    storage/                # Read and write client folders through Tauri commands
    reminders/              # Indexing dated items and grouping them
    ai/                     # Prompt building and the provider-agnostic client calls
    export/                 # Markdown and PDF exporters
    styles/                 # Design tokens (CSS variables) and fonts
  src-tauri/
    src/commands/           # fs helpers, keychain, ai_request, export writes
    tauri.conf.json
  .github/workflows/
    release.yml             # builds the Windows installer on a version tag
```

- Node 20 LTS, Rust stable, and the Tauri Windows prerequisites (WebView2 and the MSVC build tools).
- Scripts: `npm run tauri dev` for development, `npm run tauri build` for an installer, `npm test` for Vitest.
- ESLint and Prettier on, TypeScript `strict: true`. No `any` in the model or storage layers.
- Fonts are bundled locally in `src/styles/fonts` (Satoshi and Bricolage Grotesque) so the app works offline.

## Data model and files on disk

Each page is one JSON file inside the client's `notes` folder, so notes stay readable, back-up friendly and portable. The app keeps only its own config in the app data folder.

**Per client folder** (created when the folder is chosen in Settings; if `notes` already exists, use it):

```
<chosen folder>/notes/
  notebook.json                                   # tab name, colour, page order, schemaVersion
  pages/2026-10-28-faceted-navigation-audit.page.json
  assets/<sha256>.png                             # pasted and inserted images, de-duplicated by hash
```

**App config** at `%APPDATA%/engineers-notebook/config.json`: the list of tabs (id, name, colour, folder path, order, archived), general settings, export defaults and the chosen AI provider and model. API keys are never written here.

**Page file shape** (validate with `zod`; refuse to save, and open read-only, when `schemaVersion` is newer than the app knows):

```ts
type Page = {
  schemaVersion: 1;
  id: string; title: string;
  createdAt: string; updatedAt: string;        // ISO 8601
  elements: Element[];                         // drawn in array order
};

type Base = { id: string; x: number; y: number; rotation: number;
  createdAt: string; updatedAt: string; date?: DateTag };

type Element = Base & (
  | { type: "stroke"; tool: "pen" | "brush"; points: number[]; colour: string; width: number; opacity: number }
  | { type: "line" | "arrow"; points: [number, number, number, number]; colour: string; width: number }
  | { type: "rect" | "ellipse"; w: number; h: number; colour: string; width: number; dashed: boolean }
  | { type: "text"; text: string; w: number; fontSize: number; colour: string; heading: boolean }
  | { type: "checklist"; w: number; items: { id: string; text: string; done: boolean; date?: DateTag }[] }
  | { type: "image"; asset: string; w: number; h: number }   // asset = "assets/<sha256>.png"
);

type DateTag = { kind: "due" | "follow_up" | "waiting_on"; date: string; // YYYY-MM-DD
  includeInSummary: boolean; done: boolean; doneAt?: string };
```

**Saving rules**

- Autosave 800 ms after the last change, as an atomic write (temp file, then rename), keeping one `.bak` of the previous version.
- Watch each `notes` folder. If a page changes outside the app and has no unsaved edits, reload it; if it does, keep the in-app version and show a one-line notice.
- A tab whose folder is missing (drive unplugged, folder moved) shows a "Folder not found" state with a button to choose it again. Never create a new empty folder silently.
- File names: page created date plus a slug of the title. Renaming a page renames the file.

## Visual design

Match the mockups: Paramount Digital colours and fonts for the app chrome, and a dark blue sheet with a white grid for the paper. Put every value below in `src/styles/tokens.css` as CSS variables and use only those.

| Token | Value | Used for |
| --- | --- | --- |
| `--desk` | `#0C1332` | App background, toolbar, panels, popovers |
| `--paper` | `#163764` | Page background and the active tab |
| `--grid-minor` | `rgba(255,255,255,0.09)`, every 20 px | Small grid squares |
| `--grid-major` | `rgba(255,255,255,0.22)`, every 100 px | Bold grid every 5 squares |
| `--ink-white` | `#F4F7FF` | Default ink and body text on paper |
| `--mint` | `#01C6A3` | Active tool, primary buttons, selection outline |
| `--gold` | `#E8A828` | Due dates, Reminders tab |
| `--pink` | `#FF5C86` | Pink ink, overdue (lighter than brand raspberry so it reads on dark paper) |
| `--pale-blue` | `#8FB8FF` | Follow-up dates, pale blue ink |
| `--text` | `#E9EDFD` | Chrome text |
| `--text-muted` | `#B9C6E6` | Secondary text (passes 4.5:1 on `--desk` and `--paper`) |

- **Type:** Bricolage Grotesque 600 for page titles and panel headings; Satoshi 400 and 700 for everything else, including typed notes.
- **Layout:** toolbar across the top (wraps on narrow windows); ring binding down the left edge of the paper; tabs down the right edge with the active tab the same colour as the paper so it joins it; status bar at the bottom (page x of y, grid state, saved state, zoom).
- **Shape:** 12 px radius on toolbar groups, pill buttons, 18 px radius popovers, 44 px minimum hit targets, visible mint focus ring.
- **Paper size:** a page is a fixed sheet of 1600 × 1100 px in page coordinates; the view pans and zooms (25% to 300%) over it. The grid is drawn on the stage so it scales with zoom.
- No emoji in the UI; icons are inline stroke SVGs (Phosphor style), 20 px.

## Canvas tools

Every tool works anywhere on the page, and every element can be selected, moved, resized, rotated, dated and deleted.

| Tool | Key | Behaviour |
| --- | --- | --- |
| Select | V | Click to select, drag for a marquee, Shift to add. Handles to resize and rotate. Double-click text to edit. |
| Pen | P | Pressure-aware freehand stroke via `perfect-freehand`; pressure from a pen or tablet when available. |
| Paint brush | B | Wider, 40% opacity stroke for highlighting and shading, drawn under text. |
| Line | L | Straight line; Shift locks to 0, 45 and 90 degrees. |
| Arrow | A | Line with an arrowhead at the end. |
| Box | R | Rectangle; toggle solid or dashed outline in a small flyout. |
| Circle | O | Ellipse; Shift for a circle. |
| Text | T | Click to place a text box and type. Flyout switches between Note, Heading and Checklist. |
| Image | I | Opens a file picker. Pasting (Ctrl+V) an image from the clipboard or dropping a file works with any tool active. |
| Eraser | E | Removes whole elements it touches (stroke-level erase, not pixel erase). |

**Toolbar extras:** five ink colours (white, mint, gold, pink, pale blue), three stroke widths (2, 4, 8 px), undo and redo (Ctrl+Z, Ctrl+Y, at least 100 steps per page), and the Catch me up button.

**Lock to grid** (toolbar toggle, G key, on by default and remembered):

- When on, element positions and the start and end points of lines, arrows, boxes and circles snap to the 20 px grid. Moves and resizes snap too.
- Freehand strokes are never snapped point by point; only their position snaps when moved.
- Holding Alt while drawing or dragging temporarily ignores the grid.

**Paste and other shortcuts**

- Ctrl+V with an image saves it to `assets/` (PNG, de-duplicated by hash) and places it at the cursor, scaled down to at most 800 px wide.
- Ctrl+V with plain text creates a text box at the cursor.
- Delete removes, Ctrl+D duplicates, Ctrl+A selects all, arrow keys nudge by one grid square (Shift for 1 px), Ctrl+0 resets zoom, Space-drag or middle-drag pans, Ctrl+scroll zooms.

## Tabs and pages

One tab per client or project, each bound to a folder; the Reminders tab is built from all of them and has no folder of its own.

- **Tab list:** right edge, in the order set in Settings (drag to reorder there or directly on the tabs). Each shows a colour marker and name. Reminders sits below a gap with a badge counting overdue items. A dashed New tab button at the bottom opens the add-client flow in Settings.
- **Right-click a tab:** rename, change colour, open folder in Explorer, archive. Archived tabs disappear from the side but their files are untouched.
- **Pages:** each tab holds many pages. The status bar has previous and next page buttons and "Page 2 of 4". A page list (Ctrl+P or clicking the page count) shows titles and last-edited dates, with New page, rename, duplicate and delete. Delete moves the file to the Windows Recycle Bin, never a hard delete.
- **New page:** gets today's date in the title area ("Page started Thu 5 Nov 2026") and an editable title.
- **Startup:** reopen the last tab and page. First run with no tabs shows an empty state pointing to Settings to add a client folder.
- **Search (v1.1, optional):** Ctrl+F searches text and checklist items across all tabs.

## Dates and Reminders

Any element or checklist item can carry one date, and the Reminders tab lists every dated item across all client folders.

**Adding a date**

- Select an element and press D, or use "Add date" in its right-click menu. This opens the Date this item popover from the mockup.
- Popover fields: kind (Due, Follow up, Waiting on), a date field that accepts typed UK dates ("12/11", "thu", "next mon") plus a calendar, quick picks (Tomorrow, Next Monday, In 2 weeks), "Include in catch-up summaries" (on by default), Remove date and Save date.
- A saved date shows as a pill under or beside the element: gold for Due, pale blue for Follow up, grey for Waiting on, pink once overdue. Clicking the pill reopens the popover.
- Ticking a checklist item that has a date marks the date done.

**Reminders tab**

- Built by scanning every page file on startup and updating live as pages change; cache the index in app data so startup stays fast.
- Groups, in this order: Overdue, This week (to Sunday), Next week, Later, Waiting on others (shows days waited), and Not touched in 3 weeks.
- "Not touched in 3 weeks" lists pages with no open dated items whose `updatedAt` is over 21 days old, so forgotten work surfaces even without a date.
- Each row: checkbox (marks done in the source page), item text (first 120 characters), source tab colour and name, date pill, and Open page, which jumps to the page and flashes the element.
- Filters: All tabs, Due, Follow up, Waiting on, and a Show done toggle.
- The overdue count also shows as a badge on the Reminders tab and, optionally, the Windows taskbar icon.

## AI catch-up and providers

The Catch me up button sends a compact summary of dated items and recent notes to the chosen model and shows the answer in the slide-over panel from the mockup. One provider-agnostic interface sits in front of four adapters, with OpenRouter as the default.

**Provider adapters** (all requests made from Rust, key read from the keychain at call time):

| Provider | Endpoint | Auth | Model list |
| --- | --- | --- | --- |
| OpenRouter (default) | `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI chat format) | `Authorization: Bearer <key>`, plus `HTTP-Referer` and `X-Title: Engineer's Notebook` | `GET /api/v1/models` |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` | `Authorization: Bearer <key>` | `GET /v1/models` |
| Anthropic | `POST https://api.anthropic.com/v1/messages` | `x-api-key: <key>`, `anthropic-version: 2023-06-01` | `GET /v1/models` |
| Google Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key: <key>` | `GET /v1beta/models` |
| Custom (OpenAI-compatible) | User-supplied base URL | Optional bearer key | `GET {base}/models` |

```ts
interface AiProvider {
  id: "openrouter" | "openai" | "anthropic" | "gemini" | "custom";
  listModels(): Promise<{ id: string; name: string; contextLength?: number; vision?: boolean }[]>;
  complete(req: { system: string; messages: { role: "user" | "assistant"; content: string; images?: string[] }[];
    maxTokens: number; temperature: number; json?: boolean;
    onText?: (fullTextSoFar: string) => void; signal?: AbortSignal }): Promise<string>;
}
```

- Fetch model lists from each provider rather than hardcoding names, since they change often. Cache the list for 24 hours and allow typing a model id by hand.
- Stream responses (server-sent events) for all four; the Rust command forwards chunks to the front end as Tauri events. Provide a Stop button.
- Map errors to plain messages: bad key, no credit, rate limited (retry after the time the provider gives, never in a loop), model not found, network down.

**What gets sent**

- Today's date, the look-ahead window and tab filter from the panel.
- Every open dated item with `includeInSummary: true`: tab, page title, item text, kind, date, days overdue or waited.
- Pages edited in the last 30 days: their text and checklist content, trimmed to stay under about 30,000 characters, newest first.
- Pages over 21 days untouched with no date, title and first 300 characters only.
- Each item carries a short `ref` (tab id, page id, element id) so answers can link back.
- Tabs with "Exclude from AI" switched on in Settings are left out entirely.
- Optional, off by default: snapshots of up to 5 recently edited pages as PNG, only when the chosen model accepts images, so handwriting and diagrams can be read.

**What comes back**

- Ask for JSON only: `{ "sections": [{ "title": string, "items": [{ "text": string, "ref": string }] }] }` with the sections Do these first, Coming up, You might have forgotten, Waiting on others.
- Validate against a schema; drop any item whose `ref` does not exist; if parsing fails, show the raw text instead of an error.
- Render each item with a chip that opens the source page and flashes the element.
- "Ask about your notes" at the bottom of the panel sends the same context plus the conversation so far. Keep the last summary and its time in app data; only call the model when the user asks.

## Settings panel

Settings opens from a gear button at the right of the toolbar (Ctrl+,) as a full-height panel styled like the catch-up panel, with four sections down its left side.

**Clients and folders**

- A list of tabs: colour, name, folder path, an "Exclude from AI" switch, and Open folder, Change folder, Archive.
- Add client: name, colour (the five ink colours plus a custom picker), then Choose folder (native folder dialog). On confirm, create `<folder>/notes`, `pages/`, `assets/` and `notebook.json` if missing, and show the final path, for example `D:/Clients/Grade A Technology/notes`.
- If the chosen folder already has a `notes` folder from this app, load it as is. If it has an unrelated `notes` folder, ask before writing into it.
- Change folder offers Move existing notes (copy then verify, then remove the old copy) or Point at the new folder only.
- Drag rows to reorder tabs.

**AI**

- Provider dropdown: OpenRouter, OpenAI, Anthropic, Google Gemini, Custom (OpenAI-compatible, with a base URL field).
- API key field per provider, masked, saved to Windows Credential Manager. Show only "Key saved" and the last 4 characters afterwards, with Replace and Remove.
- Model picker filled from the provider's model list, searchable, with a "Type a model id" fallback. Flag models that accept images.
- Test connection button: sends a tiny prompt and reports success, latency, or the plain error.
- Options: look-ahead window (default 2 weeks), stale page threshold (default 21 days), include page snapshots (off), temperature (default 0.3).
- A short line stating that notes from included tabs are sent to the chosen provider when you use Catch me up.

**Export**

- Default format: Markdown, PDF or both. Default destination folder. Options for including images and including done items.
- Export now buttons are in the export dialog described in the next section.

**General**

- Grid size (default 20 px), lock to grid on by default, default ink colour and stroke width.
- Start with Windows (off), check for updates on launch (on).
- Date format (UK `ddd d MMM yyyy`), week starts Monday.
- Backup: open app data folder, and export app config as JSON so the setup can be moved to another PC.

## Export

Export writes Markdown, PDF or both for all notes, one client, or the current page, into a dated folder in the chosen destination.

**Export dialog** (File menu, or Ctrl+Shift+E): scope (All tabs, This tab, This page), format (Markdown, PDF, Both), destination folder (defaults from Settings), include images, include done items. Shows progress and ends with Open folder.

**Output layout**

```
<destination>/notebook-export-2026-11-05/
  Grade A Technology/
    2026-10-28-faceted-navigation-audit.md
    2026-10-28-faceted-navigation-audit.pdf
    assets/
  Reminders.md
  Reminders.pdf
```

**Markdown**

- Front matter: title, tab, created, updated.
- A page snapshot image first (`![Page snapshot](assets/<page>-snapshot.png)`), because drawings have no text form.
- Then the text in reading order (sort elements top to bottom, then left to right, grouping elements whose tops are within 20 px): headings as `##`, notes as paragraphs, checklists as `- [ ]` and `- [x]`.
- Dates inline after the item, for example `- [ ] Brief dev on noindex vs canonical (Follow up: 2026-11-12)`.
- Pasted images copied to `assets/` and linked where they sit in reading order.
- `Reminders.md` lists the Reminders groups as task lists.

**PDF**

- One PDF page per notebook page, landscape A4, rendered from Konva at 2x so text and lines stay sharp, keeping the dark blue paper and grid exactly as on screen.
- A slim header with tab name, page title and created date; page numbers in the footer.
- When exporting a whole tab or all tabs, also write a combined PDF per tab with a contents page.
- Add a "Printer friendly" option (white paper, light blue grid, dark ink) since full dark pages use a lot of toner.

## Build, install and releases

Pushing a version tag builds a Windows installer on GitHub; installing it adds the app to the Start menu, where it can be pinned to the taskbar.

1. Create the GitHub repo `engineers-notebook` and push the scaffold.
2. Add `.github/workflows/release.yml` using `tauri-apps/tauri-action` on `windows-latest`, triggered by tags matching `v*`. It builds the NSIS `.exe` installer and attaches it to a draft GitHub Release.
3. Generate an updater signing key (`npm run tauri signer generate`), store it as the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and enable `@tauri-apps/plugin-updater` pointing at the release's `latest.json`.
4. Install from the release. Windows SmartScreen will warn because the installer is not code-signed; choose More info, then Run anyway. A code-signing certificate removes this later if needed.
5. Open the app, right-click its taskbar icon, Pin to taskbar.

Notes:

- The app icon is a notebook outline in mint on Oxford blue, supplied at all the sizes `tauri icon` generates.
- Single instance only (`tauri-plugin-single-instance`): launching again focuses the open window.
- Remember window size, position and maximised state.
- If the repo stays private, the built-in updater cannot read release files without a token. Either keep releases in a small public repo, or skip auto-update and install new versions by hand.

## Milestones and acceptance criteria

Build in six milestones, each ending with a working app and a commit; do not start the next until the criteria pass.

### M1: Shell and storage

- [ ] Tauri app opens with the toolbar, ring binding, grid paper and right-hand tabs styled to the tokens.
- [ ] Settings can add a client, pick a folder and create `notes/`, `pages/`, `assets/`, `notebook.json`.
- [ ] Pages save and reload from disk; autosave is atomic and keeps a `.bak`.
- [ ] Unit tests cover the page schema and reading an unknown future version as read-only.

### M2: Canvas tools

- [ ] All ten tools work as described, with selection, resize, rotate, undo and redo.
- [ ] Lock to grid snaps shapes, lines, text and moves to 20 px; Alt overrides.
- [ ] Pasting an image and pasting text both place content at the cursor; images land in `assets/`.
- [ ] Pan and zoom from 25% to 300% stays smooth on a page with 500 strokes.

### M3: Dates and Reminders

- [ ] Date popover adds, edits and removes dates on any element or checklist item.
- [ ] Reminders groups match the spec for a fixture set of dates around a fixed "today" (tested).
- [ ] Ticking an item in Reminders updates the source page file.

### M4: AI

- [ ] Keys save to Credential Manager and never appear in any file or log.
- [ ] OpenRouter, OpenAI, Anthropic and Gemini each pass Test connection and return a catch-up summary.
- [ ] Summary links open the right page and flash the right element; invalid refs are dropped.
- [ ] Excluded tabs never appear in the request payload (tested by inspecting the built payload).

### M5: Export

- [ ] Markdown and PDF export for page, tab and all scopes, matching the output layout.
- [ ] Exported PDF visually matches the screen; printer-friendly option works.

### M6: Release

- [ ] Tagging `v0.1.0` produces an installer on GitHub Releases.
- [ ] Installed app pins to the taskbar, runs as a single instance and updates from a newer tag.

## Notes for Claude Code

Copy this section into `CLAUDE.md` at the repo root.

- Work milestone by milestone. At the end of each, run the tests and the app, list what passed against the acceptance criteria, and commit with a clear message.
- Treat the user's notes folders as precious: never delete, overwrite or move user files except through the explicit flows in this spec. Use fixture folders under `test-fixtures/` for development and tests, never real client folders.
- Never log, print or commit API keys. Add `.env*` and any local config to `.gitignore`.
- Check the current docs for Tauri 2 plugins and each AI provider's API before writing adapters; endpoints and headers in this spec are the starting point, not a guarantee.
- Keep the visual tokens in one file and match the mockups: [Engineer's Notebook Mockups](https://claude.ai/artifact/CZkrbgpc2z77TZGNN4yrMd).
- Use UK English in all UI text (colour, organise, summarise) and sentence case for buttons and labels.
- When something in this spec is unclear or turns out to be impractical, stop and ask rather than guessing, and suggest the simplest option.

**Open questions to confirm before M1**

- Windows only for now, or should macOS builds run in CI from the start?
- Should the repo be public (simplest auto-updates) or private (manual updates)?
- Is the "Internal tools" tab a normal client folder, or a default folder inside app data?

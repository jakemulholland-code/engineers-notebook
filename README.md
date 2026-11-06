# Engineer's Notebook

A desktop notebook for client work. It looks like an engineer's notebook (dark blue paper, white grid), keeps each client's pages as JSON files in that client's own folder, and (from milestone 4) uses an AI model to summarise what needs coming back to.

Built with Tauri 2, React 18, TypeScript and Konva. See [SPEC.md](SPEC.md) for the full spec and [CLAUDE.md](CLAUDE.md) for working rules.

## Status

| Milestone | State |
| --- | --- |
| M1 Shell and storage | Done |
| M2 Canvas tools | Done |
| M3 Dates and Reminders | Done |
| M4 AI | Done (tested against a local mock of each API; check each real provider with your own key) |
| M5 Export | Done |
| M6 Release | Done (v0.1.0 and v0.1.1 published; in-app update from 0.1.0 to 0.1.1 tested) |

## Prerequisites

- Node 20 LTS or newer
- Rust stable
- Windows: WebView2 (built into Windows 10 and 11) and the MSVC build tools ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Development

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run dev` runs the front end alone in a browser with an in-memory stand-in for the file system. It is useful for styling work and never touches disk.

### Tests

```bash
npm test
```

```bash
npm run test:rust
```

### End-to-end checks

`e2e:m1` covers storage, `e2e:m2` covers every canvas tool, paste and drop, undo and redo, and pan and zoom timing on a 500-stroke page, and `e2e:m3` covers dates and Reminders. They run against the real app using scratch folders under `test-fixtures/_scratch` (git-ignored). In PowerShell:

```powershell
$env:ENGINEERS_NOTEBOOK_APP_DIR = "$PWD\test-fixtures\_scratch\appdata"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
npm run tauri dev
```

Then in a second terminal:

```bash
npm run e2e:m1
```

```bash
npm run e2e:m2
```

```bash
npm run e2e:m3
```

`e2e:m4` drives the AI features against `scripts/mock-ai.mjs`, a local server that speaks the OpenRouter, OpenAI, Anthropic and Gemini wire formats. Start the app with these extra variables first, so dev builds point at the mock and use a separate Credential Manager entry (they have no effect in release builds):

```powershell
$env:ENGINEERS_NOTEBOOK_AI_HOST = "http://127.0.0.1:9455"
$env:ENGINEERS_NOTEBOOK_KEYRING_SERVICE = "engineers-notebook-e2e"
npm run tauri dev *> test-fixtures\_scratch\app.log
```

```bash
npm run e2e:m4
```

`e2e:m5` covers export (every scope and format, PDF page sizes and contents pages, a pixel comparison between the exported page and the live canvas, printer-friendly colours) and AI page snapshots. Start the app as for `e2e:m4`, then:

```bash
npm run e2e:m5
```

`e2e:pages` covers the page list (Ctrl+P or the page count): open, rename, duplicate and delete. Deleted pages go to the Windows Recycle Bin, and the script checks they arrive there. Start the app as for `e2e:m1` but with `ENGINEERS_NOTEBOOK_APP_DIR` set to `test-fixtures\_scratch\appdata-pages`, then:

```bash
npm run e2e:pages
```

`e2e:watch` edits, adds and removes page files on disk while the app is open, as OneDrive, Dropbox or another editor would, and checks the app follows along and keeps unsaved edits. Start the app with `ENGINEERS_NOTEBOOK_APP_DIR` set to `test-fixtures\_scratch\appdata-watch`, then:

```bash
npm run e2e:watch
```

## Export

Export (toolbar button or Ctrl+Shift+E) writes Markdown, PDF or both for all tabs, one tab or the current page into a new `notebook-export-<date>` folder in the chosen destination (`-2`, `-3` and so on if one already exists, so nothing is overwritten):

```
notebook-export-2026-11-05/
  Grade A Technology/
    2026-10-28-faceted-navigation-audit.md
    2026-10-28-faceted-navigation-audit.pdf
    Grade A Technology - all pages.pdf      (tab and all-tabs exports: contents page first)
    assets/
  Reminders.md
  Reminders.pdf
```

Pages are drawn by the same components as the live canvas, at 2x, on landscape A4. Printer friendly swaps to white paper, a light blue grid and dark ink. Defaults live in Settings › Export.

## AI providers

Choose a provider, paste a key and pick a model in Settings › AI. Keys go to Windows Credential Manager (entry `engineers-notebook`), never to a file. Requests are made from the Rust side, so keys never reach the web view.

| Provider | Notes |
| --- | --- |
| OpenRouter (default) | Models list shows which accept images. |
| OpenAI | Sends `max_completion_tokens`; if a model refuses `temperature`, the request is retried once without it. |
| Anthropic | API version `2026-10-21`, which does not accept `temperature`, so it is not sent. |
| Google Gemini | `streamGenerateContent` with SSE and JSON output. |
| Custom | Any OpenAI-compatible server (LM Studio, Ollama). Key optional. |

`ENGINEERS_NOTEBOOK_APP_DIR` points the app at a different config folder than `%APPDATA%\engineers-notebook`. Use it for any dev run so your real setup is left alone.

## Files on disk

Each client folder gets a `notes` folder:

```
<client folder>/notes/
  notebook.json
  pages/2026-10-28-faceted-navigation-audit.page.json
  assets/<sha256>.png
```

Pages save 800 ms after the last change, as an atomic write (temp file, then rename), keeping one `.bak` of the previous version. App settings live in `%APPDATA%\engineers-notebook\config.json`. API keys will go in Windows Credential Manager, never in a file.

## Install

Download `Engineers.Notebook_<version>_x64-setup.exe` from the [latest release](https://github.com/jakemulholland-code/engineers-notebook/releases/latest) and run it. Windows SmartScreen warns because the installer is not code-signed: choose **More info**, then **Run anyway**. Then open the app from the Start menu, right-click its taskbar icon and choose **Pin to taskbar**.

The app checks for new versions when it opens (Settings › General › Check for updates on launch) and offers **Install and restart**.

## Releasing a new version

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then tag and push:

```bash
git tag v0.1.1
```

```bash
git push origin main --tags
```

3. The `release` workflow builds the installer on `windows-latest`, signs the updater files and attaches everything, including `latest.json`, to a **draft** release.
4. Check the draft, then publish it. Installed apps only see published releases.
5. Optional: with an older version installed, `npm run e2e:update` opens it, accepts the update prompt and checks it restarts on the new version.

### Updater signing key

Updates are signed. The private key and its password were generated on Jake's machine at `%USERPROFILE%\.tauri\engineers-notebook.key` (password in `engineers-notebook.key.password.txt` beside it) and stored as the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a copy of both in a password manager: if the key is lost, installed copies can no longer be updated and everyone has to reinstall by hand. The public key is in `src-tauri/tauri.conf.json`.

To build an installer locally without releasing:

```bash
npm run tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`.

# Engineer's Notebook

A desktop notebook for client work. It looks like an engineer's notebook (dark blue paper, white grid), keeps each client's pages as JSON files in that client's own folder, and (from milestone 4) uses an AI model to summarise what needs coming back to.

Built with Tauri 2, React 18, TypeScript and Konva. See [SPEC.md](SPEC.md) for the full spec and [CLAUDE.md](CLAUDE.md) for working rules.

## Status

| Milestone | State |
| --- | --- |
| M1 Shell and storage | Done |
| M2 Canvas tools | Done |
| M3 Dates and Reminders | Done |
| M4 AI | Not started |
| M5 Export | Not started |
| M6 Release | Not started |

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

## Build an installer

```bash
npm run tauri build
```

The NSIS installer lands in `src-tauri/target/release/bundle/nsis/`. Release automation through GitHub Actions comes in milestone 6.

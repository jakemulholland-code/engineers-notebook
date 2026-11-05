# Notes for Claude Code

Copied from the last section of [SPEC.md](SPEC.md).

- Work milestone by milestone. At the end of each, run the tests and the app, list what passed against the acceptance criteria, and commit with a clear message.
- Treat the user's notes folders as precious: never delete, overwrite or move user files except through the explicit flows in this spec. Use fixture folders under `test-fixtures/` for development and tests, never real client folders.
- Never log, print or commit API keys. Add `.env*` and any local config to `.gitignore`.
- Check the current docs for Tauri 2 plugins and each AI provider's API before writing adapters; endpoints and headers in this spec are the starting point, not a guarantee.
- Keep the visual tokens in one file (`src/styles/tokens.css`) and match the mockups: [Engineer's Notebook Mockups](https://claude.ai/artifact/CZkrbgpc2z77TZGNN4yrMd).
- Use UK English in all UI text (colour, organise, summarise) and sentence case for buttons and labels.
- When something in this spec is unclear or turns out to be impractical, stop and ask rather than guessing, and suggest the simplest option.

## Decisions confirmed with Jake (5 Nov 2026)

- Windows only in CI for now; keep code cross-platform.
- The GitHub repo will be public, so the built-in updater can read releases.
- "Internal tools" is a normal client folder chosen in Settings, not a special app-data folder.
- The repo lives in this folder; the GitHub repo is named `engineers-notebook`.

## Working notes

- Dev runs: set `ENGINEERS_NOTEBOOK_APP_DIR` to a folder under `test-fixtures/_scratch` so the real `%APPDATA%` config is untouched.
- `npm run dev` (browser only) uses an in-memory backend in `src/storage/backend.ts`; the real app goes through the Rust commands in `src-tauri/src/commands/fs.rs`.
- Stroke `points` are flat `[x, y, pressure, ...]` triples relative to the element's `x`/`y` (the first point). Pressure 0.5 everywhere means a mouse, and perfect-freehand simulates pressure.
- Canvas performance rules (measured on a 3x-density screen with 500 strokes): keep Konva to two layers, cap `Konva.pixelRatio` at 2, never put pan/zoom in React state (`PaperStage` applies it to the stage and to CSS variables `--pan-x`, `--pan-y`, `--zoom`), keep the element node list memoised, and draw from a cached bitmap during wheel zoom.
- Dates: a "Waiting on" date is when the waiting started (the mockup shows "Waiting since Fri 30 Oct"), so Reminders shows days waited; Due and Follow up dates are deadlines. Typed dates are parsed in `src/reminders/dates.ts` (UK day/month order; a day and month with no year that fell more than two months ago means next year).
- Reminders are built in memory from every loaded page (`useReminderIndex`). The index is cached in app data as `reminders-cache.json` and shown at startup until every tab has loaded.
- Not built yet from the Saving rules: watching notes folders for changes made outside the app. Reminders update live for in-app edits only.
- React is pinned to 18 (as specced) with `react-konva` 18. TypeScript is pinned to 5.9 for tooling compatibility.

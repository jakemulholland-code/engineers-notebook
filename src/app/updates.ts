import { create } from "zustand";
import { backend } from "../storage/backend";
import { useNotebook } from "../store/notebook";

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none"; at: Date }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "installing"; percent: number | null }
  | { kind: "error"; message: string };

type UpdateStore = {
  state: UpdateState;
  dismissed: boolean;
  check(): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
};

let pending: Update = null;

/**
 * Checks GitHub Releases (latest.json) for a newer signed build and installs it
 * on request (SPEC: Build, install and releases).
 */
export const useUpdates = create<UpdateStore>((set, get) => ({
  state: { kind: "idle" },
  dismissed: false,

  async check() {
    if (!backend.isTauri || get().state.kind === "checking" || get().state.kind === "installing")
      return;
    set({ state: { kind: "checking" } });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      pending = await check({ timeout: 20_000 });
      set({
        state: pending
          ? { kind: "available", version: pending.version, notes: pending.body ?? undefined }
          : { kind: "none", at: new Date() },
        dismissed: false,
      });
    } catch (e) {
      set({ state: { kind: "error", message: `Could not check for updates: ${String(e)}` } });
    }
  },

  async install() {
    if (!pending) return;
    // Save anything waiting before the installer closes the app.
    await useNotebook.getState().flushSaves();
    let total = 0;
    let done = 0;
    set({ state: { kind: "installing", percent: null } });
    try {
      await pending.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          set({
            state: { kind: "installing", percent: total ? Math.round((done / total) * 100) : null },
          });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ state: { kind: "error", message: `The update could not be installed: ${String(e)}` } });
    }
  },

  dismiss() {
    set({ dismissed: true });
  },
}));

import { invoke } from "@tauri-apps/api/core";

/**
 * Thin, typed wrapper over the Rust file commands (src-tauri/src/commands/fs.rs).
 * When the UI runs in a plain browser (vite dev without Tauri), an in-memory
 * stand-in is used so the chrome can be previewed. It never touches disk.
 */
export type PrepareStatus = "created" | "existing" | "foreign";
export type PrepareResult = { status: PrepareStatus; notesPath: string };

export interface Backend {
  readonly isTauri: boolean;
  readAppConfig(): Promise<string | null>;
  writeAppConfig(contents: string): Promise<void>;
  appConfigPath(): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  prepareClientFolder(folder: string, name: string, colour: string, allowForeign: boolean): Promise<PrepareResult>;
  listPageFiles(notesPath: string): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  /** Renames a file; fails if the target exists. */
  renameFile(from: string, to: string): Promise<void>;
  openInExplorer(path: string): Promise<void>;
  /** Saves PNG bytes (base64) into `<notes>/assets`, de-duplicated; returns `assets/<sha256>.png`. */
  saveAsset(notesPath: string, pngBase64: string): Promise<string>;
  readAsset(notesPath: string, rel: string): Promise<ArrayBuffer>;
  chooseFolder(title: string): Promise<string | null>;
}

const tauriBackend: Backend = {
  isTauri: true,
  readAppConfig: () => invoke<string | null>("read_app_config"),
  writeAppConfig: (contents) => invoke("write_app_config", { contents }),
  appConfigPath: () => invoke<string>("app_config_path"),
  pathExists: (path) => invoke<boolean>("path_exists", { path }),
  prepareClientFolder: (folder, name, colour, allowForeign) =>
    invoke<PrepareResult>("prepare_client_folder", { folder, name, colour, allowForeign }),
  listPageFiles: (notesPath) => invoke<string[]>("list_page_files", { notesPath }),
  readTextFile: (path) => invoke<string>("read_text_file", { path }),
  writeTextAtomic: (path, contents) => invoke("write_text_atomic", { path, contents }),
  renameFile: (from, to) => invoke("rename_file", { from, to }),
  openInExplorer: (path) => invoke("open_in_explorer", { path }),
  saveAsset: (notesPath, dataBase64) => invoke<string>("save_asset", { notesPath, dataBase64 }),
  readAsset: (notesPath, rel) => invoke<ArrayBuffer>("read_asset", { notesPath, rel }),
  chooseFolder: async (title) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, multiple: false, title });
    return typeof r === "string" ? r : null;
  },
};

function createMemoryBackend(): Backend {
  const files = new Map<string, string>();
  const assets = new Map<string, ArrayBuffer>();
  const dirs = new Set<string>(["C:/Demo/Grade A Technology"]);
  let config: string | null = null;
  return {
    isTauri: false,
    readAppConfig: async () => config,
    writeAppConfig: async (c) => {
      config = c;
    },
    appConfigPath: async () => "(browser preview, not saved)",
    pathExists: async (p) => dirs.has(p) || files.has(p),
    prepareClientFolder: async (folder) => {
      const notesPath = `${folder}/notes`;
      const status: PrepareStatus = dirs.has(notesPath) ? "existing" : "created";
      dirs.add(folder);
      dirs.add(notesPath);
      dirs.add(`${notesPath}/pages`);
      return { status, notesPath };
    },
    listPageFiles: async (notesPath) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${notesPath}/pages/`) && k.endsWith(".page.json"))
        .map((k) => k.slice(`${notesPath}/pages/`.length))
        .sort(),
    readTextFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`File not found: ${p}`);
      return v;
    },
    writeTextAtomic: async (p, c) => {
      if (files.has(p)) files.set(`${p}.bak`, files.get(p) as string);
      files.set(p, c);
    },
    renameFile: async (from, to) => {
      if (files.has(to)) throw new Error(`A file named ${to} already exists`);
      const v = files.get(from);
      if (v === undefined) throw new Error(`File not found: ${from}`);
      files.delete(from);
      files.set(to, v);
    },
    openInExplorer: async () => undefined,
    saveAsset: async (notesPath, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const rel = `assets/${hex}.png`;
      assets.set(`${notesPath}/${rel}`, bytes.buffer);
      return rel;
    },
    readAsset: async (notesPath, rel) => {
      const v = assets.get(`${notesPath}/${rel}`);
      if (!v) throw new Error(`Asset not found: ${rel}`);
      return v;
    },
    chooseFolder: async () => window.prompt("Folder path (browser preview)", "C:/Demo/Grade A Technology"),
  };
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const backend: Backend = isTauri ? tauriBackend : createMemoryBackend();

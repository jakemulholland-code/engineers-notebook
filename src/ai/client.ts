import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AiProviderId } from "../model/config";
import { newId } from "../model/page";
import { backend } from "../storage/backend";

export type ModelInfo = { id: string; name: string; contextLength?: number; vision?: boolean };

export type CompleteRequest = {
  system: string;
  messages: { role: "user" | "assistant"; content: string; images?: string[] }[];
  maxTokens: number;
  temperature: number;
  json?: boolean;
  onText?: (fullTextSoFar: string) => void;
  signal?: AbortSignal;
};

/** The provider-agnostic interface from the spec. Requests themselves run in Rust. */
export interface AiProvider {
  id: AiProviderId;
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompleteRequest): Promise<string>;
}

export type AiErrorKind =
  | "bad_key"
  | "no_key"
  | "no_credit"
  | "rate_limited"
  | "model_not_found"
  | "network"
  | "busy"
  | "cancelled"
  | "bad_config"
  | "provider_error";

export class AiRequestError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
    public retryAfterSecs?: number,
  ) {
    super(message);
  }
}

function toError(e: unknown): AiRequestError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const x = e as { kind: AiErrorKind; message: string; retryAfterSecs?: number | null };
    return new AiRequestError(x.kind, x.message, x.retryAfterSecs ?? undefined);
  }
  return new AiRequestError("provider_error", String(e));
}

export function createProvider(
  id: AiProviderId,
  opts: { model: string; baseUrl?: string },
): AiProvider {
  const baseUrl = id === "custom" ? opts.baseUrl : undefined;
  return {
    id,
    async listModels() {
      if (!backend.isTauri) throw new AiRequestError("bad_config", "AI needs the desktop app.");
      try {
        const models = await invoke<
          { id: string; name: string; contextLength: number | null; vision: boolean }[]
        >("ai_list_models", { provider: id, baseUrl });
        return models.map((m) => ({ ...m, contextLength: m.contextLength ?? undefined }));
      } catch (e) {
        throw toError(e);
      }
    },
    async complete(req) {
      if (!backend.isTauri) throw new AiRequestError("bad_config", "AI needs the desktop app.");
      if (!opts.model) throw new AiRequestError("bad_config", "Choose a model in Settings first.");
      const requestId = newId();
      let full = "";
      const unlisten = await listen<{ requestId: string; text: string }>("ai-chunk", (e) => {
        if (e.payload.requestId !== requestId) return;
        full += e.payload.text;
        req.onText?.(full);
      });
      const onAbort = () => void invoke("ai_cancel", { requestId });
      req.signal?.addEventListener("abort", onAbort);
      try {
        if (req.signal?.aborted) throw new AiRequestError("cancelled", "Stopped.");
        return await invoke<string>("ai_complete", {
          request: {
            requestId,
            provider: id,
            baseUrl,
            model: opts.model,
            system: req.system,
            messages: req.messages.map((m) => ({ ...m, images: m.images ?? [] })),
            maxTokens: req.maxTokens,
            temperature: req.temperature,
            json: !!req.json,
          },
        });
      } catch (e) {
        throw toError(e);
      } finally {
        req.signal?.removeEventListener("abort", onAbort);
        unlisten();
      }
    },
  };
}

// ----- model list cache (24 hours, in app data) -----

const MODELS_FILE = "models-cache.json";
const DAY_MS = 24 * 60 * 60 * 1000;
type ModelCache = Record<string, { at: number; baseUrl?: string; models: ModelInfo[] }>;

async function readCache(): Promise<ModelCache> {
  try {
    const t = await backend.readAppFile(MODELS_FILE);
    return t ? (JSON.parse(t) as ModelCache) : {};
  } catch {
    return {};
  }
}

export async function listModelsCached(
  id: AiProviderId,
  baseUrl: string | undefined,
  force = false,
): Promise<{ models: ModelInfo[]; at: number }> {
  const cache = await readCache();
  const hit = cache[id];
  if (!force && hit && Date.now() - hit.at < DAY_MS && hit.baseUrl === baseUrl) return hit;
  const models = await createProvider(id, { model: "", baseUrl }).listModels();
  const entry = { at: Date.now(), baseUrl, models };
  await backend
    .writeAppFile(MODELS_FILE, JSON.stringify({ ...cache, [id]: entry }))
    .catch(() => undefined);
  return entry;
}

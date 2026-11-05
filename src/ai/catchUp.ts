import { create } from "zustand";
import { backend } from "../storage/backend";
import { useNotebook, visibleTabs } from "../store/notebook";
import { AiRequestError, createProvider, type AiErrorKind } from "./client";
import { buildCatchUpContext, type CatchUpContext, type Ref } from "./payload";
import { SUMMARY_SYSTEM, chatSystem } from "./prompts";
import { parseSummary, type ParsedSummary } from "./summary";

const SAVED_FILE = "catch-up.json";
const SUMMARY_MAX_TOKENS = 4000;
const CHAT_MAX_TOKENS = 1500;

export type SavedSummary = {
  at: string;
  tabId: string;
  lookAheadDays: number;
  provider: string;
  model: string;
  result: ParsedSummary;
  refs: Record<string, Ref>;
  stats: CatchUpContext["stats"];
};

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type PanelError = {
  kind: AiErrorKind;
  message: string;
  retryAfterSecs?: number;
  at: number;
};

type CatchUpStore = {
  open: boolean;
  loaded: boolean;
  saved: SavedSummary | null;
  tabId: string;
  lookAheadDays: number | null;
  running: null | { kind: "summary" | "chat"; chars: number };
  error: PanelError | null;
  chat: ChatTurn[];
  chatRefs: Record<string, Ref>;
  setOpen(open: boolean): void;
  setFilters(f: { tabId?: string; lookAheadDays?: number }): void;
  summarise(): Promise<void>;
  ask(question: string): Promise<void>;
  stop(): void;
};

let controller: AbortController | null = null;
let chatContext: CatchUpContext | null = null;

/** Builds the payload from what is loaded, honouring Exclude from AI. */
export function currentContext(tabId: string, lookAheadDays: number): CatchUpContext {
  const s = useNotebook.getState();
  const tabs = visibleTabs(s.config).flatMap((tab) => {
    const st = s.tabs[tab.id];
    return st?.status === "ok" ? [{ tab, pages: st.pages.map((p) => p.page) }] : [];
  });
  return buildCatchUpContext({
    tabs,
    now: new Date(),
    lookAheadDays,
    staleDays: s.config.ai.staleDays,
    tabId: tabId || undefined,
  });
}

function providerNow() {
  const ai = useNotebook.getState().config.ai;
  const model = ai.models[ai.provider] ?? "";
  return { ai, model, provider: createProvider(ai.provider, { model, baseUrl: ai.customBaseUrl }) };
}

function asPanelError(e: unknown): PanelError {
  const err = e instanceof AiRequestError ? e : new AiRequestError("provider_error", String(e));
  return {
    kind: err.kind,
    message: err.message,
    retryAfterSecs: err.retryAfterSecs,
    at: Date.now(),
  };
}

export const useCatchUp = create<CatchUpStore>((set, get) => ({
  open: false,
  loaded: false,
  saved: null,
  tabId: "",
  lookAheadDays: null,
  running: null,
  error: null,
  chat: [],
  chatRefs: {},

  setOpen(open) {
    set({ open });
    if (open && !get().loaded) {
      set({ loaded: true });
      void backend
        .readAppFile(SAVED_FILE)
        .then((t) => {
          if (!t || get().saved) return;
          const saved = JSON.parse(t) as SavedSummary;
          set({ saved, tabId: saved.tabId, lookAheadDays: saved.lookAheadDays });
        })
        .catch(() => undefined);
    }
  },

  setFilters(f) {
    set({
      ...("tabId" in f ? { tabId: f.tabId } : {}),
      ...("lookAheadDays" in f ? { lookAheadDays: f.lookAheadDays } : {}),
    });
    chatContext = null;
  },

  async summarise() {
    if (get().running) return;
    const { ai, model, provider } = providerNow();
    const lookAheadDays = get().lookAheadDays ?? ai.lookAheadDays;
    const tabId = get().tabId;
    const ctx = currentContext(tabId, lookAheadDays);
    controller = new AbortController();
    set({ running: { kind: "summary", chars: 0 }, error: null });
    try {
      const raw = await provider.complete({
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: ctx.text }],
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: ai.temperature,
        json: true,
        signal: controller.signal,
        onText: (t) => set({ running: { kind: "summary", chars: t.length } }),
      });
      const saved: SavedSummary = {
        at: new Date().toISOString(),
        tabId,
        lookAheadDays,
        provider: ai.provider,
        model,
        result: parseSummary(raw, ctx.refs),
        refs: ctx.refs,
        stats: ctx.stats,
      };
      chatContext = ctx;
      set({ saved, chat: [], chatRefs: ctx.refs });
      await backend.writeAppFile(SAVED_FILE, JSON.stringify(saved)).catch(() => undefined);
    } catch (e) {
      const err = asPanelError(e);
      if (err.kind !== "cancelled") set({ error: err });
    } finally {
      controller = null;
      set({ running: null });
    }
  },

  async ask(question) {
    const q = question.trim();
    if (!q || get().running) return;
    const { ai, provider } = providerNow();
    chatContext ??= currentContext(get().tabId, get().lookAheadDays ?? ai.lookAheadDays);
    const ctx = chatContext;
    const history: ChatTurn[] = [...get().chat, { role: "user", text: q }];
    controller = new AbortController();
    set({
      chat: [...history, { role: "assistant", text: "" }],
      chatRefs: ctx.refs,
      running: { kind: "chat", chars: 0 },
      error: null,
    });
    const setAnswer = (text: string) => set({ chat: [...history, { role: "assistant", text }] });
    try {
      const answer = await provider.complete({
        system: chatSystem(ctx.text),
        messages: history.map((t) => ({ role: t.role, content: t.text })),
        maxTokens: CHAT_MAX_TOKENS,
        temperature: ai.temperature,
        signal: controller.signal,
        onText: (t) => {
          setAnswer(t);
          set({ running: { kind: "chat", chars: t.length } });
        },
      });
      setAnswer(answer);
    } catch (e) {
      const err = asPanelError(e);
      const partial = get().chat[get().chat.length - 1]?.text ?? "";
      if (err.kind === "cancelled") setAnswer(partial ? `${partial} (stopped)` : "(stopped)");
      else {
        set({ chat: history.slice(0, -1), error: err });
      }
    } finally {
      controller = null;
      set({ running: null });
    }
  },

  stop() {
    controller?.abort();
  },
}));

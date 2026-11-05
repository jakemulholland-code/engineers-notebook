import { useEffect, useMemo, useState } from "react";
import { AiRequestError, createProvider, listModelsCached, type ModelInfo } from "../ai/client";
import { AI_PROVIDERS, PROVIDER_LABEL, type AiProviderId, type AiSettings } from "../model/config";
import { backend } from "../storage/backend";
import { useNotebook } from "../store/notebook";

const LOOK_AHEAD = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 31, label: "1 month" },
];

export function AiSection() {
  const ai = useNotebook((s) => s.config.ai);
  const updateConfig = useNotebook((s) => s.updateConfig);
  const setAi = (patch: Partial<AiSettings>) =>
    void updateConfig((c) => ({ ...c, ai: { ...c.ai, ...patch } }));
  const [keyLast4, setKeyLast4] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setKeyLast4(undefined);
    void backend
      .keyStatus(ai.provider)
      .then((k) => live && setKeyLast4(k))
      .catch(() => live && setKeyLast4(null));
    return () => {
      live = false;
    };
  }, [ai.provider]);

  const ready = ai.provider === "custom" ? !!ai.customBaseUrl.trim() : !!keyLast4;

  return (
    <>
      <h3>AI</h3>
      <p className="lead">
        Catch me up sends a summary of your notes to the provider you choose here. API keys are kept
        in Windows Credential Manager, never in a file.
      </p>

      <div className="settings-grid">
        <label className="field">
          Provider
          <select
            value={ai.provider}
            onChange={(e) => setAi({ provider: e.target.value as AiProviderId })}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
                {p === "openrouter" ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>

        {ai.provider === "custom" && (
          <BaseUrlField
            value={ai.customBaseUrl}
            onSave={(customBaseUrl) => setAi({ customBaseUrl })}
          />
        )}

        <KeyField provider={ai.provider} last4={keyLast4} onChange={setKeyLast4} />

        <ModelPicker
          key={`${ai.provider}|${ai.customBaseUrl}|${ready}`}
          provider={ai.provider}
          baseUrl={ai.customBaseUrl}
          ready={ready}
          value={ai.models[ai.provider] ?? ""}
          onChange={(id) => setAi({ models: { ...ai.models, [ai.provider]: id } })}
        />

        <TestConnection
          key={`${ai.provider}|${ai.models[ai.provider] ?? ""}`}
          ai={ai}
          ready={ready}
        />
      </div>

      <h3 className="sub">Options</h3>
      <div className="settings-grid">
        <label className="field">
          Look-ahead window
          <select
            value={ai.lookAheadDays}
            onChange={(e) => setAi({ lookAheadDays: Number(e.target.value) })}
          >
            {LOOK_AHEAD.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Stale page threshold (days)
          <input
            type="number"
            min={7}
            max={180}
            value={ai.staleDays}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n >= 7 && n <= 180) setAi({ staleDays: n });
            }}
          />
        </label>
        <label className="field">
          Temperature: {ai.temperature.toFixed(1)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={ai.temperature}
            onChange={(e) => setAi({ temperature: Number(e.target.value) })}
          />
          <span className="hint">
            Anthropic models choose their own; the setting is not sent to them.
          </span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={ai.includeSnapshots}
            onChange={(e) => setAi({ includeSnapshots: e.target.checked })}
          />
          <span>
            Include page snapshots
            <span className="hint">
              Sends pictures of up to 5 recently edited pages, so handwriting and diagrams can be
              read. Only used when the chosen model accepts images.
            </span>
          </span>
        </label>
      </div>

      <p className="disclosure-line">
        Notes from included tabs are sent to {PROVIDER_LABEL[ai.provider]} when you use Catch me up.
        Turn on Exclude from AI for a client in Clients and folders to keep its notes out.
      </p>
    </>
  );
}

function BaseUrlField({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [v, setV] = useState(value);
  const valid = /^https?:\/\/.+/.test(v.trim());
  return (
    <label className="field">
      Base URL
      <span className="inline-row">
        <input
          type="text"
          value={v}
          placeholder="http://localhost:1234/v1"
          onChange={(e) => setV(e.target.value)}
        />
        <button
          className="small-button"
          disabled={!valid || v.trim() === value}
          onClick={() => onSave(v.trim())}
        >
          Save
        </button>
      </span>
      <span className="hint">
        Any server that speaks the OpenAI chat completions format, such as LM Studio or Ollama.
      </span>
    </label>
  );
}

function KeyField({
  provider,
  last4,
  onChange,
}: {
  provider: AiProviderId;
  last4: string | null | undefined;
  onChange(last4: string | null): void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const optional = provider === "custom";

  const save = async () => {
    setError(null);
    try {
      const l4 = await backend.saveKey(provider, value);
      setValue("");
      setReplacing(false);
      onChange(l4);
    } catch (e) {
      setError(String(e));
    }
  };

  if (last4 === undefined) return <p className="hint">Checking for a saved key…</p>;

  return (
    <div className="field">
      <span>API key{optional ? " (optional)" : ""}</span>
      {last4 && !replacing ? (
        <span className="inline-row">
          <span className="key-saved" aria-label={`Key saved, ending ${last4}`}>
            Key saved <code>••••{last4}</code>
          </span>
          <button className="small-button" onClick={() => setReplacing(true)}>
            Replace
          </button>
          <button
            className="small-button"
            onClick={() =>
              void backend
                .removeKey(provider)
                .then(() => onChange(null))
                .catch((e) => setError(String(e)))
            }
          >
            Remove
          </button>
        </span>
      ) : (
        <form
          className="inline-row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            aria-label={`${PROVIDER_LABEL[provider]} API key`}
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder="Paste your key"
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="small-button" disabled={!value.trim()}>
            Save key
          </button>
          {replacing && (
            <button type="button" className="small-button" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          )}
        </form>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

const fmtContext = (n?: number) =>
  n
    ? (n >= 1_000_000
        ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
        : `${Math.round(n / 1000)}k`) + " tokens"
    : "";

function ModelPicker({
  provider,
  baseUrl,
  ready,
  value,
  onChange,
}: {
  provider: AiProviderId;
  baseUrl: string;
  ready: boolean;
  value: string;
  onChange(id: string): void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");

  const load = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await listModelsCached(
        provider,
        provider === "custom" ? baseUrl : undefined,
        force,
      );
      setModels(r.models);
    } catch (e) {
      setError(e instanceof AiRequestError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = models ?? [];
    return (
      q
        ? list.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
        : list
    ).slice(0, 200);
  }, [models, query]);

  return (
    <div className="field model-picker">
      <span>Model</span>
      <span className="current-model">
        {value ? (
          <>
            Using <code>{value}</code>
          </>
        ) : (
          "No model chosen yet"
        )}
      </span>
      {!ready ? (
        <span className="hint">
          Save {provider === "custom" ? "a base URL" : "a key"} to load the model list.
        </span>
      ) : (
        <>
          <span className="inline-row">
            <input
              type="search"
              aria-label="Search models"
              placeholder={loading ? "Loading models…" : "Search models"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="small-button" disabled={loading} onClick={() => void load(true)}>
              Refresh
            </button>
          </span>
          {error && <span className="form-error">{error}</span>}
          {models && (
            <div className="model-list" role="listbox" aria-label="Models">
              {shown.length === 0 && <p className="hint">No models match.</p>}
              {shown.map((m) => (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={m.id === value}
                  className="model-row"
                  onClick={() => onChange(m.id)}
                >
                  <span className="name">{m.name}</span>
                  <span className="meta">
                    <code>{m.id}</code>
                    {m.contextLength ? ` · ${fmtContext(m.contextLength)}` : ""}
                  </span>
                  {m.vision && <span className="badge-images">Images</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <form
        className="inline-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) onChange(typed.trim());
          setTyped("");
        }}
      >
        <input
          type="text"
          aria-label="Type a model id"
          placeholder="Or type a model id"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="small-button" disabled={!typed.trim()}>
          Use this id
        </button>
      </form>
    </div>
  );
}

function TestConnection({ ai, ready }: { ai: AiSettings; ready: boolean }) {
  const [state, setState] = useState<{ kind: "idle" | "running" | "ok" | "error"; text?: string }>({
    kind: "idle",
  });
  const model = ai.models[ai.provider] ?? "";
  const run = async () => {
    setState({ kind: "running" });
    const started = performance.now();
    try {
      await createProvider(ai.provider, { model, baseUrl: ai.customBaseUrl }).complete({
        system: "This is a connection test.",
        messages: [{ role: "user", content: "Reply with the single word OK." }],
        maxTokens: 64,
        temperature: ai.temperature,
      });
      const ms = Math.round(performance.now() - started);
      setState({
        kind: "ok",
        text: `Connected to ${PROVIDER_LABEL[ai.provider]} in ${ms} ms using ${model}.`,
      });
    } catch (e) {
      setState({ kind: "error", text: e instanceof AiRequestError ? e.message : String(e) });
    }
  };
  return (
    <div className="field">
      <span className="inline-row">
        <button
          className="pill ghost"
          disabled={!ready || !model || state.kind === "running"}
          onClick={() => void run()}
        >
          {state.kind === "running" ? "Testing…" : "Test connection"}
        </button>
      </span>
      {state.text && (
        <span role="status" className={state.kind === "ok" ? "test-ok" : "form-error"}>
          {state.text}
        </span>
      )}
    </div>
  );
}

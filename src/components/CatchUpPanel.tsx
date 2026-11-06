import { differenceInCalendarDays, endOfWeek, format, isToday } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCatchUp } from "../ai/catchUp";
import type { Ref } from "../ai/payload";
import { splitRefs, summaryAsText } from "../ai/summary";
import { PROVIDER_LABEL } from "../model/config";
import { backend } from "../storage/backend";
import { useNotebook, visibleTabs } from "../store/notebook";
import { CloseIcon } from "./Icons";

const SECTION_TONE: Record<string, string> = {
  "Do these first": "first",
  "Coming up": "coming",
  "You might have forgotten": "forgotten",
  "Waiting on others": "waiting",
};

const daysToSunday = () =>
  differenceInCalendarDays(endOfWeek(new Date(), { weekStartsOn: 1 }), new Date());

/** The slide-over catch-up from the mockup: summary sections, chips back to the source, and Ask. */
export function CatchUpPanel() {
  const open = useCatchUp((s) => s.open);
  const setOpen = useCatchUp((s) => s.setOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return <Panel />;
}

function Panel() {
  const s = useCatchUp();
  const config = useNotebook((st) => st.config);
  const openSettings = useNotebook((st) => st.setSettingsOpen);
  const tabs = visibleTabs(config);
  const ai = config.ai;
  const model = ai.models[ai.provider] ?? "";
  const lookAhead = s.lookAheadDays ?? ai.lookAheadDays;
  const [keyLast4, setKeyLast4] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void backend
      .keyStatus(ai.provider)
      .then((k) => live && setKeyLast4(k))
      .catch(() => live && setKeyLast4(null));
    return () => {
      live = false;
    };
  }, [ai.provider]);

  const needsSetup =
    keyLast4 !== undefined &&
    ((ai.provider !== "custom" && !keyLast4) ||
      !model ||
      (ai.provider === "custom" && !ai.customBaseUrl));

  const lookOptions = [
    { value: daysToSunday(), label: "This week" },
    { value: 14, label: "Next 2 weeks" },
    { value: 31, label: "Next month" },
  ];
  if (!lookOptions.some((o) => o.value === lookAhead))
    lookOptions.push({ value: lookAhead, label: `Next ${lookAhead} days` });

  return (
    <aside className="catch-up" aria-label="Catch-up summary">
      <div className="catch-up-head">
        <div className="row">
          <h2>Catch-up</h2>
          <button
            className="icon-button"
            aria-label="Close catch-up"
            onClick={() => s.setOpen(false)}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="filters">
          <label>
            Tabs
            <select value={s.tabId} onChange={(e) => s.setFilters({ tabId: e.target.value })}>
              <option value="">All tabs</option>
              {tabs.map((t) => (
                <option key={t.id} value={t.id} disabled={t.excludeFromAi}>
                  {t.name}
                  {t.excludeFromAi ? " (excluded from AI)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Looking ahead
            <select
              value={lookAhead}
              onChange={(e) => s.setFilters({ lookAheadDays: Number(e.target.value) })}
            >
              {lookOptions.map((o) => (
                <option key={`${o.label}-${o.value}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="catch-up-body">
        {needsSetup && (
          <div className="catch-up-note">
            <p>
              {ai.provider === "custom" && !ai.customBaseUrl
                ? "Set the custom provider's base URL in Settings."
                : ai.provider !== "custom" && !keyLast4
                  ? `Add your ${PROVIDER_LABEL[ai.provider]} API key in Settings to use the catch-up.`
                  : "Choose a model in Settings to use the catch-up."}
            </p>
            <button className="pill primary" onClick={() => openSettings(true)}>
              Open settings
            </button>
          </div>
        )}

        {s.error && <ErrorBox />}

        {s.running?.kind === "summary" && (
          <div className="catch-up-progress" role="status">
            <span className="spinner" aria-hidden="true" />
            Reading your notes
            {s.running.chars ? ` (${s.running.chars} characters back so far)` : ""}
          </div>
        )}

        {!s.saved && !s.running && !needsSetup && (
          <div className="catch-up-note">
            <p>
              Get a short list of what needs coming back to, built from your dated items, recent
              pages and pages left alone. Nothing is sent until you ask.
            </p>
          </div>
        )}

        {s.saved && <SummaryView />}

        {s.chat.length > 0 && <ChatThread />}

        <p className="disclosure">
          Notes from included tabs are sent to {PROVIDER_LABEL[ai.provider]} when you use Catch me
          up.
        </p>
      </div>

      <Footer disabled={needsSetup} />
    </aside>
  );
}

function ErrorBox() {
  const error = useCatchUp((s) => s.error)!;
  const summarise = useCatchUp((s) => s.summarise);
  const [, tick] = useState(0);
  const remaining = error.retryAfterSecs
    ? Math.max(0, error.retryAfterSecs - Math.floor((Date.now() - error.at) / 1000))
    : 0;
  useEffect(() => {
    if (!remaining) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [remaining]);
  return (
    <div className="catch-up-error" role="alert">
      <p>{error.message}</p>
      {error.kind !== "bad_key" && error.kind !== "no_key" && error.kind !== "no_credit" && (
        <button className="small-button" disabled={remaining > 0} onClick={() => void summarise()}>
          {remaining > 0 ? `Try again in ${remaining}s` : "Try again"}
        </button>
      )}
    </div>
  );
}

function useRefChip() {
  const config = useNotebook((s) => s.config);
  const tabsState = useNotebook((s) => s.tabs);
  const openPageAt = useNotebook((s) => s.openPageAt);
  const openMeeting = useNotebook((s) => s.openMeeting);
  return (ref: Ref | undefined) => {
    if (!ref) return null;
    const tab = config.tabs.find((t) => t.id === ref.tabId);
    const st = tabsState[ref.tabId];
    if (ref.meetingId !== undefined) {
      const meetingId = ref.meetingId;
      const meeting =
        st?.status === "ok" ? st.meetings.find((m) => m.meeting.id === meetingId) : undefined;
      return (
        <button
          className="source-chip"
          disabled={!meeting}
          title={
            meeting
              ? `Open the meeting "${meeting.meeting.title}"`
              : "That meeting is no longer there"
          }
          onClick={() => openMeeting(ref.tabId, meetingId)}
        >
          <span aria-hidden="true" style={{ background: tab?.colour }} />
          {tab?.name ?? "Unknown tab"} meeting
        </button>
      );
    }
    const pageId = ref.pageId;
    const page = st?.status === "ok" ? st.pages.find((p) => p.page.id === pageId) : undefined;
    return (
      <button
        className="source-chip"
        disabled={!page}
        title={page ? `Open ${page.page.title || "page"}` : "That page is no longer there"}
        onClick={() => openPageAt(ref.tabId, pageId, ref.elementId)}
      >
        <span aria-hidden="true" style={{ background: tab?.colour }} />
        {tab?.name ?? "Unknown tab"}
      </button>
    );
  };
}

function SummaryView() {
  const saved = useCatchUp((s) => s.saved)!;
  const chip = useRefChip();
  const at = new Date(saved.at);
  const when = isToday(at) ? format(at, "HH:mm") : format(at, "EEE d MMM 'at' HH:mm");
  const st = saved.stats;
  return (
    <>
      {saved.result.kind === "raw" ? (
        <section className="catch-up-section">
          <p className="raw-intro">
            The reply wasn’t in the expected format, so here it is as written:
          </p>
          <p className="raw">{saved.result.text || "(empty reply)"}</p>
        </section>
      ) : saved.result.sections.length === 0 ? (
        <p className="catch-up-note">Nothing needs your attention right now.</p>
      ) : (
        saved.result.sections.map((sec) => (
          <section
            key={sec.title}
            className="catch-up-section"
            data-tone={SECTION_TONE[sec.title] ?? "other"}
          >
            <h3>
              <span aria-hidden="true" />
              {sec.title}
            </h3>
            <ul>
              {sec.items.map((it, i) => (
                <li key={i}>
                  {it.text} {chip(saved.refs[it.ref])}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="footnote">
        Built from {st.dated} dated item{st.dated === 1 ? "" : "s"}, {st.recentPages} recently
        edited page
        {st.recentPages === 1 ? "" : "s"} and {st.stalePages} page{st.stalePages === 1 ? "" : "s"}{" "}
        left untouched.
        {st.meetings ? ` Read ${st.meetings} meeting${st.meetings === 1 ? "" : "s"} in full.` : ""}
        {st.truncated ? " Long notes were cut short to fit." : ""}
        {typeof saved.snapshots === "number" && saved.snapshots > 0
          ? ` Included ${saved.snapshots} page snapshot${saved.snapshots === 1 ? "" : "s"}.`
          : typeof saved.snapshots === "string"
            ? ` No page snapshots: ${saved.snapshots}.`
            : ""}
        {saved.result.kind === "sections" && saved.result.dropped > 0
          ? ` ${saved.result.dropped} item${saved.result.dropped === 1 ? " without a valid link was" : "s without a valid link were"} left out.`
          : ""}{" "}
        Summarised at {when} with {saved.model}.
      </p>
    </>
  );
}

function ChatThread() {
  const chat = useCatchUp((s) => s.chat);
  const refs = useCatchUp((s) => s.chatRefs);
  const chip = useRefChip();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise from scrollIntoView, and an
    // effect must not return anything but a cleanup function.
    void end.current?.scrollIntoView({ block: "nearest" });
  }, [chat]);
  return (
    <section className="chat" aria-label="Questions about your notes">
      {chat.map((t, i) => (
        <div key={i} className={`turn ${t.role}`}>
          {t.role === "assistant"
            ? splitRefs(t.text || "…", refs).map((part, j) =>
                "ref" in part ? (
                  <span key={j}> {chip(refs[part.ref])}</span>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )
            : t.text}
        </div>
      ))}
      <div ref={end} />
    </section>
  );
}

function Footer({ disabled }: { disabled: boolean }) {
  const s = useCatchUp();
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (s.saved ? summaryAsText(s.saved.result) : ""), [s.saved]);
  return (
    <div className="catch-up-foot">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          void s.ask(q);
          setQ("");
        }}
      >
        <label htmlFor="ask-notes">Ask about your notes</label>
        <span className="ask-row">
          <input
            id="ask-notes"
            type="text"
            value={q}
            placeholder="What did I promise Quest Hardware?"
            disabled={disabled}
            onChange={(e) => setQ(e.target.value)}
          />
          {s.running ? (
            <button type="button" className="ask-button stop" aria-label="Stop" onClick={s.stop}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="ask-button"
              aria-label="Ask"
              disabled={disabled || !q.trim()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 9h11M10 5l4 4-4 4" />
              </svg>
            </button>
          )}
        </span>
      </form>
      <div className="foot-buttons">
        {s.running ? (
          <button className="pill ghost" onClick={s.stop}>
            Stop
          </button>
        ) : (
          <button
            className={`pill ${s.saved ? "ghost" : "primary"}`}
            disabled={disabled}
            onClick={() => void s.summarise()}
          >
            {s.saved ? "Summarise again" : "Summarise"}
          </button>
        )}
        <button
          className="pill ghost"
          disabled={!s.saved}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
    </div>
  );
}

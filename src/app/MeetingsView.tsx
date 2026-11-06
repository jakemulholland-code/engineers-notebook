import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import { useNotebook } from "../store/notebook";
import { dateFromPaste, titleFromPaste, type Meeting } from "../model/meeting";
import { fromYmd, parseUkDate, toYmd } from "../reminders/dates";
import { PlusIcon } from "../components/Icons";

const longDate = (ymd: string) => format(fromYmd(ymd), "EEE d MMM yyyy");
const shortDate = (ymd: string) => format(fromYmd(ymd), "EEE d MMM");

/** Meeting notes for one client tab: pasted in from Granola and read by the AI. */
export function MeetingsView({ tabId }: { tabId: string }) {
  const tab = useNotebook((s) => s.config.tabs.find((t) => t.id === tabId));
  const state = useNotebook((s) => s.tabs[tabId]);
  const selected = useNotebook((s) => s.selectedMeeting);
  const meetings = state?.status === "ok" ? state.meetings : [];
  const [mode, setMode] = useState<"view" | "add" | "edit">(meetings.length ? "view" : "add");
  const current = meetings.find((m) => m.meeting.id === selected) ?? meetings[0];

  // Keep the selection on a meeting that exists (after a delete, say).
  useEffect(() => {
    if (current && current.meeting.id !== selected) {
      useNotebook.setState({ selectedMeeting: current.meeting.id });
    }
  }, [current, selected]);

  const select = (id: string) => {
    useNotebook.setState({ selectedMeeting: id });
    setMode("view");
  };

  return (
    <div className="meetings-sheet">
      <div className="meetings-inner">
        <div className="meetings-head">
          <div className="meetings-title">
            <h1>Meetings</h1>
            <p>
              Notes from Granola and other meetings for {tab?.name}. Paste them in and the catch-up
              and questions will read them too.
            </p>
          </div>
          <button className="pill primary" onClick={() => setMode("add")} disabled={mode === "add"}>
            <PlusIcon size={18} />
            Add meeting
          </button>
        </div>

        <div className="meetings-body">
          <nav className="meeting-list" aria-label="Meetings">
            {meetings.length === 0 ? (
              <p className="meeting-list-empty">No meetings yet.</p>
            ) : (
              <ol>
                {meetings.map(({ meeting: m }) => (
                  <li key={m.id}>
                    <button
                      className="meeting-row"
                      aria-current={
                        mode !== "add" && m.id === current?.meeting.id ? "true" : undefined
                      }
                      onClick={() => select(m.id)}
                    >
                      <span className="meeting-date">{shortDate(m.date)}</span>
                      <span className="meeting-name">{m.title}</span>
                      <span className="meeting-preview">{preview(m)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>

          <section className="meeting-detail" aria-live="polite">
            {mode === "add" ? (
              <MeetingForm
                key="add"
                tabId={tabId}
                onDone={(id) => (id ? select(id) : setMode("view"))}
                canCancel={meetings.length > 0}
              />
            ) : mode === "edit" && current ? (
              <MeetingForm
                key={`edit-${current.meeting.id}`}
                tabId={tabId}
                meeting={current.meeting}
                onDone={() => setMode("view")}
                canCancel
              />
            ) : current ? (
              <MeetingRead
                key={current.meeting.id}
                tabId={tabId}
                meeting={current.meeting}
                onEdit={() => setMode("edit")}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function preview(m: Meeting): string {
  const line = m.body
    .split("\n")
    .map((l) => l.replace(/^\s*(#+|[-*]|\d+\.)\s*/, "").trim())
    .find((l) => l && l !== m.title);
  return line ? line.slice(0, 90) : "";
}

function MeetingRead({
  tabId,
  meeting,
  onEdit,
}: {
  tabId: string;
  meeting: Meeting;
  onEdit(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = useNotebook.getState;

  const run = async (job: () => Promise<void>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <article className="meeting-read">
      <header>
        <div>
          <h2>{meeting.title}</h2>
          <p className="meeting-meta">
            {longDate(meeting.date)}
            {meeting.source === "granola" ? " · From Granola" : ""}
          </p>
        </div>
        <div className="meeting-actions">
          <label
            className="include-ai"
            title="Send this meeting to the AI for catch-ups and questions"
          >
            <input
              type="checkbox"
              checked={meeting.includeInAi}
              onChange={(e) =>
                void run(() =>
                  s().updateMeeting(tabId, meeting.id, { includeInAi: e.target.checked }),
                )
              }
            />
            Include in catch-up
          </label>
          <button className="small-button" onClick={onEdit}>
            Edit
          </button>
          <button className="small-button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      </header>
      {confirming && (
        <div className="meeting-confirm" role="alert">
          <span>Move this meeting to the Recycle Bin?</span>
          <button
            className="small-button danger"
            autoFocus
            onClick={() => void run(() => s().deleteMeeting(tabId, meeting.id))}
          >
            Delete meeting
          </button>
          <button className="small-button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="meeting-text">
        <NotesText text={meeting.body} />
      </div>
    </article>
  );
}

/**
 * Pasted notes, lightly formatted: Markdown headings, bullets and bold, shown as text
 * (never as HTML, so nothing pasted can run).
 */
function NotesText({ text }: { text: string }) {
  if (!text.trim()) return <p className="meeting-empty-body">No notes.</p>;
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (heading) {
      flush();
      out.push(
        heading[1].length <= 2 ? (
          <h3 key={i}>{bold(heading[2])}</h3>
        ) : (
          <h4 key={i}>{bold(heading[2])}</h4>
        ),
      );
    } else if (bullet) {
      const depth = Math.min(3, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2));
      list.push(
        <li key={i} style={{ marginLeft: depth * 18 }}>
          {bold(bullet[2])}
        </li>,
      );
    } else if (line.trim()) {
      flush();
      out.push(<p key={i}>{bold(line)}</p>);
    } else {
      flush();
    }
  });
  flush();
  return <>{out}</>;
}

function bold(s: string): ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return parts.length === 1 ? s : parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p));
}

function MeetingForm({
  tabId,
  meeting,
  onDone,
  canCancel,
}: {
  tabId: string;
  meeting?: Meeting;
  onDone(id?: string): void;
  canCancel: boolean;
}) {
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [dateText, setDateText] = useState(
    meeting ? longDate(meeting.date) : longDate(toYmd(new Date())),
  );
  const [body, setBody] = useState(meeting?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleTouched = useRef(!!meeting);
  const dateTouched = useRef(!!meeting);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const date = parseUkDate(dateText);

  useEffect(() => {
    if (!meeting) notesRef.current?.focus();
  }, [meeting]);

  // Pasting a Granola note into an empty form fills in the title, and the date if it has one.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (body.trim()) return;
    const pasted = e.clipboardData.getData("text/plain");
    if (!titleTouched.current) {
      const t = titleFromPaste(pasted);
      if (t) setTitle(t);
    }
    if (!dateTouched.current) {
      const d = dateFromPaste(pasted);
      if (d) setDateText(longDate(d));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    setError(null);
    try {
      const s = useNotebook.getState();
      if (meeting) {
        await s.updateMeeting(tabId, meeting.id, { title, date, body });
        onDone(meeting.id);
      } else {
        onDone(await s.addMeeting(tabId, { title, date, body }));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="meeting-form" onSubmit={(e) => void save(e)}>
      <h2>{meeting ? "Edit meeting" : "Add meeting"}</h2>
      {!meeting && (
        <p className="lead">
          In Granola, open the meeting and copy its notes, then paste them below. The title and date
          fill in from the notes when they can.
        </p>
      )}
      <div className="meeting-form-row">
        <label className="field grow">
          Title
          <input
            type="text"
            value={title}
            placeholder="Weekly sync"
            onChange={(e) => {
              titleTouched.current = true;
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Date
          <input
            type="text"
            value={dateText}
            aria-invalid={!date}
            onChange={(e) => {
              dateTouched.current = true;
              setDateText(e.target.value);
            }}
            onBlur={() => date && setDateText(longDate(date))}
          />
          <span className="hint">{date ? longDate(date) : "Try 5/11, thu or 5 Nov 2026"}</span>
        </label>
      </div>
      <label className="field">
        Notes
        <textarea
          ref={notesRef}
          value={body}
          onPaste={onPaste}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste the meeting notes here"
          rows={16}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {canCancel && (
          <button type="button" className="pill ghost" onClick={() => onDone()} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="pill primary" disabled={busy || !date || !body.trim()}>
          {meeting ? "Save changes" : "Save meeting"}
        </button>
      </div>
    </form>
  );
}

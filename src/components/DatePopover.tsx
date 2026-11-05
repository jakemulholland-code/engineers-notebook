import { addDays, addMonths, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DateTag } from "../model/page";
import {
  KIND_LABEL,
  formatLong,
  fromYmd,
  nextWeekday,
  parseUkDate,
  startOfToday,
  toYmd,
  type DateKind,
} from "../reminders/dates";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./Icons";

const KINDS: DateKind[] = ["due", "follow_up", "waiting_on"];

type Props = {
  tag?: DateTag;
  style: CSSProperties;
  onSave(tag: DateTag): void;
  onRemove(): void;
  onClose(): void;
};

/** "Date this item": kind, a forgiving UK date field, quick picks and a calendar. */
export function DatePopover({ tag, style, onSave, onRemove, onClose }: Props) {
  const today = startOfToday();
  const [kind, setKind] = useState<DateKind>(tag?.kind ?? "due");
  const [text, setText] = useState(() => formatLong(tag?.date ?? toYmd(addDays(today, 1))));
  const [touched, setTouched] = useState(!!tag);
  const [include, setInclude] = useState(tag?.includeInSummary ?? true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseUkDate(text, today);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  const pick = (ymd: string) => {
    setText(formatLong(ymd));
    setTouched(true);
  };

  const chooseKind = (k: DateKind) => {
    setKind(k);
    // "Waiting on" counts from when you started waiting, so default to today.
    if (!touched) setText(formatLong(toYmd(k === "waiting_on" ? today : addDays(today, 1))));
  };

  const save = () => {
    if (!parsed) return;
    const sameDate = tag && tag.date === parsed;
    const next: DateTag = {
      kind,
      date: parsed,
      includeInSummary: include,
      done: sameDate ? tag.done : false,
    };
    if (sameDate && tag.doneAt) next.doneAt = tag.doneAt;
    onSave(next);
  };

  return (
    <div
      className="date-popover"
      role="dialog"
      aria-label="Date this item"
      style={style}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="date-popover-head">
        <h3>Date this item</h3>
        <div role="radiogroup" aria-label="Kind of date" className="kind-picker">
          {KINDS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              data-kind={k}
              onClick={() => chooseKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button className="icon-button small" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="date-popover-row">
        <label className="date-field">
          Date
          <input
            ref={inputRef}
            type="text"
            value={text}
            aria-invalid={!parsed}
            aria-describedby="date-hint"
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            onBlur={() => parsed && setText(formatLong(parsed))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>
        <button
          className="icon-button small"
          aria-label="Show calendar"
          aria-expanded={calendarOpen}
          onClick={() => setCalendarOpen((o) => !o)}
        >
          <CalendarIcon />
        </button>
        <button className="chip-button" onClick={() => pick(toYmd(addDays(today, 1)))}>
          Tomorrow
        </button>
        <button className="chip-button" onClick={() => pick(toYmd(nextWeekday(today, 1, true)))}>
          Next Monday
        </button>
        <button className="chip-button" onClick={() => pick(toYmd(addDays(today, 14)))}>
          In 2 weeks
        </button>
      </div>
      <p id="date-hint" className={`date-hint ${parsed ? "" : "error"}`}>
        {parsed
          ? formatLong(parsed) === text.trim()
            ? "Type a date like 12/11, thu or next mon."
            : `Reads as ${formatLong(parsed)}`
          : "Not a date we recognise. Try 12/11, thu or next mon."}
      </p>

      {calendarOpen && <Calendar value={parsed} onPick={pick} />}

      <div className="date-popover-foot">
        <label className="include">
          <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
          Include in catch-up summaries
        </label>
        {tag && (
          <button className="pill danger" onClick={onRemove}>
            Remove date
          </button>
        )}
        <button className="pill primary" disabled={!parsed} onClick={save}>
          Save date
        </button>
      </div>
    </div>
  );
}

function Calendar({ value, onPick }: { value: string | null; onPick(ymd: string): void }) {
  const todayYmd = toYmd(new Date());
  const [month, setMonth] = useState(() => startOfMonth(value ? fromYmd(value) : new Date()));
  const first = startOfWeek(month, { weekStartsOn: 1 });
  const last = endOfMonth(month);
  const days: Date[] = [];
  for (let d = first; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          className="icon-button small"
          aria-label="Previous month"
          onClick={() => setMonth((m) => addMonths(m, -1))}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span>{format(month, "MMMM yyyy")}</span>
        <button
          className="icon-button small"
          aria-label="Next month"
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={format(month, "MMMM yyyy")}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="dow" aria-hidden="true">
            {d.slice(0, 2)}
          </span>
        ))}
        {days.map((d) => {
          const ymd = toYmd(d);
          return (
            <button
              key={ymd}
              className="day"
              aria-label={format(d, "EEEE d MMMM yyyy")}
              aria-pressed={ymd === value}
              data-today={ymd === todayYmd || undefined}
              data-outside={d.getMonth() !== month.getMonth() || undefined}
              onClick={() => onPick(ymd)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="13" height="12" rx="2" />
      <path d="M2.5 7.5h13M6 2v3M12 2v3" />
    </svg>
  );
}

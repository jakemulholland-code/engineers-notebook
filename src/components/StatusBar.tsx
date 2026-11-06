import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { currentPageOf, useNotebook, type SaveState } from "../store/notebook";
import { useTools } from "../store/tools";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./Icons";
import { PageList, PAGE_LIST_TOGGLE } from "./PageList";
import { fromYmd } from "../reminders/dates";
import { overdueCount } from "../reminders/index";
import { useReminderIndex, useToday } from "../reminders/useReminders";

function saveLabel(s: SaveState, now: number): string {
  switch (s.kind) {
    case "saving":
      return "Saving";
    case "unsaved":
      return "Unsaved changes";
    case "read-only":
      return "Read-only";
    case "error":
      return "Not saved";
    case "saved": {
      if (!s.at) return "Saved";
      const secs = Math.round((now - s.at.getTime()) / 1000);
      if (secs < 10) return "Saved just now";
      if (secs < 60) return `Saved ${secs} seconds ago`;
      const mins = Math.round(secs / 60);
      return mins === 1 ? "Saved 1 minute ago" : `Saved ${mins} minutes ago`;
    }
  }
}

function RemindersCount() {
  const { index } = useReminderIndex();
  const today = fromYmd(useToday());
  const open = index.items.filter((i) => !i.tag.done).length;
  const overdue = overdueCount(index, today);
  return (
    <span>
      {open === 1 ? "1 item" : `${open} items`}, {overdue} overdue
    </span>
  );
}

export function StatusBar() {
  const cur = useNotebook(useShallow(currentPageOf));
  const save = useNotebook((s) => s.save);
  const goToPage = useNotebook((s) => s.goToPage);
  const newPage = useNotebook((s) => s.newPage);
  const pageListOpen = useNotebook((s) => s.pageListOpen);
  const setPageListOpen = useNotebook((s) => s.setPageListOpen);
  const general = useNotebook((s) => s.config.general);
  const zoom = useTools((s) => s.zoom);
  const view = useNotebook((s) => s.view);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="statusbar">
      {cur && (
        <div className="pager">
          <button
            className="icon-button small"
            aria-label="Previous page"
            disabled={cur.index === 0}
            onClick={() => goToPage(-1)}
          >
            <ChevronLeftIcon size={16} />
          </button>
          <button
            className="count"
            {...{ [PAGE_LIST_TOGGLE]: "" }}
            aria-haspopup="dialog"
            aria-expanded={pageListOpen}
            title="All pages (Ctrl+P)"
            onClick={() => setPageListOpen(!pageListOpen)}
          >
            Page {cur.index + 1} of {cur.count}
          </button>
          <button
            className="icon-button small"
            aria-label="Next page"
            disabled={cur.index >= cur.count - 1}
            onClick={() => goToPage(1)}
          >
            <ChevronRightIcon size={16} />
          </button>
          <button
            className="icon-button small"
            aria-label="New page"
            title="New page"
            onClick={() => void newPage()}
          >
            <PlusIcon size={16} />
          </button>
        </div>
      )}
      {view.kind === "reminders" ? (
        <RemindersCount />
      ) : (
        <span>
          {general.lockToGrid ? `Snapping to ${general.gridSize} px grid` : "Grid snapping off"}
        </span>
      )}
      <span
        className={`push ${save.kind === "error" ? "error" : ""}`}
        title={save.kind === "error" ? save.message : undefined}
      >
        {cur ? saveLabel(save, now) : ""}
      </span>
      <span>{Math.round(zoom * 100)}%</span>
      <PageList />
    </footer>
  );
}

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useNotebook, visibleTabs } from "../store/notebook";
import { formatShort, fromYmd, pillLabel, type DateKind } from "../reminders/dates";
import { groupReminders, type GroupId, type GroupedItem, type StaleRow } from "../reminders/index";
import { setReminderDone, useReminderIndex, useToday } from "../reminders/useReminders";

const KIND_FILTERS: { id: DateKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "due", label: "Due" },
  { id: "follow_up", label: "Follow up" },
  { id: "waiting_on", label: "Waiting on" },
];

/** Every dated item across all tabs, grouped by when it needs coming back to. */
export function RemindersView() {
  const todayYmd = useToday();
  const today = fromYmd(todayYmd);
  const { index, complete } = useReminderIndex();
  const config = useNotebook((s) => s.config);
  const openPageAt = useNotebook((s) => s.openPageAt);
  const tabs = visibleTabs(config);
  const tabById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);

  const [tabId, setTabId] = useState<string>("");
  const [kind, setKind] = useState<DateKind | "all">("all");
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(
    () =>
      groupReminders(index, today, {
        tabId: tabId || undefined,
        kind: kind === "all" ? undefined : kind,
        showDone,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, todayYmd, tabId, kind, showDone],
  );

  return (
    <div className="reminders-sheet">
      <div className="reminders-inner">
        <div className="reminders-head">
          <div className="reminders-title">
            <h1>Reminders</h1>
            <p>
              Every dated item across your tabs. Today is {format(today, "EEE d MMM yyyy")}.
              {!complete && " Still reading some folders."}
            </p>
          </div>
          <div className="reminders-filters">
            <label className="visually-hidden" htmlFor="reminder-tab">
              Tab
            </label>
            <select id="reminder-tab" value={tabId} onChange={(e) => setTabId(e.target.value)}>
              <option value="">All tabs</option>
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div role="group" aria-label="Kind of date" className="segmented">
              {KIND_FILTERS.map((k) => (
                <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            <label className="show-done">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => setShowDone(e.target.checked)}
              />
              Show done
            </label>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="reminders-empty">
            <h2>Nothing to come back to</h2>
            <p>Select anything on a page and press D, or right-click it and choose Add date.</p>
          </div>
        ) : (
          <div className="reminder-groups">
            {groups.map((g) => (
              <section key={g.id} className="reminder-group" data-group={g.id} aria-label={g.title}>
                <h2>
                  <span aria-hidden="true" />
                  {g.title}
                </h2>
                <p className="note">{g.note}</p>
                <ul>
                  {g.id === "stale"
                    ? g.pages.map((p) => (
                        <StaleRowView
                          key={`${p.tabId}:${p.pageId}`}
                          row={p}
                          today={today}
                          tab={tabById.get(p.tabId)}
                          onOpen={() => openPageAt(p.tabId, p.pageId)}
                        />
                      ))
                    : g.items.map((item) => (
                        <ItemRow
                          key={item.key}
                          item={item}
                          group={g.id}
                          today={today}
                          tab={tabById.get(item.tabId)}
                          onOpen={() => openPageAt(item.tabId, item.pageId, item.elementId)}
                        />
                      ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type TabInfo = { name: string; colour: string } | undefined;

function TabTag({ tab }: { tab: TabInfo }) {
  return (
    <span className="tab-tag">
      <span aria-hidden="true" style={{ background: tab?.colour }} />
      {tab?.name ?? "Unknown tab"}
    </span>
  );
}

function ItemRow({
  item,
  group,
  today,
  tab,
  onOpen,
}: {
  item: GroupedItem;
  group: GroupId;
  today: Date;
  tab: TabInfo;
  onOpen(): void;
}) {
  const tone = item.tag.done ? "done" : item.overdue ? "overdue" : item.tag.kind;
  let label = pillLabel(item.tag, today);
  if (group === "waiting" && item.daysWaited !== undefined) {
    label += item.daysWaited === 1 ? " (1 day)" : ` (${item.daysWaited} days)`;
  }
  return (
    <li className="reminder-row">
      <input
        type="checkbox"
        aria-label={`Mark done: ${item.text}`}
        checked={item.tag.done}
        onChange={(e) => setReminderDone(item, e.target.checked)}
      />
      <div className="body">
        <div className={`title ${item.tag.done ? "done" : ""}`}>{item.text}</div>
        <div className="meta">
          <TabTag tab={tab} />
          <span className="date-chip" data-tone={tone}>
            {label}
          </span>
          <span className="page-name">{item.pageTitle}</span>
        </div>
      </div>
      <button className="link-button" onClick={onOpen}>
        Open page
      </button>
    </li>
  );
}

function StaleRowView({
  row,
  today,
  tab,
  onOpen,
}: {
  row: StaleRow;
  today: Date;
  tab: TabInfo;
  onOpen(): void;
}) {
  return (
    <li className="reminder-row">
      <span className="no-check" aria-hidden="true" />
      <div className="body">
        <div className="title">{row.title || "Untitled page"}</div>
        <div className="meta">
          <TabTag tab={tab} />
          <span className="date-chip" data-tone="stale">
            Last edited {formatShort(row.updatedAt.slice(0, 10), today)}
          </span>
        </div>
      </div>
      <button className="link-button" onClick={onOpen}>
        Open page
      </button>
    </li>
  );
}

import { useNotebook, visibleTabs } from "../store/notebook";
import { BellIcon, PlusIcon } from "./Icons";
import { fromYmd } from "../reminders/dates";
import { overdueCount } from "../reminders/index";
import { useReminderIndex, useToday } from "../reminders/useReminders";

export function Tabs() {
  const config = useNotebook((s) => s.config);
  const view = useNotebook((s) => s.view);
  const openTab = useNotebook((s) => s.openTab);
  const openReminders = useNotebook((s) => s.openReminders);
  const openSettings = useNotebook((s) => s.setSettingsOpen);
  const tabs = visibleTabs(config);
  const { index } = useReminderIndex();
  const today = useToday();
  const overdue = overdueCount(index, fromYmd(today));

  return (
    <nav className="tabs" aria-label="Notebook tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className="tab"
          aria-current={view.kind === "tab" && view.tabId === t.id ? "page" : undefined}
          onClick={() => openTab(t.id)}
          title={t.name}
        >
          <span className="marker" style={{ background: t.colour }} aria-hidden="true" />
          <span className="name">{t.name}</span>
        </button>
      ))}
      <button
        className="tab reminders"
        aria-current={view.kind === "reminders" ? "page" : undefined}
        onClick={openReminders}
      >
        <BellIcon size={16} />
        <span className="name">Reminders</span>
        {overdue > 0 && (
          <span className="badge" aria-label={`${overdue} overdue`} title={`${overdue} overdue`}>
            {overdue}
          </span>
        )}
      </button>
      <button className="tab new" onClick={() => openSettings(true)}>
        <PlusIcon size={14} />
        New tab
      </button>
    </nav>
  );
}

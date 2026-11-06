import { useCallback, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNotebook, visibleTabs } from "../store/notebook";
import { backend } from "../storage/backend";
import { BellIcon, PlusIcon } from "./Icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { TabEditPopover } from "./TabEditPopover";
import { useDragReorder } from "./useDragReorder";
import { fromYmd } from "../reminders/dates";
import { overdueCount } from "../reminders/index";
import { useReminderIndex, useToday } from "../reminders/useReminders";

type Menu = { tabId: string; x: number; y: number; anchor: DOMRect };
type Editing = { tabId: string; anchor: DOMRect; focus: "name" | "colour" };

export function Tabs() {
  const config = useNotebook((s) => s.config);
  const view = useNotebook((s) => s.view);
  const states = useNotebook((s) => s.tabs);
  const openTab = useNotebook((s) => s.openTab);
  const openReminders = useNotebook((s) => s.openReminders);
  const openSettings = useNotebook((s) => s.setSettingsOpen);
  const moveTab = useNotebook((s) => s.moveTab);
  const tabs = visibleTabs(config);
  const ids = tabs.map((t) => t.id);
  const { index } = useReminderIndex();
  const today = useToday();
  const overdue = overdueCount(index, fromYmd(today));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeEdit = useCallback(() => setEditing(null), []);

  const onMove = useCallback((id: string, slot: number) => void moveTab(id, slot), [moveTab]);
  const { listRef, drag, start, onClickCapture, dropMark } = useDragReorder<HTMLDivElement>(onMove);

  const openMenu = (tabId: string) => (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const anchor = e.currentTarget.getBoundingClientRect();
    // A keyboard context-menu key reports no pointer position: open beside the tab.
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    setMenu({
      tabId,
      anchor,
      x: fromKeyboard ? anchor.left - 210 : e.clientX - 210,
      y: fromKeyboard ? anchor.top : e.clientY,
    });
  };

  const onTabKey = (tabId: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    // Read the order now, not from the last render: quick repeat presses must each count.
    const from = visibleTabs(useNotebook.getState().config).findIndex((t) => t.id === tabId);
    void moveTab(tabId, e.key === "ArrowUp" ? from - 1 : from + 2);
    // Moving the button in the page drops focus; put it back before the next key press.
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-reorder-id="${tabId}"]`)?.focus(),
    );
  };

  const menuItems = (m: Menu): MenuItem[] => {
    const st = states[m.tabId];
    const items: MenuItem[] = [
      {
        label: "Rename",
        onSelect: () => setEditing({ tabId: m.tabId, anchor: m.anchor, focus: "name" }),
      },
      {
        label: "Change colour",
        onSelect: () => setEditing({ tabId: m.tabId, anchor: m.anchor, focus: "colour" }),
      },
    ];
    if (st?.status === "ok") {
      items.push({
        label: "Open folder in Explorer",
        onSelect: () =>
          void backend
            .openInExplorer(st.notesPath)
            .catch((e) => useNotebook.setState({ notice: String(e) })),
      });
    }
    items.push({
      label: "Archive",
      onSelect: () => void useNotebook.getState().archiveTab(m.tabId),
    });
    return items;
  };

  return (
    <nav className={`tabs${drag ? " reordering" : ""}`} aria-label="Notebook tabs">
      <div className="tab-list" ref={listRef} onClickCapture={onClickCapture}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            className={`tab${drag?.id === t.id ? " dragging" : ""}`}
            data-reorder-id={t.id}
            data-drop={dropMark(ids, i)}
            aria-current={view.kind === "tab" && view.tabId === t.id ? "page" : undefined}
            aria-haspopup="menu"
            onClick={() => openTab(t.id)}
            onContextMenu={openMenu(t.id)}
            onPointerDown={start(t.id)}
            onKeyDown={onTabKey(t.id)}
            title={`${t.name}. Right-click for options, drag or Alt+arrow keys to reorder.`}
          >
            <span className="marker" style={{ background: t.colour }} aria-hidden="true" />
            <span className="name">{t.name}</span>
          </button>
        ))}
      </div>
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={closeMenu} />}
      {editing && (
        <TabEditPopover
          key={`${editing.tabId}-${editing.focus}`}
          tabId={editing.tabId}
          anchor={editing.anchor}
          focus={editing.focus}
          onClose={closeEdit}
        />
      )}
    </nav>
  );
}

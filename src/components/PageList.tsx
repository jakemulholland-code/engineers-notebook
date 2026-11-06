import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNotebook } from "../store/notebook";
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "./Icons";
import { editedLabel } from "./pageListFormat";

/** Marks the status-bar button that toggles the list, so clicking it is not an "outside" click. */
export const PAGE_LIST_TOGGLE = "data-page-list-toggle";

/** The page list (Ctrl+P or the page count): open, new, rename, duplicate and delete pages. */
export function PageList() {
  const open = useNotebook((s) => s.pageListOpen);
  const view = useNotebook((s) => s.view);
  if (!open || view.kind !== "tab") return null;
  return <PageListPopover tabId={view.tabId} />;
}

function PageListPopover({ tabId }: { tabId: string }) {
  const tab = useNotebook((s) => s.tabs[tabId]);
  const tabName = useNotebook((s) => s.config.tabs.find((t) => t.id === tabId)?.name ?? "");
  const currentId = useNotebook((s) => s.currentPage[tabId]);
  const setOpen = useNotebook((s) => s.setPageListOpen);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = new Date();

  const pages = tab?.status === "ok" ? tab.pages : [];
  const current = pages.find((p) => p.page.id === currentId) ?? pages[pages.length - 1];

  // Focus the current page when the list opens.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(".page-open.current");
    (el ?? ref.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);

  // Close on an outside click.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.(`[${PAGE_LIST_TOGGLE}]`)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [setOpen]);

  // Escape steps back (cancel rename or delete, then close) wherever focus is: clicking a row
  // button swaps it out of the page, which drops focus to the body.
  useEffect(() => {
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (renaming) setRenaming(null);
      else if (confirming) setConfirming(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [renaming, confirming, setOpen]);

  // Keep keyboard focus in the list as rows switch between view, rename and confirm.
  useEffect(() => {
    if (confirming) ref.current?.querySelector<HTMLButtonElement>("li.confirming button")?.focus();
    else if (!renaming && !ref.current?.contains(document.activeElement)) {
      ref.current?.querySelector<HTMLButtonElement>(".page-open")?.focus();
    }
  }, [confirming, renaming]);

  const close = () => setOpen(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".page-open") ?? [])];
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  const openPage = (pageId: string) => {
    useNotebook.getState().openPageAt(tabId, pageId);
    close();
  };

  const startRename = (pageId: string, title: string) => {
    setConfirming(null);
    setRenaming(pageId);
    setDraft(title);
  };

  const saveRename = (e: FormEvent) => {
    e.preventDefault();
    if (renaming) useNotebook.getState().renamePage(tabId, renaming, draft);
    setRenaming(null);
  };

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="page-list"
      ref={ref}
      role="dialog"
      aria-label={`Pages in ${tabName}`}
      onKeyDown={onKeyDown}
    >
      <header>
        <h3>Pages</h3>
        <span className="tab-name">{tabName}</span>
        <button className="icon-button small" aria-label="Close page list" onClick={close}>
          <CloseIcon size={16} />
        </button>
      </header>

      {pages.length === 0 ? (
        <p className="empty">No pages yet.</p>
      ) : (
        <ol>
          {pages.map((p, i) => {
            const id = p.page.id;
            const isCurrent = p === current;
            if (renaming === id) {
              return (
                <li key={id} className="editing">
                  <form onSubmit={saveRename}>
                    <input
                      aria-label="Page title"
                      value={draft}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button className="small-button" type="submit" disabled={!draft.trim()}>
                      Save
                    </button>
                    <button
                      className="small-button"
                      type="button"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </button>
                  </form>
                </li>
              );
            }
            if (confirming === id) {
              return (
                <li key={id} className="confirming">
                  <span>
                    Move <strong>{p.page.title}</strong> to the Recycle Bin?
                  </span>
                  <div className="actions">
                    <button
                      className="small-button danger"
                      autoFocus
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await useNotebook.getState().deletePage(tabId, id);
                          setConfirming(null);
                        })
                      }
                    >
                      Delete page
                    </button>
                    <button className="small-button" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li key={id}>
                <button
                  className={`page-open${isCurrent ? " current" : ""}`}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() => openPage(id)}
                >
                  <span className="num">{i + 1}</span>
                  <span className="text">
                    <span className="title">{p.page.title}</span>
                    <span className="edited">
                      {p.readOnly ? "Read-only" : editedLabel(p.page.updatedAt, now)}
                    </span>
                  </span>
                </button>
                <div className="row-actions">
                  <button
                    className="icon-button small"
                    aria-label={`Rename ${p.page.title}`}
                    title="Rename"
                    disabled={p.readOnly}
                    onClick={() => startRename(id, p.page.title)}
                  >
                    <PencilIcon size={16} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={`Duplicate ${p.page.title}`}
                    title="Duplicate"
                    disabled={p.readOnly || busy}
                    onClick={() =>
                      void run(async () => {
                        await useNotebook.getState().duplicatePage(tabId, id);
                        close();
                      })
                    }
                  >
                    <CopyIcon size={16} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={`Delete ${p.page.title}`}
                    title="Delete (moves to the Recycle Bin)"
                    disabled={p.readOnly}
                    onClick={() => {
                      setRenaming(null);
                      setConfirming(id);
                    }}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <footer>
        <button
          className="pill primary"
          disabled={busy || tab?.status !== "ok"}
          onClick={() =>
            void run(async () => {
              await useNotebook.getState().newPage();
              close();
            })
          }
        >
          <PlusIcon size={18} />
          New page
        </button>
      </footer>
    </div>
  );
}

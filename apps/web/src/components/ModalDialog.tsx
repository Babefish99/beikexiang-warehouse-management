import { type ReactNode, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const modalHistoryKey = "__warehouseModal";

type ModalHistoryEntry = {
  active: boolean;
  id: string;
  onBack(): void;
};

let historyOwner: ModalHistoryEntry | null = null;
let pendingHistoryEntry: ModalHistoryEntry | null = null;
let consumingHistoryEntry = false;
let listeningForHistory = false;

function activatePendingHistoryEntry(): void {
  if (historyOwner || consumingHistoryEntry || !pendingHistoryEntry) return;
  const entry = pendingHistoryEntry;
  pendingHistoryEntry = null;
  if (!entry.active) return;
  const currentState = history.state && typeof history.state === "object" ? history.state : {};
  history.pushState({ ...currentState, [modalHistoryKey]: entry.id }, "", location.href);
  historyOwner = entry;
}

function ensureHistoryListener(): void {
  if (listeningForHistory) return;
  window.addEventListener("popstate", () => {
    if (historyOwner) {
      const entry = historyOwner;
      historyOwner = null;
      entry.onBack();
      if (entry.active) pendingHistoryEntry = entry;
      window.setTimeout(activatePendingHistoryEntry, 0);
      return;
    }
    if (consumingHistoryEntry) {
      consumingHistoryEntry = false;
      activatePendingHistoryEntry();
    }
  });
  listeningForHistory = true;
}

function registerModalHistory(entry: ModalHistoryEntry): void {
  ensureHistoryListener();
  entry.active = true;
  pendingHistoryEntry = entry;
  activatePendingHistoryEntry();
}

function requestModalHistoryClose(entry: ModalHistoryEntry): void {
  if (!entry.active) return;
  if (historyOwner === entry && history.state?.[modalHistoryKey] === entry.id) {
    history.back();
    return;
  }
  if (pendingHistoryEntry === entry) pendingHistoryEntry = null;
  entry.onBack();
}

function unregisterModalHistory(entry: ModalHistoryEntry): void {
  entry.active = false;
  if (pendingHistoryEntry === entry) pendingHistoryEntry = null;
  if (historyOwner !== entry) return;
  historyOwner = null;
  if (history.state?.[modalHistoryKey] === entry.id) {
    consumingHistoryEntry = true;
    history.back();
  } else {
    activatePendingHistoryEntry();
  }
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.hasAttribute("hidden"));
}

function findFirstError(container: ParentNode): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"], [aria-invalid="true"]');
}

export function ModalDialog({
  open,
  title,
  children,
  confirmLabel,
  dangerous = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  dangerous?: boolean;
  busy?: boolean;
  onConfirm?(): void;
  onClose(): void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const requestCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = dialog ? getFocusableElements(dialog) : [];
    (focusable[0] ?? dialog)?.focus();
    let temporaryFocusTarget: { element: HTMLElement; previousTabIndex: string | null } | null = null;
    const restoreTemporaryTabIndex = () => {
      if (!temporaryFocusTarget) return;
      const { element, previousTabIndex } = temporaryFocusTarget;
      if (previousTabIndex === null) element.removeAttribute("tabindex");
      else element.setAttribute("tabindex", previousTabIndex);
      temporaryFocusTarget = null;
    };
    const focusError = (error: HTMLElement) => {
      if (temporaryFocusTarget?.element !== error) restoreTemporaryTabIndex();
      const nativelyFocusable = error.matches("a[href], button, input, select, textarea, [tabindex]");
      if (!nativelyFocusable) {
        temporaryFocusTarget = { element: error, previousTabIndex: error.getAttribute("tabindex") };
        error.tabIndex = -1;
      }
      error.focus({ preventScroll: true });
      error.scrollIntoView({ block: "nearest" });
    };
    const existingError = dialog ? findFirstError(dialog) : null;
    if (existingError) focusError(existingError);
    const observer = dialog ? new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          const target = record.target;
          const isError = target.matches('[role="alert"], [aria-invalid="true"]');
          if (isError) {
            focusError(target);
            return;
          }
          if (temporaryFocusTarget?.element === target) restoreTemporaryTabIndex();
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          const error = node.matches('[role="alert"], [aria-invalid="true"]') ? node : findFirstError(node);
          if (error) {
            focusError(error);
            return;
          }
        }
      }
    }) : null;
    observer?.observe(dialog!, { attributeFilter: ["aria-invalid", "role"], attributes: true, childList: true, subtree: true });

    const historyEntry: ModalHistoryEntry = {
      active: false,
      id: titleId,
      onBack: () => onCloseRef.current(),
    };
    requestCloseRef.current = () => requestModalHistoryClose(historyEntry);
    registerModalHistory(historyEntry);

    return () => {
      observer?.disconnect();
      restoreTemporaryTabIndex();
      unregisterModalHistory(historyEntry);
      requestCloseRef.current = onCloseRef.current;
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, titleId]);

  if (!open) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(event.currentTarget);
    if (!focusable.length) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeElement || !focusable.includes(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop modal-dialog-shell"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestCloseRef.current();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-dialog modal-dialog--shared"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header className="modal-dialog__header">
          <strong id={titleId}>{title}</strong>
          <button className="modal-dialog__close" type="button" aria-label={`关闭${title}`} onClick={() => requestCloseRef.current()}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-dialog__body">{children}</div>
        {confirmLabel ? (
          <footer className="modal-dialog__actions">
            <button className="button button--secondary" type="button" onClick={() => requestCloseRef.current()}>取消</button>
            <button
              className={`button ${dangerous ? "button--danger" : "button--primary"}`}
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

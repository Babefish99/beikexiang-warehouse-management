import {
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useRef,
} from "react";
import { X } from "lucide-react";

const modalHistoryKey = "__warehouseModal";

type ModalHistoryEntry = {
  active: boolean;
  id: string;
  canDismiss(): boolean;
  onBack(): void;
};

const historyOwners: ModalHistoryEntry[] = [];
let sentinelActive = false;
let consumingSentinel = false;
let pendingNavigation: { entry: ModalHistoryEntry; href: string } | null = null;
let navigationInProgress = false;
let listeningForHistory = false;

function topHistoryOwner(): ModalHistoryEntry | null {
  return historyOwners.at(-1) ?? null;
}

function ensureHistorySentinel(): void {
  if (sentinelActive || consumingSentinel || navigationInProgress || !historyOwners.length) return;
  const entry = topHistoryOwner()!;
  const currentState = history.state && typeof history.state === "object" ? history.state : {};
  history.pushState({ ...currentState, [modalHistoryKey]: entry.id }, "", location.href);
  sentinelActive = true;
}

function removeHistoryOwner(entry: ModalHistoryEntry): void {
  entry.active = false;
  const index = historyOwners.lastIndexOf(entry);
  if (index >= 0) historyOwners.splice(index, 1);
}

function dismissHistoryOwner(entry: ModalHistoryEntry): boolean {
  if (!entry.active || !entry.canDismiss()) return false;
  removeHistoryOwner(entry);
  entry.onBack();
  return true;
}

function ensureHistoryListener(): void {
  if (listeningForHistory) return;
  window.addEventListener("popstate", () => {
    sentinelActive = false;
    if (pendingNavigation) {
      const navigation = pendingNavigation;
      pendingNavigation = null;
      consumingSentinel = false;
      navigationInProgress = true;
      dismissHistoryOwner(navigation.entry);
      window.location.assign(navigation.href);
      return;
    }
    if (consumingSentinel) {
      consumingSentinel = false;
      ensureHistorySentinel();
      return;
    }
    const entry = topHistoryOwner();
    if (!entry) return;
    if (!dismissHistoryOwner(entry)) {
      ensureHistorySentinel();
      return;
    }
    ensureHistorySentinel();
  });
  listeningForHistory = true;
}

function registerModalHistory(entry: ModalHistoryEntry): void {
  ensureHistoryListener();
  if (entry.active) return;
  entry.active = true;
  historyOwners.push(entry);
  ensureHistorySentinel();
}

function requestModalHistoryClose(entry: ModalHistoryEntry): void {
  if (!entry.active || !entry.canDismiss()) return;
  if (consumingSentinel) {
    dismissHistoryOwner(entry);
    return;
  }
  if (topHistoryOwner() === entry && sentinelActive && history.state?.[modalHistoryKey]) {
    history.back();
    return;
  }
  dismissHistoryOwner(entry);
}

function unregisterModalHistory(entry: ModalHistoryEntry): void {
  removeHistoryOwner(entry);
  if (historyOwners.length) {
    ensureHistorySentinel();
    return;
  }
  if (!navigationInProgress && sentinelActive && history.state?.[modalHistoryKey]) {
    consumingSentinel = true;
    history.back();
  }
}

function navigateFromModal(entry: ModalHistoryEntry, href: string): void {
  if (!entry.active) {
    window.location.assign(href);
    return;
  }
  if (consumingSentinel) {
    pendingNavigation = { entry, href };
    return;
  }
  if (sentinelActive && history.state?.[modalHistoryKey]) {
    pendingNavigation = { entry, href };
    history.back();
    return;
  }
  navigationInProgress = true;
  dismissHistoryOwner(entry);
  window.location.assign(href);
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
  const busyRef = useRef(busy);
  const historyEntryRef = useRef<ModalHistoryEntry | null>(null);
  const requestCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  busyRef.current = busy;

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
      canDismiss: () => !busyRef.current,
      onBack: () => onCloseRef.current(),
    };
    historyEntryRef.current = historyEntry;
    requestCloseRef.current = () => requestModalHistoryClose(historyEntry);
    registerModalHistory(historyEntry);

    return () => {
      observer?.disconnect();
      restoreTemporaryTabIndex();
      unregisterModalHistory(historyEntry);
      if (historyEntryRef.current === historyEntry) historyEntryRef.current = null;
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

  const navigateInternalLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    if (target.hasAttribute("download") || (target.target && target.target.toLowerCase() !== "_self")) return;

    const url = new URL(target.href, window.location.href);
    if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) return;
    const historyEntry = historyEntryRef.current;
    if (!historyEntry) return;

    event.preventDefault();
    navigateFromModal(historyEntry, url.href);
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
        onClick={navigateInternalLink}
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

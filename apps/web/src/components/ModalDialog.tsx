import { type ReactNode, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

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

function focusError(error: HTMLElement): void {
  if (!error.matches(focusableSelector)) error.tabIndex = -1;
  error.focus({ preventScroll: true });
  error.scrollIntoView({ block: "nearest" });
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

  useEffect(() => {
    if (!open) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = dialog ? getFocusableElements(dialog) : [];
    (focusable[0] ?? dialog)?.focus();
    const existingError = dialog ? findFirstError(dialog) : null;
    if (existingError) focusError(existingError);
    const observer = dialog ? new MutationObserver((records) => {
      for (const node of records.flatMap((record) => Array.from(record.addedNodes))) {
        if (!(node instanceof HTMLElement)) continue;
        const error = node.matches('[role="alert"], [aria-invalid="true"]') ? node : findFirstError(node);
        if (error) {
          focusError(error);
          return;
        }
      }
    }) : null;
    observer?.observe(dialog!, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
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
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop modal-dialog-shell"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
          <button className="modal-dialog__close" type="button" aria-label={`关闭${title}`} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-dialog__body">{children}</div>
        {confirmLabel ? (
          <footer className="modal-dialog__actions">
            <button className="button button--secondary" type="button" onClick={onClose}>取消</button>
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

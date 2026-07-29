import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

import { registerDialog } from './dialog-stack';

export function Modal({
  children,
  className = '',
  label,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const unregister = registerDialog({ close: () => onCloseRef.current() });

    const previouslyFocused = document.activeElement;
    // A timer rather than an animation frame: a dialog opened while the tab is
    // in the background must still start with focus inside it, or the focus
    // trap has nothing to trap.
    const timer = window.setTimeout(() => {
      const card = cardRef.current;
      const target =
        card?.querySelector<HTMLElement>('[data-autofocus="true"]') ??
        card?.querySelector<HTMLElement>('[data-focusable="true"]:not(:disabled)');
      target?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      unregister();
      // Return focus to whatever opened the dialog, when it is still on screen.
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;

    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        '[data-focusable="true"]:not(:disabled)',
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={label}
        aria-modal="true"
        className={`modal-card ${className}`}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
        ref={cardRef}
        role="dialog"
      >
        <button
          aria-label={`Close ${label}`}
          className="modal-close focusable"
          data-focusable="true"
          onClick={onClose}
        >
          ×
        </button>
        {children}
      </section>
    </div>
  );
}

export type ConfirmRequest = {
  /** Sentence explaining exactly what the confirmed action will do. */
  body: string;
  confirmLabel: string;
  /** Destructive confirmations start focused on Cancel. */
  danger?: boolean;
  eyebrow: string;
  onConfirm: () => void;
  title: string;
};

export function ConfirmDialog({
  busy,
  onCancel,
  request,
}: {
  busy: boolean;
  onCancel: () => void;
  request: ConfirmRequest;
}) {
  return (
    <Modal className="modal-confirm" label={request.title} onClose={onCancel}>
      <p className="eyebrow">{request.eyebrow}</p>
      <h2>{request.title}</h2>
      <p className="modal-copy">{request.body}</p>
      <div className="modal-actions">
        <button
          className="secondary-button focusable"
          data-autofocus={request.danger ? 'true' : undefined}
          data-focusable="true"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          aria-busy={busy}
          className={`primary-button focusable ${request.danger ? 'danger-confirm' : ''}`}
          data-autofocus={request.danger ? undefined : 'true'}
          data-focusable="true"
          disabled={busy}
          onClick={request.onConfirm}
          type="button"
        >
          {busy ? 'Working…' : request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

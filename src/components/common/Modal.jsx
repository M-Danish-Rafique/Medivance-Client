import React, { useEffect, useId, useRef } from 'react';

// Anything focusable inside the dialog, in DOM order — the set the Tab trap
// cycles through and the first of which takes focus when the dialog opens.
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Modal({ isOpen, onClose, title, children, size = 'md', footer }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  // Callers pass an inline onClose, so it is held in a ref: the setup below
  // must run once per open, not on every render of the parent.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = '';
      return undefined;
    }
    document.body.style.overflow = 'hidden';

    // Where focus came from, so closing returns it there rather than to the
    // top of the page.
    restoreRef.current = document.activeElement;

    const dialog = dialogRef.current;
    // React has already honoured any autoFocus by now; only take focus when
    // nothing inside the dialog has it — and then the DIALOG takes it, not its
    // first control. Focusing the first control rings the × button, which
    // makes dismissing look like the main action.
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // A field inside the dialog may claim Escape first (the area picker
        // clears its search with it) by stopping propagation.
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      // Focus trap: Tab past the last control wraps to the first, and
      // Shift+Tab before the first wraps to the last, so focus can never
      // land on the page behind an open dialog.
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) restore.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id={titleId}>{title}</div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">close</span>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

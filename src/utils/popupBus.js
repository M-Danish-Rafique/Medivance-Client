import { useEffect, useRef } from 'react';

// ─── One open popup at a time ──────────────────────────────────────────────
// Dropdowns, kebab menus and date calendars announce themselves when they
// open; every other open one closes. Outside clicks are handled by each
// component; this covers opening a second menu from the keyboard or from a
// trigger that stops the mousedown.
const EVENT = 'app:popup-open';

export function useExclusivePopup(open, close) {
  const token = useRef({});
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return undefined;
    const mine = token.current;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: mine }));
    const onOther = (e) => { if (e.detail !== mine) closeRef.current(); };
    window.addEventListener(EVENT, onOther);
    return () => window.removeEventListener(EVENT, onOther);
  }, [open]);
}

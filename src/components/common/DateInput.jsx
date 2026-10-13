import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { todayPKT } from '../../utils/dateUtils';
import { useExclusivePopup } from '../../utils/popupBus';

// ─── Date field: always dd/mm/yyyy ─────────────────────────────────────────
// A drop-in for <input type="date">. The browser's own date field follows the
// browser language (mm/dd/yyyy on an English-US browser), so every date in
// the app is entered here instead: typed as dd/mm/yyyy (the slashes fill in
// as you type) or picked from the calendar button.
//
// Same contract as the native field, so call sites only change the tag:
//   value     'YYYY-MM-DD' or ''
//   onChange  receives { target: { value: 'YYYY-MM-DD' | '', name, id } }
//   min, max, disabled, required, id, name, className, style, onBlur, autoFocus
// onChange fires only for a complete, real date (or for an emptied field), so
// a half-typed date never reaches the form; on blur an incomplete entry falls
// back to the last valid value.
//
// Layout keys in `style` (width, flex…) go on the wrapper so the field sizes
// exactly as the native input did; everything else stays on the input.

const LAYOUT_KEYS = new Set([
  'width', 'minWidth', 'maxWidth', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'alignSelf', 'gridColumn', 'justifySelf',
]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10));

/** 'YYYY-MM-DD…' -> 'dd/mm/yyyy' */
export function toDisplay(iso) {
  if (!isIso(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** 'dd/mm/yyyy' -> 'YYYY-MM-DD' for a real calendar date, else null. */
export function fromDisplay(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || '').trim());
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2999) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return isoOf(y, m, d);
}

/** Digits typed so far -> "dd/mm/yyyy" with the slashes filled in. */
function mask(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function monthGrid(year, month) {
  // Monday-first grid of 6 weeks for the given month (month 1–12).
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month - 1, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86400000);
    return { iso: isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 };
  });
}

function shiftIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function shiftMonth(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return isoOf(ny, nm, Math.min(d, last));
}

export default function DateInput({
  value, onChange, onBlur, min, max, disabled, readOnly, required, id, name, className = 'form-control',
  style, autoFocus, placeholder = 'dd/mm/yyyy', invalid, title, onKeyDown,
  'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy,
}) {
  const current = isIso(value) ? value.slice(0, 10) : '';
  const [text, setText] = useState(toDisplay(current));
  const [open, setOpen] = useState(false);
  const [focusIso, setFocusIso] = useState(current || todayPKT());
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const popRef = useRef(null);
  const dayRefs = useRef({});
  const popId = useId();

  // The parent changed the value (or reset the form): show it. `text` is left
  // out of the dependencies on purpose (typing must not be overwritten). No
  // eslint-disable directive: this project's ESLint config does not register
  // eslint-plugin-react-hooks, and Vercel's CI build fails on unknown rules.
  useEffect(() => {
    if (fromDisplay(text) !== current) setText(toDisplay(current));
  }, [current]);

  useExclusivePopup(open, () => setOpen(false));

  const emit = useCallback((iso) => {
    if (onChange) onChange({ target: { value: iso, name, id }, currentTarget: { value: iso, name, id } });
  }, [onChange, name, id]);

  const outOfRange = (iso) => (min && iso < min) || (max && iso > max);
  const typedIso = fromDisplay(text);
  const badText = text.length > 0 && (text.length === 10 ? !typedIso : false);
  const showInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true' || badText || (typedIso && outOfRange(typedIso));

  const handleChange = (e) => {
    const raw = e.target.value;
    // Deleting: keep exactly what is left so a slash can be removed.
    const next = raw.length < text.length ? raw.replace(/[^\d/]/g, '') : mask(raw);
    setText(next);
    if (next === '') { emit(''); return; }
    const iso = fromDisplay(next);
    if (iso) emit(iso);
  };

  const handleBlur = (e) => {
    const to = e.relatedTarget;
    if (open && (wrapRef.current?.contains(to) || popRef.current?.contains(to))) return;
    if (text && !fromDisplay(text)) setText(toDisplay(current));
    if (onBlur) onBlur(e);
  };

  const pick = (iso) => {
    if (outOfRange(iso)) return;
    setText(toDisplay(iso));
    emit(iso);
    setOpen(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  const openCalendar = () => {
    if (disabled || readOnly) return;
    setFocusIso(typedIso || current || (max && todayPKT() > max ? max : min && todayPKT() < min ? min : todayPKT()));
    setOpen(true);
  };

  // ── Popover placement (portal, fixed, above dialogs) ──
  const place = useCallback(() => {
    const anchor = wrapRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = popRef.current ? popRef.current.offsetHeight : 330;
    const w = 280;
    const below = window.innerHeight - r.bottom - 12;
    const up = below < h && r.top > below;
    setPos({
      left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))),
      top: up ? 'auto' : Math.round(r.bottom + 5),
      bottom: up ? Math.round(window.innerHeight - r.top + 5) : 'auto',
    });
  }, []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep keyboard focus on the focused day while the calendar is open.
  useEffect(() => {
    if (open && pos) dayRefs.current[focusIso]?.focus({ preventScroll: true });
  }, [open, pos, focusIso]);

  const [fy, fm] = focusIso.split('-').map(Number);
  const grid = useMemo(() => monthGrid(fy, fm), [fy, fm]);
  const today = todayPKT();

  const onGridKey = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key]) { e.preventDefault(); setFocusIso(shiftIso(focusIso, moves[e.key])); }
    else if (e.key === 'PageUp') { e.preventDefault(); setFocusIso(shiftMonth(focusIso, e.shiftKey ? -12 : -1)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setFocusIso(shiftMonth(focusIso, e.shiftKey ? 12 : 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIso(shiftIso(focusIso, -((new Date(`${focusIso}T00:00:00Z`).getUTCDay() + 6) % 7))); }
    else if (e.key === 'End') { e.preventDefault(); setFocusIso(shiftIso(focusIso, 6 - ((new Date(`${focusIso}T00:00:00Z`).getUTCDay() + 6) % 7))); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focusIso); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); inputRef.current?.focus({ preventScroll: true }); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  const wrapStyle = {};
  const inputStyle = {};
  Object.entries(style || {}).forEach(([k, v]) => { (LAYOUT_KEYS.has(k) ? wrapStyle : inputStyle)[k] = v; });

  return (
    <div className={`date-input${wrapStyle.width !== undefined ? ' has-width' : ''}`} ref={wrapRef} style={wrapStyle}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={`${className}${showInvalid ? ' is-date-invalid' : ''}`}
        style={inputStyle}
        value={text}
        placeholder={placeholder}
        maxLength={10}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        autoFocus={autoFocus}
        title={title}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={showInvalid ? 'true' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' && e.altKey) || (e.key === 'ArrowDown' && !open && !text)) { e.preventDefault(); openCalendar(); return; }
          if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); return; }
          if (onKeyDown) onKeyDown(e);
        }}
      />
      <button
        type="button"
        className="date-input-btn"
        tabIndex={-1}
        aria-label="Open calendar"
        title="Open calendar"
        disabled={disabled || readOnly}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openCalendar())}
      >
        <span className="material-symbols-outlined" aria-hidden="true">calendar_month</span>
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          className="date-pop"
          role="dialog"
          aria-label="Choose a date"
          style={pos ? { ...pos } : { visibility: 'hidden' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="date-pop-head">
            <button type="button" className="date-pop-nav" aria-label="Previous month" onClick={() => setFocusIso(shiftMonth(focusIso, -1))}>
              <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
            </button>
            <div className="date-pop-title" aria-live="polite">{MONTHS[fm - 1]} {fy}</div>
            <button type="button" className="date-pop-nav" aria-label="Next month" onClick={() => setFocusIso(shiftMonth(focusIso, 1))}>
              <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          </div>
          <div className="date-pop-grid" role="grid" onKeyDown={onGridKey}>
            {WEEKDAYS.map(w => <div key={w} className="date-pop-wd" role="columnheader">{w}</div>)}
            {grid.map(cell => {
              const disabledDay = outOfRange(cell.iso);
              const cls = [
                'date-pop-day',
                cell.inMonth ? '' : 'is-out',
                cell.iso === current ? 'is-selected' : '',
                cell.iso === today ? 'is-today' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={cell.iso}
                  ref={el => { dayRefs.current[cell.iso] = el; }}
                  type="button"
                  role="gridcell"
                  className={cls}
                  tabIndex={cell.iso === focusIso ? 0 : -1}
                  aria-selected={cell.iso === current}
                  aria-label={`${cell.day} ${MONTHS[Number(cell.iso.slice(5, 7)) - 1]} ${cell.iso.slice(0, 4)}`}
                  disabled={disabledDay}
                  onClick={() => pick(cell.iso)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="date-pop-link" disabled={outOfRange(today)} onClick={() => pick(today)}>Today</button>
            {!required && current && (
              <button type="button" className="date-pop-link" onClick={() => { setText(''); emit(''); setOpen(false); }}>Clear</button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

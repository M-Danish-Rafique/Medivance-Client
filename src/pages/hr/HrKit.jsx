import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { HR_STYLES } from './hrStyles';
import { formatDatePKT } from '../../utils/dateUtils';
import { formatDecimal } from '../../utils/formatters';

// ─── Workforce Management UI kit ───────────────────────────────────────────
// Pieces shared by three or more HR screens. Kept inside pages/hr rather than
// components/common because none of it is app-wide yet — components/common is
// reserved for primitives every module uses (Modal, Pagination, ...). Where an
// app-wide primitive already exists (Modal, ConfirmModal, Pagination,
// TaxIdInput, LocationSelect, the .btn/.badge/.form-control classes) the HR
// pages use it directly instead of anything here.
//
// Everything is defined at module scope, per the convention noted in
// Purchase.jsx and AppLayout: components declared inside a page component get
// remounted on every render and silently drop input focus.

// ── Style injection ────────────────────────────────────────────────────────
// Rendered once per HR page, exactly like Customers.jsx's local <style> block.
export function HrStyles() {
  return <style dangerouslySetInnerHTML={{ __html: HR_STYLES }} />;
}

// ── Formatting helpers ─────────────────────────────────────────────────────
// DECIMALs arrive from MySQL as strings, so everything goes through parseFloat
// before it is formatted or compared.
export const num = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const money = (value) => Math.round(num(value) * 100) / 100;

// Payroll always shows both decimal places. The app-wide formatCurrency /
// formatDecimal use `minimumFractionDigits: 0`, so 0 renders as "PKR 0" and
// 1500 as "PKR 1,500" — acceptable for stock counts, wrong for pay. These are
// the money formatters for this module only; everything non-monetary still
// goes through the shared helpers.
const decimals2 = (value) => num(value).toLocaleString('en-PK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtMoney = (value) => `PKR ${decimals2(value)}`;

/** Money without the PKR prefix — for dense table columns and payslip rows. */
export const fmtAmount = (value) => decimals2(value);

export const fmtDate = (value) => (value ? formatDatePKT(value) : '—');

/** "2026-09" -> "September 2026". Pure string math, no Date parsing. */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function fmtMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return '—';
  const [year, mm] = month.split('-');
  return `${MONTH_NAMES[Number(mm) - 1] || mm} ${year}`;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Banking validation ─────────────────────────────────────────────────────
// Both run only when the field has a value: banking details are optional on a
// profile, but if they are entered they have to be usable for a transfer.

/** Pakistani IBAN: PK + 2 check digits + 4-letter bank code + 16 alphanumeric
 *  = 24 characters. Stored and compared without spaces, upper case. */
export function ibanError(raw) {
  const value = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!value) return null;
  if (!/^PK/.test(value)) return 'A Pakistani IBAN starts with PK';
  if (value.length !== 24) {
    const diff = 24 - value.length;
    return diff > 0
      ? `IBAN must be 24 characters — ${diff} more to go`
      : `IBAN must be 24 characters — ${-diff} too many`;
  }
  if (!/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(value)) {
    return 'Check the IBAN — expected PK, 2 digits, a 4-letter bank code, then 16 characters';
  }
  return null;
}

/** Account numbers vary by bank, so only the shape is enforced: digits and
 *  dashes, 8–20 digits long. */
export function accountNumberError(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!/^[0-9-]+$/.test(value)) return 'Account number can contain digits and dashes only';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return 'Account number must be 8 to 20 digits';
  return null;
}

/** Stop a scroll wheel from silently changing a focused number input.
 *  Same one-liner as recoveryUtils.blockWheelChange — duplicated rather than
 *  imported so the HR module does not depend on the Recovery module. */
export const blockWheelChange = (e) => e.target.blur();

/** Pull a field-level message out of an axios error, falling back to copy we
 *  control — never a bare "Error". */
export function apiError(err, fallback) {
  return err?.response?.data?.message || fallback || 'Something went wrong. Please try again.';
}

/** The server answers field-level validation failures with { field, message };
 *  this maps one straight onto a form's error state. */
export function apiFieldError(err) {
  const data = err?.response?.data;
  if (data && data.field && data.message) return { [data.field]: data.message };
  return null;
}

// ── Sorting ────────────────────────────────────────────────────────────────
export function useSort(defaultColumn, defaultDirection = 'asc') {
  const [sortConfig, setSortConfig] = useState({ column: defaultColumn, direction: defaultDirection });

  const handleSort = useCallback((column) => {
    setSortConfig(prev => (
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
    ));
  }, []);

  // `onSort` is the same function under the name SortableHeader expects, so a
  // caller can either wire the two props by hand or spread the whole hook
  // result onto the header.
  return { sortConfig, handleSort, onSort: handleSort };
}

export function sortRows(rows, sortConfig, comparators) {
  const cmp = comparators[sortConfig.column];
  if (!cmp) return rows;
  const dir = sortConfig.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => cmp(a, b) * dir);
}

export const byText = (key) => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
export const byNumber = (key) => (a, b) => num(a[key]) - num(b[key]);

/** Sortable <th>. aria-sort is what a screen reader announces; the chevron is
 *  the visible equivalent. Operable by keyboard because it is a real button. */
export function SortableHeader({ column, label, sortConfig, onSort, align, style }) {
  const active = sortConfig.column === column;
  const icon = active
    ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward')
    : 'unfold_more';
  const isRight = align === 'right';

  return (
    <th
      className={`hr-sort-th${isRight ? ' hr-th-num' : ''}`}
      style={style}
      aria-sort={active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(column)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(column); }
      }}
      tabIndex={0}
      role="columnheader"
      title={`Sort by ${label}`}
    >
      <span className="hr-sort-label" style={{ justifyContent: isRight ? 'flex-end' : 'flex-start' }}>
        {label}
        <span className="hr-sort-icon material-symbols-outlined" aria-hidden="true">{icon}</span>
      </span>
    </th>
  );
}

// ── Segmented filter ───────────────────────────────────────────────────────
export function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div className="hr-segment" role="group" aria-label={ariaLabel || 'Filter'}>
      {options.map(option => (
        <button
          key={option.val}
          type="button"
          className={`hr-segment-btn${value === option.val ? ' is-active' : ''}`}
          aria-pressed={value === option.val}
          onClick={() => onChange(option.val)}
        >
          {option.label}
          {option.count !== undefined && <span className="hr-segment-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Kebab (row actions) menu ───────────────────────────────────────────────
// Fully keyboard operable: Enter/Space or ArrowDown opens and focuses the
// first item, arrows move, Escape closes and returns focus to the trigger,
// and a click anywhere else dismisses it.
//
// The menu is PORTALLED to <body> and positioned `fixed` from the trigger's
// viewport rect. As an absolutely-positioned child it lived inside
// `.hr-table-scroll` (overflow:auto, max-height:68vh), which meant a menu
// opened on the last row was clipped by the container — and focusing its
// first item made the browser scroll that item into view, dragging the whole
// table up under the operator's cursor. Out in the body it is clipped by
// nothing, so nothing has to move: it simply opens upward when the viewport
// has no room below.
//
// The trade for `fixed` is that the menu no longer travels with its row, so
// the position is recomputed on any scroll (capture phase, to catch scrolling
// containers as well as the window) and on resize.
const KEBAB_ITEM_H = 35;   // one .hr-kebab-item, including its padding
const KEBAB_PAD_H   = 12;  // the menu's own padding + borders
const KEBAB_GAP     = 4;   // between trigger and menu
const KEBAB_MARGIN  = 8;   // smallest gap the menu keeps from a viewport edge
const KEBAB_MIN_H   = 96;  // below this, scrolling the menu beats shrinking it

function useAnchoredMenu(open, triggerRef, menuRef, itemCount) {
  const [style, setStyle] = useState(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Measured once the menu is mounted; until then, derived from the item
    // count, which is accurate enough that the side never visibly flips.
    const height = menuRef.current
      ? menuRef.current.offsetHeight
      : itemCount * KEBAB_ITEM_H + KEBAB_PAD_H;
    const below = window.innerHeight - rect.bottom - KEBAB_GAP;
    const above = rect.top - KEBAB_GAP;
    // Only drop upward when below genuinely cannot hold it AND above holds
    // more, so the menu does not flip for the sake of a few pixels.
    const dropUp = below < height && above > below;
    const room = (dropUp ? above : below) - KEBAB_MARGIN;
    setStyle({
      top: dropUp ? undefined : Math.round(rect.bottom + KEBAB_GAP),
      bottom: dropUp ? Math.round(window.innerHeight - rect.top + KEBAB_GAP) : undefined,
      // Right-aligned to the trigger, clamped so it can never hang off-screen.
      right: Math.round(Math.max(KEBAB_MARGIN, window.innerWidth - rect.right)),
      maxHeight: Math.round(Math.max(KEBAB_MIN_H, room)),
    });
  }, [triggerRef, menuRef, itemCount]);

  useLayoutEffect(() => {
    if (!open) { setStyle(null); return undefined; }
    place();
    // A second pass once the menu has laid out and its real height is known.
    const raf = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return style;
}

export function KebabMenu({ items, label = 'Row actions' }) {
  const [open, setOpen] = useState(false);
  const wrapRef    = useRef(null);
  const menuRef    = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs   = useRef([]);

  const menuId = useId();
  const menuStyle = useAnchoredMenu(open, triggerRef, menuRef, items.length);

  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      const inTrigger = wrapRef.current && wrapRef.current.contains(e.target);
      const inMenu    = menuRef.current && menuRef.current.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const focusedRef = useRef(false);
  useEffect(() => {
    if (!open) { focusedRef.current = false; return; }
    // The portal mounts a render after `open` flips, so this runs again when
    // `menuStyle` lands; the ref keeps it to one focus per open.
    if (focusedRef.current || !itemRefs.current[0]) return;
    // preventScroll matters: without it, focusing the first item scrolls the
    // nearest scrollable ancestor to reveal a menu that is already fully
    // visible, which is exactly the jump this component used to have.
    itemRefs.current[0].focus({ preventScroll: true });
    focusedRef.current = true;
  }, [open, menuStyle]);

  const onMenuKeyDown = (e) => {
    // The row underneath treats Enter as "open this profile"; an Enter
    // meant for a menu item must never reach it.
    e.stopPropagation();
    const focusables = itemRefs.current.filter(Boolean);
    const index = focusables.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(index + 1) % focusables.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(index - 1 + focusables.length) % focusables.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'Tab') { close(false); }
  };

  return (
    <div
      className="hr-kebab"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-outline btn-sm btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">more_vert</span>
      </button>

      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="hr-kebab-menu"
          role="menu"
          aria-label={label}
          style={menuStyle}
          /* The portal escapes the row, so the row's click handler no longer
             sees these clicks — but a stray one would still reach the page. */
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              className={`hr-kebab-item${item.danger ? ' is-danger' : ''}`}
              onClick={() => { close(false); item.onClick(); }}
            >
              {item.icon && <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Loading skeletons ──────────────────────────────────────────────────────
// Shaped like the eventual content so the page does not reflow when data
// lands, and the user can read the structure while waiting.
export function TableSkeleton({ columns = 5, rows = 6 }) {
  // Varied widths read as text rather than as a block of identical bars.
  const widths = ['70%', '85%', '55%', '75%', '60%', '80%'];
  return (
    <table className="hr-table" aria-hidden="true">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }).map((__, c) => (
              <td key={c}>
                <div className="hr-skel hr-skel-text" style={{ width: widths[(r + c) % widths.length] }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FieldGridSkeleton({ fields = 8, cols = 4 }) {
  return (
    <div className={`hr-kv hr-kv-${cols}`} aria-hidden="true">
      {Array.from({ length: fields }).map((_, i) => (
        <div className="hr-kv-row" key={i}>
          <div className="hr-skel hr-skel-text" style={{ width: 64, height: 9 }} />
          <div className="hr-skel hr-skel-text" style={{ width: i % 2 ? '62%' : '84%' }} />
        </div>
      ))}
    </div>
  );
}

// ── Empty states ───────────────────────────────────────────────────────────
// Always a reason and a next step; never a bare "No data".
export function EmptyState({ icon = 'inbox', title, desc, action, small }) {
  return (
    <div className={`hr-empty${small ? ' hr-empty-sm' : ''}`}>
      <div className="hr-empty-icon">
        <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      </div>
      <div className="hr-empty-title">{title}</div>
      {desc && <div className="hr-empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

// ── Tabbed navigation ────────────────────────────────────────
// Replaces the stack of collapsible sections the profile used to be. Six
// accordions meant the answer to "what is this person paid?" was always a
// scroll and a click away, and an accordion remembers nothing about where the
// reader was. Three tabs put every group one click from any other, at a fixed
// position on the page.
//
// Full APG tab semantics: roving tabindex, arrow/Home/End keys, and the panel
// owned by its tab through aria-controls / aria-labelledby.
//
// `alert` marks a tab holding a field that failed validation, so a blocked
// save on a tab the user cannot see is still visible. It is never colour
// alone — the dot carries a visually-hidden label.
export function Tabs({ tabs, value, onChange, ariaLabel }) {
  const refs = useRef({});

  const onKeyDown = (e) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const i = tabs.findIndex(t => t.value === value);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === 'Home' ? tabs[0]
      : tabs[tabs.length - 1];
    onChange(next.value);
    const node = refs.current[next.value];
    if (node) node.focus();
  };

  return (
    <div className="hr-tabs" role="tablist" aria-label={ariaLabel || 'Profile sections'} onKeyDown={onKeyDown}>
      {tabs.map(tab => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`hrtab-${tab.value}`}
            ref={(node) => { refs.current[tab.value] = node; }}
            className={`hr-tab${active ? ' is-active' : ''}`}
            aria-selected={active}
            /* Only the selected tab's panel is mounted, so only the selected
               tab may point at one — aria-controls naming a missing id is
               worse than no aria-controls at all. */
            aria-controls={active ? `hrpanel-${tab.value}` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
          >
            {tab.icon && <span className="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>}
            {tab.label}
            {tab.alert && (
              <>
                <span className="hr-tab-alert" aria-hidden="true" />
                <span className="hr-sr-only">needs attention</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, children }) {
  return (
    <div
      id={`hrpanel-${value}`}
      role="tabpanel"
      aria-labelledby={`hrtab-${value}`}
      tabIndex={-1}
      className="hr-tabpanel"
    >
      {children}
    </div>
  );
}

// ── Panel card ───────────────────────────────────────────────
// One group of related fields. Deliberately NOT collapsible: a tab already
// decides what is on screen, and a collapse inside a tab is a second place to
// hide the same data.
//
// `status` is a short factual value (a total, a count) rendered INLINE with
// the title. There is deliberately no descriptive subtitle: a sentence under
// every header competes with the field labels inside the card for attention.
export function Panel({ icon, title, status, actions, children }) {
  return (
    <section className="hr-panel">
      <div className="hr-panel-head">
        {icon && (
          <span className="hr-panel-icon">
            <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
          </span>
        )}
        <h2 className="hr-panel-title">{title}</h2>
        {status && <span className="hr-panel-status">{status}</span>}
        {actions && <div className="hr-panel-actions">{actions}</div>}
      </div>
      <div className="hr-panel-body">{children}</div>
    </section>
  );
}

// ── Tinted pill ────────────────────────────────────────────────────────────
// A short attribute shown beside a record's name ("Field staff"). Tinted
// ground, no border: on a line that already carries the name and a status
// badge, a third outlined object turns the heading into a row of boxes.
// Replaces the bordered <Chip>, which put an edge around every system fact
// and made none of them stand out.
export function Pill({ icon, tone, children, title }) {
  return (
    <span className={`hr-pill${tone ? ` hr-pill-${tone}` : ''}`} title={title}>
      {icon && <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

// ── Read-only field grid ───────────────────────────────────────────────────
// A real <dl> on a strict equal-width column track, label stacked directly
// above its value. Two layouts were tried before this one and both failed the
// same way: a free-form 12-column span grid left every pair at a different
// indent, and a label-left rail bought straight columns at the cost of a
// 150px gutter repeated four times across a wide card. A strict track gives
// both — every label starts at the same x, every value starts at the same x,
// and the full width goes to the data.
//
// `cols` is the widest layout; the stylesheet halves it, then stacks it.
export function FieldGrid({ cols = 2, children }) {
  return <dl className={`hr-kv hr-kv-${cols}`}>{children}</dl>;
}

// One label/value pair.
//
// `span` lets a long value (an address, a reason for leaving) take 2, 3 or
// all columns. Spanning fields belong at the END of a grid: the row rules are
// suppressed on the opening row by child index, which assumes the first row
// is full-width fields.
//
// An unset field says "Not provided" in muted italics rather than printing a
// dash. A dash reads as a rendering failure — operators asked whether the
// page had broken — and the phrasing makes the blank deliberate. It sets at
// --gray-500 (4.76:1 on white, WCAG AA); the grey-on-grey --gray-300 that an
// earlier version used was about 1.6:1 and was the real problem with saying
// it in words.
export function Field({ label, value, mono, wide, span, empty: emptyText = 'Not provided' }) {
  const empty = value === null || value === undefined || value === '' || value === '—';
  const spanClass = wide || span === 'full' ? ' is-wide' : span ? ` is-span-${span}` : '';
  return (
    <div className={`hr-kv-row${spanClass}`}>
      <dt className="hr-kv-label">{label}</dt>
      <dd className={`hr-kv-value${empty ? ' is-empty' : ''}${mono && !empty ? ' hr-mono' : ''}`}>
        {empty ? emptyText : value}
      </dd>
    </div>
  );
}

// ── Editable field wrapper ─────────────────────────────────────────────────
// Real <label for> association plus a fixed-height message slot below the
// control, so an appearing error never reflows the grid and one field's
// message never crowds the next field's label.
//
// `help` is for a format that genuinely cannot be inferred. Most fields need
// none: a placeholder already shows the shape, and a line of grey text under
// every input is noise. Errors are what the slot is really for.
export function FormField({ label, htmlFor, required, help, error, children, col = 3 }) {
  return (
    <div className={`hr-col-${col}`}>
      <label className="form-label" htmlFor={htmlFor}>
        {label}{required && <span className="hr-required" aria-hidden="true">*</span>}
      </label>
      {children}
      <div className="hr-field-msg">
        {error
          ? (
            <div className="hr-error" role="alert">
              <span className="material-symbols-outlined" aria-hidden="true">error</span>
              <span>{error}</span>
            </div>
          )
          : help
            ? <div className="hr-help">{help}</div>
            : null}
      </div>
    </div>
  );
}

// ── Custom select ──────────────────────────────────────────────────────────
// A native <select> renders options as plain text, so an option carrying
// metadata ("August 2026" + a status) has to cram it into the same string and
// comes out cramped and unaligned. This lays the label and a status badge out
// properly. Keyboard: Enter/Space/ArrowDown opens, arrows move, Escape closes.
//
// Options: [{ value, label, badge?, badgeTone? }]
export function Select({ id, value, onChange, options, ariaLabel, minWidth }) {
  const [open, setOpen] = useState(false);
  const wrapRef    = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs   = useRef([]);

  const selected = options.find(o => String(o.value) === String(value)) || null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, options.findIndex(o => String(o.value) === String(value)));
    itemRefs.current[index]?.focus();
  }, [open, options, value]);

  const close = (refocus) => {
    setOpen(false);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  };

  const onMenuKeyDown = (e) => {
    const focusables = itemRefs.current.filter(Boolean);
    const index = focusables.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(index + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(index - 1 + focusables.length) % focusables.length]?.focus(); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div className="hr-select" ref={wrapRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="hr-select-trigger"
        style={minWidth ? { minWidth } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <span className="hr-select-value">{selected ? selected.label : 'Select…'}</span>
        {selected?.badge && (
          <span className={`hr-tag hr-tag-${selected.badgeTone || 'closed'}`}>{selected.badge}</span>
        )}
        <span className="hr-select-caret material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>

      {open && (
        <div className="hr-select-menu" role="listbox" aria-label={ariaLabel} onKeyDown={onMenuKeyDown}>
          {options.map((option, i) => (
            <button
              key={option.value}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="option"
              aria-selected={String(option.value) === String(value)}
              className={`hr-select-option${String(option.value) === String(value) ? ' is-selected' : ''}`}
              onClick={() => { onChange(option.value); close(false); }}
            >
              <span className="hr-select-option-label">{option.label}</span>
              {option.badge && (
                <span className={`hr-tag hr-tag-${option.badgeTone || 'closed'}`}>{option.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const active = status === 'Active';
  return (
    <span className={`hr-status ${active ? 'is-active' : 'is-inactive'}`}>
      <span className="hr-status-dot" aria-hidden="true" />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

// ── Busy button ────────────────────────────────────────────────────────────
// Disables itself while a request is in flight, so a double submit is
// structurally impossible rather than merely discouraged.
export function BusyButton({
  busy, busyLabel, children, className = 'btn btn-primary', disabled, icon, ...rest
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy
        ? (
          <>
            <span
              className="material-symbols-outlined spin"
              style={{ fontSize: 16 }}
              aria-hidden="true"
            >progress_activity</span>
            {busyLabel || 'Working…'}
          </>
        )
        : (
          <>
            {icon && <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">{icon}</span>}
            {children}
          </>
        )}
    </button>
  );
}

// ── Searchable single-select ───────────────────────────────────────────────
// Used for the Master Data import picker and the attendance employee picker.
// A plain <select> is unusable past a few dozen rows; CustomerAutocomplete is
// hard-wired to customers, so this is the generic equivalent.
export function SearchSelect({
  id, options, value, onChange, onBlur, placeholder = 'Search…', emptyText = 'No matches',
  renderOption, getLabel, invalid, disabled,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  const selected = useMemo(
    () => options.find(o => String(o.id) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options.filter(o => getLabel(o).toLowerCase().includes(q)).slice(0, 50);
  }, [options, query, getLabel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pick = (option) => {
    onChange(option ? option.id : '');
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div className="customer-autocomplete-wrap" ref={wrapRef}>
      <input
        id={id}
        className={`form-control${invalid ? ' hr-invalid' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected ? getLabel(selected) : '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 40,
            background: 'white', border: '1px solid var(--gray-200)', borderRadius: 10,
            boxShadow: 'var(--shadow-lg)', maxHeight: 240, overflowY: 'auto', padding: 5,
          }}
        >
          {filtered.length === 0
            ? <div style={{ padding: '10px 11px', fontSize: 12.5, color: 'var(--gray-500)' }}>{emptyText}</div>
            : filtered.map((option, i) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={String(option.id) === String(value)}
                className="hr-kebab-item"
                style={i === highlight ? { background: 'var(--gray-100)' } : undefined}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(option)}
              >
                {renderOption ? renderOption(option) : getLabel(option)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

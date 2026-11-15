import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import DateInput from '../../components/common/DateInput';
import { formatDatePKT, todayPKT, addMonthsPKT } from '../../utils/dateUtils';

// ─── Shared building blocks for every report on the Reports screen ─────────
// One filter card, one results card (with its own Download PDF and a
// "filters changed" notice), the same Period / From / To fields, the same
// KPI strip, a right-hand side panel for drill-downs, so every report looks
// and behaves the same way.

/** 1,234.50 — always two decimals. */
export const money = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole numbers with thousands separators. */
export const qty = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
export const toPaisa = (v) => Math.round(Number(v || 0) * 100);
/** Adds money in whole paisa so long columns never pick up float drift. */
export const sumMoney = (rows, pick) => rows.reduce((s, r) => s + toPaisa(pick(r)), 0) / 100;
export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
export const stampPKT = (iso) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Asia/Karachi', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});

// ── Dates ──────────────────────────────────────────────────────────────────
/** The day before a 'YYYY-MM-DD' date. */
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/** First of the current PKT month → today (PKT). */
export function monthToDate() {
  const today = todayPKT();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Quick ranges offered in the Period field (PKT calendar). */
function datePresets(required) {
  const today = todayPKT();
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthStart = addMonthsPKT(monthStart, -1);
  const list = [
    { key: 'mtd', label: 'This month', from: monthStart, to: today },
    { key: 'last', label: 'Last month', from: lastMonthStart, to: dayBefore(monthStart) },
    { key: 'q', label: 'Last 3 months', from: addMonthsPKT(monthStart, -2), to: today },
    { key: 'ytd', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  if (!required) list.push({ key: 'all', label: 'All dates', from: '', to: '' });
  return list;
}

/** The red asterisk after a required field's label. */
export const Req = () => <span className="rp-req" aria-hidden="true">*</span>;

/**
 * Period (quick ranges) + From + To, on one line with the other filters.
 * `onChange(from, to)` gets both values. `required` marks both dates and
 * leaves out "All dates". Picking "Custom range" moves the cursor to From;
 * typing a date that matches no quick range shows "Custom range".
 */
export function DateRangeFields({ from, to, onChange, required = false }) {
  const presets = useMemo(() => datePresets(required), [required]);
  const [custom, setCustom] = useState(false);
  const id = useId();
  const match = presets.find(p => p.from === (from || '') && p.to === (to || ''))?.key;
  const period = custom || !match ? 'custom' : match;
  const choose = (key) => {
    if (key === 'custom') {
      setCustom(true);
      document.getElementById(`${id}-from`)?.focus();
      return;
    }
    const p = presets.find(x => x.key === key);
    setCustom(false);
    if (p) onChange(p.from, p.to);
  };
  return (
    <div className="rp-range">
      <div className="form-group rp-f-period">
        <label className="form-label" htmlFor={`${id}-period`}>Period</label>
        <select id={`${id}-period`} className="form-control" value={period} onChange={e => choose(e.target.value)}>
          {presets.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom range</option>
        </select>
      </div>
      <div className="form-group rp-f-date">
        <label className="form-label" htmlFor={`${id}-from`}>From Date{required && <Req />}</label>
        <DateInput id={`${id}-from`} className="form-control" value={from} max={to || undefined} required={required}
          onChange={e => onChange(e.target.value, to)} />
      </div>
      <div className="form-group rp-f-date">
        <label className="form-label" htmlFor={`${id}-to`}>To Date{required && <Req />}</label>
        <DateInput id={`${id}-to`} className="form-control" value={to} min={from || undefined} required={required}
          onChange={e => onChange(from, e.target.value)} />
      </div>
    </div>
  );
}

/** "01/11/2026 to 14/11/2026", "From …", "Up to …" or "All dates" for request params. */
export function periodText(params) {
  const f = params?.from_date, t = params?.to_date;
  if (f && t) return `${formatDatePKT(f)} to ${formatDatePKT(t)}`;
  if (f) return `From ${formatDatePKT(f)}`;
  if (t) return `Up to ${formatDatePKT(t)}`;
  return 'All dates';
}

/** Client-side check run before every request (the server checks again). */
export function rangeError(from, to, required) {
  if (required && (!from || !to)) return 'Choose both the From and To dates.';
  if (from && to && from > to) return 'The From date cannot be after the To date.';
  return null;
}

// ── Requests ───────────────────────────────────────────────────────────────
/** The server's message for a failed request, including blob (PDF) requests. */
export async function apiMessage(err, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || fallback; } catch { return fallback; }
  }
  return data?.message || fallback;
}

/** Drops blank params so the URL only carries what was chosen. */
function cleanParams(params) {
  return Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}
const sameParams = (a, b) => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[k]));
};

/**
 * Runs one report endpoint. Keeps the params the shown data was produced
 * with, so "Download PDF" always prints exactly what is on screen even if
 * the filters were changed afterwards, and `isCurrent(params)` tells the
 * screen whether the filters still match what is shown.
 */
export function useReport(endpoint, errorText) {
  const [state, setState] = useState({ data: null, params: null, loading: false });
  const seq = useRef(0);

  const run = async (params) => {
    const mine = ++seq.current;
    const clean = cleanParams(params);
    setState(s => ({ ...s, loading: true }));
    try {
      const r = await api.get(endpoint, { params: clean });
      if (mine === seq.current) setState({ data: r.data, params: clean, loading: false });
      return r.data;
    } catch (err) {
      if (mine === seq.current) setState(s => ({ ...s, loading: false }));
      toast.error(await apiMessage(err, errorText));
      return null;
    }
  };
  const clear = () => { seq.current += 1; setState({ data: null, params: null, loading: false }); };
  const download = async (filename, extra = {}, path = `${endpoint}/pdf`) => {
    if (!state.params) return;
    await downloadPdf(path, { ...state.params, ...cleanParams(extra) }, filename);
  };
  const isCurrent = (params) => !!state.params && sameParams(cleanParams(params), state.params);
  return { ...state, run, clear, download, isCurrent };
}

export async function downloadPdf(path, params, filename) {
  const busy = toast.loading('Preparing PDF…');
  try {
    const res = await api.get(path, { params, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    toast.dismiss(busy);
  } catch (err) {
    toast.dismiss(busy);
    toast.error(await apiMessage(err, 'The PDF could not be downloaded. Try again.'));
  }
}

export const safeName = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'report';

// ── Layout pieces ──────────────────────────────────────────────────────────
/**
 * The filter card: title (with an ⓘ "How this report works" popover when
 * `info` is given), a one-line description, an optional toolbar on the
 * right, then one row of filters with Generate report at its end. Download
 * PDF lives on the results card, next to what it prints.
 */
export function FilterCard({ title, description, info, toolbar, children, onGenerate, loading, disabled }) {
  return (
    <div className="card rp-filter-card">
      <div className="rp-filter-head">
        <div className="rp-filter-title">
          <div className="rp-title-row">
            <div className="card-title">{title}</div>
            {info && <InfoPopover title="How this report works">{info}</InfoPopover>}
          </div>
          {description && <div className="rp-desc">{description}</div>}
        </div>
        {toolbar && <div className="rp-filter-toolbar">{toolbar}</div>}
      </div>
      <form
        className="rp-filter-body"
        onSubmit={(e) => { e.preventDefault(); if (!loading && !disabled) onGenerate(); }}
      >
        <div className="rp-fields">{children}</div>
        <div className="rp-actions">
          <button type="submit" className="btn btn-primary rp-generate" disabled={loading || disabled} aria-busy={loading || undefined}>
            {loading
              ? <span className="rp-btn-spinner" aria-hidden="true" />
              : <span className="material-symbols-outlined" aria-hidden="true">summarize</span>}
            {loading ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * An ⓘ button that opens a small card of help text under it — the usual
 * "about this" pattern, so the page itself stays uncluttered. Esc, the ×,
 * or a click anywhere else closes it. The card is portalled and fixed, so
 * no card edge clips it, and it flips above the button near the bottom.
 */
export function InfoPopover({ title, children, width = 420 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const popId = useId();

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const h = popRef.current ? popRef.current.offsetHeight : 240;
    const below = window.innerHeight - r.bottom - 12;
    const up = below < h && r.top > below;
    const left = Math.round(Math.max(8, Math.min(r.left - 14, window.innerWidth - w - 8)));
    setPos({
      left, width: w, up,
      top: up ? 'auto' : Math.round(r.bottom + 10),
      bottom: up ? Math.round(window.innerHeight - r.top + 10) : 'auto',
      caret: Math.round(r.left + r.width / 2 - left),
    });
  }, [width]);

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
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" className={`rp-info-btn${open ? ' is-open' : ''}`}
        aria-label={title} title={open ? undefined : title}
        aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => setOpen(v => !v)}>
        <span className="material-symbols-outlined" aria-hidden="true">info</span>
      </button>
      {open && createPortal(
        <div ref={popRef} id={popId} role="dialog" aria-label={title}
          className={`rp-pop${pos?.up ? ' is-up' : ''}`}
          style={{
            left: pos ? pos.left : -9999, top: pos ? pos.top : 0, bottom: pos ? pos.bottom : 'auto',
            width: pos ? pos.width : width, visibility: pos ? 'visible' : 'hidden', '--rp-caret': `${pos ? pos.caret : 20}px`,
          }}>
          <div className="rp-pop-head">
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            <div className="rp-pop-title">{title}</div>
            <button type="button" className="rp-pop-close" aria-label="Close" onClick={() => { setOpen(false); btnRef.current?.focus(); }}>
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          <div className="rp-pop-body">{children}</div>
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * The results card header: title, a muted subtitle, then (right) any extra
 * actions, a "filters changed" notice with Update when the filters no
 * longer match what is shown, and Download PDF.
 */
export function ResultHead({ title, meta, children, onDownload, stale, onRefresh, refreshing }) {
  return (
    <div className="card-header rp-card-head">
      <div className="rp-head-text">
        <div className="card-title">{title}</div>
        {meta && <div className="rp-desc">{meta}</div>}
      </div>
      <div className="rp-head-actions">
        {stale && (
          <span className="rp-stale" role="status">
            <span className="material-symbols-outlined" aria-hidden="true">history</span>
            Filters changed
            {onRefresh && (
              <button type="button" className="rp-stale-btn" onClick={onRefresh} disabled={refreshing}>
                {refreshing ? 'Updating…' : 'Update'}
              </button>
            )}
          </span>
        )}
        {children}
        {onDownload && (
          <button type="button" className="btn btn-outline btn-sm rp-pdf-btn" onClick={onDownload}
            title={stale ? 'Prints the report shown below, not the changed filters' : 'Download this report as a PDF'}>
            <span className="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>
            PDF
          </button>
        )}
      </div>
    </div>
  );
}

/** What the results area shows before the first Generate, and while loading. */
export function ReportPlaceholder({ loading, icon = 'query_stats', text = 'Set the filters above, then select Generate report.' }) {
  return (
    <div className="card rp-placeholder" aria-busy={loading || undefined}>
      {loading ? (
        <>
          <div className="spinner" />
          <div className="rp-placeholder-text">Producing the report…</div>
        </>
      ) : (
        <>
          <span className="material-symbols-outlined rp-placeholder-icon" aria-hidden="true">{icon}</span>
          <div className="rp-placeholder-text">{text}</div>
        </>
      )}
    </div>
  );
}

// ── Side panel ─────────────────────────────────────────────────────────────
// Slides in from the right over a dimmed page, so a drill-down sits next to
// the report it came from. Esc, the × button or a click on the page closes
// it; focus stays inside while it is open and returns where it came from.
// `onBack` adds a back arrow for panels that step into a sub-list.
const PANEL_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function SidePanel({ open, onClose, title, subtitle, onBack, width = 760, children }) {
  const ref = useRef(null);
  const restore = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    restore.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(PANEL_FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      const el = restore.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="rp-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={ref} className="rp-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ width: `min(${width}px, 100vw)` }}>
        <header className="rp-panel-head">
          {onBack && (
            <button type="button" className="rp-panel-icon" onClick={onBack} aria-label="Back">
              <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            </button>
          )}
          <div className="rp-panel-titles">
            <div className="rp-panel-title" id={titleId}>{title}</div>
            {subtitle && <div className="rp-panel-sub">{subtitle}</div>}
          </div>
          <button type="button" className="rp-panel-icon" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="rp-panel-body">{children}</div>
      </aside>
    </div>,
    document.body
  );
}

/** A row of key figures above a table. tone: 'good' | 'bad' | 'warn'. */
export function StatTiles({ items }) {
  return (
    <div className="rp-stats">
      {items.filter(Boolean).map(it => (
        <div key={it.label} className={`rp-stat${it.tone ? ` is-${it.tone}` : ''}${it.strong ? ' is-strong' : ''}`}>
          <div className="rp-stat-label">{it.label}</div>
          <div className="rp-stat-value">{it.value}</div>
          {it.sub && <div className="rp-stat-sub">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function EmptyResult({ title, hint }) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-subtitle">{hint}</div>}
    </div>
  );
}

/**
 * Pill-style single choice (e.g. Statement / By Company / By Salesman).
 * `field` sizes it like a form control so it can sit in the filter row.
 */
export function Segmented({ value, onChange, options, ariaLabel, field = false, id }) {
  return (
    <div id={id} className={`rp-seg${field ? ' is-field' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map(opt => (
        <button key={opt.key} type="button" role="radio" aria-checked={value === opt.key}
          className={`rp-seg-btn${value === opt.key ? ' is-active' : ''}`} onClick={() => onChange(opt.key)}>
          {opt.icon && <span className="material-symbols-outlined" aria-hidden="true">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** A kebab / tune button that opens a small menu; closes on outside click and Esc. */
export function MenuButton({ icon = 'more_vert', label, children, minWidth = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-outline rp-icon-btn" title={label} aria-label={label}
        aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
      </button>
      {open && <div className="rp-menu" role="menu" style={{ minWidth }}>{children}</div>}
    </div>
  );
}

/** Multi-select with search; empty selection means "All" (or `allLabel`). */
export function SearchableMultiSelect({ options, value, onChange, placeholder = 'Search and select…', allLabel = 'All', icon, disabled = false, id }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);
  const selected = value || [];

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => String(o.label || '').toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = (() => {
    if (selected.length === 0) return allLabel;
    if (selected.length === 1) {
      const one = options.find(o => String(o.value) === String(selected[0]));
      return one?.label || '1 selected';
    }
    return `${selected.length} selected`;
  })();

  const toggleValue = (v) => {
    const exists = selected.some(x => String(x) === String(v));
    if (exists) onChange(selected.filter(x => String(x) !== String(v)));
    else onChange([...selected, String(v)]);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button id={id} type="button" className={`form-control rp-ms-btn${selected.length ? ' has-value' : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {icon && <span className="material-symbols-outlined rp-ms-icon" aria-hidden="true">{icon}</span>}
        <span className="rp-ms-label">{selectedLabel}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--gray-500)' }}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && !disabled && (
        <div className="rp-ms-pop">
          <div className="rp-ms-search">
            <input className="form-control" placeholder={placeholder} value={query} autoFocus
              onChange={e => setQuery(e.target.value)} style={{ fontSize: 12, padding: '7px 8px' }} />
            {selected.length > 0 && (
              <button type="button" className="rp-ms-clear" onClick={() => onChange([])}>Clear</button>
            )}
          </div>
          <div className="rp-ms-list">
            {filtered.length === 0 ? (
              <div className="rp-ms-empty">No matches</div>
            ) : filtered.map(opt => {
              const checked = selected.some(x => String(x) === String(opt.value));
              return (
                <label key={opt.value} className="rp-ms-item">
                  <input type="checkbox" checked={checked} onChange={() => toggleValue(opt.value)} />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles for the whole Reports screen ────────────────────────────────────
export const REPORT_STYLES = `
  .rp-page {
    display: flex; flex-direction: column; gap: 20px;
    /* Height a .form-control renders at (8px padding ×2, 1.5px border ×2 and
       its text line), so buttons and toggles in the filter row line up with
       the inputs. Browsers round the input's text line down, so this is the
       measured 37px rather than 13.5 × 1.4 + 19 = 37.9. */
    --rp-ctl-h: 37px;
  }
  .rp-main { min-width: 0; display: flex; flex-direction: column; gap: 20px; }
  .rp-main[hidden] { display: none; }

  /* Report switcher: one horizontal bar, reports grouped like a ribbon. */
  .rp-tabs {
    display: flex; align-items: stretch; gap: 0; padding: 0 8px; overflow-x: auto; scrollbar-width: thin;
  }
  .rp-tab-group { display: flex; flex-direction: column; flex-shrink: 0; padding: 8px 6px 0; }
  .rp-tab-group + .rp-tab-group { border-left: 1px solid var(--gray-100); }
  .rp-tab-group-label {
    padding: 0 8px 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase;
    color: var(--gray-400); white-space: nowrap;
  }
  .rp-tab-row { display: flex; gap: 2px; }
  .rp-tab {
    position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px 12px; border: 0;
    background: transparent; color: var(--gray-600); font: inherit; font-size: 13.5px; font-weight: 600;
    white-space: nowrap; cursor: pointer; border-radius: 8px 8px 0 0; transition: color 150ms ease, background 150ms ease;
  }
  .rp-tab .material-symbols-outlined { font-size: 18px; color: var(--gray-400); transition: color 150ms ease; }
  .rp-tab:hover { color: var(--gray-900); background: var(--gray-50); }
  .rp-tab:hover .material-symbols-outlined { color: var(--gray-600); }
  .rp-tab:focus { outline: none; }
  .rp-tab:focus-visible { box-shadow: inset 0 0 0 2px var(--blue-light); }
  .rp-tab::after {
    content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0;
    background: transparent; transition: background 150ms ease;
  }
  .rp-tab.is-active { color: var(--blue); }
  .rp-tab.is-active .material-symbols-outlined { color: var(--blue); }
  .rp-tab.is-active::after { background: var(--blue); }
  /* Narrow screens: tighter tabs first, then text only, so all seven fit
     without a sideways scroll (measured on the bar's own width). */
  .rp-page { container-type: inline-size; }
  @container (max-width: 1060px) {
    .rp-tabs { padding: 0 4px; }
    .rp-tab-group { padding: 8px 2px 0; }
    .rp-tab { padding: 8px 9px 12px; gap: 6px; }
  }
  @container (max-width: 940px) {
    .rp-tab .material-symbols-outlined { display: none; }
  }

  /* Filter card: title row, then one row of filters with Generate at its end. */
  .rp-filter-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap;
    padding: 18px 22px 0;
  }
  .rp-filter-title { min-width: 0; flex: 1 1 320px; }
  .rp-title-row { display: flex; align-items: center; gap: 4px; min-height: 24px; }
  .rp-filter-toolbar { flex-shrink: 0; }
  /* Fields on the left, Generate in its own column on the right, level with
     the last row of fields however many rows they take. */
  .rp-filter-body {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 16px 24px; padding: 16px 22px 20px;
  }
  .rp-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; min-width: 0; }
  .rp-fields .form-group { margin: 0; }
  .rp-fields .form-label { white-space: nowrap; }
  .rp-fields > .form-group { flex: 0 1 220px; min-width: 170px; }
  .rp-fields > .form-group.rp-f-wide { flex-basis: 260px; }
  .rp-fields > .form-group.rp-f-narrow { flex-basis: 180px; min-width: 150px; }
  .rp-fields > .form-group.rp-f-auto { flex: 0 0 auto; min-width: 0; }
  .rp-fields-break { flex-basis: 100%; height: 0; }
  .rp-range { display: flex; align-items: flex-end; gap: 12px; flex: 0 1 auto; min-width: 0; }
  .rp-range > .form-group { flex: 0 1 148px; min-width: 132px; }
  .rp-req { margin-left: 3px; color: var(--red); font-weight: 700; }
  /* Grouping levels (Sale Summary): four columns, each a select with its filter under it. */
  .rp-levels {
    flex: 1 1 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 210px)); gap: 16px; align-items: start;
  }
  .rp-level { display: flex; flex-direction: column; min-width: 0; }
  .rp-level .form-label { display: flex; align-items: center; gap: 6px; }
  .rp-level .form-label .rp-req { margin-left: -3px; }
  .rp-level-no {
    display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%;
    background: var(--gray-100); color: var(--gray-500); font-size: 10.5px; font-weight: 700;
  }
  .rp-level.is-set .rp-level-no { background: var(--blue-ultra); color: var(--blue); }
  .rp-level select:disabled { background: var(--gray-50); color: var(--gray-400); cursor: not-allowed; }
  .rp-level-filter { margin-top: 8px; }

  .rp-actions { display: flex; align-items: flex-end; gap: 8px; }
  .rp-generate { height: var(--rp-ctl-h); min-width: 164px; justify-content: center; padding: 0 18px 0 14px; }
  .rp-generate[aria-busy='true'] { opacity: 1; cursor: progress; }
  .rp-generate .material-symbols-outlined { font-size: 19px; }
  .rp-btn-spinner {
    width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.45); border-top-color: white; animation: rpSpin 800ms linear infinite;
  }
  @keyframes rpSpin { to { transform: rotate(360deg); } }
  @media (max-width: 640px) {
    .rp-filter-body { grid-template-columns: minmax(0, 1fr); }
    .rp-range { flex: 1 1 100%; flex-wrap: wrap; }
    .rp-range > .form-group, .rp-fields > .form-group { flex: 1 1 140px; }
    .rp-actions { flex: 1 1 100%; }
    .rp-generate { width: 100%; justify-content: center; }
  }

  /* ⓘ "How this report works" */
  .rp-info-btn {
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 50%; background: transparent; color: var(--gray-400); cursor: pointer;
    transition: color 150ms ease, background 150ms ease;
  }
  .rp-info-btn .material-symbols-outlined { font-size: 18px; }
  .rp-info-btn:hover, .rp-info-btn.is-open { color: var(--blue); background: var(--blue-ultra); }
  .rp-info-btn:focus { outline: none; }
  .rp-info-btn:focus-visible { box-shadow: 0 0 0 2px var(--blue-light); }
  @keyframes rpPopIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .rp-pop {
    position: fixed; z-index: 300; background: white; border: 1px solid var(--gray-200); border-radius: 12px;
    box-shadow: var(--shadow-lg); animation: rpPopIn 140ms ease-out;
  }
  .rp-pop::before {
    content: ''; position: absolute; top: -6px; left: calc(var(--rp-caret) - 6px); width: 10px; height: 10px;
    background: white; border-left: 1px solid var(--gray-200); border-top: 1px solid var(--gray-200); transform: rotate(45deg);
  }
  .rp-pop.is-up::before { top: auto; bottom: -6px; transform: rotate(225deg); }
  .rp-pop-head {
    display: flex; align-items: center; gap: 8px; padding: 12px 10px 10px 16px; border-bottom: 1px solid var(--gray-100);
  }
  .rp-pop-head > .material-symbols-outlined { font-size: 18px; color: var(--blue); }
  .rp-pop-title { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 700; color: var(--gray-900); }
  .rp-pop-close {
    display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0;
    border-radius: 6px; background: transparent; color: var(--gray-500); cursor: pointer;
  }
  .rp-pop-close:hover { background: var(--gray-100); color: var(--gray-900); }
  .rp-pop-close:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  .rp-pop-close .material-symbols-outlined { font-size: 18px; }
  .rp-pop-body {
    max-height: min(60vh, 420px); overflow-y: auto; padding: 12px 16px 14px;
    font-size: 12.5px; line-height: 1.6; color: var(--gray-600);
  }
  .rp-pop-body p + p { margin-top: 8px; }
  .rp-pop-body b { color: var(--gray-800); }

  /* Results header */
  .rp-card-head { align-items: flex-start; flex-wrap: wrap; }
  .rp-head-text { min-width: 0; flex: 1 1 280px; }
  .rp-desc { margin-top: 3px; font-size: 12.5px; font-weight: 400; color: var(--gray-500); line-height: 1.45; }
  .rp-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .rp-pdf-btn { display: inline-flex; align-items: center; gap: 5px; }
  .rp-pdf-btn .material-symbols-outlined { font-size: 17px; }
  .rp-stale {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 4px 4px 10px; border-radius: 999px;
    background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 12px; font-weight: 600;
  }
  .rp-stale .material-symbols-outlined { font-size: 15px; }
  .rp-stale-btn {
    border: 0; border-radius: 999px; padding: 3px 10px; background: var(--amber); color: white;
    font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
  }
  .rp-stale-btn:disabled { opacity: 0.7; cursor: default; }
  /* Results that no longer match the filters are dimmed until Update. */
  .card:has(.rp-stale) > :is(.rp-stats, .table-wrap, .rp-note) { opacity: 0.5; transition: opacity 150ms ease; }

  .rp-placeholder {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    min-height: 180px; padding: 28px; border-style: dashed; background: var(--gray-50); box-shadow: none;
  }
  .rp-placeholder-icon { font-size: 34px; color: var(--gray-300); }
  .rp-placeholder-text { font-size: 13px; color: var(--gray-500); }

  /* Side panel */
  @keyframes rpPanelIn { from { transform: translateX(32px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes rpFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .rp-panel-backdrop {
    position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: flex-end;
    background: rgba(15, 23, 42, 0.38); animation: rpFadeIn 160ms ease-out;
  }
  .rp-panel {
    height: 100%; display: flex; flex-direction: column; background: white; box-shadow: var(--shadow-xl);
    animation: rpPanelIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .rp-panel:focus { outline: none; }
  .rp-panel-head {
    display: flex; align-items: flex-start; gap: 10px; padding: 18px 20px 16px; border-bottom: 1px solid var(--gray-100);
  }
  .rp-panel-titles { flex: 1; min-width: 0; }
  .rp-panel-title { font-size: 16px; font-weight: 700; color: var(--gray-900); line-height: 1.35; }
  .rp-panel-sub { margin-top: 2px; font-size: 12.5px; color: var(--gray-500); }
  .rp-panel-icon {
    display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0;
    border: 0; border-radius: 8px; background: transparent; color: var(--gray-500); cursor: pointer;
  }
  .rp-panel-icon:hover { background: var(--gray-100); color: var(--gray-900); }
  .rp-panel-icon:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  .rp-panel-icon .material-symbols-outlined { font-size: 20px; }
  .rp-panel-body { flex: 1; overflow-y: auto; padding: 18px 20px 24px; }
  @media (prefers-reduced-motion: reduce) {
    .rp-panel, .rp-panel-backdrop, .rp-pop { animation: none; }
  }

  .rp-stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    border-bottom: 1px solid var(--gray-100);
  }
  .rp-stat { padding: 14px 22px; border-right: 1px solid var(--gray-100); }
  .rp-stat:last-child { border-right: 0; }
  .rp-stat-label { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: var(--gray-500); }
  .rp-stat-value { margin-top: 2px; font-size: 17px; font-weight: 700; color: var(--gray-800); font-variant-numeric: tabular-nums; }
  .rp-stat-sub { font-size: 11.5px; color: var(--gray-500); }
  .rp-stat.is-strong .rp-stat-value { color: var(--navy); }
  .rp-stat.is-good .rp-stat-value { color: var(--green); }
  .rp-stat.is-bad .rp-stat-value { color: var(--red); }
  .rp-stat.is-warn .rp-stat-value { color: var(--amber); }

  .rp-seg {
    display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px;
    background: var(--gray-100); border: 1px solid var(--gray-200);
  }
  .rp-seg-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 0; border-radius: 999px;
    background: transparent; color: var(--gray-600); font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1;
    cursor: pointer; transition: background 180ms ease, color 180ms ease, box-shadow 180ms ease;
  }
  .rp-seg-btn .material-symbols-outlined { font-size: 16px; }
  .rp-seg-btn.is-active {
    background: white; color: var(--gray-900); font-weight: 700;
    box-shadow: 0 1px 2px rgba(15,23,42,0.08), 0 0 0 1px rgba(15,23,42,0.06);
  }
  .rp-seg-btn:focus { outline: none; }
  .rp-seg-btn:focus-visible { box-shadow: 0 0 0 2px var(--blue-light); }
  /* In the filter row: same height and corners as the inputs beside it. */
  .rp-seg.is-field { display: flex; height: var(--rp-ctl-h); padding: 3px; border-radius: 8px; border-width: 1.5px; }
  .rp-seg.is-field .rp-seg-btn { flex: 1 1 0; justify-content: center; height: 100%; padding: 0 14px; border-radius: 6px; font-size: 13px; }

  .rp-icon-btn { padding: 6px 8px; min-width: 36px; }
  .rp-menu {
    position: absolute; top: 40px; right: 0; z-index: 40; padding: 6px; background: white;
    border: 1px solid var(--gray-200); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  }
  .rp-menu-title { padding: 6px 8px; font-size: 11px; font-weight: 700; color: var(--gray-500); }
  .rp-menu-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
  .rp-menu-item:hover { background: var(--gray-50); }
  .rp-menu-item input { margin-top: 3px; }
  .rp-menu-sub { font-size: 11.5px; color: var(--gray-500); margin-top: 1px; }
  .rp-menu-foot { border-top: 1px solid var(--gray-100); margin-top: 6px; padding-top: 6px; text-align: right; }
  .rp-link-btn { background: transparent; border: 0; cursor: pointer; color: var(--gray-500); font: inherit; font-size: 11.5px; }
  .rp-link-btn:hover { color: var(--blue); }

  .rp-ms-btn { text-align: left; display: flex; align-items: center; gap: 8px; }
  .rp-ms-btn:disabled { background: var(--gray-50); color: var(--gray-400); cursor: not-allowed; }
  .rp-ms-icon { font-size: 17px; color: var(--gray-400); }
  .rp-ms-btn.has-value .rp-ms-icon { color: var(--blue); }
  .rp-ms-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-ms-pop {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 220px; z-index: 40; background: white;
    border: 1px solid var(--gray-200); border-radius: 8px; box-shadow: 0 8px 20px rgba(0,0,0,0.08); overflow: hidden;
  }
  .rp-ms-search { display: flex; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid var(--gray-100); }
  .rp-ms-clear { border: 0; background: none; color: var(--blue); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .rp-ms-list { max-height: 240px; overflow-y: auto; padding: 6px; }
  .rp-ms-item { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .rp-ms-item:hover { background: var(--gray-50); }
  .rp-ms-item input { margin: 0; cursor: pointer; }
  .rp-ms-empty { font-size: 12px; color: var(--gray-500); padding: 8px; }

  .report-table td.num, .report-table th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .report-table td.strong { font-weight: 700; }
  .report-table td.muted { color: var(--gray-500); }
  .rp-subtotal td { font-weight: 700; background: var(--gray-50); }
  .rp-neg { color: var(--red); }
  .rp-warn { color: var(--amber); }
  .rp-flag { margin-left: 6px; color: var(--amber); cursor: help; font-size: 12px; }
  .rp-note { padding: 12px 22px; font-size: 12px; color: var(--gray-500); border-top: 1px solid var(--gray-100); line-height: 1.5; }
`;

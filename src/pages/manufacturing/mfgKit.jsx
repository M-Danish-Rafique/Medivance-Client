import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Select, SearchSelect, InfoPopover, SortableHeader, blockWheelChange, num } from '../hr/HrKit';

// ─── Manufacturing UI kit ──────────────────────────────────────────────────
// Shared by the four Manufacturing screens. Built on the HR kit (HrKit +
// hrStyles), which every screen mounts first; MfgStyles only adds what
// Manufacturing needs on top. Components live at module scope (see HrKit).
//
// The costing functions mirror server/utils/manufacturing.js and drive the
// live figures in the forms. The server stays authoritative: the batch
// preview step shows the server's own figures.

// ── Numbers ────────────────────────────────────────────────────────────────
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/** Field value -> number, or NaN when blank / not a number. */
export const parseNum = (value) => {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// One formatter for the module (brief 4.1). Stored precision never changes;
// only what is shown:
//   money and rates  2 decimals, the full stored figure in a tooltip
//   quantities       up to 3 decimals, trailing zeros removed
//   percentages      1 decimal
const group = (value, min, max) => num(value).toLocaleString('en-PK', { minimumFractionDigits: min, maximumFractionDigits: max });
export const fmtQty = (value, symbol) => `${group(value, 0, 3)}${symbol ? ` ${symbol}` : ''}`;
export const fmtRate = (value) => group(value, 2, 2);
export const fmtPct = (value) => `${num(value).toFixed(1)}%`;
const fullRate = (value) => group(value, 2, 4);

/** A money/rate figure at 2 decimals; hovering shows the stored precision when
 *  rounding hides any of it (207.68 -> "207.6805"). */
export function Rate({ value, pkr }) {
  const shown = fmtRate(value);
  const full = fullRate(value);
  const text = `${pkr ? 'PKR ' : ''}${shown}`;
  return full !== shown ? <span title={`${pkr ? 'PKR ' : ''}${full}`}>{text}</span> : text;
}

/** A quantity up to 3 decimals, with the stored figure in a tooltip when rounded. */
export function Qty({ value, unit }) {
  const shown = fmtQty(value, unit);
  const full = `${group(value, 0, 4)}${unit ? ` ${unit}` : ''}`;
  return full !== shown ? <span title={full}>{shown}</span> : shown;
}

/** Stock on hand. Nothing left is ONE signal: the "0" in amber text; the
 *  tooltip and screen readers say "out of stock". */
export function StockQty({ value, unit }) {
  if (num(value) > 0) return <Qty value={value} unit={unit} />;
  return (
    <span className="mfg-amber" title="Out of stock">
      {fmtQty(value, unit)}<span className="hr-sr-only"> (out of stock)</span>
    </span>
  );
}

/** What a material's rate means (raw_materials.cost_per_unit is a weighted
 *  average, server/routes/rawMaterials.js). `unit` when one material is meant. */
export const AVERAGE_RATE_TITLE = 'Weighted average rate';
export const averageRateText = (unit) => [
  `What ${unit ? `one ${unit}` : 'one unit'} of this material in stock is worth: the average price of all its purchases, weighted by quantity and including other charges such as freight.`,
  `For example, ${unit ? `10 ${unit}` : '10 units'} bought at 100 and ${unit ? `10 ${unit}` : '10 more'} at 200 make an average of 150.`,
  'Every purchase updates it. Using stock in a batch does not change it.',
  'A batch is costed at this rate when it takes the material, and keeps that cost when the rate changes later.',
];
export function AverageRateInfo({ unit }) {
  return <Info title={AVERAGE_RATE_TITLE} width={340}>{averageRateText(unit)}</Info>;
}

/** Margin of a sale rate over a cost: (sale − cost) ÷ sale. Null without both. */
export const marginPct = (sale, cost) => (num(sale) > 0 && num(cost) > 0 ? ((num(sale) - num(cost)) / num(sale)) * 100 : null);
export function Margin({ sale, cost }) {
  const m = marginPct(sale, cost);
  if (m === null) return EMPTY;
  return <span className={m < 0 ? 'mfg-neg' : undefined}>{fmtPct(m)}</span>;
}

// ── Text ───────────────────────────────────────────────────────────────────
export const cleanText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
/** "The same name": case and extra spaces ignored. Mirrors the server. */
export const normKey = (value) => String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
/** The generated pack size label, as the server stores it: "200 ml", "200 ml Pouch". */
export const packLabel = (volume, symbol, packType) => {
  const n = String(Number(Math.round((Number(volume) + Number.EPSILON) * 10000) / 10000));
  const type = cleanText(packType);
  return `${n} ${symbol || ''}${type ? ` ${type}` : ''}`.trim();
};
export const plural = (n, one, many) => `${group(n, 0, 0)} ${Number(n) === 1 ? one : many}`;

// ── Costing (mirrors server/utils/manufacturing.js) ────────────────────────
export function allocate(total, weights) {
  const totalPaisa = Math.round(round2(total) * 100);
  const sum = weights.reduce((s, w) => s + Math.max(0, Number(w) || 0), 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalPaisa / 100 : 0));
  const exact = weights.map(w => (totalPaisa * Math.max(0, Number(w) || 0)) / sum);
  const floors = exact.map(Math.floor);
  let remainder = totalPaisa - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k += 1, remainder -= 1) floors[order[k].i] += 1;
  return floors.map(p => p / 100);
}

/** Brief 7.3: charges shared by line value; landed = (line total + share) ÷ qty. */
export function landedRates(lines, otherCharges) {
  const totals = lines.map(l => round2(l.qty * l.rate));
  const shares = allocate(otherCharges || 0, totals);
  return lines.map((l, i) => ({
    lineTotal: totals[i],
    chargesShare: shares[i],
    landedRate: l.qty > 0 ? round4((totals[i] + shares[i]) / l.qty) : 0,
  }));
}

// ── Units ──────────────────────────────────────────────────────────────────
export const UOM_CATEGORIES = [
  { val: 'weight', label: 'Weight', base: 'g' },
  { val: 'volume', label: 'Volume', base: 'ml' },
  { val: 'count', label: 'Count', base: 'pcs' },
];

// ── Batch status ───────────────────────────────────────────────────────────
// Draft -> Ready for inventory -> In inventory, one tone each.
export const BATCH_STATUS = {
  draft: { label: 'Draft', tone: 'is-draft' },
  ready: { label: 'Ready for inventory', tone: 'is-ready' },
  in_inventory: { label: 'In inventory', tone: 'is-done' },
};
export function BatchStatus({ status }) {
  const s = BATCH_STATUS[status];
  if (!s) return null;
  return <span className={`mfg-badge ${s.tone}`}>{s.label}</span>;
}

// ── Picker ─────────────────────────────────────────────────────────────────
// The one dropdown of the module (brief section 3): HrKit Select up to eight
// options, HrKit SearchSelect beyond that. Both open over dialogs (portal),
// work from the keyboard and say "No matches" when nothing fits.
// options: [{ value, label, hint?, disabled?, disabledReason? }]
export const SEARCH_THRESHOLD = 8;
const pickerLabel = (o) => o.label;
const renderPickerOption = (o) => (
  <>
    <span className="mfg-opt-label">{o.label}</span>
    {o.hint && <span className="mfg-opt-hint">{o.hint}</span>}
  </>
);

export function Picker({
  id, value, onChange, options, placeholder = 'Select', searchPlaceholder, invalid, disabled, onBlur, ariaLabel,
}) {
  if (options.length > SEARCH_THRESHOLD) {
    const items = options.map(o => ({ ...o, id: o.value }));
    return (
      <SearchSelect
        id={id}
        options={items}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={searchPlaceholder || placeholder}
        getLabel={pickerLabel}
        renderOption={renderPickerOption}
        invalid={invalid}
        disabled={disabled}
        portal
      />
    );
  }
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      invalid={invalid}
      disabled={disabled}
      onBlur={onBlur}
      block
      portal
    />
  );
}

// ── Number field ───────────────────────────────────────────────────────────
// The browser's spinner is hidden (MFG_STYLES); a slim stepper (▲▼, 16px
// wide) sits inside the field's right edge instead. It steps with
// the input's own stepUp/stepDown, so a click does exactly what ArrowUp /
// ArrowDown do: +1 / −1 (step="1"), never below 0. Typed decimals such as 0.5
// are kept as typed. The scroll wheel never changes a value. `suffix` shows
// the unit inside the field, left of the stepper.
// No placeholder: an empty field is empty, never a grey "0".
function Stepper({ inputRef, onChange, disabled }) {
  const step = (dir) => {
    const el = inputRef.current;
    if (!el || disabled) return;
    if (dir > 0) el.stepUp(); else el.stepDown();
    onChange(el.value);
  };
  if (disabled) return null;
  return (
    <span className="mfg-stepper" aria-hidden="true">
      {[1, -1].map(dir => (
        <button
          key={dir}
          type="button"
          tabIndex={-1}
          className="mfg-stepper-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(dir)}
        >
          <svg width="8" height="4" viewBox="0 0 8 4" focusable="false">
            <path d={dir > 0 ? 'M0 4 L4 0 L8 4 Z' : 'M0 0 L4 4 L8 0 Z'} fill="currentColor" />
          </svg>
        </button>
      ))}
    </span>
  );
}

// `integer`: whole numbers only. A decimal point, comma or exponent cannot be
// typed, and a pasted "2.5" keeps only the whole part.
const NON_INTEGER_KEYS = new Set(['.', ',', 'e', 'E', '+', '-']);
export function NumberField({
  id, value, onChange, onBlur, invalid, suffix, disabled, ariaLabel, autoFocus, integer, onKeyDown, inputRef, title,
}) {
  const ownRef = useRef(null);
  const setRef = (el) => {
    ownRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) inputRef.current = el;
  };
  return (
    <div className={`mfg-num${suffix ? ' has-suffix' : ''}`}>
      <input
        id={id}
        type="number"
        step="1"
        min="0"
        inputMode={integer ? 'numeric' : 'decimal'}
        className={`form-control${invalid ? ' hr-invalid' : ''}`}
        style={suffix ? { paddingRight: 32 + String(suffix).length * 7 } : undefined}
        ref={setRef}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid ? 'true' : undefined}
        autoFocus={autoFocus}
        title={title}
        onChange={e => onChange(integer ? e.target.value.replace(/[.,].*$/, '') : e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (integer && NON_INTEGER_KEYS.has(e.key)) e.preventDefault();
          if (onKeyDown) onKeyDown(e);
        }}
        onWheel={blockWheelChange}
      />
      {suffix && <span className="mfg-num-suffix" aria-hidden="true">{suffix}</span>}
      <Stepper inputRef={ownRef} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ── Pack size: number + unit in one control (brief 1.1) ─────────────────────
export function PackSizeField({ id, volume, uomId, units, onVolume, onUnit, invalid, onBlur, disabled, integer }) {
  return (
    <div className={`mfg-packsize${invalid ? ' is-invalid' : ''}`}>
      <NumberField
        id={id}
        ariaLabel="Pack size"
        value={volume}
        integer={integer}
        invalid={invalid}
        disabled={disabled}
        onChange={onVolume}
        onBlur={onBlur}
      />
      <Select
        ariaLabel="Pack size unit"
        value={uomId}
        onChange={onUnit}
        options={units}
        placeholder="Unit"
        invalid={invalid && !uomId}
        disabled={disabled}
        portal
        minWidth={0}
      />
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────
/** "KHALIS Hair Oil · 200 ml": the pack size is muted text, not a tag. */
export function NameWithTag({ name, tag }) {
  return (
    <span className="mfg-name">
      <span className="mfg-name-main">{name}</span>
      {tag && <><span className="mfg-name-sep" aria-hidden="true">·</span><span className="mfg-name-size">{tag}</span></>}
    </span>
  );
}

/** An empty value: a muted "—". */
export const EMPTY = <span className="mfg-empty-val">—</span>;

/** Every "Add …" control: the same outline button with one "+" glyph. */
export function AddButton({ children, onClick, disabled, title, id }) {
  return (
    <button type="button" id={id} className="btn btn-outline btn-sm mfg-add" onClick={onClick} disabled={disabled} title={title}>
      <span className="material-symbols-outlined" aria-hidden="true">add</span>{children}
    </button>
  );
}

/** The (i) of the module: HrKit InfoPopover (hover or focus previews it, a
 *  click pins it, Escape closes it), with a title and short paragraphs.
 *  `children` is a string, an array of strings (one paragraph each) or JSX. */
export function Info({ label, title, children, width = 320 }) {
  const body = typeof children === 'string' || Array.isArray(children)
    ? [].concat(children).map(text => <p key={text} className="hr-pop-text">{text}</p>)
    : children;
  return <InfoPopover label={label || `About ${String(title).toLowerCase()}`} title={title} width={width}>{body}</InfoPopover>;
}

/** HrKit FormField plus an optional (i) beside the label (`info`), which
 *  holds an explanation that would otherwise sit under the field. The
 *  popover's title is `infoTitle`, or the label. Pass `className="hr-col-N"`
 *  to place it on the 12-column form grid. Same label, error slot and help
 *  slot, so the two never look different. The label row can end with
 *  `labelAction` (a small text button such as "+ New"). */
export function MfgField({
  label, htmlFor, required, help, info, infoTitle, error, children, className, style, labelAction,
}) {
  return (
    <div className={className} style={{ position: labelAction ? 'relative' : undefined, ...style }}>
      <div className="form-label mfg-field-label">
        <label htmlFor={htmlFor}>
          {label}{required && <span className="hr-required" aria-hidden="true">*</span>}
        </label>
        {info && <Info title={infoTitle || String(label).replace(/\s*\(PKR\)$/, '')}>{info}</Info>}
        {labelAction && <span className="mfg-label-action">{labelAction}</span>}
      </div>
      {children}
      <div className="hr-field-msg">
        {error
          ? (
            <div className="hr-error" role="alert">
              <span className="material-symbols-outlined" aria-hidden="true">error</span>
              <span>{error}</span>
            </div>
          )
          : help ? <div className="hr-help">{help}</div> : null}
      </div>
    </div>
  );
}

/** A sortable column header (HrKit SortableHeader) with the module's rules:
 *  text columns sort A to Z on the first click; `num` and `date` columns
 *  sort largest or newest first. `num` columns are right-aligned with the
 *  chevron before the label, so the label lines up with the figures.
 *  `sort` is the useSort() result; `info` is an (i) after the label. */
export function SortHead({ sort, column, label, num: isNum, date, style, info, title }) {
  return (
    <SortableHeader
      column={column}
      label={label}
      title={title}
      sortConfig={sort.sortConfig}
      onSort={sort.handleSort}
      align={isNum ? 'right' : undefined}
      iconBefore={isNum}
      firstDirection={isNum || date ? 'desc' : 'asc'}
      after={info}
      style={style}
    />
  );
}

/** Amber help line: allowed, worth a second look (retail below sale rate). */
export function WarnText({ children }) {
  return (
    <span className="mfg-warn-text">
      <span className="material-symbols-outlined" aria-hidden="true">warning</span>
      {children}
    </span>
  );
}

/** Line-editor remove control (the same × as every HR editor line). */
export function RemoveLine({ label, onClick, disabled, title }) {
  return (
    <div className="hr-line-remove">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={title || label}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">close</span>
      </button>
    </div>
  );
}

/** A plain hover text that is not an (i) (the packaging cell's list): shown on
 *  hover AND on keyboard focus (never click-only). The trigger (the only
 *  child) gets aria-describedby; the text renders in a portal, so a table
 *  cell or dialog never clips it. Escape hides it. An (i) uses Info. */
export function Tip({ content, children, width = 280 }) {
  const id = useId();
  const [rect, setRect] = useState(null);
  const target = useRef(null);
  const show = (e) => { if (!content) return; target.current = e.currentTarget; setRect(e.currentTarget.getBoundingClientRect()); };
  const hide = () => { target.current = null; setRect(null); };
  const open = !!rect;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setRect(null); };
    // Focusing an off-screen trigger scrolls it into view: follow it, never hide.
    const follow = () => { if (target.current) setRect(target.current.getBoundingClientRect()); };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);
  const child = React.Children.only(children);
  const chain = (name, fn) => (e) => { if (child.props[name]) child.props[name](e); fn(e); };
  const trigger = React.cloneElement(child, {
    'aria-describedby': content ? id : undefined,
    onMouseEnter: chain('onMouseEnter', show),
    onMouseLeave: chain('onMouseLeave', hide),
    onFocus: chain('onFocus', show),
    onBlur: chain('onBlur', hide),
  });
  let style;
  if (rect) {
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    style = rect.bottom + 140 < window.innerHeight
      ? { left, top: Math.round(rect.bottom + 6), maxWidth: width }
      : { left, bottom: Math.round(window.innerHeight - rect.top + 6), maxWidth: width };
  }
  return (
    <>
      {trigger}
      {content && createPortal(
        <span id={id} role="tooltip" className="mfg-tip" hidden={!rect} style={style}>{content}</span>,
        document.body
      )}
    </>
  );
}

/** Page head of the batch editor and record: breadcrumb, title with the
 *  product and status beside it, actions on the right. `sticky` pins it under
 *  the top bar on these long pages. */
export function MfgPageHead({ crumbs, title, meta, actions, sticky }) {
  return (
    <div className={`mfg-page-head${sticky ? ' is-sticky' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <nav className="mfg-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <React.Fragment key={`${c.label}-${i}`}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
        {title && (
          <div className="mfg-record-title">
            <h1 className="mfg-page-title">{title}</h1>
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="mfg-page-actions">{actions}</div>}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
export const MFG_STYLES = `
  /* Name + muted pack-size tag */
  .mfg-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; white-space: nowrap; }
  .mfg-tag {
    display: inline-flex; align-items: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--gray-100);
    color: var(--gray-600);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .mfg-warn-text { display: inline-flex; align-items: flex-start; gap: 4px; color: #b45309; font-weight: 500; }
  .mfg-warn-text .material-symbols-outlined { font-size: 13px; margin-top: 1px; }
  .mfg-form-row { display: grid; gap: 0 20px; grid-column: 1 / -1; }
  .mfg-form-row.is-name-pack { grid-template-columns: minmax(0, 1fr) 13.5em; }
  .mfg-check { display: inline-flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 600; color: var(--gray-800); cursor: pointer; padding: 9px 0; }
  .mfg-check input { width: 16px; height: 16px; accent-color: var(--blue); }

  .mfg-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; }

  /* Batch status badge (HrKit StatusBadge shape): Draft / Ready / In inventory */
  .mfg-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .mfg-badge-dot { width: 7px; height: 7px; border-radius: 50%; }
  .mfg-badge.is-draft { background: var(--gray-100); color: var(--gray-600); }
  .mfg-badge.is-draft .mfg-badge-dot { background: var(--gray-400); }
  .mfg-badge.is-ready { background: #fef3c7; color: #92400e; }
  .mfg-badge.is-ready .mfg-badge-dot { background: #f59e0b; }
  .mfg-badge.is-done { background: #d1fae5; color: #065f46; }
  .mfg-badge.is-done .mfg-badge-dot { background: #10b981; }
  .mfg-neg { color: var(--red); font-weight: 600; }
  .mfg-amber { color: #b45309; }

  /* Sortable headers stay on one line; an (i) after the label never sorts. */
  .hr-sort-th { white-space: nowrap; }
  .hr-sort-after { display: inline-flex; }
  .hr-sort-after .hr-info-btn { margin: -3px 0 -3px 2px; }

  /* A value shown in place of a field that cannot be edited. */
  .mfg-static-value {
    display: flex; align-items: center; gap: 6px; min-height: 38px;
    font-size: 13.5px; color: var(--gray-800); font-variant-numeric: tabular-nums;
  }
  .mfg-static-value .mfg-sub { color: var(--gray-500); }

  /* Pack size: number + unit joined into one control */
  .mfg-packsize { display: flex; align-items: stretch; }
  .mfg-packsize > input { border-top-right-radius: 0; border-bottom-right-radius: 0; min-width: 0; flex: 1 1 auto; font-variant-numeric: tabular-nums; }
  .mfg-packsize .hr-select { flex: 0 0 auto; }
  .mfg-packsize .hr-select-trigger { height: 100%; min-width: 0; margin-left: -1.5px; border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 8px 8px 8px 10px; gap: 4px; background: var(--gray-50); }
  .mfg-packsize .hr-select-trigger:focus-visible { position: relative; z-index: 1; }

  /* ── Full-page batch record / editor ── */
  .mfg-page { max-width: 1440px; margin: 0 auto; }
  .mfg-page-head {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .mfg-crumbs { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--gray-500); margin-bottom: 6px; }
  .mfg-crumbs a { color: var(--gray-600); text-decoration: none; font-weight: 600; }
  .mfg-crumbs a:hover { color: var(--blue); text-decoration: underline; }
  .mfg-page-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--gray-900); letter-spacing: -0.2px; }
  .mfg-record-title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .mfg-record-product { font-size: 15px; font-weight: 600; color: var(--gray-600); }
  .mfg-page-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
  .mfg-page-status { font-size: 12.5px; color: var(--gray-500); margin-right: 4px; }
  .mfg-page-status.is-error { color: var(--red); }
  .mfg-record { display: grid; grid-template-columns: minmax(0, 7fr) minmax(300px, 3fr); gap: 20px; align-items: start; }
  .mfg-record-side { position: sticky; top: calc(var(--header-h) + 16px); display: flex; flex-direction: column; gap: 16px; }
  /* 1301–1440px (a 1366 laptop): a narrower summary, so a by-product row
     (seven columns) fits the form column on one line. Below that the summary
     moves under the form. */
  @media (min-width: 1301px) and (max-width: 1440px) {
    .mfg-record { grid-template-columns: minmax(0, 1fr) 244px; gap: 16px; }
    .mfg-summary, .mfg-history { padding: 14px 16px; }
    .mfg-summary-line { gap: 8px; }
    .mfg-summary-line > span:first-child, .mfg-history-label, .mfg-history-when { white-space: nowrap; }
    .mfg-history-row { gap: 4px; }
    .mfg-summary-packs th { white-space: nowrap; }
    .mfg-summary-packs td + td, .mfg-summary-packs th + th { padding-left: 8px; }
  }
  @media (max-width: 1300px) {
    .mfg-record { grid-template-columns: minmax(0, 1fr); }
    .mfg-record-side { position: static; }
  }
  .mfg-sec { scroll-margin-top: calc(var(--header-h) + 16px); outline: none; }
  .mfg-static { padding: 9px 0; font-size: 13.5px; color: var(--gray-500); font-style: italic; }
  .mfg-qty-unit { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 8px; }
  .mfg-empty-inline { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 6px 0; }
  .mfg-empty-title { font-size: 13.5px; font-weight: 700; color: var(--gray-800); }
  .mfg-empty-desc { font-size: 12.5px; color: var(--gray-500); margin-top: 2px; max-width: 560px; }
  .mfg-link { color: var(--blue); font-weight: 600; text-decoration: none; }
  .mfg-link:hover { text-decoration: underline; }

  /* Cost summary + history (right column) */
  .mfg-summary, .mfg-history { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 16px 18px; }
  .mfg-summary-title { font-size: 13.5px; font-weight: 700; color: var(--gray-900); margin-bottom: 10px; }
  .mfg-summary-line { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13px; color: var(--gray-600); font-variant-numeric: tabular-nums; }
  .mfg-summary-line > span:last-child { color: var(--gray-800); }
  .mfg-summary-line.is-total { margin-top: 6px; padding-top: 9px; border-top: 1.5px solid var(--gray-200); font-weight: 700; font-size: 14px; color: var(--gray-900); }
  .mfg-summary-line.is-total > span:last-child { color: var(--gray-900); }
  .mfg-summary-block { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--gray-100); }
  .mfg-summary-sub { font-size: 10.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--gray-500); margin-bottom: 6px; }
  .mfg-summary-packs { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .mfg-summary-packs th { padding: 4px 0; font-size: 10.5px; font-weight: 700; color: var(--gray-500); text-align: right; background: none; border: none; text-transform: none; letter-spacing: 0; }
  .mfg-summary-packs th:first-child, .mfg-summary-packs td:first-child { text-align: left; }
  .mfg-summary-packs td { padding: 4px 0; text-align: right; border: none; color: var(--gray-800); }
  .mfg-summary-packs tbody tr:hover { background: transparent; }
  .mfg-summary-warn { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: #92400e; padding: 3px 0; line-height: 1.4; }
  .mfg-summary-warn .material-symbols-outlined { font-size: 15px; margin-top: 1px; color: #b45309; }
  .mfg-summary-ok { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #065f46; }
  .mfg-summary-ok .material-symbols-outlined { font-size: 17px; color: #10b981; }
  .mfg-summary-fix { font-size: 13px; font-weight: 700; color: var(--red); margin-bottom: 6px; }
  .mfg-summary-issues { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
  .mfg-summary-issues button {
    display: block; width: 100%; text-align: left; padding: 6px 8px; margin: 0 -8px; border: none; border-radius: 6px;
    background: transparent; font-family: inherit; font-size: 12.5px; color: var(--gray-700); cursor: pointer; line-height: 1.4;
  }
  .mfg-summary-issues button:hover, .mfg-summary-issues button:focus-visible { background: var(--gray-50); color: var(--gray-900); outline: none; }
  .mfg-summary-sec { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--blue); margin-bottom: 1px; }
  .mfg-history-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 13px; }
  .mfg-history-label { color: var(--gray-500); }
  .mfg-history-value { text-align: right; color: var(--gray-800); font-weight: 600; }
  .mfg-history-when { display: block; font-weight: 400; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; }

  /* Wide read-only tables: tighter side padding so nine columns fit at 1280px */
  .hr-table.mfg-compact thead th, .hr-table.mfg-compact tbody td, .hr-table.mfg-compact tfoot td { padding-left: 9px; padding-right: 9px; }
  .hr-table.mfg-compact thead th:first-child, .hr-table.mfg-compact tbody td:first-child, .hr-table.mfg-compact tfoot td:first-child { padding-left: 18px; }
  .hr-table.mfg-compact thead th:last-child, .hr-table.mfg-compact tbody td:last-child, .hr-table.mfg-compact tfoot td:last-child { padding-right: 18px; }
  /* Below 1366px every list table of the module (.mfg-list on the Tax ledger's
     older tables) takes the same density, so its one-line sortable headers
     still fit beside the sidebar. */
  @media (max-width: 1365px) {
    :is(.hr-table.hr-page-table, table.mfg-list) :is(thead th, tbody td, tfoot td) { padding-left: 9px; padding-right: 9px; }
    :is(.hr-table.hr-page-table, table.mfg-list) :is(thead th, tbody td, tfoot td):first-child { padding-left: 18px; }
    :is(.hr-table.hr-page-table, table.mfg-list) :is(thead th, tbody td, tfoot td):last-child { padding-right: 18px; }
  }

  /* Yield filters + totals */
  .mfg-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .mfg-filter-range { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--gray-500); }
  .mfg-total-row td { padding: 12px 14px; border-top: 1.5px solid var(--gray-200); background: var(--gray-50); font-weight: 700; color: var(--gray-900); }

  /* Status capsule: Ready for inventory / In inventory */
  .mfg-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
  .mfg-status-dot { width: 7px; height: 7px; border-radius: 50%; }
  .mfg-status.is-ready { color: #92400e; }
  .mfg-status.is-ready .mfg-status-dot { background: #f59e0b; }
  .mfg-status.is-done { color: #065f46; }
  .mfg-status.is-done .mfg-status-dot { background: #10b981; }

  /* Number field with the unit inside it */
  .mfg-num { position: relative; }
  .mfg-num-suffix {
    position: absolute; top: 50%; right: 30px; transform: translateY(-50%);
    color: var(--gray-500); font-size: 12.5px; pointer-events: none;
  }
  .mfg-num input { font-variant-numeric: tabular-nums; }

  /* Picker option with a trailing hint (SearchSelect rows) */
  .mfg-opt-label { flex: 1; min-width: 0; }
  .mfg-opt-hint { margin-left: auto; padding-left: 16px; color: var(--gray-500); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Row highlight after an add or a rename (brief section 2) */
  @keyframes mfgFlash { 0%, 35% { background: #fef3c7; } 100% { background: transparent; } }
  .mfg-flash { animation: mfgFlash 1.8s ease-out; }
  @media (prefers-reduced-motion: reduce) { .mfg-flash { animation: none; background: #fef3c7; } }

  /* Line editors: pickers and numbers sit borderless in the grid cells */
  .mfg-lines .hr-line { min-height: 44px; }
  .mfg-lines .hr-select-trigger {
    border: none; border-radius: 0; background: transparent;
    padding: 11px 12px; font-size: 13px; min-height: 44px;
  }
  .mfg-lines .hr-select-trigger:focus-visible { box-shadow: inset 0 0 0 2px var(--blue-light); background: white; }
  .mfg-lines .hr-select-trigger.is-invalid { box-shadow: inset 0 0 0 2px var(--red); }
  .mfg-lines .customer-autocomplete-wrap .form-control { min-height: 44px; }
  /* Dense line cells: no spinner (the keyboard arrows still step by 1), so
     the figure and its unit always fit. */
  .mfg-lines .mfg-num input::-webkit-inner-spin-button,
  .mfg-lines .mfg-num input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .mfg-lines .mfg-num input { -moz-appearance: textfield; }
  .mfg-lines .mfg-num.has-suffix input { padding-right: 44px !important; }
  .mfg-lines .mfg-num-suffix { right: 12px; font-size: 12px; }
  .mfg-cell {
    padding: 11px 12px;
    font-size: 13px;
    color: var(--gray-700);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mfg-cell.is-num { text-align: right; }
  .mfg-cell.is-strong { font-weight: 600; color: var(--gray-900); }
  .mfg-cell.is-muted { color: var(--gray-500); }
  .mfg-line-error { grid-column: 1 / -1; padding: 0 12px 10px; }
  /* Header labels carry the same 12px inset as the cells under them. */
  .mfg-lines .hr-lines-head { padding: 9px 0; }
  .mfg-lines .hr-lines-head > span { padding: 0 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mfg-lines-head-num { text-align: right; }
  .mfg-lines .hr-lines-foot { justify-content: space-between; align-items: center; }
  .mfg-lines-total { font-size: 13px; color: var(--gray-600); font-variant-numeric: tabular-nums; }
  .mfg-lines-total strong { color: var(--gray-900); margin-left: 8px; }

  /* Dialog footer: why the action is blocked, left of the buttons */
  .mfg-foot-status { font-size: 12.5px; color: var(--gray-500); }
  .mfg-foot-status.is-error { color: var(--red); }

  /* Pack rows (batch editor) */
  .mfg-pack {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    background: white;
    margin-bottom: 12px;
  }
  .mfg-pack-head {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 40px;
    gap: 16px;
    align-items: end;
    padding: 14px 6px 4px 16px;
  }
  .mfg-pack-head .form-label { margin-bottom: 6px; }
  .mfg-pack-fig { padding: 9px 0; font-size: 13.5px; color: var(--gray-800); font-variant-numeric: tabular-nums; }
  .mfg-pack-body { padding: 0 16px 14px; }
  .mfg-pack-sub { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--gray-500); margin: 6px 0 8px; }
  .mfg-pack .hr-line-remove { border-left: none; height: 38px; }

  .mfg-batchno { display: flex; align-items: center; }
  .mfg-batchno .form-control { flex: 1; min-width: 0; }
  .mfg-batchno .mfg-icon-btn { margin-right: 4px; }
  .mfg-lines input[type="date"].form-control { padding: 9px 10px; font-variant-numeric: tabular-nums; }
  .mfg-fill { border: 1px solid var(--gray-200); border-radius: var(--radius); padding: 12px 16px 14px; margin-bottom: 14px; background: var(--gray-50); }
  .mfg-fill-figs { display: flex; gap: 28px; font-size: 13px; color: var(--gray-600); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
  .mfg-fill-figs strong { color: var(--gray-900); margin-left: 6px; }

  /* Fill gauge: total output vs packed */
  .mfg-gauge { margin-top: 4px; }
  .mfg-gauge-track { height: 6px; border-radius: 6px; background: var(--gray-100); overflow: hidden; }
  .mfg-gauge-fill { height: 100%; border-radius: 6px; background: var(--blue-light); transition: width 0.2s ease; }
  .mfg-gauge-fill.is-over { background: var(--red); }

  /* Read-only document sections (preview, batch view, purchase view) */
  .mfg-section { margin-top: 22px; }
  .mfg-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .mfg-section-title { font-size: 13px; font-weight: 700; color: var(--gray-800); margin: 0; }
  .mfg-section-note { font-size: 12px; color: var(--gray-500); }
  .mfg-doc-table { border: 1px solid var(--gray-200); border-radius: var(--radius); overflow: hidden; }
  .mfg-doc-table .hr-table thead th { position: static; }
  /* Outranks HR's flush .is-dense edges: these tables sit inside a border. */
  .mfg-doc-table .hr-table.is-dense thead th:first-child, .mfg-doc-table .hr-table.is-dense tbody td:first-child,
  .mfg-doc-table .hr-table.is-dense tfoot td:first-child,
  .mfg-queue-card .hr-table.is-dense thead th:first-child, .mfg-queue-card .hr-table.is-dense tbody td:first-child,
  .mfg-queue-card .hr-table.is-dense tfoot td:first-child { padding-left: 18px; }
  .mfg-doc-table .hr-table.is-dense thead th:last-child, .mfg-doc-table .hr-table.is-dense tbody td:last-child,
  .mfg-doc-table .hr-table.is-dense tfoot td:last-child,
  .mfg-queue-card .hr-table.is-dense thead th:last-child, .mfg-queue-card .hr-table.is-dense tbody td:last-child,
  .mfg-queue-card .hr-table.is-dense tfoot td:last-child { padding-right: 18px; }
  .mfg-doc-table .hr-table tfoot td {
    padding: 10px 14px; border-top: 1.5px solid var(--gray-200);
    background: var(--gray-50); font-weight: 700; color: var(--gray-900);
  }
  .mfg-subrow td { padding-top: 0 !important; color: var(--gray-500); font-size: 12.5px; }
  .mfg-warn-cell { color: #b45309; font-weight: 600; }

  /* Card header with tabs on the left and actions on the right; the active
     tab's underline sits on the header rule. Actions wrap below ~1100px
     instead of pushing a button off the card. */
  /* wrap-reverse: when the actions do not fit beside the tabs they move to a
     row ABOVE them, so the tabs always stay on the header rule. */
  .mfg-card-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0 16px;
    flex-wrap: wrap-reverse; padding: 12px 22px 0; border-bottom: 1px solid var(--gray-200);
  }
  .mfg-card-head .hr-tabs { border-top: none; padding: 0; margin-bottom: -1px; }
  .mfg-card-head .hr-tab { padding: 13px 12px; }
  .mfg-head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; padding-bottom: 12px; margin-left: auto; min-height: 50px; box-sizing: border-box; }

  /* Units of measure pop-up */
  .mfg-uom-add { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 10px; align-items: end; }
  .mfg-uom-edit { display: grid; grid-template-columns: 80px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; }
  .mfg-uom-edit .form-control { padding: 6px 10px; }

  /* Categories pop-up */
  .mfg-cat-add { display: flex; gap: 8px; align-items: flex-start; }
  .mfg-cat-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--gray-200); border-radius: var(--radius); max-height: 52vh; overflow-y: auto; }
  .mfg-cat-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
    padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--gray-100);
  }
  .mfg-cat-row:last-child { border-bottom: none; }
  .mfg-cat-name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--gray-800); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mfg-cat-count { font-size: 12px; color: var(--gray-500); white-space: nowrap; margin-right: 4px; }
  .mfg-cat-edit { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
  .mfg-cat-edit .form-control { padding: 6px 10px; }
  .mfg-cat-edit .btn-sm { margin-top: 1px; }
  .mfg-cat-notice { flex-basis: 100%; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #991b1b; padding: 2px 0 2px; }
  .mfg-cat-notice .material-symbols-outlined { font-size: 14px; }
  .mfg-icon-btn {
    width: 30px; height: 30px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 7px; background: transparent; color: var(--gray-500); cursor: pointer;
    transition: var(--transition);
  }
  .mfg-icon-btn .material-symbols-outlined { font-size: 18px; }
  .mfg-icon-btn:hover { background: var(--gray-100); color: var(--gray-900); }
  .mfg-icon-btn.is-danger:hover { background: var(--red-pale); color: var(--red); }
  .mfg-icon-btn[aria-disabled="true"] { color: var(--gray-300); cursor: not-allowed; }
  .mfg-icon-btn[aria-disabled="true"]:hover { background: transparent; color: var(--gray-300); }
  .mfg-icon-btn:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }

  /* Yield queue */
  .mfg-queue-card { border: 1px solid var(--gray-200); border-radius: 12px; background: white; margin-bottom: 16px; overflow: hidden; }
  .mfg-queue-head {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 18px; border-bottom: 1px solid var(--gray-100);
  }
  .mfg-queue-title { font-size: 14.5px; font-weight: 700; color: var(--gray-900); }
  .mfg-queue-meta { font-size: 12.5px; color: var(--gray-500); margin-top: 2px; font-variant-numeric: tabular-nums; }
  .mfg-queue-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .mfg-queue-card .hr-table thead th { position: static; }
  .mfg-queue-card .hr-table thead th:first-child, .mfg-queue-card .hr-table tbody td:first-child, .mfg-queue-card .hr-table tfoot td:first-child { padding-left: 18px; }
  .mfg-queue-card .hr-table thead th:last-child, .mfg-queue-card .hr-table tbody td:last-child, .mfg-queue-card .hr-table tfoot td:last-child { padding-right: 18px; }
  .mfg-queue-card .hr-table tfoot td {
    padding: 10px 12px; border-top: 1.5px solid var(--gray-200);
    background: var(--gray-50); font-weight: 700; color: var(--gray-900);
  }
  /* ── Manufacturing UX kept from the 2026-10-13 pass, in the app's own
     palette and shapes (no shared design tokens). ── */

  /* Icons inside buttons and the search box keep their usual size. */
  .page-content .btn > .material-symbols-outlined { font-size: 16px; }
  .page-content .search-bar > .material-symbols-outlined { font-size: 18px; color: var(--gray-400); }

  /* Page head: the editor and record pin it under the top bar, so the
     actions and the status line stay in reach on a long form. */
  .mfg-page-head.is-sticky {
    position: sticky; top: var(--header-h); z-index: 20;
    margin: -28px -28px 18px; padding: 14px 28px;
    background: var(--gray-50); border-bottom: 1px solid var(--gray-200);
  }
  .mfg-page-head.is-sticky + .mfg-record .mfg-record-side { top: calc(var(--header-h) + 96px); }
  .mfg-page-head.is-sticky ~ .mfg-record .mfg-sec { scroll-margin-top: calc(var(--header-h) + 96px); }
  @media (max-width: 768px) {
    .mfg-page-head.is-sticky { margin: -16px -16px 16px; padding: 12px 16px; }
  }

  /* "KHALIS Hair Oil · 200 ml": the pack size is muted text, not a tag. */
  .mfg-name { align-items: baseline; gap: 5px; }
  .mfg-name-main { color: inherit; }
  .mfg-name-sep, .mfg-name-size { color: var(--gray-500); font-variant-numeric: tabular-nums; }

  /* Empty values, secondary text and document codes */
  .mfg-empty-val, .mfg-sub { color: var(--gray-500); }
  .mfg-code { color: var(--gray-800); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mfg-note { margin: 12px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--gray-500); }
  .mfg-field-label { display: flex; align-items: center; gap: 4px; }
  .mfg-field-label > label { cursor: inherit; }
  /* The (i) must not make its label row taller than the ones beside it. */
  .mfg-field-label .hr-info-btn { margin: -2px 0 -2px 2px; }

  /* The packs table (eight columns) fits the left column at 1280px: columns
     size to their figures, inner cells are tighter, and headers wrap instead
     of running together. */
  .mfg-doc-table.is-wide { overflow-x: auto; }
  .mfg-doc-table.is-wide .hr-table.is-dense { table-layout: auto; }
  .mfg-doc-table.is-wide .hr-table.is-dense thead th,
  .mfg-doc-table.is-wide .hr-table.is-dense tbody td { padding-left: 8px; padding-right: 8px; }
  .mfg-doc-table.is-wide .hr-table.is-dense thead th:first-child,
  .mfg-doc-table.is-wide .hr-table.is-dense tbody td:first-child { padding-left: 18px; }
  .mfg-doc-table.is-wide .hr-table.is-dense thead th:last-child,
  .mfg-doc-table.is-wide .hr-table.is-dense tbody td:last-child { padding-right: 18px; }
  .mfg-doc-table.is-wide .hr-table thead th { white-space: normal; vertical-align: bottom; }
  .mfg-doc-table.is-wide .hr-table thead th:first-child { white-space: nowrap; }
  .mfg-doc-table.is-wide.is-nowrap-head .hr-table thead th { white-space: nowrap; }

  /* Number field: the browser spinner is replaced by a slim stepper inside
     the right edge (ArrowUp / ArrowDown still step by 1). */
  .mfg-num input::-webkit-inner-spin-button,
  .mfg-num input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .mfg-num input { -moz-appearance: textfield; padding-right: 30px; }
  .mfg-num-suffix { right: 26px; }
  .mfg-stepper {
    position: absolute; top: 5px; bottom: 5px; right: 5px; width: 16px;
    display: flex; flex-direction: column;
  }
  .mfg-stepper-btn {
    flex: 1 1 50%; display: flex; align-items: center; justify-content: center; padding: 0;
    border: none; border-radius: 3px; background: transparent; color: var(--gray-500); cursor: pointer;
  }
  .mfg-stepper-btn:hover { background: var(--gray-100); color: var(--gray-900); }
  .mfg-stepper-btn:active { background: var(--gray-200); }
  .mfg-lines .mfg-num-suffix { right: 26px; }
  .mfg-packsize > .mfg-num { flex: 1 1 auto; min-width: 0; }
  .mfg-packsize > .mfg-num input { border-top-right-radius: 0; border-bottom-right-radius: 0; }

  /* Add …: one "+" glyph on every add control */
  .btn.mfg-add { gap: 4px; }

  .mfg-summary-sec { display: inline; font-size: inherit; letter-spacing: 0; text-transform: none; color: var(--gray-500); margin: 0; }
  .mfg-summary-sec::after { content: ' · '; }
  .mfg-pack-error { margin-top: 8px; }

  /* Read-only value shown in a field's place (the batch code to be assigned). */
  .form-control.mfg-readonly { background: var(--gray-50); color: var(--gray-800); font-weight: 600; font-variant-numeric: tabular-nums; cursor: default; }
  .form-control.mfg-readonly:focus { box-shadow: none; border-color: var(--gray-200); }


  /* Tip: plain hover text (not an (i)), on hover and keyboard focus, max 280px. */
  .mfg-tip {
    position: fixed; z-index: 400; display: block; width: max-content; padding: 8px 11px;
    background: white; border: 1px solid var(--gray-200); border-radius: 8px; box-shadow: var(--shadow-lg);
    font-family: inherit; font-size: 12.5px; font-weight: 400; line-height: 1.5; color: var(--gray-700);
    text-transform: none; letter-spacing: 0; text-align: left; white-space: normal; pointer-events: none;
  }
  .mfg-tip[hidden] { display: none; }
  .mfg-tip-list { margin: 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; }
  .mfg-tip-list li { display: flex; justify-content: space-between; gap: 16px; }
  .mfg-tip-issue { display: block; margin-top: 4px; color: var(--red); }
  .mfg-tip-issue:first-child { margin-top: 0; }
  /* (i) (HrKit InfoPopover) in a column header or beside a field label: it
     must not make the row taller than the ones beside it. */
  .hr-lines-head .hr-info-btn, .hr-table thead .hr-info-btn { margin: -3px 0 -3px 2px; }
  .mfg-field-label .mfg-label-action { margin-left: auto; }
  /* Narrow numeric columns: the header may wrap rather than be cut off. */
  .mfg-lines .hr-lines-head.is-wrap { align-items: end; }
  .mfg-lines .hr-lines-head.is-wrap > span { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.35; }

  /* Line tables: room for the stepper and the calendar button inside a cell. */
  .hr-line .mfg-num input.form-control { padding-right: 28px; }
  .hr-line .date-input > input.form-control { padding-right: 34px; }

  /* Packs table: the packaging cell and the fill figures in the header. */
  .mfg-pkg-cell { display: flex; align-items: center; padding: 0 6px; }
  .mfg-cell-btn {
    display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 32px; padding: 4px 8px;
    border: none; border-radius: 6px; background: transparent; font-family: inherit; font-size: 13px;
    color: var(--gray-800); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mfg-cell-btn:hover { background: var(--gray-100); }
  .mfg-cell-btn:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .mfg-cell-btn.is-add { color: var(--blue); font-weight: 600; }
  .mfg-cell-btn .material-symbols-outlined { font-size: 16px; color: var(--gray-500); }
  .mfg-cell-btn.is-add .material-symbols-outlined { color: var(--blue); }
  .mfg-cell-btn .mfg-pkg-warn { color: #b45309; }
  .mfg-cell-btn[aria-invalid="true"] { box-shadow: inset 0 0 0 1.5px #f59e0b; }
  .mfg-fill-head { min-width: 260px; outline: none; }
  .mfg-fill-head .mfg-fill-figs { justify-content: flex-end; gap: 16px; margin: 0 0 5px; font-size: 12.5px; }
  .mfg-fill-head .mfg-gauge-track { height: 4px; }
  .mfg-fill-head.is-over .mfg-fill-figs strong:nth-of-type(1) { color: inherit; }
  .mfg-title-sub { margin-left: 8px; font-size: 12.5px; font-weight: 500; color: var(--gray-500); letter-spacing: 0; }
  .mfg-head-figure { font-size: 12.5px; color: var(--gray-500); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mfg-head-figure strong { color: var(--gray-800); font-weight: 600; margin-left: 4px; }
  .modal:has(.mfg-pkg-dialog) { max-width: 760px; }
  .mfg-pkg-dialog .hr-lines-foot { justify-content: space-between; align-items: center; }

  /* By-products table: one row each, compact cells. Qty 64 · Batch no. 124
     ("B-261013-01-BP") · Expiry 124 · Purchase rate 124 (its header and (i))
     · Sale rate 120 · × 36 px; the by-product takes the rest (at least 140 px,
     about 150 at 1366). Headers never wrap. */
  .mfg-by-lines .hr-lines-head, .mfg-by-lines .hr-line {
    grid-template-columns: minmax(140px, 1fr) 64px 124px 124px 124px 120px 36px;
  }
  .mfg-by-lines .hr-lines-head > span { white-space: nowrap; overflow: visible; text-overflow: clip; }
  .mfg-by-lines .hr-lines-head > span:nth-child(5), .mfg-by-lines .hr-lines-head > span:nth-child(6) { padding: 0 6px 0 3px; }
  .mfg-by-lines .hr-line-remove { width: 36px; }
  .mfg-by-lines .hr-line .form-control { padding-left: 9px; padding-right: 9px; }
  .mfg-by-lines .hr-line .mfg-num input.form-control { padding-right: 26px; }
  .mfg-by-lines .hr-line .date-input > input.form-control { padding-left: 8px; padding-right: 30px; }
  .mfg-by-lines .hr-select-trigger { padding-left: 9px; padding-right: 9px; }
  .mfg-by-lines .mfg-batchno .form-control { font-size: 12.5px; }

  /* Yield: the filters get their own row under the card title. */
  .mfg-filterbar { padding: 12px 22px; border-bottom: 1px solid var(--gray-100); }
  .mfg-filterbar .mfg-filters { justify-content: flex-start; }

  /* "+ New" at the end of a field label, and its small popover under the label. */
  .mfg-text-btn {
    display: inline-flex; align-items: center; gap: 2px; padding: 0 4px; margin: -2px -4px -2px 0;
    border: none; border-radius: 6px; background: transparent; font-family: inherit;
    font-size: 12.5px; font-weight: 600; color: var(--blue); cursor: pointer; line-height: 20px;
  }
  .mfg-text-btn .material-symbols-outlined { font-size: 15px; }
  .mfg-text-btn:hover { background: var(--blue-ultra); }
  .mfg-text-btn:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  .mfg-new-pop {
    position: absolute; z-index: 30; top: 26px; left: 0; right: 0;
    padding: 12px; background: white; border: 1px solid var(--gray-200); border-radius: 10px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
  }
  .mfg-new-pop-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

  /* "N things to fix" beside the page buttons: a link to the list. */
  .mfg-page-status.is-link {
    padding: 0; border: none; background: none; font-family: inherit; font-weight: 600; cursor: pointer;
    text-decoration: underline; text-underline-offset: 3px;
  }
  .mfg-page-status.is-link:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 2px; border-radius: 4px; }
`;

export function MfgStyles() {
  return <style dangerouslySetInnerHTML={{ __html: MFG_STYLES }} />;
}

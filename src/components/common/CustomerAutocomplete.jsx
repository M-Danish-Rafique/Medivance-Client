import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Searchable customer picker: a text input that filters the customer list
 * as you type, showing a dropdown with name + territory/area (+ phone) below
 * each match. Drop-in replacement for the plain <select> customer dropdowns
 * that no longer scale now that the customer list is large.
 *
 * Props:
 *  - customers: array of customer objects ({ id, name, area_id, territory_id, phone, ... })
 *  - areas: array of { id, name }
 *  - territories: array of { id, name }
 *  - value: currently selected customer id ('' if none)
 *  - onChange(id, customer): called with the picked customer's id (and full
 *      object), or ('', null) when cleared
 *  - placeholder: input placeholder text
 *  - allowClear: when true, shows a "clearLabel" option at the top of the
 *      list to reset the selection (use this for filter-style dropdowns,
 *      e.g. "All Customers"). Default false, for required single-pick fields.
 *  - clearLabel: label shown for the clear option (default 'All Customers')
 *  - disabled
 *  - style: extra style for the outer wrapper (e.g. minWidth)
 */
export default function CustomerAutocomplete({
  customers = [], areas = [], territories = [],
  value, onChange, placeholder = 'Search customer by name…',
  allowClear = false, clearLabel = 'All Customers', disabled = false,
  style,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const areaNameById = useMemo(() => Object.fromEntries(areas.map(a => [String(a.id), a.name])), [areas]);
  const territoryNameById = useMemo(() => Object.fromEntries(territories.map(t => [String(t.id), t.name])), [territories]);

  const locationOf = (c) => [territoryNameById[String(c.territory_id)], areaNameById[String(c.area_id)]].filter(Boolean).join(', ');

  const labelOf = (c) => {
    const loc = locationOf(c);
    return loc ? `${c.name} — ${loc}` : c.name;
  };

  const selected = useMemo(() => customers.find(c => String(c.id) === String(value)) || null, [customers, value]);

  // Keep the input text in sync with the current selection whenever the
  // dropdown isn't open (i.e. the user isn't actively typing a new search).
  useEffect(() => {
    if (!open) setQuery(selected ? labelOf(selected) : '');
  }, [selected, open]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(selected ? labelOf(selected) : '');
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [selected]);

  // Inputs auto-scroll to keep the caret in view, which after a
  // programmatic value change tends to leave the tail of the text
  // visible (with no room left for text-overflow to render "…").
  // Force the scroll position back to the start whenever we're showing
  // the closed/selected label so the ellipsis shows up correctly.
  useEffect(() => {
    if (!open && inputRef.current) {
      inputRef.current.scrollLeft = 0;
    }
  }, [query, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? customers
      : customers
          .map(c => {
            const name = c.name.toLowerCase();
            const loc = locationOf(c).toLowerCase();
            const phone = String(c.phone || '').toLowerCase();
            let score = -1;
            if (name.startsWith(q)) score = 0;
            else if (name.includes(q)) score = 1;
            else if (loc.includes(q)) score = 2;
            else if (phone.includes(q)) score = 3;
            return { c, score };
          })
          .filter(x => x.score >= 0)
          .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
          .map(x => x.c);
    return base.slice(0, 50);
  }, [customers, query, areaNameById, territoryNameById]);

  const pick = (c) => {
    onChange(c ? c.id : '', c || null);
    setQuery(c ? labelOf(c) : '');
    setOpen(false);
    setHighlight(0);
    if (inputRef.current) inputRef.current.blur();
  };

  const optionCount = filtered.length + (allowClear ? 1 : 0);

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, optionCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (allowClear && highlight === 0) pick(null);
      else {
        const c = filtered[allowClear ? highlight - 1 : highlight];
        if (c) pick(c);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(selected ? labelOf(selected) : '');
    }
  };

  return (
    <div ref={wrapRef} className="customer-autocomplete-wrap" style={style}>
      <input
        ref={inputRef}
        className="form-control"
        disabled={disabled}
        value={query}
        placeholder={selected && !open ? labelOf(selected) : placeholder}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        title={selected && !open ? labelOf(selected) : undefined}
        style={{
          paddingRight: selected && !open ? 30 : undefined,
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      />
      {selected && !open && (
        <button
          type="button"
          title="Clear selection"
          onClick={() => pick(null)}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', color: 'var(--gray-400)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2,
          }}
        >
          ×
        </button>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 6,
          marginTop: 4, maxHeight: 300, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        }}>
          {allowClear && (
            <div
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(null)}
              onMouseEnter={() => setHighlight(0)}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontStyle: 'italic',
                color: 'var(--gray-500)', background: highlight === 0 ? 'var(--gray-100)' : 'transparent',
                borderBottom: '1px solid var(--gray-100)',
              }}
            >
              {clearLabel}
            </div>
          )}
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--gray-400)' }}>
              No customers found
            </div>
          ) : filtered.map((c, i) => {
            const idx = allowClear ? i + 1 : i;
            const loc = locationOf(c);
            return (
              <div
                key={c.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(c)}
                onMouseEnter={() => setHighlight(idx)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: idx === highlight ? 'var(--gray-100)' : 'transparent',
                  borderBottom: '1px solid var(--gray-100)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
                  {loc || '—'}{c.phone ? ` • ${c.phone}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
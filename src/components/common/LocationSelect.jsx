import React, { useState, useRef, useEffect, useMemo } from 'react';

// Single searchable dropdown for picking a Territory, shown as
// "Territory · Area · City". Selecting an option hands back the full
// territory record so the caller can set city_id/area_id/territory_id
// together, instead of driving three cascading selects.
export default function LocationSelect({ geo, value, onChange, placeholder = 'Search territory, area or city...', disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);

  const options = useMemo(() => (geo.territories || []).map(t => ({
    id: t.id,
    area_id: t.area_id,
    city_id: t.city_id,
    name: t.name,
    area_name: t.area_name,
    city_name: t.city_name,
    label: `${t.name} · ${t.area_name} · ${t.city_name}`
  })), [geo.territories]);

  const selected = options.find(o => String(o.id) === String(value)) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.area_name.toLowerCase().includes(q) ||
      o.city_name.toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { setHighlight(0); }, [query, open]);

  const selectOption = (opt) => {
    onChange(opt);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) selectOption(filtered[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        className="form-control"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected ? selected.label : '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          marginTop: 4, background: 'white', border: '1px solid var(--gray-200)',
          borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          maxHeight: 240, overflowY: 'auto'
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--gray-400)' }}>No matching location</div>
          ) : filtered.map((opt, i) => (
            <div
              key={opt.id}
              onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '9px 12px', cursor: 'pointer', fontSize: 13.5,
                background: i === highlight ? 'var(--gray-100)' : 'transparent'
              }}
            >
              <span style={{ fontWeight: 600 }}>{opt.name}</span>
              <span style={{ color: 'var(--gray-400)' }}> · {opt.area_name} · {opt.city_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

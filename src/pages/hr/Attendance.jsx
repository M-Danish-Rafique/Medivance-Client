import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import {
  HrStyles, SortableHeader, useSort, sortRows, byText, byNumber,
  KebabMenu, TableSkeleton, EmptyState, BusyButton, FormField, Select,
  fmtMonth, num, apiError, apiFieldError, initials, MONTH_NAMES,
} from './HrKit';

// ─── Attendance ────────────────────────────────────────────────────────────
// Two views of the same data:
//
//   Daily Register — a month's registers, one row per date. "Create
//                    Attendance" asks for a date inside that month, then opens
//                    the whole workforce on one sheet to be marked in a single
//                    pass; saving returns to the month. Any row re-opens that
//                    date's register for review or correction.
//   By Employee    — a roster with per-person counts, drilling into one
//                    employee's history in place (never a modal). This is
//                    where a single mark is corrected or deleted.
//
// A register is not a stored entity: it is the set of marks saved for a date.
// The server upserts on (employee, date), so re-opening and re-saving a date
// is idempotent, and only CHANGED rows are submitted so a partly filled sheet
// never wipes marks somebody else entered.
//
// The flat "Attendance Log" tab was removed: every record it listed is one
// click away from its date (Daily Register) or its person (By Employee), and
// both of those carry the corrections the log offered.

const ROSTER_COMPARATORS = {
  name:               byText('name'),
  department_name:    byText('department_name'),
  present_days:       byNumber('present_days'),
  absent_days:        byNumber('absent_days'),
  recorded_days:      byNumber('recorded_days'),
  last_recorded_date: byText('last_recorded_date'),
};

// ── Calendar helpers ───────────────────────────────────────────────────────
// Pure string/calendar math on PKT YYYY-MM-DD strings. Date.UTC is used only
// to count days and weekdays, never to read "now" — todayPKT() does that.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const splitIso = (iso) => iso.split('-').map(Number);
const weekdayOf = (iso) => { const [y, m, d] = splitIso(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "2026-09-14" -> "Monday, 14 September 2026" */
function longDate(iso) {
  const [y, m, d] = splitIso(iso);
  return `${WEEKDAYS[weekdayOf(iso)]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** First and last calendar day of a YYYY-MM month. */
function monthRange(month) {
  const [y, m] = splitIso(month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: isoOf(y, m, 1), last: isoOf(y, m, days) };
}

/** One day earlier, as a YYYY-MM-DD string. */
function prevDay(iso) {
  const [y, m, d] = splitIso(iso);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Table dates read as "20 Sep · Sun": a day and a word, never 20/09/2026.
// The year is dropped when it is the current one — it is noise on nearly
// every row — and kept otherwise so an old record is never ambiguous.
const SHORT_MONTHS = MONTH_NAMES.map(m => m.slice(0, 3));
const SHORT_DAYS = WEEKDAYS.map(d => d.slice(0, 3));

/** "2026-09-20" -> "20 Sep" this year, "20 Sep 2025" otherwise. */
function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = splitIso(iso);
  return `${d} ${SHORT_MONTHS[m - 1]}${String(y) === todayPKT().slice(0, 4) ? '' : ` ${y}`}`;
}

/** "Today" / "Yesterday" for the two days people actually say that about. */
function relativeDay(iso) {
  const today = todayPKT();
  if (iso === today) return 'Today';
  if (iso === prevDay(today)) return 'Yesterday';
  return null;
}

function DateCell({ iso }) {
  return (
    <span className="att-date">
      <span className="hr-cell-strong">{shortDate(iso)}</span>
      <span className="att-weekday">{relativeDay(iso) || SHORT_DAYS[weekdayOf(iso)]}</span>
    </span>
  );
}

const currentMonthPKT = () => todayPKT().slice(0, 7);

/** Last 12 months, newest first. */
function recentMonths(count = 12) {
  const [year, month] = splitIso(currentMonthPKT());
  const months = [];
  for (let i = 0; i < count; i++) {
    const total = year * 12 + (month - 1) - i;
    months.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}

const parseAreaIds = (list) => (
  list ? String(list).split(',').map(Number).filter(Number.isFinite) : []
);

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// ── Small shared pieces ────────────────────────────────────────────────────
const Dash = ({ title }) => <span className="att-dash" title={title}>—</span>;

function DiscardModal({ isOpen, onStay, onDiscard, count }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onStay}
      title="Discard unsaved marks?"
      size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={onStay}>Keep marking</button>
          <button className="btn btn-danger" onClick={onDiscard}>Discard</button>
        </>
      }
    >
      <div className="hr-locked">
        <span className="material-symbols-outlined" aria-hidden="true">warning</span>
        <span>
          {count} unsaved change{count === 1 ? '' : 's'} on this register will be lost.
          Nothing already saved is affected.
        </span>
      </div>
    </Modal>
  );
}

// ── Area picker ────────────────────────────────────────────────────────────
// Built for the real case: a field employee covers two or three areas a day,
// usually the same beat as last time. So:
//   • The chosen areas live INSIDE the search field as tokens (the familiar
//     "To:" field pattern) — no separate tray eating height for three names.
//     Backspace on an empty field removes the last one.
//   • "Recently covered" sits at the top of the list: the areas this person
//     tagged on their latest days, so the usual beat is one click each.
//   • Search matches AREA names only. Matching city names made every area of
//     a city a hit, and put an unrelated area under Enter.
//   • No whole-city selection: nobody covers a whole city in a day, and a
//     one-click "select 40 areas" is only ever a mistake.
//   • Keyboard: type, ↑/↓ to move, Enter to pick; the field clears and keeps
//     focus for the next one.
//   • The list has a fixed height, so the dialog never resizes under the
//     pointer while filtering, or when the recent areas arrive.
function Highlight({ text, query }) {
  if (!query) return text;
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <b className="att-picker-hit">{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  );
}

const RECENT_LIMIT = 5;

function AreaPicker({ idPrefix, areasByCity, selected, onChange, employeeId, autoFocus }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);
  const q = query.trim().toLowerCase();

  const areaById = useMemo(() => {
    const map = new Map();
    for (const [city, list] of areasByCity) for (const area of list) map.set(area.id, { ...area, city });
    return map;
  }, [areasByCity]);

  // The employee's most recent distinct areas, newest first. Best effort: if
  // the history cannot be read the picker simply has no "recent" group.
  useEffect(() => {
    if (!employeeId) return undefined;
    let live = true;
    api.get(`/hr/attendance/by-employee/${employeeId}`)
      .then(r => {
        if (!live) return;
        const seen = [];
        for (const record of r.data.records) {
          for (const id of parseAreaIds(record.area_id_list)) {
            if (!seen.includes(id)) seen.push(id);
          }
          if (seen.length >= RECENT_LIMIT) break;
        }
        setRecent(seen.slice(0, RECENT_LIMIT));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [employeeId]);

  // Search results: area-name matches only, names that START with the query
  // first (typing "kh" should land on Khanna Pul before Sukh Chayn).
  const matches = useMemo(() => {
    if (!q) return [];
    const hits = [];
    for (const area of areaById.values()) {
      const at = area.name.toLowerCase().indexOf(q);
      if (at >= 0) hits.push({ area, rank: at === 0 ? 0 : 1 });
    }
    return hits
      .sort((a, b) => a.rank - b.rank || a.area.name.localeCompare(b.area.name))
      .map(h => h.area);
  }, [areaById, q]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { optionRefs.current[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const toggle = (id) => onChange(toggleIn(selected, id));

  const pick = (area) => {
    toggle(area.id);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setActive(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) pick(matches[active]);
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'Backspace' && !query && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  const recentAreas = recent.map(id => areaById.get(id)).filter(Boolean);

  optionRefs.current = [];
  const row = (area, { index, showCity } = {}) => {
    const checked = selected.includes(area.id);
    const isActive = index !== undefined && index === active;
    return (
      <label
        key={`${showCity ? 'r' : 'c'}-${area.id}`}
        ref={index !== undefined ? (el => { optionRefs.current[index] = el; }) : undefined}
        htmlFor={`${idPrefix}-${showCity ? 'r' : 'c'}-${area.id}`}
        className={`att-picker-item${checked ? ' is-on' : ''}${isActive ? ' is-active' : ''}`}
        onMouseEnter={index !== undefined ? () => setActive(index) : undefined}
      >
        <input
          id={`${idPrefix}-${showCity ? 'r' : 'c'}-${area.id}`}
          type="checkbox"
          checked={checked}
          onChange={() => (index !== undefined ? pick(area) : toggle(area.id))}
        />
        <span className="att-picker-name"><Highlight text={area.name} query={q} /></span>
        {showCity && <span className="att-picker-city-note">{area.city}</span>}
      </label>
    );
  };

  return (
    <div className="att-picker">
      <div className="att-token-field" onClick={() => inputRef.current?.focus()}>
        <span className="material-symbols-outlined att-token-icon" aria-hidden="true">search</span>
        {selected.map(id => {
          const name = areaById.get(id)?.name || `Area #${id}`;
          return (
            <span className="att-chip" key={id}>
              {name}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); toggle(id); }}
                aria-label={`Remove ${name}`}
              >
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </span>
          );
        })}
        <label htmlFor={`${idPrefix}-search`} className="hr-sr-only">Search areas</label>
        <input
          ref={inputRef}
          id={`${idPrefix}-search`}
          className="att-token-input"
          placeholder={selected.length ? 'Add another area…' : 'Search areas…'}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={!!q}
          aria-autocomplete="list"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="att-picker-list" role="group" aria-label="Areas">
        {q ? (
          matches.length === 0
            ? <div className="att-picker-empty">No area matches “{query.trim()}”</div>
            : matches.map((area, index) => row(area, { index, showCity: true }))
        ) : (
          <>
            {recentAreas.length > 0 && (
              <div>
                <div className="att-picker-group">Recently covered</div>
                {recentAreas.map(area => row(area, { showCity: true }))}
              </div>
            )}
            {areasByCity.map(([city, list]) => (
              <div key={city}>
                <div className="att-picker-group">{city}</div>
                {list.map(area => row(area))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const toggleIn = (list, id) => (list.includes(id) ? list.filter(a => a !== id) : [...list, id]);

// ═══════════════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════════════
export default function Attendance() {
  const [tab, setTab] = useState('register'); // 'register' | 'roster'
  const [registerMonth, setRegisterMonth] = useState(currentMonthPKT);
  const [openRegister, setOpenRegister] = useState(null); // { date, isNew }
  const [sheetDirty, setSheetDirty] = useState(0);        // unsaved change count
  const [pendingTab, setPendingTab] = useState(null);

  const [areas, setAreas] = useState([]);
  useEffect(() => {
    api.get('/geography/areas').then(r => setAreas(r.data)).catch(() => setAreas([]));
  }, []);

  const areasByCity = useMemo(() => {
    const grouped = new Map();
    for (const area of areas) {
      const city = area.city_name || 'Other';
      if (!grouped.has(city)) grouped.set(city, []);
      grouped.get(city).push(area);
    }
    return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [areas]);

  const switchTab = (next) => {
    if (next === tab) return;
    if (openRegister && sheetDirty) { setPendingTab(next); return; }
    setOpenRegister(null);
    setTab(next);
  };

  const closeRegister = useCallback(() => {
    setOpenRegister(null);
    setSheetDirty(0);
  }, []);

  return (
    <Layout title="Attendance">
      <HrStyles />

      <div className="tabs" role="tablist" aria-label="Attendance views">
        <button
          role="tab"
          aria-selected={tab === 'register'}
          className={`tab-btn${tab === 'register' ? ' active' : ''}`}
          onClick={() => switchTab('register')}
        >
          Daily Register
        </button>
        <button
          role="tab"
          aria-selected={tab === 'roster'}
          className={`tab-btn${tab === 'roster' ? ' active' : ''}`}
          onClick={() => switchTab('roster')}
        >
          By Employee
        </button>
      </div>

      {tab === 'register' && (
        openRegister ? (
          <RegisterSheet
            key={openRegister.date}
            date={openRegister.date}
            isNew={openRegister.isNew}
            areas={areas}
            areasByCity={areasByCity}
            onClose={closeRegister}
            onDirtyChange={setSheetDirty}
          />
        ) : (
          <RegisterList
            month={registerMonth}
            onMonthChange={setRegisterMonth}
            onOpen={(date, isNew) => setOpenRegister({ date, isNew })}
          />
        )
      )}

      {tab === 'roster' && (
        <ByEmployee
          areasByCity={areasByCity}
          onOpenRegister={(date) => {
            setRegisterMonth(date.slice(0, 7));
            setOpenRegister({ date, isNew: false });
            setTab('register');
          }}
        />
      )}

      <DiscardModal
        isOpen={!!pendingTab}
        count={sheetDirty}
        onStay={() => setPendingTab(null)}
        onDiscard={() => {
          closeRegister();
          setTab(pendingTab);
          setPendingTab(null);
        }}
      />
    </Layout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Daily Register — the month's list of registers
// ═══════════════════════════════════════════════════════════════════════════
function RegisterList({ month, onMonthChange, onOpen }) {
  const [registers, setRegisters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState('');
  const [createError, setCreateError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/hr/attendance/registers', { params: { month } })
      .then(r => setRegisters(r.data.registers))
      .catch(err => setError(apiError(err, 'Could not load this month’s registers.')))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const monthOptions = useMemo(
    () => recentMonths(12).map(m => ({ value: m, label: fmtMonth(m) })),
    []
  );

  const today = todayPKT();
  const { first, last } = monthRange(month);
  const maxDate = last < today ? last : today;
  const registeredDates = useMemo(() => new Set(registers.map(r => r.date)), [registers]);

  // Attendance is present ÷ on roll. Dividing by the MARKED count instead made
  // a half-taken register (1 present, 1 absent, 2 unmarked) read "50%" when
  // only one of four people is known to have attended.
  const totals = useMemo(() => {
    const present = registers.reduce((sum, r) => sum + r.present, 0);
    const onRoll  = registers.reduce((sum, r) => sum + r.on_roll, 0);
    return { rate: pct(present, onRoll) };
  }, [registers]);

  // Days of the month so far (all of them, for a past month).
  const elapsedDays = Number(maxDate.slice(8, 10));

  const openCreate = () => {
    // Default to the latest date in the month that has no register yet, so
    // the common case — today's register — is one click plus Enter.
    let pick = maxDate;
    for (let d = maxDate; d >= first; d = prevDay(d)) {
      if (!registeredDates.has(d)) { pick = d; break; }
    }
    setCreateDate(pick);
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = () => {
    // min/max on the input guide the picker but do not stop a typed value.
    if (!createDate || createDate < first || createDate > maxDate) {
      setCreateError(
        maxDate === last
          ? `Pick a date in ${fmtMonth(month)}.`
          : `Pick a date in ${fmtMonth(month)}, no later than today.`
      );
      return;
    }
    setCreateOpen(false);
    onOpen(createDate, !registeredDates.has(createDate));
  };

  const createExists = registeredDates.has(createDate);

  return (
    <div className="card">
      <div className="att-bar">
        <div className="att-bar-group">
          <Select
            id="register-month"
            ariaLabel="Register month"
            value={month}
            onChange={onMonthChange}
            options={monthOptions}
            minWidth={176}
          />
          <span className="att-meta" aria-live="polite">
            {loading ? 'Loading…' : [
              `${registers.length} of ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} recorded`,
              totals.rate !== null ? `${totals.rate}% attendance` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">add</span>
          Create Attendance
        </button>
      </div>

      {loading ? (
        <TableSkeleton columns={6} rows={8} />
      ) : error ? (
        <EmptyState
          icon="cloud_off"
          title="Could not load the registers"
          desc={error}
          action={<button className="btn btn-outline" onClick={load}>Try again</button>}
        />
      ) : registers.length === 0 ? (
        <EmptyState
          icon="event_note"
          title={`No attendance taken in ${fmtMonth(month)}`}
          desc="Create a register for a date and mark the whole workforce on one sheet."
          action={
            <button className="btn btn-primary" onClick={openCreate}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">add</span>
              Create Attendance
            </button>
          }
          small
        />
      ) : (
        <div className="att-scroll">
          <table className="att-table">
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th className="is-num">On roll</th>
                <th className="is-num">Present</th>
                <th className="is-num">Absent</th>
                <th className="is-num">Unmarked</th>
                <th className="is-num">Attendance</th>
                <th className="is-center"><span className="hr-sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {registers.map(r => {
                const open = () => onOpen(r.date, false);
                return (
                  <tr
                    key={r.date}
                    className="att-row-click"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open(); } }}
                    aria-label={`Open the register for ${longDate(r.date)}`}
                  >
                    <td><DateCell iso={r.date} /></td>
                    {/* Plain figures: colour is kept for the marks themselves.
                        Zero is greyed so real counts stand out. */}
                    <td className="is-num">{r.on_roll}</td>
                    <td className="is-num">{r.present}</td>
                    <td className={`is-num${r.absent ? '' : ' att-muted-num'}`}>{r.absent}</td>
                    <td className={`is-num${r.unmarked ? '' : ' att-muted-num'}`}>{r.unmarked}</td>
                    <td className="is-num">{pct(r.present, r.on_roll) ?? 0}%</td>
                    <td className="is-center">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); open(); }}
                      >
                        View Register
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Attendance"
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitCreate}>
              {createExists ? 'Open Register' : 'Continue'}
            </button>
          </>
        }
      >
        <form onSubmit={e => { e.preventDefault(); submitCreate(); }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="create-date">
              Date<span className="hr-required" aria-hidden="true">*</span>
            </label>
            <input
              id="create-date"
              type="date"
              className="form-control"
              value={createDate}
              min={first}
              max={maxDate}
              autoFocus
              onChange={e => { setCreateDate(e.target.value); setCreateError(null); }}
              aria-invalid={!!createError}
              aria-describedby="create-date-help"
            />
            <div id="create-date-help" className="hr-help" style={{ marginTop: 8 }}>
              {createError
                ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{createError}</span>
                : createExists
                  ? `${longDate(createDate)} already has a register — it will open for review and correction.`
                  : createDate
                    ? `${longDate(createDate)} · limited to ${fmtMonth(month)}.`
                    : `Limited to ${fmtMonth(month)}.`}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Daily Register — marking sheet for one date
// ═══════════════════════════════════════════════════════════════════════════
function RegisterSheet({ date, isNew, areas, areasByCity, onClose, onDirtyChange }) {
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marks, setMarks] = useState({});  // employee_id -> { status, area_ids }
  const baselineRef = useRef({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [areaFor, setAreaFor] = useState(null);
  const [areaDraft, setAreaDraft] = useState([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const markRefs = useRef([]);  // first mark button of each visible row, in order

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/hr/attendance/day-sheet', { params: { date } })
      .then(r => {
        setSheet(r.data);
        const initial = {};
        for (const employee of r.data.employees) {
          initial[employee.id] = {
            status: employee.attendance_status || null,
            area_ids: parseAreaIds(employee.area_id_list),
          };
        }
        setMarks(initial);
        baselineRef.current = JSON.parse(JSON.stringify(initial));
      })
      .catch(err => setError(apiError(err, 'Could not open the register for this date.')))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const areaNameById = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);

  const changedRows = useMemo(() => {
    const changed = [];
    for (const [employeeId, current] of Object.entries(marks)) {
      const base = baselineRef.current[employeeId] || { status: null, area_ids: [] };
      const sameStatus = base.status === current.status;
      const sameAreas =
        base.area_ids.length === current.area_ids.length &&
        base.area_ids.every(a => current.area_ids.includes(a));
      if (!sameStatus || !sameAreas) {
        changed.push({ employee_id: Number(employeeId), status: current.status, area_ids: current.area_ids });
      }
    }
    return changed;
  }, [marks]);
  const changedIds = useMemo(() => new Set(changedRows.map(r => r.employee_id)), [changedRows]);

  useEffect(() => { onDirtyChange(changedRows.length); }, [changedRows.length, onDirtyChange]);

  // A tab close or reload would silently drop an unsaved register.
  useEffect(() => {
    if (!changedRows.length) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changedRows.length]);

  const counts = useMemo(() => {
    const values = Object.values(marks);
    const present = values.filter(m => m.status === 'P').length;
    const absent  = values.filter(m => m.status === 'A').length;
    return { present, absent, unmarked: values.length - present - absent, total: values.length };
  }, [marks]);

  // One flat list in the server's order (department, then name). Department
  // is a column rather than a header row: with small teams a header per
  // department doubled the table's height, and it broke the top-to-bottom
  // run that keyboard marking relies on.
  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!sheet) return [];
    if (!q) return sheet.employees;
    return sheet.employees.filter(employee => (
      employee.name.toLowerCase().includes(q) ||
      (employee.employee_code || '').toLowerCase().includes(q) ||
      (employee.department_name || '').toLowerCase().includes(q) ||
      (employee.designation_name || '').toLowerCase().includes(q)
    ));
  }, [sheet, q]);

  // ── Marking ──────────────────────────────────────────────────────────────
  // `toggle`: clicking the active mark again clears the row, so a mistaken
  // mark is undone without a third button.
  const setMark = (employeeId, status, toggle = true) => {
    setMarks(prev => {
      const current = prev[employeeId] || { status: null, area_ids: [] };
      const next = toggle && current.status === status ? null : status;
      return {
        ...prev,
        [employeeId]: { status: next, area_ids: next === 'P' ? current.area_ids : [] },
      };
    });
  };

  const markVisible = (status) => {
    const ids = new Set(visible.map(e => String(e.id)));
    setMarks(prev => {
      const next = { ...prev };
      for (const id of ids) {
        const current = prev[id] || { status: null, area_ids: [] };
        next[id] = { status, area_ids: status === 'P' ? current.area_ids : [] };
      }
      return next;
    });
  };

  // Keyboard path: P / A marks the focused row and moves straight to the
  // next one, so a whole register can be taken without the mouse.
  const onRowKeyDown = (e, employee, index) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'p' && key !== 'a') return;
    e.preventDefault();
    setMark(employee.id, key.toUpperCase(), false);
    markRefs.current[index + 1]?.focus();
  };

  const openAreas = (employee) => {
    setAreaFor(employee);
    setAreaDraft(marks[employee.id]?.area_ids || []);
  };

  const applyAreas = () => {
    setMarks(prev => ({ ...prev, [areaFor.id]: { ...prev[areaFor.id], area_ids: areaDraft } }));
    setAreaFor(null);
  };

  // ── Save / leave ─────────────────────────────────────────────────────────
  const save = async () => {
    if (!changedRows.length) return;
    setSaving(true);
    try {
      const { data } = await api.post('/hr/attendance/bulk', { date, records: changedRows });
      toast.success(`Attendance saved for ${shortDate(date)} — ${data.present} present, ${data.absent} absent`);
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not save the register.'));
      setSaving(false);
    }
  };

  const leave = () => {
    if (changedRows.length) setConfirmLeave(true);
    else onClose();
  };

  const nothingMarked = counts.present + counts.absent === 0;
  const dirty = changedRows.length;

  // Save status, stated in words beside the button so a disabled Save is
  // never mistaken for a broken one.
  const saveStatus = dirty
    ? { icon: 'edit', tone: 'is-dirty', text: `${dirty} unsaved change${dirty === 1 ? '' : 's'}` }
    : isNew && nothingMarked
      ? { icon: 'radio_button_unchecked', tone: '', text: 'Nothing marked yet' }
      : { icon: 'cloud_done', tone: 'is-saved', text: 'All changes saved' };

  const share = (n) => (counts.total ? `${(n / counts.total) * 100}%` : '0%');

  markRefs.current = [];

  return (
    <div className="card">
      <div className="att-bar">
        <div className="att-bar-group is-tight">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={leave}
            aria-label="Back to the month’s registers"
            title="Back to registers"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">arrow_back</span>
          </button>
          <div>
            <div className="att-title">
              {longDate(date)}
            </div>
            <div className="att-meta">
              {isNew ? 'New register' : 'Saved register'}
              {!loading && !error && ` · ${counts.total} on roll`}
            </div>
          </div>
        </div>
        <div className="att-bar-group">
          {!loading && !error && (
            <span className={`att-save-status ${saveStatus.tone}`} aria-live="polite">
              <span className="material-symbols-outlined" aria-hidden="true">{saveStatus.icon}</span>
              {saveStatus.text}
            </span>
          )}
          <BusyButton
            className="btn btn-primary att-save"
            busy={saving}
            busyLabel="Saving…"
            icon="check"
            onClick={save}
            disabled={!dirty}
          >
            {isNew ? 'Save Attendance' : 'Save Changes'}
          </BusyButton>
        </div>
      </div>

      {!loading && !error && counts.total > 0 && (
        <div className="att-strip is-sheet">
          {/* Progress of the register itself: one stacked bar, three counts.
              Fixed widths throughout, so marking never moves anything. */}
          <div className="att-progress">
            <div
              className="att-progress-track"
              role="img"
              aria-label={`${counts.present} present, ${counts.absent} absent, ${counts.unmarked} unmarked of ${counts.total}`}
            >
              <span className="att-progress-seg is-present" style={{ width: share(counts.present) }} />
              <span className="att-progress-seg is-absent" style={{ width: share(counts.absent) }} />
            </div>
            <span className="att-legend"><span className="att-dot is-present" />Present <b>{counts.present}</b></span>
            <span className="att-legend"><span className="att-dot is-absent" />Absent <b>{counts.absent}</b></span>
            <span className="att-legend">
              <span className="att-dot" />Unmarked <b>{counts.unmarked}</b>
            </span>
          </div>

          <div className="att-strip-actions">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">search</span>
              <label htmlFor="sheet-search" className="hr-sr-only">Search the register</label>
              <input
                id="sheet-search"
                placeholder="Search employees…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="att-bulk" role="group" aria-label={q ? 'Mark every employee shown' : 'Mark every employee'}>
              <span className="att-bulk-label">{q ? 'Mark shown' : 'Mark all'}</span>
              <button type="button" className="is-present" onClick={() => markVisible('P')} disabled={!visible.length}>
                Present
              </button>
              <button type="button" className="is-absent" onClick={() => markVisible('A')} disabled={!visible.length}>
                Absent
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton columns={5} rows={8} />
      ) : error ? (
        <EmptyState
          icon="cloud_off"
          title="Could not open the register"
          desc={error}
          action={<button className="btn btn-outline" onClick={load}>Try again</button>}
        />
      ) : counts.total === 0 ? (
        <EmptyState
          icon="groups"
          title="Nobody was on the payroll on this date"
          desc="Employees appear on a register from their date of joining onwards. Add employees under Workforce, or pick a later date."
          action={<Link className="btn btn-primary" to="/hr/employees">Go to Workforce</Link>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search_off"
          title={`Nobody matches "${search.trim()}"`}
          desc="Try a different spelling, or clear the search to see the whole register."
          action={<button className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>}
          small
        />
      ) : (
        <>
          <div className="att-scroll">
            <table className="att-table">
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: 128 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th className="is-center">Attendance</th>
                  <th>Areas covered</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((employee, index) => {
                  const mark = marks[employee.id] || { status: null, area_ids: [] };
                  const isField = !!employee.is_field_employee;
                  const areaNames = mark.area_ids.map(id => areaNameById.get(id)).filter(Boolean).join(', ');
                  return (
                    <tr
                      key={employee.id}
                      className={changedIds.has(employee.id) ? 'is-changed' : undefined}
                      onKeyDown={e => onRowKeyDown(e, employee, index)}
                    >
                      <td>
                        <div className="att-identity">
                          <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(employee.name)}</span>
                          <span className="att-identity-text">
                            <span className="hr-cell-strong">{employee.name}</span>
                            <span className="hr-cell-sub">{employee.employee_code}</span>
                          </span>
                        </div>
                      </td>
                      <td className="hr-cell-muted" title={employee.department_name}>
                        {employee.department_name || <Dash />}
                      </td>
                      <td className="hr-cell-muted" title={employee.designation_name}>
                        {employee.designation_name || <Dash />}
                      </td>
                      <td className="is-center">
                        <span className="att-mark" role="group" aria-label={`Attendance for ${employee.name}`}>
                          <button
                            ref={el => { markRefs.current[index] = el; }}
                            type="button"
                            className={`is-present${mark.status === 'P' ? ' is-on' : ''}`}
                            aria-pressed={mark.status === 'P'}
                            title="Present (P)"
                            onClick={() => setMark(employee.id, 'P')}
                          >P</button>
                          <button
                            type="button"
                            className={`is-absent${mark.status === 'A' ? ' is-on' : ''}`}
                            aria-pressed={mark.status === 'A'}
                            title="Absent (A)"
                            onClick={() => setMark(employee.id, 'A')}
                          >A</button>
                        </span>
                      </td>
                      <td>
                        {isField && mark.status === 'P' ? (
                          <button
                            type="button"
                            className={`att-area-btn${mark.area_ids.length ? ' has-value' : ''}`}
                            onClick={() => openAreas(employee)}
                            title={areaNames || 'Tag the areas covered today'}
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">
                              {mark.area_ids.length ? 'edit_location_alt' : 'add_location_alt'}
                            </span>
                            {mark.area_ids.length
                              ? <span className="att-areas">{areaNames || `${mark.area_ids.length} areas`}</span>
                              : 'Add areas'}
                          </button>
                        ) : (
                          <Dash title={isField ? 'Areas are tagged on present days' : 'Office based'} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        isOpen={!!areaFor}
        onClose={() => setAreaFor(null)}
        title={areaFor ? `Areas covered — ${areaFor.name}` : 'Areas covered'}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setAreaFor(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyAreas}>
              Apply{areaDraft.length > 0 && ` (${areaDraft.length})`}
            </button>
          </>
        }
      >
        {areas.length === 0 ? (
          <div className="hr-locked">
            <span className="material-symbols-outlined" aria-hidden="true">map</span>
            No areas have been set up yet. Add them under Cities &amp; Territories.
          </div>
        ) : (
          <AreaPicker
            idPrefix="sheet-area"
            areasByCity={areasByCity}
            selected={areaDraft}
            onChange={setAreaDraft}
            employeeId={areaFor?.id}
            autoFocus
          />
        )}
      </Modal>

      <DiscardModal
        isOpen={confirmLeave}
        count={changedRows.length}
        onStay={() => setConfirmLeave(false)}
        onDiscard={() => { setConfirmLeave(false); onClose(); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// By Employee — roster with counts, drilling into one person's history
// ═══════════════════════════════════════════════════════════════════════════
function ByEmployee({ areasByCity, onOpenRegister }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [drilldown, setDrilldown] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  // The history has its own period, seeded from the roster's when opened, so
  // "September" on the roster opens September's history — not everything.
  const [historyMonth, setHistoryMonth] = useState('all');

  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({ status: 'P', area_ids: [] });
  const [editErrors, setEditErrors] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const rosterSort = useSort('name');

  const loadRoster = useCallback(() => {
    setLoading(true);
    const params = { status: 'Active' };
    if (monthFilter !== 'all') params.month = monthFilter;
    api.get('/hr/attendance/summary', { params })
      .then(r => setRoster(r.data))
      .catch(err => toast.error(apiError(err, 'Could not load the attendance roster.')))
      .finally(() => setLoading(false));
  }, [monthFilter]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const openDrilldown = useCallback((employeeId, period) => {
    if (period !== undefined) setHistoryMonth(period);
    setDrilldownLoading(true);
    setDrilldown({ loading: true });
    api.get(`/hr/attendance/by-employee/${employeeId}`)
      .then(r => setDrilldown(r.data))
      .catch(err => {
        toast.error(apiError(err, 'Could not load this history.'));
        setDrilldown(null);
      })
      .finally(() => setDrilldownLoading(false));
  }, []);

  const refreshAfterWrite = (employeeId) => {
    loadRoster();
    if (drilldown?.employee?.id === Number(employeeId)) openDrilldown(employeeId);
  };

  const openEdit = (record) => {
    setEditingRecord(record);
    setEditForm({ status: record.status, area_ids: parseAreaIds(record.area_id_list) });
    setEditErrors({});
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    setEditErrors({});
    try {
      await api.put(`/hr/attendance/${editingRecord.id}`, {
        status: editForm.status,
        area_ids: editingRecord.is_field_employee && editForm.status === 'P' ? editForm.area_ids : [],
      });
      toast.success(`${editingRecord.employee_name} on ${shortDate(editingRecord.date)} updated`);
      const employeeId = editingRecord.employee_id;
      setEditingRecord(null);
      refreshAfterWrite(employeeId);
    } catch (err) {
      const mapped = apiFieldError(err);
      if (mapped) setEditErrors(mapped);
      else toast.error(apiError(err, 'Could not update this record.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      await api.delete(`/hr/attendance/${deletingRecord.id}`);
      toast.success(`Attendance on ${shortDate(deletingRecord.date)} removed`);
      const employeeId = deletingRecord.employee_id;
      setDeletingRecord(null);
      refreshAfterWrite(employeeId);
    } catch (err) {
      toast.error(apiError(err, 'Could not delete this record.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? roster.filter(r => (
        r.name.toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q) ||
        (r.department_name || '').toLowerCase().includes(q)
      ))
      : roster;
    return sortRows(rows, rosterSort.sortConfig, ROSTER_COMPARATORS);
  }, [roster, search, rosterSort.sortConfig]);

  const rosterPages = usePagination(filteredRoster, 25);

  const monthOptions = useMemo(() => ([
    { value: 'all', label: 'All periods' },
    ...recentMonths(12).map(m => ({ value: m, label: fmtMonth(m) })),
  ]), []);

  const periodLabel = monthFilter === 'all' ? 'All periods' : fmtMonth(monthFilter);

  const history = useMemo(() => {
    const all = drilldown?.records || [];
    const records = historyMonth === 'all' ? all : all.filter(r => r.date.startsWith(historyMonth));
    const present = records.filter(r => r.status === 'P').length;
    return { records, present, absent: records.length - present, total: records.length };
  }, [drilldown, historyMonth]);

  const areaCell = (record) => (
    record.area_names
      ? <span className="att-areas" title={record.area_names}>{record.area_names}</span>
      : <Dash title={record.is_field_employee ? 'No areas tagged' : 'Office based'} />
  );

  return (
    <div className="card">
      <div className="att-bar">
        {drilldown ? (
          <div className="att-bar-group is-tight">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setDrilldown(null)}
              aria-label="Back to the employee list"
              title="Back to employees"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">arrow_back</span>
            </button>
            <div>
              <div className="att-title">{drilldown.employee?.name || 'Loading…'}</div>
              <div className="att-meta">
                {drilldown.employee
                  ? [drilldown.employee.employee_code, drilldown.employee.designation_name, drilldown.employee.department_name]
                    .filter(Boolean).join(' · ')
                  : '\u00a0'}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="att-title">By Employee</div>
            <div className="att-meta">
              {loading ? 'Loading…' : `${roster.length} active employee${roster.length === 1 ? '' : 's'} · ${periodLabel}`}
            </div>
          </div>
        )}
        <div className="att-bar-group">
          {drilldown ? (
            <Select
              id="history-month"
              ariaLabel="History period"
              value={historyMonth}
              onChange={setHistoryMonth}
              options={monthOptions}
              minWidth={176}
            />
          ) : (
            <>
              <Select
                id="roster-month"
                ariaLabel="Filter by period"
                value={monthFilter}
                onChange={setMonthFilter}
                options={monthOptions}
                minWidth={176}
              />
              <div className="search-bar">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">search</span>
                <label htmlFor="roster-search" className="hr-sr-only">Search employees</label>
                <input
                  id="roster-search"
                  placeholder="Search employees…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* One employee's history, opened in place rather than in a modal:
          it is another view of the same roster, not a task on top of it. */}
      {drilldown ? (
        drilldownLoading || drilldown.loading ? (
          <TableSkeleton columns={3} rows={6} />
        ) : (
          <>
            {/* A plain line of figures, the classic ledger summary. */}
            <div className="att-strip">
              <div className="att-kpi">
                <span className="att-kpi-value">{history.present}</span>
                <span className="att-kpi-label">Present</span>
              </div>
              <div className="att-kpi">
                <span className="att-kpi-value">{history.absent}</span>
                <span className="att-kpi-label">Absent</span>
              </div>
              <div className="att-kpi">
                <span className="att-kpi-value">{history.total ? `${pct(history.present, history.total)}%` : '—'}</span>
                <span className="att-kpi-label">Attendance</span>
              </div>
              <div className="att-kpi">
                <span className="att-kpi-value">{history.total}</span>
                <span className="att-kpi-label">
                  Day{history.total === 1 ? '' : 's'} recorded
                  {historyMonth === 'all' ? '' : ` in ${fmtMonth(historyMonth)}`}
                </span>
              </div>
            </div>

            {history.records.length ? (
              <div className="att-scroll">
                <table className="att-table">
                  <colgroup>
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '16%' }} />
                    <col />
                    <col style={{ width: 72 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Areas covered</th>
                      <th><span className="hr-sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.records.map(record => (
                      <tr key={record.id}>
                        <td><DateCell iso={record.date} /></td>
                        <td>
                          <span className={`att-state ${record.status === 'P' ? 'is-present' : 'is-absent'}`}>
                            <span className="att-state-dot" aria-hidden="true" />
                            {record.status === 'P' ? 'Present' : 'Absent'}
                          </span>
                        </td>
                        <td>{areaCell(record)}</td>
                        <td className="is-center att-kebab-cell">
                          <KebabMenu
                            label={`Actions for ${shortDate(record.date)}`}
                            items={[
                              { label: 'Correct this mark', icon: 'edit', onClick: () => openEdit(record) },
                              { label: 'Open day register', icon: 'event_note', onClick: () => onOpenRegister(record.date) },
                              { label: 'Delete this mark', icon: 'delete', danger: true, onClick: () => setDeletingRecord(record) },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="event_busy"
                title={historyMonth === 'all' ? 'Nothing recorded yet' : `Nothing recorded in ${fmtMonth(historyMonth)}`}
                desc={historyMonth === 'all'
                  ? 'This employee has no attendance marks on file.'
                  : 'Pick another period, or All periods, to see earlier marks.'}
                action={historyMonth === 'all'
                  ? undefined
                  : <button className="btn btn-outline" onClick={() => setHistoryMonth('all')}>Show all periods</button>}
                small
              />
            )}
          </>
        )
      ) : loading ? (
        <TableSkeleton columns={6} rows={8} />
      ) : filteredRoster.length === 0 ? (
        <EmptyState
          icon="groups"
          title={search.trim() ? `Nobody matches "${search.trim()}"` : 'No active employees'}
          desc={search.trim() ? 'Try a different spelling.' : 'Employees appear here once they are added to the workforce.'}
          action={
            search.trim()
              ? <button className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>
              : <Link className="btn btn-primary" to="/hr/employees">Go to Workforce</Link>
          }
          small
        />
      ) : (
        <>
          <div className="att-scroll">
            <table className="att-table">
              <colgroup>
                <col style={{ width: '30%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '13%' }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <SortableHeader column="name" label="Employee" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                  <SortableHeader column="department_name" label="Department" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                  <SortableHeader column="present_days" label="Present" align="right" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                  <SortableHeader column="absent_days" label="Absent" align="right" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                  <SortableHeader column="recorded_days" label="Days recorded" align="right" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                  <SortableHeader column="last_recorded_date" label="Last marked" sortConfig={rosterSort.sortConfig} onSort={rosterSort.handleSort} />
                </tr>
              </thead>
              <tbody>
                {rosterPages.pageItems.map(person => (
                  <tr
                    key={person.id}
                    className="att-row-click"
                    tabIndex={0}
                    onClick={() => openDrilldown(person.id, monthFilter)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openDrilldown(person.id, monthFilter); } }}
                    title={`Open ${person.name}'s attendance history`}
                  >
                    <td>
                      <div className="att-identity">
                        <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(person.name)}</span>
                        <span className="att-identity-text">
                          <span className="hr-cell-strong">{person.name}</span>
                          <span className="hr-cell-sub">{person.employee_code}</span>
                        </span>
                      </div>
                    </td>
                    <td className="hr-cell-muted">{person.department_name || <Dash />}</td>
                    <td className="is-num">{num(person.present_days)}</td>
                    <td className="is-num">{num(person.absent_days)}</td>
                    <td className="is-num">{num(person.recorded_days)}</td>
                    <td>
                      {person.last_recorded_date
                        ? (relativeDay(person.last_recorded_date) || shortDate(person.last_recorded_date))
                        : <Dash title="Never marked" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={rosterPages.page} totalPages={rosterPages.totalPages}
            totalItems={filteredRoster.length} pageSize={rosterPages.pageSize}
            onPageChange={rosterPages.setPage} onPageSizeChange={rosterPages.setPageSize}
          />
        </>
      )}

      {/* ── Correct one record ─────────────────────────────────────────── */}
      <Modal
        isOpen={!!editingRecord}
        onClose={() => setEditingRecord(null)}
        title="Correct Attendance"
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setEditingRecord(null)} disabled={savingEdit}>Cancel</button>
            <BusyButton busy={savingEdit} busyLabel="Saving…" onClick={saveEdit}>Save changes</BusyButton>
          </>
        }
      >
        {editingRecord && (
          <>
            <div className="hr-locked" style={{ marginBottom: 16 }}>
              <span className="material-symbols-outlined" aria-hidden="true">lock</span>
              <span>
                <strong>{editingRecord.employee_name}</strong> · {longDate(editingRecord.date)}
                <span className="hr-help" style={{ display: 'block', marginTop: 4 }}>
                  To move a record to another employee or date, delete it and
                  re-enter it on the correct day's register.
                </span>
              </span>
            </div>

            <div className="form-group" style={{ marginBottom: editingRecord.is_field_employee ? 16 : 0 }}>
              <span className="form-label">Attendance<span className="hr-required" aria-hidden="true">*</span></span>
              <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Present or absent">
                {[
                  { val: 'P', label: 'Present', icon: 'check_circle', on: 'var(--green)', bg: '#f0fdf4', fg: '#047857' },
                  { val: 'A', label: 'Absent',  icon: 'cancel',       on: 'var(--red)',   bg: 'var(--red-pale)', fg: '#991b1b' },
                ].map(opt => {
                  const active = editForm.status === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setEditForm(p => ({ ...p, status: opt.val, area_ids: opt.val === 'A' ? [] : p.area_ids }))}
                      style={{
                        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        height: 40, borderRadius: 8,
                        border: `1.5px solid ${active ? opt.on : 'var(--gray-200)'}`,
                        background: active ? opt.bg : 'white',
                        color: active ? opt.fg : 'var(--gray-500)',
                        fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">{opt.icon}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {!!editingRecord.is_field_employee && editForm.status === 'P' && (
              <FormField label="Areas covered" htmlFor="edit-areas" col={12} error={editErrors.area_ids}>
                <div id="edit-areas">
                  <AreaPicker
                    idPrefix="edit-area"
                    areasByCity={areasByCity}
                    selected={editForm.area_ids}
                    onChange={ids => setEditForm(p => ({ ...p, area_ids: ids }))}
                    employeeId={editingRecord.employee_id}
                  />
                </div>
              </FormField>
            )}
          </>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!deletingRecord}
        onClose={() => setDeletingRecord(null)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        title="Delete attendance record"
        message={
          deletingRecord
            ? `Remove ${deletingRecord.employee_name}'s ${deletingRecord.status === 'P' ? 'Present' : 'Absent'} mark for ${longDate(deletingRecord.date)}? Nothing else depends on attendance, so no other record changes.`
            : ''
        }
      />
    </div>
  );
}

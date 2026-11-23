import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import DateInput from '../../components/common/DateInput';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import {
  HrStyles, SortableHeader, useSort, sortRows, Select, SearchSelect,
  TableSkeleton, EmptyState, BusyButton, FormField, FieldGrid, Field, Notice,
  FieldGridSkeleton, num, money, fmtMoney, fmtAmount, fmtDate, fmtMonth, initials,
  blockWheelChange, apiError, apiFieldError,
} from './HrKit';

// ─── Advance Salary ────────────────────────────────────────────────────────
// Record and review advance salary for every employee in one place, without
// the HR profile. Built for the operator who hands advances out (usually
// whoever marks attendance): they get this screen through perm_hr_advances
// and never see what anyone is paid. HR (perm_hr_employees) uses it too.
//
// The server decides what each user sees (routes/advanceSalary.js):
//   - salary figures, and the "above net salary" warning, only for HR and
//     Payroll; an operator is refused above the net salary instead, with a
//     message that names no figure;
//   - an operator may remove only the advances they recorded; HR any.
// The rules themselves are the HR profile's (server utils/salaryAdvances.js):
// an advance lands in the open pay period, that payslip deducts all of it,
// and it can be removed only until that month's Pay Run closes.
//
// Two views of one pay period: By employee (who has taken how much, and the
// place to record a new one) and All entries (every advance as a line, for
// reconciling the cash handed out).

const AMOUNT_MAX = 9999999999.99;
const NOTE_MAX = 200;

const ADV_STYLES = `
  /* The header is pinned under the app's top bar so the month, search and
     Record Advance stay in reach while the list scrolls; the column headings
     pin directly under it (--sal-head-h is its live height). Without this a
     small scroll slid the whole header under the top bar. */
  .sal-header {
    flex-wrap: wrap;
    position: sticky; top: var(--header-h); z-index: 4;
    background: white;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .sal-card .hr-table.hr-page-table thead th { top: calc(var(--header-h) + var(--sal-head-h, 0px)); }
  @media (max-width: 1100px) {
    /* The table scrolls sideways here, so its own box is the sticky container. */
    .sal-card .hr-table.hr-page-table thead th { top: 0; }
  }
  .sal-controls { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-left: auto; }
  .sal-controls .search-bar { width: 210px; }
  .sal-controls .search-bar input { width: 100%; }
  .sal-controls .hr-segment-btn:focus { outline: none; }
  .sal-controls .hr-segment-btn:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  /* The tab counts were 55% opacity grey (about 2:1); WCAG AA wants 4.5:1. */
  .sal-controls .hr-segment-count { opacity: 1; color: var(--gray-500); }
  .sal-controls .hr-segment-btn.is-active .hr-segment-count { color: var(--gray-600); }
  /* Unselected tab text and the month menu's Closed tag were #64748b on
     #f1f5f9 (4.34:1); one step darker passes AA. */
  .sal-controls .hr-segment-btn:not(.is-active) { color: var(--gray-600); }
  .sal-controls .hr-tag-closed { color: var(--gray-600); }
  .sal-notices { display: grid; gap: 10px; padding: 16px 22px; border-bottom: 1px solid var(--gray-100); }
  .sal-notice-action { margin-top: 8px; }


  .sal-name { font-weight: 600; color: var(--gray-800); white-space: nowrap; }
  .sal-desig { white-space: nowrap; }
  .sal-code { margin-left: 8px; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sal-dept { color: var(--gray-500); }
  .sal-warn { margin-right: 6px; font-size: 16px; color: #b91c1c; vertical-align: -3px; cursor: help; }
  .sal-rec {
    display: inline-flex; align-items: center; gap: 4px;
    height: 30px; padding: 0 10px;
    border: 1px solid transparent; border-radius: 6px; background: none;
    color: var(--blue); font-family: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer; white-space: nowrap;
  }
  .sal-rec:hover { background: var(--blue-ultra); border-color: var(--blue-pale); }
  .sal-rec:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  .sal-rec .material-symbols-outlined { font-size: 17px; }

  .sal-table td { vertical-align: middle; }
  /* The table ends the card: round the last row's outer cells so its hover
     background (and an expanded line's grey) stays inside the card's curve
     instead of squaring off its bottom corners. */
  .sal-table tbody tr:last-child > td:first-child { border-bottom-left-radius: calc(var(--radius-lg) - 1px); }
  .sal-table tbody tr:last-child > td:last-child { border-bottom-right-radius: calc(var(--radius-lg) - 1px); }
  .sal-table tbody tr:last-child > td { border-bottom: none; }
  .sal-table tbody td { padding-top: 10px; padding-bottom: 10px; }
  .sal-total { font-weight: 700; color: var(--gray-900); }
  .sal-zero { color: var(--gray-500); }
  .sal-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .sal-chevron {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; padding: 0;
    border: none; border-radius: 6px; background: none;
    color: var(--gray-500); cursor: pointer;
  }
  .sal-chevron:hover { background: var(--gray-100); color: var(--gray-800); }
  .sal-chevron:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 1px; }
  .sal-chevron .material-symbols-outlined { font-size: 20px; transition: transform 0.15s ease; }
  .sal-chevron[aria-expanded="true"] .material-symbols-outlined { transform: rotate(90deg); }
  .sal-chevron-spacer { display: inline-block; width: 28px; }
  .sal-blocked {
    display: inline-flex; align-items: center; gap: 4px; padding-right: 10px;
    font-size: 12px; color: var(--gray-500); white-space: nowrap;
  }
  .sal-blocked .material-symbols-outlined { font-size: 15px; }

  /* An employee's advances: plain lines under their row, each amount under
     the row's total. */
  .sal-line > td { padding-top: 7px !important; padding-bottom: 7px !important; background: var(--gray-50); font-size: 12.5px; color: var(--gray-600); }
  .sal-line-main { padding-left: 56px !important; white-space: nowrap; }
  .sal-line-date { display: inline-block; min-width: 86px; font-weight: 600; color: var(--gray-700); font-variant-numeric: tabular-nums; }
  .sal-line-note { margin-right: 14px; }
  .sal-line-by { margin-right: 14px; color: var(--gray-500); }
  .sal-line .hr-num { font-weight: 600; color: var(--gray-700); }
  .sal-row-expanded > td { background: var(--gray-50); }

  .sal-status { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12.5px; color: var(--gray-600); white-space: nowrap; }
  .sal-status-dot { align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--gray-400); flex-shrink: 0; }
  .sal-status.is-pending .sal-status-dot { background: #f59e0b; }
  .sal-status.is-slip .sal-status-dot { background: #3b82f6; }

  /* Record links only on the row being pointed at; the bar's Record advance
     button is always there. Touch screens have no hover, so they keep them. */
  @media (hover: hover) {
    .sal-table tbody .sal-rec { opacity: 0; }
    .sal-table tbody tr:hover .sal-rec,
    .sal-table tbody tr:focus-within .sal-rec { opacity: 1; }
  }


  @keyframes salFlash { 0% { background: rgba(5, 150, 105, 0.16); } 100% { background: transparent; } }
  .sal-flash > td { animation: salFlash 2.4s ease-out 1; }

  .sal-option { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; }
  .sal-option.is-blocked { opacity: 0.55; }
  .sal-option-text { display: flex; flex-direction: column; min-width: 0; }
  .sal-option-name { font-weight: 600; color: var(--gray-800); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sal-option-sub { font-size: 12px; color: var(--gray-500); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sal-option-amt { margin-left: auto; padding-left: 8px; font-size: 12px; font-weight: 600; color: var(--gray-600); white-space: nowrap; font-variant-numeric: tabular-nums; }

  .sal-kv-sub { display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--gray-500); }
  .sal-note-count { margin-left: auto; font-size: 11.5px; color: var(--gray-500); font-variant-numeric: tabular-nums; }
  .sal-note-count.is-near { color: var(--amber, #b45309); }
  .sal-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--gray-700); cursor: pointer; }
  .sal-check input { margin-top: 2px; }
  .sal-info-list { margin: 0; padding-left: 18px; }
  .sal-info-list li + li { margin-top: 6px; }

  @media (max-width: 1100px) {
    .sal-line-by { display: none; }
  }
  @media (max-width: 1200px) {
    .sal-dept { display: none; }
  }

  @media (max-width: 640px) {
    .sal-controls, .sal-controls .search-bar { width: 100%; }
  }
  /* WCAG 2.3.3: no flash or rotation for people who ask for less motion. */
  @media (prefers-reduced-motion: reduce) {
    .sal-flash > td { animation: none; }
    .sal-chevron .material-symbols-outlined { transition: none; }
  }
`;

// ── Small pieces ───────────────────────────────────────────────────────────

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const entries = (n) => plural(n, 'entry', 'entries');

function AdvanceStatus({ entry }) {
  const [tone, label, title] = entry.locked
    ? ['done', 'Deducted', 'Deducted on a closed Pay Run']
    : entry.slip_id
      ? ['slip', 'On payslip', 'Included in a processed payslip. The Pay Run is still open.']
      : ['pending', 'To be deducted', 'Deducted when this month’s payslip is processed'];
  return (
    <span className={`sal-status is-${tone}`} title={title}>
      <span className="sal-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function RemoveButton({ entry, onRemove, viewOnly }) {
  if (entry.locked || viewOnly) return null;
  const blocked = entry.remove_blocked;
  return (
    <button
      type="button"
      className="pr-icon-btn"
      title={blocked || 'Remove advance salary'}
      aria-label={blocked
        ? `Cannot remove the advance of ${fmtAmount(entry.amount)} given to ${entry.employee_name}: ${blocked}`
        : `Remove the advance of ${fmtAmount(entry.amount)} given to ${entry.employee_name} on ${fmtDate(entry.date_given)}`}
      disabled={!!blocked}
      onClick={() => onRemove(entry)}
    >
      <span className="material-symbols-outlined" aria-hidden="true">delete</span>
    </button>
  );
}

// Never mutate what was typed: the raw string is kept and judged here.
function amountError(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return 'Enter the amount';
  if (!/^\d+(\.\d+)?$/.test(text)) return 'Enter a valid amount';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return 'Use at most 2 decimal places';
  if (num(text) <= 0) return 'Enter an amount greater than zero';
  if (num(text) > AMOUNT_MAX) return 'The amount is too large';
  return null;
}

// Only this month's advances are recorded; earlier months are view only.
const monthStart = () => `${todayPKT().slice(0, 7)}-01`;

function dateError(value, joinedOn, name) {
  if (!value) return 'Select the date the advance was given';
  if (value > todayPKT()) return 'The date cannot be in the future';
  if (value < monthStart()) return 'The date must be in this month';
  if (joinedOn && value < joinedOn) return `The date cannot be before ${name} joined (${fmtDate(joinedOn)})`;
  return null;
}

// Short reason beside a row that cannot take an advance; the full sentence
// is its tooltip.
const BLOCKED_LABELS = { inactive: 'Inactive', not_joined: 'Not joined yet', no_salary: 'No salary set' };

const matches = (query, ...fields) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
};


// ── Record advance dialog ─────────────────────────────────────────────────
// Module scope, like every HR form component: declared inside the page it
// would remount on each render and drop input focus.
const EMPTY_FORM = { amount: '', date_given: '', note: '' };

function RecordAdvanceModal({ open, initialEmployeeId, employees, onClose, onSaved, onStale }) {
  const [employeeId, setEmployeeId] = useState('');
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [duplicateOk, setDuplicateOk] = useState(false);
  // A refusal too long for the slot under a field (the salary-limit ones),
  // shown as a notice instead; the field keeps a short pointer to it.
  const [refusal, setRefusal] = useState(null);
  // The server's verdict on the typed amount against the employee's limit.
  // The limit itself is never sent (it is the salary).
  const [limitError, setLimitError] = useState(null);
  const ticket = useRef(0);

  // `quiet` keeps the current context on screen while it refreshes (after a
  // refused save), instead of flashing the skeleton.
  const loadContext = useCallback((id, { quiet = false } = {}) => {
    const mine = ++ticket.current;
    if (!quiet) { setContext(null); setContextError(null); }
    if (!id) return;
    api.get(`/hr/advances/employees/${id}/context`)
      .then(r => { if (ticket.current === mine) { setContext(r.data); setContextError(null); } })
      .catch(err => {
        if (ticket.current === mine && !quiet) setContextError(apiError(err, 'Close this form and try again.'));
      });
  }, []);

  useEffect(() => {
    if (!open) { ticket.current += 1; return; }
    const id = initialEmployeeId ? String(initialEmployeeId) : '';
    setEmployeeId(id);
    setForm({ ...EMPTY_FORM, date_given: todayPKT() });
    setTouched({});
    setErrors({});
    setRefusal(null);
    setDuplicateOk(false);
    loadContext(id);
  }, [open, initialEmployeeId, loadContext]);

  const pickEmployee = (id) => {
    const next = id ? String(id) : '';
    setEmployeeId(next);
    setErrors({});
    setRefusal(null);
    setDuplicateOk(false);
    setTouched(p => ({ ...p, employee: true }));
    loadContext(next);
  };

  const setField = (key, value) => {
    setForm(p => ({ ...p, [key]: value }));
    // A server message belongs to the value it judged.
    setErrors(p => (p[key] ? { ...p, [key]: null } : p));
    if (key === 'amount') setRefusal(null);
    if (key === 'amount' || key === 'date_given') setDuplicateOk(false);
  };

  const person = context?.employee;
  const ready = !!context && !context.blocked;

  const validation = {
    employee: employeeId ? null : 'Select an employee',
    amount: amountError(form.amount),
    date_given: dateError(form.date_given, person?.date_of_joining, person?.name),
  };
  const errorFor = (key) => errors[key]
    || (key === 'amount' && limitError)
    || (touched[key] ? validation[key] : null);

  // Check the amount against the limit as it is typed, so "exceeds the
  // advance limit" shows before Save rather than after it.
  useEffect(() => {
    setLimitError(null);
    if (!ready || amountError(form.amount)) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get(`/hr/advances/employees/${employeeId}/check`, { params: { amount: num(form.amount) } })
        .then(r => { if (!cancelled) setLimitError(r.data.ok ? null : r.data.message); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, employeeId, form.amount, context]);

  // The commonest slip is entering the same advance twice.
  const duplicate = useMemo(() => {
    if (!ready || validation.amount || !form.date_given) return null;
    const amount = money(form.amount);
    return (context.advances || []).find(a => money(a.amount) === amount && a.date_given === form.date_given) || null;
  }, [ready, context, form.amount, form.date_given, validation.amount]);

  const cannotSave = !ready
    || Object.values(validation).some(Boolean)
    || !!limitError
    || (!!duplicate && !duplicateOk);

  const save = async () => {
    setTouched({ employee: true, amount: true, date_given: true });
    if (cannotSave || saving) return;
    setSaving(true);
    setErrors({});
    setRefusal(null);
    try {
      const { data } = await api.post('/hr/advances', {
        employee_id: Number(employeeId),
        amount: num(form.amount),
        date_given: form.date_given,
        note: form.note.trim() || null,
      });
      const who = data.employee?.name || person?.name || 'the employee';
      toast.success(data.slip_updated
        ? `Advance of ${fmtMoney(data.amount)} recorded for ${who}. The ${fmtMonth(data.month)} payslip was updated.`
        : `Advance of ${fmtMoney(data.amount)} recorded for ${who}. It will be deducted from the ${fmtMonth(data.month)} payslip.`);
      onSaved(data);
    } catch (err) {
      const body = err?.response?.data || {};
      const mapped = apiFieldError(err);
      if (mapped && body.field === 'amount' && body.message.length > 60) {
        setErrors({ amount: 'Too much for this month' });
        setRefusal(body.message);
      } else if (mapped) setErrors(mapped);
      else toast.error(apiError(err, 'The advance salary could not be recorded. Try again.'));
      // The pay period or the payslip may have moved under the form (a run
      // closed, a payslip saved): refresh what the form is judged against.
      if (body.code === 'PAYROLL_RUN_COMPLETED') onStale();
      loadContext(employeeId, { quiet: true });
    } finally {
      setSaving(false);
    }
  };

  const options = useMemo(() => employees.map(e => ({
    ...e,
    disabled: !!e.blocked,
  })), [employees]);

  const noteLeft = NOTE_MAX - form.note.length;

  return (
    <Modal
      isOpen={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Record advance salary"
      size="md"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <BusyButton busy={saving} busyLabel="Recording…" icon="check" onClick={save}
            disabled={!ready || !!limitError || (!!duplicate && !duplicateOk)}>
            Record advance
          </BusyButton>
        </>
      }
    >
      <form onSubmit={e => { e.preventDefault(); save(); }} noValidate>
        <p className="hr-modal-lead">
          Advance salary is deducted in full from the employee’s payslip for the pay period shown below.
        </p>

        <div className="hr-form-grid is-modal">
          <FormField label="Employee" htmlFor="sal-employee" required error={errorFor('employee')} col={12}>
            <SearchSelect
              id="sal-employee"
              portal
              options={options}
              value={employeeId}
              onChange={pickEmployee}
              onBlur={() => setTouched(p => ({ ...p, employee: true }))}
              placeholder="Search by name or employee ID…"
              emptyText="No employee matches"
              invalid={!!errorFor('employee')}
              getLabel={(e) => `${e.name} (${e.employee_code})`}
              renderOption={(e) => (
                <span className={`sal-option${e.blocked ? ' is-blocked' : ''}`} title={e.blocked || undefined}>
                  <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(e.name)}</span>
                  <span className="sal-option-text">
                    <span className="sal-option-name">{e.name}</span>
                    <span className="sal-option-sub">
                      {e.employee_code} · {e.blocked ? (BLOCKED_LABELS[e.blocked_code] || 'Not available') : e.designation_name}
                    </span>
                  </span>
                  {e.total > 0 && <span className="sal-option-amt">{fmtAmount(e.total)} taken</span>}
                </span>
              )}
            />
          </FormField>
        </div>

        {employeeId && !context && !contextError && (
          <div className="hr-fin-context" aria-hidden="true"><FieldGridSkeleton fields={3} cols={3} /></div>
        )}

        {contextError && (
          <Notice tone="danger" title="This employee’s pay period could not be loaded">{contextError}</Notice>
        )}

        {context && context.blocked && (
          <Notice tone="danger" title="Advance salary cannot be recorded">{context.blocked}</Notice>
        )}

        {ready && (
          <>
            {/* Decided by the server, so stated as facts rather than asked. */}
            <div className="hr-fin-context">
              <FieldGrid cols={3}>
                <Field label="Pay period" value={fmtMonth(context.month)} />
                <Field
                  label="Already advanced"
                  value={<>
                    {fmtMoney(context.month_total)}
                    {context.advances.length > 0 && <span className="sal-kv-sub">{entries(context.advances.length)}</span>}
                  </>}
                />
                <Field label="Payslip" value={context.slip_processed ? 'Already processed' : 'Not processed yet'} />
              </FieldGrid>
              {context.rolled_forward && (
                <p className="hr-help">
                  The {fmtMonth(context.closed_month)} Pay Run is closed, so this advance
                  applies to {fmtMonth(context.month)}.
                </p>
              )}
            </div>

            <div className="hr-form-grid is-modal">
              <FormField label="Amount (PKR)" htmlFor="sal-amount" required error={errorFor('amount')} col={6}>
                <input id="sal-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                  className={`form-control no-spinner${errorFor('amount') ? ' hr-invalid' : ''}`}
                  style={{ textAlign: 'right' }}
                  value={form.amount} onWheel={blockWheelChange} autoFocus
                  onChange={e => setField('amount', e.target.value)}
                  onBlur={() => setTouched(p => ({ ...p, amount: true }))} />
              </FormField>

              <FormField label="Date given" htmlFor="sal-date" required error={errorFor('date_given')} col={6}>
                <DateInput id="sal-date"
                  className={`form-control${errorFor('date_given') ? ' hr-invalid' : ''}`}
                  value={form.date_given}
                  min={person?.date_of_joining > monthStart() ? person.date_of_joining : monthStart()}
                  max={todayPKT()}
                  onChange={e => setField('date_given', e.target.value)}
                  onBlur={() => setTouched(p => ({ ...p, date_given: true }))} />
              </FormField>

              <FormField
                label={<span style={{ display: 'flex', alignItems: 'center' }}>
                  Note
                  <span className={`sal-note-count${noteLeft <= 20 ? ' is-near' : ''}`} aria-live="polite">
                    {form.note.length}/{NOTE_MAX}
                  </span>
                </span>}
                htmlFor="sal-note" error={errors.note} col={12}
              >
                <input id="sal-note" className="form-control" maxLength={NOTE_MAX}
                  placeholder="Optional, e.g. reason or who received it"
                  value={form.note}
                  onChange={e => setField('note', e.target.value)} />
              </FormField>
            </div>

            {/* The consequence of saving, stated before Save: one notice at
                a time, the most serious first. */}
            {refusal && (
              <Notice tone="danger" title="Advance not recorded" style={{ marginTop: 4 }}>{refusal}</Notice>
            )}
            {!refusal && duplicate && (
              <Notice tone="warning" title="This looks like a duplicate" style={{ marginTop: 4 }}>
                An advance of {fmtMoney(duplicate.amount)} given on {fmtDate(duplicate.date_given)} is
                already recorded for {person.name} in {fmtMonth(context.month)}.
                <label className="sal-check">
                  <input type="checkbox" checked={duplicateOk} onChange={e => setDuplicateOk(e.target.checked)} />
                  A second advance of this amount was given. Record it as well.
                </label>
              </Notice>
            )}
            {!refusal && !duplicate && !limitError && !validation.amount && context.slip_processed && (
              <Notice tone="info" title={`The ${fmtMonth(context.month)} payslip will be updated`} style={{ marginTop: 4 }}>
                {person.name}’s payslip for {fmtMonth(context.month)} is already processed. This advance
                will be deducted from it as well.
              </Notice>
            )}
          </>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const EMPLOYEE_SORT = {
  name:       { value: e => e.name, text: true },
  total:      { value: e => num(e.total) },
};

export default function AdvanceSalary() {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [denied, setDenied]       = useState(false);
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState(() => new Set());
  const [flash, setFlash]         = useState(null); // { employeeId, entryId }

  const [recordOpen, setRecordOpen] = useState(false);
  const [recordFor, setRecordFor]   = useState(null);

  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving]         = useState(false);

  const employeeSort = useSort('name');

  // The pinned header's height (it wraps on narrow screens) for the column
  // headings pinned under it.
  const cardRef = useRef(null);
  const headRef = useRef(null);
  useEffect(() => {
    const head = headRef.current;
    const card = cardRef.current;
    if (!head || !card) return undefined;
    const update = () => card.style.setProperty('--sal-head-h', `${head.offsetHeight}px`);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(head);
    return () => observer.disconnect();
  }, [denied]);

  // Responses can arrive out of order when the period is switched quickly;
  // only the latest request may land.
  const ticket = useRef(0);
  const load = useCallback((month, { quiet = false } = {}) => {
    const mine = ++ticket.current;
    if (!quiet) setLoading(true);
    setLoadError(null);
    return api.get('/hr/advances', { params: month ? { month } : {} })
      .then(r => { if (ticket.current === mine) { setData(r.data); setDenied(false); } })
      .catch(err => {
        if (ticket.current !== mine) return;
        if (err?.response?.data?.code === 'PERMISSION_DENIED') setDenied(true);
        else setLoadError(apiError(err, 'Check your connection and try again.'));
      })
      .finally(() => { if (ticket.current === mine) setLoading(false); });
  }, []);

  useEffect(() => { load(null); }, [load]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  const month = data?.month || '';
  const openPeriod = data?.open_period || null;
  const isOpenPeriod = !!openPeriod && openPeriod.month === month;
  const canRecord = isOpenPeriod && !data?.locked;

  const switchMonth = (next) => {
    setExpanded(new Set());
    setSearch('');
    load(next);
  };

  const openRecord = (employeeId = null) => {
    setRecordFor(employeeId);
    setRecordOpen(true);
  };

  const onSaved = (saved) => {
    setRecordOpen(false);
    const employeeId = saved.employee?.id;
    if (employeeId) {
      setExpanded(prev => new Set(prev).add(employeeId));
      setFlash({ employeeId, entryId: saved.id });
    }
    load(saved.month, { quiet: true });
  };

  const removeAdvance = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const { data: res } = await api.delete(`/hr/advances/${removeTarget.id}`);
      toast.success(res.slip_updated?.after
        ? `Advance removed. The ${fmtMonth(res.month)} payslip was updated. Net payable: ${fmtMoney(res.slip_updated.after.net_pay)}.`
        : res.slip_updated
          ? `Advance removed. The ${fmtMonth(res.month)} payslip was updated.`
          : 'Advance removed.');
    } catch (err) {
      toast.error(apiError(err, 'The advance salary could not be removed. Try again.'));
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
      load(month, { quiet: true });
    }
  };

  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── Derived lists ────────────────────────────────────────────────────────
  const entriesByEmployee = useMemo(() => {
    const map = new Map();
    for (const entry of data?.entries || []) {
      if (!map.has(entry.employee_id)) map.set(entry.employee_id, []);
      map.get(entry.employee_id).push(entry);
    }
    return map;
  }, [data]);

  const query = search.trim();
  const filteredEmployees = useMemo(() => {
    const rows = (data?.employees || []).filter(e =>
      matches(query, e.name, e.employee_code, e.designation_name, e.department_name));
    return sortRows(rows, employeeSort.sortConfig, EMPLOYEE_SORT,
      (a, b) => String(a.name).localeCompare(String(b.name)));
  }, [data, query, employeeSort.sortConfig]);

  const recordableEmployees = useMemo(
    () => (isOpenPeriod ? (data?.employees || []).filter(e => e.status === 'Active' || e.total > 0) : []),
    [data, isOpenPeriod]
  );
  const activeCount = useMemo(
    () => (data?.employees || []).filter(e => e.status === 'Active').length,
    [data]
  );

  const monthOptions = useMemo(() => (data?.months || []).map(m => ({
    value: m.month,
    label: fmtMonth(m.month),
    badge: m.run_status ? (m.run_status === 'Open' ? 'Open' : 'Closed') : undefined,
    badgeTone: m.run_status === 'Open' ? 'open' : 'closed',
    badgeIcon: m.run_status === 'Completed' ? 'lock' : undefined,
  })), [data]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (denied) {
    return (
      <Layout title="Advance Salary">
        <HrStyles />
        <div className="card">
          <EmptyState icon="lock" title="You do not have access to Advance Salary"
            desc="Ask an administrator to tick Advance Salary under Workforce for your account, then sign out and back in." />
        </div>
      </Layout>
    );
  }

  const totals = data?.totals || { amount: 0, entries: 0, employees: 0 };

  const renderEmployeeTable = () => {
    if (filteredEmployees.length === 0) {
      return (data?.employees || []).length === 0 ? (
        <EmptyState
          icon={isOpenPeriod ? 'groups' : 'payments'}
          title={isOpenPeriod ? 'No active employees' : `No advance salary in ${fmtMonth(month)}`}
          desc={isOpenPeriod
            ? 'Employees appear here once HR adds them under Employees (HR).'
            : 'Nobody took an advance in this pay period.'}
          small
        />
      ) : (
        <EmptyState icon="search_off" title={`Nobody matches "${query}"`}
          desc="Try a different spelling, or search by employee ID."
          action={<button className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>} small />
      );
    }
    return (
      <>
        <div className="hr-page-scroll">
          <table className="hr-table hr-page-table sal-table">
            <caption className="hr-sr-only">Advance salary by employee, {fmtMonth(month)}</caption>
            <thead>
              <tr>
                <th style={{ width: 44 }}><span className="hr-sr-only">Expand</span></th>
                <SortableHeader column="name" label="Employee" {...employeeSort} style={{ width: '38%' }} />
                <th>Designation</th>
                <SortableHeader column="total" label="Advanced" title={`Advanced in ${fmtMonth(month)}`} {...employeeSort}
                  align="right" iconBefore firstDirection="desc" style={{ width: '16%' }} />
                <th style={{ width: 130 }}><span className="hr-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map(employee => {
                const list = entriesByEmployee.get(employee.id) || [];
                const isExpanded = expanded.has(employee.id) && list.length > 0;
                const flashing = flash && flash.employeeId === employee.id;
                const inactiveWithOpen = employee.status !== 'Active' && list.some(e => !e.locked);
                return (
                  <React.Fragment key={employee.id}>
                    <tr
                      className={`${list.length ? 'hr-row-click' : ''}${isExpanded ? ' sal-row-expanded' : ''}${flashing ? ' sal-flash' : ''}`}
                      onClick={list.length ? () => toggleExpanded(employee.id) : undefined}
                    >
                      <td>
                        {list.length ? (
                          <button
                            type="button"
                            className="sal-chevron"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Hide' : 'Show'} ${employee.name}’s advances`}
                            onClick={e => { e.stopPropagation(); toggleExpanded(employee.id); }}
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                          </button>
                        ) : <span className="sal-chevron-spacer" aria-hidden="true" />}
                      </td>
                      <td>
                        <div className="hr-identity-cell">
                          <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(employee.name)}</span>
                          <span>
                            <span className="sal-name">{employee.name}</span>
                            <span className="sal-code">{employee.employee_code}</span>
                            {employee.status !== 'Active' && (
                              <span className="badge badge-gray" style={{ marginLeft: 8 }}>Inactive</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="sal-desig">
                        {employee.designation_name}
                        <span className="sal-dept"> · {employee.department_name}</span>
                      </td>
                      <td className="hr-num">
                        {inactiveWithOpen && (
                          <>
                            <span className="material-symbols-outlined sal-warn" aria-hidden="true"
                              title="Not on a Pay Run: inactive employees are not paid through payroll, so this advance will not be deducted automatically. Ask HR to settle it.">
                              warning
                            </span>
                            <span className="hr-sr-only">Not on a Pay Run, ask HR to settle: </span>
                          </>
                        )}
                        {employee.total > 0
                          ? <span className="sal-total" title={entries(employee.entries)}>{fmtAmount(employee.total)}</span>
                          : <><span className="sal-zero" aria-hidden="true">—</span><span className="hr-sr-only">None</span></>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                          <div className="sal-actions">
                            {/* An inactive employee already carries the Inactive tag. */}
                            {!canRecord || employee.blocked_code === 'inactive' ? null : employee.blocked ? (
                              <span className="sal-blocked" title={employee.blocked}>
                                <span className="material-symbols-outlined" aria-hidden="true">block</span>
                                {BLOCKED_LABELS[employee.blocked_code] || 'Not available'}
                                <span className="hr-sr-only">: {employee.blocked}</span>
                              </span>
                            ) : (
                              <button type="button" className="sal-rec"
                                onClick={() => openRecord(employee.id)}
                                aria-label={`Record advance salary for ${employee.name}`}>
                                <span className="material-symbols-outlined" aria-hidden="true">add</span>
                                Record
                              </button>
                            )}
                          </div>
                        </td>
                    </tr>
                    {isExpanded && list.map(entry => (
                      <tr key={`entry-${entry.id}`}
                        className={`sal-line${flash && flash.entryId === entry.id ? ' sal-flash' : ''}`}>
                        <td />
                        <td colSpan={2} className="sal-line-main">
                          <span className="sal-line-date">{fmtDate(entry.date_given)}</span>
                          {entry.note && <span className="sal-line-note" title={entry.note}>{entry.note}</span>}
                          {entry.created_by_name && <span className="sal-line-by">by {entry.created_by_name}</span>}
                          <AdvanceStatus entry={entry} />
                        </td>
                        <td className="hr-num">{fmtAmount(entry.amount)}</td>
                        <td style={{ textAlign: 'right' }}><RemoveButton entry={entry} onRemove={setRemoveTarget} viewOnly={!isOpenPeriod} /></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  return (
    <Layout title="Advance Salary">
      <HrStyles />
      <style dangerouslySetInnerHTML={{ __html: ADV_STYLES }} />

      <div className="card sal-card" ref={cardRef}>
        {/* Same header as Sales Invoices: title and one line of totals on
            the left, the controls on the right. */}
        <div className="card-header sal-header" ref={headRef}>
          <div>
            <h1 className="card-title" style={{ margin: 0 }}>Advance Salary</h1>
            <div className="text-sm text-muted mt-1" aria-live="polite">
              {!data
                ? 'Loading…'
                : totals.entries === 0
                  ? `No advances in ${fmtMonth(month)}`
                  : `${fmtMoney(totals.amount)} advanced to ${isOpenPeriod
                    ? `${totals.employees} of ${activeCount} employees`
                    : plural(totals.employees, 'employee')}`}
            </div>
          </div>
          <div className="sal-controls">
            <Select
              id="sal-month"
              ariaLabel="Month"
              value={month}
              onChange={switchMonth}
              options={monthOptions}
              minWidth={176}
              disabled={!data}
            />
            <div className="search-bar" role="search">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">search</span>
              <label className="hr-sr-only" htmlFor="sal-search">
                Search employees
              </label>
              <input
                id="sal-search"
                type="search"
                placeholder="Search employees…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {canRecord && (
              <button className="btn btn-primary" onClick={() => openRecord()}>+ Record Advance</button>
            )}
          </div>
        </div>

        {data && (data.open_period_error || (isOpenPeriod && openPeriod.rolled_forward) || !isOpenPeriod) && (
          <div className="sal-notices">
            {data.open_period_error && (
              <Notice tone="danger" title="Advance salary cannot be recorded right now">{data.open_period_error}</Notice>
            )}
            {isOpenPeriod && openPeriod.rolled_forward && (
              <Notice tone="info" title={`New advances go to ${fmtMonth(openPeriod.month)}`}>
                The {fmtMonth(openPeriod.closed_month)} Pay Run is closed, so advances recorded now are
                deducted from the {fmtMonth(openPeriod.month)} payslip.
              </Notice>
            )}
            {!isOpenPeriod && (
              <Notice tone="neutral" title={`${fmtMonth(month)} is view only`}>
                {data.locked
                  ? 'Its Pay Run is closed, so these advances have been deducted. '
                  : ''}
                {openPeriod ? `Advances can be recorded only for ${fmtMonth(openPeriod.month)}.` : ''}
                {openPeriod && (
                  <div className="sal-notice-action">
                    <button className="btn btn-outline btn-sm" onClick={() => switchMonth(openPeriod.month)}>
                      Go to {fmtMonth(openPeriod.month)}
                    </button>
                  </div>
                )}
              </Notice>
            )}
          </div>
        )}

        {/* Announces how many rows a search left, for screen readers. */}
        <p className="hr-sr-only" aria-live="polite">
          {data && query ? `${plural(filteredEmployees.length, 'employee')} shown` : ''}
        </p>

        <div>
          {loading && !data ? (
            <TableSkeleton columns={4} rows={7} />
          ) : loadError && !data ? (
            <EmptyState
              icon="cloud_off"
              title="Could not load advance salary"
              desc={loadError}
              action={<button className="btn btn-outline" onClick={() => load(month || null)}>Try again</button>}
            />
          ) : (
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
              {renderEmployeeTable()}
            </div>
          )}
        </div>
      </div>

      <RecordAdvanceModal
        open={recordOpen}
        initialEmployeeId={recordFor}
        employees={recordableEmployees}
        onClose={() => setRecordOpen(false)}
        onSaved={onSaved}
        onStale={() => load(null, { quiet: true })}
      />

      {/* ── Remove an advance ──────────────────────────────────────────── */}
      <Modal
        isOpen={!!removeTarget}
        onClose={() => { if (!removing) setRemoveTarget(null); }}
        title="Remove advance salary?"
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</button>
            <BusyButton busy={removing} busyLabel="Removing…" icon="delete" className="btn btn-danger" onClick={removeAdvance}>
              Remove
            </BusyButton>
          </>
        }
      >
        {removeTarget && (
          <p style={{ fontSize: 13, lineHeight: '20px', color: 'var(--gray-600)', margin: 0 }}>
            The advance of {fmtMoney(removeTarget.amount)} given to <strong>{removeTarget.employee_name}</strong> on
            {' '}{fmtDate(removeTarget.date_given)} will no longer be deducted from the {fmtMonth(removeTarget.month || month)} payslip.
            {removeTarget.slip_id ? ' That payslip is already processed, so it will be updated as well.' : ''}
            {' '}Remove an advance only if it was recorded in error.
          </p>
        )}
      </Modal>
    </Layout>
  );
}

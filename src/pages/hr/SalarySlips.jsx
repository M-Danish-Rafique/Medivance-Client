import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import SalarySlipDocument, { SLIP_STYLES } from './SalarySlipDocument';
import {
  HrStyles, SortableHeader, useSort, sortRows, byText, byNumber,
  TableSkeleton, EmptyState, BusyButton, Select, KebabMenu,
  fmtMoney, fmtAmount, fmtDate, fmtMonth, num, money, initials,
  apiError, blockWheelChange, Notice, InfoPopover,
} from './HrKit';

// ─── Payroll ───────────────────────────────────────────────────────────────
// Payroll is run as a monthly PAY RUN (`payroll_runs`):
//
//   1. Start the Pay Run for a month.
//   2. Process a payslip for every employee payable that month. The run shows
//      two tabs: Pending (still to process — click one to process them) and
//      Processed (their payslips, amendable while the run is open).
//   3. Close the Pay Run — only possible once Pending is empty. Every payslip
//      becomes permanently read-only. Someone who should not be paid gets a
//      zero-pay payslip stating why, so the month's record is complete.
//
// Who is "payable" is decided by the server — ACTIVE employees who had joined
// by the month's end; Inactive means they have left and are never paid through
// a run — and comes back from GET /hr/payroll-runs/roster. "n of m processed"
// is payable minus pending, so a slip belonging to someone who has since left
// can never push it past 100%.
//
// Money on every screen is split the same way (product decision 2026-09-30):
//   Gross earnings − Deductions (tax, fines…) − Loan repayments = Net salary
//   Net salary − Advance salary                                 = Net payable
// Net payable is the cash still to disburse (salary_slips.net_pay) and can
// never be negative. The advance is recorded on the employee's profile and is
// always deducted in full: the editor shows it but cannot change it. Loans are
// repaid per loan in the editor, but print as ONE "Loan Deduction" row.
// Cost to Company is ONE figure per month, recorded on the Pay Run when it is
// closed: the close dialog pre-fills the calculated figure and the operator may
// edit it. Calculated = gross earnings less deductions, EXCLUDING loan
// repayments (they settle money already lent) and never reduced by advance
// salary (the same salary, paid earlier). Product decision 2026-10-01.
//
// Payslips are never deletable. The server enforces all of this; the UI only
// stops offering what would be refused.
//
// Three views, switched in place (never a modal):
//   list  — the month's run: Pending / Processed tabs
//   draft — the line editor for one payslip (new or being amended)
//   slip  — one payslip, read-only, with its print actions

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '', signature_url: '' };

const SLIP_COMPARATORS = {
  employee_name:   byText('employee_name'),
  department_name: byText('department_name'),
  net_pay:         byNumber('net_pay'),
};

const PENDING_COMPARATORS = {
  name:               byText('name'),
  department_name:    byText('department_name'),
  structure_earnings: byNumber('structure_earnings'),
  loan_outstanding:   byNumber('loan_outstanding'),
};

const currentMonthPKT = () => todayPKT().slice(0, 7);

/** Last 15 months, newest first — payroll is rarely run further back. */
function recentMonths(count = 15) {
  const [year, month] = currentMonthPKT().split('-').map(Number);
  const months = [];
  for (let i = 0; i < count; i++) {
    const total = year * 12 + (month - 1) - i;
    months.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}

/** "2026-07" -> "Jul 2026" — for the context rows, where the month is a
 *  label beside the figures rather than the subject of the screen. */
const fmtMonthShort = (month) => {
  const full = fmtMonth(month);
  const [name, year] = full.split(' ');
  return name && year ? `${name.slice(0, 3)} ${year}` : full;
};

/** A timestamp as "22 Sep 2026" in PKT — for "closed on" style lines. */
const fmtStamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let lineKeySeq = 0;

/** Ordinary (typed) lines. Loan repayment lines are kept apart — see toLoanLines. */
const toLines = (rows) => (rows || []).filter(row => !row.loan_id).map(row => ({
  key: `l${++lineKeySeq}`,
  title: row.title || '',
  amount: String(num(row.amount)),
}));

// One row per loan the employee still owes on, each with its own repayment.
// Every such loan is listed — a loan being skipped this month stays on screen
// at 0 rather than disappearing — and the printed payslip merges them into a
// single "Loan Deduction" row.
//
// New payslip: the draft's loan lines already carry `loan_remaining`.
// Amending: the balance is taken from `loan_context` as it would be WITHOUT
// this slip. The plain remaining balance would already have this slip's own
// repayment subtracted, so an unchanged line would look overdrawn.
const toLoanLines = (deductionRows, loanContext) => {
  const repaid = new Map();
  (deductionRows || []).filter(row => row.loan_id).forEach(row => {
    const prev = repaid.get(row.loan_id);
    repaid.set(row.loan_id, {
      title: prev?.title || row.title,
      amount: num(prev?.amount) + num(row.amount),
      loan_title: row.loan_title,
      loan_remaining: row.loan_remaining,
    });
  });

  if (!loanContext) {
    return [...repaid.entries()].map(([loanId, line]) => ({
      key: `l${++lineKeySeq}`,
      loan_id: loanId,
      loan_title: line.loan_title || line.title,
      title: line.title,
      amount: String(money(line.amount)),
      loan_remaining: num(line.loan_remaining),
    }));
  }

  return loanContext
    .filter(loan => num(loan.remaining_excluding_slip) > 0.005 || repaid.has(loan.id))
    .map(loan => {
      const line = repaid.get(loan.id);
      return {
        key: `l${++lineKeySeq}`,
        loan_id: loan.id,
        loan_title: loan.title,
        title: line?.title || `Loan repayment — ${loan.title}`,
        amount: String(money(line?.amount || 0)),
        loan_remaining: num(loan.remaining_excluding_slip),
      };
    });
};

const Dash = ({ title }) => <span className="att-dash" title={title}>—</span>;

// Money on a payslip line reads as money: 60,000.00 at rest, the raw number
// while it is being typed (separators fight the caret). A text input rather
// than type=number — no spinner, no wheel-scroll changing a salary, and it can
// hold the formatted string.
function AmountInput({ id, value, invalid, onChange }) {
  const [editing, setEditing] = useState(false);
  const raw = String(value ?? '');
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      placeholder="0.00"
      className={`form-control pr-amount${invalid ? ' hr-invalid' : ''}`}
      value={editing || raw.trim() === '' ? raw : fmtAmount(num(raw))}
      onFocus={e => { setEditing(true); e.target.select(); }}
      onBlur={() => setEditing(false)}
      onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))}
    />
  );
}

export default function SalarySlips() {
  const navigate = useNavigate();

  const [view, setView] = useState('list'); // 'list' | 'draft' | 'slip'
  const [month, setMonth] = useState(currentMonthPKT);
  const [tab, setTab] = useState(null);     // null = choose automatically

  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [slips, setSlips] = useState([]);
  const [loadingSlips, setLoadingSlips] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const [roster, setRoster] = useState({ eligible: 0, pending: [] });
  const [loadingRoster, setLoadingRoster] = useState(true);

  const [company, setCompany] = useState(DEFAULT_COMPANY);

  // Draft / edit state. `editingSlipId` null = processing a new payslip.
  const [draft, setDraft] = useState(null);
  const [editingSlipId, setEditingSlipId] = useState(null);
  const [earnings, setEarnings] = useState([]);
  const [deductions, setDeductions] = useState([]);   // ordinary deductions only
  const [loanLines, setLoanLines] = useState([]);     // one per outstanding loan
  const [generating, setGenerating] = useState(false);
  const [savingSlip, setSavingSlip] = useState(false);
  // Monthly Cost to Company, edited in the close dialog. null = calculated.
  const [closeCtc, setCloseCtc] = useState(null);
  const [ctcEditing, setCtcEditing] = useState(false);
  const [zeroOpen, setZeroOpen] = useState(false);
  const [zeroReason, setZeroReason] = useState('');

  // Viewing one slip
  const [openSlip, setOpenSlip] = useState(null);
  const [loadingSlip, setLoadingSlip] = useState(false);

  const slipSort = useSort('employee_name');
  const pendingSort = useSort('department_name');

  // ── Loading ──────────────────────────────────────────────────────────────
  const loadRuns = useCallback(() => {
    setLoadingRuns(true);
    api.get('/hr/payroll-runs')
      .then(r => setRuns(r.data))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, []);

  const loadSlips = useCallback(() => {
    setLoadingSlips(true);
    setLoadError(null);
    setSelectedIds([]);
    api.get('/hr/salary-slips', { params: { month } })
      .then(r => setSlips(r.data))
      .catch(err => setLoadError(apiError(err, 'Could not load payslips.')))
      .finally(() => setLoadingSlips(false));
  }, [month]);

  const loadRoster = useCallback(() => {
    setLoadingRoster(true);
    api.get('/hr/payroll-runs/roster', { params: { month } })
      .then(r => setRoster({ eligible: r.data.eligible, pending: r.data.pending }))
      .catch(err => {
        setRoster({ eligible: 0, pending: [] });
        setLoadError(apiError(err, 'Could not load the employees for this month.'));
      })
      .finally(() => setLoadingRoster(false));
  }, [month]);

  const refreshMonth = useCallback(() => {
    loadRuns();
    loadSlips();
    loadRoster();
  }, [loadRuns, loadSlips, loadRoster]);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { loadSlips(); loadRoster(); setTab(null); }, [loadSlips, loadRoster]);

  useEffect(() => {
    // The preview and the printed page both need the logo and the authorized
    // signature. CompanyContext deliberately drops both, so this reads
    // /admin/company directly — exactly what the invoice print route does.
    api.get('/admin/company')
      .then(r => setCompany({
        name:    r.data?.name    || DEFAULT_COMPANY.name,
        address: r.data?.address || '',
        phone:   r.data?.phone   || '',
        email:   r.data?.email   || '',
        logo_url: r.data?.logo_url || '',
        signature_url: r.data?.signature_url || '',
      }))
      .catch(() => setCompany(DEFAULT_COMPANY));
  }, []);

  // ── The pay run for the selected month ───────────────────────────────────
  const run = useMemo(() => runs.find(r => r.month === month) || null, [runs, month]);
  const runOpen   = run?.status === 'Open';
  const runClosed = run?.status === 'Completed';
  const pending = roster.pending;
  const loading = loadingRuns || loadingSlips || loadingRoster;

  // Pending first while there is work to do; Processed otherwise.
  const activeTab = tab || (runOpen && pending.length ? 'pending' : 'processed');

  const monthTotals = useMemo(() => {
    const sum = (key) => money(slips.reduce((total, x) => total + num(x[key]), 0));
    const earnings = sum('total_earnings');
    const other    = sum('other_deductions');
    const loans    = sum('loan_recoveries');
    return {
      earnings,
      other,
      loans,
      netSalary: money(earnings - other - loans),
      advance:   sum('advance_amount'),
      net:       sum('net_pay'),   // net payable — what is still to disburse
      // Cost to Company (product decision 2026-10-01): gross earnings less
      // deductions, EXCLUDING loan repayments (they return money lent earlier)
      // and never reduced by advance salary (the same salary, paid early).
      // Mirrors calculatedCtc in routes/payrollRuns.js.
      ctc:       money(earnings - other),
    };
  }, [slips]);

  // What the pending list will cost if processed as it stands: the salary
  // structure less its deductions, the whole outstanding loan balance (as the
  // draft pre-fills it) and the month's advance.
  const estNet = (p) => money(
    num(p.structure_earnings) - num(p.structure_deductions) - num(p.loan_outstanding) - num(p.advance_amount)
  );
  const pendingTotals = useMemo(() => ({
    earnings:   money(pending.reduce((s, p) => s + num(p.structure_earnings), 0)),
    deductions: money(pending.reduce((s, p) => s + num(p.structure_deductions), 0)),
    loans:      money(pending.reduce((s, p) => s + num(p.loan_outstanding), 0)),
    advance:    money(pending.reduce((s, p) => s + num(p.advance_amount), 0)),
    net:        money(pending.reduce((s, p) => s + Math.max(0, estNet(p)), 0)),
  }), [pending]);

  const processedCount = Math.max(0, roster.eligible - pending.length);
  const canClose = runOpen && pending.length === 0 && slips.length > 0;
  const closeBlockedReason = !runOpen ? undefined
    : slips.length === 0 ? 'Process at least one payslip first'
      : pending.length ? `${plural(pending.length, 'employee')} still to process`
        : undefined;

  const startRun = async () => {
    setStarting(true);
    try {
      await api.post('/hr/payroll-runs', { month });
      toast.success(`${fmtMonth(month)} Pay Run started`);
      setTab('pending');
      refreshMonth();
    } catch (err) {
      toast.error(apiError(err, 'Could not start the Pay Run.'));
      loadRuns();
    } finally {
      setStarting(false);
    }
  };

  const openCloseDialog = () => {
    setCloseCtc(String(monthTotals.ctc));
    setCtcEditing(false);
    setCompleteOpen(true);
  };

  // The month's Cost to Company as it will be recorded.
  const recordedCtc = money(num(closeCtc));
  const closeCtcInvalid = String(closeCtc ?? '').trim() === '' || num(closeCtc) < 0;
  const closeCtcEdited = !closeCtcInvalid && recordedCtc !== monthTotals.ctc;

  const closeRun = async () => {
    if (closeCtcInvalid) return;
    setCompleting(true);
    try {
      await api.put(`/hr/payroll-runs/${run.id}/complete`, { cost_to_company: num(closeCtc) });
      toast.success(`The ${fmtMonth(month)} Pay Run is closed. Its payslips are now read-only.`);
      setCompleteOpen(false);
      setTab('processed');
      refreshMonth();
      setView('list');
    } catch (err) {
      toast.error(apiError(err, 'Could not close this Pay Run.'));
      if (err?.response?.data?.code === 'PAYROLL_RUN_INCOMPLETE') {
        setCompleteOpen(false);
        setTab('pending');
        refreshMonth();
      }
    } finally {
      setCompleting(false);
    }
  };

  // ── Processing a new payslip ─────────────────────────────────────────────
  const processEmployee = async (employeeId) => {
    setView('draft');
    setGenerating(true);
    setDraft(null);
    setEditingSlipId(null);
    setEarnings([]);
    setDeductions([]);
    setLoanLines([]);
    try {
      const { data } = await api.get('/hr/salary-slips/draft', {
        params: { employee_id: employeeId, month },
      });
      setDraft(data);
      setEarnings(toLines(data.earnings));
      setDeductions(toLines(data.deductions));
      setLoanLines(toLoanLines(data.deductions));
    } catch (err) {
      const existingId = err?.response?.data?.existing_slip_id;
      if (existingId) {
        toast.error(apiError(err, 'This employee already has a payslip for this month.'));
        refreshMonth();
        openIssuedSlip(existingId);
      } else {
        toast.error(apiError(err, 'Could not prepare a payslip for this employee.'));
        setView('list');
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── Amending an existing slip ────────────────────────────────────────────
  // Reuses the same line editor. The employee and month are fixed; only the
  // lines change, and the target/net figures are recomputed server-side.
  const startEdit = async (slipId) => {
    setView('draft');
    setGenerating(true);
    setDraft(null);
    setEditingSlipId(slipId);
    try {
      const { data } = await api.get(`/hr/salary-slips/${slipId}`);
      if (!data.is_editable) {
        toast.error(`The ${fmtMonth(data.month)} Pay Run is closed. Its payslips can no longer be edited.`);
        setEditingSlipId(null);
        openIssuedSlip(slipId);
        return;
      }

      // Shaped like a /draft response so the editor needs no edit-mode case.
      setDraft({
        employee: {
          id: data.employee_id,
          employee_id: data.employee_code,
          name: data.employee_name,
          designation_name: data.designation_name,
          department_name: data.department_name,
          is_field_employee: data.is_field_employee,
        },
        month: data.month,
        attendance: data.attendance,
        advances: data.advances || [],
        advance_amount: data.advance_amount,
        target_amount: data.target_amount,
        target_achieved: data.target_achieved,
        target_reason: 'Recalculated from live sales data when you save',
      });
      setEarnings(toLines(data.earnings));
      setDeductions(toLines(data.deductions));
      setLoanLines(toLoanLines(data.deductions, data.loan_context || []));
    } catch (err) {
      toast.error(apiError(err, 'Could not open this payslip for amendment.'));
      setEditingSlipId(null);
      setView('list');
    } finally {
      setGenerating(false);
    }
  };

  const leaveDraft = () => {
    setView('list');
    setDraft(null);
    setEditingSlipId(null);
  };

  const updateLine = (side, key, patch) => {
    const setter = side === 'earnings' ? setEarnings : setDeductions;
    setter(prev => prev.map(line => (line.key === key ? { ...line, ...patch } : line)));
  };
  const removeLine = (side, key) => {
    const setter = side === 'earnings' ? setEarnings : setDeductions;
    setter(prev => prev.filter(line => line.key !== key));
  };
  const addLine = (side) => {
    const setter = side === 'earnings' ? setEarnings : setDeductions;
    setter(prev => [...prev, { key: `l${++lineKeySeq}`, title: '', amount: '' }]);
  };

  const updateLoanLine = (key, amount) => {
    setLoanLines(prev => prev.map(line => (line.key === key ? { ...line, amount } : line)));
  };

  // The month's advance — fixed: recorded on the employee's profile, always
  // deducted in full, never editable here.
  const advanceAmount = money(draft?.advance_amount);

  // Zero pay: the one sanctioned way to "skip" someone. The payslip still
  // exists — one zero earning line carrying the reason, no deductions and every
  // loan repayment at 0 (nothing is repaid from a salary that was not paid) —
  // and prints as such. Not possible once an advance has been paid against the
  // month: that money has to be recovered from this payslip.
  const applyZeroPay = () => {
    const reason = zeroReason.trim();
    if (!reason || advanceAmount > 0) return;
    setEarnings([{ key: `l${++lineKeySeq}`, title: `Not paid this month: ${reason}`, amount: '0' }]);
    setDeductions([]);
    setLoanLines(prev => prev.map(line => ({ ...line, amount: '0' })));
    setZeroOpen(false);
    toast('The payslip is now set to zero pay. Review it, then save.', { icon: 'ℹ️' });
  };

  const totals = useMemo(() => {
    const e = earnings.reduce((s, l) => s + num(l.amount), 0);
    const other = deductions.reduce((s, l) => s + num(l.amount), 0);
    const loans = loanLines.reduce((s, l) => s + num(l.amount), 0);
    const netSalary = money(e - other - loans);
    return {
      earnings: money(e),
      deductions: money(other + loans),
      loans: money(loans),
      other: money(other),
      netSalary,
      advance: advanceAmount,
      net: money(netSalary - advanceAmount),   // net payable
    };
  }, [earnings, deductions, loanLines, advanceAmount]);

  // What the employee will still owe once this payslip's repayments land —
  // the "Total Pending Loan" line the payslip prints.
  const loanLeftAfter = useMemo(
    () => money(loanLines.reduce((s, l) => s + Math.max(0, num(l.loan_remaining) - num(l.amount)), 0)),
    [loanLines]
  );

  // Every rule the server enforces, checked here first so the operator sees the
  // problem before submitting rather than after.
  const draftProblem = useMemo(() => {
    if (!draft) return null;
    if (earnings.length === 0) return 'Add at least one earning. For an employee who is not being paid this month, mark the payslip as zero pay.';
    if ([...earnings, ...deductions].some(l => !l.title.trim() && num(l.amount) !== 0)) {
      return 'Every line with an amount needs a description.';
    }
    if ([...earnings, ...deductions, ...loanLines].some(l => num(l.amount) < 0)) {
      return 'Amounts cannot be negative.';
    }
    const overdrawn = loanLines.find(l => num(l.amount) - num(l.loan_remaining) > 0.005);
    if (overdrawn) {
      return `The repayment for ${overdrawn.loan_title} exceeds the outstanding balance of ${fmtMoney(overdrawn.loan_remaining)}.`;
    }
    if (totals.netSalary < 0) {
      return 'Deductions exceed earnings. Reduce a deduction or spread a loan repayment across several months.';
    }
    if (totals.net < 0) {
      return `The advance salary of ${fmtMoney(totals.advance)} exceeds the net salary of ${fmtMoney(totals.netSalary)}. `
        + 'Advance salary is always deducted in full, so reduce a deduction or loan repayment.';
    }
    return null;
  }, [draft, earnings, deductions, loanLines, totals]);

  // A loan repayment of 0 means "skip this month" — dropped rather than sent
  // as a 0.00 row. The server applies the same rule. The advance is never
  // sent: the server reads it itself.
  const linePayload = () => ({
    earnings: earnings
      .filter(l => l.title.trim() || num(l.amount) !== 0)
      .map(l => ({ title: l.title.trim(), amount: num(l.amount) })),
    deductions: [
      ...deductions
        .filter(l => l.title.trim() || num(l.amount) !== 0)
        .map(l => ({ title: l.title.trim(), amount: num(l.amount) })),
      ...loanLines
        .filter(l => num(l.amount) > 0)
        .map(l => ({ title: l.title, amount: num(l.amount), loan_id: l.loan_id })),
    ],
  });

  // The pending employee after the one being processed, in list order — what
  // "Save & next" moves on to.
  const nextPending = useMemo(() => {
    if (!draft || editingSlipId) return null;
    const index = pending.findIndex(p => p.id === draft.employee.id);
    const rest = pending.filter(p => p.id !== draft.employee.id);
    if (!rest.length) return null;
    return index >= 0 && index < pending.length - 1 ? pending[index + 1] : rest[0];
  }, [draft, editingSlipId, pending]);

  const saveSlip = async ({ andNext = false } = {}) => {
    if (draftProblem) { toast.error(draftProblem); return; }
    setSavingSlip(true);
    try {
      if (editingSlipId) {
        const { data } = await api.put(`/hr/salary-slips/${editingSlipId}`, linePayload());
        toast.success(`Payslip updated for ${draft.employee.name}. Net payable: ${fmtMoney(data.net_pay)}.`);
        refreshMonth();
        setTab('processed');
        leaveDraft();
      } else {
        const next = andNext ? nextPending : null;
        const { data } = await api.post('/hr/salary-slips', {
          employee_id: draft.employee.id,
          month: draft.month,
          ...linePayload(),
        });
        toast.success(`Payslip saved for ${draft.employee.name}. Net payable: ${fmtMoney(data.net_pay)}.`);
        refreshMonth();
        if (next) {
          processEmployee(next.id);
        } else {
          setTab(null);
          leaveDraft();
        }
      }
    } catch (err) {
      toast.error(apiError(err, 'Could not save this payslip.'));
      // A closed run means the list is stale.
      if (err?.response?.data?.code === 'PAYROLL_RUN_COMPLETED') {
        refreshMonth();
        leaveDraft();
      }
    } finally {
      setSavingSlip(false);
    }
  };

  // ── Viewing a slip ───────────────────────────────────────────────────────
  const openIssuedSlip = (slipId) => {
    setView('slip');
    setLoadingSlip(true);
    setOpenSlip(null);
    setEditingSlipId(null);
    api.get(`/hr/salary-slips/${slipId}`)
      .then(r => setOpenSlip(r.data))
      .catch(err => {
        toast.error(apiError(err, 'Could not open this payslip.'));
        setView('list');
      })
      .finally(() => setLoadingSlip(false));
  };

  const printIds = (ids, preview) => {
    if (ids.length === 0) return;
    const query = `ids=${ids.join(',')}${preview ? '&preview=1' : ''}`;
    navigate(`/hr/salary-slips/print?${query}`);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const sortedSlips = useMemo(
    () => sortRows(slips, slipSort.sortConfig, SLIP_COMPARATORS),
    [slips, slipSort.sortConfig]
  );
  const sortedPending = useMemo(
    () => sortRows(pending, pendingSort.sortConfig, PENDING_COMPARATORS),
    [pending, pendingSort.sortConfig]
  );

  const allSelected = slips.length > 0 && selectedIds.length === slips.length;
  const toggleAll = () => setSelectedIds(allSelected ? [] : slips.map(s => s.id));
  const toggleOne = (id) => setSelectedIds(prev => (
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  ));

  const monthOptions = useMemo(() => recentMonths(15).map(m => {
    const r = runs.find(x => x.month === m);
    return {
      value: m,
      label: fmtMonth(m),
      badge: r ? (r.status === 'Open' ? 'Open' : 'Closed') : undefined,
      badgeTone: r && r.status === 'Open' ? 'open' : 'closed',
      badgeIcon: r && r.status !== 'Open' ? 'lock' : undefined,
    };
  }), [runs]);

  const runSummary = () => {
    if (loading) return 'Loading…';
    if (!run) return `Not started · ${plural(roster.eligible, 'employee')} payable`;
    if (runClosed) {
      return [
        `Closed ${fmtStamp(run.completed_at)}${run.completed_by_name ? ` by ${run.completed_by_name}` : ''}`,
        plural(slips.length, 'payslip'),
        `Net payable ${fmtMoney(monthTotals.net)}`,
        `Cost to company ${fmtMoney(run.cost_to_company ?? monthTotals.ctc)}`,
      ].join(' · ');
    }
    return [
      pending.length === 0 && slips.length
        ? `All ${roster.eligible} processed · Ready to close`
        : `${processedCount} of ${roster.eligible} processed`,
      `Net payable ${fmtMoney(monthTotals.net)}`,
    ].join(' · ');
  };

  // ── Line editor ──────────────────────────────────────────────────────────
  // One bordered group with hairline-separated rows rather than a stack of
  // individually bordered inputs — a ten-line payslip stays compact and reads
  // as the table it actually is.
  const renderLines = (side, lines) => (
    <div className="hr-lines">
      <div className="hr-lines-head is-simple">
        <span>{side === 'earnings' ? 'Earning' : 'Deduction'}</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span />
      </div>

      {lines.length === 0 && (
        <div className="hr-lines-empty">
          {side === 'earnings'
            ? 'No salary structure is set up for this employee. Add an earning, or mark the payslip as zero pay.'
            : 'No deductions this month.'}
        </div>
      )}

      {lines.map(line => (
        <div className="hr-line is-simple" key={line.key}>
          <div className="hr-line-cell">
            <label htmlFor={`t-${line.key}`} className="hr-sr-only">Description</label>
            <input
              id={`t-${line.key}`}
              className="form-control"
              placeholder={side === 'earnings' ? 'Earning description' : 'Deduction description'}
              value={line.title}
              maxLength={200}
              onChange={e => updateLine(side, line.key, { title: e.target.value })}
            />
          </div>
          <div className="hr-line-cell">
            <label htmlFor={`a-${line.key}`} className="hr-sr-only">Amount</label>
            <AmountInput
              id={`a-${line.key}`}
              value={line.amount}
              onChange={val => updateLine(side, line.key, { amount: val })}
            />
          </div>
          <div className="hr-line-remove">
            <button
              type="button"
              title={`Remove ${line.title || 'this line'}`}
              aria-label={`Remove ${line.title || 'this line'}`}
              onClick={() => removeLine(side, line.key)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">close</span>
            </button>
          </div>
        </div>
      ))}

      <div className="hr-lines-foot">
        <button className="btn btn-outline btn-sm" onClick={() => addLine(side)}>
          + Add {side === 'earnings' ? 'earning' : 'deduction'}
        </button>
      </div>
    </div>
  );

  // ── Loan repayments ──────────────────────────────────────────────────────
  // Every loan still owed is listed with its own amount, so the operator
  // decides per loan how much comes off this month (0 = skip). The payslip
  // prints them as a single "Loan Deduction" row — the figure in the footer.
  // A loan line's title is generated and bound to the loan it repays, so it is
  // shown, not typed.
  const renderLoans = () => (
    <div className="hr-lines pr-subgroup">
      <div className="hr-lines-head is-simple">
        <span>Loan repayment</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span />
      </div>

      {loanLines.map(line => {
        const owed = num(line.loan_remaining);
        const amount = num(line.amount);
        const overdrawn = amount - owed > 0.005;
        const skipped = amount <= 0;
        return (
          <div className="hr-line is-simple is-loan" key={line.key}>
            <div className="hr-line-cell">
              <div className="hr-line-static">
                <span className="pr-loan-tag">Loan</span>
                <span className="hr-line-static-text" title={line.loan_title}>{line.loan_title}</span>
              </div>
            </div>
            <div className="hr-line-cell">
              <label htmlFor={`a-${line.key}`} className="hr-sr-only">Repayment on {line.loan_title}</label>
              <AmountInput
                id={`a-${line.key}`}
                value={line.amount}
                invalid={overdrawn}
                onChange={val => updateLoanLine(line.key, val)}
              />
            </div>
            <div className="hr-line-remove">
              {/* The same close control as every other line, so the editor
                  has one way to take a line off. A loan is not removed,
                  only skipped for this month (it stays listed at 0, never
                  forgotten), so once skipped the control becomes Undo. */}
              <button
                type="button"
                title={skipped ? 'Restore the full repayment' : 'Skip this month'}
                aria-label={skipped ? `Restore the full repayment of ${line.loan_title}` : `Skip ${line.loan_title} this month`}
                onClick={() => updateLoanLine(line.key, skipped ? String(owed) : '0')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
                  {skipped ? 'undo' : 'close'}
                </span>
              </button>
            </div>
            <div
              className={`hr-line-note ${overdrawn ? 'hr-error' : 'hr-help'}`}
              role={overdrawn ? 'alert' : undefined}
            >
              {overdrawn && <span className="material-symbols-outlined" aria-hidden="true">error</span>}
              <span>
                {overdrawn
                  ? `Exceeds the outstanding balance of ${fmtAmount(owed)}.`
                  : skipped
                    ? `Skipped this month · Outstanding ${fmtAmount(owed)}`
                    : `Outstanding ${fmtAmount(owed)} · After this payslip ${fmtAmount(owed - amount)}`}
              </span>
            </div>
          </div>
        );
      })}

      <div className="pr-lines-total">
        <div>
          <div className="pr-lines-total-label">Loan Deduction</div>
          <div className="hr-help">Total pending loan {fmtAmount(loanLeftAfter)}</div>
        </div>
        <span className="pr-lines-total-value">{fmtAmount(totals.loans)}</span>
      </div>
    </div>
  );

  // ── List: tab bodies ─────────────────────────────────────────────────────
  const renderPending = () => {
    if (pending.length === 0) {
      return (
        <EmptyState
          icon="task_alt"
          title={runOpen ? 'Everyone is processed' : 'Nobody is pending'}
          desc={runOpen
            ? `All ${plural(roster.eligible, 'employee')} payable in ${fmtMonth(month)} ${roster.eligible === 1 ? 'has' : 'have'} a payslip. Review them under Processed, then close the Pay Run.`
            : `Every employee payable in ${fmtMonth(month)} has a payslip.`}
          action={canClose
            ? (
              <button className="btn btn-primary" onClick={openCloseDialog}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">lock</span>
                Close Pay Run
              </button>
            )
            : null}
          small
        />
      );
    }

    return (
      <>
        {runClosed && (
          <div className="pr-note">
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            This run was closed before these employees were processed, so they were not paid in it.
          </div>
        )}
        <div className="att-scroll">
          {/* Every money column has a width sized to its header, so a label
              can never run into its neighbour; the employee column takes
              whatever is left. Below 1180px the table scrolls. */}
          <table className="att-table pr-wide">
            <colgroup>
              <col />
              <col style={{ width: 136 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 148 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 56 }} />
            </colgroup>
            <thead>
              <tr>
                <SortableHeader column="name" label="Employee" {...pendingSort} />
                <SortableHeader column="department_name" label="Department" {...pendingSort} />
                <SortableHeader column="structure_earnings" label="Monthly salary" align="right" {...pendingSort} />
                <th className="is-num" title="Recurring deductions from the salary structure">Deductions</th>
                <SortableHeader column="loan_outstanding" label="Loan balance" align="right" {...pendingSort} />
                <th className="is-num" title="Advance salary paid against this month. Deducted in full.">Advance</th>
                <th className="is-num" title="Monthly salary less deductions, the full loan balance and the advance">Est. net payable</th>
                <th className="is-center"><span className="hr-sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedPending.map(p => {
                const open = () => { if (runOpen) processEmployee(p.id); };
                return (
                  <tr
                    key={p.id}
                    className={runOpen ? 'att-row-click' : undefined}
                    tabIndex={runOpen ? 0 : undefined}
                    onClick={open}
                    onKeyDown={e => { if (runOpen && e.key === 'Enter') { e.preventDefault(); open(); } }}
                    aria-label={runOpen ? `Process ${p.name}'s salary` : undefined}
                  >
                    <td>
                      <div className="att-identity">
                        <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(p.name)}</span>
                        <span className="att-identity-text">
                          <span className="hr-cell-strong">{p.name}</span>
                          <span className="hr-cell-sub">{p.employee_code} · {p.designation_name}</span>
                        </span>
                      </div>
                    </td>
                    <td className="hr-cell-muted">{p.department_name}</td>
                    <td className="is-num">
                      {num(p.structure_earnings) > 0
                        ? fmtAmount(p.structure_earnings)
                        : <span className="pr-warn" title="No salary structure is set up. Add earnings on the payslip or on the employee profile.">Not set up</span>}
                    </td>
                    <td className="is-num">
                      {num(p.structure_deductions) > 0 ? fmtAmount(p.structure_deductions) : <Dash />}
                    </td>
                    <td className="is-num">
                      {num(p.loan_outstanding) > 0 ? fmtAmount(p.loan_outstanding) : <Dash />}
                    </td>
                    <td className="is-num">
                      {num(p.advance_amount) > 0 ? fmtAmount(p.advance_amount) : <Dash />}
                    </td>
                    <td className="is-num pr-net">
                      {num(p.structure_earnings) <= 0
                        ? <Dash />
                        : estNet(p) < 0
                          ? <span className="pr-warn" title="Deductions, the full loan balance and the advance exceed the salary. Reduce a loan repayment on the payslip.">Review</span>
                          : fmtAmount(estNet(p))}
                    </td>
                    {/* The whole row processes the employee (click or
                        Enter); the chevron is its affordance, not a second
                        control, so it is hidden from assistive tech. */}
                    <td className="is-center">
                      {runOpen && (
                        <span className="material-symbols-outlined pr-row-chevron" aria-hidden="true">chevron_right</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total · {plural(pending.length, 'employee')}</td>
                <td className="is-num">{fmtAmount(pendingTotals.earnings)}</td>
                <td className="is-num">{fmtAmount(pendingTotals.deductions)}</td>
                <td className="is-num">{fmtAmount(pendingTotals.loans)}</td>
                <td className="is-num">{fmtAmount(pendingTotals.advance)}</td>
                <td className="is-num">{fmtAmount(pendingTotals.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  };

  const renderProcessed = () => {
    if (slips.length === 0) {
      return (
        <EmptyState
          icon="receipt_long"
          title={`No payslips processed for ${fmtMonth(month)} yet`}
          desc="Each payslip starts from the employee’s salary structure and outstanding loans, and every line can be adjusted before it is saved."
          action={runOpen && pending.length
            ? <button className="btn btn-primary" onClick={() => setTab('pending')}>Go to Pending</button>
            : null}
          small
        />
      );
    }

    return (
      <>
        <div className="att-scroll">
          <table className="att-table pr-wide">
            <colgroup>
              <col style={{ width: 56 }} />
              <col />
              <col style={{ width: 136 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 148 }} />
              <col style={{ width: 72 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="is-center">
                  <input
                    type="checkbox"
                    className="pr-check"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select every payslip"
                  />
                </th>
                <SortableHeader column="employee_name" label="Employee" {...slipSort} />
                <SortableHeader column="department_name" label="Department" {...slipSort} />
                <th className="is-num">Gross</th>
                <th className="is-num" title="Tax, leave and other deductions. Excludes loan repayments.">Deductions</th>
                <th className="is-num" title="Loan repayments. Printed as one Loan Deduction line on the payslip.">Loans</th>
                <th className="is-num" title="Advance salary paid earlier. Deducted from the net salary.">Advance</th>
                <SortableHeader column="net_pay" label="Net payable" align="right" {...slipSort} />
                <th><span className="hr-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedSlips.map(slip => (
                <tr
                  key={slip.id}
                  className="att-row-click"
                  tabIndex={0}
                  onClick={() => openIssuedSlip(slip.id)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openIssuedSlip(slip.id); } }}
                  aria-label={`Open ${slip.employee_name}'s payslip`}
                >
                  <td className="is-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="pr-check"
                      checked={selectedIds.includes(slip.id)}
                      onChange={() => toggleOne(slip.id)}
                      aria-label={`Select ${slip.employee_name}'s payslip`}
                    />
                  </td>
                  <td>
                    <div className="att-identity">
                      <span className="hr-avatar hr-avatar-sm" aria-hidden="true">{initials(slip.employee_name)}</span>
                      <span className="att-identity-text">
                        <span className="hr-cell-strong">{slip.employee_name}</span>
                        <span className="hr-cell-sub">{slip.employee_code} · {slip.designation_name}</span>
                      </span>
                    </div>
                  </td>
                  <td className="hr-cell-muted">{slip.department_name}</td>
                  <td className="is-num">{fmtAmount(slip.total_earnings)}</td>
                  <td className={`is-num${num(slip.other_deductions) ? '' : ' att-muted-num'}`}>{fmtAmount(slip.other_deductions)}</td>
                  <td className={`is-num${num(slip.loan_recoveries) ? '' : ' att-muted-num'}`}>{fmtAmount(slip.loan_recoveries)}</td>
                  <td className={`is-num${num(slip.advance_amount) ? '' : ' att-muted-num'}`}>{fmtAmount(slip.advance_amount)}</td>
                  <td className="is-num pr-net">
                    {/* Net payable 0 has two meanings: a zero-pay payslip
                        (no earnings), or a salary fully paid in advance. */}
                    {num(slip.total_earnings) === 0
                      ? <span title="Zero-pay payslip">{fmtAmount(0)} <span className="pr-zero">not paid</span></span>
                      : num(slip.net_pay) === 0 && num(slip.advance_amount) > 0
                        ? <span title="The whole net salary was paid as an advance">{fmtAmount(0)} <span className="pr-zero">paid in advance</span></span>
                        : fmtAmount(slip.net_pay)}
                  </td>
                  <td className="is-center att-kebab-cell" onClick={e => e.stopPropagation()}>
                    <KebabMenu
                      label={`Actions for ${slip.employee_name}'s payslip`}
                      items={[
                        // Amending exists only while the run is open. Once
                        // closed the action is gone, not disabled.
                        ...(runOpen ? [{ label: 'Edit payslip', icon: 'edit', onClick: () => startEdit(slip.id) }] : []),
                        { label: 'Print', icon: 'print', onClick: () => printIds([slip.id], true) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td colSpan={2}>Total · {plural(slips.length, 'payslip')}</td>
                <td className="is-num">{fmtAmount(monthTotals.earnings)}</td>
                <td className="is-num">{fmtAmount(monthTotals.other)}</td>
                <td className="is-num">{fmtAmount(monthTotals.loans)}</td>
                <td className="is-num">{fmtAmount(monthTotals.advance)}</td>
                <td className="is-num">{fmtAmount(monthTotals.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  };

  const attendance = draft?.attendance;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Layout title="Payroll">
      <HrStyles />
      {/* The document CSS is embedded here too, so the on-screen preview is
          rendered by exactly the same rules as the printed page. */}
      <style dangerouslySetInnerHTML={{ __html: SLIP_STYLES }} />

      {/* ══ LIST ══════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <div className="card">
          <div className="att-bar">
            <div className="att-bar-group">
              <Select
                id="slip-month"
                ariaLabel="Pay period"
                value={month}
                onChange={setMonth}
                options={monthOptions}
                minWidth={200}
              />
              <span className="att-meta" aria-live="polite">{runSummary()}</span>
            </div>
            {runOpen && (
              <span title={closeBlockedReason}>
                <button
                  className={`btn ${canClose ? 'btn-primary' : 'btn-outline'}`}
                  onClick={openCloseDialog}
                  disabled={!canClose || loading}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">lock</span>
                  Close Pay Run
                </button>
              </span>
            )}
            {runClosed && (
              <span className="pr-closed-tag">
                <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                Closed
              </span>
            )}
          </div>

          {loading ? (
            <TableSkeleton columns={6} rows={6} />
          ) : loadError ? (
            <EmptyState
              icon="cloud_off"
              title="Could not load payroll"
              desc={loadError}
              action={<button className="btn btn-outline" onClick={refreshMonth}>Try again</button>}
            />
          ) : !run ? (
            <EmptyState
              icon="event_upcoming"
              title={`${fmtMonth(month)} Pay Run has not started`}
              desc={roster.eligible
                ? `${plural(roster.eligible, 'employee')} ${roster.eligible === 1 ? 'is' : 'are'} payable in ${fmtMonth(month)}. Start the Pay Run to process their salaries.`
                : `Nobody was employed during ${fmtMonth(month)}, so there is no one to pay.`}
              action={roster.eligible
                ? (
                  <BusyButton busy={starting} busyLabel="Starting…" icon="play_arrow" onClick={startRun}>
                    Start Pay Run
                  </BusyButton>
                )
                : <Link className="btn btn-outline" to="/hr/employees">Go to Workforce</Link>}
            />
          ) : (
            <>
              <div className="pr-tabs" role="tablist" aria-label="Payslips">
                <button
                  role="tab"
                  aria-selected={activeTab === 'pending'}
                  className={`pr-tab${activeTab === 'pending' ? ' is-active' : ''}`}
                  onClick={() => setTab('pending')}
                >
                  Pending <span className="pr-tab-count">{pending.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'processed'}
                  className={`pr-tab${activeTab === 'processed' ? ' is-active' : ''}`}
                  onClick={() => setTab('processed')}
                >
                  Processed <span className="pr-tab-count">{slips.length}</span>
                </button>
                {activeTab === 'processed' && slips.length > 0 && (
                  <div className="pr-tabs-actions">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => printIds(selectedIds, true)}
                      disabled={!selectedIds.length}
                      title={selectedIds.length ? undefined : 'Tick payslips to print only those'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">print</span>
                      Print selected{selectedIds.length ? ` (${selectedIds.length})` : ''}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => printIds(slips.map(s => s.id), true)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">print</span>
                      Print all
                    </button>
                  </div>
                )}
              </div>
              {activeTab === 'pending' ? renderPending() : renderProcessed()}
            </>
          )}
        </div>
      )}

      {/* ══ DRAFT / EDIT ══════════════════════════════════════════════ */}
      {view === 'draft' && (
        <>
          <div className="card hr-section">
            <div className="att-bar">
              <div className="att-bar-group is-tight">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={leaveDraft}
                  aria-label="Back to the Pay Run"
                  title="Back to the Pay Run"
                  disabled={savingSlip}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">arrow_back</span>
                </button>
                <div>
                  <div className="att-title">
                    {draft
                      ? `${editingSlipId ? 'Edit payslip' : 'Process salary'} — ${draft.employee.name}`
                      : 'Preparing payslip…'}
                  </div>
                  <div className="att-meta">
                    {draft
                      ? [draft.employee.employee_id, draft.employee.designation_name, draft.employee.department_name, fmtMonth(draft.month)]
                        .filter(Boolean).join(' · ')
                      : fmtMonth(month)}
                  </div>
                </div>
              </div>
              {draft && !editingSlipId && (
                <KebabMenu
                  label="Payslip actions"
                  items={[
                    {
                      label: 'Reset to salary structure',
                      icon: 'refresh',
                      onClick: () => processEmployee(draft.employee.id),
                    },
                    {
                      label: 'Mark as zero pay…',
                      icon: 'money_off',
                      onClick: () => { setZeroReason(''); setZeroOpen(true); },
                    },
                  ]}
                />
              )}
            </div>

            {/* Context, above the work: what the month says about this person.
                Both are read-only, so they sit before the payslip rather than
                interrupting the run from earnings to Save. */}
            {draft && !generating && (!!attendance || !!draft.employee.is_field_employee) && (
              <div className="pr-context">
                {attendance && (
                  <div className="pr-context-row">
                    <span className="pr-context-label">Attendance · {fmtMonthShort(draft.month)}</span>
                    <div className="att-kpi">
                      <span className="att-kpi-value">{attendance.present}</span>
                      <span className="att-kpi-label">Present</span>
                    </div>
                    <div className="att-kpi">
                      <span className="att-kpi-value">{attendance.absent}</span>
                      <span className="att-kpi-label">Absent</span>
                    </div>
                    <div className="att-kpi">
                      <span className="att-kpi-value">{attendance.unmarked}</span>
                      <span className="att-kpi-label">Not marked</span>
                    </div>
                  </div>
                )}

                {!!draft.employee.is_field_employee && (() => {
                  const achieved = draft.target_achieved;
                  const target = num(draft.target_amount);
                  if (achieved === null || achieved === undefined) {
                    return (
                      <div className="pr-context-row">
                        <span className="pr-context-label">Sales target · {fmtMonthShort(draft.month)}</span>
                        <span className="att-meta">{draft.target_reason || 'Achievement cannot be calculated for this employee'}</span>
                      </div>
                    );
                  }
                  const done = target > 0 ? (num(achieved) / target) * 100 : null;
                  const met = done !== null && done >= 100;
                  return (
                    <div className="pr-context-row">
                      <span className="pr-context-label">Sales target · {fmtMonthShort(draft.month)}</span>
                      <span className="pr-target-figure">{fmtMoney(achieved)}</span>
                      <span className="att-meta">
                        of {target > 0 ? fmtMoney(target) : 'no target set'}
                      </span>
                      {done !== null && (
                        <>
                          <span className={`pr-target-chip${met ? ' is-met' : ''}`}>
                            {met ? 'Target met' : `${Math.round(done)}%`}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {generating || !draft ? (
              <div className="card-body">
                <div className="hr-skel hr-skel-title" style={{ width: 216, marginBottom: 16 }} />
                {[80, 64, 72, 56].map((w, i) => (
                  <div key={i} className="hr-skel hr-skel-text" style={{ width: `${w}%`, marginBottom: 16 }} />
                ))}
              </div>
            ) : (
              <div className="card-body">
                {/* Two columns, as on the printed payslip: earnings left,
                    deductions right. Stacks below 1200px. */}
                <div className="pr-lines-2col">
                  <section>
                    <h3 className="pr-h3">Earnings</h3>
                    {renderLines('earnings', earnings)}
                  </section>
                  <section>
                    <h3 className="pr-h3">Deductions</h3>
                    {renderLines('deductions', deductions)}
                    {loanLines.length > 0 && renderLoans()}
                  </section>
                </div>

                {draftProblem && (
                  <Notice tone="danger" title="This payslip cannot be saved yet" style={{ marginTop: 16 }}>
                    {draftProblem}
                  </Notice>
                )}
              </div>
            )}
          </div>

          {draft && !generating && (
            /* Figures and the save action travel together, pinned to the
               bottom of the viewport: on a long payslip the net payable and
               the way out were both below the fold. */
            <div className="pr-actionbar">
              {/* One figure carries the bar — the amount that will be paid —
                  with the components that produced it as its caption. The
                  earlier version spelled the sum out with − and = signs,
                  which read as a calculator rather than a payslip. */}
              <div className="pr-actionbar-figs">
                <div className="pr-netline">
                  <span className="pr-netline-label">Net payable</span>
                  <span className={`pr-netline-value${totals.net < 0 ? ' is-negative' : ''}`}>
                    <span className="pr-netline-ccy">PKR</span>{fmtAmount(totals.net)}
                  </span>
                </div>
                <div className="pr-breakdown">
                  <span><span className="pr-breakdown-label">Gross</span>{fmtAmount(totals.earnings)}</span>
                  <span><span className="pr-breakdown-label">Deductions</span>{fmtAmount(totals.other)}</span>
                  <span><span className="pr-breakdown-label">Loan deduction</span>{fmtAmount(totals.loans)}</span>
                  <span><span className="pr-breakdown-label">Net salary</span>{fmtAmount(totals.netSalary)}</span>
                  {totals.advance > 0 && (
                    /* The advance is fixed (recorded on the profile, always
                       deducted in full), so the payslip carries one figure;
                       the entries behind it are one hover or click away
                       rather than a section the operator must read past. */
                    <span>
                      <span className="pr-breakdown-label">Advance salary</span>
                      {fmtAmount(totals.advance)}
                      <InfoPopover
                        label="Advance salary details"
                        title={`Advance salary · ${fmtMonth(draft.month)}`}
                      >
                        <div className="hr-pop-list">
                          {(draft.advances || []).map(advance => (
                            <div className="hr-pop-row" key={advance.id}>
                              <span className="hr-pop-date">{fmtDate(advance.date_given)}</span>
                              <span className="hr-pop-note">{advance.note || 'Advance salary'}</span>
                              <span className="hr-pop-amt">{fmtAmount(advance.amount)}</span>
                            </div>
                          ))}
                          <div className="hr-pop-row is-total">
                            <span className="hr-pop-note">Total</span>
                            <span className="hr-pop-amt">{fmtAmount(totals.advance)}</span>
                          </div>
                        </div>
                      </InfoPopover>
                    </span>
                  )}
                </div>
              </div>
              <div className="pr-actionbar-actions">
                <button className="btn btn-outline" onClick={leaveDraft} disabled={savingSlip}>
                  Cancel
                </button>
                {editingSlipId ? (
                  <BusyButton busy={savingSlip} busyLabel="Saving…" icon="check" onClick={() => saveSlip()} disabled={!!draftProblem}>
                    Save changes
                  </BusyButton>
                ) : nextPending ? (
                  <>
                    <BusyButton
                      className="btn btn-outline"
                      busy={savingSlip}
                      busyLabel="Saving…"
                      onClick={() => saveSlip()}
                      disabled={!!draftProblem}
                    >
                      Save
                    </BusyButton>
                    <BusyButton
                      busy={savingSlip}
                      busyLabel="Saving…"
                      icon="arrow_forward"
                      onClick={() => saveSlip({ andNext: true })}
                      disabled={!!draftProblem}
                      title={`Save, then process ${nextPending.name}`}
                    >
                      Save &amp; next
                    </BusyButton>
                  </>
                ) : (
                  <BusyButton busy={savingSlip} busyLabel="Saving…" icon="check" onClick={() => saveSlip()} disabled={!!draftProblem}>
                    Save payslip
                  </BusyButton>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ ONE SLIP ══════════════════════════════════════════════════ */}
      {view === 'slip' && (
        <div className="card hr-page-enter">
          <div className="att-bar">
            <div className="att-bar-group is-tight">
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => { setView('list'); setOpenSlip(null); }}
                aria-label="Back to the Pay Run"
                title="Back to the Pay Run"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">arrow_back</span>
              </button>
              <div>
                <div className="att-title">
                  {loadingSlip || !openSlip ? 'Loading payslip…' : `${openSlip.employee_name} — ${fmtMonth(openSlip.month)}`}
                </div>
                <div className="att-meta">
                  {openSlip
                    ? [
                      `Net payable ${fmtMoney(openSlip.net_pay)}`,
                      openSlip.is_editable ? null : 'Pay Run closed',
                    ].filter(Boolean).join(' · ')
                    : ' '}
                </div>
              </div>
            </div>
            {openSlip && (
              <div className="att-bar-group is-tight">
                {openSlip.is_editable && (
                  <button className="btn btn-outline" onClick={() => startEdit(openSlip.id)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">edit</span>
                    Edit
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => printIds([openSlip.id], false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">print</span>
                  Print
                </button>
              </div>
            )}
          </div>

          <div className="card-body">
            <div className="hr-preview-desk">
              {loadingSlip || !openSlip ? (
                <div className="hr-skel" style={{ width: '210mm', height: 420, maxWidth: '100%' }} />
              ) : (
                <div className="hr-preview-scale">
                  <SalarySlipDocument slip={openSlip} company={company} printedAt={null} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ ZERO PAY ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={zeroOpen}
        onClose={() => setZeroOpen(false)}
        title="Zero pay this month"
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setZeroOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyZeroPay} disabled={!zeroReason.trim() || advanceAmount > 0}>
              Apply
            </button>
          </>
        }
      >
        <form onSubmit={e => { e.preventDefault(); applyZeroPay(); }}>
          {advanceAmount > 0 && (
            /* Zero pay would leave the advance unrecovered and the net
               payable negative, which the server refuses. Said up front
               rather than after a failed save. */
            <Notice tone="danger" title="Zero pay is not available" style={{ marginBottom: 16 }}>
              {draft?.employee.name} received an advance salary of {fmtMoney(advanceAmount)} for
              {' '}{fmtMonth(draft?.month || month)}. It must be recovered from this payslip, so the
              payslip needs earnings of at least that amount.
            </Notice>
          )}
          <p className="hr-help" style={{ fontSize: 13, marginBottom: 16 }}>
            {draft?.employee.name} will still receive a payslip for {fmtMonth(month)} with a net
            payable of zero and the reason printed on it. Deductions and loan repayments are
            removed, because nothing is recovered from a salary that is not paid.
          </p>
          <label className="form-label" htmlFor="zero-reason">
            Reason<span className="hr-required" aria-hidden="true">*</span>
          </label>
          <input
            id="zero-reason"
            className="form-control"
            placeholder="Enter the reason"
            value={zeroReason}
            maxLength={120}
            autoFocus
            onChange={e => setZeroReason(e.target.value)}
          />
        </form>
      </Modal>

      {/* ══ CLOSE PAY RUN ═════════════════════════════════════════════ */}
      <Modal
        isOpen={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title={`Close ${fmtMonth(month)} Pay Run`}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setCompleteOpen(false)} disabled={completing}>
              Cancel
            </button>
            <BusyButton busy={completing} busyLabel="Closing…" icon="lock" onClick={closeRun} disabled={closeCtcInvalid}>
              Close Pay Run
            </BusyButton>
          </>
        }
      >
        {/* One consequence per line: what cannot be undone, then what it does. */}
        <div className="pr-alert">
          <span className="pr-alert-icon" aria-hidden="true">
            <span className="material-symbols-outlined">warning</span>
          </span>
          <div>
            <div className="pr-alert-title">This cannot be undone.</div>
            <div className="pr-alert-text">
              All {plural(slips.length, 'payslip')} become permanently read-only.
            </div>
          </div>
        </div>

        <table className="pr-close-summary">
          <tbody>
            <tr><td>Employees processed</td><td>{slips.length} of {roster.eligible}</td></tr>
            <tr><td>Gross earnings</td><td>{fmtMoney(monthTotals.earnings)}</td></tr>
            <tr><td>Deductions</td><td>− {fmtMoney(monthTotals.other)}</td></tr>
            <tr><td>Loan repayments</td><td>− {fmtMoney(monthTotals.loans)}</td></tr>
            <tr className="is-sub"><td>Net salary</td><td>{fmtMoney(monthTotals.netSalary)}</td></tr>
            <tr><td>Advance salary</td><td>− {fmtMoney(monthTotals.advance)}</td></tr>
            <tr className="is-net"><td>Net payable</td><td>{fmtMoney(monthTotals.net)}</td></tr>
          </tbody>
        </table>

        {/* The month's Cost to Company, recorded on the Pay Run as it closes.
            Shown as a figure with an icon action to edit it; the value and the
            field share one 40px slot, so the dialog never changes shape. */}
        <div className="pr-close-ctc">
          <div className="pr-ctc-head">
            <label className="pr-ctc-label" htmlFor={ctcEditing ? 'close-ctc' : undefined}>
              Cost to company
            </label>
            <button
              type="button"
              className={`pr-icon-btn${ctcEditing ? ' is-active' : ''}`}
              onClick={() => setCtcEditing(v => !v)}
              disabled={ctcEditing && closeCtcInvalid}
              aria-pressed={ctcEditing}
              aria-label={ctcEditing ? 'Done editing cost to company' : 'Edit cost to company'}
              title={ctcEditing ? 'Done' : 'Edit'}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{ctcEditing ? 'check' : 'edit'}</span>
            </button>
          </div>

          {ctcEditing ? (
            <div className={`pr-field${closeCtcInvalid ? ' is-invalid' : ''}`}>
              <span className="pr-field-prefix" aria-hidden="true">PKR</span>
              <input
                id="close-ctc"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="no-spinner"
                value={closeCtc ?? ''}
                autoFocus
                aria-invalid={closeCtcInvalid}
                aria-describedby="close-ctc-note"
                onWheel={blockWheelChange}
                onFocus={e => e.target.select()}
                onKeyDown={e => { if (e.key === 'Enter' && !closeCtcInvalid) { e.preventDefault(); setCtcEditing(false); } }}
                onChange={e => setCloseCtc(e.target.value)}
              />
            </div>
          ) : (
            <div className="pr-ctc-value">{fmtMoney(recordedCtc)}</div>
          )}

          <div className="pr-ctc-note" id="close-ctc-note">
            {closeCtcInvalid ? (
              <span className="pr-field-error">Enter an amount of zero or more.</span>
            ) : closeCtcEdited ? (
              <>
                Edited · Calculated {fmtMoney(monthTotals.ctc)}
                {' '}({recordedCtc > monthTotals.ctc ? '+' : '−'}{fmtAmount(Math.abs(recordedCtc - monthTotals.ctc))})
                <button type="button" className="pr-reset" onClick={() => setCloseCtc(String(monthTotals.ctc))}>
                  Reset
                </button>
              </>
            ) : (
              'Gross earnings less deductions. Loan repayments and advance salary do not reduce it.'
            )}
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCNIC, handleCNICInput, handlePhoneInput, formatPhone } from '../../utils/formatters';
import { todayPKT, addMonthsPKT } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';
import {
  HrStyles, Panel, Tabs, TabPanel, FieldGrid, Field, FormField, Pill, BusyButton,
  StatusBadge, KebabMenu, EmptyState, FieldGridSkeleton, SearchSelect,
  fmtMoney, fmtAmount, fmtDate, fmtMonth, num, money, initials,
  apiError, apiFieldError, blockWheelChange, ibanError, accountNumberError,
} from './HrKit';

// ─── Employee profile ──────────────────────────────────────────────────────
// The app's first route-based detail page. Deliberately NOT a modal: the
// record is deep (identity, employment, compensation, loans, banking) and
// deserves its own URL so it can be linked, bookmarked and reloaded.
//
// ONE edit mode, ONE save. Entering Edit makes identity, employment,
// compensation and banking editable together, and "Save changes" commits all
// of them. The three sub-endpoints are an implementation detail — a section
// with its own private Save button next to a global Save button leaves the
// user guessing which one owns their change.
//
// Recording a loan stays a separate action, because issuing a loan is an event
// with its own date and amount, not an attribute of the employee.
//
// Information hierarchy follows how an HR person thinks about a person, split
// across three tabs rather than six stacked accordions:
//   General Info (Identity + Employment)
//   Compensation & Loans
//   Banking & Payslips
// Edit mode spans all three, so a validation failure on a tab the user cannot
// currently see moves them to that tab (see blockedTab / tabAlerts below);
// otherwise Save would refuse with nothing visibly wrong on screen.
//
// Employee ID appears once, in the header, as a locked chip. There is no input
// for it anywhere: it is generated at creation and is permanently immutable.

const LEAVING_WINDOW_MONTHS = 3;
const GENDERS = ['Male', 'Female', 'Other'];

// The two halves of a salary structure. Everything that differs between the
// Earnings and Deductions columns is declared once here, so the two sides
// cannot drift apart in wording, order or behaviour.
const SALARY_SIDES = [
  {
    type: 'Earning',
    deduction: false,
    label: 'Earnings',
    totalLabel: 'Gross earnings',
    placeholder: 'Basic salary, allowance\u2026',
    empty: 'No earnings yet \u2014 use Add.',
    none: 'No recurring earnings.',
  },
  {
    type: 'Deduction',
    deduction: true,
    label: 'Deductions',
    totalLabel: 'Total deductions',
    placeholder: 'Income tax, fund\u2026',
    empty: 'No deductions yet \u2014 use Add.',
    none: 'No recurring deductions.',
  },
];

const TABS = [
  { value: 'general', label: 'General Info',         icon: 'badge' },
  { value: 'pay',     label: 'Compensation & Loans', icon: 'payments' },
  { value: 'banking', label: 'Banking & Payslips',   icon: 'account_balance' },
];

// Which tab owns each validated field. Everything not listed lives on General.
const BANKING_FIELDS = ['account_number', 'iban'];
const GENERAL_FIELDS = [
  'name', 'mobile', 'date_of_joining', 'department_id', 'designation_id',
  'cnic', 'email', 'date_of_leaving', 'reason_for_leaving',
];
const tabForField = (key) => (BANKING_FIELDS.includes(key) ? 'banking' : 'general');

function toEditForm(employee) {
  return {
    name:                 employee.name || '',
    father_name:          employee.father_name || '',
    cnic:                 employee.cnic || '',
    date_of_birth:        employee.date_of_birth || '',
    gender:               employee.gender || '',
    email:                employee.email || '',
    mobile:               employee.mobile || '',
    alternate_mobile:     employee.alternate_mobile || '',
    address:              employee.address || '',
    city_id:              employee.city_id ? String(employee.city_id) : '',
    date_of_joining:      employee.date_of_joining || '',
    department_id:        employee.department_id ? String(employee.department_id) : '',
    designation_id:       employee.designation_id ? String(employee.designation_id) : '',
    status:               employee.status || 'Active',
    reporting_manager_id: employee.reporting_manager_id ? String(employee.reporting_manager_id) : '',
    date_of_leaving:      employee.date_of_leaving || '',
    reason_for_leaving:   employee.reason_for_leaving || '',
    is_field_employee:    !!employee.is_field_employee,
    master_employee_id:   employee.master_employee_id ? String(employee.master_employee_id) : '',
    bank_name:            employee.bank_name || '',
    account_title:        employee.account_title || '',
    account_number:       employee.account_number || '',
    iban:                 employee.iban || '',
  };
}

// The figure the whole panel builds towards. Spans the full width under both
// columns because it belongs to neither of them.
function NetPayBanner({ value }) {
  return (
    <div className="hr-netbar">
      <div>
        <div className="hr-netbar-label">Net monthly pay</div>
        <div className="hr-netbar-note">Gross earnings less total deductions</div>
      </div>
      <div className="hr-netbar-value">{fmtAmount(value)}</div>
    </div>
  );
}

const toComponentRows = (rows) => (rows || []).map(c => ({
  key: `c${c.id}`, type: c.type, title: c.title, amount: String(num(c.amount)),
}));

export default function HrEmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [tab, setTab] = useState('general');
  const [editing, setEditing] = useState(!!location.state?.edit);
  const [form, setForm]       = useState(null);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving]   = useState(false);

  const [lookups, setLookups] = useState({ departments: [], designations: [], cities: [], managers: [], masters: [] });

  // Compensation lives inside the same edit mode as the rest of the profile.
  const [components, setComponents] = useState([]);
  const [targetInput, setTargetInput] = useState('');

  // New loan — an event, so it keeps its own small form and action.
  const [loanFormOpen, setLoanFormOpen] = useState(false);
  const [loanForm, setLoanForm] = useState({ title: '', principal_amount: '', date_issued: '' });
  const [loanTouched, setLoanTouched] = useState({});
  const [loanErrors, setLoanErrors] = useState({});
  const [savingLoan, setSavingLoan] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────
  const applyRecord = useCallback((record) => {
    setEmployee(record);
    setForm(toEditForm(record));
    setComponents(toComponentRows(record.salary_components));
    setTargetInput(record.sales_target === null ? '' : String(num(record.sales_target)));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get(`/hr/employees/${id}`)
      .then(r => applyRecord(r.data))
      .catch(err => setLoadError(apiError(err, 'Could not load this employee.')))
      .finally(() => setLoading(false));
  }, [id, applyRecord]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.get('/departments').catch(() => ({ data: [] })),
      api.get('/designations').catch(() => ({ data: [] })),
      api.get('/geography/cities').catch(() => ({ data: [] })),
      api.get('/hr/employees', { params: { status: 'all' } }).catch(() => ({ data: [] })),
      api.get('/employees').catch(() => ({ data: [] })),
    ]).then(([dep, des, cities, roster, masters]) => {
      setLookups({
        departments: dep.data,
        designations: des.data,
        cities: cities.data,
        managers: roster.data.filter(e => String(e.id) !== String(id)),
        masters: masters.data,
      });
    });
  }, [id]);

  // ── Validation (mirrors routes/hrEmployees.js) ───────────────────────────
  const today = todayPKT();
  const oldestLeaving = addMonthsPKT(today, -LEAVING_WINDOW_MONTHS);
  // The date window applies only to a leaving date being set or changed, so an
  // employee who left long ago never becomes un-editable.
  const storedLeaving = employee?.date_of_leaving || null;

  const validation = useMemo(() => {
    if (!form) return {};
    const cnicDigits = form.cnic.replace(/\D/g, '');
    const errors = {
      name:            !form.name.trim() ? 'A name is required' : null,
      mobile:          !form.mobile.trim() ? 'A mobile number is required' : null,
      date_of_joining: !form.date_of_joining ? 'A date of joining is required' : null,
      department_id:   !form.department_id ? 'Choose a department' : null,
      designation_id:  !form.designation_id ? 'Choose a designation' : null,
      cnic: cnicDigits.length > 0 && cnicDigits.length !== 13
        ? `CNIC needs 13 digits — ${13 - cnicDigits.length} to go`
        : null,
      email: form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
        ? 'Enter a valid email address'
        : null,
      account_number: accountNumberError(form.account_number),
      iban: ibanError(form.iban),
      date_of_leaving: null,
      reason_for_leaving: null,
    };

    if (form.status === 'Inactive') {
      if (!form.date_of_leaving) {
        errors.date_of_leaving = 'A date of leaving is required to make someone inactive';
      } else if (form.date_of_joining && form.date_of_leaving < form.date_of_joining) {
        errors.date_of_leaving = `Cannot be before the date of joining (${form.date_of_joining})`;
      } else if (form.date_of_leaving !== storedLeaving) {
        if (form.date_of_leaving > today) {
          errors.date_of_leaving = 'Cannot be in the future — deactivate once the employee has actually left';
        } else if (form.date_of_leaving < oldestLeaving) {
          errors.date_of_leaving = `Cannot be backdated more than ${LEAVING_WINDOW_MONTHS} months`;
        }
      }
      if (!form.reason_for_leaving.trim()) {
        errors.reason_for_leaving = 'Record why this employee is leaving';
      }
    }
    return errors;
  }, [form, oldestLeaving, today, storedLeaving]);

  const componentTotals = useMemo(() => {
    const earnings = components.filter(c => c.type === 'Earning').reduce((s, c) => s + num(c.amount), 0);
    const deductions = components.filter(c => c.type === 'Deduction').reduce((s, c) => s + num(c.amount), 0);
    return { earnings: money(earnings), deductions: money(deductions), net: money(earnings - deductions) };
  }, [components]);

  const componentProblem = useMemo(() => {
    if (components.some(c => !c.title.trim())) return 'Every salary line needs a title.';
    if (components.some(c => num(c.amount) < 0)) return 'Salary amounts cannot be negative.';
    if (componentTotals.net < 0) return 'Deductions exceed earnings, which would leave a negative monthly salary.';
    return null;
  }, [components, componentTotals]);

  const targetProblem = num(targetInput) < 0 ? 'A sales target cannot be negative.' : null;

  const profileBlocked = Object.values(validation).some(Boolean) || !!componentProblem || !!targetProblem;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? validation[key] : null);

  // The tab a blocked save should jump to. Object key order puts the General
  // fields ahead of the Banking ones, so the earliest problem in reading order
  // wins.
  const blockedTab = useMemo(() => {
    const failed = Object.keys(validation).find(key => validation[key]);
    if (failed) return tabForField(failed);
    if (componentProblem || targetProblem) return 'pay';
    return null;
  }, [validation, componentProblem, targetProblem]);

  // A dot on any tab holding an error the user has already been shown, so a
  // problem never hides behind an unselected tab.
  const tabAlerts = useMemo(() => {
    if (!editing) return {};
    const shown = (key) => !!(serverErrors[key] || (touched[key] ? validation[key] : null));
    return {
      general: GENERAL_FIELDS.some(shown),
      pay:     !!(componentProblem || targetProblem),
      banking: BANKING_FIELDS.some(shown),
    };
  }, [editing, serverErrors, touched, validation, componentProblem, targetProblem]);

  const setField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setServerErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };
  const markTouched = (key) => setTouched(prev => ({ ...prev, [key]: true }));

  const startEdit = () => {
    applyRecord(employee);
    setTouched({});
    setServerErrors({});
    setEditing(true);
  };

  // Deactivating or reactivating is offered as a named action rather than
  // leaving the operator to find the status dropdown, but it still runs
  // through the ordinary edit + Save, because going Inactive also requires a
  // leaving date and a reason and those are validated together.
  const beginStatusChange = (nextStatus) => {
    startEdit();
    setForm(prev => ({
      ...prev,
      status: nextStatus,
      // Seed today so the required date is present and inside the backdating
      // window; the operator can still change it before saving.
      date_of_leaving: nextStatus === 'Inactive' && !prev.date_of_leaving
        ? todayPKT()
        : prev.date_of_leaving,
    }));
    setTab('general');
  };

  const cancelEdit = () => {
    applyRecord(employee);
    setTouched({});
    setServerErrors({});
    setEditing(false);
    if (location.state?.edit) navigate(location.pathname, { replace: true });
  };

  // ── Single save for the whole profile ────────────────────────────────────
  // Three endpoints, one user action. They run in sequence and stop at the
  // first failure, so a rejected profile never leaves the salary structure
  // half-applied.
  const componentsDirty = useMemo(() => (
    JSON.stringify(components.map(c => [c.type, c.title.trim(), num(c.amount)]))
      !== JSON.stringify(toComponentRows(employee?.salary_components).map(c => [c.type, c.title.trim(), num(c.amount)]))
  ), [components, employee]);

  const targetDirty = employee
    ? String(num(targetInput)) !== String(num(employee.sales_target))
    : false;

  const saveProfile = async () => {
    setTouched(Object.keys(validation).reduce((acc, k) => ({ ...acc, [k]: true }), {}));
    if (profileBlocked) {
      // Move to the tab that is actually blocking the save first: refusing to
      // save while the offending field is on an unselected tab is a dead end.
      if (blockedTab) setTab(blockedTab);
      toast.error(componentProblem || targetProblem || 'Some fields still need attention — they are marked in red.');
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      // employee_id is never sent: it is system-generated and the server
      // rejects any attempt to change it.
      await api.put(`/hr/employees/${id}`, {
        ...form,
        city_id:              form.city_id || null,
        reporting_manager_id: form.reporting_manager_id || null,
        master_employee_id:   form.master_employee_id || null,
        date_of_birth:        form.date_of_birth || null,
        date_of_leaving:      form.status === 'Inactive' ? form.date_of_leaving : null,
        reason_for_leaving:   form.status === 'Inactive' ? form.reason_for_leaving.trim() : null,
      });

      if (componentsDirty) {
        await api.put(`/hr/employees/${id}/salary-components`, {
          components: components.map(c => ({ type: c.type, title: c.title.trim(), amount: num(c.amount) })),
        });
      }

      // The target endpoint only accepts field employees, so it is skipped
      // when the checkbox was just turned off.
      if (targetDirty && form.is_field_employee) {
        await api.put(`/hr/employees/${id}/sales-target`, { target_amount: num(targetInput) });
      }

      toast.success('Profile saved');
      setEditing(false);
      if (location.state?.edit) navigate(location.pathname, { replace: true });
      load();
    } catch (err) {
      const mapped = apiFieldError(err);
      if (mapped) {
        setServerErrors(mapped);
        setTab(tabForField(Object.keys(mapped)[0]));
        toast.error(Object.values(mapped)[0]);
      } else {
        toast.error(apiError(err, 'Could not save this profile.'));
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Salary structure rows ────────────────────────────────────────────────
  const addComponent = (type) => setComponents(prev => [
    ...prev, { key: `n${Date.now()}${prev.length}`, type, title: '', amount: '' },
  ]);
  const updateComponent = (key, patch) => setComponents(prev => (
    prev.map(c => (c.key === key ? { ...c, ...patch } : c))
  ));
  const removeComponent = (key) => setComponents(prev => prev.filter(c => c.key !== key));

  // ── Loans ────────────────────────────────────────────────────────────────
  const openLoanForm = () => {
    setLoanForm({ title: '', principal_amount: '', date_issued: todayPKT() });
    setLoanTouched({});
    setLoanErrors({});
    setLoanFormOpen(true);
  };

  const loanValidation = {
    title: !loanForm.title.trim() ? 'Give the loan a reference' : null,
    principal_amount: num(loanForm.principal_amount) <= 0 ? 'Enter an amount greater than zero' : null,
    date_issued: !loanForm.date_issued ? 'Pick the date the money was issued' : null,
  };
  const loanBlocked = Object.values(loanValidation).some(Boolean);
  const loanErrorFor = (key) => loanErrors[key] || (loanTouched[key] ? loanValidation[key] : null);

  const saveLoan = async () => {
    setLoanTouched({ title: true, principal_amount: true, date_issued: true });
    if (loanBlocked) return;
    setSavingLoan(true);
    setLoanErrors({});
    try {
      await api.post(`/hr/employees/${id}/loans`, {
        title: loanForm.title.trim(),
        principal_amount: num(loanForm.principal_amount),
        date_issued: loanForm.date_issued,
      });
      toast.success('Loan recorded');
      setLoanFormOpen(false);
      load();
    } catch (err) {
      const mapped = apiFieldError(err);
      if (mapped) setLoanErrors(mapped);
      else toast.error(apiError(err, 'Could not record this loan.'));
    } finally {
      setSavingLoan(false);
    }
  };

  const loanTotals = useMemo(() => {
    const loans = employee?.loans || [];
    return {
      count: loans.length,
      outstanding: money(loans.reduce((s, l) => s + num(l.remaining_balance), 0)),
      openCount: loans.filter(l => num(l.remaining_balance) > 0).length,
    };
  }, [employee]);

  // ── Loading / error ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <Layout title="Employee">
        <HrStyles />
        <div className="card hr-section hr-profile-card">
          <div className="hr-profile-head">
            <div className="hr-profile-identity">
              <div className="hr-skel" style={{ width: 56, height: 56, borderRadius: 14 }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div className="hr-skel hr-skel-title" style={{ width: 190 }} />
                  <div className="hr-skel hr-skel-chip" style={{ width: 66, height: 22 }} />
                </div>
                <div className="hr-skel hr-skel-text" style={{ width: 160, marginBottom: 7 }} />
                <div className="hr-skel hr-skel-text" style={{ width: 240, height: 10 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="hr-skel" style={{ width: 118, height: 36, borderRadius: 8 }} />
              <div className="hr-skel" style={{ width: 36, height: 36, borderRadius: 8 }} />
            </div>
          </div>
          <div className="hr-tabs" aria-hidden="true">
            {[104, 156, 140].map(width => (
              <span className="hr-tab" key={width}>
                <span className="hr-skel hr-skel-text" style={{ width }} />
              </span>
            ))}
          </div>
        </div>
        {[10, 4].map((fields, i) => (
          <div className="hr-panel" key={i}>
            <div className="hr-panel-head">
              <div className="hr-skel" style={{ width: 30, height: 30, borderRadius: 8 }} />
              <div className="hr-skel hr-skel-text" style={{ width: 110 }} />
            </div>
            <div className="hr-panel-body"><FieldGridSkeleton fields={fields} /></div>
          </div>
        ))}
      </Layout>
    );
  }

  if (loadError || !employee) {
    return (
      <Layout title="Employee">
        <HrStyles />
        <div className="card">
          <EmptyState
            icon="person_off"
            title="This employee could not be opened"
            desc={loadError || 'The record may have been removed.'}
            action={
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-outline" onClick={load}>Try again</button>
                <Link className="btn btn-primary" to="/hr/employees">Back to workforce</Link>
              </div>
            }
          />
        </div>
      </Layout>
    );
  }

  const isInactive = employee.status === 'Inactive';
  // What "achievement" counts for this person, decided by the linked Master
  // Data row's role (see routes/salarySlips.js). Null means the link is
  // missing, which is a real state, not a blank.
  const achievementBasis =
    employee.master_employee_role === 'Supplier'
      ? 'Recoveries collected in the month'
      : employee.master_employee_role === 'Salesman'
        ? 'Invoices booked in the month, net of returns and recovery discounts'
        : null;
  const hasBankDetails = !!(employee.bank_name || employee.account_title || employee.account_number || employee.iban);

  // The record's secondary actions. Everything here is an event or a
  // destination — attributes of the person are edited through Edit profile.
  // Payroll entries are hidden without perm_hr_payroll rather than shown and
  // then refused: the server returns 400 PERMISSION_DENIED for them.
  const canPayroll = can('perm_hr_payroll');
  const headerActions = [
    {
      label: 'Record a loan or advance',
      icon: 'account_balance_wallet',
      onClick: () => { setTab('pay'); openLoanForm(); },
    },
    ...(canPayroll
      ? [{ label: 'Open Payroll', icon: 'receipt_long', onClick: () => navigate('/hr/salary-slips') }]
      : []),
    {
      label: 'Copy link to profile',
      icon: 'link',
      onClick: () => {
        // navigator.clipboard is undefined outside a secure context, which a
        // LAN install over plain HTTP genuinely is.
        if (!navigator.clipboard) {
          toast.error('Copying needs a secure (https) connection — copy the address bar instead.');
          return;
        }
        navigator.clipboard.writeText(window.location.href)
          .then(() => toast.success('Profile link copied'))
          .catch(() => toast.error('Could not copy the link'));
      },
    },
    isInactive
      ? { label: 'Reactivate employee', icon: 'person_check', onClick: () => beginStatusChange('Active') }
      : { label: 'Deactivate employee', icon: 'person_off', danger: true, onClick: () => beginStatusChange('Inactive') },
  ];

  return (
    <Layout title="Employee Profile">
      <HrStyles />

      <div className="hr-page-enter">
        {/* ── Breadcrumb ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <Link to="/hr/employees" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6, color: 'var(--gray-500)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden="true">arrow_back</span>
            Workforce
          </Link>
        </div>

        {/* ── Header ─────────────────────────────────────────────────── */}
        {/* Identity reads top-down in the order an HR person asks for it:
            WHO (name, and whether they are still on the payroll), WHAT (role
            and department), WHICH RECORD (employee id, linked master row).
            The bordered chips that used to carry all of that in one floating
            row gave a system id the same visual weight as employment status,
            and put five outlines on a line that needed none. */}
        <div className="card hr-section hr-profile-card">
          <div className="hr-profile-head">
            <div className="hr-profile-identity">
              <div className="hr-avatar" aria-hidden="true">{initials(employee.name)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="hr-profile-namerow">
                  <h1 className="hr-profile-name">{employee.name}</h1>
                  <StatusBadge status={employee.status} />
                  {/* !! because is_field_employee is a TINYINT: a bare
                      `0 && ...` renders the digit 0 beside the name. */}
                  {!!employee.is_field_employee && (
                    <Pill icon="explore" title="Eligible for a sales target and area tagging">
                      Field staff
                    </Pill>
                  )}
                </div>

                <div className="hr-profile-role">
                  {employee.designation_name} · {employee.department_name}
                </div>

                <div className="hr-profile-meta">
                  {/* Employee ID: generated at creation, permanently
                      immutable. There is no input for it anywhere, so it is
                      stated as a fact rather than given an edit affordance. */}
                  <span title="System-generated — cannot be changed">
                    ID:{' '}
                    <span className="hr-meta-id">{employee.employee_id}</span>
                  </span>
                  {employee.master_employee_name && (
                    <>
                      <span className="hr-profile-meta-sep" aria-hidden="true">·</span>
                      <span title="Linked Master Data record">
                        Master record:{' '}
                        <span style={{ color: 'var(--gray-600)' }}>
                          {employee.master_employee_name} — {employee.master_employee_role}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="hr-profile-actions">
              {editing ? (
                <>
                  <button className="btn btn-outline" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  <BusyButton busy={saving} busyLabel="Saving…" onClick={saveProfile} icon="check">
                    Save changes
                  </BusyButton>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={startEdit}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">edit</span>
                    Edit profile
                  </button>
                  {/* Everything that is an event rather than an attribute
                      lives here, so the header carries the record's whole
                      action surface instead of one button and a gap. Every
                      entry does something on this page or navigates — none of
                      them is a placeholder. */}
                  <KebabMenu label={`More actions for ${employee.name}`} items={headerActions} />
                </>
              )}
            </div>
          </div>

          {isInactive && !editing && (
            <div style={{ padding: '0 24px 20px' }}>
              <div className="alert alert-warning" style={{ marginBottom: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">event_busy</span>
                <span>
                  Left on <strong>{fmtDate(employee.date_of_leaving)}</strong>
                  {employee.reason_for_leaving ? <> — {employee.reason_for_leaving}</> : null}
                </span>
              </div>
            </div>
          )}

          {editing && (
            <div style={{ padding: '0 24px 20px' }}>
              <div className="hr-locked">
                <span className="material-symbols-outlined" aria-hidden="true">edit_note</span>
                <span>
                  Editing the full profile. Every tab — including the salary
                  structure and sales target — is saved together by
                  <strong> Save changes</strong>.
                </span>
              </div>
            </div>
          )}

          {/* Docked to the bottom edge of the identity card so the header and
              its navigation read as one object. */}
          <Tabs
            tabs={TABS.map(t => ({ ...t, alert: !!tabAlerts[t.value] }))}
            value={tab}
            onChange={setTab}
            ariaLabel="Employee profile sections"
          />
        </div>

        {/* ── General Info ──────────────────────────────────────────────────── */}
        {tab === 'general' && (
        <TabPanel value="general">
          <Panel icon="badge" title="Identity">
            {editing ? (
              <div className="hr-form-grid">
                <FormField label="Full name" htmlFor="f-name" required error={errorFor('name')} col={4}>
                  <input id="f-name" className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
                    placeholder="Full name as printed on CNIC"
                    value={form.name} maxLength={200}
                    onChange={e => setField('name', e.target.value)} onBlur={() => markTouched('name')} />
                </FormField>

                <FormField label="Father's name" htmlFor="f-father" col={4}>
                  <input id="f-father" className="form-control" value={form.father_name} maxLength={200}
                    onChange={e => setField('father_name', e.target.value)} />
                </FormField>

                <FormField label="CNIC" htmlFor="f-cnic" error={errorFor('cnic')} col={4}>
                  <input id="f-cnic" className={`form-control mono hr-mask${errorFor('cnic') ? ' hr-invalid' : ''}`}
                    placeholder="XXXXX-XXXXXXX-X" value={form.cnic} maxLength={15}
                    onChange={e => handleCNICInput(e, (val) => setField('cnic', val))}
                    onBlur={() => markTouched('cnic')} />
                </FormField>

                <FormField label="Date of birth" htmlFor="f-dob" col={3}>
                  <input id="f-dob" type="date" className="form-control" value={form.date_of_birth}
                    max={todayPKT()} onChange={e => setField('date_of_birth', e.target.value)} />
                </FormField>

                <FormField label="Gender" htmlFor="f-gender" col={3}>
                  <select id="f-gender" className="form-control" value={form.gender}
                    onChange={e => setField('gender', e.target.value)}>
                    <option value="">Not recorded</option>
                    {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </FormField>

                <FormField label="Mobile" htmlFor="f-mobile" required error={errorFor('mobile')} col={3}>
                  <input id="f-mobile" className={`form-control hr-mask${errorFor('mobile') ? ' hr-invalid' : ''}`}
                    placeholder="03XX XXXXXXX" value={form.mobile} maxLength={16}
                    onChange={e => handlePhoneInput(e, (val) => setField('mobile', val))}
                    onBlur={() => markTouched('mobile')} />
                </FormField>

                <FormField label="Alternate mobile" htmlFor="f-alt-mobile" col={3}>
                  <input id="f-alt-mobile" className="form-control hr-mask" placeholder="03XX XXXXXXX"
                    value={form.alternate_mobile} maxLength={16}
                    onChange={e => handlePhoneInput(e, (val) => setField('alternate_mobile', val))} />
                </FormField>

                <FormField label="Email" htmlFor="f-email" error={errorFor('email')} col={6}>
                  <input id="f-email" type="email" className={`form-control${errorFor('email') ? ' hr-invalid' : ''}`}
                    placeholder="name@company.com" value={form.email} maxLength={200}
                    onChange={e => setField('email', e.target.value)} onBlur={() => markTouched('email')} />
                </FormField>

                <FormField label="City" htmlFor="f-city" col={6}>
                  <select id="f-city" className="form-control" value={form.city_id}
                    onChange={e => setField('city_id', e.target.value)}>
                    <option value="">Not recorded</option>
                    {lookups.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </FormField>

                <FormField label="Residential address" htmlFor="f-address" col={12}>
                  <textarea id="f-address" className="form-control" rows={2} value={form.address}
                    placeholder="House, street, area" onChange={e => setField('address', e.target.value)} />
                </FormField>
              </div>
            ) : (
              <FieldGrid cols={4}>
                <Field label="Full name" value={employee.name} />
                <Field label="Father's name" value={employee.father_name} />
                <Field label="CNIC" value={employee.cnic ? formatCNIC(employee.cnic) : null} mono />
                <Field label="Date of birth" value={employee.date_of_birth ? fmtDate(employee.date_of_birth) : null} />
                <Field label="Gender" value={employee.gender} />
                <Field label="Mobile" value={employee.mobile ? formatPhone(employee.mobile) : null} />
                <Field label="Alternate mobile" value={employee.alternate_mobile ? formatPhone(employee.alternate_mobile) : null} />
                <Field label="Email" value={employee.email} />
                <Field label="City" value={employee.city_name} />
                {/* Long free text, last and spanning: it finishes the row
                    City opens instead of squeezing three fields beside it. */}
                <Field label="Residential address" value={employee.address} span={3} />
              </FieldGrid>
            )}
          </Panel>

          <Panel icon="work" title="Employment">
            {editing ? (
              <div className="hr-form-grid">
                <FormField label="Date of joining" htmlFor="f-doj" required error={errorFor('date_of_joining')} col={3}>
                  <input id="f-doj" type="date" className={`form-control${errorFor('date_of_joining') ? ' hr-invalid' : ''}`}
                    value={form.date_of_joining} max={todayPKT()}
                    onChange={e => setField('date_of_joining', e.target.value)}
                    onBlur={() => markTouched('date_of_joining')} />
                </FormField>

                <FormField label="Department" htmlFor="f-dept" required error={errorFor('department_id')} col={3}>
                  <select id="f-dept" className={`form-control${errorFor('department_id') ? ' hr-invalid' : ''}`}
                    value={form.department_id} onChange={e => setField('department_id', e.target.value)}
                    onBlur={() => markTouched('department_id')}>
                    <option value="">Select department</option>
                    {lookups.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FormField>

                <FormField label="Designation" htmlFor="f-desig" required error={errorFor('designation_id')} col={3}>
                  <select id="f-desig" className={`form-control${errorFor('designation_id') ? ' hr-invalid' : ''}`}
                    value={form.designation_id} onChange={e => setField('designation_id', e.target.value)}
                    onBlur={() => markTouched('designation_id')}>
                    <option value="">Select designation</option>
                    {lookups.designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FormField>

                <FormField label="Employment status" htmlFor="f-status" col={3}>
                  <select id="f-status" className="form-control" value={form.status}
                    onChange={e => setField('status', e.target.value)}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </FormField>

                <FormField label="Reporting manager" htmlFor="f-mgr" col={4}>
                  <select id="f-mgr" className="form-control" value={form.reporting_manager_id}
                    onChange={e => setField('reporting_manager_id', e.target.value)}>
                    <option value="">No manager</option>
                    {lookups.managers.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — {m.designation_name}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Master Data record" htmlFor="f-master" col={4} error={errorFor('master_employee_id')}>
                  <SearchSelect
                    id="f-master"
                    options={lookups.masters}
                    value={form.master_employee_id}
                    onChange={(val) => setField('master_employee_id', val)}
                    placeholder="Not linked — search to link"
                    emptyText="No Master Data employee matches"
                    invalid={!!errorFor('master_employee_id')}
                    getLabel={(m) => `${m.name} — ${m.role}`}
                  />
                </FormField>

                <div className="hr-col-4">
                  {/* The banner's top edge lines up with the inputs beside it:
                      label line-box (20px) + the grid's 8px label margin. */}
                  <label className="hr-checkbanner" htmlFor="f-field-emp"
                    style={{ marginTop: 28, alignItems: 'center' }}>
                    <input id="f-field-emp" type="checkbox" checked={form.is_field_employee}
                      onChange={e => setField('is_field_employee', e.target.checked)} />
                    <span className="hr-checkbanner-title">Field staff</span>
                  </label>
                </div>

                {form.status === 'Inactive' && (
                  <>
                    <FormField label="Date of leaving" htmlFor="f-dol" required
                      error={errorFor('date_of_leaving')} col={4}>
                      <input id="f-dol" type="date"
                        className={`form-control${errorFor('date_of_leaving') ? ' hr-invalid' : ''}`}
                        value={form.date_of_leaving}
                        min={storedLeaving && storedLeaving < oldestLeaving ? undefined : oldestLeaving}
                        max={today}
                        onChange={e => setField('date_of_leaving', e.target.value)}
                        onBlur={() => markTouched('date_of_leaving')} />
                    </FormField>

                    {/* Its own full-width row at the foot of the panel: free
                        text needs the width, and three rows of height say so
                        before anything is typed. */}
                    <FormField label="Reason for leaving" htmlFor="f-reason" required
                      error={errorFor('reason_for_leaving')} col={12}>
                      <textarea id="f-reason" rows={3}
                        className={`form-control${errorFor('reason_for_leaving') ? ' hr-invalid' : ''}`}
                        placeholder="Resignation, end of contract, relocation…"
                        value={form.reason_for_leaving}
                        onChange={e => setField('reason_for_leaving', e.target.value)}
                        onBlur={() => markTouched('reason_for_leaving')} />
                    </FormField>
                  </>
                )}
              </div>
            ) : (
              <FieldGrid cols={4}>
                <Field label="Date of joining" value={fmtDate(employee.date_of_joining)} />
                <Field label="Department" value={employee.department_name} />
                <Field label="Designation" value={employee.designation_name} />
                <Field
                  label="Reporting manager"
                  value={employee.reporting_manager_name
                    ? (
                      <Link to={`/hr/employees/${employee.reporting_manager_id}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>
                        {employee.reporting_manager_name}
                      </Link>
                    )
                    : null}
                />
              </FieldGrid>
            )}
          </Panel>
        </TabPanel>
        )}

        {/* ── Compensation & Loans ──────────────────────────────────────────── */}
        {tab === 'pay' && (
        <TabPanel value="pay">
          <Panel
            icon="payments"
            title="Compensation"
            status={
              (employee.salary_components || []).length
                ? `${fmtMoney(componentTotals.net)} net per month`
                : 'Not set'
            }
          >
            <h3 className="hr-subhead">Monthly salary structure</h3>

            {/* Two parallel ledgers. Which column a line sits in IS its type,
                so nothing on the row has to state it — and the reader can
                total either side without filtering a mixed list. */}
            {editing ? (
              <>
                <div className="hr-paysplit">
                  {SALARY_SIDES.map(side => {
                    const rows = components.filter(c => c.type === side.type);
                    return (
                      <section className={`hr-payside${side.deduction ? ' is-deduction' : ''}`} key={side.type}>
                        <div className="hr-payside-head">
                          <span id={`side-${side.type}`}>{side.label}</span>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => addComponent(side.type)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden="true">add</span>
                            Add
                          </button>
                        </div>

                        <div className="hr-payside-body">
                          {rows.length === 0 ? (
                            <div className="hr-payside-empty">{side.empty}</div>
                          ) : rows.map(component => (
                            <div className="hr-payrow is-edit" key={component.key}>
                              <label htmlFor={`title-${component.key}`} className="hr-sr-only">
                                {side.label} description
                              </label>
                              <input
                                id={`title-${component.key}`}
                                className={`form-control${!component.title.trim() ? ' hr-invalid' : ''}`}
                                placeholder={side.placeholder}
                                value={component.title}
                                maxLength={200}
                                onChange={e => updateComponent(component.key, { title: e.target.value })}
                              />
                              <label htmlFor={`amt-${component.key}`} className="hr-sr-only">
                                {side.label} amount
                              </label>
                              <input
                                id={`amt-${component.key}`}
                                type="number"
                                className="form-control no-spinner"
                                style={{ textAlign: 'right' }}
                                min="0" step="0.01" placeholder="0.00"
                                value={component.amount}
                                onWheel={blockWheelChange}
                                onChange={e => updateComponent(component.key, { amount: e.target.value })}
                              />
                              <button
                                type="button"
                                className="hr-payrow-x"
                                title={`Remove ${component.title || 'this line'}`}
                                aria-label={`Remove ${component.title || 'this line'}`}
                                onClick={() => removeComponent(component.key)}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">close</span>
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="hr-payside-foot">
                          <span className="hr-payside-foot-label">{side.totalLabel}</span>
                          <span className="hr-payside-foot-value">
                            {fmtAmount(side.deduction ? componentTotals.deductions : componentTotals.earnings)}
                          </span>
                        </div>
                      </section>
                    );
                  })}
                </div>

                {componentProblem && (
                  <div className="hr-error" style={{ marginTop: 12 }} role="alert">
                    <span className="material-symbols-outlined" aria-hidden="true">error</span>
                    <span>{componentProblem}</span>
                  </div>
                )}

                <NetPayBanner value={componentTotals.net} />
              </>
            ) : components.length === 0 ? (
              /* Nothing recorded: the prompt alone. Three zero-valued total
                 cells under an empty structure said nothing and read as a
                 layout that had failed to load. */
              <div className="hr-locked">
                <span className="material-symbols-outlined" aria-hidden="true">request_quote</span>
                <span>
                  No salary structure recorded. Use <strong>Edit profile</strong> to
                  add the recurring earnings and deductions that make up monthly pay.
                </span>
              </div>
            ) : (
              <>
                <div className="hr-paysplit">
                  {SALARY_SIDES.map(side => {
                    const rows = employee.salary_components.filter(c => c.type === side.type);
                    return (
                      <section className={`hr-payside${side.deduction ? ' is-deduction' : ''}`} key={side.type}>
                        <div className="hr-payside-head">{side.label}</div>

                        <div className="hr-payside-body">
                          {rows.length === 0 ? (
                            <div className="hr-payside-empty">{side.none}</div>
                          ) : rows.map(component => (
                            <div className="hr-payrow" key={component.id}>
                              <span className="hr-payrow-title">{component.title}</span>
                              <span className="hr-payrow-amt">
                                {side.deduction
                                  ? `(${fmtAmount(component.amount)})`
                                  : fmtAmount(component.amount)}
                                {side.deduction && <span className="hr-sr-only"> deducted</span>}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="hr-payside-foot">
                          <span className="hr-payside-foot-label">{side.totalLabel}</span>
                          <span className="hr-payside-foot-value">
                            {fmtAmount(side.deduction ? componentTotals.deductions : componentTotals.earnings)}
                          </span>
                        </div>
                      </section>
                    );
                  })}
                </div>

                <NetPayBanner value={componentTotals.net} />
              </>
            )}

            {/* Sales target sits in the same section and the same save. */}
            {!!(editing ? form.is_field_employee : employee.is_field_employee) && (
              <>
                <div className="divider" style={{ margin: '24px 0 16px' }} />
                <h3 className="hr-subhead">Monthly sales target</h3>

                {editing ? (
                  <div className="hr-form-grid">
                    <FormField
                      label="Target amount (PKR)"
                      htmlFor="f-target"
                      col={4}
                      error={targetProblem}
                    >
                      <input
                        id="f-target"
                        type="number"
                        className={`form-control no-spinner${targetProblem ? ' hr-invalid' : ''}`}
                        style={{ textAlign: 'right' }}
                        min="0" step="0.01" placeholder="0.00"
                        value={targetInput}
                        onWheel={blockWheelChange}
                        onChange={e => setTargetInput(e.target.value)}
                      />
                    </FormField>
                  </div>
                ) : (
                  /* Figure stacked straight over the sentence that explains
                     it. The bordered metric box this replaces trapped a
                     pocket of empty space beside a one-line value and forced
                     the explanation to wrap inside a narrow column. */
                  <div>
                    <div className="hr-kv-label">Target amount</div>
                    {employee.sales_target === null ? (
                      <div className="hr-target-pill">Not configured</div>
                    ) : (
                      <div className="hr-target-value">{fmtMoney(employee.sales_target)}</div>
                    )}
                    <p className={`hr-target-basis${achievementBasis ? '' : ' is-empty'}`}>
                      <span className="hr-target-basis-label">Achievement basis: </span>
                      {achievementBasis || 'not measurable until a Master Data record is linked.'}
                    </p>
                  </div>
                )}

                {!employee.master_employee_id && (
                  <div className="alert alert-warning" style={{ marginTop: 16, marginBottom: 0 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">link_off</span>
                    <span>
                      Not linked to a Master Data record, so achievement against this
                      target cannot be measured. Link one under Employment.
                    </span>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel
            icon="account_balance_wallet"
            title="Loans & advances"
            status={
              loanTotals.count === 0
                ? 'None on record'
                : `${fmtMoney(loanTotals.outstanding)} outstanding`
            }
            actions={
              !loanFormOpen && loanTotals.count > 0
                ? <button className="btn btn-outline btn-sm" onClick={openLoanForm}>+ Record loan</button>
                : null
            }
          >
            {loanFormOpen && (
              <div className="product-row" style={{ display: 'block', marginBottom: 18 }}>
                <div className="hr-form-grid">
                  <FormField label="Reference" htmlFor="l-title" required error={loanErrorFor('title')} col={5}>
                    <input id="l-title" className={`form-control${loanErrorFor('title') ? ' hr-invalid' : ''}`}
                      placeholder="Salary advance, hardship loan…" value={loanForm.title} maxLength={200}
                      onChange={e => setLoanForm(p => ({ ...p, title: e.target.value }))}
                      onBlur={() => setLoanTouched(p => ({ ...p, title: true }))} />
                  </FormField>

                  <FormField label="Principal amount (PKR)" htmlFor="l-amount" required
                    error={loanErrorFor('principal_amount')} col={4}>
                    <input id="l-amount" type="number" min="0" step="0.01" placeholder="0.00"
                      className={`form-control no-spinner${loanErrorFor('principal_amount') ? ' hr-invalid' : ''}`}
                      style={{ textAlign: 'right' }}
                      value={loanForm.principal_amount} onWheel={blockWheelChange}
                      onChange={e => setLoanForm(p => ({ ...p, principal_amount: e.target.value }))}
                      onBlur={() => setLoanTouched(p => ({ ...p, principal_amount: true }))} />
                  </FormField>

                  <FormField label="Date issued" htmlFor="l-date" required error={loanErrorFor('date_issued')} col={3}>
                    <input id="l-date" type="date"
                      className={`form-control${loanErrorFor('date_issued') ? ' hr-invalid' : ''}`}
                      value={loanForm.date_issued} max={todayPKT()}
                      onChange={e => setLoanForm(p => ({ ...p, date_issued: e.target.value }))}
                      onBlur={() => setLoanTouched(p => ({ ...p, date_issued: true }))} />
                  </FormField>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setLoanFormOpen(false)} disabled={savingLoan}>
                    Cancel
                  </button>
                  <BusyButton busy={savingLoan} busyLabel="Recording…" className="btn btn-primary btn-sm" onClick={saveLoan}>
                    Record loan
                  </BusyButton>
                </div>
              </div>
            )}

            {employee.loans.length === 0 ? (
              !loanFormOpen && (
                <EmptyState
                  icon="account_balance_wallet"
                  title="No loans or advances"
                  desc="A recorded loan is offered as a deduction on future payslips until its balance is cleared."
                  action={<button className="btn btn-primary btn-sm" onClick={openLoanForm}>Record a loan</button>}
                  small
                />
              )
            ) : (
              <div className="table-wrap">
                <table className="hr-table is-dense">
                  <colgroup>
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '18%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Issued</th>
                      <th className="hr-th-num">Principal</th>
                      <th className="hr-th-num">Repaid</th>
                      <th className="hr-th-num">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employee.loans.map(loan => {
                      const remaining = num(loan.remaining_balance);
                      const cleared = remaining <= 0;
                      return (
                        <tr key={loan.id}>
                          <td>
                            <span className="hr-cell-strong">{loan.title}</span>
                            {cleared && <span className="badge badge-green" style={{ marginLeft: 8 }}>Cleared</span>}
                          </td>
                          <td>{fmtDate(loan.date_issued)}</td>
                          <td className="hr-num">{fmtAmount(loan.principal_amount)}</td>
                          <td className="hr-num">{fmtAmount(loan.repaid_amount)}</td>
                          <td
                            className="hr-num hr-cell-total"
                            style={cleared ? { color: 'var(--green)' } : undefined}
                          >
                            {fmtAmount(remaining)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </TabPanel>
        )}

        {/* ── Banking & Payslips ────────────────────────────────────────────── */}
        {tab === 'banking' && (
        <TabPanel value="banking">
          <Panel
            icon="account_balance"
            title="Banking"
            status={hasBankDetails ? 'On file' : 'Not on file'}
          >
            {editing ? (
              <div className="hr-form-grid">
                <FormField label="Bank name" htmlFor="f-bank" col={6}>
                  <input id="f-bank" className="form-control"
                    placeholder="Meezan Bank, HBL, Bank Alfalah…"
                    value={form.bank_name} maxLength={200}
                    onChange={e => setField('bank_name', e.target.value)} />
                </FormField>

                <FormField label="Account title" htmlFor="f-acct-title" col={6}>
                  <input id="f-acct-title" className="form-control"
                    placeholder="Account holder name as per bank records"
                    value={form.account_title} maxLength={200}
                    onChange={e => setField('account_title', e.target.value)} />
                </FormField>

                <FormField label="Account number" htmlFor="f-acct-no" error={errorFor('account_number')} col={6}>
                  <input id="f-acct-no" className={`form-control mono hr-mask${errorFor('account_number') ? ' hr-invalid' : ''}`}
                    placeholder="0000000000000000"
                    value={form.account_number} maxLength={100}
                    onChange={e => setField('account_number', e.target.value)}
                    onBlur={() => markTouched('account_number')} />
                </FormField>

                <FormField label="IBAN" htmlFor="f-iban" error={errorFor('iban')} col={6}>
                  <input
                    id="f-iban"
                    className={`form-control mono hr-mask${errorFor('iban') ? ' hr-invalid' : ''}`}
                    placeholder="PK00XXXX0000000000000000"
                    value={form.iban}
                    maxLength={24}
                    /* Stored and displayed without spaces, upper-cased as typed
                       so it always matches the bank's own format. */
                    onChange={e => setField('iban', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                    onBlur={() => markTouched('iban')}
                  />
                </FormField>
              </div>
            ) : (
              <FieldGrid cols={2}>
                <Field label="Bank name" value={employee.bank_name} />
                <Field label="Account title" value={employee.account_title} />
                <Field label="Account number" value={employee.account_number} mono />
                <Field label="IBAN" value={employee.iban} mono />
              </FieldGrid>
            )}
          </Panel>

          <Panel
            icon="receipt_long"
            title="Payslips"
            status={
              employee.salary_slips.length
                ? `${employee.salary_slips.length} issued`
                : 'None issued'
            }
          >
            {employee.salary_slips.length === 0 ? (
              <EmptyState
                icon="receipt_long"
                title="No payslips issued"
                desc="Payslips appear here once this employee is included in a pay run."
                action={canPayroll
                  ? <Link className="btn btn-primary btn-sm" to="/hr/salary-slips">Go to Payroll</Link>
                  : null}
                small
              />
            ) : (
              <div className="table-wrap">
                <table className="hr-table is-dense">
                  <colgroup>
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '14%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Pay period</th>
                      <th>Issued</th>
                      <th className="hr-th-num">Gross</th>
                      <th className="hr-th-num">Deductions</th>
                      <th className="hr-th-num">Net pay</th>
                      <th><span className="hr-sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {employee.salary_slips.map(slip => {
                      // total_earnings / total_deductions were added to this
                      // endpoint after the client shipped. An older server
                      // omits them, and a slip that predates them is not a
                      // broken row — it just cannot show its own breakdown.
                      const hasBreakdown = slip.total_earnings !== undefined
                        && slip.total_deductions !== undefined;
                      return (
                        <tr key={slip.id}>
                          <td className="hr-cell-strong">{fmtMonth(slip.month)}</td>
                          <td>{fmtDate(slip.generated_at)}</td>
                          <td className="hr-num">
                            {hasBreakdown ? fmtAmount(slip.total_earnings) : '—'}
                          </td>
                          <td className={`hr-num${hasBreakdown && num(slip.total_deductions) > 0 ? ' hr-amt-deduction' : ''}`}>
                            {hasBreakdown
                              ? (num(slip.total_deductions) > 0
                                ? `(${fmtAmount(slip.total_deductions)})`
                                : fmtAmount(slip.total_deductions))
                              : '—'}
                          </td>
                          <td className="hr-num hr-cell-total">{fmtAmount(slip.net_pay)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {/* The payslip renders on the standalone print
                                route, the same one Payroll uses, so one slip
                                and a batch always print identically. That
                                route loads the slip from a perm_hr_payroll
                                endpoint, so the link is hidden — not shown
                                and then refused — without the flag. */}
                            {canPayroll && (
                              <a
                                className="btn btn-ghost btn-sm"
                                href={`/hr/salary-slips/print?ids=${slip.id}&preview=1`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open the ${fmtMonth(slip.month)} payslip`}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
                                  open_in_new
                                </span>
                                View
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </TabPanel>
        )}
      </div>
    </Layout>
  );
}

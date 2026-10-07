import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatPhone, handleCNICInput, handlePhoneInput } from '../../utils/formatters';
import {
  HrStyles, Segmented, StatusBadge, KebabMenu, SortableHeader, useSort, sortRows, byText,
  FormField, Notice, fmtDay,
} from '../hr/HrKit';

// Add starts with no role, so the operator chooses one rather than inheriting
// a default.
const emptyForm = { name: '', cnic: '', phone: '', role: '' };
const FIELDS = ['name', 'cnic', 'phone', 'role'];

// Natural order, so EMP-SM-009 sorts before EMP-SM-010.
const byCode = (a, b) => String(a.employee_code || '')
  .localeCompare(String(b.employee_code || ''), undefined, { numeric: true });

const COMPARATORS = {
  employee_code: byCode,
  name:   (a, b) => byText('name')(a, b) || byCode(a, b),
  role:   (a, b) => byText('role')(a, b) || byText('name')(a, b),
  status: (a, b) => byText('status')(a, b) || byText('name')(a, b),
};

const digitsOf = (value) => String(value || '').replace(/\D/g, '');

// Field rules for Add and Edit. Mirrors validateEmployeeFields in
// server/routes/employees.js, which stays authoritative. Returns
// { field: message } for every failing field, in display order.
function validateForm(form) {
  const errors = {};
  const name = form.name.trim();
  const cnic = digitsOf(form.cnic);
  const phone = digitsOf(form.phone);
  if (!name) errors.name = 'Enter the full name.';
  else if (name.length < 2) errors.name = 'The name must have at least 2 characters.';
  else if (name.length > 80) errors.name = 'The name must have 80 characters or fewer.';
  if (form.cnic.trim() && cnic.length !== 13) errors.cnic = 'The CNIC must have 13 digits.';
  if (form.phone.trim() && !(
    (phone.length === 11 && phone.startsWith('03'))
    || (phone.length === 12 && phone.startsWith('92'))
  )) {
    errors.phone = 'Enter 11 digits starting with 03, or 12 starting with 92.';
  }
  if (!form.role) errors.role = 'Choose a role.';
  return errors;
}

// A real change only: trimmed text, and CNIC / phone by their digits, so
// whitespace or a separator is not a change.
function formChanged(form, record) {
  return form.name.trim() !== String(record.name || '').trim()
    || digitsOf(form.cnic) !== digitsOf(record.cnic)
    || digitsOf(form.phone) !== digitsOf(record.phone)
    || form.role !== record.role;
}

// Identifiers read in the body font with tabular figures (.mono's JetBrains
// Mono is never loaded). --gray-500 is 4.76:1 on white, the lightest colour
// allowed for real content; it is also the muted colour for the empty-cell
// dash and for inactive names under All.
const MUTED = 'var(--gray-500)';
const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const EMPTY_CELL = <span style={{ color: MUTED }}>—</span>;

// Master Data Salesmen and Suppliers. An Inactive person disappears from every
// picker in Sale, Recovery and Reports (GET /employees returns Active rows
// only by default); their invoices, recoveries and report figures stay as they
// are. This screen is the one place that lists everyone, so it asks for
// ?include_inactive=1 and filters in the browser, which keeps the
// Active / Inactive / All toggle instant and lets it show a count for each.
//
// The list is the only view of a record: rows are not clickable, and the
// kebab menu holds every action (Edit, Deactivate / Reactivate, Delete).
export default function Employees() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A failed status change is shown inside its dialog, which stays open.
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const { sortConfig, handleSort } = useSort('name');

  const load = () => {
    setLoading(true);
    api.get('/employees', { params: { include_inactive: 1 } })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const counts = useMemo(() => ({
    all:      data.length,
    Active:   data.filter(e => e.status === 'Active').length,
    Inactive: data.filter(e => e.status === 'Inactive').length,
  }), [data]);

  // Under Active or Inactive every row has the same status, so the column
  // appears only under All (same rule as the Workforce roster).
  const showStatus = statusFilter === 'all';

  // Sorting by a column that is no longer on screen leaves the list in an
  // order nothing visible explains, so the sort falls back to Name.
  const effectiveSort = useMemo(() => (
    !showStatus && sortConfig.column === 'status'
      ? { column: 'name', direction: 'asc' }
      : sortConfig
  ), [showStatus, sortConfig]);

  // ── Add / Edit dialog ────────────────────────────────────────────────────
  const openDialog = (record) => {
    setSelected(record);
    setForm(record
      // Phone in its display format; formChanged compares digits, so this is
      // not a change.
      ? { name: record.name, cnic: record.cnic || '', phone: formatPhone(record.phone), role: record.role }
      : emptyForm);
    setTouched({});
    setServerErrors({});
    setModal(true);
  };
  const openAdd = () => openDialog(null);
  const openEdit = (record) => openDialog(record);

  const setField = (key, value) => {
    setForm(p => ({ ...p, [key]: value }));
    setServerErrors(p => (p[key] ? { ...p, [key]: undefined } : p));
  };
  const markTouched = (key) => setTouched(p => ({ ...p, [key]: true }));

  const editing = !!selected;
  // Once the person is on a sale or recovery, their role (and so their code)
  // is fixed; the server refuses the change with 409 as well.
  const roleLocked = editing && !!selected.in_use;
  const validation = validateForm(form);
  const firstError = FIELDS.map(key => validation[key]).find(Boolean);
  const changed = editing ? formChanged(form, selected) : true;
  const saveBlockedReason = editing && !changed ? 'No changes yet' : firstError || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? validation[key] : null);

  const handleSave = async () => {
    setTouched({ name: true, cnic: true, phone: true, role: true });
    if (saveBlockedReason) return;
    setSaving(true);
    setServerErrors({});
    const payload = {
      name: form.name.trim(), cnic: form.cnic.trim(), phone: form.phone.trim(), role: form.role,
    };
    try {
      if (editing) { await api.put(`/employees/${selected.id}`, payload); toast.success('Employee updated.'); }
      else { await api.post('/employees', payload); toast.success('Employee added.'); }
      setModal(false); load();
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && FIELDS.includes(body.field)) setServerErrors({ [body.field]: body.message });
      else toast.error(body?.message || 'The employee could not be saved. Try again.');
    } finally { setSaving(false); }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/employees/${selected.id}`);
      toast.success(`${selected.name} deleted.`); setDeleteModal(false); load();
    } catch (err) {
      // The menu disables Delete for anyone in use, but the server's 409 is the
      // final check (someone may have been put on an invoice since loading).
      setDeleteModal(false);
      toast.error(err?.response?.data?.message || 'The employee could not be deleted. Try again.');
      load();
    } finally { setDeleting(false); }
  };

  // ── Deactivate / reactivate ──────────────────────────────────────────────
  // Master Data status means "can sell or deliver"; HR status means "employed
  // and paid". Sync is one-way, HR -> Master Data (the checkbox in HR), so this
  // dialog never writes HR. When the linked HR profile would be left on the
  // other side (still on payroll after a deactivation, off payroll after a
  // reactivation), it says so, naming the HR profile by its own name and ID,
  // because the two records can carry different names for one person.
  const deactivating = statusTarget?.status === 'Active';
  const hrLink = statusTarget?.hr_link || null;
  const hrMismatch = !!hrLink && hrLink.status === (deactivating ? 'Active' : 'Inactive');

  const openStatusDialog = (record) => { setStatusTarget(record); setStatusError(null); };
  const closeStatusDialog = () => { if (!statusBusy) { setStatusTarget(null); setStatusError(null); } };

  const submitStatusChange = async () => {
    setStatusBusy(true);
    setStatusError(null);
    try {
      await api.put(`/employees/${statusTarget.id}/status`, { status: deactivating ? 'Inactive' : 'Active' });
      toast.success(deactivating ? `${statusTarget.name} deactivated.` : `${statusTarget.name} reactivated.`);
      setStatusTarget(null);
      load();
    } catch (err) {
      setStatusError(err?.response?.data?.message || 'The status could not be changed. Try again.');
    } finally { setStatusBusy(false); }
  };

  // Name, employee ID, CNIC and phone. A query that is only a number also
  // matches CNIC and phone ignoring their separators, so "3450228" finds
  // "34502-2892677-3" and "03001234" finds "0300 1234567". A query with
  // letters ("sm-010") never falls back to its digits, which would match
  // unrelated phone numbers.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = /^[\d\s-]+$/.test(q) ? digitsOf(q) : '';
    const matches = (e) => (
      !q ||
      e.name.toLowerCase().includes(q) ||
      (e.employee_code || '').toLowerCase().includes(q) ||
      (e.cnic || '').toLowerCase().includes(q) ||
      (e.phone || '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && (digitsOf(e.cnic).includes(qDigits) || digitsOf(e.phone).includes(qDigits)))
    );
    const rows = data.filter(e => (showStatus || e.status === statusFilter) && matches(e));
    return sortRows(rows, effectiveSort, COMPARATORS);
  }, [data, search, showStatus, statusFilter, effectiveSort]);

  const emptyState = search.trim()
    ? { icon: 'search_off', title: `No employee matches "${search.trim()}"`, desc: 'Check the spelling, or switch the filter to All.' }
    : statusFilter === 'Inactive'
      ? { icon: 'person_off', title: 'No inactive employees', desc: 'Deactivated employees are listed here. Their past sales and recoveries are kept.' }
      : statusFilter === 'Active'
        ? { icon: 'groups', title: 'No active employees', desc: 'Add a salesman or supplier, or reactivate one under Inactive.' }
        : { icon: 'groups', title: 'No employees yet', desc: 'Add the salesmen and suppliers who book and deliver invoices.' };

  const inactiveTitle = (e) => {
    const day = fmtDay(e.deactivated_on);
    if (!day) return undefined;
    return e.deactivated_by_name ? `Deactivated ${day} by ${e.deactivated_by_name}` : `Deactivated ${day}`;
  };

  return (
    <Layout title="Employees">
      <HrStyles />
      <div className="card">
        <div className="card-header">
          <div className="card-title">Employees</div>
          <div className="flex items-center gap-3">
            <Segmented
              ariaLabel="Filter by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { val: 'Active',   label: 'Active',   count: counts.Active },
                { val: 'Inactive', label: 'Inactive', count: counts.Inactive },
                { val: 'all',      label: 'All',      count: counts.all },
              ]}
            />
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">search</span>
              <input placeholder="Search name, ID, CNIC or phone" aria-label="Search employees by name, ID, CNIC or phone" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">person_add</span>
              Add Employee
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>{emptyState.icon}</span></div>
              <div className="empty-state-title">{emptyState.title}</div>
              <div className="empty-state-desc">{emptyState.desc}</div>
            </div>
          ) : (
            <div className="hr-table-scroll">
              <table className="hr-table">
                <thead>
                  <tr>
                    <SortableHeader column="employee_code" label="Employee ID" sortConfig={effectiveSort} onSort={handleSort} style={{ width: '14%' }} />
                    <SortableHeader column="name" label="Name" sortConfig={effectiveSort} onSort={handleSort} style={{ width: showStatus ? '15%' : '26%' }} />
                    <th style={{ width: '18%' }}>CNIC</th>
                    <th style={{ width: '16%' }}>Phone</th>
                    <SortableHeader column="role" label="Role" sortConfig={effectiveSort} onSort={handleSort} style={{ width: '14%' }} />
                    {showStatus && (
                      <SortableHeader column="status" label="Status" sortConfig={effectiveSort} onSort={handleSort} style={{ width: '11%' }} />
                    )}
                    <th style={{ textAlign: 'right' }}>
                      <span className="hr-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => {
                    const code = e.employee_code || `#${e.id}`;
                    const inactive = e.status === 'Inactive';
                    return (
                      <tr key={e.id}>
                        <td style={{ ...tabular, color: MUTED }}>{code}</td>
                        <td
                          className="hr-cell-strong"
                          style={{ whiteSpace: 'nowrap', ...(showStatus && inactive ? { color: MUTED } : null) }}
                        >
                          {e.name}
                        </td>
                        <td style={tabular}>{e.cnic || EMPTY_CELL}</td>
                        <td style={tabular}>{e.phone ? formatPhone(e.phone) : EMPTY_CELL}</td>
                        <td>
                          <span className={`badge ${e.role === 'Salesman' ? 'badge-blue' : 'badge-teal'}`}>{e.role}</span>
                        </td>
                        {showStatus && (
                          <td>
                            {inactive
                              ? <span title={inactiveTitle(e)}><StatusBadge status={e.status} /></span>
                              : <StatusBadge status={e.status} />}
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <KebabMenu
                            label={`Actions for ${e.name} (${code})`}
                            items={[
                              { label: 'Edit details', icon: 'edit', onClick: () => openEdit(e) },
                              inactive
                                ? { label: 'Reactivate', icon: 'person_check', onClick: () => openStatusDialog(e) }
                                : { label: 'Deactivate', icon: 'person_off', onClick: () => openStatusDialog(e) },
                              { divider: true },
                              {
                                label: 'Delete',
                                icon: 'delete',
                                danger: true,
                                disabled: !!e.in_use,
                                title: e.in_use ? 'Used on sales or recoveries. Deactivate instead.' : undefined,
                                onClick: () => { setSelected(e); setDeleteModal(true); },
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={modal} onClose={() => setModal(false)}
        title={editing ? 'Edit Employee' : 'Add Employee'} size="md"
        footer={
          <>
            {saveBlockedReason && (
              <span role="status" style={{ marginRight: 'auto', alignSelf: 'center', fontSize: 12.5, color: MUTED }}>
                {saveBlockedReason}
              </span>
            )}
            <button className="btn btn-outline" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !!saveBlockedReason}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add employee'}
            </button>
          </>
        }>
        <div className="hr-form-grid is-modal">
          <FormField label="Full name" htmlFor="emp-name" required col={12} error={errorFor('name')}>
            <input
              id="emp-name"
              className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
              placeholder="As printed on the CNIC"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              onBlur={() => markTouched('name')}
              autoFocus
            />
          </FormField>
          <FormField label="CNIC" htmlFor="emp-cnic" col={6} error={errorFor('cnic')}>
            <input
              id="emp-cnic"
              className={`form-control hr-mask${errorFor('cnic') ? ' hr-invalid' : ''}`}
              style={{ fontVariantNumeric: 'tabular-nums' }}
              placeholder="XXXXX-XXXXXXX-X"
              value={form.cnic}
              maxLength={15}
              onChange={e => handleCNICInput(e, val => setField('cnic', val))}
              onBlur={() => markTouched('cnic')}
            />
          </FormField>
          <FormField label="Phone" htmlFor="emp-phone" col={6} error={errorFor('phone')}>
            <input
              id="emp-phone"
              className={`form-control hr-mask${errorFor('phone') ? ' hr-invalid' : ''}`}
              style={{ fontVariantNumeric: 'tabular-nums' }}
              placeholder="03XX XXXXXXX"
              value={form.phone}
              maxLength={16}
              onChange={e => handlePhoneInput(e, val => setField('phone', val))}
              onBlur={() => markTouched('phone')}
            />
          </FormField>
          <FormField
            label="Role"
            htmlFor="emp-role"
            required
            col={12}
            error={errorFor('role')}
            help={roleLocked ? "Employee role can't change after linking sales or recoveries." : undefined}
          >
            <select
              id="emp-role"
              className={`form-control${errorFor('role') ? ' hr-invalid' : ''}`}
              value={form.role}
              disabled={roleLocked}
              onChange={e => setField('role', e.target.value)}
              onBlur={() => markTouched('role')}
            >
              {!form.role && <option value="">Select role</option>}
              <option value="Salesman">Salesman</option>
              <option value="Supplier">Supplier</option>
            </select>
          </FormField>
        </div>
      </Modal>

      <Modal
        isOpen={!!statusTarget}
        onClose={closeStatusDialog}
        title={deactivating ? `Deactivate ${statusTarget?.name}?` : `Reactivate ${statusTarget?.name}?`}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={closeStatusDialog} disabled={statusBusy}>Cancel</button>
            <button className={deactivating ? 'btn btn-danger' : 'btn btn-primary'} onClick={submitStatusChange} disabled={statusBusy}>
              {statusBusy
                ? (deactivating ? 'Deactivating…' : 'Reactivating…')
                : (deactivating ? 'Deactivate' : 'Reactivate')}
            </button>
          </>
        }
      >
        {deactivating ? (
          <Notice tone="warning">
            {statusTarget?.name} will be removed from sales, recovery and report lists. Past invoices
            and recoveries won't change.
          </Notice>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.55 }}>
            {statusTarget?.name} will appear in sales and recovery lists again.
          </p>
        )}
        {hrMismatch && (
          <Notice tone="neutral" style={{ marginTop: 12 }}>
            {deactivating ? (
              <>
                <strong>Still on payroll.</strong> {hrLink.name} (<span style={tabular}>{hrLink.employee_id}</span>) is
                still active in HR and will be included in future pay runs. If they have left the
                company, also deactivate them in HR.
              </>
            ) : (
              <>
                Their HR profile, {hrLink.name} (<span style={tabular}>{hrLink.employee_id}</span>), is
                inactive, so no salary is paid. If they have rejoined, reactivate them in Employees (HR)
                as well.
              </>
            )}
          </Notice>
        )}
        {statusError && (
          <Notice tone="danger" style={{ marginTop: 12 }}>{statusError}</Notice>
        )}
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete} loading={deleting}
        title={`Delete ${selected?.name}?`}
        message="The employee record will be removed permanently." />
    </Layout>
  );
}

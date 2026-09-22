import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { handleCNICInput, handlePhoneInput } from '../../utils/formatters';
import { todayPKT, addMonthsPKT } from '../../utils/dateUtils';
import {
  HrStyles, SortableHeader, useSort, sortRows, byText, Segmented, KebabMenu,
  TableSkeleton, EmptyState, BusyButton, StatusBadge, FormField,
  SearchSelect, apiError, apiFieldError, initials,
} from './HrKit';

// ─── HR employee roster ────────────────────────────────────────────────────
// The list is intentionally narrow (ID / Name / Designation / Department /
// Status) — everything else lives on the route-based detail page at
// /hr/employees/:id. A row click opens that page; the kebab holds the
// destructive and secondary actions.
//
// Creation stays a modal: it is a short "start a record" form, not a detail
// view, and the no-popups rule in the spec applies to viewing and editing an
// existing employee.

const COMPARATORS = {
  employee_id:      byText('employee_id'),
  name:             byText('name'),
  designation_name: byText('designation_name'),
  department_name:  byText('department_name'),
  status:           byText('status'),
};

const LEAVING_WINDOW_MONTHS = 3;

const emptyCreateForm = {
  name: '', cnic: '', mobile: '', date_of_joining: '',
  department_id: '', designation_id: '',
  is_field_employee: false,
  master_employee_id: '',
};

export default function HrEmployees() {
  const navigate = useNavigate();

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('Active');
  const [search, setSearch] = useState('');

  const [lookups, setLookups] = useState({ departments: [], designations: [], masters: [] });

  // Add-employee modal
  const [addOpen, setAddOpen]   = useState(false);
  const [mode, setMode]         = useState('blank'); // 'blank' | 'import'
  const [form, setForm]         = useState(emptyCreateForm);
  const [touched, setTouched]   = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving]     = useState(false);

  // Deactivate / reactivate modal
  const [statusTarget, setStatusTarget] = useState(null); // the employee row
  const [exitForm, setExitForm] = useState({ date_of_leaving: '', reason_for_leaving: '' });
  const [exitTouched, setExitTouched] = useState({});
  const [exitErrors, setExitErrors]   = useState({});
  const [statusBusy, setStatusBusy]   = useState(false);

  const { sortConfig, handleSort } = useSort('name');

  // The whole roster is loaded once and filtered in the browser, like
  // Customers.jsx — it keeps the Active/Inactive toggle instant and lets the
  // toggle show a count for each side.
  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get('/hr/employees', { params: { status: 'all' } })
      .then(r => setEmployees(r.data))
      .catch(err => setLoadError(apiError(err, 'Could not load the employee list.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lookups are only needed once the Add modal opens, so they are fetched
  // lazily rather than on every visit to the page.
  const loadLookups = useCallback(() => {
    Promise.all([
      api.get('/departments').catch(() => ({ data: [] })),
      api.get('/designations').catch(() => ({ data: [] })),
      api.get('/employees').catch(() => ({ data: [] })),
    ]).then(([dep, des, mas]) => {
      setLookups({ departments: dep.data, designations: des.data, masters: mas.data });
    });
  }, []);

  const counts = useMemo(() => ({
    all:      employees.length,
    Active:   employees.filter(e => e.status === 'Active').length,
    Inactive: employees.filter(e => e.status === 'Inactive').length,
  }), [employees]);

  // Under the Active or Inactive filter every row carries the same status, so
  // a Status column would be one word repeated down the page. It appears only
  // under "All", where it is the one thing that tells the rows apart.
  const showStatus = statusFilter === 'all';

  // Sorting by a column that is no longer on screen leaves the roster in an
  // order nothing visible explains, so the sort falls back to Name.
  const effectiveSort = useMemo(() => (
    !showStatus && sortConfig.column === 'status'
      ? { column: 'name', direction: 'asc' }
      : sortConfig
  ), [showStatus, sortConfig]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = showStatus ? employees : employees.filter(e => e.status === statusFilter);
    if (q) {
      rows = rows.filter(e => (
        e.name.toLowerCase().includes(q) ||
        (e.employee_id || '').toLowerCase().includes(q) ||
        (e.designation_name || '').toLowerCase().includes(q) ||
        (e.department_name || '').toLowerCase().includes(q)
      ));
    }
    return sortRows(rows, effectiveSort, COMPARATORS);
  }, [employees, showStatus, statusFilter, search, effectiveSort]);

  const { page, setPage, pageSize, setPageSize, totalPages, pageItems } = usePagination(filtered, 25);

  // ── Master Data rows already backing an HR profile can't be reused, so
  // they are filtered out of the import picker instead of failing on save.
  const linkedMasterIds = useMemo(
    () => new Set(employees.map(e => e.master_employee_id).filter(Boolean)),
    [employees]
  );
  const availableMasters = useMemo(
    () => lookups.masters.filter(m => !linkedMasterIds.has(m.id)),
    [lookups.masters, linkedMasterIds]
  );

  // ── Create ───────────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({ ...emptyCreateForm, date_of_joining: todayPKT() });
    setMode('blank');
    setTouched({});
    setServerErrors({});
    setAddOpen(true);
    loadLookups();
  };

  const setField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setServerErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };
  const markTouched = (key) => setTouched(prev => ({ ...prev, [key]: true }));

  // Pre-fill from the chosen Master Data row.
  //
  // The selected record is AUTHORITATIVE for the three imported fields: they
  // are always overwritten, including being cleared when the new record has no
  // value. Filling only blanks looked reasonable but was wrong — switching
  // from a record that had a CNIC to one that does not left the first
  // record's CNIC sitting in the form under the second record's name, silently
  // attributing one person's identity to another.
  const pickMaster = (masterId) => {
    const master = lookups.masters.find(m => String(m.id) === String(masterId));
    setForm(prev => ({
      ...prev,
      master_employee_id: masterId,
      name:   master ? (master.name  || '') : '',
      cnic:   master ? (master.cnic  || '') : '',
      mobile: master ? (master.phone || '') : '',
      // A Salesman or Supplier in Master Data is by definition out in the
      // field, so this is pre-ticked — still editable.
      is_field_employee: master ? true : prev.is_field_employee,
    }));
    // Clear any validation left over from the previous selection.
    setServerErrors({});
    setTouched(prev => ({ ...prev, name: false, cnic: false, mobile: false }));
  };

  const selectedMaster = useMemo(
    () => lookups.masters.find(m => String(m.id) === String(form.master_employee_id)) || null,
    [lookups.masters, form.master_employee_id]
  );

  const cnicDigits = form.cnic.replace(/\D/g, '');
  const createErrors = {
    master_employee_id: mode === 'import' && !form.master_employee_id
      ? 'Choose the Master Data record to import from'
      : null,
    name: !form.name.trim() ? 'Enter the employee’s full name' : null,
    mobile: !form.mobile.trim() ? 'A mobile number is required' : null,
    cnic: cnicDigits.length > 0 && cnicDigits.length !== 13
      ? `CNIC needs 13 digits — ${13 - cnicDigits.length} to go`
      : null,
    date_of_joining: !form.date_of_joining ? 'Pick the date this employee joined' : null,
    department_id: !form.department_id ? 'Choose a department' : null,
    designation_id: !form.designation_id ? 'Choose a designation' : null,
  };
  const createBlocked = Object.values(createErrors).some(Boolean);
  const errorFor = (key) => serverErrors[key] || (touched[key] ? createErrors[key] : null);

  const handleCreate = async () => {
    // Touch everything so every outstanding problem is visible at once,
    // rather than one toast at a time.
    setTouched({
      master_employee_id: true, name: true, mobile: true, cnic: true,
      date_of_joining: true, department_id: true, designation_id: true,
    });
    if (createBlocked) return;

    setSaving(true);
    setServerErrors({});
    try {
      const payload = {
        name: form.name.trim(),
        cnic: form.cnic.trim() || null,
        mobile: form.mobile.trim(),
        date_of_joining: form.date_of_joining,
        department_id: form.department_id,
        designation_id: form.designation_id,
        is_field_employee: form.is_field_employee,
        master_employee_id: mode === 'import' ? form.master_employee_id : null,
      };
      const res = await api.post('/hr/employees', payload);
      toast.success(`${payload.name} added as ${res.data.employee_id}`);
      setAddOpen(false);
      load();
      // Straight into the profile so the rest of the record can be filled in.
      navigate(`/hr/employees/${res.data.id}`);
    } catch (err) {
      const mapped = apiFieldError(err);
      if (mapped) setServerErrors(mapped);
      else toast.error(apiError(err, 'Could not add this employee.'));
    } finally {
      setSaving(false);
    }
  };

  // ── Status change ────────────────────────────────────────────────────────
  const openStatusChange = (employee) => {
    setStatusTarget(employee);
    setExitForm({ date_of_leaving: todayPKT(), reason_for_leaving: '' });
    setExitTouched({});
    setExitErrors({});
  };

  const today = todayPKT();
  const oldestLeaving = addMonthsPKT(today, -LEAVING_WINDOW_MONTHS);

  // Mirrors the server rule exactly (hrEmployees.js validateExitRecord) so the
  // user is never surprised by a rejection after submitting. No future dates:
  // an employee is deactivated once they have actually gone.
  const exitValidation = {
    date_of_leaving: !exitForm.date_of_leaving
      ? 'A date of leaving is required'
      : exitForm.date_of_leaving > today
        ? 'Cannot be in the future — deactivate the employee once they have actually left'
        : exitForm.date_of_leaving < oldestLeaving
          ? `Cannot be backdated more than ${LEAVING_WINDOW_MONTHS} months — no earlier than ${oldestLeaving}`
          : null,
    reason_for_leaving: !exitForm.reason_for_leaving.trim()
      ? 'Record why this employee is leaving'
      : null,
  };
  const deactivating = statusTarget?.status === 'Active';
  const exitBlocked = deactivating && Object.values(exitValidation).some(Boolean);
  const exitErrorFor = (key) => exitErrors[key] || (exitTouched[key] ? exitValidation[key] : null);

  const submitStatusChange = async () => {
    if (deactivating) {
      setExitTouched({ date_of_leaving: true, reason_for_leaving: true });
      if (exitBlocked) return;
    }
    setStatusBusy(true);
    setExitErrors({});
    try {
      // The full profile is re-read first: PUT /:id replaces every column, so
      // sending only the status fields would blank the rest of the record.
      const { data: full } = await api.get(`/hr/employees/${statusTarget.id}`);
      const payload = {
        ...full,
        status: deactivating ? 'Inactive' : 'Active',
        date_of_leaving:    deactivating ? exitForm.date_of_leaving : null,
        reason_for_leaving: deactivating ? exitForm.reason_for_leaving.trim() : null,
      };
      // employee_id is read-only server-side and rejected if present and
      // different — it is dropped rather than echoed back.
      delete payload.employee_id;

      await api.put(`/hr/employees/${statusTarget.id}`, payload);
      toast.success(
        deactivating
          ? `${statusTarget.name} deactivated`
          : `${statusTarget.name} is active again`
      );
      setStatusTarget(null);
      load();
    } catch (err) {
      const mapped = apiFieldError(err);
      if (mapped) setExitErrors(mapped);
      else toast.error(apiError(err, 'Could not update this employee.'));
    } finally {
      setStatusBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const openProfile = (id) => navigate(`/hr/employees/${id}`);

  return (
    <Layout title="Employees">
      <HrStyles />

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Workforce</div>
            <div className="text-sm text-muted mt-1">
              {loading
                ? 'Loading…'
                : `${counts.Active} active · ${counts.Inactive} inactive`}
            </div>
          </div>
          <div className="hr-toolbar">
            <Segmented
              ariaLabel="Filter by employment status"
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
              <label className="hr-sr-only" htmlFor="hr-emp-search">Search employees</label>
              <input
                id="hr-emp-search"
                placeholder="Search by name, ID or role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">person_add</span>
              Add Employee
            </button>
            {/* Departments and Designations are configuration for the two
                dropdowns on a profile, so they are reached from here rather
                than from two sidebar entries of their own. */}
            <KebabMenu
              label="Workforce settings"
              items={[
                {
                  label: 'Departments',
                  icon: 'corporate_fare',
                  onClick: () => navigate('/hr/departments'),
                },
                {
                  label: 'Designations',
                  icon: 'badge',
                  onClick: () => navigate('/hr/designations'),
                },
              ]}
            />
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <TableSkeleton columns={5} rows={7} />
          ) : loadError ? (
            <EmptyState
              icon="cloud_off"
              title="Could not load the workforce"
              desc={loadError}
              action={<button className="btn btn-outline" onClick={load}>Try again</button>}
            />
          ) : employees.length === 0 ? (
            <EmptyState
              icon="groups"
              title="No employees yet"
              desc="Add your first employee to start tracking attendance, salary structures and payroll. You can import their name and CNIC straight from an existing Sales or Delivery record."
              action={<button className="btn btn-primary" onClick={openAdd}>Add your first employee</button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="search_off"
              title={search.trim() ? `Nobody matches "${search.trim()}"` : `No ${statusFilter.toLowerCase()} employees`}
              desc={
                search.trim()
                  ? 'Try a different spelling, or widen the status filter to include everyone.'
                  : statusFilter === 'Inactive'
                    ? 'Nobody has left yet. Employees appear here once they are deactivated with a leaving date and reason.'
                    : 'Every employee on file is currently inactive. Switch the filter to see them.'
              }
              action={
                search.trim()
                  ? <button className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>
                  : <button className="btn btn-outline" onClick={() => setStatusFilter('all')}>Show everyone</button>
              }
              small
            />
          ) : (
            <>
              <div className="hr-table-scroll">
                <table className="hr-table">
                  <thead>
                    <tr>
                      <SortableHeader column="employee_id" label="Employee ID" sortConfig={effectiveSort} onSort={handleSort} style={{ width: showStatus ? '14%' : '15%' }} />
                      <SortableHeader column="name" label="Name" sortConfig={effectiveSort} onSort={handleSort} style={{ width: showStatus ? '30%' : '34%' }} />
                      <SortableHeader column="designation_name" label="Designation" sortConfig={effectiveSort} onSort={handleSort} style={{ width: showStatus ? '20%' : '22%' }} />
                      <SortableHeader column="department_name" label="Department" sortConfig={effectiveSort} onSort={handleSort} style={{ width: showStatus ? '19%' : '23%' }} />
                      {showStatus && (
                        <SortableHeader column="status" label="Status" sortConfig={effectiveSort} onSort={handleSort} style={{ width: '11%' }} />
                      )}
                      <th style={{ width: '6%', textAlign: 'right' }}>
                        <span className="hr-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(employee => (
                      <tr
                        key={employee.id}
                        className="hr-row-click"
                        tabIndex={0}
                        onClick={() => openProfile(employee.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); openProfile(employee.id); }
                        }}
                        title={`Open ${employee.name}'s profile`}
                      >
                        <td className="hr-code">{employee.employee_id}</td>
                        <td>
                          {/* Avatar, name and the annotation on that name are
                              one block: three facts about one person, bound
                              tightly rather than spread across the cell. */}
                          <div className="hr-identity-cell">
                            <span className="hr-avatar hr-avatar-sm" aria-hidden="true">
                              {initials(employee.name)}
                            </span>
                            <span className="hr-identity-text">
                              <span className="hr-cell-strong" style={{ display: 'block' }}>{employee.name}</span>
                              {employee.is_field_employee
                                ? <span className="hr-cell-sub">Field staff</span>
                                : null}
                            </span>
                          </div>
                        </td>
                        <td>{employee.designation_name}</td>
                        {/* Plain text, not a pill: a lozenge on every row made
                            the department column outweigh the status beside
                            it, which is the column that actually varies. */}
                        <td className="hr-cell-muted">{employee.department_name}</td>
                        {showStatus && <td><StatusBadge status={employee.status} /></td>}
                        <td style={{ textAlign: 'right' }}>
                          <KebabMenu
                            label={`Actions for ${employee.name}`}
                            items={[
                              { label: 'View profile', icon: 'visibility', onClick: () => openProfile(employee.id) },
                              {
                                label: 'Edit details',
                                icon: 'edit',
                                onClick: () => navigate(`/hr/employees/${employee.id}`, { state: { edit: true } }),
                              },
                              employee.status === 'Active'
                                ? { label: 'Deactivate', icon: 'person_off', danger: true, onClick: () => openStatusChange(employee) }
                                : { label: 'Reactivate', icon: 'person_check', onClick: () => openStatusChange(employee) },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize}
                onPageChange={setPage} onPageSizeChange={setPageSize}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Add employee ──────────────────────────────────────────────── */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Employee"
        size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <BusyButton busy={saving} busyLabel="Creating…" onClick={handleCreate}>
              Create employee
            </BusyButton>
          </>
        }
      >
        {/* Blank vs import. Importing links the profile to a Master Data
            Salesman/Supplier, which is what makes sales-target achievement
            computable later on. */}
        <div className="form-group hr-form-group">
          <span className="form-label">Record source</span>
          <div className="hr-segment" role="group" aria-label="Creation mode" style={{ width: '100%' }}>
            <button
              type="button"
              className={`hr-segment-btn${mode === 'blank' ? ' is-active' : ''}`}
              style={{ flex: 1 }}
              aria-pressed={mode === 'blank'}
              onClick={() => { setMode('blank'); setField('master_employee_id', ''); }}
            >
              New record
            </button>
            <button
              type="button"
              className={`hr-segment-btn${mode === 'import' ? ' is-active' : ''}`}
              style={{ flex: 1 }}
              aria-pressed={mode === 'import'}
              onClick={() => setMode('import')}
            >
              Import from Master Data
            </button>
          </div>
        </div>

        {mode === 'import' && (
          <div className="hr-form-grid is-modal">
          <FormField
            label="Master Data record"
            htmlFor="hr-master"
            required
            col={12}
            error={errorFor('master_employee_id')}
            help={
              availableMasters.length === 0
                ? 'Every Master Data employee is already linked to an HR profile.'
                : undefined
            }
          >
            <SearchSelect
              id="hr-master"
              options={availableMasters}
              value={form.master_employee_id}
              onChange={pickMaster}
              onBlur={() => markTouched('master_employee_id')}
              placeholder="Search Salesmen and Suppliers…"
              emptyText="No unlinked Master Data employee matches"
              invalid={!!errorFor('master_employee_id')}
              getLabel={(m) => `${m.name} — ${m.role}`}
              renderOption={(m) => (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span className="badge badge-gray" style={{ marginLeft: 'auto' }}>{m.role}</span>
                </span>
              )}
            />
          </FormField>
          </div>
        )}

        {selectedMaster && mode === 'import' && (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">link</span>
            <span>
              Linked to <strong>{selectedMaster.name}</strong> ({selectedMaster.role}).
              {selectedMaster.role === 'Salesman'
                ? ' Targets will be measured from the invoices booked each month.'
                : ' Targets will be measured from the recoveries collected each month.'}
            </span>
          </div>
        )}

        <div className="divider" style={{ margin: '0 0 12px' }} />

        {/* Two columns on the 12-column track (6 + 6), not three. At 620px of
            modal a third column squeezed every control to ~170px, which is
            narrower than the data most of them hold. The name and the
            designation take a full row each because both are long strings
            whose value should never be read in a narrow box.

            Placeholders carry the expected format, so no field needs a line of
            grey helper text under it — the message slot is reserved for
            validation. */}
        <div className="hr-form-grid is-modal">
          {/* Row 1 */}
          <FormField label="Full name" htmlFor="hr-name" required error={errorFor('name')} col={12}>
            <input
              id="hr-name"
              className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
              placeholder="Full name as printed on CNIC"
              value={form.name}
              maxLength={200}
              onChange={e => setField('name', e.target.value)}
              onBlur={() => markTouched('name')}
            />
          </FormField>

          {/* Row 2 */}
          <FormField label="CNIC" htmlFor="hr-cnic" error={errorFor('cnic')} col={6}>
            <input
              id="hr-cnic"
              className={`form-control mono hr-mask${errorFor('cnic') ? ' hr-invalid' : ''}`}
              placeholder="XXXXX-XXXXXXX-X"
              value={form.cnic}
              maxLength={15}
              onChange={e => handleCNICInput(e, (val) => setField('cnic', val))}
              onBlur={() => markTouched('cnic')}
            />
          </FormField>

          <FormField label="Mobile" htmlFor="hr-mobile" required error={errorFor('mobile')} col={6}>
            <input
              id="hr-mobile"
              className={`form-control hr-mask${errorFor('mobile') ? ' hr-invalid' : ''}`}
              placeholder="03XX XXXXXXX"
              value={form.mobile}
              maxLength={16}
              onChange={e => handlePhoneInput(e, (val) => setField('mobile', val))}
              onBlur={() => markTouched('mobile')}
            />
          </FormField>

          {/* Row 3 */}
          <FormField label="Date of joining" htmlFor="hr-doj" required error={errorFor('date_of_joining')} col={6}>
            <input
              id="hr-doj"
              type="date"
              className={`form-control${errorFor('date_of_joining') ? ' hr-invalid' : ''}`}
              value={form.date_of_joining}
              max={todayPKT()}
              onChange={e => setField('date_of_joining', e.target.value)}
              onBlur={() => markTouched('date_of_joining')}
            />
          </FormField>

          <FormField label="Department" htmlFor="hr-dept" required error={errorFor('department_id')} col={6}>
            <select
              id="hr-dept"
              className={`form-control${errorFor('department_id') ? ' hr-invalid' : ''}`}
              value={form.department_id}
              onChange={e => setField('department_id', e.target.value)}
              onBlur={() => markTouched('department_id')}
            >
              <option value="">Select department</option>
              {lookups.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FormField>

          {/* Row 4 */}
          <FormField label="Designation" htmlFor="hr-desig" required error={errorFor('designation_id')} col={12}>
            <select
              id="hr-desig"
              className={`form-control${errorFor('designation_id') ? ' hr-invalid' : ''}`}
              value={form.designation_id}
              onChange={e => setField('designation_id', e.target.value)}
              onBlur={() => markTouched('designation_id')}
            >
              <option value="">Select designation</option>
              {lookups.designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FormField>
        </div>

        {(lookups.departments.length === 0 || lookups.designations.length === 0) && (
          <div className="alert alert-warning" style={{ marginTop: 16 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">warning</span>
            <span>
              {lookups.departments.length === 0 && lookups.designations.length === 0
                ? 'No departments or designations exist yet. Add them under Departments and Designations first.'
                : lookups.departments.length === 0
                  ? 'No departments exist yet. Add one under Departments first.'
                  : 'No designations exist yet. Add one under Designations first.'}
            </span>
          </div>
        )}

        {/* No top margin: the grid above already reserves 20px of message
            slot under its last input, so the rule sits 20px below the field
            and 16px above the banner. The default 16px put it at 36/16. */}
        <div className="divider" style={{ margin: '0 0 16px' }} />

        {/* A decision with a consequence attached, so it is boxed as one
            rather than left floating under the last input. */}
        <label className="hr-checkbanner" htmlFor="hr-field-emp">
          <input
            id="hr-field-emp"
            type="checkbox"
            checked={form.is_field_employee}
            onChange={e => setField('is_field_employee', e.target.checked)}
          />
          <span>
            <span className="hr-checkbanner-title">Field staff</span>
            <span className="hr-checkbanner-note">
              Works outside the office. Enables a monthly sales target and area
              tagging on attendance.
            </span>
          </span>
        </label>
      </Modal>

      {/* ── Deactivate / reactivate ───────────────────────────────────── */}
      <Modal
        isOpen={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        title={deactivating ? `Deactivate ${statusTarget?.name}` : `Reactivate ${statusTarget?.name}`}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setStatusTarget(null)} disabled={statusBusy}>Cancel</button>
            <BusyButton
              busy={statusBusy}
              busyLabel={deactivating ? 'Deactivating…' : 'Reactivating…'}
              className={deactivating ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={submitStatusChange}
            >
              {deactivating ? 'Deactivate employee' : 'Reactivate employee'}
            </BusyButton>
          </>
        }
      >
        {deactivating ? (
          <div className="hr-form-grid is-modal">
            <div className="hr-col-12">
              <div className="alert alert-warning" style={{ marginBottom: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">info</span>
                <span>
                  Their record, attendance history and issued payslips are all
                  retained — they simply stop appearing in the active roster and
                  in payroll.
                </span>
              </div>
            </div>

            <FormField
              label="Date of leaving"
              htmlFor="exit-date"
              required
              col={12}
              error={exitErrorFor('date_of_leaving')}
            >
              <input
                id="exit-date"
                type="date"
                className={`form-control${exitErrorFor('date_of_leaving') ? ' hr-invalid' : ''}`}
                value={exitForm.date_of_leaving}
                min={oldestLeaving}
                max={today}
                onChange={e => {
                  setExitForm(p => ({ ...p, date_of_leaving: e.target.value }));
                  setExitErrors(p => ({ ...p, date_of_leaving: undefined }));
                }}
                onBlur={() => setExitTouched(p => ({ ...p, date_of_leaving: true }))}
              />
            </FormField>

            <FormField
              label="Reason for leaving"
              htmlFor="exit-reason"
              required
              col={12}
              error={exitErrorFor('reason_for_leaving')}
            >
              <textarea
                id="exit-reason"
                className={`form-control${exitErrorFor('reason_for_leaving') ? ' hr-invalid' : ''}`}
                rows={3}
                placeholder="Resignation, end of contract, relocation…"
                value={exitForm.reason_for_leaving}
                onChange={e => {
                  setExitForm(p => ({ ...p, reason_for_leaving: e.target.value }));
                  setExitErrors(p => ({ ...p, reason_for_leaving: undefined }));
                }}
                onBlur={() => setExitTouched(p => ({ ...p, reason_for_leaving: true }))}
              />
            </FormField>
          </div>
        ) : (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">person_check</span>
            <span>
              {statusTarget?.name} will return to the active roster and their
              recorded leaving date and reason will be cleared.
            </span>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import {
  HrStyles, SortableHeader, useSort, sortRows, byText, byNumber,
  TableSkeleton, EmptyState, KebabMenu, BusyButton, apiError, apiFieldError,
} from './HrKit';

// ─── Single-field lookup CRUD ──────────────────────────────────────────────
// Departments and Designations are the same screen with different nouns, so
// they share one implementation rather than two files that drift apart. Both
// keep the table + modal pattern used elsewhere in the app for simple lookups
// (Geography.jsx's Cities tab, expense types) — a route-based detail page
// would be overkill for a single `name` column.

const COMPARATORS = {
  name: byText('name'),
  employee_count: byNumber('employee_count'),
};

export default function LookupCrudPage({
  title,           // "Departments"
  singular,        // "department"
  icon,            // material symbol
  endpoint,        // "/departments"
  addHint,         // helper text under the name field
  examples,        // shown in the first-run empty state
  embedded = false, // rendered inside another page (JobSetup's tabs)
}) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch]   = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [name, setName]           = useState('');
  const [touched, setTouched]     = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving]       = useState(false);

  const [deleting, setDeleting]     = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { sortConfig, handleSort } = useSort('name');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get(endpoint)
      .then(r => setRows(r.data))
      .catch(err => setLoadError(apiError(err, `Could not load ${title.toLowerCase()}.`)))
      .finally(() => setLoading(false));
  }, [endpoint, title]);

  useEffect(() => { load(); }, [load]);

  // ── Validation, evaluated as the user types so the inline message and the
  // Save button agree at all times.
  const trimmed = name.trim();
  const duplicate = useMemo(() => rows.some(r => (
    r.name.toLowerCase() === trimmed.toLowerCase() && (!editing || r.id !== editing.id)
  )), [rows, trimmed, editing]);

  const validationError = !trimmed
    ? `Enter a ${singular} name`
    : duplicate
      ? `"${trimmed}" already exists`
      : null;

  const showError = fieldError || (touched ? validationError : null);
  const canSave = !validationError && !saving;

  const openAdd = () => {
    setEditing(null); setName(''); setTouched(false); setFieldError(null); setModalOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row); setName(row.name); setTouched(false); setFieldError(null); setModalOpen(true);
  };

  const handleSave = async () => {
    setTouched(true);
    if (validationError) return;
    setSaving(true);
    setFieldError(null);
    try {
      if (editing) {
        await api.put(`${endpoint}/${editing.id}`, { name: trimmed });
        toast.success(`${trimmed} updated`);
      } else {
        await api.post(endpoint, { name: trimmed });
        toast.success(`${trimmed} added`);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      const mapped = apiFieldError(err);
      const message = apiError(err, `Could not save the ${singular}.`);
      if (mapped) setFieldError(Object.values(mapped)[0]);
      else if (err?.response?.status === 409) setFieldError(message);
      else toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      await api.delete(`${endpoint}/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (err) {
      // 409 = still referenced by employees; the server message names the
      // count, so it is shown as-is rather than replaced with generic copy.
      toast.error(apiError(err, `Could not delete the ${singular}.`));
    } finally {
      setDeleteBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
    return sortRows(matched, sortConfig, COMPARATORS);
  }, [rows, search, sortConfig]);

  const { page, setPage, pageSize, setPageSize, totalPages, pageItems } = usePagination(filtered, 25);

  // In embedded mode the surrounding page owns the Layout, the title and the
  // stylesheet, so only this screen's own content is returned. It is a plain
  // variable, not a wrapper component defined in the body — that would be a
  // new component type on every render, remounting the table and dropping
  // focus out of the search box on each keystroke.
  const content = (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{title}</div>
            <div className="text-sm text-muted mt-1">
              {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? singular : `${singular}s`}`}
            </div>
          </div>
          <div className="hr-toolbar">
            {rows.length > 0 && (
              <div className="search-bar">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">search</span>
                <label className="hr-sr-only" htmlFor="lookup-search">Search {title}</label>
                <input
                  id="lookup-search"
                  placeholder={`Search ${title.toLowerCase()}…`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            )}
            <button className="btn btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">add</span>
              Add {singular.charAt(0).toUpperCase() + singular.slice(1)}
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <TableSkeleton columns={3} rows={5} />
          ) : loadError ? (
            <EmptyState
              icon="cloud_off"
              title="Could not load this list"
              desc={loadError}
              action={<button className="btn btn-outline" onClick={load}>Try again</button>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={icon}
              title={`No ${title.toLowerCase()} yet`}
              desc={`${title} group your employees on their profile${examples ? ` — for example ${examples}.` : '.'} Add the first one to start building employee records.`}
              action={
                <button className="btn btn-primary" onClick={openAdd}>
                  Add your first {singular}
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="search_off"
              title={`No ${singular} matches "${search.trim()}"`}
              desc="Check the spelling, or clear the search to see the whole list."
              action={<button className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>}
              small
            />
          ) : (
            <>
              <table className="hr-table">
                <thead>
                  <tr>
                    <SortableHeader column="name" label="Name" sortConfig={sortConfig} onSort={handleSort} style={{ width: '58%' }} />
                    <SortableHeader column="employee_count" label="Employees" sortConfig={sortConfig} onSort={handleSort} align="right" style={{ width: '22%' }} />
                    <th style={{ width: '20%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(row => (
                    <tr key={row.id}>
                      <td className="hr-cell-strong">{row.name}</td>
                      <td className="hr-num">
                        {row.employee_count > 0
                          ? row.employee_count
                          : <span style={{ color: 'var(--gray-300)' }}>0</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu
                          label={`Actions for ${row.name}`}
                          items={[
                            { label: 'Rename', icon: 'edit', onClick: () => openEdit(row) },
                            { label: 'Delete', icon: 'delete', danger: true, onClick: () => setDeleting(row) },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize}
                onPageChange={setPage} onPageSizeChange={setPageSize}
              />
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Rename ${singular}` : `Add ${singular}`}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
            <BusyButton
              busy={saving}
              busyLabel="Saving…"
              disabled={!canSave}
              onClick={handleSave}
            >
              {editing ? 'Save changes' : `Add ${singular}`}
            </BusyButton>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lookup-name">
            {singular.charAt(0).toUpperCase() + singular.slice(1)} name
            <span className="hr-required" aria-hidden="true">*</span>
          </label>
          <input
            id="lookup-name"
            className={`form-control${showError ? ' hr-invalid' : ''}`}
            value={name}
            autoFocus
            maxLength={200}
            onChange={e => { setName(e.target.value); setFieldError(null); }}
            onBlur={() => setTouched(true)}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave(); }}
            aria-invalid={showError ? true : undefined}
          />
          {showError
            ? (
              <div className="hr-error" role="alert">
                <span className="material-symbols-outlined" aria-hidden="true">error</span>
                <span>{showError}</span>
              </div>
            )
            : <div className="hr-help">{addHint}</div>}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        title={`Delete ${singular}`}
        message={
          deleting && deleting.employee_count > 0
            ? `"${deleting.name}" is assigned to ${deleting.employee_count} employee${deleting.employee_count === 1 ? '' : 's'}. Move them to another ${singular} first — this delete will be refused.`
            : `Delete "${deleting?.name}"? No employee is using it, so nothing else will change.`
        }
      />
    </>
  );

  if (embedded) return content;
  return <Layout title={title}><HrStyles />{content}</Layout>;
}

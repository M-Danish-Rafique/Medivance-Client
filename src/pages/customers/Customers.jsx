import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatPhone, handlePhoneInput } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const emptyForm = {
  name: '', address: '', phone: '', license_no: '', license_expiry: '',
  city_id: '', area_id: '', territory_id: '', is_licensed: false
};

// Customer segmentation. "Licensed" covers outlets that legally require a
// pharmacy/drug license to sell pharmaceuticals (Pharmacies & Medical
// Stores). "Non-Licensed" covers general trade outlets that stock a limited,
// non-prescription range without holding a pharmacy license (Marts,
// General Stores & Grocery Stores).
const CUSTOMER_TYPE_LABEL = {
  licensed: 'Licensed',
  unlicensed: 'Non-Licensed'
};

// Guards against stale/garbage "0" values that may exist in old license_no
// data — treated the same as "no value" rather than displayed literally.
function cleanLicenseNo(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  return trimmed === '0' ? '' : trimmed;
}

// Guards against invalid MySQL zero-dates ("0000-00-00") or other
// placeholder date values that would otherwise render as "0" or a bogus
// date once passed through the date formatter.
function cleanLicenseExpiry(value) {
  if (!value) return '';
  const str = String(value);
  return /^0000-00-00/.test(str) ? '' : str;
}

export default function Customers() {
  const [data, setData] = useState([]);
  const [geo, setGeo] = useState({ cities: [], areas: [], territories: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'licensed' | 'unlicensed'
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [viewCustomer, setViewCustomer] = useState(null);
  const [subModal, setSubModal] = useState(null);
  const [subForm, setSubForm] = useState({});
  const [subSaving, setSubSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/customers'), api.get('/geography/geo')])
      .then(([c, g]) => { setData(c.data); setGeo(g.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const filteredAreas = geo.areas.filter(a => !form.city_id || a.city_id === parseInt(form.city_id));
  const filteredTerritories = geo.territories.filter(t => !form.area_id || t.area_id === parseInt(form.area_id));

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({
      name: item.name, address: item.address || '', phone: item.phone || '',
      license_no: cleanLicenseNo(item.license_no), license_expiry: item.license_expiry ? item.license_expiry.split('T')[0] : '',
      city_id: item.city_id || '', area_id: item.area_id || '', territory_id: item.territory_id || '',
      is_licensed: !!item.is_licensed
    });
    setModal(true);
  };

  const openView = (item) => {
    setViewCustomer(item);
    setViewModal(true);
  };

  const handleSave = async () => {
    if (!form.name) return toast.error('Customer name required');
    setSaving(true);
    try {
      if (selected) { await api.put(`/customers/${selected.id}`, form); toast.success('Customer updated'); }
      else { await api.post('/customers', form); toast.success('Customer added'); }
      setModal(false); load();
    } catch (err) {
      const message = err.response?.data?.message || 'Error saving';
      toast.error(message);
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/customers/${selected.id}`);
      toast.success('Customer deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const saveSubCity = async () => {
    if (!subForm.name) return toast.error('City name required');
    setSubSaving(true);
    try {
      const r = await api.post('/geography/cities', { name: subForm.name });
      const newGeo = await api.get('/geography/geo');
      setGeo(newGeo.data);
      setForm(p => ({ ...p, city_id: r.data.id, area_id: '', territory_id: '' }));
      setSubModal(null); toast.success('City added');
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSubSaving(false); }
  };

  const saveSubArea = async () => {
    if (!subForm.name || !subForm.city_id) return toast.error('City and name required');
    setSubSaving(true);
    try {
      const r = await api.post('/geography/areas', subForm);
      const newGeo = await api.get('/geography/geo');
      setGeo(newGeo.data);
      setForm(p => ({ ...p, city_id: subForm.city_id, area_id: r.data.id, territory_id: '' }));
      setSubModal(null); toast.success('Area added');
    } catch (err) { toast.error('Error'); } finally { setSubSaving(false); }
  };

  const saveSubTerritory = async () => {
    if (!subForm.name || !subForm.area_id) return toast.error('Area and name required');
    setSubSaving(true);
    try {
      const r = await api.post('/geography/territories', subForm);
      const newGeo = await api.get('/geography/geo');
      setGeo(newGeo.data);
      setForm(p => ({ ...p, area_id: subForm.area_id, territory_id: r.data.id }));
      setSubModal(null); toast.success('Territory added');
    } catch (err) { toast.error('Error'); } finally { setSubSaving(false); }
  };

  const filtered = data
    .filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.area_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.territory_name || '').toLowerCase().includes(search.toLowerCase())
    )
    .filter(c => {
      if (typeFilter === 'licensed') return !!c.is_licensed;
      if (typeFilter === 'unlicensed') return !c.is_licensed;
      return true;
    });
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedCustomers } = usePagination(filtered, 25);

  return (
    <Layout title="Customers">
      <style>{`
        .mv-customers-table { table-layout: fixed; width: 100%; }
        .mv-customer-name { font-weight: 600; font-size: 14px; line-height: 1.3; }
        .mv-customer-id { font-weight: 500; font-size: 12.5px; color: var(--gray-400, #9ca3af); }
        .mv-customer-sub { font-size: 12px; color: var(--gray-500); margin-top: 2px; }
        .mv-customers-table tbody tr { transition: background-color 0.12s ease; }
        .mv-customers-table tbody tr.mv-clickable-row { cursor: pointer; }
        .mv-customers-table tbody tr:hover { background-color: var(--gray-50, #f9fafb); }
        .mv-balance-cell { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13.5px; }
        .mv-type-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 600; white-space: nowrap;
        }
        .mv-type-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      `}</style>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Customers</div>
            <div className="text-sm text-muted mt-1">{data.length} customers registered</div>
          </div>
          <div className="flex items-center gap-3">
            {/* Type filter */}
            <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
              {[{ val: 'all', label: 'All' }, { val: 'licensed', label: 'Licensed' }, { val: 'unlicensed', label: 'Non-Licensed' }].map(t => (
                <button key={t.val}
                  type="button"
                  onClick={() => setTypeFilter(t.val)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: typeFilter === t.val ? 'white' : 'transparent',
                    color: typeFilter === t.val ? 'var(--navy)' : 'var(--gray-500)',
                    boxShadow: typeFilter === t.val ? 'var(--shadow-sm)' : 'none',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search by name, area, territory..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Customer</button>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>groups</span></div><div className="empty-state-title">No customers found</div></div>
          ) : (
            <table className="mv-customers-table">
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>Customer</th>
                  <th style={{ width: '16%' }}>Area</th>
                  <th style={{ width: '16%' }}>Territory</th>
                  <th style={{ width: '12%' }}>Type</th>
                  <th style={{ width: '12%', textAlign: 'right' }}>Balance</th>
                  <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedCustomers.map(c => {
                  return (
                    <tr key={c.id} className="mv-clickable-row" onClick={() => openView(c)}>
                      <td>
                        <div className="mv-customer-name">{c.name}</div>
                      </td>
                      <td>{c.area_name ? <span className="badge badge-blue">{c.area_name}</span> : <span className="mv-customer-sub">—</span>}</td>
                      <td>{c.territory_name ? <span className="badge badge-teal">{c.territory_name}</span> : <span className="mv-customer-sub">—</span>}</td>
                      <td>
                        <span
                          className="mv-type-badge"
                          style={{
                            color: c.is_licensed ? '#047857' : '#6b7280',
                            background: c.is_licensed ? 'rgba(5,150,105,0.12)' : 'var(--gray-100, #f3f4f6)'
                          }}
                        >
                          <span className="mv-type-dot" style={{ background: c.is_licensed ? '#059669' : '#9ca3af' }} />
                          {c.is_licensed ? CUSTOMER_TYPE_LABEL.licensed : CUSTOMER_TYPE_LABEL.unlicensed}
                        </span>
                      </td>
                      <td className="mv-balance-cell" style={{ textAlign: 'right', color: parseFloat(c.balance) > 0 ? 'var(--red)' : 'var(--green)' }}>
                        {formatCurrency(c.balance)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          <button className="btn btn-outline btn-sm btn-icon" title="Edit customer" aria-label="Edit customer" onClick={() => openEdit(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                          <button className="btn btn-danger btn-sm btn-icon" title="Delete customer" aria-label="Delete customer" onClick={() => { setSelected(c); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
          pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <Modal isOpen={modal} onClose={() => setModal(false)} title={selected ? 'Edit Customer' : 'Add Customer'} size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Customer'}</button></>}>
        <div className="form-group">
          <label className="form-label">Customer Name *</label>
          <input className="form-control" placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-control" placeholder="0308 8421202" value={form.phone} onChange={e => handlePhoneInput(e, (v) => setForm(p => ({ ...p, phone: v })))} maxLength={16} />
          </div>
          <div className="form-group">
            <label className="form-label">Address</label>
            <input className="form-control" placeholder="Street address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
          </div>
        </div>

        <div className="divider" />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Customer Type</div>

        <div className="form-group">
          <div
            className="flex items-center justify-between"
            style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 12px' }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {form.is_licensed ? CUSTOMER_TYPE_LABEL.licensed : CUSTOMER_TYPE_LABEL.unlicensed}
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                {form.is_licensed
                  ? 'Customer holds a valid drug/pharmacy license.'
                  : 'General trade outlet.'}
              </div>
            </div>
            <div className="flex gap-2" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className={form.is_licensed ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
                onClick={() => setForm(p => ({ ...p, is_licensed: false }))}
              >
                Non-Licensed
              </button>
              <button
                type="button"
                className={form.is_licensed ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                onClick={() => setForm(p => ({ ...p, is_licensed: true }))}
              >
                Licensed
              </button>
            </div>
          </div>
        </div>

        {form.is_licensed && (
          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">License No</label>
              <input className="form-control" placeholder="License number" value={form.license_no} onChange={e => setForm(p => ({ ...p, license_no: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">License Expiry Date</label>
              <input className="form-control" type="date" value={form.license_expiry} onChange={e => setForm(p => ({ ...p, license_expiry: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="divider" />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location</div>

        <div className="form-group">
          <div className="flex items-center justify-between mb-1">
            <label className="form-label" style={{ margin: 0 }}>City</label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
              onClick={() => { setSubForm({ name: '' }); setSubModal('city'); }}>+ New City</button>
          </div>
          <select className="form-control" value={form.city_id} onChange={e => setForm(p => ({ ...p, city_id: e.target.value, area_id: '', territory_id: '' }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <div className="flex items-center justify-between mb-1">
            <label className="form-label" style={{ margin: 0 }}>Area</label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
              onClick={() => { setSubForm({ name: '', city_id: form.city_id || '' }); setSubModal('area'); }}>+ New Area</button>
          </div>
          <select className="form-control" value={form.area_id} onChange={e => setForm(p => ({ ...p, area_id: e.target.value, territory_id: '' }))} disabled={!form.city_id}>
            <option value="">— Select Area —</option>
            {filteredAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <div className="flex items-center justify-between mb-1">
            <label className="form-label" style={{ margin: 0 }}>Territory</label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
              onClick={() => { setSubForm({ name: '', area_id: form.area_id || '', city_id: form.city_id || '' }); setSubModal('territory'); }}>+ New Territory</button>
          </div>
          <select className="form-control" value={form.territory_id} onChange={e => setForm(p => ({ ...p, territory_id: e.target.value }))} disabled={!form.area_id}>
            <option value="">— Select Territory —</option>
            {filteredTerritories.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </Modal>

      <Modal isOpen={subModal === 'city'} onClose={() => setSubModal(null)} title="Add New City" size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setSubModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveSubCity} disabled={subSaving}>{subSaving ? 'Saving...' : 'Add City'}</button></>}>
        <div className="form-group"><label className="form-label">City Name *</label>
          <input className="form-control" placeholder="e.g. Lahore" value={subForm.name || ''} onChange={e => setSubForm(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
      </Modal>

      <Modal isOpen={subModal === 'area'} onClose={() => setSubModal(null)} title="Add New Area" size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setSubModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveSubArea} disabled={subSaving}>{subSaving ? 'Saving...' : 'Add Area'}</button></>}>
        <div className="form-group"><label className="form-label">City *</label>
          <select className="form-control" value={subForm.city_id || ''} onChange={e => setSubForm(p => ({ ...p, city_id: e.target.value }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Area Name *</label>
          <input className="form-control" placeholder="e.g. DHA Phase 5" value={subForm.name || ''} onChange={e => setSubForm(p => ({ ...p, name: e.target.value }))} /></div>
      </Modal>

      <Modal isOpen={subModal === 'territory'} onClose={() => setSubModal(null)} title="Add New Territory" size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setSubModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveSubTerritory} disabled={subSaving}>{subSaving ? 'Saving...' : 'Add Territory'}</button></>}>
        <div className="form-group"><label className="form-label">City</label>
          <select className="form-control" value={subForm.city_id || ''} onChange={e => setSubForm(p => ({ ...p, city_id: e.target.value, area_id: '' }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Area *</label>
          <select className="form-control" value={subForm.area_id || ''} onChange={e => setSubForm(p => ({ ...p, area_id: e.target.value }))} disabled={!subForm.city_id}>
            <option value="">— Select Area —</option>
            {geo.areas.filter(a => !subForm.city_id || a.city_id === parseInt(subForm.city_id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Territory Name *</label>
          <input className="form-control" placeholder="e.g. Sector A" value={subForm.name || ''} onChange={e => setSubForm(p => ({ ...p, name: e.target.value }))} /></div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting} message={`Delete customer "${selected?.name}"?`} />

      <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title="Customer Details" size="md"
        footer={<button className="btn btn-primary" onClick={() => setViewModal(false)}>Close</button>}>
        {viewCustomer ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div><strong>Name:</strong> {viewCustomer.name} <span className="mv-customer-id">(ID: {viewCustomer.id})</span></div>
            <div><strong>Phone:</strong> {viewCustomer.phone ? formatPhone(viewCustomer.phone) : '—'}</div>
            <div><strong>Address:</strong> {viewCustomer.address || '—'}</div>
            <div>
              <strong>Type:</strong>{' '}
              <span
                className="badge"
                style={{
                  color: Number(viewCustomer.is_licensed) === 1 ? 'var(--green)' : 'var(--gray-500)',
                  background: Number(viewCustomer.is_licensed) === 1 ? 'rgba(16,185,129,0.12)' : 'var(--gray-100)'
                }}
              >
                {Number(viewCustomer.is_licensed) === 1 ? CUSTOMER_TYPE_LABEL.licensed : CUSTOMER_TYPE_LABEL.unlicensed}
              </span>
            </div>
            {Number(viewCustomer.is_licensed) === 1 && (
              <>
                <div><strong>License No:</strong> {cleanLicenseNo(viewCustomer.license_no) || '—'}</div>
                <div><strong>License Expiry:</strong> {cleanLicenseExpiry(viewCustomer.license_expiry) ? formatDatePKT(cleanLicenseExpiry(viewCustomer.license_expiry)) : '—'}</div>
              </>
            )}
            <div><strong>City:</strong> {viewCustomer.city_name || '—'}</div>
            <div><strong>Area:</strong> {viewCustomer.area_name || '—'}</div>
            <div><strong>Territory:</strong> {viewCustomer.territory_name || '—'}</div>
            <div><strong>Balance:</strong> <span style={{ fontWeight: 700, color: parseFloat(viewCustomer.balance) > 0 ? 'var(--red)' : 'var(--green)' }}>{formatCurrency(viewCustomer.balance)}</span></div>
          </div>
        ) : null}
      </Modal>
    </Layout>
  );
}
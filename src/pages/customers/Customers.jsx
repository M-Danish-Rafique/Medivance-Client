import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatPhone, handlePhoneInput } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const emptyForm = { name: '', address: '', phone: '', license_no: '', license_expiry: '', city_id: '', area_id: '', territory_id: '' };

export default function Customers() {
  const [data, setData] = useState([]);
  const [geo, setGeo] = useState({ cities: [], areas: [], territories: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
      license_no: item.license_no || '', license_expiry: item.license_expiry ? item.license_expiry.split('T')[0] : '',
      city_id: item.city_id || '', area_id: item.area_id || '', territory_id: item.territory_id || ''
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
    } catch (err) { toast.error('Error saving'); } finally { setSaving(false); }
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

  const isLicenseExpired = (date) => date && new Date(date) < new Date();
  const isLicenseExpiringSoon = (date) => {
    if (!date) return false;
    const d = new Date(date); const now = new Date();
    return d > now && (d - now) / (1000 * 60 * 60 * 24) <= 30;
  };

  const filtered = data.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.city_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.license_no || '').toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedCustomers } = usePagination(filtered, 25);

  return (
    <Layout title="Customers">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Customers</div>
            <div className="text-sm text-muted mt-1">{data.length} customers registered</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} />
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
            <table>
              <thead>
                <tr><th>#</th><th>Name</th><th>Phone</th><th>License No</th><th>License Expiry</th><th>City</th><th>Area</th><th>Balance</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
              </thead>
              <tbody>
                {pagedCustomers.map(c => (
                  <tr key={c.id}>
                    <td className="mono" style={{ color: 'var(--gray-400)', fontSize: 12 }}>{c.id}</td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.phone ? formatPhone(c.phone) : '—'}</td>
                    <td className="mono">{c.license_no || '—'}</td>
                    <td>
                      {c.license_expiry ? (
                        <span style={{ fontWeight: 600, color: isLicenseExpired(c.license_expiry) ? 'var(--red)' : isLicenseExpiringSoon(c.license_expiry) ? 'var(--amber)' : 'var(--green)', fontSize: 12 }}>
                          {isLicenseExpired(c.license_expiry) ? <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>warning</span> : isLicenseExpiringSoon(c.license_expiry) ? <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>schedule</span> : null}
                          {new Date(c.license_expiry).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{c.city_name ? <span className="badge badge-blue">{c.city_name}</span> : '—'}</td>
                    <td>{c.area_name ? <span className="badge badge-teal">{c.area_name}</span> : '—'}</td>
                    <td><span style={{ fontWeight: 700, color: parseFloat(c.balance) > 0 ? 'var(--red)' : 'var(--green)' }}>{formatCurrency(c.balance)}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="View customer" aria-label="View customer" onClick={() => openView(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span></button>
                        <button className="btn btn-outline btn-sm btn-icon" title="Edit customer" aria-label="Edit customer" onClick={() => openEdit(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger btn-sm btn-icon" title="Delete customer" aria-label="Delete customer" onClick={() => { setSelected(c); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
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
            <div><strong>Name:</strong> {viewCustomer.name}</div>
            <div><strong>Phone:</strong> {viewCustomer.phone ? formatPhone(viewCustomer.phone) : '—'}</div>
            <div><strong>Address:</strong> {viewCustomer.address || '—'}</div>
            <div><strong>License No:</strong> {viewCustomer.license_no || '—'}</div>
            <div><strong>License Expiry:</strong> {viewCustomer.license_expiry ? new Date(viewCustomer.license_expiry).toLocaleDateString() : '—'}</div>
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

import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatPhone, handlePhoneInput } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';

const emptyForm = { name: '', address: '', phone: '' };

export default function Companies() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/companies').then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => { setSelected(item); setForm({ name: item.name, address: item.address || '', phone: item.phone || '' }); setModal(true); };
  const openDelete = (item) => { setSelected(item); setDeleteModal(true); };

  const handleSave = async () => {
    if (!form.name) return toast.error('Company name is required');
    setSaving(true);
    try {
      if (selected) {
        await api.put(`/companies/${selected.id}`, form);
        toast.success('Company updated');
      } else {
        await api.post('/companies', form);
        toast.success('Company added');
      }
      setModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/companies/${selected.id}`);
      toast.success('Company deleted');
      setDeleteModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error deleting');
    } finally {
      setDeleting(false);
    }
  };

  const filtered = data.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search));

  return (
    <Layout title="Companies">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Companies</div>
            <div className="text-sm text-muted mt-1">{data.length} companies registered</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Company</button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏭</div>
              <div className="empty-state-title">{search ? 'No results found' : 'No companies yet'}</div>
              <div className="empty-state-desc">{!search && 'Add your first company to get started'}</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th>Added</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ maxWidth: 200, color: 'var(--gray-500)' }}>{c.address || '—'}</td>
                    <td>{c.phone ? formatPhone(c.phone) : '—'}</td>
                    <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{formatDatePKT(c.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm btn-icon" title="Edit company" aria-label="Edit company" onClick={() => openEdit(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger btn-sm btn-icon" title="Delete company" aria-label="Delete company" onClick={() => openDelete(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal isOpen={modal} onClose={() => setModal(false)}
        title={selected ? 'Edit Company' : 'Add Company'} size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Company'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Company Name *</label>
          <input className="form-control" placeholder="e.g. PharmaCo Ltd." value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <textarea className="form-control" placeholder="Full address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} rows={2} />
        </div>
        <div className="form-group">
          <label className="form-label">Phone Number</label>
          <input className="form-control" placeholder="+92 300 6119485" value={form.phone} onChange={e => handlePhoneInput(e, (v) => setForm(p => ({ ...p, phone: v })))} maxLength={16} />
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete} loading={deleting}
        message={`Delete "${selected?.name}"? This may affect related products.`} />
    </Layout>
  );
}

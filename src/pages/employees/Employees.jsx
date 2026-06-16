import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatPhone, handleCNICInput, handlePhoneInput } from '../../utils/formatters';

const emptyForm = { name: '', cnic: '', phone: '', role: 'Salesman' };

export default function Employees() {
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
    api.get('/employees').then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({ name: item.name, cnic: item.cnic || '', phone: item.phone || '', role: item.role });
    setModal(true);
  };

  const setCNIC = (val) => setForm(p => ({ ...p, cnic: val }));
  const setPhone = (val) => setForm(p => ({ ...p, phone: val }));

  const handleSave = async () => {
    if (!form.name || !form.role) return toast.error('Name and role are required');
    if (form.cnic && form.cnic.replace(/\D/g, '').length !== 13) return toast.error('CNIC must be 13 digits');
    setSaving(true);
    try {
      if (selected) { await api.put(`/employees/${selected.id}`, form); toast.success('Employee updated'); }
      else { await api.post('/employees', form); toast.success('Employee added'); }
      setModal(false); load();
    } catch (err) { toast.error('Error saving'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/employees/${selected.id}`);
      toast.success('Employee deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const filtered = data.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.cnic || '').includes(search)
  );

  return (
    <Layout title="Employees">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Employees</div>
            <div className="text-sm text-muted mt-1">{data.length} employees</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>groups</span></div><div className="empty-state-title">No employees found</div></div>
          ) : (
            <table>
              <thead>
                <tr><th>Employee ID</th><th>Name</th><th>CNIC</th><th>Phone</th><th>Role</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td className="mono" style={{ color: 'var(--gray-400)', fontSize: 12 }}>{e.employee_code || `#${e.id}`}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td className="mono">{e.cnic || '—'}</td>
                    <td>{e.phone ? formatPhone(e.phone) : '—'}</td>
                    <td>
                      <span className={`badge ${e.role === 'Salesman' ? 'badge-blue' : 'badge-teal'}`}>{e.role}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm btn-icon" title="Edit employee" onClick={() => openEdit(e)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                        </button>
                        <button className="btn btn-danger btn-sm btn-icon" title="Delete employee" onClick={() => { setSelected(e); setDeleteModal(true); }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                        </button>
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
        title={selected ? 'Edit Employee' : 'Add Employee'} size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Employee'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="form-control" placeholder="Employee name" value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">CNIC</label>
          <input className="form-control mono" placeholder="XXXXX-XXXXXXX-X" value={form.cnic}
            onChange={e => handleCNICInput(e, setCNIC)}
            maxLength={15}
          />
          {form.cnic && form.cnic.replace(/\D/g, '').length > 0 && form.cnic.replace(/\D/g, '').length < 13 && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 3 }}>
              {13 - form.cnic.replace(/\D/g, '').length} digits remaining
            </div>
          )}
          {form.cnic && form.cnic.replace(/\D/g, '').length === 13 && (
            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 3 }}>Valid CNIC format</div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input className="form-control" placeholder="0308 8421202" value={form.phone}
            onChange={e => handlePhoneInput(e, setPhone)} maxLength={16} />
        </div>
        <div className="form-group">
          <label className="form-label">Role *</label>
          <select className="form-control" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
            <option value="Salesman">Salesman</option>
            <option value="Supplier">Supplier</option>
          </select>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete} loading={deleting} message={`Delete "${selected?.name}"?`} />
    </Layout>
  );
}

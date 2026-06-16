import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';

const emptyForm = { name: '', pack_size: '', purchase_rate: '', sale_rate: '', retail_price: '', company_id: '' };

export default function Products() {
  const [data, setData] = useState([]);
  const [companies, setCompanies] = useState([]);
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
    Promise.all([api.get('/products'), api.get('/companies')]).then(([p, c]) => {
      setData(p.data); setCompanies(c.data); setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({ name: item.name, pack_size: item.pack_size || '', purchase_rate: item.purchase_rate, sale_rate: item.sale_rate, retail_price: item.retail_price, company_id: item.company_id || '' });
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name) return toast.error('Product name is required');
    setSaving(true);
    try {
      if (selected) {
        await api.put(`/products/${selected.id}`, form);
        toast.success('Product updated');
      } else {
        await api.post('/products', form);
        toast.success('Product added');
      }
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/products/${selected.id}`);
      toast.success('Product deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const filtered = data.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.company_name || '').toLowerCase().includes(search.toLowerCase()));

  const fmt = (n) => n != null ? formatCurrency(n) : '—';

  return (
    <Layout title="Products">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Products</div>
            <div className="text-sm text-muted mt-1">{data.length} products in catalog</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Product</button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory_2</span></div>
              <div className="empty-state-title">No products found</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Product Name</th>
                  <th>Pack Size</th>
                  <th>Purchase Rate</th>
                  <th>Sale Rate</th>
                  <th>Retail Price</th>
                  <th>Company</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td><span className="mono" style={{ color: 'var(--gray-400)', fontSize: 12 }}>{p.id}</span></td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.pack_size || '—'}</td>
                    <td className="mono">{fmt(p.purchase_rate)}</td>
                    <td className="mono">{fmt(p.sale_rate)}</td>
                    <td className="mono">{fmt(p.retail_price)}</td>
                    <td>{p.company_name ? <span className="badge badge-blue">{p.company_name}</span> : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm btn-icon" title="Edit product" aria-label="Edit product" onClick={() => openEdit(p)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger btn-sm btn-icon" title="Delete product" aria-label="Delete product" onClick={() => { setSelected(p); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
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
        title={selected ? 'Edit Product' : 'Add Product'} size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Product'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Product Name *</label>
          <input className="form-control" placeholder="e.g. Panadol 500mg" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Pack Size</label>
            <input className="form-control" placeholder="e.g. 10 tablets" value={form.pack_size} onChange={e => setForm(p => ({ ...p, pack_size: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Company</label>
            <select className="form-control" value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-grid form-grid-3">
          <div className="form-group">
            <label className="form-label">Purchase Rate (PKR)</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.purchase_rate} onChange={e => setForm(p => ({ ...p, purchase_rate: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Sale Rate (PKR)</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.sale_rate} onChange={e => setForm(p => ({ ...p, sale_rate: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Retail Price (PKR)</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.retail_price} onChange={e => setForm(p => ({ ...p, retail_price: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting} message={`Delete "${selected?.name}"?`} />
    </Layout>
  );
}

import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import { formatCurrency, formatDecimal } from '../../utils/formatters';
import toast from 'react-hot-toast';

const emptyForm = {
  name: '', category_id: '', pack_size: '', volume: '', volume_uom_id: '',
  company_id: '', sale_rate: '', retail_price: '',
  is_manufactured: 1, tax_applicable: 0, sale_tax_pct: '',
  purchase_rate: 0,
};

export default function ManufacturedProducts() {
  const [data, setData] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [catModal, setCatModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newCat, setNewCat] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/products'),
      api.get('/companies'),
      api.get('/manufacturing/categories'),
      api.get('/raw-materials/uom'),
    ]).then(([p, c, cat, uom]) => {
      setData(p.data.filter(p => p.is_manufactured));
      setCompanies(c.data);
      setCategories(cat.data);
      setUoms(uom.data.filter(u => u.base_type !== 'count'));
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({
      name: item.name, category_id: item.category_id || '',
      pack_size: item.pack_size || '', volume: item.volume || '', volume_uom_id: item.volume_uom_id || '',
      company_id: item.company_id || '', sale_rate: item.sale_rate || '',
      retail_price: item.retail_price || '', is_manufactured: 1,
      tax_applicable: item.tax_applicable || 0,
      sale_tax_pct: item.sale_tax_pct || '', purchase_rate: item.purchase_rate || 0,
    });
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name) return toast.error('Product name is required');
    if (!form.sale_rate) return toast.error('Sale rate is required');
    if (form.tax_applicable && !form.sale_tax_pct) return toast.error('Enter sale tax percentage');
    setSaving(true);
    try {
      const payload = { ...form, is_manufactured: 1 };
      if (selected) { await api.put(`/products/${selected.id}`, payload); toast.success('Product updated'); }
      else { await api.post('/products', payload); toast.success('Product added'); }
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/products/${selected.id}`);
      toast.success('Deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const saveCategory = async () => {
    if (!newCat) return;
    try {
      await api.post('/manufacturing/categories', { name: newCat });
      const r = await api.get('/manufacturing/categories');
      setCategories(r.data); setNewCat(''); toast.success('Category added');
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const filtered = data.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.company_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout title="Manufactured Products">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Manufactured Products</div>
            <div className="text-sm text-muted mt-1">{data.length} products defined</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={() => setCatModal(true)}><span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>settings</span>Categories</button>
            <button className="btn btn-primary" onClick={openAdd}><span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>add</span>Add Product</button>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : filtered.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">🧴</div><div className="empty-state-title">No manufactured products yet</div></div>
            : <table>
                <thead>
                  <tr><th>Name</th><th>Category</th><th>Pack</th><th>Volume</th><th>Company</th><th>Sale Rate</th><th>Retail</th><th>Tax</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td>{p.category_name ? <span className="badge badge-blue" style={{ fontSize: 10 }}>{p.category_name}</span> : '—'}</td>
                        <td>{p.pack_size || '—'}</td>
                        <td>{p.volume ? `${formatDecimal(p.volume, 4)} ${p.vol_uom_symbol || ''}` : '—'}</td>
                        <td>{p.company_name || '—'}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{formatCurrency(p.sale_rate)}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{formatCurrency(p.retail_price)}</td>
                        <td>
                          {p.tax_applicable
                            ? <span className="badge badge-amber">{p.sale_tax_pct}%</span>
                            : <span className="badge badge-gray">None</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm btn-icon" title="Edit product" onClick={() => openEdit(p)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                            <button className="btn btn-danger btn-sm btn-icon" title="Delete product" onClick={() => { setSelected(p); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
        </div>
      </div>

      {/* Product Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)}
        title={selected ? 'Edit Manufactured Product' : 'Add Manufactured Product'} size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Product'}</button></>}>

        <div className="form-group">
          <label className="form-label">Product Name *</label>
          <input className="form-control" placeholder="e.g. Coconut Oil 150ml" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <div className="flex items-center justify-between mb-1">
              <label className="form-label" style={{ margin: 0 }}>Category</label>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }} onClick={() => setCatModal(true)}>+ New</button>
            </div>
            <select className="form-control" value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))}>
              <option value="">— Select Category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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
            <label className="form-label">Pack Size</label>
            <input className="form-control" placeholder="e.g. 1 bottle" value={form.pack_size} onChange={e => setForm(p => ({ ...p, pack_size: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Volume</label>
            <input className="form-control" type="number" step="0.01" placeholder="e.g. 150" value={form.volume} onChange={e => setForm(p => ({ ...p, volume: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Volume UOM</label>
            <select className="form-control" value={form.volume_uom_id} onChange={e => setForm(p => ({ ...p, volume_uom_id: e.target.value }))}>
              <option value="">— UOM —</option>
              {uoms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Sale Rate (PKR) *</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.sale_rate} onChange={e => setForm(p => ({ ...p, sale_rate: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Retail Price (PKR)</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.retail_price} onChange={e => setForm(p => ({ ...p, retail_price: e.target.value }))} />
          </div>
        </div>

        <div className="divider" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" checked={!!form.tax_applicable}
              onChange={e => setForm(p => ({ ...p, tax_applicable: e.target.checked ? 1 : 0, sale_tax_pct: e.target.checked ? p.sale_tax_pct : '' }))} />
            Apply Sale Tax on this product
          </label>
          {!!form.tax_applicable && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Sale Tax % *</label>
              <input className="form-control" type="number" step="0.01" placeholder="e.g. 17" value={form.sale_tax_pct} onChange={e => setForm(p => ({ ...p, sale_tax_pct: e.target.value }))} style={{ maxWidth: 180 }} />
              <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>This tax will be recorded in the FBR tax ledger on each sale</div>
            </div>
          )}
        </div>

        {selected && (
          <div className="alert alert-info">
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>info</span>
            Purchase rate (PKR {formatDecimal(form.purchase_rate, 4)}) is auto-calculated from manufacturing yield. It updates when a yield is created.
          </div>
        )}
      </Modal>

      {/* Category Modal */}
      <Modal isOpen={catModal} onClose={() => setCatModal(false)} title="Product Categories" size="sm">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input className="form-control" placeholder="New category name..." value={newCat}
            onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCategory()} />
          <button className="btn btn-primary" onClick={saveCategory}>Add</button>
        </div>
        {categories.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
            <span>{c.name}</span>
            <button className="btn btn-danger btn-sm btn-icon" title="Delete category" onClick={async () => {
              await api.delete(`/manufacturing/categories/${c.id}`);
              const r = await api.get('/manufacturing/categories');
              setCategories(r.data);
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
            </button>
          </div>
        ))}
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting} message={`Delete "${selected?.name}"?`} />
    </Layout>
  );
}

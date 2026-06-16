import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatPhone, handlePhoneInput } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const emptyForm = { name: '', address: '', phone: '', supplier_type: 'product', product_ids: [], company_ids: [] };

export default function Suppliers() {
  const [data, setData] = useState([]);
  const [products, setProducts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/suppliers'), api.get('/products'), api.get('/companies')])
      .then(([s, p, c]) => { setData(s.data); setProducts(p.data); setCompanies(c.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyForm); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({
      name: item.name, address: item.address || '', phone: item.phone || '',
      supplier_type: item.supplier_type || 'product',
      product_ids: (item.products || []).map(p => p.id),
      company_ids: (item.companies || []).map(c => c.id)
    });
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name) return toast.error('Supplier name required');
    setSaving(true);
    try {
      if (selected) { await api.put(`/suppliers/${selected.id}`, form); toast.success('Supplier updated'); }
      else { await api.post('/suppliers', form); toast.success('Supplier added'); }
      setModal(false); load();
    } catch (err) { toast.error('Error saving'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/suppliers/${selected.id}`);
      toast.success('Supplier deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const toggleId = (field, id) => {
    setForm(p => ({
      ...p,
      [field]: p[field].includes(id) ? p[field].filter(x => x !== id) : [...p[field], id]
    }));
  };

  const typeLabel = { product: 'Product', raw_material: 'Raw Material', both: 'Both' };
  const typeBadge = { product: 'badge-blue', raw_material: 'badge-teal', both: 'badge-amber' };

  const filtered = data.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || (s.phone || '').includes(search);
    const matchType = !typeFilter || s.supplier_type === typeFilter || (typeFilter === 'both' && s.supplier_type === 'both');
    return matchSearch && matchType;
  });
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedSuppliers } = usePagination(filtered, 25);

  return (
    <Layout title="Suppliers">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Suppliers</div>
            <div className="text-sm text-muted mt-1">{data.length} suppliers registered</div>
          </div>
          <div className="flex items-center gap-3">
            {/* Type filter */}
            <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
              {[{ val: '', label: 'All' }, { val: 'product', label: 'Product' }, { val: 'raw_material', label: 'Raw Material' }, { val: 'both', label: 'Both' }].map(t => (
                <button key={t.val}
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
              <input placeholder="Search suppliers..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Supplier</button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>local_shipping</span></div><div className="empty-state-title">No suppliers found</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Balance</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedSuppliers.map(s => (
                  <tr key={s.id}>
                    <td className="mono" style={{ color: 'var(--gray-400)', fontSize: 12 }}>{s.id}</td>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>
                      <span className={`badge ${typeBadge[s.supplier_type] || 'badge-gray'}`} style={{ fontSize: 11 }}>
                        {typeLabel[s.supplier_type] || s.supplier_type}
                      </span>
                    </td>
                    <td>{s.phone ? formatPhone(s.phone) : '—'}</td>
                    <td style={{ maxWidth: 240, color: 'var(--gray-500)', fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-word' }}>{s.address || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: parseFloat(s.balance) > 0 ? 'var(--red)' : 'var(--green)' }}>
                        {formatCurrency(s.balance)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm btn-icon" title="Edit supplier" aria-label="Edit supplier" onClick={() => openEdit(s)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                        <button className="btn btn-danger btn-sm btn-icon" title="Delete supplier" aria-label="Delete supplier" onClick={() => { setSelected(s); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
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

      <Modal isOpen={modal} onClose={() => setModal(false)}
        title={selected ? 'Edit Supplier' : 'Add Supplier'} size="lg"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Supplier'}
            </button>
          </>
        }>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Supplier Name *</label>
            <input className="form-control" placeholder="Supplier name" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-control" placeholder="0308 8421202" value={form.phone}
              onChange={e => handlePhoneInput(e, (v) => setForm(p => ({ ...p, phone: v })))} maxLength={16} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <textarea className="form-control" rows={2} placeholder="Supplier address"
            value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Supplier Type *</label>
          <select className="form-control" value={form.supplier_type}
            onChange={e => setForm(p => ({ ...p, supplier_type: e.target.value }))}>
            <option value="product">Product Supplier</option>
            <option value="raw_material">Raw Material Supplier</option>
            <option value="both">Both</option>
          </select>
        </div>

        <div className="divider" />

        <div className="form-grid form-grid-2">
          <div>
            <label className="form-label">Linked Products</label>
            <div style={{ border: '1.5px solid var(--gray-200)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', padding: '8px 12px' }}>
              {products.length === 0
                ? <div className="text-sm text-muted">No products available</div>
                : products.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleId('product_ids', p.id)} />
                    {p.name}
                  </label>
                ))}
            </div>
            <div className="text-sm text-muted mt-1">{form.product_ids.length} selected</div>
          </div>
          <div>
            <label className="form-label">Linked Companies</label>
            <div style={{ border: '1.5px solid var(--gray-200)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', padding: '8px 12px' }}>
              {companies.length === 0
                ? <div className="text-sm text-muted">No companies available</div>
                : companies.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.company_ids.includes(c.id)} onChange={() => toggleId('company_ids', c.id)} />
                    {c.name}
                  </label>
                ))}
            </div>
            <div className="text-sm text-muted mt-1">{form.company_ids.length} selected</div>
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete} loading={deleting} message={`Delete supplier "${selected?.name}"?`} />
    </Layout>
  );
}

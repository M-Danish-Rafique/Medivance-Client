import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import { formatCurrency, formatDecimal } from '../../utils/formatters';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';
import toast from 'react-hot-toast';

const emptyBatch = () => ({ category_id: '', batch_date: todayPKT(), expiry_date: '', total_volume: '', volume_uom_id: '', misc_expense: '', notes: '' });
const emptyMat = { raw_material_id: '', uom_id: '', qty: '', _unit_cost: 0, _total_cost: 0 };

export default function Batches() {
  const [batches, setBatches] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [catModal, setCatModal] = useState(false);

  const [selected, setSelected] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [batchForm, setBatchForm] = useState(emptyBatch());
  const [materials, setMaterials] = useState([{ ...emptyMat }]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newCat, setNewCat] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/manufacturing/batches'),
      api.get('/raw-materials?type=raw_material'),
      api.get('/raw-materials/uom'),
      api.get('/manufacturing/categories'),
    ]).then(([b, rm, uom, cat]) => {
      setBatches(b.data); setRawMaterials(rm.data); setUoms(uom.data); setCategories(cat.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setBatchForm(emptyBatch()); setMaterials([{ ...emptyMat }]); setModal(true); };

  const openView = async (batch) => {
    try {
      const r = await api.get(`/manufacturing/batches/${batch.id}`);
      setViewData(r.data); setViewModal(true);
    } catch { toast.error('Error loading batch'); }
  };

  const updateMaterial = (idx, field, value) => {
    setMaterials(prev => {
      const updated = [...prev];
      const mat = { ...updated[idx], [field]: value };
      if (field === 'raw_material_id') {
        const rm = rawMaterials.find(r => r.id === parseInt(value));
        mat._unit_cost = parseFloat(rm?.cost_per_unit || 0);
        mat.uom_id = rm?.uom_id || '';
        mat._stock_qty = parseFloat(rm?.stock_qty || 0);
      }
      mat._total_cost = parseFloat(mat.qty || 0) * parseFloat(mat._unit_cost || 0);
      updated[idx] = mat;
      return updated;
    });
  };

  const rmCost = useMemo(() => materials.reduce((s, m) => s + parseFloat(m._total_cost || 0), 0), [materials]);
  const totalCost = rmCost + parseFloat(batchForm.misc_expense || 0);

  const volUOM = uoms.find(u => u.id === parseInt(batchForm.volume_uom_id));
  const totalVolumeBase = parseFloat(batchForm.total_volume || 0) * parseFloat(volUOM?.to_base_factor || 1);
  const costPerBase = totalVolumeBase > 0 ? totalCost / totalVolumeBase : 0;

  const handleSave = async () => {
    if (!batchForm.batch_date || !batchForm.expiry_date || !batchForm.total_volume || !batchForm.volume_uom_id) {
      return toast.error('Batch date, expiry date, volume and UOM are required');
    }
    const validMats = materials.filter(m => m.raw_material_id && m.qty > 0);
    if (!validMats.length) return toast.error('Add at least one raw material');
    setSaving(true);
    try {
      const res = await api.post('/manufacturing/batches', { ...batchForm, materials: validMats });
      toast.success(`Batch ${res.data.batch_code} created! Total cost: ${formatCurrency(res.data.total_cost)}`);
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/manufacturing/batches/${selected.id}`);
      toast.success('Batch deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setDeleting(false); }
  };

  const saveCategory = async () => {
    if (!newCat) return toast.error('Category name required');
    try {
      await api.post('/manufacturing/categories', { name: newCat });
      toast.success('Category added');
      const r = await api.get('/manufacturing/categories');
      setCategories(r.data); setNewCat('');
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const fmtPKR = formatCurrency;

  return (
    <Layout title="Manufacturing — Batches">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Manufacturing Batches</div>
            <div className="text-sm text-muted mt-1">{batches.length} batches created</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => setCatModal(true)}><span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>settings</span>Categories</button>
            <button className="btn btn-primary" onClick={openAdd}><span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>add_circle</span>New Batch</button>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : batches.length === 0
            ? <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>factory</span></div><div className="empty-state-title">No batches yet</div></div>
            : <table>
                <thead>
                  <tr><th>Batch Code</th><th>Category</th><th>Batch Date</th><th>Expiry Date</th><th>Volume</th><th>RM Cost</th><th>Total Cost</th><th>Cost/Base</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id}>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{b.batch_code}</td>
                      <td>{b.category_name || '—'}</td>
                      <td>{formatDatePKT(b.batch_date)}</td>
                      <td>{formatDatePKT(b.expiry_date)}</td>
                      <td>{formatDecimal(b.total_volume)} {b.vol_uom_symbol}</td>
                      <td className="mono">{fmtPKR(b.raw_material_cost)}</td>
                      <td style={{ fontWeight: 700 }}>{fmtPKR(b.total_cost)}</td>
                      <td className="mono" style={{ fontSize: 13 }}>{fmtPKR(b.cost_per_base_unit)}{b.vol_uom_symbol ? `/${b.vol_uom_symbol}` : '/base'}</td>
                      <td>{b.status === 'yielded' ? <span className="badge badge-green">Yielded</span> : <span className="badge badge-amber">Open</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm btn-icon" title="View batch" onClick={() => openView(b)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span></button>
                          {b.status !== 'yielded' && <button className="btn btn-danger btn-sm btn-icon" title="Delete batch" onClick={() => { setSelected(b); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
        </div>
      </div>

      {/* Batch Creation Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Create Manufacturing Batch" size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
              <span>RM Cost: <strong style={{ color: 'var(--blue)' }}>{fmtPKR(rmCost)}</strong></span>
              <span>Misc: <strong>{fmtPKR(batchForm.misc_expense)}</strong></span>
              <span>Total: <strong style={{ color: 'var(--green)', fontSize: 15 }}>{fmtPKR(totalCost)}</strong></span>
              {totalVolumeBase > 0 && <span>Cost/base unit: <strong style={{ color: 'var(--navy)' }}>{fmtPKR(costPerBase)}</strong></span>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create Batch'}</button>
            </div>
          </div>
        }>

        {/* Batch Header */}
        <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <div className="flex items-center justify-between mb-1">
              <label className="form-label" style={{ margin: 0 }}>Category</label>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }} onClick={() => setCatModal(true)}>+ New</button>
            </div>
            <select className="form-control" value={batchForm.category_id} onChange={e => setBatchForm(p => ({ ...p, category_id: e.target.value }))}>
              <option value="">— Select Category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Batch Date *</label>
            <input className="form-control" type="date" value={batchForm.batch_date} onChange={e => setBatchForm(p => ({ ...p, batch_date: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Expiry Date *</label>
            <input className="form-control" type="date" value={batchForm.expiry_date} onChange={e => setBatchForm(p => ({ ...p, expiry_date: e.target.value }))} />
          </div>
        </div>

        <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Total Volume Manufactured *</label>
            <input className="form-control" type="number" step="0.01" placeholder="e.g. 10000" value={batchForm.total_volume} onChange={e => setBatchForm(p => ({ ...p, total_volume: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Volume Unit *</label>
            <select className="form-control" value={batchForm.volume_uom_id} onChange={e => setBatchForm(p => ({ ...p, volume_uom_id: e.target.value }))}>
              <option value="">— Select UOM —</option>
              {uoms.filter(u => u.base_type !== 'count').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Miscellaneous Expense (PKR)</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={batchForm.misc_expense} onChange={e => setBatchForm(p => ({ ...p, misc_expense: e.target.value }))} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-control" placeholder="Optional batch notes" value={batchForm.notes} onChange={e => setBatchForm(p => ({ ...p, notes: e.target.value }))} />
        </div>

        <div className="divider" />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 10 }}>Raw Materials Used in This Batch</div>

        <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 36px', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
          <span>Raw Material</span><span>UOM</span><span>Qty</span><span>Unit Cost</span><span>Total Cost</span><span></span>
        </div>

        {materials.map((mat, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 36px', gap: 6, alignItems: 'center', padding: '6px 8px', marginBottom: 5, background: 'white', border: '1.5px solid var(--gray-200)', borderRadius: 8 }}>
            <select className="form-control" style={{ fontSize: 12, padding: '6px 8px' }}
              value={mat.raw_material_id} onChange={e => updateMaterial(idx, 'raw_material_id', e.target.value)}>
              <option value="">— Raw Material —</option>
              {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name} (Stock: {formatDecimal(r.stock_qty)} {r.uom_symbol})</option>)}
            </select>
            <div style={{ fontSize: 12, padding: '6px 8px', color: 'var(--gray-600)', textAlign: 'center' }}>
              {uoms.find(u => u.id === parseInt(mat.uom_id))?.symbol || '—'}
            </div>
            <input className="form-control" type="number" step="0.01" style={{ fontSize: 12, padding: '6px 8px', borderColor: (mat._stock_qty !== undefined && parseFloat(mat.qty || 0) > mat._stock_qty) ? 'var(--red)' : undefined }} placeholder="Qty"
              value={mat.qty} onChange={e => updateMaterial(idx, 'qty', e.target.value)} />
            {mat._stock_qty !== undefined && parseFloat(mat.qty || 0) > mat._stock_qty && (
              <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Max: {mat._stock_qty}</div>
            )}
            <div style={{ fontSize: 12, color: 'var(--gray-600)', padding: '6px 8px', textAlign: 'right' }}>
              {fmtPKR(mat._unit_cost)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', textAlign: 'right', padding: '6px 8px' }}>
              {mat._total_cost > 0 ? fmtPKR(mat._total_cost) : '—'}
            </div>
            <button className="btn btn-danger btn-icon btn-sm" onClick={() => setMaterials(p => p.filter((_, i) => i !== idx))}
              disabled={materials.length === 1} aria-label="Remove row"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, borderRadius: 4, fontSize: 12, lineHeight: 1, boxSizing: 'border-box' }}>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
                <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
        <button className="btn btn-outline btn-sm mt-2" onClick={() => setMaterials(p => [...p, { ...emptyMat }])}>+ Add Material</button>
      </Modal>

      {/* View Batch Modal */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title={`Batch: ${viewData?.batch_code}`} size="lg">
        {viewData && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Category', val: viewData.category_name || '—' },
                { label: 'Batch Date', val: formatDatePKT(viewData.batch_date) },
                { label: 'Expiry Date', val: formatDatePKT(viewData.expiry_date) },
                { label: 'Total Volume', val: `${formatDecimal(viewData.total_volume)} ${viewData.vol_uom_name}` },
                { label: 'RM Cost', val: fmtPKR(viewData.raw_material_cost) },
                { label: 'Misc Expense', val: fmtPKR(viewData.misc_expense) },
                { label: 'Total Cost', val: fmtPKR(viewData.total_cost), bold: true },
                { label: 'Cost / Base Unit', val: fmtPKR(viewData.cost_per_base_unit) },
                { label: 'Status', val: viewData.status },
              ].map((item, i) => (
                <div key={i} style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 3 }}>{item.label}</div>
                  <div style={{ fontWeight: item.bold ? 800 : 600, color: item.bold ? 'var(--navy)' : 'var(--gray-800)' }}>{item.val}</div>
                </div>
              ))}
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Raw Materials Used</div>
            <table>
              <thead><tr><th>Material</th><th>Qty</th><th>UOM</th><th>Unit Cost</th><th style={{ textAlign: 'right' }}>Total Cost</th></tr></thead>
              <tbody>
                {(viewData.materials || []).map((m, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{m.rm_name}</td>
                    <td>{formatDecimal(m.qty)}</td>
                    <td>{m.uom_symbol || '—'}</td>
                    <td className="mono">{fmtPKR(m.unit_cost)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPKR(m.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Category Modal */}
      <Modal isOpen={catModal} onClose={() => setCatModal(false)} title="Product Categories" size="sm">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input className="form-control" placeholder="Category name..." value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCategory()} />
          <button className="btn btn-primary" onClick={saveCategory}>Add</button>
        </div>
        {categories.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
            <span>{c.name}</span>
            <button className="btn btn-danger btn-sm btn-icon" title="Delete category" onClick={async () => { await api.delete(`/manufacturing/categories/${c.id}`); const r = await api.get('/manufacturing/categories'); setCategories(r.data); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
          </div>
        ))}
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting}
        message={`Delete batch "${selected?.batch_code}"? Raw material stock will be restored.`} />
    </Layout>
  );
}

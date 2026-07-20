import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import { formatCurrency, formatDecimal } from '../../utils/formatters';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';
import toast from 'react-hot-toast';

const emptyRM = { name: '', material_type: 'raw_material', uom_id: '', volume: '', volume_uom_id: '' };
const emptyUOM = { name: '', symbol: '', base_type: 'weight', to_base_factor: 1 };
const emptyPurchase = () => ({ raw_material_id: '', supplier_id: '', date: todayPKT(), invoice_no: '', qty: '', amount: '' });

export default function RawMaterials() {
  const [data, setData] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('materials');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [modal, setModal] = useState(false);
  const [uomModal, setUomModal] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePurchaseModal, setDeletePurchaseModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);

  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyRM);
  const [uomForm, setUomForm] = useState(emptyUOM);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchase());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/raw-materials'),
      api.get('/raw-materials/uom'),
      api.get('/suppliers?type=raw_material'),
      api.get('/raw-materials/purchases/all'),
    ]).then(([rm, uom, sup, pur]) => {
      setData(rm.data); setUoms(uom.data); setSuppliers(sup.data); setPurchases(pur.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setSelected(null); setForm(emptyRM); setModal(true); };
  const openEdit = (item) => {
    setSelected(item);
    setForm({
      name: item.name,
      material_type: item.material_type,
      uom_id: item.uom_id || '',
      volume: item.volume || '',
      volume_uom_id: item.volume_uom_id || ''
    });
    setModal(true);
  };

  const openDetail = async (item) => {
    setSelected(item);
    setDetailLoading(true);
    try {
      const [details, history] = await Promise.all([
        api.get(`/raw-materials/${item.id}`),
        api.get(`/raw-materials/${item.id}/usage-history`)
      ]);
      setDetailData({ ...details.data, usage_history: history.data });
      setDetailModal(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error loading details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.material_type) return toast.error('Name and type required');
    if (form.material_type === 'raw_material' && !form.uom_id) return toast.error('Unit of measurement required for raw material');

    const payload = {
      name: form.name,
      material_type: form.material_type,
      uom_id: form.material_type === 'raw_material' ? (form.uom_id || null) : null,
      volume: null,
      volume_uom_id: null,
    };

    setSaving(true);
    try {
      if (selected) { await api.put(`/raw-materials/${selected.id}`, payload); toast.success('Updated'); }
      else { await api.post('/raw-materials', payload); toast.success('Raw material added'); }
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/raw-materials/${selected.id}`);
      toast.success('Deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting'); } finally { setDeleting(false); }
  };

  const saveUOM = async () => {
    if (!uomForm.name || !uomForm.symbol || !uomForm.base_type) return toast.error('All fields required');
    setSaving(true);
    try {
      await api.post('/raw-materials/uom', uomForm);
      toast.success('UOM added');
      const r = await api.get('/raw-materials/uom');
      setUoms(r.data);
      setUomForm(emptyUOM);
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const savePurchase = async () => {
    const { raw_material_id, date, qty, amount } = purchaseForm;
    if (!raw_material_id || !date || !qty || !amount) return toast.error('Raw material, date, qty and amount required');
    if (parseFloat(qty) <= 0) return toast.error('Quantity must be greater than 0');
    if (parseFloat(amount) <= 0) return toast.error('Total Amount must be greater than 0');
    setSaving(true);
    try {
      await api.post('/raw-materials/purchases', purchaseForm);
      toast.success('Purchase recorded!'); setPurchaseModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const deletePurchase = async () => {
    setDeleting(true);
    try {
      await api.delete(`/raw-materials/purchases/${selected.id}`);
      toast.success('Deleted'); setDeletePurchaseModal(false); load();
    } catch (err) { toast.error('Error'); } finally { setDeleting(false); }
  };

  const filtered = data.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || r.material_type === typeFilter;
    return matchSearch && matchType;
  });

  const uomsByType = (type) => uoms.filter(u => u.base_type === type);
  const unitCostCalc = purchaseForm.qty && purchaseForm.amount
    ? formatDecimal(parseFloat(purchaseForm.amount) / parseFloat(purchaseForm.qty), 4) : '—';

  return (
    <Layout title="Raw Materials">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Raw & Packaging Materials</div>
            <div className="text-sm text-muted mt-1">{data.length} materials registered</div>
          </div>
          <div className="flex items-center gap-3">
            <select className="form-control" style={{ width: 180, fontSize: 13 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="raw_material">Raw Material</option>
              <option value="packaging_material">Packaging Material</option>
            </select>
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search materials..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={() => setUomModal(true)}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>settings</span>
              UOM
            </button>
            <button className="btn btn-success" onClick={() => { setPurchaseForm(emptyPurchase()); setPurchaseModal(true); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>inventory</span>
              Record Purchase
            </button>
            <button className="btn btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>add</span>
              Add Material
            </button>
          </div>
        </div>

        <div style={{ padding: '0 22px' }}>
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'materials' ? 'active' : ''}`} onClick={() => setActiveTab('materials')}>
              Materials ({data.length})
            </button>
            <button className={`tab-btn ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
              Purchase History ({purchases.length})
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : activeTab === 'materials' ? (
            filtered.length === 0
              ? <div className="empty-state"><div className="empty-state-title">No materials found</div></div>
              : <table>
                  <thead>
                    <tr><th>Name</th><th>Type</th><th>UOM</th><th>Stock Qty</th><th>Cost/Unit</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td>
                          {r.material_type === 'raw_material'
                            ? <span className="badge badge-blue">Raw Material</span>
                            : <span className="badge badge-teal">Packaging</span>}
                        </td>
                        <td>{r.uom_symbol ? <span className="badge badge-gray">{r.uom_symbol}</span> : (r.material_type === 'packaging_material' ? <span className="badge badge-gray">unit</span> : '—')}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: parseFloat(r.stock_qty) <= 0 ? 'var(--red)' : 'var(--green)' }}>
                            {formatDecimal(r.stock_qty)} {r.uom_symbol || (r.material_type === 'packaging_material' ? 'unit' : '')}
                          </span>
                        </td>
                        <td className="mono">{formatCurrency(r.cost_per_unit)}{r.uom_symbol ? `/${r.uom_symbol}` : (r.material_type === 'packaging_material' ? '/unit' : '')}</td>
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => { setSelected(r); setDeleteModal(true); }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          ) : (
            purchases.length === 0
              ? <div className="empty-state"><div className="empty-state-title">No purchases yet</div></div>
              : <table>
                  <thead>
                    <tr><th>Date</th><th>Material</th><th>Type</th><th>Supplier</th><th>Invoice</th><th>Qty</th><th>Amount</th><th>Unit Cost</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id}>
                        <td>{formatDatePKT(p.date)}</td>
                        <td style={{ fontWeight: 600 }}>{p.rm_name}</td>
                        <td>{p.material_type === 'raw_material' ? <span className="badge badge-blue" style={{ fontSize: 10 }}>RM</span> : <span className="badge badge-teal" style={{ fontSize: 10 }}>PKG</span>}</td>
                        <td>{p.supplier_name || '—'}</td>
                        <td className="mono">{p.invoice_no || '—'}</td>
                        <td>{formatDecimal(p.qty)} {p.uom_symbol || ''}</td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(p.amount)}</td>
                        <td className="mono">{formatCurrency(p.unit_cost)}{p.uom_symbol ? `/${p.uom_symbol}` : ''}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => { setSelected(p); setDeletePurchaseModal(true); }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}
        </div>
      </div>

      {/* Add/Edit RM Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)} title={selected ? 'Edit Material' : 'Add Raw Material'} size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save' : 'Add'}</button></>}>
        <div className="form-group">
          <label className="form-label">Material Name *</label>
          <input className="form-control" placeholder="e.g. Coconut Oil Base" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Material Type *</label>
          <select className="form-control" value={form.material_type} onChange={e => setForm(p => ({ ...p, material_type: e.target.value, uom_id: '', volume: '', volume_uom_id: '' }))}>
            <option value="raw_material">Raw Material</option>
            <option value="packaging_material">Packaging Material</option>
          </select>
        </div>
        {form.material_type === 'raw_material' && (
          <div className="form-group">
            <label className="form-label">Unit of Measurement *</label>
            <select className="form-control" value={form.uom_id} onChange={e => setForm(p => ({ ...p, uom_id: e.target.value }))}>
              <option value="">— Select UOM —</option>
              <optgroup label="Weight">{uomsByType('weight').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
              <optgroup label="Volume">{uomsByType('volume').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
              <optgroup label="Count">{uomsByType('count').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
            </select>
          </div>
        )}
      </Modal>

      {/* UOM Management Modal */}
      <Modal isOpen={uomModal} onClose={() => setUomModal(false)} title="Units of Measurement" size="sm">
        <div style={{ marginBottom: 16 }}>
          <div className="form-group"><label className="form-label">Name *</label>
            <input className="form-control" placeholder="e.g. Milliliter (ml)" value={uomForm.name} onChange={e => setUomForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-grid form-grid-2">
            <div className="form-group"><label className="form-label">Symbol *</label>
              <input className="form-control" placeholder="ml" value={uomForm.symbol} onChange={e => setUomForm(p => ({ ...p, symbol: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Type *</label>
              <select className="form-control" value={uomForm.base_type} onChange={e => setUomForm(p => ({ ...p, base_type: e.target.value }))}>
                <option value="count">Count</option>
                <option value="weight">Weight</option>
                <option value="volume">Volume</option>
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">Conversion to Base (gram/ml/pcs)</label>
            <input className="form-control" type="number" step="0.00001" placeholder="e.g. 1000 for kg→g" value={uomForm.to_base_factor} onChange={e => setUomForm(p => ({ ...p, to_base_factor: e.target.value }))} /></div>
          <button className="btn btn-primary w-full" onClick={saveUOM} disabled={saving} style={{ justifyContent: 'center' }}>{saving ? 'Adding...' : '+ Add UOM'}</button>
        </div>
        <div className="divider" />
        {uoms.map(u => {
          const factor = parseFloat(u.to_base_factor);
          const factorDisplay = factor % 1 === 0 ? factor.toFixed(0) : factor.toFixed(2).replace(/\.?0+$/, '');
          return (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
              <div><strong>{u.name}</strong> <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 4 }}>{u.symbol}</span> <span className="text-muted text-sm">×{factorDisplay} → base</span></div>
              <button className="btn btn-danger btn-sm" onClick={async () => { await api.delete(`/raw-materials/uom/${u.id}`); const r = await api.get('/raw-materials/uom'); setUoms(r.data); }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          );
        })}
      </Modal>

      {/* RM Purchase Modal */}
      <Modal isOpen={purchaseModal} onClose={() => setPurchaseModal(false)} title="Record Raw Material Purchase" size="md"
        footer={<><button className="btn btn-outline" onClick={() => setPurchaseModal(false)}>Cancel</button><button className="btn btn-primary" onClick={savePurchase} disabled={saving}>{saving ? 'Saving...' : 'Save Purchase'}</button></>}>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Raw / Packaging Material *</label>
            <select className="form-control" value={purchaseForm.raw_material_id} onChange={e => setPurchaseForm(p => ({ ...p, raw_material_id: e.target.value }))}>
              <option value="">— Select Material —</option>
              <optgroup label="Raw Materials">{data.filter(r => r.material_type === 'raw_material').map(r => <option key={r.id} value={r.id}>{r.name} ({r.uom_symbol})</option>)}</optgroup>
              <optgroup label="Packaging Materials">{data.filter(r => r.material_type === 'packaging_material').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Supplier</label>
            <select className="form-control" value={purchaseForm.supplier_id} onChange={e => setPurchaseForm(p => ({ ...p, supplier_id: e.target.value }))}>
              <option value="">— Select Supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-control" type="date" value={purchaseForm.date} onChange={e => setPurchaseForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Invoice No (optional)</label>
            <input className="form-control" placeholder="e.g. INV-001" value={purchaseForm.invoice_no} onChange={e => setPurchaseForm(p => ({ ...p, invoice_no: e.target.value }))} />
          </div>
        </div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Quantity *</label>
            <input className="form-control" type="number" step="0.01" placeholder="0" value={purchaseForm.qty} onChange={e => setPurchaseForm(p => ({ ...p, qty: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Total Amount (PKR) *</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={purchaseForm.amount} onChange={e => setPurchaseForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
        </div>
        {purchaseForm.qty && purchaseForm.amount && (
          <div className="alert alert-info">
            <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>info</span>
            Unit Cost: <strong>PKR {unitCostCalc}</strong> per unit
          </div>
        )}
      </Modal>

      {/* RM Detail Modal */}
      <Modal isOpen={detailModal} onClose={() => setDetailModal(false)} title={detailData?.name} size="lg">
        {detailLoading ? <div className="loading-center"><div className="spinner" /></div>
        : detailData && (
          <div>
            {/* Material Details Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20, padding: 12, background: 'var(--gray-50)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 4 }}>Material Type</div>
                <div style={{ fontWeight: 600 }}>{detailData.material_type === 'raw_material' ? 'Raw Material' : 'Packaging Material'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 4 }}>Unit of Measurement</div>
                <div style={{ fontWeight: 600 }}>{detailData.uom_symbol || (detailData.material_type === 'packaging_material' ? 'unit' : '—')}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 4 }}>Stock Quantity</div>
                <div style={{ fontWeight: 600, color: parseFloat(detailData.stock_qty) <= 0 ? 'var(--red)' : 'var(--green)' }}>{formatDecimal(detailData.stock_qty)} {detailData.uom_symbol || (detailData.material_type === 'packaging_material' ? 'unit' : '')}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 4 }}>Cost per Unit</div>
                <div style={{ fontWeight: 600 }} className="mono">{formatCurrency(detailData.cost_per_unit)}{detailData.uom_symbol ? `/${detailData.uom_symbol}` : (detailData.material_type === 'packaging_material' ? '/unit' : '')}</div>
              </div>
            </div>

            {/* Purchase History */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 10 }}>Purchase History</div>
              {!purchases.some(p => p.raw_material_id === detailData.id) ? (
                <div className="empty-state"><div className="empty-state-title">No purchases</div></div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Date</th><th>Supplier</th><th>Invoice</th><th>Quantity</th><th>Amount</th><th>Unit Cost</th></tr>
                  </thead>
                  <tbody>
                    {purchases.filter(p => p.raw_material_id === detailData.id).map(p => (
                      <tr key={p.id}>
                        <td>{formatDatePKT(p.date)}</td>
                        <td>{p.supplier_name || '—'}</td>
                        <td className="mono">{p.invoice_no || '—'}</td>
                        <td>{formatDecimal(p.qty)} {detailData.uom_symbol || 'unit'}</td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(p.amount)}</td>
                        <td className="mono">{formatCurrency(p.unit_cost)}{detailData.uom_symbol ? `/${detailData.uom_symbol}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Usage History */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 10 }}>
                {detailData.material_type === 'packaging_material' ? 'Usage History (Used in Yields)' : 'Usage History (Used in Batches)'}
              </div>
              {!detailData.usage_history || detailData.usage_history.length === 0 ? (
                <div className="empty-state"><div className="empty-state-title">No usage history</div></div>
              ) : (
                <table>
                  <thead>
                    {detailData.material_type === 'packaging_material' ? (
                      <tr><th>Yield Code</th><th>Product</th><th>Batch Code</th><th>Batch Date</th><th>Qty Used</th><th>Status</th></tr>
                    ) : (
                      <tr><th>Batch Code</th><th>Batch Date</th><th>Quantity Used</th><th>Batch Status</th></tr>
                    )}
                  </thead>
                  <tbody>
                    {detailData.usage_history.map((u, i) => (
                      detailData.material_type === 'packaging_material' ? (
                        <tr key={i}>
                          <td className="mono" style={{ color: 'var(--gray-700)' }}>{u.yield_code}</td>
                          <td style={{ fontWeight: 600 }}>{u.product_name}</td>
                          <td className="mono">{u.batch_code}</td>
                          <td>{formatDatePKT(u.batch_date)}</td>
                          <td>{u.quantity_used} unit(s)</td>
                          <td>{u.status === 'yielded' ? <span className="badge badge-green">Yielded</span> : <span className="badge badge-amber">Open</span>}</td>
                        </tr>
                      ) : (
                        <tr key={u.batch_id}>
                          <td className="mono" style={{ color: 'var(--gray-700)' }}>{u.batch_code}</td>
                          <td>{formatDatePKT(u.batch_date)}</td>
                          <td>{formatDecimal(u.quantity_used)} {detailData.uom_symbol || 'unit'}</td>
                          <td>{u.status === 'yielded' ? <span className="badge badge-green">Yielded</span> : <span className="badge badge-amber">Open</span>}</td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting} message={`Delete "${selected?.name}"? This cannot be undone.`} />
      <ConfirmModal isOpen={deletePurchaseModal} onClose={() => setDeletePurchaseModal(false)} onConfirm={deletePurchase} loading={deleting} message="Delete this purchase? Inventory and supplier ledger will be reversed." />
    </Layout>
  );
}

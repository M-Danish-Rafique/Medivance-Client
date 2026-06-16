import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const emptyItem = {
  product_id: '', pack_size: '', purchase_rate: '', sale_rate: '',
  qty: '', batch_no: '', exp_date: '', retail_price: '', bonus: 0,
  discount_pct: 0, tax_pct: 0, total: 0,
  _expConflict: false, _priceConflict: false, _existingBatch: null
};

const today = () => new Date().toISOString().split('T')[0];
const fmtPKR = (n) => `PKR ${Math.round(parseFloat(n || 0)).toLocaleString()}`;

// Spinner control for numeric fields
function Spinner({ value, onChange, step = 1, min = 0, suffix = '', hideMinus = false }) {
  const v = parseFloat(value) || 0;
  const updateValue = (newValue) => onChange(Math.max(min, +(newValue || 0).toFixed(2)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
      {!hideMinus && (
        <button type="button" onClick={() => updateValue(v - step)}
          style={{ padding: '5px 9px', border: 'none', background: 'var(--gray-50)', cursor: 'pointer', fontWeight: 700, color: 'var(--gray-600)', fontSize: 14, borderRight: '1px solid var(--gray-200)' }}>−</button>
      )}
      <input type="number" min={min} value={value} onChange={e => updateValue(e.target.value)}
        style={{ width: 52, textAlign: 'center', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'inherit', padding: '5px 2px' }} />
      {suffix && <span style={{ fontSize: 11, color: 'var(--gray-500)', paddingRight: 4 }}>{suffix}</span>}
      <button type="button" onClick={() => updateValue(v + step)}
        style={{ padding: '5px 9px', border: 'none', background: 'var(--gray-50)', cursor: 'pointer', fontWeight: 700, color: 'var(--gray-600)', fontSize: 14, borderLeft: '1px solid var(--gray-200)' }}>+</button>
    </div>
  );
}

export default function Purchase() {
  const [purchases, setPurchases] = useState([]);
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedPurchases } = usePagination(purchases, 25);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);       // 'add' | 'edit' | false
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [header, setHeader] = useState({ supplier_id: '', invoice_no: '', date: today() });
  const [items, setItems] = useState([{ ...emptyItem }]);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/purchases'), api.get('/suppliers'), api.get('/products')])
      .then(([p, s, pr]) => { setPurchases(p.data); setSuppliers(s.data); setProducts(pr.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const calcTotal = (item) => {
    const qty = parseFloat(item.qty) || 0;
    const bonus = parseFloat(item.bonus) || 0;
    const rate = parseFloat(item.purchase_rate) || 0;
    const disc = parseFloat(item.discount_pct) || 0;
    const tax = parseFloat(item.tax_pct) || 0;
    // Bonus reduces total (extra free units reduce per-unit effective cost captured in total)
    const effectiveQty = qty + bonus;
    const gross = qty * rate; // pay for ordered qty only
    const discAmt = gross * disc / 100;
    const afterDisc = gross - discAmt;
    const taxAmt = afterDisc * tax / 100;
    return +(afterDisc + taxAmt).toFixed(2);
  };

  const checkBatchConflict = useCallback(async (idx, product_id, batch_no, exp_date, retail_price) => {
    if (!product_id || !batch_no) return;
    try {
      const r = await api.get(`/inventory/check-batch?product_id=${product_id}&batch_no=${batch_no}`);
      if (r.data) {
        const existing = r.data;
        const expConflict = exp_date && existing.exp_date && exp_date !== existing.exp_date.split('T')[0];
        const priceConflict = retail_price && existing.retail_price && parseFloat(retail_price) !== parseFloat(existing.retail_price);
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, _existingBatch: existing, _expConflict: expConflict, _priceConflict: priceConflict } : it));
      } else {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, _existingBatch: null, _expConflict: false, _priceConflict: false } : it));
      }
    } catch { }
  }, []);

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const updated = prev.map((it, i) => {
        if (i !== idx) return it;
        const newIt = { ...it, [field]: value };
        if (field === 'product_id') {
          const prod = products.find(p => p.id === parseInt(value));
          if (prod) {
            newIt.pack_size = prod.pack_size || '';
            newIt.purchase_rate = prod.purchase_rate ? Math.round(prod.purchase_rate) : '';
            newIt.retail_price = prod.retail_price ? Math.round(prod.retail_price) : '';
            newIt.sale_rate = prod.sale_rate ? Math.round(prod.sale_rate) : '';
          }
        }
        newIt.total = calcTotal(newIt);
        return newIt;
      });
      return updated;
    });
    if (['batch_no', 'exp_date', 'retail_price'].includes(field)) {
      setTimeout(() => {
        setItems(prev => {
          const it = prev[idx];
          checkBatchConflict(idx, it.product_id,
            field === 'batch_no' ? value : it.batch_no,
            field === 'exp_date' ? value : it.exp_date,
            field === 'retail_price' ? value : it.retail_price);
          return prev;
        });
      }, 300);
    }
  };

  const addItem = () => setItems(p => [...p, { ...emptyItem }]);
  const removeItem = (idx) => setItems(p => p.filter((_, i) => i !== idx));
  const grandTotal = items.reduce((sum, it) => sum + (parseFloat(it.total) || 0), 0);

  const validateItems = (validItems) => {
    for (let i = 0; i < validItems.length; i++) {
      const r = validItems[i];
      const rowNum = i + 1;
      if (!r.batch_no) return `Row ${rowNum}: Batch No is required`;
      if (!r.exp_date) return `Row ${rowNum}: Expiry Date is required`;
      if (!r.qty || parseFloat(r.qty) <= 0) return `Row ${rowNum}: Qty is required`;
      if (!r.purchase_rate || parseFloat(r.purchase_rate) <= 0) return `Row ${rowNum}: Purchase Rate is required`;
      if (!r.retail_price || parseFloat(r.retail_price) <= 0) return `Row ${rowNum}: Retail Price is required`;
    }
    return null;
  };

  const openAdd = () => {
    setSelected(null);
    setHeader({ supplier_id: '', invoice_no: '', date: today() });
    setItems([{ ...emptyItem }]);
    setModal('add');
  };

  const openEdit = async (purchase) => {
    try {
      const r = await api.get(`/purchases/${purchase.id}`);
      setSelected(r.data);
      setHeader({ supplier_id: r.data.supplier_id, invoice_no: r.data.invoice_no || '', date: r.data.date.split('T')[0] });
      const mapped = (r.data.items || []).map(it => ({
        ...emptyItem,
        product_id: it.product_id, pack_size: it.pack_size || '',
        purchase_rate: Math.round(it.purchase_rate), sale_rate: Math.round(it.sale_rate || 0),
        qty: it.qty, batch_no: it.batch_no || '', exp_date: it.exp_date ? it.exp_date.split('T')[0] : '',
        retail_price: Math.round(it.retail_price), bonus: it.bonus || 0,
        discount_pct: it.discount_pct || 0, tax_pct: it.tax_pct || 0, total: it.total,
      }));
      setItems(mapped);
      setModal('edit');
    } catch { toast.error('Error loading purchase details'); }
  };

  const openView = async (purchase) => {
    try {
      const r = await api.get(`/purchases/${purchase.id}`);
      setViewData(r.data); setViewModal(true);
    } catch { toast.error('Error loading purchase'); }
  };

  const handleSave = async () => {
    if (!header.supplier_id) return toast.error('Please select a supplier');
    if (!header.date) return toast.error('Date is required');
    const validItems = items.filter(it => it.product_id);
    if (validItems.length === 0) return toast.error('Add at least one product');
    const err = validateItems(validItems);
    if (err) return toast.error(err);

    setSaving(true);
    try {
      if (modal === 'edit' && selected) {
        await api.put(`/purchases/${selected.id}`, { ...header, items: validItems });
        toast.success('Purchase updated — inventory and ledger adjusted');
      } else {
        await api.post('/purchases', { ...header, items: validItems });
        toast.success('Purchase saved successfully!');
      }
      setModal(false); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/purchases/${selected.id}`);
      toast.success('Purchase deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error'); } finally { setDeleting(false); }
  };

  const inputSm = { fontSize: 12, padding: '6px 7px' };

  return (
    <Layout title="Purchase">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Purchase Records</div>
            <div className="text-sm text-muted mt-1">{purchases.length} purchases recorded</div>
          </div>
          <button className="btn btn-primary" onClick={openAdd}>+ New Purchase</button>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : purchases.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">📥</div><div className="empty-state-title">No purchases yet</div></div>
            : (
              <table>
                <thead>
                  <tr><th>Purchase ID</th><th>Invoice No</th><th>Supplier</th><th>Date</th><th style={{ textAlign: 'right' }}>Total Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {pagedPurchases.map(p => (
                    <tr key={p.id}>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{p.purchase_id}</td>
                      <td className="mono">{p.invoice_no || '—'}</td>
                      <td>{p.supplier_name}</td>
                      <td>{new Date(p.date).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPKR(p.total_amount)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm btn-icon" title="View purchase" aria-label="View purchase" onClick={() => openView(p)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span></button>
                          <button className="btn btn-outline btn-sm btn-icon" title="Edit purchase" aria-label="Edit purchase" onClick={() => openEdit(p)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span></button>
                          <button className="btn btn-danger btn-sm btn-icon" title="Delete purchase" aria-label="Delete purchase" onClick={() => { setSelected(p); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span></button>
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

      {/* Add / Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(false)}
        title={modal === 'edit' ? `Edit Purchase — ${selected?.purchase_id}` : 'New Purchase Entry'}
        size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Grand Total: <span style={{ color: 'var(--blue)', fontSize: 17 }}>{fmtPKR(grandTotal)}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : modal === 'edit' ? 'Update Purchase' : 'Save Purchase'}
              </button>
            </div>
          </div>
        }>

        {/* Header row */}
        <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Supplier *</label>
            <select className="form-control" value={header.supplier_id} onChange={e => setHeader(p => ({ ...p, supplier_id: e.target.value }))}>
              <option value="">— Select Supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Supplier Invoice No</label>
            <input className="form-control" placeholder="e.g. SI-12345" value={header.invoice_no}
              onChange={e => setHeader(p => ({ ...p, invoice_no: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Date *</label>
            <input className="form-control" type="date" value={header.date}
              onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
          </div>
        </div>

        <div className="divider" />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 10 }}>Product Details</div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 0.7fr 0.9fr 0.9fr 0.7fr 0.9fr 0.9fr 80px 70px 70px 72px 36px',
          gap: 5, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 5,
          fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase'
        }}>
          <span>Product *</span><span>Pack</span><span>Batch No *</span><span style={{ width: 80 }}>Exp Date *</span>
          <span>Qty *</span><span>Purch.Rate *</span><span>Retail Price *</span>
          <span>Bonus</span><span>Disc %</span><span>Tax %</span>
          <span style={{ textAlign: 'right' }}>Total</span><span></span>
        </div>

        {items.map((item, idx) => (
          <div key={idx} style={{ marginBottom: 6 }}>
            {(item._expConflict || item._priceConflict) && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', marginBottom: 3, fontSize: 11, color: '#92400e' }}>
                ⚠ {item._expConflict && `Expiry conflict (existing: ${item._existingBatch?.exp_date?.split('T')[0]})`}
                {item._expConflict && item._priceConflict && ' · '}
                {item._priceConflict && `Retail price conflict (existing: PKR ${Math.round(item._existingBatch?.retail_price)})`}
              </div>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 0.7fr 0.9fr 0.9fr 0.7fr 0.9fr 0.9fr 80px 70px 70px 72px 36px',
              gap: 5, alignItems: 'center', padding: '7px 8px',
              background: item._expConflict || item._priceConflict ? '#fffbeb' : 'white',
              border: `1.5px solid ${item._expConflict || item._priceConflict ? '#fde68a' : 'var(--gray-200)'}`,
              borderRadius: 8
            }}>
              <select className="form-control" style={inputSm} value={item.product_id}
                onChange={e => updateItem(idx, 'product_id', e.target.value)}>
                <option value="">— Product —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <input className="form-control" style={inputSm} placeholder="Pack"
                value={item.pack_size} onChange={e => updateItem(idx, 'pack_size', e.target.value)} />

              <input className="form-control" style={{ ...inputSm, borderColor: !item.batch_no && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Batch *" value={item.batch_no}
                onChange={e => updateItem(idx, 'batch_no', e.target.value)} />

              <input className="form-control" type="date"
                style={{ ...inputSm, width: '100%', borderColor: !item.exp_date && item.product_id ? 'var(--red)' : undefined }}
                value={item.exp_date} onChange={e => updateItem(idx, 'exp_date', e.target.value)} />

              <input className="form-control" type="number" style={{ ...inputSm, borderColor: !item.qty && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Qty *" value={item.qty}
                onChange={e => updateItem(idx, 'qty', e.target.value)} />

              <input className="form-control" type="number" style={{ ...inputSm, borderColor: !item.purchase_rate && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Rate *" value={item.purchase_rate}
                onChange={e => updateItem(idx, 'purchase_rate', e.target.value)} />

              <input className="form-control" type="number" style={{ ...inputSm, borderColor: !item.retail_price && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Retail *" value={item.retail_price}
                onChange={e => updateItem(idx, 'retail_price', e.target.value)} />

              <Spinner value={item.bonus} step={1} min={0} hideMinus
                onChange={v => updateItem(idx, 'bonus', v)} />

              <Spinner value={item.discount_pct} step={1} min={0} suffix="%" hideMinus
                onChange={v => updateItem(idx, 'discount_pct', v)} />

              <Spinner value={item.tax_pct} step={0.5} min={0} suffix="%" hideMinus
                onChange={v => updateItem(idx, 'tax_pct', v)} />

              <div style={{ fontWeight: 700, fontSize: 12, textAlign: 'right', color: 'var(--navy)', paddingRight: 2 }}>
                {item.total > 0 ? `PKR ${Math.round(item.total).toLocaleString()}` : '—'}
              </div>

              <button
                title="Remove row"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, padding: 0, borderRadius: 4, boxSizing: 'border-box',
                  fontSize: 12, lineHeight: 1,
                }}
              >
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
                  <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Sale rate sub-row */}
            {item.product_id && (
              <div style={{ padding: '4px 8px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Sale Rate:</span>
                <input type="number" value={item.sale_rate}
                  onChange={e => updateItem(idx, 'sale_rate', e.target.value)}
                  style={{ width: 90, padding: '3px 6px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 11, fontFamily: 'inherit' }}
                  placeholder="Sale Rate" />
                {item.bonus > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--teal)' }}>
                    + {item.bonus} bonus units (total {parseInt(item.qty || 0) + parseInt(item.bonus || 0)} to inventory)
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        <button className="btn btn-outline btn-sm mt-2" onClick={addItem}>+ Add Row</button>
      </Modal>

      {/* View Purchase Modal */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)}
        title={`Purchase Details — ${viewData?.purchase_id}`} size="lg">
        {viewData && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
              {[
                { label: 'Supplier', val: viewData.supplier_name },
                { label: 'Invoice No', val: viewData.invoice_no || '—' },
                { label: 'Date', val: new Date(viewData.date).toLocaleDateString() },
                { label: 'Purchase ID', val: viewData.purchase_id },
                { label: 'Total Amount', val: fmtPKR(viewData.total_amount), bold: true },
              ].map((s, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontWeight: s.bold ? 700 : 500, color: s.bold ? 'var(--navy)' : 'var(--gray-800)' }}>{s.val}</div>
                </div>
              ))}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Product</th><th>Pack</th><th>Batch</th><th>Exp Date</th>
                  <th>Qty</th><th>Bonus</th><th>Rate</th><th>Disc%</th><th>Tax%</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(viewData.items || []).map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{it.product_name}</td>
                    <td>{it.pack_size || '—'}</td>
                    <td className="mono">{it.batch_no || '—'}</td>
                    <td style={{ fontSize: 12 }}>{it.exp_date ? new Date(it.exp_date).toLocaleDateString() : '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.bonus || 0}</td>
                    <td className="mono">PKR {Math.round(it.purchase_rate).toLocaleString()}</td>
                    <td>{it.discount_pct || 0}%</td>
                    <td>{it.tax_pct || 0}%</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPKR(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--gray-50)', fontWeight: 700 }}>
                  <td colSpan={9} style={{ padding: '10px 14px', textAlign: 'right' }}>Grand Total</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--navy)', fontSize: 15 }}>
                    {fmtPKR(viewData.total_amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete} loading={deleting}
        message="Delete this purchase? Inventory will be reversed and supplier ledger updated." />
    </Layout>
  );
}

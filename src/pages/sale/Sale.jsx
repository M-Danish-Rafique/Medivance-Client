import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency, handlePhoneInput } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';

const emptySaleItem = {
  row_id: null,
  product_id: '', product_search: '', product_name: '', pack_size: '', batch_no: '',
  sale_rate: '', qty: '', bonus: 0, discount_pct: 0, tax_pct: 0, total: 0,
  _batches: [], _rateHistory: null
};

const createSaleItem = () => ({ ...emptySaleItem, row_id: `sale-${Date.now()}-${Math.random().toString(16).slice(2)}` });

const getProductSuggestions = (products, query) => {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return [];
  return products
    .map(p => ({
      product: p,
      score: p.name.toLowerCase().startsWith(normalized) ? 0 : p.name.toLowerCase().includes(normalized) ? 1 : 2,
    }))
    .filter(item => item.score < 2)
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 8)
    .map(item => item.product);
};

const today = () => new Date().toISOString().split('T')[0];

function openInvoicePrint(saleId, type) {
  window.open(`/invoice/${saleId}/print?type=${type}`, '_blank', 'width=960,height=760,scrollbars=yes');
}

function PrintOptionsModal({ isOpen, onClose, invoice }) {
  if (!isOpen || !invoice) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal modal-sm">
        <div className="modal-header">
          <div className="modal-title">Invoice Saved</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}><span className="material-symbols-outlined" style={{ fontSize: 32 }}>celebration</span></div>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--navy)' }}>{invoice.invoice_no}</div>
            <div style={{ color: 'var(--gray-500)', fontSize: 13, marginTop: 4 }}>{formatCurrency(invoice.total_amount)}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 12, textAlign: 'center' }}>Select invoice type to print:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-outline w-full" style={{ justifyContent: 'flex-start', gap: 12 }}
              onClick={() => { openInvoicePrint(invoice.id, 'warranty'); onClose(); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>Print Warranty</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Retail Price −15% rate · With warranty statement</div>
              </div>
            </button>
            <button className="btn btn-outline w-full" style={{ justifyContent: 'flex-start', gap: 12 }}
              onClick={() => { openInvoicePrint(invoice.id, 'warranty10'); onClose(); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>Print Warranty (10% Disc)</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Warranty + additional 10% discount applied</div>
              </div>
            </button>
            <button className="btn btn-outline w-full" style={{ justifyContent: 'flex-start', gap: 12 }}
              onClick={() => { openInvoicePrint(invoice.id, 'non-warranty'); onClose(); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>Print Non-Warranty</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Actual sale rate · No warranty statement</div>
              </div>
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Skip</button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function RateInfoPanel({ rateHistory, activeRowIdx, canViewPurchaseRates }) {
  if (!rateHistory || activeRowIdx === null) return null;
  const info = rateHistory[activeRowIdx];
  if (!info) return null;
  const canShowPurchaseRate = canViewPurchaseRates && info.purchase_rate_visible !== false && info.purchase_rate_visible !== 0;

  return (
    <div style={{
      marginTop: 16, padding: '14px 16px',
      background: 'var(--blue-ultra)', border: '1.5px solid var(--blue-pale)',
      borderRadius: 10
    }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bar_chart</span>
        Rate Info — Row {activeRowIdx + 1} {info.product_name ? `· ${info.product_name}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: canShowPurchaseRate ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 12 }}>
        {canShowPurchaseRate && (
          <div style={{ padding: '8px 10px', background: 'white', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 4 }}>Purchase Rate</div>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              {info.purchase_rate ? formatCurrency(info.purchase_rate) : 'N/A'}
            </div>
          </div>
        )}
        {[0, 1, 2].map(i => (
          <div key={i} style={{ padding: '8px 10px', background: 'white', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 4 }}>
              {i === 0 ? 'Last Rate' : i === 1 ? '2nd Last' : '3rd Last'}
            </div>
            {info.history && info.history[i] ? (
              <>
                <div style={{ fontWeight: 700, color: 'var(--blue)' }}>{formatCurrency(info.history[i].sale_rate)}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>{new Date(info.history[i].date).toLocaleDateString()}</div>
              </>
            ) : (
              <div style={{ fontWeight: 600, color: 'var(--gray-400)' }}>N/A</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SaleFormBody({
  header, setHeader, customers, employees, suppliers, setNewCustModal,
  items, activeRowIdx, setActiveRowIdx, updateItem, selectProduct, removeItem, addItem,
  setItems, products, rateHistory, canViewPurchaseRates, fmt, colStyle, gridCols, geo
}) {
  return (
    <>
      <div className="form-grid form-grid-4" style={{ marginBottom: 20 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <div className="flex items-center justify-between mb-1">
            <label className="form-label" style={{ margin: 0 }}>Customer *</label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
              onClick={() => setNewCustModal(true)}>+ New</button>
          </div>
          <select className="form-control" value={header.customer_id}
            onChange={e => setHeader(p => ({ ...p, customer_id: e.target.value }))}
            style={{ minWidth: 420 }}>
            <option value="">— Select Customer —</option>
            {customers.map(c => {
              const area = geo?.areas?.find(a => String(a.id) === String(c.area_id))?.name;
              const territory = geo?.territories?.find(t => String(t.id) === String(c.territory_id))?.name;
              const location = [area, territory].filter(Boolean).join(' / ');
              const label = [c.name, location].filter(Boolean).join(' — ');
              return <option key={c.id} value={c.id}>{label}</option>;
            })}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Salesman</label>
          <select className="form-control" value={header.salesman_id} onChange={e => setHeader(p => ({ ...p, salesman_id: e.target.value }))}>
            <option value="">— Select Salesman —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Delivery By</label>
          <select className="form-control" value={header.delivery_by} onChange={e => setHeader(p => ({ ...p, delivery_by: e.target.value }))}>
            <option value="">— Select Supplier —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Date *</label>
          <input className="form-control" type="date" value={header.date} onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
        </div>
      </div>

      <div className="divider" />
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 12 }}>Product Details</div>

      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 5, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
        <span>Product</span><span>Pack Size</span><span>Batch No</span><span>Qty</span>
        <span>Sale Rate</span><span>Bonus</span><span>Disc%</span><span>Tax%</span><span>Total</span><span></span>
      </div>

      {items.map((item, idx) => (
        <div key={item.row_id || idx} style={{
          display: 'grid', gridTemplateColumns: gridCols, gap: 5, alignItems: 'center',
          padding: '7px 8px', marginBottom: 6,
          background: activeRowIdx === idx ? '#f0f7ff' : 'white',
          border: `1.5px solid ${activeRowIdx === idx ? 'var(--blue-light)' : 'var(--gray-200)'}`,
          borderRadius: 8, cursor: 'pointer', position: 'relative'
        }} onClick={(e) => {
          const tag = e.target.tagName;
          if (['INPUT', 'SELECT', 'BUTTON', 'OPTION', 'TEXTAREA', 'A'].includes(tag)) return;
          setActiveRowIdx(idx);
        }}>
          <div style={{ position: 'relative' }}>
            <input className="form-control" style={colStyle} value={item.product_search}
              placeholder="Search product" autoComplete="off"
              onChange={e => updateItem(idx, 'product_search', e.target.value)}
              onBlur={() => setTimeout(() => {
                setItems(prev => {
                  const updated = [...prev];
                  const it = updated[idx];
                  if (it && !it.product_id) {
                    updated[idx] = { ...it, product_search: '' };
                  }
                  return updated;
                });
              }, 150)}
            />
            {item.product_search && !item.product_id && (
              <div style={{
                position: 'absolute', top: 38, left: 0, right: 0, zIndex: 20,
                background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8,
                boxShadow: '0 10px 20px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto'
              }}>
                {getProductSuggestions(products, item.product_search).map(prod => (
                  <button key={prod.id} type="button" onMouseDown={() => selectProduct(idx, prod)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                      background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--gray-900)'
                    }}>
                    {prod.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input className="form-control" style={colStyle} readOnly placeholder="Pack size" value={item.pack_size} />
          <select className="form-control" style={colStyle} value={item.batch_no}
            onChange={e => updateItem(idx, 'batch_no', e.target.value)} disabled={!item._batches?.length}>
            <option value="">— Batch —</option>
            {(item._batches || []).map(b => <option key={b.batch_no} value={b.batch_no}>{b.batch_no} (Avail: {b.qty})</option>)}
          </select>
          {(() => {
            const batch = (item._batches || []).find(b => b.batch_no === item.batch_no);
            const maxQty = batch ? batch.qty : Infinity;
            const totalDispatched = parseFloat(item.qty || 0) + parseFloat(item.bonus || 0);
            const overQty = totalDispatched > maxQty;
            return (
              <div>
                <input className="form-control" type="number" style={{ ...colStyle, borderColor: overQty ? 'var(--red)' : undefined }}
                  placeholder="Qty" value={item.qty}
                  onChange={e => updateItem(idx, 'qty', e.target.value)} />
                {overQty && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Qty+Bonus max: {maxQty}</div>}
              </div>
            );
          })()}
          <input className="form-control" type="number" step="0.01" style={colStyle} placeholder="Rate"
            value={item.sale_rate} onChange={e => updateItem(idx, 'sale_rate', e.target.value)} />
          <input className="form-control no-spinner" type="number" step="1" min="0" style={colStyle} placeholder="0"
            value={item.bonus} onChange={e => updateItem(idx, 'bonus', e.target.value)}
            inputMode="numeric" />
          <input className="form-control no-spinner" type="number" step="0.5" min="0" style={colStyle} placeholder="0%"
            value={item.discount_pct} onChange={e => updateItem(idx, 'discount_pct', e.target.value)}
            inputMode="decimal" />
          <input className="form-control no-spinner" type="number" step="0.5" min="0" style={colStyle} placeholder="0%"
            value={item.tax_pct} onChange={e => updateItem(idx, 'tax_pct', e.target.value)}
            inputMode="decimal" />
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--green)', textAlign: 'right' }}>
            {item.total > 0 ? fmt(item.total) : '—'}
          </div>
          <button className="btn btn-danger btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); removeItem(idx); }}
            disabled={items.length === 1} title="Remove row"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, borderRadius: 4, fontSize: 12, lineHeight: 1, boxSizing: 'border-box' }}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}

      <button className="btn btn-outline btn-sm mt-2" onClick={addItem}>+ Add Row</button>

      <RateInfoPanel rateHistory={rateHistory} activeRowIdx={activeRowIdx} canViewPurchaseRates={canViewPurchaseRates} />
    </>
  );
}

export default function Sale() {
  const { user, can } = useAuth();
  const [sales, setSales] = useState([]);
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedSales } = usePagination(sales, 25);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [geo, setGeo] = useState({ cities: [], areas: [], territories: [] });
  const [loading, setLoading] = useState(true);

  // Modals
  const [modal, setModal] = useState(false);   // 'add' | 'edit' | null
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [printModal, setPrintModal] = useState(false);
  const [newCustModal, setNewCustModal] = useState(false);

  const [selected, setSelected] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState(null);

  // Form state
  const [header, setHeader] = useState({ customer_id: '', salesman_id: '', delivery_by: '', date: today() });
  const [items, setItems] = useState([createSaleItem()]);
  const [activeRowIdx, setActiveRowIdx] = useState(null);
  const [rateHistory, setRateHistory] = useState({});

  // New customer form
  const [newCustForm, setNewCustForm] = useState({ name: '', phone: '', address: '', city_id: '' });
  const [savingCust, setSavingCust] = useState(false);
  const canViewPurchaseRates = user?.role === 'admin' || can('perm_view_purchase_rate');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/sales'), api.get('/customers'),
      api.get('/employees?role=Salesman'), api.get('/products'),
      api.get('/geography/geo'), api.get('/employees?role=Supplier')
    ]).then(([s, c, e, p, g, sup]) => {
      setSales(s.data); setCustomers(c.data); setEmployees(e.data);
      setProducts(p.data); setGeo(g.data); setSuppliers(sup.data); setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const calcTotal = (item) => {
    const qty = parseFloat(item.qty) || 0;
    const rate = parseFloat(item.sale_rate) || 0;
    const disc = parseFloat(item.discount_pct) || 0;
    const tax = parseFloat(item.tax_pct) || 0;
    // Bonus = free extra units delivered at no charge; invoice is based on qty only (not qty+bonus)
    const gross = qty * rate;
    const discAmt = gross * disc / 100;
    const afterDisc = gross - discAmt;
    const taxAmt = afterDisc * tax / 100;
    return +(afterDisc + taxAmt).toFixed(2);
  };

  const loadBatches = async (product_id) => {
    if (!product_id) return [];
    try {
      const r = await api.get(`/inventory/product/${product_id}`);
      return r.data.filter(b => b.qty > 0);
    } catch { return []; }
  };

  const loadRateHistory = useCallback(async (idx, product_id, customer_id, product_name) => {
    if (!product_id || !customer_id) {
      setRateHistory(prev => ({ ...prev, [idx]: null }));
      return;
    }
    try {
      const r = await api.get(`/sales/history/rates?product_id=${product_id}&customer_id=${customer_id}`);
      setRateHistory(prev => ({ ...prev, [idx]: { ...r.data, product_name } }));
    } catch { }
  }, []);

  const selectProduct = async (idx, product) => {
    setItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx] };
      it.product_id = product.id;
      it.product_search = product.name;
      it.product_name = product.name;
      it.pack_size = product.pack_size || '';
      it.sale_rate = product.sale_rate || '';
      it.batch_no = '';
      it._batches = [];
      it.total = calcTotal(it);
      updated[idx] = it;
      return updated;
    });
    const batches = await loadBatches(product.id);
    setItems(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], _batches: batches };
      return updated;
    });
  };

  const updateItem = async (idx, field, value) => {
    setItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx], [field]: value };
      if (field === 'product_search') {
        it.product_id = '';
        it.product_name = '';
        it.pack_size = '';
        it.sale_rate = '';
        it.batch_no = '';
        it._batches = [];
      }
      if (field === 'product_id') {
        const prod = products.find(p => p.id === parseInt(value));
        if (prod) {
          it.product_name = prod.name;
          it.pack_size = prod.pack_size || '';
          it.sale_rate = prod.sale_rate || '';
          it.batch_no = '';
          it._batches = [];
        } else {
          it.product_name = '';
        }
      }
      it.total = calcTotal(it);
      updated[idx] = it;
      return updated;
    });
    if (field === 'product_id' && value) {
      const batches = await loadBatches(value);
      const prod = products.find(p => p.id === parseInt(value));
      setItems(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], _batches: batches };
        if (batches.length === 1) {
          updated[idx].batch_no = batches[0].batch_no;
          if (parseFloat(batches[0].sale_rate) > 0) updated[idx].sale_rate = batches[0].sale_rate;
        }
        updated[idx].total = calcTotal(updated[idx]);
        return updated;
      });
      loadRateHistory(idx, value, header.customer_id, prod?.name);
    }
    if (field === 'batch_no' && value) {
      setItems(prev => {
        const it = prev[idx];
        const batch = it._batches.find(b => b.batch_no === value);
        if (batch && parseFloat(batch.sale_rate) > 0) {
          const updated = [...prev];
          updated[idx] = { ...it, sale_rate: batch.sale_rate };
          updated[idx].total = calcTotal(updated[idx]);
          return updated;
        }
        return prev;
      });
    }
  };

  // When customer changes, refresh all rate histories
  useEffect(() => {
    items.forEach((it, idx) => {
      if (it.product_id && header.customer_id) {
        loadRateHistory(idx, it.product_id, header.customer_id, it.product_name);
      }
    });
  // eslint-disable-next-line
  }, [header.customer_id]);

  const addItem = () => { setItems(p => [...p, createSaleItem()]); };
  const removeItem = (idx) => { setItems(p => p.filter((_, i) => i !== idx)); setRateHistory(prev => { const n = { ...prev }; delete n[idx]; return n; }); };
  const grandTotal = items.reduce((s, it) => s + (parseFloat(it.total) || 0), 0);

  const openAdd = () => {
    setSelected(null); setHeader({ customer_id: '', salesman_id: '', delivery_by: '', date: today() });
    setItems([{ ...emptySaleItem }]); setRateHistory({}); setActiveRowIdx(null);
    setModal('add');
  };

  const openEdit = async (sale) => {
    if (sale.is_locked) return toast.error('This invoice is locked after recovery and cannot be edited.');
    try {
      const r = await api.get(`/sales/${sale.id}`);
      setSelected(r.data);
      setHeader({ customer_id: r.data.customer_id, salesman_id: r.data.salesman_id || '', delivery_by: r.data.delivery_by || '', date: r.data.date.split('T')[0] });
      const mappedItems = await Promise.all(r.data.items.map(async (it) => {
        const batches = await loadBatches(it.product_id);
        return { ...createSaleItem(), product_id: it.product_id, product_search: it.product_name || '', product_name: it.product_name, pack_size: it.pack_size || '', batch_no: it.batch_no || '', sale_rate: it.sale_rate, qty: it.qty, bonus: it.bonus || 0, discount_pct: it.discount_pct || 0, tax_pct: it.tax_pct || 0, total: it.total, _batches: batches };
      }));
      setItems(mappedItems); setRateHistory({}); setActiveRowIdx(null);
      setModal('edit');
    } catch { toast.error('Error loading sale'); }
  };

  const openView = async (sale) => {
    try {
      const r = await api.get(`/sales/${sale.id}`);
      setViewData(r.data); setViewModal(true);
    } catch { toast.error('Error loading sale'); }
  };

  const handleSave = async () => {
    if (!header.customer_id) return toast.error('Please select a customer');
    if (!header.date) return toast.error('Date is required');
    const validItems = items.filter(it => it.product_id && it.qty && it.sale_rate && it.batch_no);
    if (validItems.length === 0) return toast.error('Add at least one product with batch, qty and rate');
    // Validate qty+bonus against inventory (both are physically dispatched)
    for (const it of validItems) {
      const batch = (it._batches || []).find(b => b.batch_no === it.batch_no);
      const totalDispatched = parseFloat(it.qty || 0) + parseFloat(it.bonus || 0);
      if (batch && totalDispatched > batch.qty) {
        return toast.error(`Qty + Bonus for ${it.product_name} (batch ${it.batch_no}) exceeds available stock (${batch.qty} units)`);
      }
    }
    setSaving(true);
    try {
      let result;
      if (modal === 'edit' && selected) {
        await api.put(`/sales/${selected.id}`, { ...header, items: validItems });
        toast.success('Sale updated!');
        setModal(false); load();
      } else {
        result = await api.post('/sales', { ...header, items: validItems });
        setSavedInvoice({ id: result.data.id, invoice_no: result.data.invoice_no, total_amount: result.data.total_amount });
        setModal(false);
        setPrintModal(true);
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/sales/${selected.id}`);
      toast.success('Sale deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error deleting'); } finally { setDeleting(false); }
  };

  const saveNewCustomer = async () => {
    if (!newCustForm.name) return toast.error('Name required');
    setSavingCust(true);
    try {
      const r = await api.post('/customers', newCustForm);
      const newList = await api.get('/customers');
      setCustomers(newList.data);
      setHeader(p => ({ ...p, customer_id: r.data.id }));
      setNewCustModal(false);
      setNewCustForm({ name: '', phone: '', address: '', city_id: '' });
      toast.success('Customer added');
    } catch { toast.error('Error'); } finally { setSavingCust(false); }
  };

  const fmt = formatCurrency;
  const colStyle = { fontSize: 12, padding: '6px 8px' };
  const gridCols = '2fr 1fr 1.2fr 0.8fr 1fr 0.6fr 0.6fr 0.6fr 1fr 36px';

  return (
    <Layout title="Sale">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Sales Invoices</div>
            <div className="text-sm text-muted mt-1">{sales.length} invoices</div>
          </div>
          <button className="btn btn-primary" onClick={openAdd}>+ New Sale Invoice</button>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
            : sales.length === 0 ? <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>sell</span></div><div className="empty-state-title">No sales yet</div></div>
            : (
              <table>
                <thead>
                  <tr><th>Invoice No</th><th>Customer</th><th>Salesman</th><th>Delivery By</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {pagedSales.map(s => (
                    <tr key={s.id}>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{s.invoice_no}</td>
                      <td>{s.customer_name}</td>
                      <td>{s.salesman_name || '—'}</td>
                      <td>{s.delivery_by_name || '—'}</td>
                      <td>{new Date(s.date).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{fmt(s.total_amount)}</td>
                      <td>
                        {s.is_locked
                          ? <span className="badge badge-amber"><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>lock</span>Locked</span>
                          : <span className="badge badge-green">Open</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm btn-icon" title="View invoice" onClick={() => openView(s)}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                          </button>
                          <button className="btn btn-outline btn-sm btn-icon" title="Print invoice" onClick={() => { setSavedInvoice({ id: s.id, invoice_no: s.invoice_no, total_amount: s.total_amount }); setPrintModal(true); }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>print</span>
                          </button>
                          {!s.is_locked && <button className="btn btn-outline btn-sm btn-icon" title="Edit invoice" onClick={() => openEdit(s)}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                          </button>}
                          {!s.is_locked && <button className="btn btn-danger btn-sm btn-icon" title="Delete invoice" onClick={() => { setSelected(s); setDeleteModal(true); }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          </button>}
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

      {/* Add/Edit Sale Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(false)}
        title={modal === 'edit' ? `Edit Invoice ${selected?.invoice_no}` : 'New Sale Invoice'} size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div style={{ fontWeight: 700, fontSize: 16 }}>Grand Total: <span style={{ color: 'var(--green)' }}>{fmt(grandTotal)}</span></div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-success btn-lg" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : modal === 'edit' ? 'Update Invoice' : 'Save Invoice'}
              </button>
            </div>
          </div>
        }>
        <SaleFormBody
          header={header} setHeader={setHeader}
          customers={customers} employees={employees} suppliers={suppliers}
          setNewCustModal={setNewCustModal}
          items={items} activeRowIdx={activeRowIdx} setActiveRowIdx={setActiveRowIdx}
          updateItem={updateItem} selectProduct={selectProduct} removeItem={removeItem} addItem={addItem}
          setItems={setItems}
          products={products} rateHistory={rateHistory} canViewPurchaseRates={canViewPurchaseRates} geo={geo}
          fmt={fmt} colStyle={colStyle} gridCols={gridCols}
        />
      </Modal>

      {/* View Invoice Modal */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)}
        title={`Invoice ${viewData?.invoice_no || ''}`} size="lg">
        {viewData && (
          <div>
            {viewData.is_locked && (
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                🔒 This invoice is locked after recovery entry and cannot be edited.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <div className="text-sm text-muted">Customer</div>
                <div style={{ fontWeight: 700 }}>{viewData.customer_name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{viewData.customer_phone}</div>
                {viewData.license_no && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>License: {viewData.license_no}</div>}
              </div>
              <div>
                <div className="text-sm text-muted">Invoice Details</div>
                <div style={{ color: 'var(--gray-800)' }}>{viewData.invoice_no}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Date: {new Date(viewData.date).toLocaleDateString()}</div>
                {viewData.salesman_name && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Salesman: {viewData.salesman_name}</div>}
                {viewData.delivery_by_name && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Delivery By: {viewData.delivery_by_name}</div>}
              </div>
            </div>
            <table style={{ marginBottom: 12 }}>
              <thead>
                <tr><th>Product</th><th>Batch</th><th>Qty</th><th>Bonus</th><th>Rate</th><th>Disc%</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {(viewData.items || []).map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{it.product_name}</td>
                    <td className="mono">{it.batch_no || '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.bonus || 0}</td>
                    <td className="mono">{fmt(it.sale_rate)}</td>
                    <td>{it.discount_pct || 0}%</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right' }}>Grand Total</td>
                  <td style={{ padding: '10px 14px', fontWeight: 800, color: 'var(--green)', textAlign: 'right' }}>{fmt(viewData.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>

      {/* Print Options Modal */}
      <PrintOptionsModal isOpen={printModal} onClose={() => setPrintModal(false)} invoice={savedInvoice} />

      {/* New Customer Mini Modal */}
      <Modal isOpen={newCustModal} onClose={() => setNewCustModal(false)} title="Quick Add Customer" size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setNewCustModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveNewCustomer} disabled={savingCust}>{savingCust ? 'Saving...' : 'Add'}</button></>}>
        <div className="form-group"><label className="form-label">Name *</label>
          <input className="form-control" placeholder="Customer name" value={newCustForm.name} onChange={e => setNewCustForm(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
        <div className="form-group"><label className="form-label">Phone</label>
          <input className="form-control" placeholder="0308 8421202" value={newCustForm.phone}
            onChange={e => handlePhoneInput(e, v => setNewCustForm(p => ({ ...p, phone: v })))} maxLength={16} /></div>
        <div className="form-group"><label className="form-label">City</label>
          <select className="form-control" value={newCustForm.city_id} onChange={e => setNewCustForm(p => ({ ...p, city_id: e.target.value }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting}
        message="Delete this invoice? Inventory will be restored and customer ledger updated." />
    </Layout>
  );
}

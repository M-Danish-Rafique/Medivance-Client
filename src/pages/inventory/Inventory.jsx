import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';

const emptyInventoryItem = {
  row_id: null,
  product_id: '', product_search: '', pack_size: '',
  batch_no: '', exp_date: '', qty: '',
  purchase_rate: '', sale_rate: '', retail_price: '',
  low_stock_threshold: '',
};

const createInventoryItem = () => ({ ...emptyInventoryItem, row_id: `inv-${Date.now()}-${Math.random().toString(16).slice(2)}` });

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

export default function Inventory() {
  const { user, can } = useAuth();
  const [data, setData] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);        // false = active only (qty > 0)
  const [companyFilter, setCompanyFilter] = useState(''); // company_id or ''
  const canViewPurchaseRates = user?.role === 'admin' || can('perm_view_purchase_rate');
  const canAddInventory = user?.role === 'admin' || can('perm_manage_inventory') || can('perm_add_purchase');

  // Manual "Add Inventory" modal state
  const [invModal, setInvModal] = useState(false);
  const [invItems, setInvItems] = useState([createInventoryItem()]);
  const [invSaving, setInvSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/inventory'),
      api.get('/inventory/low-stock'),
      api.get('/companies'),
      api.get('/products'),
    ]).then(([inv, low, comp, prod]) => {
      setData(inv.data);
      setLowStock(low.data);
      setCompanies(comp.data);
      setProducts(prod.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = data.filter(item => {
    const matchSearch =
      item.product_name.toLowerCase().includes(search.toLowerCase()) ||
      item.batch_no.toLowerCase().includes(search.toLowerCase());
    const matchActive = showAll || item.qty > 0;
    const matchCompany = !companyFilter || String(item.company_id) === String(companyFilter);
    return matchSearch && matchActive && matchCompany;
  });
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedInventory } = usePagination(filtered, 25);

  const expiringSoon = data.filter(item => {
    if (!item.exp_date) return false;
    const exp = new Date(item.exp_date);
    const now = new Date();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 90 && diffDays > 0;
  });

  const expired = data.filter(item => item.exp_date && new Date(item.exp_date) < new Date());

  const getRowStyle = (item) => {
    if (!item.exp_date) return {};
    const exp = new Date(item.exp_date);
    const now = new Date();
    if (exp < now) return { background: '#fef2f2' };
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    if (diffDays <= 30) return { background: '#fff7ed' };
    return {};
  };

  // ---------- Manual Add Inventory modal logic ----------

  const checkBatchConflict = useCallback(async (idx, product_id, batch_no, exp_date, retail_price) => {
    if (!product_id || !batch_no) return;
    try {
      const r = await api.get(`/inventory/check-batch?product_id=${product_id}&batch_no=${batch_no}`);
      if (r.data) {
        const existing = r.data;
        const expConflict = exp_date && existing.exp_date && exp_date !== existing.exp_date.split('T')[0];
        const priceConflict = retail_price && existing.retail_price && parseFloat(retail_price) !== parseFloat(existing.retail_price);
        setInvItems(prev => prev.map((it, i) => i === idx ? { ...it, _existingBatch: existing, _expConflict: expConflict, _priceConflict: priceConflict } : it));
      } else {
        setInvItems(prev => prev.map((it, i) => i === idx ? { ...it, _existingBatch: null, _expConflict: false, _priceConflict: false } : it));
      }
    } catch { }
  }, []);

  const selectProduct = (idx, product) => {
    setInvItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      return {
        ...it,
        product_id: product.id,
        product_search: product.name,
        pack_size: product.pack_size || '',
        purchase_rate: product.purchase_rate ? Math.round(product.purchase_rate) : '',
        retail_price: product.retail_price ? Math.round(product.retail_price) : '',
        sale_rate: product.sale_rate ? Math.round(product.sale_rate) : '',
      };
    }));
  };

  const updateInvItem = (idx, field, value) => {
    setInvItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const newIt = { ...it, [field]: value };
      if (field === 'product_search') {
        newIt.product_id = '';
        newIt.pack_size = '';
        newIt.purchase_rate = '';
        newIt.retail_price = '';
        newIt.sale_rate = '';
        newIt.batch_no = '';
        newIt._existingBatch = null;
        newIt._expConflict = false;
        newIt._priceConflict = false;
      }
      return newIt;
    }));
    if (['batch_no', 'exp_date', 'retail_price'].includes(field)) {
      setTimeout(() => {
        setInvItems(prev => {
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

  const addInvRow = () => setInvItems(p => [...p, createInventoryItem()]);
  const removeInvRow = (idx) => setInvItems(p => p.filter((_, i) => i !== idx));

  const validateInvItems = (validItems) => {
    for (let i = 0; i < validItems.length; i++) {
      const r = validItems[i];
      const rowNum = i + 1;
      if (!r.batch_no) return `Row ${rowNum}: Batch No is required`;
      if (!r.exp_date) return `Row ${rowNum}: Expiry Date is required`;
      if (!r.qty || parseFloat(r.qty) <= 0) return `Row ${rowNum}: Qty is required`;
      if (canViewPurchaseRates && (!r.purchase_rate || parseFloat(r.purchase_rate) <= 0)) return `Row ${rowNum}: Purchase Rate is required`;
      if (!r.retail_price || parseFloat(r.retail_price) <= 0) return `Row ${rowNum}: Retail Price is required`;
    }
    return null;
  };

  const openAddInventory = () => {
    setInvItems([createInventoryItem()]);
    setInvModal(true);
  };

  const handleSaveInventory = async () => {
    const validItems = invItems.filter(it => it.product_id);
    if (validItems.length === 0) return toast.error('Add at least one product');
    const err = validateInvItems(validItems);
    if (err) return toast.error(err);

    setInvSaving(true);
    try {
      await api.post('/inventory/manual', { items: validItems });
      toast.success('Inventory added successfully!');
      setInvModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error adding inventory');
    } finally {
      setInvSaving(false);
    }
  };

  const inputSm = { fontSize: 12, padding: '6px 7px' };

  return (
    <Layout title="Inventory">
      {lowStock.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          <span className="material-symbols-outlined" style={{ marginRight: 8, fontSize: 18 }}>warning</span>
          <span>
            <strong>{lowStock.length} item{lowStock.length > 1 ? 's' : ''}</strong> running low on stock:&nbsp;
            {lowStock.slice(0, 3).map(i => i.product_name).join(', ')}
            {lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Batches', value: data.length, icon: 'inventory_2', color: '#dbeafe' },
          { label: 'Low Stock', value: lowStock.length, icon: 'warning', color: '#fef3c7', textColor: '#d97706' },
          { label: 'Expiring (90d)', value: expiringSoon.length, icon: 'schedule', color: '#fce7f3', textColor: '#be185d' },
          { label: 'Expired', value: expired.length, icon: 'cancel', color: '#fee2e2', textColor: '#dc2626' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className="stat-icon" style={{ background: s.color }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>{s.icon}</span></div>
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.textColor || 'var(--gray-900)' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Stock Ledger
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
              {filtered.length} {showAll ? 'total' : 'active'} batches
            </span>
          </div>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            {/* Company filter */}
            <select
              className="form-control"
              style={{ width: 180, fontSize: 13 }}
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
            >
              <option value="">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Active / All toggle */}
            <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
              <button
                className="btn btn-sm"
                style={{
                  background: !showAll ? 'white' : 'transparent',
                  boxShadow: !showAll ? 'var(--shadow-sm)' : 'none',
                  color: !showAll ? 'var(--navy)' : 'var(--gray-500)',
                  fontWeight: !showAll ? 700 : 500,
                  border: 'none', borderRadius: 6, padding: '5px 14px'
                }}
                onClick={() => setShowAll(false)}
              >
                Active Only
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: showAll ? 'white' : 'transparent',
                  boxShadow: showAll ? 'var(--shadow-sm)' : 'none',
                  color: showAll ? 'var(--navy)' : 'var(--gray-500)',
                  fontWeight: showAll ? 700 : 500,
                  border: 'none', borderRadius: 6, padding: '5px 14px'
                }}
                onClick={() => setShowAll(true)}
              >
                All Products
              </button>
            </div>

            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input
                placeholder="Search product or batch..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {canAddInventory && (
              <button
                className="btn bg-white btn-xl btn-icon"
                title="Add inventory manually"
                onClick={openAddInventory}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_circle</span>
              </button>
            )}
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory_2</span></div>
              <div className="empty-state-title">No inventory found</div>
              <div className="empty-state-desc">
                {!showAll ? 'Try switching to "All Products" to see zero-stock items' : 'No records match your filters'}
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Company</th>
                  <th>Pack Size</th>
                  <th>Batch No</th>
                  <th>Qty</th>
                  {canViewPurchaseRates && <th>Purchase Rate</th>}
                  <th>Sale Rate</th>
                  <th>Retail Price</th>
                  <th>Exp Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedInventory.map((item, i) => {
                  const isLow = item.qty > 0 && item.qty <= item.low_stock_threshold;
                  const isExpired = item.exp_date && new Date(item.exp_date) < new Date();
                  const isExpiringSoon = !isExpired && item.exp_date &&
                    (new Date(item.exp_date) - new Date()) / (1000 * 60 * 60 * 24) <= 90;
                  const isInactive = item.qty === 0;

                  return (
                    <tr key={i} style={{ ...getRowStyle(item), opacity: isInactive ? 0.55 : 1 }}>
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      <td>
                        {item.company_name
                          ? <span className="badge badge-blue" style={{ fontSize: 11 }}>{item.company_name}</span>
                          : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                      </td>
                      <td>{item.pack_size || '—'}</td>
                      <td><span className="mono badge badge-gray">{item.batch_no}</span></td>
                      <td>
                        <span style={{ fontWeight: 700, color: isInactive ? 'var(--gray-400)' : isLow ? 'var(--red)' : 'var(--green)' }}>
                          {isLow && <span className="low-stock-dot" style={{ marginRight: 5 }} />}
                          {item.qty}
                        </span>
                      </td>
                      <td className="mono">{canViewPurchaseRates && item.show_purchase_rate !== false && item.show_purchase_rate !== 0 ? formatCurrency(item.purchase_rate) : '—'}</td>
                      <td className="mono">{formatCurrency(item.sale_rate)}</td>
                      <td className="mono">{formatCurrency(item.retail_price)}</td>
                      <td>
                        {item.exp_date ? (
                          <span style={{
                            color: isExpired ? 'var(--red)' : isExpiringSoon ? 'var(--amber)' : 'var(--gray-700)',
                            fontWeight: isExpired || isExpiringSoon ? 700 : 400
                          }}>
                            {new Date(item.exp_date).toLocaleDateString()}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        {isInactive
                          ? <span className="badge badge-gray">Out of Stock</span>
                          : isExpired ? <span className="badge badge-red">Expired</span>
                          : isExpiringSoon ? <span className="badge badge-amber">Expiring Soon</span>
                          : isLow ? <span className="badge badge-red">Low Stock</span>
                          : <span className="badge badge-green">In Stock</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
          pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Manual Add Inventory Modal — for migrating stock from the previous system.
          No purchase / supplier / ledger records are created here, only inventory rows. */}
      <Modal isOpen={invModal} onClose={() => setInvModal(false)}
        title="Add Inventory Manually"
        size="xl"
        footer={
            <button className="btn btn-primary btn-std" onClick={handleSaveInventory} disabled={invSaving}>
              {invSaving ? 'Saving...' : 'Save Inventory'}
            </button>
        }>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 0.7fr 1fr 1fr 0.7fr 1fr 1fr 1fr 90px 36px',
          gap: 5, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 5,
          fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase'
        }}>
          <span>Product *</span><span>Pack</span><span>Batch No *</span><span>Exp Date *</span>
          <span>Qty *</span>{canViewPurchaseRates ? <span>Purch.Rate *</span> : <span style={{ color: 'var(--gray-400)' }}>Purch.Rate</span>}
          <span>Sale Rate</span><span>Retail Price *</span><span>Low Stock At</span><span></span>
        </div>

        {invItems.map((item, idx) => (
          <div key={item.row_id || idx} style={{ marginBottom: 6 }}>
            {(item._expConflict || item._priceConflict) && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', marginBottom: 3, fontSize: 11, color: '#92400e' }}>
                ⚠ {item._expConflict && `Expiry conflict (existing: ${item._existingBatch?.exp_date?.split('T')[0]})`}
                {item._expConflict && item._priceConflict && ' · '}
                {item._priceConflict && `Retail price conflict (existing: PKR ${Math.round(item._existingBatch?.retail_price)})`}
                {' — saving will add this qty on top of the existing batch.'}
              </div>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 0.7fr 1fr 1fr 0.7fr 1fr 1fr 1fr 90px 36px',
              gap: 5, alignItems: 'center', padding: '7px 8px',
              background: item._expConflict || item._priceConflict ? '#fffbeb' : 'white',
              border: `1.5px solid ${item._expConflict || item._priceConflict ? '#fde68a' : 'var(--gray-200)'}`,
              borderRadius: 8
            }}>
              <div style={{ position: 'relative' }}>
                <input className="form-control" style={inputSm} value={item.product_search}
                  placeholder="Search product" autoComplete="off"
                  onChange={e => updateInvItem(idx, 'product_search', e.target.value)}
                  onBlur={() => setTimeout(() => {
                    setInvItems(prev => {
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

              <input className="form-control" style={inputSm} placeholder="Pack"
                value={item.pack_size} onChange={e => updateInvItem(idx, 'pack_size', e.target.value)} />

              <input className="form-control" style={{ ...inputSm, borderColor: !item.batch_no && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Batch *" value={item.batch_no}
                onChange={e => updateInvItem(idx, 'batch_no', e.target.value)} />

              <input className="form-control" type="date"
                style={{ ...inputSm, width: '100%', borderColor: !item.exp_date && item.product_id ? 'var(--red)' : undefined }}
                value={item.exp_date} onChange={e => updateInvItem(idx, 'exp_date', e.target.value)} />

              <input className="form-control" type="number" step="1" min="0" style={{ ...inputSm, borderColor: !item.qty && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Qty *" value={item.qty}
                onChange={e => updateInvItem(idx, 'qty', e.target.value)}
                inputMode="numeric" />

              {canViewPurchaseRates ? (
                <input className="form-control" type="number" style={{ ...inputSm, borderColor: !item.purchase_rate && item.product_id ? 'var(--red)' : undefined }}
                  placeholder="Rate *" value={item.purchase_rate}
                  onChange={e => updateInvItem(idx, 'purchase_rate', e.target.value)} />
              ) : (
                <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center' }}>Hidden</div>
              )}

              <input className="form-control" type="number" style={inputSm}
                placeholder="Sale Rate" value={item.sale_rate}
                onChange={e => updateInvItem(idx, 'sale_rate', e.target.value)} />

              <input className="form-control" type="number" style={{ ...inputSm, borderColor: !item.retail_price && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Retail *" value={item.retail_price}
                onChange={e => updateInvItem(idx, 'retail_price', e.target.value)} />

              <input className="form-control no-spinner" type="number" step="1" min="0" style={inputSm}
                placeholder="10" value={item.low_stock_threshold}
                onChange={e => updateInvItem(idx, 'low_stock_threshold', e.target.value)}
                inputMode="numeric" />

              <button
                title="Remove row"
                onClick={() => removeInvRow(idx)}
                disabled={invItems.length === 1}
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
          </div>
        ))}

        <button className="btn btn-outline btn-sm mt-2" onClick={addInvRow}>+ Add Row</button>
      </Modal>
    </Layout>
  );
}
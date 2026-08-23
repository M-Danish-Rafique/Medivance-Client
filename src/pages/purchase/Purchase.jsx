import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';
import { formatCurrency } from '../../utils/formatters';

const emptyItem = {
  row_id: null,
  product_id: '', product_search: '', pack_size: '', purchase_rate: '', sale_rate: '',
  qty: '', batch_no: '', exp_date: '', retail_price: '', bonus: 0,
  discount_pct: 0, tax_pct: 0, total: 0,
  _expConflict: false, _priceConflict: false, _existingBatch: null
};

const createPurchaseItem = () => ({ ...emptyItem, row_id: `purchase-${Date.now()}-${Math.random().toString(16).slice(2)}` });

// Guard against the classic <input type="number"> footgun where scrolling
// over a focused field silently increments/decrements its value. Blurring on
// wheel lets the page scroll act as intended and leaves the value untouched.
const blockNumberWheel = (e) => e.currentTarget.blur();

// Client-side implementation of the six-step landed-cost formula that
// backend/purchase.js runs at commit time — mirrored here so the operator
// can see the Eff. Purchase Rate per Item inline before saving, without a
// round-trip. Kept in lockstep with `computeLineLandedCost` on the server.
const computeEffPurchaseRate = (item) => {
  const rate = parseFloat(item.purchase_rate || 0);
  const disc = parseFloat(item.discount_pct  || 0);
  const tax  = parseFloat(item.tax_pct       || 0);
  const qty  = parseInt  (item.qty           || 0, 10);
  const bon  = parseInt  (item.bonus         || 0, 10);
  if (!rate || !qty) return null;
  const netRate    = rate * (1 - disc / 100);
  const finalRate  = netRate * (1 + tax / 100);
  const totalStock = qty + bon;
  if (totalStock <= 0) return null;
  return Math.round((finalRate * qty / totalStock) * 10000) / 10000;
};

const today = () => todayPKT();
const fmtPKR = (n) => `PKR ${Math.round(parseFloat(n || 0)).toLocaleString()}`;

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

// Sortable-column comparator map for the Purchase list. Same shape and
// contract as the one in Sale.js: every entry returns a signed number,
// direction is applied by the caller. Purchase IDs (P26-00001) sort
// correctly as plain strings because the YY prefix and 5-digit sequence
// are both fixed-width. `date` is a DATE_FORMAT'd ISO string from the
// backend, so localeCompare handles it correctly too.
const SORT_COMPARATORS = {
  purchase_id:   (a, b) => (a.purchase_id   || '').localeCompare(b.purchase_id   || ''),
  invoice_no:    (a, b) => (a.invoice_no    || '').localeCompare(b.invoice_no    || ''),
  supplier_name: (a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || ''),
  date:          (a, b) => (a.date          || '').localeCompare(b.date          || ''),
  total_amount:  (a, b) => parseFloat(a.total_amount || 0) - parseFloat(b.total_amount || 0),
};

// Sortable table header cell — mirrors the Sale.js implementation exactly
// so the two lists feel identical when clicked. Kept local rather than
// shared through a common component because this workspace is a
// review/patch folder (see AGENTS.md); the real app should hoist both
// copies to a single shared component in a follow-up.
function SortableHeader({ column, label, sortConfig, onSort, align, style }) {
  const active = sortConfig.column === column;
  const iconName = active
    ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward')
    : 'unfold_more';
  const isRight = align === 'right';
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align || 'left',
        ...(style || {})
      }}
      title={`Sort by ${label}`}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        justifyContent: isRight ? 'flex-end' : 'flex-start',
        width: '100%'
      }}>
        {label}
        <span className="material-symbols-outlined" style={{
          fontSize: 14,
          color: active ? 'var(--gray-700)' : 'var(--gray-300)',
          transition: 'color 0.2s ease',
          lineHeight: 1
        }}>{iconName}</span>
      </span>
    </th>
  );
}

// Standalone searchable product-filter dropdown used by the Purchase
// filter panel — same UX and code shape as the one in Sale.js. Backed
// by the FULL product list so old purchases whose products no longer
// have active stock stay filterable.
function ProductFilterAutocomplete({ products, value, onChange, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // Keep the visible text in sync with an externally-set value
  // (e.g. Clear Filters resets `value` to '').
  useEffect(() => {
    if (!value) { setSearch(''); return; }
    const prod = products.find(p => p.id === value || p.id === parseInt(value));
    if (prod) setSearch(prod.name);
  }, [value, products]);

  const suggestions = getProductSuggestions(products, search);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder={placeholder}
        autoComplete="off"
        value={search}
        onChange={e => {
          setSearch(e.target.value);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onChange(''); setSearch(''); }}
          title="Clear"
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--gray-400)', fontSize: 16, lineHeight: 1, padding: 2
          }}
        >×</button>
      )}
      {open && search && !value && (
        <div style={{
          position: 'absolute', top: 38, left: 0, right: 0, zIndex: 60,
          background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8,
          boxShadow: '0 10px 20px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto'
        }}>
          {suggestions.length === 0 ? (
            <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--gray-400)' }}>No products found</div>
          ) : suggestions.map(prod => (
            <button key={prod.id} type="button" onMouseDown={() => { onChange(prod.id); setSearch(prod.name); setOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--gray-900)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10
              }}>
              <span>{prod.name}</span>
              {prod.pack_size && (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                  {prod.pack_size}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


export default function Purchase() {
  const { user, can } = useAuth();
  const [purchases, setPurchases] = useState([]);

  // ─── Filters ───────────────────────────────────────────────────────────
  // Same collapsed-by-default + draft-vs-applied pattern as Sale.js:
  // typing/selecting in the panel edits `draftFilters` and only commits
  // to `filters` (which actually drives filteredPurchases) when the
  // operator hits Apply — so the table doesn't re-filter on every
  // keystroke.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const emptyFilters = { supplier_id: '', date_from: '', date_to: '', purchase_id: '', invoice_no: '', product_id: '' };
  const [filters, setFilters] = useState(emptyFilters);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const isEmptyFilters = (f) => Object.values(f).every(v => !v);
  const activeFilterCount = Object.values(filters).filter(v => !!v).length;
  const clearFilters = () => { setDraftFilters(emptyFilters); setFilters(emptyFilters); };
  const applyFilters = () => { setFilters(draftFilters); setFiltersOpen(false); };

  // Sortable table column state. Declared alongside filter state (before
  // the useMemos below) so the sortedPurchases memo can read it without
  // triggering a temporal-dead-zone error at mount.
  //
  // Defaults to date DESC — matches the backend's
  // `ORDER BY p.date DESC, p.id DESC`, so an operator who never touches
  // a header sees the same order the server returned.
  const [sortConfig, setSortConfig] = useState({ column: 'date', direction: 'desc' });

  const filteredPurchases = useMemo(() => {
    const purchaseIdQuery = filters.purchase_id.trim().toLowerCase();
    const invoiceQuery    = filters.invoice_no.trim().toLowerCase();
    const productFilterId = filters.product_id ? String(filters.product_id) : '';
    return purchases.filter(p => {
      if (filters.supplier_id && String(p.supplier_id) !== String(filters.supplier_id)) return false;
      if (filters.date_from && p.date < filters.date_from) return false;
      if (filters.date_to   && p.date > filters.date_to)   return false;
      if (purchaseIdQuery && !(p.purchase_id || '').toLowerCase().includes(purchaseIdQuery)) return false;
      if (invoiceQuery    && !(p.invoice_no  || '').toLowerCase().includes(invoiceQuery))    return false;
      if (productFilterId) {
        // product_ids comes from the backend as a comma-separated string of
        // every distinct product_id sold on that purchase (see GET /purchases).
        const productIds = (p.product_ids || '').split(',').filter(Boolean);
        if (!productIds.includes(productFilterId)) return false;
      }
      return true;
    });
  }, [purchases, filters]);

  // Sort applied on top of filteredPurchases. Kept in its own useMemo so
  // toggling sort direction doesn't re-run the filter predicate.
  const sortedPurchases = useMemo(() => {
    const cmp = SORT_COMPARATORS[sortConfig.column];
    if (!cmp) return filteredPurchases;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return [...filteredPurchases].sort((a, b) => cmp(a, b) * dir);
  }, [filteredPurchases, sortConfig]);

  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedPurchases } = usePagination(sortedPurchases, 25);
  // Reset to page 1 whenever the filter set changes so the operator isn't
  // stranded on page 4 of a result set that no longer has 4 pages. Sort
  // changes intentionally do NOT reset — same data, reordered.
  //
  // Note: `setPage` is intentionally omitted from the dependency list —
  // it's a stable setter from usePagination and adding it can cause a
  // re-render loop if the hook returns a fresh reference each render.
  // No eslint-disable directive here because this project's ESLint
  // config does not register `eslint-plugin-react-hooks`, and Vercel's
  // strict CI build fails on directives that reference unknown rules.
  useEffect(() => { setPage(1); }, [filters]);

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
  const [items, setItems] = useState([createPurchaseItem()]);

  // Rate-change confirmation flow. When the backend returns 409 with a
  // per-line preview of the weighted-average change, we stash it here and
  // pop a modal. On confirm we re-submit the same payload with
  // `confirm_rate_change: true`.
  const [rateChangePreview, setRateChangePreview] = useState(null); // null | { lines, mode: 'add'|'edit' }
  const canViewPurchaseRates = user?.role === 'admin' || can('perm_view_purchase_rate');

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

  const selectProduct = (idx, product) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      return {
        ...it,
        product_id: product.id,
        product_search: product.name,
        pack_size: product.pack_size || '',
        purchase_rate: product.purchase_rate ? Math.round(product.purchase_rate) : '',
        retail_price: product.retail_price ? Math.round(product.retail_price) : '',
        sale_rate: product.sale_rate ? Math.round(product.sale_rate) : '',
        total: calcTotal({
          ...it,
          product_id: product.id,
          pack_size: product.pack_size || '',
          purchase_rate: product.purchase_rate ? Math.round(product.purchase_rate) : '',
          retail_price: product.retail_price ? Math.round(product.retail_price) : '',
          sale_rate: product.sale_rate ? Math.round(product.sale_rate) : '',
        }),
      };
    }));
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const updated = prev.map((it, i) => {
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

  const addItem = () => setItems(p => [...p, createPurchaseItem()]);
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
        ...createPurchaseItem(),
        product_id: it.product_id, product_search: it.product_name || '', pack_size: it.pack_size || '',
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

    await submitPurchase(validItems, /* confirmed */ false);
  };

  // Actual submit. Split from handleSave so the confirm-modal path can
  // re-invoke with `confirmed=true` after the operator agrees to the
  // weighted-average rate change.
  const submitPurchase = async (validItems, confirmed) => {
    const isEdit = modal === 'edit' && selected;
    const body = { ...header, items: validItems };
    if (confirmed) body.confirm_rate_change = true;

    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/purchases/${selected.id}`, body);
        toast.success('Purchase updated — inventory and ledger adjusted');
      } else {
        await api.post('/purchases', body);
        toast.success('Purchase saved successfully!');
      }
      setRateChangePreview(null);
      setModal(false); load();
    } catch (err) {
      // 409 with requires_confirmation === 'confirm_rate_change' means the
      // server has computed the weighted-average preview and is waiting
      // for the operator to acknowledge before applying.
      if (
        err.response?.status === 409 &&
        err.response?.data?.requires_confirmation === 'confirm_rate_change'
      ) {
        setRateChangePreview({
          lines: err.response.data.preview?.lines || [],
          items: validItems,
          mode:  isEdit ? 'edit' : 'add',
        });
      } else {
        toast.error(err.response?.data?.message || 'Error saving');
      }
    } finally { setSaving(false); }
  };

  const confirmRateChangeAndSave = async () => {
    if (!rateChangePreview) return;
    await submitPurchase(rateChangePreview.items, /* confirmed */ true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/purchases/${selected.id}`);
      toast.success('Purchase deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error'); } finally { setDeleting(false); }
  };

  // Column sort cycles asc ↔ desc on the active column, or switches to a
  // new column (starting ascending).
  const handleSort = (col) => {
    setSortConfig(prev => (
      prev.column === col
        ? { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column: col, direction: 'asc' }
    ));
  };

  const inputSm = { fontSize: 12, padding: '6px 7px' };

  return (
    <Layout title="Purchase">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Purchase Records</div>
            <div className="text-sm text-muted mt-1">
              {activeFilterCount > 0
                ? `${filteredPurchases.length} of ${purchases.length} purchases`
                : `${purchases.length} purchases recorded`}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-outline"
              onClick={() => setFiltersOpen(o => !o)}
              style={{
                justifyContent: 'center',
                padding: '9px 12px',
                background: '#fff',
                color: 'var(--gray-500)',
                borderColor: 'var(--gray-200)',
                fontWeight: 550
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 0, color: 'var(--gray-400)' }}>filter_list</span>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginLeft: 0, color: 'var(--gray-400)' }}>
                {filtersOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            <button className="btn btn-primary" onClick={openAdd}>+ New Purchase</button>
          </div>
        </div>

        {/* Filter panel — mirrors the Sale.js pattern: animated collapse,
            draft-vs-applied filters, balanced 3-col × 2-row grid so there
            are no bolted-on rows or empty cells. */}
        <div
          style={{
            maxHeight: filtersOpen ? 460 : 0,
            opacity: filtersOpen ? 1 : 0,
            // Once open, let the product-filter dropdown escape this
            // container's bounds instead of being clipped by it.
            overflow: filtersOpen ? 'visible' : 'hidden',
            background: '#fff',
            borderTop: filtersOpen ? '1px solid var(--gray-200)' : 'none',
            borderBottom: filtersOpen ? '1px solid var(--gray-200)' : 'none',
            transition: 'max-height 0.32s ease, opacity 0.24s ease, border-color 0.24s ease',
            // Establish a stacking context above the table below so the
            // dropdown suggestion list always paints on top of it.
            position: 'relative',
            zIndex: 30
          }}
        >
          <div style={{ padding: '18px 20px' }}>
            {/* Row 1 = who (supplier) + when (dates).
                Row 2 = what (product) + the two identifier lookups. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 14 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Supplier</label>
                <select className="form-control" value={draftFilters.supplier_id}
                  onChange={e => setDraftFilters(p => ({ ...p, supplier_id: e.target.value }))}>
                  <option value="">— All Suppliers —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Date From</label>
                <input className="form-control" type="date" value={draftFilters.date_from}
                  onChange={e => setDraftFilters(p => ({ ...p, date_from: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Date To</label>
                <input className="form-control" type="date" value={draftFilters.date_to}
                  onChange={e => setDraftFilters(p => ({ ...p, date_to: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Product</label>
                <ProductFilterAutocomplete
                  products={products}
                  value={draftFilters.product_id}
                  onChange={id => setDraftFilters(p => ({ ...p, product_id: id }))}
                  placeholder="Search product…"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Purchase ID</label>
                <input className="form-control" placeholder="Search purchase ID…" value={draftFilters.purchase_id}
                  onChange={e => setDraftFilters(p => ({ ...p, purchase_id: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Invoice No</label>
                <input className="form-control" placeholder="Search invoice no…" value={draftFilters.invoice_no}
                  onChange={e => setDraftFilters(p => ({ ...p, invoice_no: e.target.value }))} />
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--gray-100)'
            }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={clearFilters}
                disabled={isEmptyFilters(draftFilters) && isEmptyFilters(filters)}
                style={{ background: 'transparent', border: 'none', color: 'var(--gray-500)', fontWeight: 600, padding: '8px 4px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>filter_alt_off</span>
                Clear Filters
              </button>
              <button type="button" className="btn btn-primary" onClick={applyFilters}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>search</span>
                Apply Filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : purchases.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">📥</div><div className="empty-state-title">No purchases yet</div></div>
            : filteredPurchases.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>filter_alt_off</span></div>
                <div className="empty-state-title">No purchases match your filters</div>
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={clearFilters}>Clear Filters</button>
              </div>
            )
            : (
              <table>
                <thead>
                  <tr>
                    <SortableHeader column="purchase_id"   label="Purchase ID"  sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="invoice_no"    label="Invoice No"   sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="supplier_name" label="Supplier"     sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="date"          label="Date"         sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="total_amount"  label="Total Amount" sortConfig={sortConfig} onSort={handleSort} align="right" />
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPurchases.map(p => (
                    <tr key={p.id}>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{p.purchase_id}</td>
                      <td className="mono">{p.invoice_no || '—'}</td>
                      <td>{p.supplier_name}</td>
                      <td>{formatDatePKT(p.date)}</td>
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
          <span>Qty *</span>{canViewPurchaseRates ? <span>Purch.Rate *</span> : <span style={{ color: 'var(--gray-400)' }}>Purch.Rate</span>}<span>Retail Price *</span>
          <span>Bonus</span><span>Disc %</span><span>Tax %</span>
          <span style={{ textAlign: 'right' }}>Total</span><span></span>
        </div>

        {items.map((item, idx) => (
          <div key={item.row_id || idx} style={{ marginBottom: 6 }}>
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
              <div style={{ position: 'relative' }}>
                <input className="form-control" style={inputSm} value={item.product_search}
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

              <input className="form-control" style={inputSm} placeholder="Pack"
                value={item.pack_size} onChange={e => updateItem(idx, 'pack_size', e.target.value)} />

              <input className="form-control" style={{ ...inputSm, borderColor: !item.batch_no && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Batch *" value={item.batch_no}
                onChange={e => updateItem(idx, 'batch_no', e.target.value)} />

              <input className="form-control" type="date"
                style={{ ...inputSm, width: '100%', borderColor: !item.exp_date && item.product_id ? 'var(--red)' : undefined }}
                value={item.exp_date} onChange={e => updateItem(idx, 'exp_date', e.target.value)} />

              <input className="form-control" type="number" step="1" min="0" style={{ ...inputSm, borderColor: !item.qty && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Qty *" value={item.qty}
                onChange={e => updateItem(idx, 'qty', e.target.value)}
                onWheel={blockNumberWheel}
                inputMode="numeric" />

              {canViewPurchaseRates ? (
                <input className="form-control" type="number" step="1" min="0" style={{ ...inputSm, borderColor: !item.purchase_rate && item.product_id ? 'var(--red)' : undefined }}
                  placeholder="Rate *" value={item.purchase_rate}
                  onChange={e => updateItem(idx, 'purchase_rate', e.target.value)}
                  onWheel={blockNumberWheel} />
              ) : (
                <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center' }}>Hidden</div>
              )}

              <input className="form-control" type="number" step="1" min="0" style={{ ...inputSm, borderColor: !item.retail_price && item.product_id ? 'var(--red)' : undefined }}
                placeholder="Retail *" value={item.retail_price}
                onChange={e => updateItem(idx, 'retail_price', e.target.value)}
                onWheel={blockNumberWheel} />

              <input className="form-control no-spinner" type="number" step="1" min="0" style={inputSm}
                value={item.bonus} onChange={e => updateItem(idx, 'bonus', e.target.value)}
                onWheel={blockNumberWheel}
                inputMode="numeric" />

              <input className="form-control no-spinner" type="number" step="0.5" min="0" max="100" style={inputSm}
                value={item.discount_pct} onChange={e => updateItem(idx, 'discount_pct', e.target.value)}
                onWheel={blockNumberWheel}
                inputMode="decimal" />

              <input className="form-control no-spinner" type="number" step="0.5" min="0" max="100" style={inputSm}
                value={item.tax_pct} onChange={e => updateItem(idx, 'tax_pct', e.target.value)}
                onWheel={blockNumberWheel}
                inputMode="decimal" />

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
              <div style={{ padding: '4px 8px 0', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Sale Rate:</span>
                <input type="number" step="1" min="0" value={item.sale_rate}
                  onChange={e => updateItem(idx, 'sale_rate', e.target.value)}
                  onWheel={blockNumberWheel}
                  style={{ width: 90, padding: '3px 6px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 11, fontFamily: 'inherit' }}
                  placeholder="Sale Rate" />
                {item.bonus > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--teal)' }}>
                    + {item.bonus} bonus units (total {parseInt(item.qty || 0) + parseInt(item.bonus || 0)} to inventory)
                  </span>
                )}
                {/* Effective landed cost per unit — computed client-side using
                   the same 6-step formula the server applies, so the operator
                   sees exactly what will land in inventory.purchase_rate
                   BEFORE hitting Save. */}
                {(() => {
                  const effRate = computeEffPurchaseRate(item);
                  if (effRate == null) return null;
                  return (
                    <span style={{
                      fontSize: 11, color: 'var(--navy)', fontWeight: 700,
                      background: 'var(--blue-ultra, #eef4ff)', padding: '2px 8px',
                      borderRadius: 999, border: '1px dashed var(--blue-pale, #cbdbff)',
                    }} title="Effective landed cost per unit after discount, tax, and bonus dilution — this is what will land in inventory.purchase_rate">
                      Eff. Purchase Rate/Unit: {formatCurrency(effRate)}
                    </span>
                  );
                })()}
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
                { label: 'Date', val: formatDatePKT(viewData.date) },
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
                    <td style={{ fontSize: 12 }}>{it.exp_date ? formatDatePKT(it.exp_date) : '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.bonus || 0}</td>
                    <td className="mono">{canViewPurchaseRates ? `PKR ${Math.round(it.purchase_rate).toLocaleString()}` : '—'}</td>
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

      {/* Rate-change confirmation. Rendered as a modal that lists every line
         whose inventory purchase_rate will move because of this purchase,
         showing the weighted-average target rate and the delta. Operator
         hits Confirm to re-submit with `confirm_rate_change: true`. */}
      <Modal isOpen={!!rateChangePreview} onClose={() => setRateChangePreview(null)}
        title="Confirm Purchase Rate Change" size="lg"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setRateChangePreview(null)} disabled={saving}>
              Back
            </button>
            <button className="btn btn-primary" onClick={confirmRateChangeAndSave} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm & Save'}
            </button>
          </div>
        }>
        {rateChangePreview && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 12 }}>
              One or more batches already exist in inventory. Saving this purchase
              will blend the new landed cost with the current inventory rate using a
              weighted average across the remaining stock. Please review before confirming.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6,
              padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6,
              fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
              <span>Product / Batch</span>
              <span>Landed Rate</span>
              <span>Existing Rate</span>
              <span>Existing Qty</span>
              <span>New Weighted Rate</span>
              <span>Change</span>
            </div>
            {rateChangePreview.lines.map((l, idx) => {
              const changed = l.rate_change_required;
              const delta = l.existing_in_inventory
                ? (l.weighted_rate - (l.existing_rate || 0))
                : 0;
              return (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                  gap: 6, alignItems: 'center', padding: '7px 8px', marginBottom: 5,
                  background: changed ? '#fffbeb' : 'white',
                  border: `1.5px solid ${changed ? '#f59e0b' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{l.product_name || `Product ${l.product_id}`}</div>
                    <div style={{ fontSize: 10, color: 'var(--gray-500)' }}>Batch: {l.batch_no}</div>
                  </div>
                  <div style={{ fontWeight: 700 }}>{formatCurrency(l.landed_cost_steps?.landed_rate)}</div>
                  <div>{l.existing_in_inventory ? formatCurrency(l.existing_rate) : '—'}</div>
                  <div>{l.existing_in_inventory ? l.existing_qty : '—'}</div>
                  <div style={{ fontWeight: 700, color: changed ? '#b45309' : 'var(--gray-800)' }}>
                    {l.existing_in_inventory ? formatCurrency(l.weighted_rate) : formatCurrency(l.landed_cost_steps?.landed_rate)}
                  </div>
                  <div style={{ fontWeight: 600, color: delta > 0 ? 'var(--red)' : delta < 0 ? 'var(--green)' : 'var(--gray-400)' }}>
                    {l.existing_in_inventory
                      ? `${delta > 0 ? '+' : ''}${delta.toFixed(4)}`
                      : 'New'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </Layout>
  );
}

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';
import { formatDatePKT, todayPKT, addMonthsPKT } from '../../utils/dateUtils';

// Column visibility defaults for the Stock Ledger table. Keys must match the
// `field` used by the sort/header/body render code below. Toggled via the
// kebab menu in the table header — persisted to localStorage so a user's
// preference survives reloads.
const DEFAULT_COLUMN_VISIBILITY = {
  company_name:     false, // hidden by default (badge is redundant on the shop floor)
  pack_size:        true,
  batch_no:         true,
  qty:              true,
  purchase_rate:    true,  // gated separately by canSeePurchaseRateForItem
  sale_rate:        true,
  retail_price:     false, // hidden by default
  total_cost:       true,  // qty * purchase_rate — shown as "Cost"
  total_sale_value: true,  // qty * sale_rate — shown as "Revenue"
  profit:           false, // hidden by default (Revenue − Cost)
  exp_date:         true,
  status:           true,
};

// Edit action is intentionally NOT in this list — the edit button lives in
// the trailing kebab-menu column and is always available for permitted users.
const COLUMN_MENU_ITEMS = [
  { key: 'company_name',     label: 'Company Name' },
  { key: 'pack_size',        label: 'Pack'         },
  { key: 'batch_no',         label: 'Batch No'     },
  { key: 'qty',              label: 'Qty'          },
  { key: 'purchase_rate',    label: 'Pur. Rate'    },
  { key: 'sale_rate',        label: 'Sale Rate'    },
  { key: 'retail_price',     label: 'Retail Price' },
  { key: 'total_cost',       label: 'Cost'         },
  { key: 'total_sale_value', label: 'Revenue'      },
  { key: 'profit',           label: 'Profit'       },
  { key: 'exp_date',         label: 'Exp Date'     },
  { key: 'status',           label: 'Status'       },
];

const COLUMN_VISIBILITY_STORAGE_KEY = 'inventory.columnVisibility.v1';

// Status priority for column sorting — lowest priority (worst state) first
// under ascending order so operators see the problems that need attention.
const statusRank = (item) => {
  const qty = parseFloat(item.qty) || 0;
  if (qty === 0) return 0;
  if (item.exp_date && new Date(item.exp_date) < new Date()) return 1;
  if (item.exp_date && (new Date(item.exp_date) - new Date()) / 86400000 <= 90) return 2;
  if (qty <= item.low_stock_threshold) return 3;
  return 4;
};

// Sortable table header cell. Click cycles asc → desc → asc. Uses the same
// material icons as the rest of the app; inactive columns show a faint
// `unfold_more` glyph so users know the header is interactive. Icon size
// is kept just under the header text so the row height matches a plain <th>.
function SortableTh({ field, label, sortField, sortOrder, onSort }) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      {label}
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 13,
          marginLeft: 3,
          verticalAlign: 'middle',
          lineHeight: 1,
          color: active ? 'var(--navy)' : 'var(--gray-300)',
          transition: 'color 0.15s ease',
        }}
      >
        {active ? (sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
      </span>
    </th>
  );
}

const emptyInventoryItem = {
  row_id: null,
  product_id: '', product_search: '', pack_size: '',
  batch_no: '', exp_date: '', qty: '',
  purchase_rate: '', sale_rate: '', retail_price: '',
  low_stock_threshold: '',
};

const createInventoryItem = () => ({ ...emptyInventoryItem, row_id: `inv-${Date.now()}-${Math.random().toString(16).slice(2)}` });

// Guard against the classic <input type="number"> footgun where scrolling
// over a focused field silently increments/decrements its value. Blurring on
// wheel lets the page scroll act as intended and leaves the value untouched.
const blockNumberWheel = (e) => e.currentTarget.blur();

const getProductSuggestions = (products, query) => {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return [];
  return products
    .map(p => {
      // Defensive: a product with a missing name would otherwise crash
      // the whole page here. Treat it as an empty name — it just won't
      // match any query.
      const name = (p?.name || '').toLowerCase();
      return {
        product: p,
        score: name.startsWith(normalized) ? 0 : name.includes(normalized) ? 1 : 2,
      };
    })
    .filter(item => item.score < 2)
    .sort((a, b) => a.score - b.score || (a.product.name || '').localeCompare(b.product.name || ''))
    .slice(0, 8)
    .map(item => item.product);
};

export default function Inventory() {
  const { user, can } = useAuth();
  const [data, setData] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);        // false = active only (qty > 0)
  const [companyFilter, setCompanyFilter] = useState(''); // company_id or ''
  const [analyticsFilter, setAnalyticsFilter] = useState(null); // null | 'low_stock' | 'expiring' | 'expired'
  const canViewPurchaseRates = user?.role === 'admin' || can('perm_view_purchase_rate');
  const canAddInventory = user?.role === 'admin' || can('perm_manage_inventory') || can('perm_add_purchase');

  // Admin bypass — matches the backend's sanitizeInventoryRowsWithAdminBypass
  // in backend/inventory.js. For any user with the base view permission we
  // then respect the per-product `show_purchase_rate` flag; for admins the
  // rate is ALWAYS visible regardless of that flag (they need the number to
  // run the business — the flag is meant to hide cost data from junior
  // staff, not from account owners).
  const isAdmin = user?.role === 'admin';
  const canSeePurchaseRateForItem = (item) => {
    if (!canViewPurchaseRates) return false;
    if (isAdmin) return true;
    return item?.show_purchase_rate !== false && item?.show_purchase_rate !== 0;
  };

  // Manual "Add Inventory" modal state
  const [invModal, setInvModal] = useState(false);
  const [invItems, setInvItems] = useState([createInventoryItem()]);
  const [invSaving, setInvSaving] = useState(false);

  // Edit Inventory Batch modal state
  const [editModal, setEditModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // Rate-change confirmation flow for the Edit modal. When the backend
  // detects that purchase_rate / sale_rate / retail_price is moving, it
  // returns 409 with a preview; we stash it here and pop a confirmation
  // dialog before resubmitting with `confirm_rate_change: true`.
  const [editRatePreview, setEditRatePreview] = useState(null);
  const canEditInventory = user?.role === 'admin' || can('perm_manage_inventory') || can('perm_add_purchase');

  // Print Inventory modal state
  const [printModal, setPrintModal] = useState(false);
  const [printCompany, setPrintCompany] = useState('');
  const [printLoading, setPrintLoading] = useState(false);

  // ─── Sorting ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState('product_name');
  const [sortOrder, setSortOrder] = useState('asc');

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // ─── Column visibility (kebab menu in table header) ──────────────────────
  const [columnVisibility, setColumnVisibility] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (raw) return { ...DEFAULT_COLUMN_VISIBILITY, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_COLUMN_VISIBILITY;
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch {}
  }, [columnVisibility]);

  useEffect(() => {
    if (!showColumnMenu) return;
    const onDocClick = (e) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target)) {
        setShowColumnMenu(false);
      }
    };
    const onEsc = (e) => { if (e.key === 'Escape') setShowColumnMenu(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showColumnMenu]);

  const toggleColumn = (key) =>
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  const isColVisible = (key) => columnVisibility[key] !== false;
  const resetColumns = () => setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/inventory'),
      api.get('/companies'),
      api.get('/products'),
    ]).then(([inv, comp, prod]) => {
      setData(inv.data);
      setCompanies(comp.data);
      setProducts(prod.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = data.filter(item => {
    const q = (search || '').toLowerCase();
    const matchSearch =
      (item.product_name || '').toLowerCase().includes(q) ||
      (item.batch_no    || '').toLowerCase().includes(q);
    // "Active Only" hides qty=0 batches by default, but the Low Stock stat
    // card explicitly targets out-of-stock items — bypass the active filter
    // for that analytics view so a user drilling into Low Stock always sees
    // the zero-qty batches regardless of the toggle position.
    const matchActive = showAll || item.qty > 0 || analyticsFilter === 'low_stock';
    const matchCompany = !companyFilter || String(item.company_id) === String(companyFilter);

    let matchAnalytics = true;
    if (analyticsFilter) {
      // "Low Stock" now includes qty = 0 (out of stock) — a zero-qty batch is
      // the most urgent restock signal, so it belongs in the same bucket.
      const isLow = item.qty <= item.low_stock_threshold;
      const isExpired = item.exp_date && new Date(item.exp_date) < new Date();
      const isExpiringSoon =
        !isExpired &&
        item.exp_date &&
        (new Date(item.exp_date) - new Date()) / (1000 * 60 * 60 * 24) <= 90;

      if (analyticsFilter === 'low_stock') matchAnalytics = isLow;
      else if (analyticsFilter === 'expiring') matchAnalytics = isExpiringSoon;
      else if (analyticsFilter === 'expired') matchAnalytics = isExpired;
    }

    return matchSearch && matchActive && matchCompany && matchAnalytics;
  });

  // Sort AFTER filter so the sort key applies to the visible slice only. Sort
  // is stable-ish (Array.sort is stable in modern JS) so ties keep the
  // original SQL order (product → batch).
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortOrder === 'asc' ? 1 : -1;

    const cmpStr = (a, b) => (a || '').toString().localeCompare((b || '').toString(), undefined, { sensitivity: 'base', numeric: true });
    const cmpNum = (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0);

    arr.sort((a, b) => {
      let r = 0;
      switch (sortField) {
        case 'product_name':    r = cmpStr(a.product_name, b.product_name); break;
        case 'company_name':    r = cmpStr(a.company_name, b.company_name); break;
        case 'pack_size':       r = cmpStr(a.pack_size, b.pack_size); break;
        case 'batch_no':        r = cmpStr(a.batch_no, b.batch_no); break;
        case 'qty':             r = cmpNum(a.qty, b.qty); break;
        case 'purchase_rate':   r = cmpNum(a.purchase_rate, b.purchase_rate); break;
        case 'sale_rate':       r = cmpNum(a.sale_rate, b.sale_rate); break;
        case 'retail_price':    r = cmpNum(a.retail_price, b.retail_price); break;
        case 'total_cost':      r = cmpNum((a.qty || 0) * (a.purchase_rate || 0), (b.qty || 0) * (b.purchase_rate || 0)); break;
        case 'total_sale_value':r = cmpNum((a.qty || 0) * (a.sale_rate     || 0), (b.qty || 0) * (b.sale_rate     || 0)); break;
        case 'profit': {
          const av = (a.qty || 0) * ((a.sale_rate || 0) - (a.purchase_rate || 0));
          const bv = (b.qty || 0) * ((b.sale_rate || 0) - (b.purchase_rate || 0));
          r = cmpNum(av, bv);
          break;
        }
        case 'exp_date': {
          // Null/undefined expiries sink to the bottom regardless of order.
          const av = a.exp_date ? new Date(a.exp_date).getTime() : null;
          const bv = b.exp_date ? new Date(b.exp_date).getTime() : null;
          if (av === null && bv === null) r = 0;
          else if (av === null) return 1;
          else if (bv === null) return -1;
          else r = av - bv;
          break;
        }
        case 'status':          r = statusRank(a) - statusRank(b); break;
        default:                r = cmpStr(a.product_name, b.product_name);
      }
      return r * dir;
    });
    return arr;
  }, [filtered, sortField, sortOrder]);
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedInventory } = usePagination(sorted, 25);

  const expiringSoon = data.filter(item => {
    if (!item.exp_date) return false;
    const exp = new Date(item.exp_date);
    const now = new Date();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 90 && diffDays > 0;
  });

  const expired = data.filter(item => item.exp_date && new Date(item.exp_date) < new Date());

  // Include out-of-stock (qty = 0) in the Low Stock count. Computed
  // client-side because the backend /inventory/low-stock endpoint filters
  // qty > 0 for the (removed) banner use case.
  const lowStockCount = data.filter(item => item.qty <= item.low_stock_threshold).length;

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

  // ---------- Edit Inventory Batch modal logic ----------

  const minAllowedExpDate = addMonthsPKT(todayPKT(), 3);

  const openEdit = (item) => {
    setEditItem({
      id: item.id,
      product_name: item.product_name,
      pack_size: item.pack_size,
      purchase_rate: item.purchase_rate,
      show_purchase_rate: item.show_purchase_rate,
      batch_no: item.batch_no || '',
      qty: item.qty ?? '',
      exp_date: item.exp_date ? item.exp_date.split('T')[0] : '',
      sale_rate: item.sale_rate ?? '',
      retail_price: item.retail_price ?? '',
      low_stock_threshold: item.low_stock_threshold ?? '',
    });
    setEditModal(true);
  };

  const updateEditField = (field, value) => {
    setEditItem(prev => ({ ...prev, [field]: value }));
  };

  const validateEditItem = (it) => {
    if (!it.batch_no || !it.batch_no.trim()) return 'Batch No is required';
    if (it.qty === '' || it.qty === null || it.qty === undefined || parseFloat(it.qty) < 0) return 'Qty must not be less than 0';
    if (it.exp_date && it.exp_date < minAllowedExpDate) {
      return 'Expiry Date must be more than 3 months from today';
    }
    const purchaseRate = parseFloat(it.purchase_rate) || 0;
    const saleRate = it.sale_rate === '' ? NaN : parseFloat(it.sale_rate);
    const retailPrice = it.retail_price === '' ? NaN : parseFloat(it.retail_price);
    if (isNaN(saleRate) || isNaN(retailPrice)) return 'Sale Rate and Retail Price are required';
    if (canViewPurchaseRates && saleRate < purchaseRate) {
      return `Sale Rate cannot be less than Purchase Rate (${formatCurrency(purchaseRate)})`;
    }
    if (retailPrice < saleRate) return 'Retail Price cannot be less than Sale Rate';
    if (it.low_stock_threshold !== '' && parseInt(it.low_stock_threshold) < 1) {
      return 'Low Stock Threshold must be at least 1';
    }
    return null;
  };

  // Per-field validity, used to redden the border of only the offending input(s)
  const getEditFieldErrors = (it) => {
    const purchaseRate = parseFloat(it.purchase_rate) || 0;
    const saleRate = it.sale_rate === '' ? NaN : parseFloat(it.sale_rate);
    const retailPrice = it.retail_price === '' ? NaN : parseFloat(it.retail_price);
    const saleBelowPurchase = canViewPurchaseRates && !isNaN(saleRate) && saleRate < purchaseRate;
    const retailBelowSale = !isNaN(saleRate) && !isNaN(retailPrice) && retailPrice < saleRate;

    return {
      batch_no: !it.batch_no || !it.batch_no.trim(),
      qty: it.qty === '' || it.qty === null || it.qty === undefined || parseFloat(it.qty) < 0,
      exp_date: !!(it.exp_date && it.exp_date < minAllowedExpDate),
      low_stock_threshold: it.low_stock_threshold !== '' && parseInt(it.low_stock_threshold) < 1,
      sale_rate: isNaN(saleRate) || saleBelowPurchase,
      retail_price: isNaN(retailPrice) || retailBelowSale,
    };
  };

  const handleSaveEdit = async (confirmed = false) => {
    if (!editItem) return;
    const err = validateEditItem(editItem);
    if (err) return toast.error(err);

    setEditSaving(true);
    try {
      const body = {
        batch_no:            editItem.batch_no.trim(),
        qty:                 editItem.qty,
        exp_date:            editItem.exp_date || null,
        purchase_rate:       editItem.purchase_rate,
        sale_rate:           editItem.sale_rate,
        retail_price:        editItem.retail_price,
        low_stock_threshold: editItem.low_stock_threshold || null,
      };
      if (confirmed) body.confirm_rate_change = true;
      await api.put(`/inventory/${editItem.id}`, body);
      toast.success('Inventory batch updated successfully!');
      setEditRatePreview(null);
      setEditModal(false);
      setEditItem(null);
      load();
    } catch (err) {
      // 409 with requires_confirmation === 'confirm_rate_change' means one
      // of the three rates has moved. Server sends before/after values so
      // the confirm modal can explain the change to the operator.
      if (
        err.response?.status === 409 &&
        err.response?.data?.requires_confirmation === 'confirm_rate_change'
      ) {
        setEditRatePreview(err.response.data.preview);
      } else {
        toast.error(err.response?.data?.message || 'Error updating inventory');
      }
    } finally {
      setEditSaving(false);
    }
  };

  const confirmEditRateChange = () => handleSaveEdit(true);

  // ---------- Print Inventory modal logic ----------

  const openPrintModal = () => {
    setPrintCompany(companyFilter); // sensible default: reuse whatever the page is already filtered to
    setPrintModal(true);
  };

  const handlePrintInventory = async () => {
    setPrintLoading(true);
    try {
      const params = new URLSearchParams();
      if (printCompany) params.append('company_id', printCompany);
      const res = await api.get(`/inventory/print/pdf?${params.toString()}`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      setPrintModal(false);
    } catch (err) {
      toast.error('Error generating inventory PDF');
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <Layout title="Inventory">
      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {[
          {
            label: "Total Batches",
            value: data.length,
            icon: "inventory_2",
            color: "#dbeafe",
            key: null,
          },
          {
            label: "Low Stock",
            value: lowStockCount,
            icon: "warning",
            color: "#fef3c7",
            textColor: "#d97706",
            key: "low_stock",
          },
          {
            label: "Expiring (90d)",
            value: expiringSoon.length,
            icon: "schedule",
            color: "#fce7f3",
            textColor: "#be185d",
            key: "expiring",
          },
          {
            label: "Expired",
            value: expired.length,
            icon: "cancel",
            color: "#fee2e2",
            textColor: "#dc2626",
            key: "expired",
          },
        ].map((s, i) => {
          // "Total Batches" (key === null) always clears the filter and is
          // never shown as "active" — only the three specific filters get
          // a visual indication when applied.
          const isActive = s.key !== null && analyticsFilter === s.key;
          return (
            <div
              key={i}
              className="stat-card"
              onClick={() => setAnalyticsFilter(s.key)}
              title={
                s.key === null
                  ? "Show all batches"
                  : isActive
                  ? "Click to clear this filter"
                  : `Filter by ${s.label}`
              }
              style={{
                cursor: "default",
                border: isActive
                  ? `1px solid ${s.textColor || "var(--navy)"}`
                  : "1px solid transparent",
                boxShadow: isActive ? "var(--shadow-sm)" : undefined,
                transition: "border-color 0.15s ease",
              }}
            >
              <div className="stat-icon" style={{ background: s.color }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20 }}
                >
                  {s.icon}
                </span>
              </div>
              <div>
                <div className="stat-label">{s.label}</div>
                <div
                  className="stat-value"
                  style={{ color: s.textColor || "var(--gray-900)" }}
                >
                  {s.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Stock Ledger
            <span
              style={{
                fontSize: 12,
                fontWeight: 400,
                color: "var(--gray-400)",
                marginLeft: 8,
              }}
            >
              {filtered.length} {showAll ? "total" : "active"} batches
            </span>
          </div>
          <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
            {/* Company filter */}
            <select
              className="form-control"
              style={{ width: 180, fontSize: 13 }}
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Active / All toggle */}
            <div
              style={{
                display: "flex",
                background: "var(--gray-100)",
                borderRadius: 8,
                padding: 3,
                gap: 2,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  background: !showAll ? "white" : "transparent",
                  boxShadow: !showAll ? "var(--shadow-sm)" : "none",
                  color: !showAll ? "var(--navy)" : "var(--gray-500)",
                  fontWeight: !showAll ? 700 : 500,
                  border: "none",
                  borderRadius: 6,
                  padding: "5px 14px",
                }}
                onClick={() => setShowAll(false)}
              >
                Active Only
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: showAll ? "white" : "transparent",
                  boxShadow: showAll ? "var(--shadow-sm)" : "none",
                  color: showAll ? "var(--navy)" : "var(--gray-500)",
                  fontWeight: showAll ? 700 : 500,
                  border: "none",
                  borderRadius: 6,
                  padding: "5px 14px",
                }}
                onClick={() => setShowAll(true)}
              >
                All Products
              </button>
            </div>

            <div className="search-bar">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                search
              </span>
              <input
                placeholder="Search product or batch..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              className="btn bg-white btn-xl btn-icon"
              title="Print inventory report"
              onClick={openPrintModal}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                print
              </span>
            </button>

            {canAddInventory && (
              <button
                className="btn bg-white btn-xl btn-icon"
                title="Add inventory manually"
                onClick={openAddInventory}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  add_circle
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center">
              <div className="spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 28 }}
                >
                  inventory_2
                </span>
              </div>
              <div className="empty-state-title">No inventory found</div>
              <div className="empty-state-desc">
                {analyticsFilter
                  ? "No batches match this filter. Click Total Batches to clear it."
                  : !showAll
                  ? 'Try switching to "All Products" to see zero-stock items'
                  : "No records match your filters"}
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <SortableTh field="product_name" label="Product Name" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />
                  {isColVisible('company_name')  && <SortableTh field="company_name"  label="Company"      sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {isColVisible('pack_size')     && <SortableTh field="pack_size"     label="Pack"         sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {isColVisible('batch_no')      && <SortableTh field="batch_no"      label="Batch No"     sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {isColVisible('qty')           && <SortableTh field="qty"           label="Qty"          sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {canViewPurchaseRates && isColVisible('purchase_rate') && (
                    <SortableTh field="purchase_rate" label="Pur. Rate" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />
                  )}
                  {isColVisible('sale_rate')     && <SortableTh field="sale_rate"     label="Sale Rate"    sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {isColVisible('retail_price')  && <SortableTh field="retail_price"  label="Retail Price" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {canViewPurchaseRates && isColVisible('total_cost') && (
                    <SortableTh field="total_cost" label="Cost" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />
                  )}
                  {isColVisible('total_sale_value') && (
                    <SortableTh field="total_sale_value" label="Revenue" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />
                  )}
                  {canViewPurchaseRates && isColVisible('profit') && (
                    <SortableTh field="profit" label="Profit" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />
                  )}
                  {isColVisible('exp_date')      && <SortableTh field="exp_date" label="Exp Date" sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {isColVisible('status')        && <SortableTh field="status"   label="Status"   sortField={sortField} sortOrder={sortOrder} onSort={toggleSort} />}
                  {/* Kebab column-visibility menu — always shown as the last header cell */}
                  <th style={{ width: 40, textAlign: 'center', position: 'relative' }}>
                    <div ref={columnMenuRef} style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        type="button"
                        title="Show/hide columns"
                        aria-label="Show/hide columns"
                        aria-haspopup="true"
                        aria-expanded={showColumnMenu}
                        onClick={(e) => { e.stopPropagation(); setShowColumnMenu(v => !v); }}
                        style={{
                          background: showColumnMenu ? 'var(--gray-100)' : 'transparent',
                          border: 'none', padding: 2, borderRadius: 4,
                          color: 'var(--gray-600)', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                          more_vert
                        </span>
                      </button>
                      {showColumnMenu && (
                        <div
                          role="menu"
                          style={{
                            position: 'absolute', top: 26, right: 0, zIndex: 30,
                            background: 'white', border: '1px solid var(--gray-200)',
                            borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            minWidth: 170, padding: 4, textAlign: 'left',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {COLUMN_MENU_ITEMS.map((c) => {
                            const checked = isColVisible(c.key);
                            return (
                              <label
                                key={c.key}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '4px 8px', cursor: 'pointer',
                                  fontSize: 11, color: 'var(--gray-700)',
                                  borderRadius: 4, fontWeight: 400,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleColumn(c.key)}
                                  style={{ margin: 0, cursor: 'pointer' }}
                                />
                                <span style={{ flex: 1 }}>{c.label}</span>
                              </label>
                            );
                          })}
                          <div style={{
                            borderTop: '1px solid var(--gray-100)',
                            marginTop: 4, paddingTop: 4, textAlign: 'right',
                          }}>
                            <button
                              type="button"
                              onClick={resetColumns}
                              style={{
                                background: 'transparent', border: 'none',
                                color: 'var(--gray-500)', fontSize: 11,
                                cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                              }}
                              title="Reset to defaults"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedInventory.map((item, i) => {
                  const isLow =
                    item.qty > 0 && item.qty <= item.low_stock_threshold;
                  const isExpired =
                    item.exp_date && new Date(item.exp_date) < new Date();
                  const isExpiringSoon =
                    !isExpired &&
                    item.exp_date &&
                    (new Date(item.exp_date) - new Date()) /
                      (1000 * 60 * 60 * 24) <=
                      90;
                  const isInactive = item.qty === 0;

                  const qtyNum       = parseFloat(item.qty) || 0;
                  const purchaseRate = parseFloat(item.purchase_rate) || 0;
                  const saleRate     = parseFloat(item.sale_rate)     || 0;
                  const totalCost      = qtyNum * purchaseRate;
                  const totalSaleValue = qtyNum * saleRate;
                  const profit         = totalSaleValue - totalCost;

                  return (
                    <tr
                      key={i}
                      style={{
                        ...getRowStyle(item),
                        opacity: isInactive ? 0.55 : 1,
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      {isColVisible('company_name') && (
                        <td>
                          {item.company_name ? (
                            <span className="badge badge-blue" style={{ fontSize: 11 }}>
                              {item.company_name}
                            </span>
                          ) : (
                            <span style={{ color: "var(--gray-300)" }}>—</span>
                          )}
                        </td>
                      )}
                      {isColVisible('pack_size') && <td>{item.pack_size || "—"}</td>}
                      {isColVisible('batch_no') && (
                        <td>
                          <span className="mono badge badge-gray">
                            {item.batch_no}
                          </span>
                        </td>
                      )}
                      {isColVisible('qty') && (
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color: isInactive
                                ? "var(--gray-400)"
                                : isLow
                                  ? "var(--red)"
                                  : "var(--green)",
                            }}
                          >
                            {isLow && (
                              <span
                                className="low-stock-dot"
                                style={{ marginRight: 5 }}
                              />
                            )}
                            {item.qty}
                          </span>
                        </td>
                      )}
                      {canViewPurchaseRates && isColVisible('purchase_rate') && (
                        <td className="mono">
                          {canSeePurchaseRateForItem(item)
                            ? formatCurrency(item.purchase_rate)
                            : "—"}
                        </td>
                      )}
                      {isColVisible('sale_rate') && (
                        <td className="mono">{formatCurrency(item.sale_rate)}</td>
                      )}
                      {isColVisible('retail_price') && (
                        <td className="mono">{formatCurrency(item.retail_price)}</td>
                      )}
                      {canViewPurchaseRates && isColVisible('total_cost') && (
                        <td className="mono">
                          {canSeePurchaseRateForItem(item)
                            ? formatCurrency(totalCost)
                            : "—"}
                        </td>
                      )}
                      {isColVisible('total_sale_value') && (
                        <td className="mono">
                          {formatCurrency(totalSaleValue)}
                        </td>
                      )}
                      {canViewPurchaseRates && isColVisible('profit') && (
                        <td className="mono">
                          {canSeePurchaseRateForItem(item)
                            ? formatCurrency(profit)
                            : "—"}
                        </td>
                      )}
                      {isColVisible('exp_date') && (
                        <td>
                          {item.exp_date ? (
                            <span
                              style={{
                                color: isExpired
                                  ? "var(--red)"
                                  : isExpiringSoon
                                    ? "var(--amber)"
                                    : "var(--gray-700)",
                                fontWeight:
                                  isExpired || isExpiringSoon ? 700 : 400,
                              }}
                            >
                              {formatDatePKT(item.exp_date)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {isColVisible('status') && (
                        <td>
                          {isInactive ? (
                            <span className="badge badge-gray">Out of Stock</span>
                          ) : isExpired ? (
                            <span className="badge badge-red">Expired</span>
                          ) : isExpiringSoon ? (
                            <span className="badge badge-amber">
                              Expiring Soon
                            </span>
                          ) : isLow ? (
                            <span className="badge badge-red">Low Stock</span>
                          ) : (
                            <span className="badge badge-green">In Stock</span>
                          )}
                        </td>
                      )}
                      {/* Edit action — always shown for permitted users, sits under
                          the kebab-menu column so the header stays clean. */}
                      <td style={{ textAlign: 'center', width: 40 }}>
                        {canEditInventory && (
                          <button
                            className="btn btn-outline btn-sm btn-icon"
                            title="Edit batch"
                            aria-label="Edit batch"
                            onClick={() => openEdit(item)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              edit
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Manual Add Inventory Modal — for migrating stock from the previous system.
          No purchase / supplier / ledger records are created here, only inventory rows. */}
      <Modal
        isOpen={invModal}
        onClose={() => setInvModal(false)}
        title="Add Inventory Manually"
        size="xl"
        footer={
          <button
            className="btn btn-primary btn-std"
            onClick={handleSaveInventory}
            disabled={invSaving}
          >
            {invSaving ? "Saving..." : "Save Inventory"}
          </button>
        }
      >
        {/* Column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "2fr 0.7fr 1fr 1fr 0.7fr 1fr 1fr 1fr 90px 36px",
            gap: 5,
            padding: "5px 8px",
            background: "var(--gray-50)",
            borderRadius: 6,
            marginBottom: 5,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--gray-500)",
            textTransform: "uppercase",
          }}
        >
          <span>Product *</span>
          <span>Pack</span>
          <span>Batch No *</span>
          <span>Exp Date *</span>
          <span>Qty *</span>
          {canViewPurchaseRates ? (
            <span>Purch.Rate *</span>
          ) : (
            <span style={{ color: "var(--gray-400)" }}>Purch.Rate</span>
          )}
          <span>Sale Rate</span>
          <span>Retail Price *</span>
          <span>Low Stock At</span>
          <span></span>
        </div>

        {invItems.map((item, idx) => (
          <div key={item.row_id || idx} style={{ marginBottom: 6 }}>
            {(item._expConflict || item._priceConflict) && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 6,
                  padding: "4px 10px",
                  marginBottom: 3,
                  fontSize: 11,
                  color: "#92400e",
                }}
              >
                ⚠{" "}
                {item._expConflict &&
                  `Expiry conflict (existing: ${item._existingBatch?.exp_date?.split("T")[0]})`}
                {item._expConflict && item._priceConflict && " · "}
                {item._priceConflict &&
                  `Retail price conflict (existing: PKR ${Math.round(item._existingBatch?.retail_price)})`}
                {" — saving will add this qty on top of the existing batch."}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "2fr 0.7fr 1fr 1fr 0.7fr 1fr 1fr 1fr 90px 36px",
                gap: 5,
                alignItems: "center",
                padding: "7px 8px",
                background:
                  item._expConflict || item._priceConflict
                    ? "#fffbeb"
                    : "white",
                border: `1.5px solid ${item._expConflict || item._priceConflict ? "#fde68a" : "var(--gray-200)"}`,
                borderRadius: 8,
              }}
            >
              <div style={{ position: "relative" }}>
                <input
                  className="form-control"
                  style={inputSm}
                  value={item.product_search}
                  placeholder="Search product"
                  autoComplete="off"
                  onChange={(e) =>
                    updateInvItem(idx, "product_search", e.target.value)
                  }
                  onBlur={() =>
                    setTimeout(() => {
                      setInvItems((prev) => {
                        const updated = [...prev];
                        const it = updated[idx];
                        if (it && !it.product_id) {
                          updated[idx] = { ...it, product_search: "" };
                        }
                        return updated;
                      });
                    }, 150)
                  }
                />
                {item.product_search && !item.product_id && (
                  <div
                    style={{
                      position: "absolute",
                      top: 38,
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      background: "white",
                      border: "1px solid var(--gray-200)",
                      borderRadius: 8,
                      boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
                      maxHeight: 220,
                      overflowY: "auto",
                    }}
                  >
                    {getProductSuggestions(products, item.product_search).map(
                      (prod) => (
                        <button
                          key={prod.id}
                          type="button"
                          onMouseDown={() => selectProduct(idx, prod)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "9px 12px",
                            border: "none",
                            background: "white",
                            cursor: "pointer",
                            fontSize: 13,
                            color: "var(--gray-900)",
                          }}
                        >
                          {prod.name}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>

              <input
                className="form-control"
                style={inputSm}
                placeholder="Pack"
                value={item.pack_size}
                onChange={(e) =>
                  updateInvItem(idx, "pack_size", e.target.value)
                }
              />

              <input
                className="form-control"
                style={{
                  ...inputSm,
                  borderColor:
                    !item.batch_no && item.product_id
                      ? "var(--red)"
                      : undefined,
                }}
                placeholder="Batch *"
                value={item.batch_no}
                onChange={(e) => updateInvItem(idx, "batch_no", e.target.value)}
              />

              <input
                className="form-control"
                type="date"
                style={{
                  ...inputSm,
                  width: "100%",
                  borderColor:
                    !item.exp_date && item.product_id
                      ? "var(--red)"
                      : undefined,
                }}
                value={item.exp_date}
                onChange={(e) => updateInvItem(idx, "exp_date", e.target.value)}
              />

              <input
                className="form-control"
                type="number"
                step="1"
                min="0"
                style={{
                  ...inputSm,
                  borderColor:
                    !item.qty && item.product_id ? "var(--red)" : undefined,
                }}
                placeholder="Qty *"
                value={item.qty}
                onChange={(e) => updateInvItem(idx, "qty", e.target.value)}
                onWheel={blockNumberWheel}
                inputMode="numeric"
              />

              {canViewPurchaseRates ? (
                <input
                  className="form-control"
                  type="number"
                  step="1"
                  min="0"
                  style={{
                    ...inputSm,
                    borderColor:
                      !item.purchase_rate && item.product_id
                        ? "var(--red)"
                        : undefined,
                  }}
                  placeholder="Rate *"
                  value={item.purchase_rate}
                  onChange={(e) =>
                    updateInvItem(idx, "purchase_rate", e.target.value)
                  }
                  onWheel={blockNumberWheel}
                />
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--gray-400)",
                    textAlign: "center",
                  }}
                >
                  Hidden
                </div>
              )}

              <input
                className="form-control"
                type="number"
                step="1"
                min="0"
                style={inputSm}
                placeholder="Sale Rate"
                value={item.sale_rate}
                onChange={(e) =>
                  updateInvItem(idx, "sale_rate", e.target.value)
                }
                onWheel={blockNumberWheel}
              />

              <input
                className="form-control"
                type="number"
                step="1"
                min="0"
                style={{
                  ...inputSm,
                  borderColor:
                    !item.retail_price && item.product_id
                      ? "var(--red)"
                      : undefined,
                }}
                placeholder="Retail *"
                value={item.retail_price}
                onChange={(e) =>
                  updateInvItem(idx, "retail_price", e.target.value)
                }
                onWheel={blockNumberWheel}
              />

              <input
                className="form-control no-spinner"
                type="number"
                step="1"
                min="0"
                style={inputSm}
                placeholder="10"
                value={item.low_stock_threshold}
                onChange={(e) =>
                  updateInvItem(idx, "low_stock_threshold", e.target.value)
                }
                onWheel={blockNumberWheel}
                inputMode="numeric"
              />

              <button
                title="Remove row"
                onClick={() => removeInvRow(idx)}
                disabled={invItems.length === 1}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  padding: 0,
                  borderRadius: 4,
                  boxSizing: "border-box",
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                <svg
                  viewBox="0 0 12 12"
                  width="10"
                  height="10"
                  aria-hidden="true"
                  focusable="false"
                  style={{ display: "block" }}
                >
                  <path
                    d="M2 2l8 8M10 2L2 10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}

        <button className="btn btn-outline btn-sm mt-2" onClick={addInvRow}>
          + Add Row
        </button>
      </Modal>

      {/* Edit Inventory Batch Modal — only batch_no, qty, exp_date, sale_rate,
          retail_price, and low_stock_threshold can be changed here. */}
      <Modal
        isOpen={editModal}
        onClose={() => {
          setEditModal(false);
          setEditItem(null);
        }}
        title="Edit Inventory Batch"
        size="md"
        footer={
          <>
            <button
              className="btn btn-outline btn-std"
              onClick={() => {
                setEditModal(false);
                setEditItem(null);
              }}
              disabled={editSaving}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-std"
              onClick={() => handleSaveEdit(false)}
              disabled={
                editSaving || (editItem && !!validateEditItem(editItem))
              }
            >
              {editSaving ? "Saving..." : "Save Changes"}
            </button>
          </>
        }
      >
        {editItem &&
          (() => {
            const liveError = validateEditItem(editItem);
            const fieldErrors = getEditFieldErrors(editItem);
            const errorBorder = { borderColor: "var(--red)" };
            return (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "var(--gray-50)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {editItem.product_name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--gray-500)" }}>
                      {editItem.pack_size || "—"}
                    </div>
                  </div>
                  {canSeePurchaseRateForItem(editItem) && (
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--gray-500)",
                            textTransform: "uppercase",
                          }}
                        >
                          Purchase Rate
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {formatCurrency(editItem.purchase_rate)}
                        </div>
                      </div>
                    )}
                </div>

                {/* Dynamic runtime error listener — reflects the current form state on every keystroke */}
                {liveError && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "var(--red)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      marginBottom: 10,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 15 }}
                    >
                      error
                    </span>
                    {liveError}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    columnGap: 12,
                    rowGap: 7,
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Batch No *</label>
                    <input
                      className="form-control"
                      value={editItem.batch_no}
                      style={fieldErrors.batch_no ? errorBorder : undefined}
                      onChange={(e) =>
                        updateEditField("batch_no", e.target.value)
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Qty *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="1"
                      min="0"
                      style={fieldErrors.qty ? errorBorder : undefined}
                      value={editItem.qty}
                      onChange={(e) => updateEditField("qty", e.target.value)}
                      onWheel={blockNumberWheel}
                      inputMode="numeric"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Expiry Date</label>
                    <input
                      className="form-control"
                      type="date"
                      style={fieldErrors.exp_date ? errorBorder : undefined}
                      value={editItem.exp_date}
                      onChange={(e) =>
                        updateEditField("exp_date", e.target.value)
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Low Stock Threshold</label>
                    <input
                      className="form-control no-spinner"
                      type="number"
                      step="1"
                      min="1"
                      style={
                        fieldErrors.low_stock_threshold
                          ? errorBorder
                          : undefined
                      }
                      value={editItem.low_stock_threshold}
                      onChange={(e) =>
                        updateEditField("low_stock_threshold", e.target.value)
                      }
                      onWheel={blockNumberWheel}
                      inputMode="numeric"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Sale Rate *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="1"
                      min="0"
                      style={fieldErrors.sale_rate ? errorBorder : undefined}
                      value={editItem.sale_rate}
                      onChange={(e) =>
                        updateEditField("sale_rate", e.target.value)
                      }
                      onWheel={blockNumberWheel}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Retail Price *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="1"
                      min="0"
                      style={fieldErrors.retail_price ? errorBorder : undefined}
                      value={editItem.retail_price}
                      onChange={(e) =>
                        updateEditField("retail_price", e.target.value)
                      }
                      onWheel={blockNumberWheel}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* Print Inventory Modal — company filter only; date filtering is not wired up
          yet, so the PDF always stamps today's date server-side. */}
      <Modal
        isOpen={printModal}
        onClose={() => setPrintModal(false)}
        title="Print Inventory"
        size="sm"
        footer={
          <>
            <button
              className="btn btn-outline btn-std"
              onClick={() => setPrintModal(false)}
              disabled={printLoading}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-std"
              onClick={handlePrintInventory}
              disabled={printLoading}
            >
              {printLoading ? (
                <>
                  <span
                    className="spinner spinner-border"
                    style={{
                      width: "16px",
                      height: "16px",
                      marginRight: 6,
                      borderWidth: "2px",
                    }}
                  />
                  Generating...
                </>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 16,
                      verticalAlign: "middle",
                      marginRight: 4,
                    }}
                  >
                    picture_as_pdf
                  </span>
                  Generate PDF
                </>
              )}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Company</label>
          <select
            className="form-control"
            value={printCompany}
            onChange={(e) => setPrintCompany(e.target.value)}
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Date</label>
          <input
            className="form-control"
            value={formatDatePKT(new Date())}
            disabled
            style={{ background: "var(--gray-50)", color: "var(--gray-500)" }}
          />
        </div>
      </Modal>

      {/* Rate-change confirmation for the Edit modal. Server returns 409
          with before/after values for the three price fields; this modal
          shows a compact diff and confirms with `confirm_rate_change: true`. */}
      <Modal isOpen={!!editRatePreview} onClose={() => setEditRatePreview(null)}
        title="Confirm Rate Change" size="sm"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setEditRatePreview(null)} disabled={editSaving}>
              Back
            </button>
            <button className="btn btn-primary" onClick={confirmEditRateChange} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Confirm & Save'}
            </button>
          </div>
        }>
        {editRatePreview && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 12 }}>
              You're about to change one or more of this batch's rates.
              Please review before saving — these figures drive Sale, Profit,
              and Inventory reports.
            </div>
            {[
              { key: 'purchase_rate', label: 'Purchase Rate' },
              { key: 'sale_rate',     label: 'Sale Rate'     },
              { key: 'retail_price',  label: 'Retail Price'  },
            ].map(({ key, label }) => {
              const before = editRatePreview.existing?.[key];
              const after  = editRatePreview.new?.[key];
              const changed = editRatePreview.changed?.[key];
              if (!changed) return null;
              return (
                <div key={key} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8, alignItems: 'center', padding: '8px 10px',
                  marginBottom: 6, background: '#fffbeb',
                  border: '1.5px solid #f59e0b', borderRadius: 8,
                }}>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                  <div style={{ color: 'var(--gray-500)' }}>
                    From: {formatCurrency(before)}
                  </div>
                  <div style={{ fontWeight: 700, color: '#b45309' }}>
                    To: {formatCurrency(after)}
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
import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';

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

  // Edit Inventory Batch modal state
  const [editModal, setEditModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const canEditInventory = user?.role === 'admin' || can('perm_manage_inventory') || can('perm_add_purchase');

  // Print Inventory modal state
  const [printModal, setPrintModal] = useState(false);
  const [printCompany, setPrintCompany] = useState('');
  const [printLoading, setPrintLoading] = useState(false);

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

  // ---------- Edit Inventory Batch modal logic ----------

  const minAllowedExpDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return todayPKT(d);
  })();

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

  const handleSaveEdit = async () => {
    if (!editItem) return;
    const err = validateEditItem(editItem);
    if (err) return toast.error(err);

    setEditSaving(true);
    try {
      await api.put(`/inventory/${editItem.id}`, {
        batch_no: editItem.batch_no.trim(),
        qty: editItem.qty,
        exp_date: editItem.exp_date || null,
        sale_rate: editItem.sale_rate,
        retail_price: editItem.retail_price,
        low_stock_threshold: editItem.low_stock_threshold || null,
      });
      toast.success('Inventory batch updated successfully!');
      setEditModal(false);
      setEditItem(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error updating inventory');
    } finally {
      setEditSaving(false);
    }
  };

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
      {lowStock.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          <span
            className="material-symbols-outlined"
            style={{ marginRight: 8, fontSize: 18 }}
          >
            warning
          </span>
          <span>
            <strong>
              {lowStock.length} item{lowStock.length > 1 ? "s" : ""}
            </strong>{" "}
            running low on stock:&nbsp;
            {lowStock
              .slice(0, 3)
              .map((i) => i.product_name)
              .join(", ")}
            {lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ""}
          </span>
        </div>
      )}

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
          },
          {
            label: "Low Stock",
            value: lowStock.length,
            icon: "warning",
            color: "#fef3c7",
            textColor: "#d97706",
          },
          {
            label: "Expiring (90d)",
            value: expiringSoon.length,
            icon: "schedule",
            color: "#fce7f3",
            textColor: "#be185d",
          },
          {
            label: "Expired",
            value: expired.length,
            icon: "cancel",
            color: "#fee2e2",
            textColor: "#dc2626",
          },
        ].map((s, i) => (
          <div key={i} className="stat-card">
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
        ))}
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
                {!showAll
                  ? 'Try switching to "All Products" to see zero-stock items'
                  : "No records match your filters"}
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
                  {canEditInventory && (
                    <th style={{ textAlign: "center" }}>Actions</th>
                  )}
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

                  return (
                    <tr
                      key={i}
                      style={{
                        ...getRowStyle(item),
                        opacity: isInactive ? 0.55 : 1,
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      <td>
                        {item.company_name ? (
                          <span
                            className="badge badge-blue"
                            style={{ fontSize: 11 }}
                          >
                            {item.company_name}
                          </span>
                        ) : (
                          <span style={{ color: "var(--gray-300)" }}>—</span>
                        )}
                      </td>
                      <td>{item.pack_size || "—"}</td>
                      <td>
                        <span className="mono badge badge-gray">
                          {item.batch_no}
                        </span>
                      </td>
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
                      <td className="mono">
                        {canViewPurchaseRates &&
                        item.show_purchase_rate !== false &&
                        item.show_purchase_rate !== 0
                          ? formatCurrency(item.purchase_rate)
                          : "—"}
                      </td>
                      <td className="mono">{formatCurrency(item.sale_rate)}</td>
                      <td className="mono">
                        {formatCurrency(item.retail_price)}
                      </td>
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
                      {canEditInventory && (
                        <td style={{ textAlign: "center" }}>
                          <button
                            className="btn btn-outline btn-sm btn-icon"
                            title="Edit batch"
                            aria-label="Edit batch"
                            onClick={() => openEdit(item)}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 16 }}
                            >
                              edit
                            </span>
                          </button>
                        </td>
                      )}
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
                inputMode="numeric"
              />

              {canViewPurchaseRates ? (
                <input
                  className="form-control"
                  type="number"
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
                style={inputSm}
                placeholder="Sale Rate"
                value={item.sale_rate}
                onChange={(e) =>
                  updateInvItem(idx, "sale_rate", e.target.value)
                }
              />

              <input
                className="form-control"
                type="number"
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
              onClick={handleSaveEdit}
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
                  {canViewPurchaseRates &&
                    editItem.show_purchase_rate !== false &&
                    editItem.show_purchase_rate !== 0 && (
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
                      inputMode="numeric"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Sale Rate *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      style={fieldErrors.sale_rate ? errorBorder : undefined}
                      value={editItem.sale_rate}
                      onChange={(e) =>
                        updateEditField("sale_rate", e.target.value)
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Retail Price *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      style={fieldErrors.retail_price ? errorBorder : undefined}
                      value={editItem.retail_price}
                      onChange={(e) =>
                        updateEditField("retail_price", e.target.value)
                      }
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
    </Layout>
  );
}
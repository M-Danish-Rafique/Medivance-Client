import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';
import { formatDatePKT, todayPKT, addMonthsPKT } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';

// Year-month only comparison (day of month ignored) — matches backend rule:
// a batch is only truly "expired" once the calendar month has rolled past its expiry month.
const isPastExpiryMonth = (expiryStr) => todayPKT().slice(0, 7) > expiryStr.slice(0, 7);

// Shared expiry classification for a return line, used both by the row-level
// display logic in ReturnTable and by the "Return Full Invoice" bulk-fill
// handler, so the two never disagree about which lines are blocked.
const getExpiryStatus = (exp_date, isAdmin) => {
  if (!exp_date) return { blocked: false, warning: false, label: null };
  const expiryStr = String(exp_date).slice(0, 10);
  const threshold = addMonthsPKT(expiryStr, -5);
  const withinWindow = todayPKT() > threshold;
  const label = formatDatePKT(expiryStr);
  if (!withinWindow) return { blocked: false, warning: false, label };
  if (isPastExpiryMonth(expiryStr)) return { blocked: true, warning: false, label };
  if (isAdmin) return { blocked: false, warning: true, label };
  return { blocked: true, warning: false, label };
};

const today = () => todayPKT();
const fmt = formatCurrency;

// Number inputs change value on mouse-wheel/trackpad scroll by default when focused.
// Blurring on wheel disables that, so only the up/down buttons or keyboard editing change the value,
// and the page still scrolls normally underneath the cursor.
const blockWheelChange = (e) => e.target.blur();

// Returns a human-readable error for a numeric field, or null when it's valid.
// Never modifies the raw value — callers keep whatever the user actually typed
// and use this only to decide whether to show an error / red border / disable Save.
const fieldError = (raw, max, label, maxLabel) => {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return `Enter a valid number for ${label}`;
  if (n < 0) return `${label} cannot be negative`;
  if (max !== undefined && max !== null && !Number.isNaN(max) && n > max + 0.009) {
    return `${label} cannot exceed ${maxLabel}`;
  }
  return null;
};

// Falls back gracefully for invoices saved before the recovery_status column existed.
const getRecoveryStatus = (sale) => {
  if (sale.recovery_status) return sale.recovery_status;
  return sale.is_locked ? 'completed' : 'pending';
};
const getPendingAmount = (sale) => {
  if (sale.pending_amount !== undefined && sale.pending_amount !== null) return parseFloat(sale.pending_amount);
  return sale.is_locked ? 0 : parseFloat(sale.total_amount || 0);
};
const getRecoveredAmount = (sale) => {
  if (sale.total_recovered !== undefined && sale.total_recovered !== null) return parseFloat(sale.total_recovered);
  return sale.is_locked ? parseFloat(sale.total_amount || 0) : 0;
};

function ReturnTable({ lines, items, isCross, updateReturnLine, fmt, isAdmin, errors = [] }) {
  return (
    <div>
      {lines.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-state-desc">No items in this invoice</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
            <span>Product</span><span>Batch / Expiry</span><span>Sold Qty</span><span>Return Qty</span><span>Rate</span><span>Return Amt</span>
          </div>
          {lines.map((line, idx) => {
            const retAmt = parseFloat(line.return_amount || 0);
            const err = errors[idx];
            let expiryBlocked = false;   // hard stop — nobody can return this, admin included
            let expiryWarning = false;   // inside the 5-month window, but admin is allowed through
            let expiryLabel = null;
            if (line.exp_date) {
              const expiryStr = String(line.exp_date).slice(0, 10);
              const threshold = addMonthsPKT(expiryStr, -5);
              const withinWindow = todayPKT() > threshold;
              expiryLabel = formatDatePKT(expiryStr);
              if (withinWindow) {
                if (isPastExpiryMonth(expiryStr)) {
                  expiryBlocked = true;
                } else if (isAdmin) {
                  expiryWarning = true;
                } else {
                  expiryBlocked = true;
                }
              }
            }
            const rowBg = expiryBlocked ? '#fef2f2' : expiryWarning ? '#fffbeb' : 'white';
            const rowBorder = err ? 'var(--red)' : expiryBlocked ? 'var(--red)' : expiryWarning ? '#f59e0b' : 'var(--gray-200)';
            return (
              <div key={line.row_id || idx} style={{ marginBottom: 5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: rowBg, border: `1.5px solid ${rowBorder}`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{line.product_name}</div>
                  <div>
                    <span className="mono badge badge-gray" style={{ fontSize: 11 }}>{line.batch_no || '—'}</span>
                    {expiryLabel && (
                      <div style={{ fontSize: 10, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, color: expiryBlocked ? 'var(--red)' : expiryWarning ? '#b45309' : 'var(--gray-500)' }}>
                        {expiryBlocked ? (
                          <span className="material-symbols-outlined" style={{ fontSize: 12, lineHeight: 1 }} aria-hidden="true">cancel</span>
                        ) : expiryWarning ? (
                          <span className="material-symbols-outlined" style={{ fontSize: 12, lineHeight: 1 }} aria-hidden="true">warning</span>
                        ) : null}
                        {expiryBlocked ? 'Return window expired' : expiryWarning ? 'Within 5-month window (admin override)' : `Exp: ${expiryLabel}`}
                      </div>
                    )}
                  </div>
                  <div style={{ color: 'var(--gray-600)' }}>{line.original_qty ?? '—'}</div>
                  <input className="form-control" type="number" step="1"
                    style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1, borderColor: err ? 'var(--red)' : undefined }}
                    placeholder="0" value={line.qty_returned} disabled={expiryBlocked}
                    onChange={e => updateReturnLine(idx, 'qty_returned', e.target.value, line, isCross)}
                    onWheel={blockWheelChange}
                    inputMode="numeric" />
                  <input className="form-control" type="number" step="0.01"
                    style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1 }}
                    value={line.return_rate} disabled={expiryBlocked}
                    onChange={e => updateReturnLine(idx, 'return_rate', e.target.value, line, isCross)}
                    onWheel={blockWheelChange} />
                  <div style={{ fontWeight: 700, color: retAmt > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>
                    {retAmt > 0 ? fmt(retAmt) : '—'}
                  </div>
                </div>
                {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function Recovery() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [allSales, setAllSales] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterCity, setFilterCity] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterTerritory, setFilterTerritory] = useState('');
  const [filterSalesman, setFilterSalesman] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterStatus, setFilterStatus] = useState('pending'); // 'pending' | 'all' — Pending Only by default

  // Payment history popup (click on an invoice row)
  const [historyModal, setHistoryModal] = useState(false);

  // Edit Recovery modal — admin only, reachable from Payment History regardless
  // of whether the invoice is already settled.
  const [editModal, setEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editAmountRecovered, setEditAmountRecovered] = useState('');
  const [editRecoveryLines, setEditRecoveryLines] = useState([]);
  const [editReturnLines, setEditReturnLines] = useState([]);
  const [editBaseline, setEditBaseline] = useState({ pendingBefore: 0, discount: 0, returnAmt: 0 });
  const [historySale, setHistorySale] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [modal, setModal] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleDetail, setSaleDetail] = useState(null);
  const [recoveryLines, setRecoveryLines] = useState([]);
  const [returnLines, setReturnLines] = useState([]);
  const [recHeader, setRecHeader] = useState({ date: today(), salesman_id: '', notes: '' });

  const createRecoveryReturnLine = (item) => ({
    row_id: `return-${item.id}-${Math.random().toString(16).slice(2)}`,
    sale_item_id: item.id, sale_id: item.sale_id || null, product_id: item.product_id,
    batch_no: item.batch_no, qty_returned: '', return_rate: item.sale_rate, return_amount: 0,
    product_name: item.product_name, original_qty: item.qty, exp_date: item.exp_date
  });
  const [amountRecovered, setAmountRecovered] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('recovery');

  // Confirmation step shown after "Save" is pressed, before the recovery is
  // actually submitted — used by both the add-recovery flow and the admin edit flow.
  const [confirmModal, setConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { type: 'add' | 'edit', payload, summary }

  // Cross-invoice return state
  const [selectedReturnInvoiceId, setSelectedReturnInvoiceId] = useState('');
  const [returnInvoiceDetail, setReturnInvoiceDetail] = useState(null);
  const [loadingReturnInvoice, setLoadingReturnInvoice] = useState(false);
  const [crossReturnLines, setCrossReturnLines] = useState([]);

  // "Return Full Invoice" checkbox state — one for the current-invoice return
  // tab, one for the previous-invoice (cross) return tab.
  const [fullReturnCurrent, setFullReturnCurrent] = useState(false);
  const [fullReturnCross, setFullReturnCross] = useState(false);

  // (Other) Pending Invoices tab — collect payment for other unpaid invoices of the same customer
  const [otherPendingInvoices, setOtherPendingInvoices] = useState([]);
  const [loadingOtherPending, setLoadingOtherPending] = useState(false);
  const [otherPayments, setOtherPayments] = useState({}); // { [saleId]: amountString }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/sales'),
      api.get('/customers'),
      api.get('/employees?role=Supplier'),
      api.get('/geography/geo'),
    ]).then(([s, c, e, g]) => {
      setAllSales(s.data); setSales(s.data);
      setCustomers(c.data); setEmployees(e.data);
      setCities(g.data.cities); setAreas(g.data.areas); setTerritories(g.data.territories);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  /* ── Filtering ── */
  useEffect(() => {
    let filtered = [...allSales];
    if (filterCity) {
      const custIds = customers.filter(c => String(c.city_id) === String(filterCity)).map(c => c.id);
      filtered = filtered.filter(s => custIds.includes(s.customer_id));
    }
    if (filterArea) {
      const custIds = customers.filter(c => String(c.area_id) === String(filterArea)).map(c => c.id);
      filtered = filtered.filter(s => custIds.includes(s.customer_id));
    }
    if (filterTerritory) {
      const custIds = customers.filter(c => String(c.territory_id) === String(filterTerritory)).map(c => c.id);
      filtered = filtered.filter(s => custIds.includes(s.customer_id));
    }
    if (filterSalesman) filtered = filtered.filter(s => String(s.salesman_id) === String(filterSalesman));
    if (filterCustomer) filtered = filtered.filter(s => String(s.customer_id) === String(filterCustomer));
    if (filterStatus === 'pending') {
      filtered = filtered.filter(s => getRecoveryStatus(s) !== 'completed');
    } else if (filterStatus === 'settled') {
      filtered = filtered.filter(s => getRecoveryStatus(s) === 'completed');
    }
    setSales(filtered);
  }, [filterCity, filterArea, filterTerritory, filterSalesman, filterCustomer, filterStatus, allSales, customers]);

  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedSales } = usePagination(sales, 25);

  const filteredAreas = areas.filter(a => !filterCity || String(a.city_id) === String(filterCity));
  const filteredTerritories = territories.filter(t => !filterArea || String(t.area_id) === String(filterArea));
  const filteredCustomers = customers.filter(c => {
    if (filterCity && String(c.city_id) !== String(filterCity)) return false;
    if (filterArea && String(c.area_id) !== String(filterArea)) return false;
    if (filterTerritory && String(c.territory_id) !== String(filterTerritory)) return false;
    return true;
  });

  // All non-locked sales for the same customer (for cross-invoice return dropdown)
  const eligibleReturnInvoices = allSales.filter(s =>
    saleDetail && s.customer_id === saleDetail.customer_id && s.id !== selectedSale?.id
  );

  /* ── Open recovery modal ── */
  const openRecovery = async (sale) => {
    try {
      const r = await api.get(`/sales/${sale.id}`);
      setSaleDetail(r.data);
      setSelectedSale(sale);
      const recLines = (r.data.items || []).map(item => ({
        sale_item_id: item.id, product_id: item.product_id, batch_no: item.batch_no,
        original_total: item.total, discount_given: '', final_amount: item.total
      }));
      const retLines = (r.data.items || []).map(item => createRecoveryReturnLine({ ...item, sale_id: sale.id }));
      setRecoveryLines(recLines);
      setReturnLines(retLines);
      setCrossReturnLines([]);
      setSelectedReturnInvoiceId('');
      setReturnInvoiceDetail(null);
      setFullReturnCurrent(false);
      setFullReturnCross(false);
      // Sale invoice stores the supplier in delivery_by (Delivery By on the Sale form) —
      // same approach as Sale.jsx's openEdit, which is confirmed working.
      const invoiceSupplierId = r.data.delivery_by ?? sale.delivery_by;
      setRecHeader({
        date: today(),
        salesman_id: invoiceSupplierId || '',
        notes: '',
      });
      setAmountRecovered('');
      setOtherPayments({});
      setOtherPendingInvoices([]);
      setActiveTab('recovery');
      setModal(true);
      loadOtherPendingInvoices(r.data.customer_id, sale.id);
    } catch { toast.error('Error loading invoice'); }
  };

  /* ── View payment history for an invoice ── */
  const openHistory = async (sale) => {
    setHistorySale(sale);
    setHistoryModal(true);
    setHistoryLoading(true);
    try {
      const r = await api.get(`/recoveries/history/${sale.id}`);
      setHistoryList(r.data);
    } catch { toast.error('Error loading payment history'); }
    setHistoryLoading(false);
  };

  /* ── Open a past recovery entry for editing (admin only) ── */
  const openEditRecovery = async (recoveryId) => {
    setEditModal(true);
    setEditLoading(true);
    try {
      const r = await api.get(`/recoveries/${recoveryId}`);
      const d = r.data;
      setEditingId(d.id);
      setEditDate(String(d.date).slice(0, 10));
      setEditNotes(d.notes || '');
      setEditAmountRecovered(String(d.net_collected ?? 0));
      // Snapshot of what was collectible/owed right when this entry originally happened —
      // used to derive a live "Pending Amount" as the admin edits discount/return/cash below.
      setEditBaseline({
        pendingBefore: parseFloat(d.pending_amount || 0) + parseFloat(d.net_collected || 0),
        discount: parseFloat(d.total_discount || 0),
        returnAmt: parseFloat(d.total_return_amount || 0),
      });
      setEditRecoveryLines((d.recovery_items || []).map(i => ({
        sale_item_id: i.sale_item_id, product_id: i.product_id, batch_no: i.batch_no,
        product_name: i.product_name, original_total: i.original_total,
        discount_given: String(i.discount_given || 0),
      })));
      setEditReturnLines((d.return_items || []).map(i => ({
        row_id: `edit-ret-${i.id}`, sale_id: i.sale_id, sale_item_id: i.sale_item_id,
        product_id: i.product_id, batch_no: i.batch_no, product_name: i.product_name,
        source_invoice: i.source_invoice, qty_returned: String(i.qty_returned),
        return_rate: String(i.return_rate),
        // Upper bound for the qty this line could be edited up to — the qty currently
        // still on the source invoice plus what this entry itself already returned.
        max_qty: (i.current_sold_qty === null || i.current_sold_qty === undefined)
          ? undefined : parseFloat(i.current_sold_qty) + parseFloat(i.qty_returned || 0),
      })));
    } catch { toast.error('Error loading recovery for edit'); setEditModal(false); }
    setEditLoading(false);
  };

  const handleEditSaveClick = () => {
    if (!editDate) return toast.error('Date required');
    const validRecovery = editRecoveryLines.filter(l => parseFloat(l.discount_given || 0) > 0).map(l => ({
      ...l, discount_given: parseFloat(l.discount_given),
      final_amount: parseFloat(l.original_total) - parseFloat(l.discount_given),
    }));
    const validReturns = editReturnLines.filter(l => parseInt(l.qty_returned || 0) > 0).map(l => ({
      ...l, qty_returned: parseInt(l.qty_returned), return_rate: parseFloat(l.return_rate),
      return_amount: parseInt(l.qty_returned) * parseFloat(l.return_rate),
    }));
    // Amount recovered is manual only — reflects exactly what's typed.
    const recovered = Number.isNaN(parseFloat(editAmountRecovered)) ? 0 : parseFloat(editAmountRecovered || 0);
    if (recovered < 0) return toast.error('Amount recovered cannot be negative');
    if (recovered > editPendingBeforePayment) {
      return toast.error(`Recovered amount cannot exceed pending balance (${fmt(editPendingBeforePayment)})`);
    }

    setPendingAction({
      type: 'edit',
      payload: { validRecovery, validReturns, recovered },
      summary: {
        discount: editDiscountTotal,
        returns: editReturnTotal,
        recovered,
        pending: Math.max(0, editPendingBeforePayment - recovered),
      },
    });
    setConfirmModal(true);
  };

  const performEditSave = async () => {
    const { validRecovery, validReturns, recovered } = pendingAction.payload;
    setEditSaving(true);
    try {
      await api.put(`/recoveries/${editingId}`, {
        date: editDate, notes: editNotes,
        recovery_items: validRecovery, return_items: validReturns,
        amount_recovered: recovered,
      });
      toast.success('Recovery entry updated.');
      setConfirmModal(false); setPendingAction(null);
      setEditModal(false);
      if (historySale) openHistory(historySale);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error updating recovery');
    } finally { setEditSaving(false); }
  };

  /* ── Load other pending invoices for the current customer (for the "(Other) Pending Invoices" tab) ── */
  const loadOtherPendingInvoices = async (customerId, excludeSaleId) => {
    setLoadingOtherPending(true);
    try {
      const r = await api.get(`/recoveries/pending-invoices/${customerId}?exclude=${excludeSaleId}`);
      setOtherPendingInvoices(r.data);
    } catch { toast.error('Error loading pending invoices'); }
    setLoadingOtherPending(false);
  };

  /* ── Load cross-invoice return detail ── */
  const loadReturnInvoice = async (invoiceId) => {
    setSelectedReturnInvoiceId(invoiceId);
    setFullReturnCross(false);
    if (!invoiceId) { setReturnInvoiceDetail(null); setCrossReturnLines([]); return; }
    setLoadingReturnInvoice(true);
    try {
      const r = await api.get(`/sales/${invoiceId}`);
      setReturnInvoiceDetail(r.data);
      setCrossReturnLines((r.data.items || []).map(item => createRecoveryReturnLine({ ...item, sale_id: parseInt(invoiceId) })));
    } catch { toast.error('Error loading invoice'); }
    setLoadingReturnInvoice(false);
  };

  const updateRecoveryLine = (idx, field, value, item) => {
    setRecoveryLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      const disc = parseFloat(updated[idx].discount_given || 0);
      updated[idx].final_amount = parseFloat(item.total) - disc;
      return updated;
    });
  };

  const updateReturnLine = (idx, field, value, item, isCross = false) => {
    const setter = isCross ? setCrossReturnLines : setReturnLines;
    setter(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      const qty = parseFloat(updated[idx].qty_returned || 0);
      const rate = parseFloat(updated[idx].return_rate || item.sale_rate || 0);
      updated[idx].return_amount = qty * rate;
      return updated;
    });
  };

  // "Return Full Invoice" checkbox — checking it fills every eligible line's
  // Return Qty with its full Sold Qty (100% return), recomputing return_amount
  // at the line's current rate. Unchecking clears those lines back to blank.
  // Lines whose batch is outright expired (hard-blocked regardless of role)
  // are left untouched either way, since they can never be returned.
  const returnFullInvoice = (isCross, checked) => {
    const setter = isCross ? setCrossReturnLines : setReturnLines;
    setter(prev => prev.map(line => {
      const { blocked } = getExpiryStatus(line.exp_date, isAdmin);
      if (blocked) return line;
      if (!checked) {
        return { ...line, qty_returned: '', return_amount: 0 };
      }
      const qty = parseFloat(line.original_qty || 0);
      if (!qty) return line;
      const rate = parseFloat(line.return_rate || 0);
      return { ...line, qty_returned: String(qty), return_amount: qty * rate };
    }));
  };

  const handleFullReturnToggle = (isCross, checked) => {
    if (isCross) setFullReturnCross(checked); else setFullReturnCurrent(checked);
    returnFullInvoice(isCross, checked);
  };

  // Unchecking "Return Full Invoice" clears the quantities it filled in
  // (expiry-blocked lines are left untouched either way, since they were
  // never part of the full-return fill in the first place).
  const clearInvoiceReturns = (isCross) => {
    const setter = isCross ? setCrossReturnLines : setReturnLines;
    setter(prev => prev.map(line => {
      const { blocked } = getExpiryStatus(line.exp_date, isAdmin);
      if (blocked) return line;
      return { ...line, qty_returned: '', return_amount: 0 };
    }));
  };

  const toggleFullInvoiceReturn = (isCross, checked) => {
    if (checked) returnFullInvoice(isCross);
    else clearInvoiceReturns(isCross);
  };

  // Whether every eligible (non-blocked) line on a given return-lines array
  // is currently at its full sold quantity — drives the checkbox's checked state.
  const isInvoiceFullyReturned = (lines) => {
    if (!lines.length) return false;
    let anyEligible = false;
    for (const line of lines) {
      const { blocked } = getExpiryStatus(line.exp_date, isAdmin);
      if (blocked) continue;
      const qty = parseFloat(line.original_qty || 0);
      if (!qty) continue;
      anyEligible = true;
      if (parseFloat(line.qty_returned || 0) !== qty) return false;
    }
    return anyEligible;
  };

  const totalDiscount = recoveryLines.reduce((s, l) => s + parseFloat(l.discount_given || 0), 0);
  const currentReturnAmt = returnLines.reduce((s, l) => s + parseFloat(l.return_amount || 0), 0);
  const crossReturnAmt = crossReturnLines.reduce((s, l) => s + parseFloat(l.return_amount || 0), 0);
  const totalReturnAmt = currentReturnAmt + crossReturnAmt;
  const invoiceTotal = saleDetail ? parseFloat(saleDetail.total_amount) : 0;
  // Figures already banked from a PRIOR (partial) recovery installment on this same invoice, if any.
  const priorDiscount = saleDetail ? parseFloat(saleDetail.total_discount || 0) : 0;
  const priorReturn = saleDetail ? parseFloat(saleDetail.total_return_amount || 0) : 0;
  const priorRecovered = saleDetail ? parseFloat(saleDetail.total_recovered || 0) : 0;
  const netCollectible = Math.max(0, invoiceTotal - (priorDiscount + totalDiscount) - (priorReturn + totalReturnAmt));
  const pendingBeforeThisPayment = Math.max(0, netCollectible - priorRecovered);
  // Amount recovered is entered manually — no auto-fill; this only reflects
  // whatever the user has actually typed so far.
  const recoveredValue = Number.isNaN(parseFloat(amountRecovered)) ? 0 : parseFloat(amountRecovered || 0);
  const pendingAmount = Math.max(0, pendingBeforeThisPayment - recoveredValue);
  const otherPaymentsTotal = Object.values(otherPayments).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  // Edit-modal derived totals — mirrors the main modal's logic, scoped to
  // just the single entry being edited.
  const editDiscountTotal = editRecoveryLines.reduce((s, l) => s + parseFloat(l.discount_given || 0), 0);
  const editReturnTotal = editReturnLines.reduce((s, l) => s + parseInt(l.qty_returned || 0) * parseFloat(l.return_rate || 0), 0);
  const editPendingBeforePayment = Math.max(0, editBaseline.pendingBefore
    + (editBaseline.discount - editDiscountTotal) + (editBaseline.returnAmt - editReturnTotal));
  const editRecoveredValue = Number.isNaN(parseFloat(editAmountRecovered)) ? 0 : parseFloat(editAmountRecovered || 0);
  const editPendingAmount = Math.max(0, editPendingBeforePayment - editRecoveredValue);

  // ── Validation errors — computed live from current field values, never mutate
  //    what the user typed. Used to show inline messages/red borders and to
  //    gate the Save buttons. ──────────────────────────────────────────────
  const recoveryLineErrors = recoveryLines.map(l =>
    fieldError(l.discount_given, parseFloat(l.original_total), 'Discount given', `the invoice amount (${fmt(l.original_total)})`)
  );
  const returnLineErrors = returnLines.map(l =>
    fieldError(l.qty_returned, parseFloat(l.original_qty), 'Return qty', `the sold qty (${l.original_qty})`)
  );
  const crossReturnLineErrors = crossReturnLines.map(l =>
    fieldError(l.qty_returned, parseFloat(l.original_qty), 'Return qty', `the sold qty (${l.original_qty})`)
  );
  const amountRecoveredError = fieldError(
    amountRecovered, pendingBeforeThisPayment, 'Amount recovered', `the pending balance (${fmt(pendingBeforeThisPayment)})`
  );
  const otherPaymentErrors = {};
  for (const inv of otherPendingInvoices) {
    otherPaymentErrors[inv.id] = fieldError(
      otherPayments[inv.id], parseFloat(inv.pending_amount), 'Amount', `its pending balance (${fmt(inv.pending_amount)})`
    );
  }
  const hasFieldErrors =
    recoveryLineErrors.some(Boolean) || returnLineErrors.some(Boolean) || crossReturnLineErrors.some(Boolean) ||
    !!amountRecoveredError || Object.values(otherPaymentErrors).some(Boolean);
  // Nothing entered yet is not a "field error" but there's still nothing to save.
  const hasAnyEntry =
    recoveryLines.some(l => parseFloat(l.discount_given || 0) > 0) ||
    returnLines.some(l => parseInt(l.qty_returned || 0) > 0) ||
    crossReturnLines.some(l => parseInt(l.qty_returned || 0) > 0) ||
    recoveredValue > 0 || otherPaymentsTotal > 0;
  const canSaveRecovery = hasAnyEntry && !hasFieldErrors;

  const editRecoveryLineErrors = editRecoveryLines.map(l =>
    fieldError(l.discount_given, parseFloat(l.original_total), 'Discount given', `the invoice amount (${fmt(l.original_total)})`)
  );
  const editReturnLineErrors = editReturnLines.map(l =>
    fieldError(l.qty_returned, l.max_qty, 'Return qty', `the sold qty (${l.max_qty ?? '—'})`)
  );
  const editAmountRecoveredError = fieldError(
    editAmountRecovered, editPendingBeforePayment, 'Amount recovered', `the pending balance (${fmt(editPendingBeforePayment)})`
  );
  const canSaveEdit =
    !editRecoveryLineErrors.some(Boolean) && !editReturnLineErrors.some(Boolean) && !editAmountRecoveredError;


  const handleSaveClick = () => {
    if (!recHeader.date) return toast.error('Date required');
    const validRecovery = recoveryLines.filter(l => parseFloat(l.discount_given || 0) > 0).map(l => ({
      ...l, discount_given: parseFloat(l.discount_given),
      final_amount: parseFloat(l.original_total) - parseFloat(l.discount_given)
    }));
    const validCurrentReturns = returnLines.filter(l => parseInt(l.qty_returned || 0) > 0).map(l => ({
      ...l, qty_returned: parseInt(l.qty_returned),
      return_rate: parseFloat(l.return_rate),
      return_amount: parseInt(l.qty_returned) * parseFloat(l.return_rate)
    }));
    const validCrossReturns = crossReturnLines.filter(l => parseInt(l.qty_returned || 0) > 0).map(l => ({
      ...l, qty_returned: parseInt(l.qty_returned),
      return_rate: parseFloat(l.return_rate),
      return_amount: parseInt(l.qty_returned) * parseFloat(l.return_rate)
    }));
    const allReturns = [...validCurrentReturns, ...validCrossReturns];
    // Amount recovered is always whatever the user manually typed — never auto-filled.
    const recovered = Number.isNaN(parseFloat(amountRecovered)) ? 0 : parseFloat(amountRecovered || 0);
    if (recovered < 0) {
      return toast.error('Amount recovered cannot be negative');
    }
    if (recovered > pendingBeforeThisPayment) {
      return toast.error(`Recovered amount cannot exceed pending balance (${fmt(pendingBeforeThisPayment)})`);
    }
    if (!validRecovery.length && !allReturns.length && recovered <= 0 && otherPaymentsTotal <= 0) {
      return toast.error('Enter at least one discount, return, or recovered amount');
    }

    // Validate any payments entered for OTHER pending invoices of this customer
    const otherPaymentEntries = Object.entries(otherPayments)
      .map(([saleId, amt]) => ({ saleId: parseInt(saleId), amount: parseFloat(amt || 0) }))
      .filter(p => p.amount > 0);
    for (const p of otherPaymentEntries) {
      const inv = otherPendingInvoices.find(i => i.id === p.saleId);
      if (p.amount < 0) {
        return toast.error(`Amount for ${inv?.invoice_no || 'invoice'} cannot be negative`);
      }
      if (inv && p.amount > parseFloat(inv.pending_amount)) {
        return toast.error(`Amount for ${inv.invoice_no} cannot exceed its pending balance (${fmt(inv.pending_amount)})`);
      }
    }

    // Front-end expiry check: block if batch expiry is within 5 months.
    // Admins may proceed within that 5-month window, but a batch that has
    // actually passed its expiry month is blocked for everyone.
    for (const retLine of allReturns) {
      if (!parseInt(retLine.qty_returned)) continue;
      if (retLine.exp_date) {
        const expiryStr = String(retLine.exp_date).slice(0, 10);
        const threshold = addMonthsPKT(expiryStr, -5);
        if (todayPKT() > threshold) {
          if (isPastExpiryMonth(expiryStr)) {
            return toast.error(
              `Return blocked for "${retLine.product_name}" (Batch: ${retLine.batch_no}): expired ${formatDatePKT(expiryStr)}.`
            );
          }
          if (!isAdmin) {
            return toast.error(
              `Return blocked for "${retLine.product_name}" (Batch: ${retLine.batch_no}): expires ${formatDatePKT(expiryStr)} — within 5-month return window.`
            );
          }
        }
      }
    }

    setPendingAction({
      type: 'add',
      payload: { validRecovery, allReturns, recovered, otherPaymentEntries },
      summary: {
        invoiceNo: selectedSale?.invoice_no,
        discount: totalDiscount,
        returns: totalReturnAmt,
        recovered,
        pending: Math.max(0, pendingBeforeThisPayment - recovered),
        otherPaymentsTotal,
        otherCount: otherPaymentEntries.length,
      },
    });
    setConfirmModal(true);
  };

  const performSaveRecovery = async () => {
    const { validRecovery, allReturns, recovered, otherPaymentEntries } = pendingAction.payload;
    setSaving(true);
    try {
      await api.post('/recoveries', {
        sale_id: selectedSale.id,
        salesman_id: recHeader.salesman_id || null,
        date: recHeader.date, notes: recHeader.notes,
        recovery_items: validRecovery,
        return_items: allReturns,
        amount_recovered: recovered,
      });

      // Record any payments entered for OTHER pending invoices of this customer
      for (const p of otherPaymentEntries) {
        const inv = otherPendingInvoices.find(i => i.id === p.saleId);
        await api.post('/recoveries', {
          sale_id: p.saleId,
          salesman_id: recHeader.salesman_id || null,
          date: recHeader.date,
          notes: `Payment collected alongside ${selectedSale.invoice_no}${recHeader.notes ? ' — ' + recHeader.notes : ''}`,
          recovery_items: [],
          return_items: [],
          amount_recovered: p.amount,
        });
      }

      const otherMsg = otherPaymentEntries.length ? ` Plus ${fmt(otherPaymentsTotal)} collected against ${otherPaymentEntries.length} other invoice(s).` : '';
      toast.success((pendingAmount > 0
        ? `Recovery saved! ${fmt(recovered)} collected, ${fmt(pendingAmount)} still pending on this invoice.`
        : 'Recovery saved! Invoice fully recovered.') + otherMsg);
      setConfirmModal(false); setPendingAction(null);
      setModal(false); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving recovery');
    } finally { setSaving(false); }
  };

  const resetFilters = () => {
    setFilterCity(''); setFilterArea(''); setFilterTerritory('');
    setFilterSalesman(''); setFilterCustomer('');
  };

  return (
    <Layout title="Recovery & Return">
      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Filter Invoices</div>
          <button className="btn btn-ghost btn-sm" onClick={resetFilters} style={{ color: 'var(--gray-500)' }}>↺ Reset</button>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="form-grid form-grid-3" style={{ marginBottom: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">City</label>
              <select className="form-control" value={filterCity}
                onChange={e => { setFilterCity(e.target.value); setFilterArea(''); setFilterTerritory(''); setFilterCustomer(''); }}>
                <option value="">All Cities</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Area</label>
              <select className="form-control" value={filterArea}
                onChange={e => { setFilterArea(e.target.value); setFilterTerritory(''); setFilterCustomer(''); }}
                disabled={!filterCity}>
                <option value="">All Areas</option>
                {filteredAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Territory</label>
              <select className="form-control" value={filterTerritory}
                onChange={e => { setFilterTerritory(e.target.value); setFilterCustomer(''); }}
                disabled={!filterArea}>
                <option value="">All Territories</option>
                {filteredTerritories.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid form-grid-2">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Salesman</label>
              <select className="form-control" value={filterSalesman} onChange={e => setFilterSalesman(e.target.value)}>
                <option value="">All Salesmen</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Customer</label>
              <CustomerAutocomplete
                customers={filteredCustomers}
                areas={areas}
                territories={territories}
                value={filterCustomer}
                onChange={id => setFilterCustomer(id)}
                placeholder="Search customer by name…"
                allowClear
                clearLabel="All Customers"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Invoices table */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Sales Invoices</div>
            <div className="text-sm text-muted mt-1">{sales.length} invoice{sales.length !== 1 ? 's' : ''} found</div>
          </div>
          {/* Pending / All toggle */}
          <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
            <button
              className="btn btn-sm"
              style={{
                background: filterStatus === 'pending' ? 'white' : 'transparent',
                boxShadow: filterStatus === 'pending' ? 'var(--shadow-sm)' : 'none',
                color: filterStatus === 'pending' ? 'var(--navy)' : 'var(--gray-500)',
                fontWeight: filterStatus === 'pending' ? 700 : 500,
                border: 'none', borderRadius: 6, padding: '5px 14px'
              }}
              onClick={() => setFilterStatus('pending')}
            >
              Pending Only
            </button>
            <button
              className="btn btn-sm"
              style={{
                background: filterStatus === 'settled' ? 'white' : 'transparent',
                boxShadow: filterStatus === 'settled' ? 'var(--shadow-sm)' : 'none',
                color: filterStatus === 'settled' ? 'var(--navy)' : 'var(--gray-500)',
                fontWeight: filterStatus === 'settled' ? 700 : 500,
                border: 'none', borderRadius: 6, padding: '5px 14px'
              }}
              onClick={() => setFilterStatus('settled')}
            >
              Settled Only
            </button>
            <button
              className="btn btn-sm"
              style={{
                background: filterStatus === 'all' ? 'white' : 'transparent',
                boxShadow: filterStatus === 'all' ? 'var(--shadow-sm)' : 'none',
                color: filterStatus === 'all' ? 'var(--navy)' : 'var(--gray-500)',
                fontWeight: filterStatus === 'all' ? 700 : 500,
                border: 'none', borderRadius: 6, padding: '5px 14px'
              }}
              onClick={() => setFilterStatus('all')}
            >
              All Invoices
            </button>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : sales.length === 0
            ? <div className="empty-state"><div className="empty-state-title">No invoices found</div></div>
            : (
              <table>
                <thead>
                  <tr><th>Invoice No</th><th>Date</th><th>Customer</th><th>Salesman</th><th>City / Area</th><th>Total</th><th>Recovered</th><th>Pending</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {pagedSales.map(s => {
                    const status = getRecoveryStatus(s);
                    const pending = getPendingAmount(s);
                    const recovered = getRecoveredAmount(s);
                    const isCompleted = status === 'completed';
                    return (
                      <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openHistory(s)} title="Click to view payment history">
                        <td className="mono">{s.invoice_no || '—'}</td>
                        <td>{formatDatePKT(s.date)}</td>
                        <td style={{ fontWeight: 600 }}>{s.customer_name}</td>
                        <td>{s.salesman_name || '—'}</td>
                        <td>{[s.city_name, s.area_name].filter(Boolean).join(' / ') || '—'}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(s.total_amount)}</td>
                        <td style={{ color: 'var(--green)' }}>{fmt(recovered)}</td>
                        <td style={{ fontWeight: 600, color: pending > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{fmt(pending)}</td>
                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          {isCompleted
                            ? <span style={{ fontSize: 12, color: 'var(--gray-400)', padding: '5px 8px' }}>
                                {isAdmin ? 'Settled' : 'Settled'}
                              </span>
                            : <button className="btn btn-primary btn-sm" onClick={() => openRecovery(s)}>
                                {s.is_locked ? 'Collect Payment' : 'Recovery / Return'}
                              </button>}
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

      {/* Recovery Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)}
        title={`Recovery & Return — ${selectedSale?.invoice_no}`} size="xl"
        footer={
          <div className="flex items-center w-full" style={{ gap: 32 }}>
            <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
              {/* Group 1: Invoice, Discount, Returns */}
              <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', paddingRight: 24 }}>
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Invoice</span>
                  <strong>{fmt(invoiceTotal)}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Discount</span>
                  <strong style={{ color: 'var(--amber)' }}>{fmt(totalDiscount)}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Returns</span>
                  <strong style={{ color: 'var(--amber)' }}>{fmt(totalReturnAmt)}</strong>
                </div>
              </div>

              {/* Group 2: Net Collectible, Recovered, Pending */}
              <div style={{
                display: 'flex', flex: 1, justifyContent: 'space-between',
                paddingLeft: 24, borderLeft: '2px solid var(--gray-200)'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Net Collectible</span>
                  <strong style={{ color: 'var(--green)' }}>{fmt(netCollectible)}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Recovered</span>
                  <strong style={{ color: 'var(--blue)' }}>{fmt(Number.isNaN(recoveredValue) ? 0 : recoveredValue)}</strong>
                </div>
                {pendingAmount > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Pending</span>
                    <strong style={{ color: 'var(--amber)' }}>{fmt(pendingAmount)}</strong>
                  </div>
                ) : (
                  // keeps the 3-item spacing consistent in group 2 when Pending is hidden
                  <div style={{ visibility: 'hidden' }} />
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSaveClick} disabled={saving || !canSaveRecovery}>
                {saving ? 'Saving...' : 'Save Recovery'}
              </button>
            </div>
          </div>
        }>

        {saleDetail && (
          <div>
            {/* Invoice summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '10px 14px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10, marginBottom: 18 }}>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Customer</div><div style={{ fontWeight: 700 }}>{saleDetail.customer_name}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice</div><span className="badge badge-green">{saleDetail.invoice_no}</span></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Date</div><div style={{ fontWeight: 600 }}>{formatDatePKT(saleDetail.date)}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice Total</div><div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: 15 }}>{fmt(saleDetail.total_amount)}</div></div>
            </div>

            {/* Recovery header */}
            <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Recovery Date *</label>
                <input className="form-control" type="date" value={recHeader.date}
                  onChange={e => setRecHeader(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Supplier</label>
                <select
                  className="form-control"
                  value={recHeader.salesman_id || ''}
                  onChange={e => setRecHeader(p => ({ ...p, salesman_id: e.target.value }))}
                >
                  <option value="">— Select —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Notes</label>
                <input className="form-control" placeholder="Optional notes" value={recHeader.notes}
                  onChange={e => setRecHeader(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            {/* Recovered amount */}
            <div className="form-grid form-grid-2" style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Amount Recovered (Cash)</label>
                <input
                  className="form-control"
                  type="number"
                  step="1"
                  placeholder="Enter amount collected"
                  style={{ borderColor: amountRecoveredError ? 'var(--red)' : undefined }}
                  value={amountRecovered}
                  onChange={e => setAmountRecovered(e.target.value)}
                  onWheel={blockWheelChange}
                />
                {amountRecoveredError ? (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{amountRecoveredError}</div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                    {priorRecovered > 0
                      ? `${fmt(priorRecovered)} already collected on this invoice. Max collectible now: ${fmt(pendingBeforeThisPayment)}.`
                      : `Max collectible now: ${fmt(pendingBeforeThisPayment)}.`}
                  </div>
                )}
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Pending Amount (remaining after this entry)</label>
                <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, fontWeight: 700, fontSize: 16, color: pendingAmount > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {fmt(pendingAmount)}
                </div>
              </div>
            </div>

            <div className="divider" />

            <div className="tabs" style={{ marginBottom: 14 }}>
              <button className={`tab-btn ${activeTab === 'recovery' ? 'active' : ''}`} onClick={() => setActiveTab('recovery')}>
                Recovery (Discounts)
                {totalDiscount > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{fmt(totalDiscount)}</span>}
              </button>
              <button className={`tab-btn ${activeTab === 'return' ? 'active' : ''}`} onClick={() => setActiveTab('return')}>
                Returns — Current Invoice
                {currentReturnAmt > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{fmt(currentReturnAmt)}</span>}
              </button>
              <button className={`tab-btn ${activeTab === 'cross-return' ? 'active' : ''}`} onClick={() => setActiveTab('cross-return')}>
                Returns — Previous Invoice
                {crossReturnAmt > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{fmt(crossReturnAmt)}</span>}
              </button>
              <button className={`tab-btn ${activeTab === 'other-pending' ? 'active' : ''}`} onClick={() => setActiveTab('other-pending')}>
                (Other) Pending Invoices
                {otherPaymentsTotal > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{fmt(otherPaymentsTotal)}</span>}
              </button>
            </div>

            {activeTab === 'recovery' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                  <span>Product</span><span>Batch</span><span>Invoice Amt</span><span>Discount Given</span><span>Final Amount</span>
                </div>
                {(saleDetail.items || []).map((item, idx) => {
                  const line = recoveryLines[idx] || { discount_given: '' };
                  const finalAmt = parseFloat(item.total) - parseFloat(line.discount_given || 0);
                  const err = recoveryLineErrors[idx];
                  return (
                    <div key={idx} style={{ marginBottom: 5 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                        <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{item.batch_no || '—'}</span></div>
                        <div style={{ fontWeight: 700 }}>{fmt(item.total)}</div>
                        <input className="form-control" type="number" step="0.01"
                          style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }}
                          placeholder="0.00"
                          value={line.discount_given}
                          onChange={e => updateRecoveryLine(idx, 'discount_given', e.target.value, item)}
                          onWheel={blockWheelChange} />
                        <div style={{ fontWeight: 700, color: finalAmt < 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmt(Math.max(0, finalAmt))}
                        </div>
                      </div>
                      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'return' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', cursor: returnLines.length === 0 ? 'default' : 'pointer' }}>
                    <input type="checkbox" checked={fullReturnCurrent}
                      disabled={returnLines.length === 0}
                      onChange={e => handleFullReturnToggle(false, e.target.checked)} />
                    Return Full Invoice
                  </label>
                </div>
                <ReturnTable lines={returnLines} items={saleDetail.items} isCross={false} updateReturnLine={updateReturnLine} fmt={fmt} isAdmin={isAdmin} errors={returnLineErrors} />
              </div>
            )}

            {activeTab === 'cross-return' && (
              <div>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Select Previous Invoice *</label>
                  <select className="form-control" style={{ maxWidth: 400 }}
                    value={selectedReturnInvoiceId}
                    onChange={e => loadReturnInvoice(e.target.value)}>
                    <option value="">— Select Invoice —</option>
                    {eligibleReturnInvoices.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.invoice_no} — {formatDatePKT(s.date)} — {fmt(s.total_amount)}{s.is_locked ? ' (Locked)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {loadingReturnInvoice && <div className="loading-center"><div className="spinner" /></div>}
                {returnInvoiceDetail && !loadingReturnInvoice && (
                  <>
                    <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <span>
                        Invoice <strong>{returnInvoiceDetail.invoice_no}</strong> — {fmt(returnInvoiceDetail.total_amount)}
                        {returnInvoiceDetail.is_locked && <span className="badge badge-amber" style={{ marginLeft: 8, fontSize: 10 }}>Locked — credit will apply to current invoice</span>}
                      </span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', cursor: crossReturnLines.length === 0 ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={fullReturnCross}
                          disabled={crossReturnLines.length === 0}
                          onChange={e => handleFullReturnToggle(true, e.target.checked)} />
                        Return Full Invoice
                      </label>
                    </div>
                    <ReturnTable lines={crossReturnLines} items={returnInvoiceDetail.items} isCross={true} updateReturnLine={updateReturnLine} fmt={fmt} isAdmin={isAdmin} errors={crossReturnLineErrors} />
                  </>
                )}
              </div>
            )}

            {activeTab === 'other-pending' && (
              <div>
                {loadingOtherPending ? (
                  <div className="loading-center"><div className="spinner" /></div>
                ) : otherPendingInvoices.length === 0 ? (
                  <div className="empty-state" style={{ padding: 24 }}>
                    <div className="empty-state-desc">No other pending invoices for this customer.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1.2fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                      <span>Invoice No</span><span>Date</span><span>Total</span><span>Paid</span><span>Pending</span><span>Recover Now</span>
                    </div>
                    {otherPendingInvoices.map(inv => {
                      const pend = parseFloat(inv.pending_amount);
                      const val = otherPayments[inv.id] ?? '';
                      const err = otherPaymentErrors[inv.id];
                      return (
                        <div key={inv.id} style={{ marginBottom: 5 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1.2fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                            <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{inv.invoice_no}</div>
                            <div>{formatDatePKT(inv.date)}</div>
                            <div style={{ fontWeight: 700 }}>{fmt(inv.total_amount)}</div>
                            <div style={{ color: 'var(--green)' }}>{fmt(inv.total_recovered)}</div>
                            <div style={{ fontWeight: 700, color: 'var(--amber)' }}>{fmt(pend)}</div>
                            <input className="form-control" type="number" step="1"
                              style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }} placeholder="0"
                              value={val}
                              onChange={e => setOtherPayments(prev => ({ ...prev, [inv.id]: e.target.value }))}
                              onWheel={blockWheelChange} />
                          </div>
                          {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Payment History Modal */}
      <Modal isOpen={historyModal} onClose={() => setHistoryModal(false)}
        title={`Payment History — ${historySale?.invoice_no || ''}`} size="lg">
        {historySale && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '10px 14px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10, marginBottom: 18 }}>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Customer</div><div style={{ fontWeight: 700 }}>{historySale.customer_name}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice Total</div><div style={{ fontWeight: 700 }}>{fmt(historySale.total_amount)}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Recovered</div><div style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(getRecoveredAmount(historySale))}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Pending</div><div style={{ fontWeight: 700, color: getPendingAmount(historySale) > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(getPendingAmount(historySale))}</div></div>
            </div>

            {historyLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : historyList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-desc">No recovery activity recorded yet for this invoice.</div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr 1fr 1fr 1fr 1.4fr 0.7fr' : '1fr 1fr 1fr 1fr 1fr 1.4fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                  <span>Date</span><span>Discount</span><span>Return</span><span>Collected</span><span>Pending After</span><span>Notes</span>{isAdmin && <span>Actions</span>}
                </div>
                {historyList.map(h => (
                  <div key={h.id} style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr 1fr 1fr 1fr 1.4fr 0.7fr' : '1fr 1fr 1fr 1fr 1fr 1.4fr', gap: 6, alignItems: 'center', padding: '7px 8px', marginBottom: 5, background: 'white', border: '1.5px solid var(--gray-200)', borderRadius: 8 }}>
                    <div>{formatDatePKT(h.date)}</div>
                    <div style={{ color: parseFloat(h.total_discount) > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{fmt(h.total_discount)}</div>
                    <div style={{ color: parseFloat(h.total_return_amount) > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{fmt(h.total_return_amount)}</div>
                    <div style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(h.net_collected)}</div>
                    <div style={{ fontWeight: 600, color: parseFloat(h.pending_amount) > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(h.pending_amount)}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{h.notes || (h.salesman_name ? `Collected by ${h.salesman_name}` : '—')}</div>
                    {isAdmin && (
                      <div>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => openEditRecovery(h.id)}>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Edit Recovery Modal — Admin only. Reachable even when the invoice is settled. */}
      <Modal isOpen={editModal} onClose={() => setEditModal(false)}
        title={`Edit Recovery Entry — ${selectedSale?.invoice_no}`} size="lg"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setEditModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleEditSaveClick} disabled={editSaving || editLoading || !canSaveEdit}>
              {editSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }>
        {editLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <div>
            <div className="form-grid form-grid-2" style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Date *</label>
                <input className="form-control" type="date" value={editDate}
                  onChange={e => setEditDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Notes</label>
                <input className="form-control" placeholder="Optional notes" value={editNotes}
                  onChange={e => setEditNotes(e.target.value)} />
              </div>
            </div>

            {editRecoveryLines.length > 0 && (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Discounts</div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                  <span>Product</span><span>Batch</span><span>Invoice Amt</span><span>Discount Given</span>
                </div>
                {editRecoveryLines.map((l, idx) => {
                  const err = editRecoveryLineErrors[idx];
                  return (
                    <div key={idx} style={{ marginBottom: 5 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.product_name}</div>
                        <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{l.batch_no || '—'}</span></div>
                        <div style={{ fontWeight: 700 }}>{fmt(l.original_total)}</div>
                        <input className="form-control" type="number" step="0.01"
                          style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }} value={l.discount_given}
                          onChange={e => setEditRecoveryLines(prev => {
                            const u = [...prev]; u[idx] = { ...u[idx], discount_given: e.target.value }; return u;
                          })}
                          onWheel={blockWheelChange} />
                      </div>
                      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                    </div>
                  );
                })}
                <div className="divider" />
              </>
            )}

            {editReturnLines.length > 0 && (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Returns</div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                  <span>Product / Invoice</span><span>Batch</span><span>Return Qty</span><span>Rate</span><span>Return Amt</span>
                </div>
                {editReturnLines.map((l, idx) => {
                  const err = editReturnLineErrors[idx];
                  return (
                    <div key={l.row_id} style={{ marginBottom: 5 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{l.product_name}</div>
                          <div style={{ fontSize: 10, color: 'var(--gray-500)' }}>{l.source_invoice}</div>
                        </div>
                        <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{l.batch_no || '—'}</span></div>
                        <input className="form-control" type="number" step="1"
                          style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }} value={l.qty_returned}
                          onChange={e => setEditReturnLines(prev => {
                            const u = [...prev]; u[idx] = { ...u[idx], qty_returned: e.target.value }; return u;
                          })}
                          onWheel={blockWheelChange} />
                        <input className="form-control" type="number" step="0.01" min="0"
                          style={{ fontSize: 12, padding: '5px 8px' }} value={l.return_rate}
                          onChange={e => setEditReturnLines(prev => {
                            const u = [...prev]; u[idx] = { ...u[idx], return_rate: e.target.value }; return u;
                          })}
                          onWheel={blockWheelChange} />
                        <div style={{ fontWeight: 700, color: 'var(--amber)' }}>
                          {fmt((parseFloat(l.qty_returned || 0)) * (parseFloat(l.return_rate || 0)))}
                        </div>
                      </div>
                      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                    </div>
                  );
                })}
                <div className="divider" />
              </>
            )}

            <div className="form-grid form-grid-2">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Amount Recovered (Cash)</label>
                <input className="form-control" type="number" step="1"
                  placeholder="Enter amount collected"
                  style={{ borderColor: editAmountRecoveredError ? 'var(--red)' : undefined }}
                  value={editAmountRecovered}
                  onChange={e => setEditAmountRecovered(e.target.value)}
                  onWheel={blockWheelChange} />
                {editAmountRecoveredError ? (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{editAmountRecoveredError}</div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                    Max collectible for this entry: {fmt(editPendingBeforePayment)}.
                  </div>
                )}
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Pending Amount (remaining after this entry)</label>
                <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, fontWeight: 700, fontSize: 16, color: editPendingAmount > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {fmt(editPendingAmount)}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Recovery — shown after "Save" is pressed, before anything is submitted. */}
      <Modal isOpen={confirmModal} onClose={() => { setConfirmModal(false); setPendingAction(null); }}
        title={pendingAction?.type === 'edit' ? 'Confirm Recovery Edit' : 'Confirm Recovery'}
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => { setConfirmModal(false); setPendingAction(null); }}>
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={() => pendingAction?.type === 'edit' ? performEditSave() : performSaveRecovery()}
              disabled={saving || editSaving}
            >
              {(saving || editSaving) ? 'Saving...' : 'Confirm & Save'}
            </button>
          </div>
        }>
        {pendingAction && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14 }}>
              {pendingAction.type === 'edit'
                ? 'Please review the corrected entry below before saving.'
                : `Please review this recovery for invoice ${pendingAction.summary.invoiceNo || ''} before saving.`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Discount</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(pendingAction.summary.discount)}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Returns</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(pendingAction.summary.returns)}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Amount Recovered</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{fmt(pendingAction.summary.recovered)}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Pending After</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: pendingAction.summary.pending > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {fmt(pendingAction.summary.pending)}
                </div>
              </div>
            </div>
            {pendingAction.type === 'add' && pendingAction.summary.otherCount > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-500)' }}>
                Plus {fmt(pendingAction.summary.otherPaymentsTotal)} collected against {pendingAction.summary.otherCount} other invoice(s).
              </div>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  );
}
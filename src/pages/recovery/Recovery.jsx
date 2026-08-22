import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import usePagination from '../../hooks/usePagination';
import { formatDatePKT, todayPKT, addMonthsPKT } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';
import {
  isPastExpiryMonth,
  getExpiryStatus,
  fieldError,
  getRecoveryStatus,
  createRecoveryReturnLine,
} from './recoveryUtils';
import RecoveryFilters from './RecoveryFilters';
import InvoiceTable from './InvoiceTable';
import RecoveryModal from './RecoveryModal';
import PaymentHistoryModal from './PaymentHistoryModal';
import EditRecoveryModal from './EditRecoveryModal';
import ConfirmRecoveryModal from './ConfirmRecoveryModal';
import ConfirmModal from '../../components/common/ConfirmModal';

export default function Recovery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [allSales, setAllSales] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterCity, setFilterCity] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterTerritory, setFilterTerritory] = useState('');
  const [filterSalesman, setFilterSalesman] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
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
  const [recHeader, setRecHeader] = useState({ date: todayPKT(), salesman_id: '', notes: '' });

  const [amountRecovered, setAmountRecovered] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('recovery');

  // Confirmation step shown after "Save" is pressed, before the recovery is
  // actually submitted — used by both the add-recovery flow and the admin edit flow.
  const [confirmModal, setConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { type: 'add' | 'edit', payload, summary }

  // Empty-delete confirmation: when an admin edits a recovery down to
  // zero-across-the-board, the backend returns HTTP 409 with a message
  // asking to confirm deletion of the entry (and possible unlock of the
  // invoice). We stash the message here to render a confirm modal, and
  // on confirm we resubmit the same payload with `confirm_delete_if_empty: true`.
  const [emptyDeletePrompt, setEmptyDeletePrompt] = useState(null); // null | { message: string }

  // "Return Full Invoice" checkbox state for the current-invoice return tab.
  const [fullReturnCurrent, setFullReturnCurrent] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/sales'),
      api.get('/customers'),
      api.get('/employees?role=Salesman'),
      api.get('/employees?role=Supplier'),
      api.get('/geography/geo'),
    ]).then(([s, c, e, sup, g]) => {
      setAllSales(s.data); setSales(s.data);
      setCustomers(c.data); setEmployees(e.data);
      setSuppliers(Array.isArray(sup.data) ? sup.data : []);
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
    if (filterSupplier) filtered = filtered.filter(s => String(s.delivery_by) === String(filterSupplier));
    if (filterCustomer) filtered = filtered.filter(s => String(s.customer_id) === String(filterCustomer));
    if (filterStatus === 'pending') {
      filtered = filtered.filter(s => getRecoveryStatus(s) !== 'completed');
    } else if (filterStatus === 'settled') {
      filtered = filtered.filter(s => getRecoveryStatus(s) === 'completed');
    }
    setSales(filtered);
  }, [filterCity, filterArea, filterTerritory, filterSalesman, filterSupplier, filterCustomer, filterStatus, allSales, customers]);

  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedSales } = usePagination(sales, 25);

  const filteredAreas = areas.filter(a => !filterCity || String(a.city_id) === String(filterCity));
  const filteredTerritories = territories.filter(t => !filterArea || String(t.area_id) === String(filterArea));
  const filteredCustomers = customers.filter(c => {
    if (filterCity && String(c.city_id) !== String(filterCity)) return false;
    if (filterArea && String(c.area_id) !== String(filterArea)) return false;
    if (filterTerritory && String(c.territory_id) !== String(filterTerritory)) return false;
    return true;
  });

  // No previous-invoice returns: returns are only allowed against the current invoice.

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
      setFullReturnCurrent(false);
      // Recoveries are performed by the SUPPLIER assigned to the invoice, not
      // the salesman — the sale form captures that in `delivery_by`.
      // Pre-fill the modal's Supplier dropdown from there so the correct
      // person is selected by default.
      const invoiceSupplierId = r.data.delivery_by ?? sale.delivery_by;
      setRecHeader({
        date: todayPKT(),
        salesman_id: invoiceSupplierId || '',
        notes: '',
      });
      setAmountRecovered('');
      setActiveTab('recovery');
      setModal(true);
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
        // Upper bound for the qty this line could be edited up to: the sale
        // item's original sold qty, minus whatever's already returned against
        // it in OTHER recovery entries. Excludes this entry's own old value
        // (server does the same — it deletes this entry's old return_items
        // before re-validating).
        max_qty: (i.current_sold_qty === null || i.current_sold_qty === undefined)
          ? undefined : Math.max(0, parseFloat(i.current_sold_qty) - parseFloat(i.already_returned_elsewhere || 0)),
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
      return toast.error(`Recovered amount cannot exceed pending balance (${formatCurrency(editPendingBeforePayment)})`);
    }

    const editInvoiceTotal = historySale ? parseFloat(historySale.total_amount || 0) : 0;
    setPendingAction({
      type: 'edit',
      payload: { validRecovery, validReturns, recovered },
      summary: {
        invoiceNo: historySale?.invoice_no,
        invoiceTotal: editInvoiceTotal,
        discount: editDiscountTotal,
        returns: editReturnTotal,
        netTotal: Math.max(0, editInvoiceTotal - editDiscountTotal - editReturnTotal),
        recovered,
        pending: Math.max(0, editPendingBeforePayment - recovered),
      },
    });
    setConfirmModal(true);
  };

  const performEditSave = async (confirmDeleteIfEmpty = false) => {
    const { validRecovery, validReturns, recovered } = pendingAction.payload;
    setEditSaving(true);
    try {
      const body = {
        date: editDate, notes: editNotes,
        recovery_items: validRecovery, return_items: validReturns,
        amount_recovered: recovered,
      };
      if (confirmDeleteIfEmpty) body.confirm_delete_if_empty = true;
      const r = await api.put(`/recoveries/${editingId}`, body);
      // The backend signals `{ deleted: true, unlocked }` when the edit
      // reduced the entry to zero and the entry was deleted. Show a
      // clearer toast for that case than the generic "updated" one.
      if (r.data?.deleted) {
        toast.success(r.data.unlocked
          ? 'Recovery entry deleted. Invoice unlocked for further edits.'
          : 'Recovery entry deleted.');
      } else {
        toast.success('Recovery entry updated.');
      }
      setConfirmModal(false); setPendingAction(null);
      setEmptyDeletePrompt(null);
      setEditModal(false);
      if (historySale) openHistory(historySale);
      load();
    } catch (err) {
      // 409 + requires_confirmation === 'confirm_delete_if_empty' means the
      // server is asking to confirm the delete. Pop the confirm modal with
      // the exact message the server sent (so the operator sees the same
      // wording that would appear in an audit log).
      if (
        err.response?.status === 409 &&
        err.response?.data?.requires_confirmation === 'confirm_delete_if_empty'
      ) {
        setEmptyDeletePrompt({
          message: err.response.data.message ||
            'This edit will leave the recovery entry empty. Confirming will delete it.',
        });
      } else {
        toast.error(err.response?.data?.message || 'Error updating recovery');
      }
    } finally { setEditSaving(false); }
  };

  /* Previous-invoice returns removed; no loader required. */

  const updateRecoveryLine = (idx, field, value, item) => {
    setRecoveryLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      const disc = parseFloat(updated[idx].discount_given || 0);
      updated[idx].final_amount = parseFloat(item.total) - disc;
      return updated;
    });
  };

  const updateReturnLine = (idx, field, value, item) => {
    setReturnLines(prev => {
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
  const returnFullInvoice = (checked) => {
    setReturnLines(prev => prev.map(line => {
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

  const handleFullReturnToggle = (checked) => {
    setFullReturnCurrent(checked);
    returnFullInvoice(checked);
  };

  const totalDiscount = recoveryLines.reduce((s, l) => s + parseFloat(l.discount_given || 0), 0);
  const currentReturnAmt = returnLines.reduce((s, l) => s + parseFloat(l.return_amount || 0), 0);
  const totalReturnAmt = currentReturnAmt;
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

  // Edit-modal derived totals — mirrors the main modal's logic, scoped to
  // just the single entry being edited.
  const editDiscountTotal = editRecoveryLines.reduce((s, l) => s + parseFloat(l.discount_given || 0), 0);
  const editReturnTotal = editReturnLines.reduce((s, l) => s + parseInt(l.qty_returned || 0) * parseFloat(l.return_rate || 0), 0);
  const editPendingBeforePayment = Math.max(0, editBaseline.pendingBefore
    + (editBaseline.discount - editDiscountTotal) + (editBaseline.returnAmt - editReturnTotal));
  const editPendingAmount = Math.max(0, editPendingBeforePayment - (Number.isNaN(parseFloat(editAmountRecovered)) ? 0 : parseFloat(editAmountRecovered || 0)));

  // ── Validation errors — computed live from current field values, never mutate
  //    what the user typed. Used to show inline messages/red borders and to
  //    gate the Save buttons. ──────────────────────────────────────────────
  const recoveryLineErrors = recoveryLines.map(l =>
    fieldError(l.discount_given, parseFloat(l.original_total), 'Discount given', `the invoice amount (${formatCurrency(l.original_total)})`)
  );
  const returnLineErrors = returnLines.map(l =>
    fieldError(l.qty_returned, parseFloat(l.original_qty), 'Return qty', `the returnable qty (${l.original_qty})`)
  );
  
  const amountRecoveredError = fieldError(
    amountRecovered, pendingBeforeThisPayment, 'Amount recovered', `the pending balance (${formatCurrency(pendingBeforeThisPayment)})`
  );
  const hasFieldErrors = recoveryLineErrors.some(Boolean) || returnLineErrors.some(Boolean) || !!amountRecoveredError;
  // Nothing entered yet is not a "field error" but there's still nothing to save.
  const hasAnyEntry =
    recoveryLines.some(l => parseFloat(l.discount_given || 0) > 0) ||
    returnLines.some(l => parseInt(l.qty_returned || 0) > 0) ||
    recoveredValue > 0;
  const canSaveRecovery = hasAnyEntry && !hasFieldErrors;

  const editRecoveryLineErrors = editRecoveryLines.map(l =>
    fieldError(l.discount_given, parseFloat(l.original_total), 'Discount given', `the invoice amount (${formatCurrency(l.original_total)})`)
  );
  const editReturnLineErrors = editReturnLines.map(l =>
    fieldError(l.qty_returned, l.max_qty, 'Return qty', `the sold qty (${l.max_qty ?? '—'})`)
  );
  const editAmountRecoveredError = fieldError(
    editAmountRecovered, editPendingBeforePayment, 'Amount recovered', `the pending balance (${formatCurrency(editPendingBeforePayment)})`
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
    const allReturns = validCurrentReturns;
    // Amount recovered is always whatever the user manually typed — never auto-filled.
    const recovered = Number.isNaN(parseFloat(amountRecovered)) ? 0 : parseFloat(amountRecovered || 0);
    if (recovered < 0) {
      return toast.error('Amount recovered cannot be negative');
    }
    if (recovered > pendingBeforeThisPayment) {
      return toast.error(`Recovered amount cannot exceed pending balance (${formatCurrency(pendingBeforeThisPayment)})`);
    }
    if (!validRecovery.length && !allReturns.length && recovered <= 0) {
      return toast.error('Enter at least one discount, return, or recovered amount');
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
      payload: { validRecovery, allReturns, recovered },
      summary: {
        invoiceNo: selectedSale?.invoice_no,
        invoiceTotal,
        discount: totalDiscount,
        returns: totalReturnAmt,
        netTotal: netCollectible,
        recovered,
        pending: Math.max(0, pendingBeforeThisPayment - recovered),
      },
    });
    setConfirmModal(true);
  };

  const performSaveRecovery = async () => {
    const { validRecovery, allReturns, recovered } = pendingAction.payload;
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

      toast.success(pendingAmount > 0
        ? `Recovery saved! ${formatCurrency(recovered)} collected, ${formatCurrency(pendingAmount)} still pending on this invoice.`
        : 'Recovery saved! Invoice fully recovered.');
      setConfirmModal(false); setPendingAction(null);
      setModal(false); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving recovery');
    } finally { setSaving(false); }
  };

  const resetFilters = () => {
    setFilterCity(''); setFilterArea(''); setFilterTerritory('');
    setFilterSalesman(''); setFilterSupplier(''); setFilterCustomer('');
  };

  const closeConfirm = () => { setConfirmModal(false); setPendingAction(null); };

  return (
    <Layout title="Recovery & Return">
      <RecoveryFilters
        cities={cities}
        filteredAreas={filteredAreas}
        filteredTerritories={filteredTerritories}
        filteredCustomers={filteredCustomers}
        areas={areas}
        territories={territories}
        employees={employees}
        suppliers={suppliers}
        filterCity={filterCity}
        filterArea={filterArea}
        filterTerritory={filterTerritory}
        filterSalesman={filterSalesman}
        filterSupplier={filterSupplier}
        filterCustomer={filterCustomer}
        onCityChange={v => { setFilterCity(v); setFilterArea(''); setFilterTerritory(''); setFilterCustomer(''); }}
        onAreaChange={v => { setFilterArea(v); setFilterTerritory(''); setFilterCustomer(''); }}
        onTerritoryChange={v => { setFilterTerritory(v); setFilterCustomer(''); }}
        onSalesmanChange={setFilterSalesman}
        onSupplierChange={setFilterSupplier}
        onCustomerChange={setFilterCustomer}
        onReset={resetFilters}
      />

      <InvoiceTable
        loading={loading}
        sales={sales}
        pagedSales={pagedSales}
        filterStatus={filterStatus}
        onFilterStatusChange={setFilterStatus}
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onOpenHistory={openHistory}
        onOpenRecovery={openRecovery}
      />

      <RecoveryModal
        isOpen={modal}
        onClose={() => setModal(false)}
        selectedSale={selectedSale}
        saleDetail={saleDetail}
        employees={suppliers}
        recHeader={recHeader}
        setRecHeader={setRecHeader}
        amountRecovered={amountRecovered}
        setAmountRecovered={setAmountRecovered}
        amountRecoveredError={amountRecoveredError}
        pendingAmount={pendingAmount}
        invoiceTotal={invoiceTotal}
        totalDiscount={totalDiscount}
        totalReturnAmt={totalReturnAmt}
        netCollectible={netCollectible}
        recoveredValue={recoveredValue}
        currentReturnAmt={currentReturnAmt}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        recoveryLines={recoveryLines}
        recoveryLineErrors={recoveryLineErrors}
        updateRecoveryLine={updateRecoveryLine}
        returnLines={returnLines}
        returnLineErrors={returnLineErrors}
        fullReturnCurrent={fullReturnCurrent}
        handleFullReturnToggle={handleFullReturnToggle}
        updateReturnLine={updateReturnLine}
        isAdmin={isAdmin}
        
        saving={saving}
        canSaveRecovery={canSaveRecovery}
        onSave={handleSaveClick}
      />

      <PaymentHistoryModal
        isOpen={historyModal}
        onClose={() => setHistoryModal(false)}
        historySale={historySale}
        historyLoading={historyLoading}
        historyList={historyList}
        isAdmin={isAdmin}
        onEditRecovery={openEditRecovery}
      />

      <EditRecoveryModal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        selectedSale={selectedSale}
        editLoading={editLoading}
        editSaving={editSaving}
        canSaveEdit={canSaveEdit}
        onSave={handleEditSaveClick}
        editDate={editDate}
        setEditDate={setEditDate}
        editNotes={editNotes}
        setEditNotes={setEditNotes}
        editRecoveryLines={editRecoveryLines}
        setEditRecoveryLines={setEditRecoveryLines}
        editRecoveryLineErrors={editRecoveryLineErrors}
        editReturnLines={editReturnLines}
        setEditReturnLines={setEditReturnLines}
        editReturnLineErrors={editReturnLineErrors}
        editAmountRecovered={editAmountRecovered}
        setEditAmountRecovered={setEditAmountRecovered}
        editAmountRecoveredError={editAmountRecoveredError}
        editPendingBeforePayment={editPendingBeforePayment}
        editPendingAmount={editPendingAmount}
      />

      <ConfirmRecoveryModal
        isOpen={confirmModal}
        onClose={closeConfirm}
        pendingAction={pendingAction}
        saving={saving}
        editSaving={editSaving}
        onConfirm={() => pendingAction?.type === 'edit' ? performEditSave() : performSaveRecovery()}
      />

      {/* Empty-recovery delete confirmation. Only shown when the backend has
         signalled (via a 409 on PUT /recoveries/:id) that the incoming edit
         would zero-out the entry. Confirming re-invokes performEditSave with
         `confirm_delete_if_empty: true`, which lets the server delete the
         entry, reverse its ledger + inventory effects, and (if it was the
         last recovery on the invoice) auto-unlock the sale. */}
      <ConfirmModal
        isOpen={!!emptyDeletePrompt}
        onClose={() => setEmptyDeletePrompt(null)}
        onConfirm={() => performEditSave(true)}
        loading={editSaving}
        message={emptyDeletePrompt?.message}
      />
    </Layout>
  );
}
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import { todayPKT, formatDatePKT, addMonthsPKT } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';
import { createRecoveryReturnLine, getExpiryStatus, isPastExpiryMonth, fieldError } from './recoveryUtils';
import ReturnTable from './ReturnTable';
import {
  ArrowLeft, RefreshCw, Search, RotateCcw, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

// Quick Return records a standalone return against an already-settled
// invoice — a straight credit back to the customer's own balance, not
// something applied toward a new invoice. That "apply as credit to a new
// invoice" case is what the Returns — Previous Invoice tab inside the
// regular Recovery modal is for; this page is for the more common case
// where the customer just gets cash/credit back for the returned goods.
//
// Only fully-settled (recovery_status = 'completed') invoices are eligible
// here — a still-pending invoice's return belongs in that invoice's own
// Current Invoice return tab (opened directly on that invoice), same rule
// as the Returns — Previous Invoice dropdown.
export default function QuickReturn() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [salesmen, setSalesmen] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterSalesman, setFilterSalesman] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Return modal — one invoice at a time
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState(null);
  const [returnLines, setReturnLines] = useState([]);
  const [fullReturn, setFullReturn] = useState(false);
  const [returnDate, setReturnDate] = useState(todayPKT());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.get('/employees?role=Salesman').then(r => setSalesmen(r.data)).catch(() => {});
    api.get('/employees?role=Supplier').then(r => setSuppliers(r.data)).catch(() => {});
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (filterSalesman) params.set('salesman_id', filterSalesman);
      if (filterSupplier) params.set('supplier_id', filterSupplier);
      const r = await api.get(`/recoveries/quick-return-list?${params.toString()}`);
      setInvoices(r.data);
      setHasSearched(true);
    } catch {
      toast.error('Error loading invoices');
    } finally {
      setLoading(false);
    }
  }, [q, dateFrom, dateTo, filterSalesman, filterSupplier]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!loading) fetchInvoices(); }
  };

  const openReturn = async (invoice) => {
    setActiveInvoice(invoice);
    setReturnDate(todayPKT());
    setFullReturn(false);
    setConfirming(false);
    setLoadingDetail(true);
    setInvoiceDetail(null);
    setReturnLines([]);
    try {
      const r = await api.get(`/sales/${invoice.id}`);
      setInvoiceDetail(r.data);
      // already_returned (from GET /sales/:id) is baked in here, so the qty
      // shown/allowed is what's actually still returnable — same guard the
      // server enforces.
      setReturnLines((r.data.items || []).map(createRecoveryReturnLine));
    } catch {
      toast.error('Error loading invoice detail');
      setActiveInvoice(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeReturn = () => {
    setActiveInvoice(null);
    setInvoiceDetail(null);
    setReturnLines([]);
    setConfirming(false);
  };

  const updateReturnLine = (idx, field, value) => {
    setReturnLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, [field]: value };
      const qty = parseFloat(next.qty_returned) || 0;
      const rate = parseFloat(next.return_rate) || 0;
      next.return_amount = qty * rate;
      return next;
    }));
    // Manual edit breaks the "full invoice" shortcut, same as the main Recovery modal.
    if (fullReturn) setFullReturn(false);
  };

  const handleFullReturnToggle = (checked) => {
    setFullReturn(checked);
    setReturnLines(prev => prev.map(l => {
      const { blocked } = getExpiryStatus(l.exp_date, isAdmin);
      if (checked && !blocked) {
        const qty = parseFloat(l.original_qty) || 0;
        return { ...l, qty_returned: qty > 0 ? String(qty) : '', return_amount: qty * (parseFloat(l.return_rate) || 0) };
      }
      if (!checked) return { ...l, qty_returned: '', return_amount: 0 };
      return l;
    }));
  };

  const returnLineErrors = returnLines.map(l =>
    fieldError(l.qty_returned, parseFloat(l.original_qty), 'Return qty', `the returnable qty (${l.original_qty})`)
  );
  const totalReturnAmt = returnLines.reduce((s, l) => s + (parseFloat(l.return_amount) || 0), 0);
  const hasFieldErrors = returnLineErrors.some(Boolean);
  const hasAnyEntry = returnLines.some(l => parseInt(l.qty_returned || 0) > 0);
  const canSave = hasAnyEntry && !hasFieldErrors;

  const handleSaveClick = () => {
    if (!hasAnyEntry) return toast.error('Enter at least one return quantity');
    if (hasFieldErrors) return toast.error('Fix the highlighted return quantities before saving');

    for (const l of returnLines) {
      if (!parseInt(l.qty_returned)) continue;
      if (l.exp_date) {
        const expiryStr = String(l.exp_date).slice(0, 10);
        const threshold = addMonthsPKT(expiryStr, -5);
        if (todayPKT() > threshold) {
          if (isPastExpiryMonth(expiryStr)) {
            return toast.error(
              `Return blocked for "${l.product_name}" (Batch: ${l.batch_no}): expired ${formatDatePKT(expiryStr)}.`
            );
          }
          if (!isAdmin) {
            return toast.error(
              `Return blocked for "${l.product_name}" (Batch: ${l.batch_no}): expires ${formatDatePKT(expiryStr)} — within 5-month return window.`
            );
          }
        }
      }
    }
    setConfirming(true);
  };

  const performSave = async () => {
    const validReturns = returnLines.filter(l => parseInt(l.qty_returned || 0) > 0);
    setSaving(true);
    try {
      // sale_id === the invoice being returned against, with no other invoice
      // involved. In the backend's classifyReturnLine, that always resolves
      // to the 'credit' branch (isCurrentInvoice), which reduces the
      // customer's balance directly — exactly the standalone-refund behavior,
      // no linkage to any other invoice required.
      await api.post('/recoveries', {
        sale_id: activeInvoice.id,
        salesman_id: activeInvoice.salesman_id || null,
        date: returnDate,
        notes: 'Quick Return — standalone return, not linked to a new invoice',
        recovery_items: [],
        return_items: validReturns,
        amount_recovered: 0,
      });
      toast.success(`Return saved for Invoice ${activeInvoice.invoice_no} — ${formatCurrency(totalReturnAmt)} credited back to the customer.`);
      closeReturn();
      fetchInvoices();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving return');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Returns">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ padding: '14px 22px', minHeight: 0 }}>
          <div className="card-title">Find a Settled Invoice</div>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/recovery')}
            style={{ flexShrink: 0, color: 'var(--gray-500)' }}>
            <ArrowLeft size={16} />
          </button>
        </div>
        <div className="card-body" style={{ paddingTop: 16 }}>
          <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', alignItems: 'end', gap: 16 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Invoice # or Customer</label>
              <input type="text" className="form-control" placeholder="e.g. S26-00123 or customer name"
                value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleSearchKeyDown} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">From Date</label>
              <input type="date" className="form-control" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">To Date</label>
              <input type="date" className="form-control" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Salesman</label>
              <select className="form-control" value={filterSalesman} onChange={e => setFilterSalesman(e.target.value)}>
                <option value="">All Salesmen</option>
                {salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Supplier</label>
              <select className="form-control" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-primary" onClick={fetchInvoices} disabled={loading}
              style={{ height: 38, flexShrink: 0 }}>
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {loading ? 'Loading...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {!hasSearched && !loading && (
        <div className="card">
          <div className="empty-state">
            <Search size={32} style={{ marginBottom: 8, color: 'var(--gray-300)' }} />
            <div className="empty-state-title">Ready to search</div>
            <div className="empty-state-desc">
              Search by invoice number or customer name, or set a date range, then click Search.
              Only fully-settled invoices show up here.
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <div className="loading-center" style={{ padding: 48 }}><div className="spinner" /></div>
        </div>
      )}

      {!loading && hasSearched && invoices.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <RotateCcw size={32} style={{ marginBottom: 8, color: 'var(--gray-300)' }} />
            <div className="empty-state-title">No settled invoices found</div>
            <div className="empty-state-desc">Try a different search term or widen the date range.</div>
          </div>
        </div>
      )}

      {!loading && invoices.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ padding: '12px 18px', minHeight: 0 }}>
            <div className="text-sm text-muted">{invoices.length} settled invoice{invoices.length !== 1 ? 's' : ''} found</div>
            <button className="btn btn-ghost btn-sm" onClick={fetchInvoices} title="Refresh" style={{ color: 'var(--gray-500)' }}>
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice No</th><th>Date</th><th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Already Returned</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{inv.invoice_no}</td>
                    <td>{formatDatePKT(inv.date)}</td>
                    <td style={{ fontWeight: 600 }}>{inv.customer_name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(inv.total_amount)}</td>
                    <td style={{ textAlign: 'right', color: parseFloat(inv.total_return_amount) > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>
                      {formatCurrency(inv.total_return_amount || 0)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openReturn(inv)}>
                        Return Items
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!activeInvoice} onClose={closeReturn}
        title={activeInvoice ? `Return — Invoice ${activeInvoice.invoice_no}` : 'Quick Return'} size="xl"
        footer={invoiceDetail && !loadingDetail ? (
          <div className="flex items-center w-full" style={{ gap: 16, justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>
              Total return: <strong style={{ color: 'var(--amber)' }}>{formatCurrency(totalReturnAmt)}</strong>
              {' '}— credited to {invoiceDetail.customer_name}'s balance
            </span>
            {!confirming ? (
              <button type="button" className="btn btn-success" onClick={handleSaveClick} disabled={!canSave}>
                Save Return
              </button>
            ) : (
              <div className="flex items-center gap-2" style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px',
              }}>
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  Confirm crediting <strong>{formatCurrency(totalReturnAmt)}</strong> back to {invoiceDetail.customer_name}?
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={saving}>
                  <XCircle size={15} />
                  Cancel
                </button>
                <button className="btn btn-success btn-sm" onClick={performSave} disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                  {saving ? 'Saving...' : 'Confirm & Save'}
                </button>
              </div>
            )}
          </div>
        ) : null}
      >
        {loadingDetail && <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>}
        {invoiceDetail && !loadingDetail && (
          <div>
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>
                <strong>{invoiceDetail.customer_name}</strong> — Invoice total {formatCurrency(invoiceDetail.total_amount)}.
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', cursor: returnLines.length === 0 ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={fullReturn} disabled={returnLines.length === 0}
                  onChange={e => handleFullReturnToggle(e.target.checked)} />
                Return Full Invoice
              </label>
            </div>

            <div className="form-group" style={{ maxWidth: 220, marginBottom: 12 }}>
              <label className="form-label">Return Date</label>
              <input type="date" className="form-control" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
            </div>

            <ReturnTable lines={returnLines} isCross={false} updateReturnLine={updateReturnLine} isAdmin={isAdmin} errors={returnLineErrors} />
          </div>
        )}
      </Modal>
    </Layout>
  );
}
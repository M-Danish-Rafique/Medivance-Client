import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import { todayPKT, formatDatePKT } from '../../utils/dateUtils';
import { blockWheelChange } from './recoveryUtils';
import {
  ArrowLeft, RefreshCw, CheckSquare, Square, Search,
  AlertCircle, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

export default function QuickRecovery() {
  const navigate = useNavigate();
  const saveBtnRef = useRef(null);

  const [dateFrom, setDateFrom] = useState(todayPKT());
  const [dateTo, setDateTo] = useState(todayPKT());
  const [recoveryDate, setRecoveryDate] = useState(todayPKT());
  const [salesmen, setSalesmen] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterSalesman, setFilterSalesman] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

  const [invoices, setInvoices] = useState([]); // { ...sale, checked, discount }
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastResults, setLastResults] = useState(null); // { successCount, failCount, results }
  // True whenever one of the 4 filter fields has changed since the last
  // successful fetch — determines what Enter does (see keydown effect below).
  const [filtersDirty, setFiltersDirty] = useState(false);

  useEffect(() => {
    api.get('/employees?role=Salesman').then(r => setSalesmen(r.data)).catch(() => {});
    api.get('/employees?role=Supplier').then(r => setSuppliers(r.data)).catch(() => {});
  }, []);

  const fetchInvoices = useCallback(async () => {
    if (!dateFrom || !dateTo) return toast.error('Please select both From and To dates');
    if (dateFrom > dateTo) return toast.error('"From" date cannot be after "To" date');

    setLoading(true);
    setLastResults(null);
    try {
      const params = new URLSearchParams();
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
      if (filterSalesman) params.set('salesman_id', filterSalesman);
      if (filterSupplier) params.set('supplier_id', filterSupplier);
      const r = await api.get(`/recoveries/quick-list?${params.toString()}`);
      setInvoices(r.data.map(s => ({ ...s, checked: true, discount: '0' })));
      setHasSearched(true);
      setFiltersDirty(false);
    } catch {
      toast.error('Error loading invoices');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, filterSalesman, filterSupplier]);

  // Enter's behavior, no matter what's focused (or nothing at all):
  //  - No data fetched yet, or one of the 4 filters changed since the last
  //    fetch -> acts like clicking "Fetch Invoices".
  //  - Data already fetched and filters untouched since -> jumps focus to
  //    the first available (enabled) discount field instead of re-fetching.
  // A document-level listener is used instead of per-field onKeyDown so this
  // works even when nothing is focused. Skipped for: discount inputs (they
  // have their own Enter behavior to hop to the next row / Save button),
  // any focused button (so Enter on the Save Recovery button activates it
  // natively instead of jumping back to the first discount field), and
  // while the confirm dialog is open.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Enter') return;
      if (e.target?.hasAttribute?.('data-discount-input')) return;
      if (e.target?.tagName === 'BUTTON') return; // let native Enter-activates-button behavior run
      if (confirming) return;
      e.preventDefault();

      const canFocusDiscount = hasSearched && !filtersDirty && invoices.length > 0;
      if (canFocusDiscount) {
        const firstInput = document.querySelector('input[data-discount-input]:not(:disabled)');
        if (firstInput) firstInput.focus();
        return;
      }

      if (!loading) fetchInvoices();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [loading, confirming, hasSearched, filtersDirty, invoices.length, fetchInvoices]);

  const updateRow = (id, field, value) => {
    setInvoices(prev => prev.map(inv => (inv.id === id ? { ...inv, [field]: value } : inv)));
  };

  const toggleAll = (checked) => {
    setInvoices(prev => prev.map(inv => ({ ...inv, checked })));
  };

  const collectedFor = (inv) => {
    const invAmount = parseFloat(inv.pending_amount) || 0;
    const disc = parseFloat(inv.discount || 0) || 0;
    return Math.max(0, invAmount - disc);
  };

  // Enter in a discount field moves focus to the next enabled discount input.
  // On the last row, Enter focuses the Save Recovery button at the bottom;
  // pressing Enter again activates that button (native button behavior).
  const handleDiscountKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = Array.from(document.querySelectorAll('input[data-discount-input]'))
      .filter(el => !el.disabled);
    const idx = inputs.indexOf(e.currentTarget);
    if (idx < 0) return;
    if (idx < inputs.length - 1) {
      inputs[idx + 1].focus();
      return;
    }
    const btn = saveBtnRef.current;
    if (btn && !btn.disabled) {
      btn.focus();
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const checkedInvoices = invoices.filter(i => i.checked);
  const checkedCount = checkedInvoices.length;
  const totalInvoiceAmt = checkedInvoices.reduce((s, i) => s + (parseFloat(i.pending_amount) || 0), 0);
  const totalDiscount = checkedInvoices.reduce((s, i) => s + (parseFloat(i.discount || 0) || 0), 0);
  const totalCollected = checkedInvoices.reduce((s, i) => s + collectedFor(i), 0);

  const validateBeforeSubmit = () => {
    if (!recoveryDate) { toast.error('Recovery date is required'); return false; }
    if (checkedCount === 0) { toast.error('No invoices selected'); return false; }
    for (const inv of checkedInvoices) {
      const disc = parseFloat(inv.discount || 0) || 0;
      if (disc < 0) { toast.error(`Discount for ${inv.invoice_no} cannot be negative`); return false; }
      if (disc > parseFloat(inv.pending_amount) + 0.009) {
        toast.error(`Discount for ${inv.invoice_no} cannot exceed its invoice amount (${formatCurrency(inv.pending_amount)})`);
        return false;
      }
    }
    return true;
  };

  const handleSubmitClick = () => {
    if (!validateBeforeSubmit()) return;
    setConfirming(true);
  };

  const performSubmit = async () => {
    const entries = checkedInvoices.map(i => ({
      invoice_no: i.invoice_no,
      discount: parseFloat(i.discount || 0) || 0,
    }));

    setSubmitting(true);
    try {
      const r = await api.post('/recoveries/bulk', { date: recoveryDate, entries });
      const { successCount, failCount, results } = r.data;
      setLastResults(r.data);

      if (failCount === 0) {
        toast.success(`Recovery saved for ${successCount} invoice${successCount !== 1 ? 's' : ''}.`);
      } else if (successCount === 0) {
        toast.error(`All ${failCount} invoice(s) failed. See details below.`);
      } else {
        toast.error(`${successCount} saved, ${failCount} failed. See details below.`);
      }

      // Remove successfully-settled rows from the working table; keep failed ones
      // (still checked) so the user can see and fix them without re-fetching.
      const failedNos = new Set(results.filter(x => !x.success).map(x => x.invoice_no));
      setInvoices(prev => prev.filter(inv => !inv.checked || failedNos.has(inv.invoice_no)));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error submitting recovery');
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  return (
    <Layout title="Quick Recovery">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ padding: '14px 22px', minHeight: 0 }}>
          <div className="card-title">Filter Invoices</div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/recovery')}
            style={{ flexShrink: 0, color: 'var(--gray-500)' }}
          >
            <ArrowLeft size={16} />
          </button>
        </div>
        <div className="card-body" style={{ paddingTop: 16 }}>
          <div
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(4, 1fr) auto', alignItems: 'end', gap: 16 }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">From Date</label>
              <input type="date" className="form-control" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setFiltersDirty(true); }} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">To Date</label>
              <input type="date" className="form-control" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setFiltersDirty(true); }} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Salesman</label>
              <select className="form-control" value={filterSalesman}
                onChange={e => { setFilterSalesman(e.target.value); setFiltersDirty(true); }}>
                <option value="">All Salesmen</option>
                {salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Supplier</label>
              <select className="form-control" value={filterSupplier}
                onChange={e => { setFilterSupplier(e.target.value); setFiltersDirty(true); }}>
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={fetchInvoices}
              disabled={loading}
              style={{ height: 38, flexShrink: 0 }}
            >
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {loading ? 'Loading...' : 'Fetch Invoices'}
            </button>
          </div>
        </div>
      </div>

      {lastResults && lastResults.failCount > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--red)', background: 'var(--red-pale)' }}>
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              <AlertCircle size={16} />
              {lastResults.failCount} invoice(s) could not be recovered
            </div>
            <ul style={{ fontSize: 13, color: 'var(--red)', paddingLeft: 22, margin: 0 }}>
              {lastResults.results.filter(r => !r.success).map(r => (
                <li key={r.invoice_no} style={{ marginBottom: 4 }}>
                  <strong>{r.invoice_no}</strong>: {r.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!loading && hasSearched && invoices.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <CheckCircle2 size={36} style={{ marginBottom: 8, color: 'var(--gray-300)' }} />
            <div className="empty-state-title">No pending invoices</div>
            <div className="empty-state-desc">No pending invoices found for the selected filters.</div>
          </div>
        </div>
      )}

      {!hasSearched && !loading && (
        <div className="card">
          <div className="empty-state">
            <Search size={32} style={{ marginBottom: 8, color: 'var(--gray-300)' }} />
            <div className="empty-state-title">Ready to search</div>
            <div className="empty-state-desc">Select filters and click &quot;Fetch Invoices&quot; to begin.</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <div className="loading-center" style={{ padding: 48 }}>
            <div className="spinner" />
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>Recovery Date</label>
                <input type="date" className="form-control" style={{ width: 'auto' }}
                  value={recoveryDate} onChange={e => setRecoveryDate(e.target.value)} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={fetchInvoices} title="Refresh"
                style={{ color: 'var(--gray-500)' }}>
                <RefreshCw size={13} />
                Refresh
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--gray-500)', flexWrap: 'wrap' }}>
              <span>{checkedCount} of {invoices.length} selected</span>
              <span style={{ color: 'var(--gray-300)' }}>|</span>
              <span>Invoice: <strong style={{ color: 'var(--gray-800)' }}>{formatCurrency(totalInvoiceAmt)}</strong></span>
              <span>Discount: <strong style={{ color: 'var(--amber)' }}>{formatCurrency(totalDiscount)}</strong></span>
              <span>Collecting: <strong style={{ color: 'var(--green)' }}>{formatCurrency(totalCollected)}</strong></span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <button type="button" className="btn btn-ghost btn-icon" style={{ padding: 4 }}
                      onClick={() => toggleAll(checkedCount !== invoices.length)}
                      aria-label={checkedCount === invoices.length ? 'Deselect all' : 'Select all'}>
                      {checkedCount === invoices.length
                        ? <CheckSquare size={17} style={{ color: 'var(--blue)' }} />
                        : <Square size={17} style={{ color: 'var(--gray-400)' }} />}
                    </button>
                  </th>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Inv. Amount</th>
                  <th style={{ textAlign: 'right' }}>Discount</th>
                  <th style={{ textAlign: 'right' }}>Collected Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ opacity: inv.checked ? 1 : 0.55, background: inv.checked ? undefined : 'var(--gray-50)' }}>
                    <td>
                      <button type="button" className="btn btn-ghost btn-icon" style={{ padding: 4 }}
                        onClick={() => updateRow(inv.id, 'checked', !inv.checked)}
                        aria-label={inv.checked ? 'Deselect' : 'Select'}>
                        {inv.checked
                          ? <CheckSquare size={17} style={{ color: 'var(--blue)' }} />
                          : <Square size={17} style={{ color: 'var(--gray-400)' }} />}
                      </button>
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>{inv.invoice_no}</td>
                    <td>{formatDatePKT(inv.date)}</td>
                    <td style={{ fontWeight: 600 }}>{inv.customer_name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(inv.pending_amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        data-discount-input
                        className="form-control"
                        style={{ width: 110, marginLeft: 'auto', textAlign: 'right', fontSize: 12, padding: '5px 8px' }}
                        value={inv.discount}
                        disabled={!inv.checked}
                        onChange={e => updateRow(inv.id, 'discount', e.target.value)}
                        onFocus={e => e.target.select()}
                        onKeyDown={handleDiscountKeyDown}
                        onWheel={blockWheelChange}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gray-900)' }}>
                      {formatCurrency(collectedFor(inv))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
            padding: '14px 18px', borderTop: '1px solid var(--gray-100)', background: 'var(--gray-50)',
          }}>
            {!confirming ? (
              <button
                ref={saveBtnRef}
                type="button"
                className="btn btn-success"
                onClick={handleSubmitClick}
                disabled={checkedCount === 0}
              >
                Save Recovery for {checkedCount} Invoice{checkedCount !== 1 ? 's' : ''}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 w-full" style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{ fontSize: 13, color: '#92400e' }}>
                  Confirm collecting <strong>{formatCurrency(totalCollected)}</strong> across{' '}
                  <strong>{checkedCount}</strong> invoice(s) dated {formatDatePKT(recoveryDate)}?
                </span>
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={submitting}>
                    <XCircle size={15} />
                    Cancel
                  </button>
                  <button className="btn btn-success" onClick={performSubmit} disabled={submitting}>
                    {submitting ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                    {submitting ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </Layout>
  );
}
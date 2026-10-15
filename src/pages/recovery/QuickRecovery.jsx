import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import { todayPKT, formatDatePKT } from '../../utils/dateUtils';
import { blockWheelChange } from './recoveryUtils';
import DateInput from '../../components/common/DateInput';
import { HrStyles, Notice, fmtMoney } from '../hr/HrKit';
import {
  ArrowLeft, RefreshCw, CheckSquare, Square, Search,
  CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

// Quick Recovery saves in batches. Each request then finishes in seconds even
// on a slow connection, the operator sees progress, and a dropped connection
// leaves at most one batch unconfirmed. Saving again is always safe: the
// server reports an invoice that is already recorded (code ALREADY_RECOVERED)
// instead of recording it twice. One request for every selected invoice used
// to outlast the 30 s client timeout while the server kept saving, so the
// operator saw an error for a save that had succeeded (2026-10-15).
const SAVE_BATCH_SIZE = 10;
const SAVE_TIMEOUT_MS = 120000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  // Outcome of the last save: { total, saved, settled, failed, stop }
  const [lastResults, setLastResults] = useState(null);
  const [progress, setProgress] = useState(null); // { done, total } while saving
  // True whenever one of the 4 filter fields has changed since the last
  // successful fetch — determines what Enter does (see keydown effect below).
  const [filtersDirty, setFiltersDirty] = useState(false);

  useEffect(() => {
    api.get('/employees?role=Salesman').then(r => setSalesmen(r.data)).catch(() => {});
    api.get('/employees?role=Supplier').then(r => setSuppliers(r.data)).catch(() => {});
  }, []);

  // Closing or reloading the tab mid-save would leave the remaining batches
  // unsent; the browser asks first.
  useEffect(() => {
    if (!submitting) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitting]);

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
    // expected_pending is the balance this screen showed; the server refuses
    // the invoice (BALANCE_CHANGED) if another recovery or return changed it.
    const entries = checkedInvoices.map(i => ({
      invoice_no: i.invoice_no,
      discount: parseFloat(i.discount || 0) || 0,
      expected_pending: parseFloat(i.pending_amount) || 0,
    }));
    const total = entries.length;
    const results = [];
    // Set when a batch gets no per-invoice answer. `unknown`: the request may
    // have been saved (no response, or a server error); `message`: the server
    // refused the request as a whole, so nothing in it was saved.
    let stop = null;

    toast.dismiss();
    setSubmitting(true);
    setLastResults(null);
    setProgress({ done: 0, total });

    for (let start = 0; start < total; start += SAVE_BATCH_SIZE) {
      const batch = entries.slice(start, start + SAVE_BATCH_SIZE);
      let answered = [];
      let error = null;
      try {
        const r = await api.post('/recoveries/bulk',
          { date: recoveryDate, entries: batch },
          { timeout: SAVE_TIMEOUT_MS });
        answered = r.data.results || [];
      } catch (err) {
        error = err;
        answered = Array.isArray(err.response?.data?.results) ? err.response.data.results : [];
      }
      results.push(...answered);
      setProgress({ done: Math.min(start + batch.length, total), total });

      const answeredNos = new Set(answered.map(x => x.invoice_no));
      const unanswered = batch.filter(e => !answeredNos.has(e.invoice_no)).length;
      if (unanswered > 0) {
        const refused = error?.response && error.response.status < 500;
        stop = {
          unknown: !refused,
          message: refused ? (error.response.data?.message || 'The server refused the request.') : null,
          remaining: total - results.length,
        };
        break;
      }
    }

    const saved = results.filter(x => x.success);
    const settled = results.filter(x => !x.success && x.code === 'ALREADY_RECOVERED');
    const failed = results.filter(x => !x.success && x.code !== 'ALREADY_RECOVERED');
    const collected = saved.reduce((s, x) => s + (parseFloat(x.recovered) || 0), 0);

    // Saved and already-settled invoices leave the working table. Everything
    // else stays selected so it can be corrected and saved again; an invoice
    // whose balance changed shows the new balance.
    const done = new Set([...saved, ...settled].map(x => x.invoice_no));
    const newBalance = new Map(failed
      .filter(x => x.code === 'BALANCE_CHANGED' && x.pending_amount !== undefined)
      .map(x => [x.invoice_no, x.pending_amount]));
    setInvoices(prev => prev
      .filter(inv => !done.has(inv.invoice_no))
      .map(inv => (newBalance.has(inv.invoice_no)
        ? { ...inv, pending_amount: newBalance.get(inv.invoice_no) }
        : inv)));
    setLastResults({ total, saved, settled, failed, stop });

    const notSaved = failed.length + (stop ? stop.remaining : 0);
    if (notSaved === 0 && saved.length > 0) {
      toast.success(`Recovery saved for ${plural(saved.length, 'invoice')}. Collected: ${fmtMoney(collected)}.`);
    } else if (notSaved === 0) {
      toast('No recovery was recorded. The selected invoices are already fully recovered.');
    } else if (saved.length > 0) {
      toast.error(`Recovery saved for ${saved.length} of ${plural(total, 'invoice')}. The details are shown above the list.`);
    } else {
      toast.error('No recovery was saved. The details are shown above the list.');
    }

    setProgress(null);
    setSubmitting(false);
    setConfirming(false);
  };

  return (
    <Layout title="Quick Recovery">
      <HrStyles />
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ padding: '14px 22px', minHeight: 0 }}>
          <div className="card-title">Filter Invoices</div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/recovery')}
            disabled={submitting}
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
              <DateInput className="form-control" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setFiltersDirty(true); }} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">To Date</label>
              <DateInput className="form-control" value={dateTo}
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
              disabled={loading || submitting}
              style={{ height: 38, flexShrink: 0 }}
            >
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {loading ? 'Loading...' : 'Fetch Invoices'}
            </button>
          </div>
        </div>
      </div>

      {lastResults && (lastResults.stop || lastResults.failed.length > 0 || lastResults.settled.length > 0) && (
        <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
          {lastResults.stop && lastResults.stop.unknown && (
            <Notice tone="warning" title="Saving stopped before every invoice was saved">
              The connection to the server was interrupted.{' '}
              {lastResults.saved.length} of {plural(lastResults.total, 'invoice')} were saved, and{' '}
              {lastResults.stop.remaining} {lastResults.stop.remaining === 1 ? 'remains' : 'remain'} selected.
              Save again to complete them. An invoice that is already recorded is not recorded twice.
            </Notice>
          )}
          {lastResults.stop && !lastResults.stop.unknown && (
            <Notice tone="danger" title="Saving stopped">
              {lastResults.stop.message}{' '}
              {lastResults.saved.length} of {plural(lastResults.total, 'invoice')} were saved, and{' '}
              {lastResults.stop.remaining} {lastResults.stop.remaining === 1 ? 'remains' : 'remain'} selected.
            </Notice>
          )}
          {lastResults.failed.length > 0 && (
            <Notice tone="danger" title={`${plural(lastResults.failed.length, 'invoice')} not saved`}>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {lastResults.failed.map(r => (
                  <li key={r.invoice_no} style={{ marginTop: 2 }}>
                    <strong>{r.invoice_no}</strong>: {r.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {lastResults.settled.length > 0 && (
            <Notice tone="neutral" title={`${plural(lastResults.settled.length, 'invoice')} already fully recovered`}>
              No second recovery was recorded for {lastResults.settled.map(r => r.invoice_no).join(', ')}.
              {' '}{lastResults.settled.length === 1 ? 'It has' : 'They have'} been removed from the list.
            </Notice>
          )}
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
                <DateInput className="form-control" style={{ width: 'auto' }}
                  value={recoveryDate} onChange={e => setRecoveryDate(e.target.value)}
                  disabled={submitting} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={fetchInvoices} title="Refresh" disabled={submitting}
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
                      disabled={submitting}
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
                        disabled={submitting}
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
                        disabled={!inv.checked || submitting}
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
                Save recovery for {plural(checkedCount, 'invoice')}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 w-full" style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px',
              }}>
                {progress ? (
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#92400e' }}>
                    <div>
                      Saving recovery. {progress.done} of {plural(progress.total, 'invoice')} processed.
                      {' '}Keep this page open until saving finishes.
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Saving recovery"
                      aria-valuemin={0}
                      aria-valuemax={progress.total}
                      aria-valuenow={progress.done}
                      style={{ marginTop: 8, height: 6, borderRadius: 3, background: '#fde68a', overflow: 'hidden', maxWidth: 520 }}
                    >
                      <div style={{
                        height: '100%', borderRadius: 3, background: 'var(--amber)',
                        width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: '#92400e' }}>
                    Collect <strong>{fmtMoney(totalCollected)}</strong> across{' '}
                    <strong>{plural(checkedCount, 'invoice')}</strong> dated {formatDatePKT(recoveryDate)}?
                  </span>
                )}
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={submitting}>
                    <XCircle size={15} />
                    Cancel
                  </button>
                  <button className="btn btn-success" onClick={performSubmit} disabled={submitting}>
                    {submitting ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                    {submitting ? 'Saving…' : 'Save recovery'}
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
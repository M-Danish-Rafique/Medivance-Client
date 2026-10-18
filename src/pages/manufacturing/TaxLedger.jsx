import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import DateInput from '../../components/common/DateInput';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import {
  HrStyles, Tabs, Segmented, BusyButton, TableSkeleton, useSort, sortRows, fmtAmount, fmtMoney, fmtDate, num,
} from '../hr/HrKit';
import { MfgStyles, SortHead, NameWithTag, EMPTY, plural, mfgError } from './mfgKit';

// ─── FBR tax ledger ────────────────────────────────────────────────────────
// One entry per taxable manufactured product sold (written by the sale; see
// decisions: products.sale_tax_pct). Filters apply as they change: a date
// range (all dates when empty) and the status. The figures above the table
// cover the whole period; the two tabs show the entries and their summary by
// product and rate, both under the status filter. Pending entries are
// selected and marked as submitted to FBR after a confirmation that states
// the submission date (the To date, else today). Marking cannot be undone.
// The API sends dates as timestamps, so they are always shown through the PKT
// formatter, and products carry no pack size, so it is looked up from the
// manufactured products (two "Mustard Oil" sizes must not read the same).
// Status is one column: the submission date, or "Pending" in amber.

const LEDGER_SORT = {
  date: { value: r => new Date(r.sale_date).getTime() },
  invoice: { value: r => r.invoice_no, text: true },
  customer: { value: r => r.customer_name, text: true },
  product: { value: r => r.product_label, text: true },
  rate: { value: r => num(r.tax_rate) },
  taxable: { value: r => num(r.taxable_amount) },
  tax: { value: r => num(r.tax_amount) },
  // Pending first when newest-first, then by submission date.
  submitted: { value: r => (r.fbr_submission_date ? new Date(r.fbr_submission_date).getTime() : Number.MAX_SAFE_INTEGER) },
};
const ledgerOrder = (a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime() || b.id - a.id;
const SUMMARY_SORT = {
  product: { value: p => p.product_label, text: true },
  rate: { value: p => num(p.tax_rate) },
  taxable: { value: p => p.taxable },
  tax: { value: p => p.tax },
  count: { value: p => p.count },
};
const summaryOrder = (a, b) => String(a.product_label || '').localeCompare(String(b.product_label || ''), undefined, { sensitivity: 'base', numeric: true })
  || num(a.tax_rate) - num(b.tax_rate);
const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const pct = (v) => `${num(v)}%`;
const isPending = (r) => !Number(r.submitted_to_fbr);
const STATUS_WORD = { pending: 'pending', submitted: 'submitted' };

function EmptyState({ icon, title }) {
  return (
    <div className="hr-empty">
      <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{icon}</span></div>
      <div className="hr-empty-title">{title}</div>
    </div>
  );
}

export default function TaxLedger() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const [tab, setTab] = useState('entries');
  const [rows, setRows] = useState(null);
  const [rangeError, setRangeError] = useState(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [packSizes, setPackSizes] = useState(new Map());
  const ledgerSort = useSort('date', 'desc');
  const summarySort = useSort('product');

  useEffect(() => {
    Promise.all([api.get('/manufacturing/products'), api.get('/manufacturing/by-products')])
      .then(([p, b]) => setPackSizes(new Map([...p.data, ...b.data].map(x => [String(x.id), x.pack_size]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (from && to && from > to) { setRangeError('The start date must be on or before the end date.'); return undefined; }
    setRangeError(null);
    let live = true;
    setRows(null);
    api.get('/tax-ledger', { params: { from_date: from || undefined, to_date: to || undefined } })
      .then(r => { if (live) { setRows(r.data.rows || []); setSelected([]); } })
      .catch(err => {
        if (!live) return;
        setRows([]);
        toast.error(mfgError(err, 'The tax ledger could not be loaded. Try again.'));
      });
    return () => { live = false; };
  }, [from, to, reload]);

  const all = useMemo(() => (rows || []).map(r => ({
    ...r, pack_size: packSizes.get(String(r.product_id)) || null,
    product_label: `${r.product_name} ${packSizes.get(String(r.product_id)) || ''}`.trim(),
  })), [rows, packSizes]);
  const counts = useMemo(() => ({
    all: all.length,
    pending: all.filter(isPending).length,
    submitted: all.filter(r => !isPending(r)).length,
  }), [all]);
  const figures = useMemo(() => ({
    taxable: all.reduce((s, r) => s + num(r.taxable_amount), 0),
    tax: all.reduce((s, r) => s + num(r.tax_amount), 0),
    pending: all.filter(isPending).reduce((s, r) => s + num(r.tax_amount), 0),
  }), [all]);
  const shown = useMemo(() => all.filter(r => (status === 'all' ? true : status === 'pending' ? isPending(r) : !isPending(r))), [all, status]);
  const ledgerRows = useMemo(() => sortRows(shown, ledgerSort.sortConfig, LEDGER_SORT, ledgerOrder), [shown, ledgerSort.sortConfig]);
  const shownTotals = useMemo(() => ({
    taxable: shown.reduce((s, r) => s + num(r.taxable_amount), 0),
    tax: shown.reduce((s, r) => s + num(r.tax_amount), 0),
  }), [shown]);

  // One summary line per product and tax rate.
  const summary = useMemo(() => {
    const groups = new Map();
    shown.forEach(r => {
      const key = `${r.product_id}|${num(r.tax_rate)}`;
      if (!groups.has(key)) groups.set(key, { key, product_name: r.product_name, pack_size: r.pack_size, product_label: r.product_label, tax_rate: r.tax_rate, taxable: 0, tax: 0, count: 0 });
      const g = groups.get(key);
      g.taxable += num(r.taxable_amount);
      g.tax += num(r.tax_amount);
      g.count += 1;
    });
    return sortRows([...groups.values()], summarySort.sortConfig, SUMMARY_SORT, summaryOrder);
  }, [shown, summarySort.sortConfig]);

  const pendingShown = shown.filter(isPending).map(r => r.id);
  const selectedShown = selected.filter(id => pendingShown.includes(id));
  const allPendingSelected = pendingShown.length > 0 && selectedShown.length === pendingShown.length;
  const toggle = (id) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleAll = () => setSelected(allPendingSelected ? [] : pendingShown);
  const submissionDate = to || todayPKT();

  const markSubmitted = async () => {
    setSubmitting(true);
    try {
      await api.post('/tax-ledger/submit-fbr', { ids: selectedShown, submission_date: submissionDate });
      toast.success(`${plural(selectedShown.length, 'tax entry', 'tax entries')} marked as submitted to FBR.`);
      setConfirmOpen(false);
      setReload(n => n + 1);
    } catch (err) {
      toast.error(mfgError(err, 'The entries could not be marked as submitted. Try again.'));
    } finally { setSubmitting(false); }
  };

  const period = from || to;
  const emptyTitle = all.length === 0
    ? (period ? 'No tax entries in this period.' : 'No tax entries yet. They are recorded when taxable products are sold.')
    : `No ${STATUS_WORD[status]} entries${period ? ' in this period' : ''}.`;

  return (
    <Layout title="FBR Tax Ledger">
      <HrStyles />
      <MfgStyles />
      <div className="card">
        <div className="mfg-card-head">
          <Tabs
            ariaLabel="Tax ledger views"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'entries', label: `Tax entries (${shown.length})` },
              { value: 'summary', label: 'Summary by product' },
            ]}
          />
          <div className="mfg-head-actions">
            {tab === 'entries' && (
              <button type="button" className="btn btn-primary" disabled={selectedShown.length === 0}
                title={selectedShown.length === 0 ? 'Select pending entries first' : undefined}
                onClick={() => setConfirmOpen(true)}>
                <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
                {selectedShown.length > 0 ? `Mark ${selectedShown.length} as submitted` : 'Mark as submitted'}
              </button>
            )}
          </div>
        </div>
        <div className="mfg-filterbar">
          <div className="mfg-filters">
            <div className="mfg-filter-range">
              <DateInput aria-label="From date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ width: 136 }} />
              <span aria-hidden="true">to</span>
              <DateInput aria-label="To date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ width: 136 }} />
            </div>
            <Segmented
              ariaLabel="Submission status"
              value={status}
              onChange={setStatus}
              options={[
                { val: 'all', label: 'All', count: counts.all },
                { val: 'pending', label: 'Pending', count: counts.pending },
                { val: 'submitted', label: 'Submitted', count: counts.submitted },
              ]}
            />
          </div>
        </div>
        {!rangeError && rows !== null && all.length > 0 && (
          <div className="mfg-figures" role="group" aria-label="Period totals">
            <div><span>Taxable amount</span><strong>{fmtMoney(figures.taxable)}</strong></div>
            <div><span>Sale tax</span><strong>{fmtMoney(figures.tax)}</strong></div>
            <div>
              <span>Pending submission to FBR</span>
              <strong className={figures.pending > 0 ? 'mfg-amber' : undefined}>{fmtMoney(figures.pending)}</strong>
            </div>
          </div>
        )}

        {rangeError ? (
          <div className="hr-empty hr-empty-sm" role="alert">
            <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">date_range</span></div>
            <div className="hr-empty-title">{rangeError}</div>
          </div>
        ) : rows === null ? (
          <div style={{ padding: '8px 22px' }}><TableSkeleton columns={8} rows={5} /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon="receipt_long" title={emptyTitle} />
        ) : tab === 'entries' ? (
          <div className="hr-page-scroll">
            <table className="hr-table hr-page-table mfg-compact">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input type="checkbox" className="mfg-row-check" aria-label="Select all pending entries"
                      checked={allPendingSelected} disabled={pendingShown.length === 0} onChange={toggleAll} />
                  </th>
                  <SortHead sort={ledgerSort} column="date" label="Date" date style={{ width: '10%' }} />
                  <SortHead sort={ledgerSort} column="invoice" label="Invoice no." style={{ width: '11%' }} />
                  <SortHead sort={ledgerSort} column="customer" label="Customer" />
                  <SortHead sort={ledgerSort} column="product" label="Product" />
                  <SortHead sort={ledgerSort} column="rate" label="Rate" title="Sale tax rate" num style={{ width: '7%' }} />
                  <SortHead sort={ledgerSort} column="taxable" label="Taxable (PKR)" title="Taxable amount (PKR)" num style={{ width: '12%' }} />
                  <SortHead sort={ledgerSort} column="tax" label="Sale tax (PKR)" num style={{ width: '11%' }} />
                  <SortHead sort={ledgerSort} column="submitted" label="Submitted" title="Date submitted to FBR" date style={{ width: '11%' }} />
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map(r => (
                  <tr key={r.id}>
                    <td>
                      {isPending(r) && (
                        <input type="checkbox" className="mfg-row-check" checked={selected.includes(r.id)} onChange={() => toggle(r.id)}
                          aria-label={`Select ${r.invoice_no ? `invoice ${r.invoice_no}` : 'entry'}, ${r.product_name}`} />
                      )}
                    </td>
                    <td style={tabular}>{fmtDate(r.sale_date)}</td>
                    <td style={tabular}>{r.invoice_no || EMPTY}</td>
                    <td className="mfg-ellipsis" title={r.customer_name || undefined}>{r.customer_name || EMPTY}</td>
                    <td><NameWithTag name={r.product_name} tag={r.pack_size} /></td>
                    <td className="hr-num">{pct(r.tax_rate)}</td>
                    <td className="hr-num">{fmtAmount(r.taxable_amount)}</td>
                    <td className="hr-num">{fmtAmount(r.tax_amount)}</td>
                    <td style={tabular}>{isPending(r) ? <span className="mfg-amber">Pending</span> : fmtDate(r.fbr_submission_date)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mfg-total-row">
                  <td colSpan={6}>{`Total · ${plural(shown.length, 'entry', 'entries')}`}</td>
                  <td className="hr-num">{fmtAmount(shownTotals.taxable)}</td>
                  <td className="hr-num">{fmtAmount(shownTotals.tax)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="hr-page-scroll">
            <table className="hr-table hr-page-table mfg-compact">
              <thead>
                <tr>
                  <SortHead sort={summarySort} column="product" label="Product" />
                  <SortHead sort={summarySort} column="rate" label="Rate" title="Sale tax rate" num style={{ width: '10%' }} />
                  <SortHead sort={summarySort} column="taxable" label="Taxable (PKR)" title="Taxable amount (PKR)" num style={{ width: '16%' }} />
                  <SortHead sort={summarySort} column="tax" label="Sale tax (PKR)" num style={{ width: '16%' }} />
                  <SortHead sort={summarySort} column="count" label="Entries" num style={{ width: '10%' }} />
                </tr>
              </thead>
              <tbody>
                {summary.map(p => (
                  <tr key={p.key}>
                    <td><NameWithTag name={p.product_name} tag={p.pack_size} /></td>
                    <td className="hr-num">{pct(p.tax_rate)}</td>
                    <td className="hr-num">{fmtAmount(p.taxable)}</td>
                    <td className="hr-num">{fmtAmount(p.tax)}</td>
                    <td className="hr-num">{p.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mfg-total-row">
                  <td colSpan={2}>Total</td>
                  <td className="hr-num">{fmtAmount(shownTotals.taxable)}</td>
                  <td className="hr-num">{fmtAmount(shownTotals.tax)}</td>
                  <td className="hr-num">{shown.length}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => { if (!submitting) setConfirmOpen(false); }}
        title={`Mark ${plural(selectedShown.length, 'entry', 'entries')} as submitted to FBR?`}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>Cancel</button>
            <BusyButton busy={submitting} busyLabel="Marking…" onClick={markSubmitted}>Mark as submitted</BusyButton>
          </>
        )}
      >
        <p className="mfg-confirm-text">
          {`Sale tax of ${fmtMoney(ledgerRows.filter(r => selectedShown.includes(r.id)).reduce((s, r) => s + num(r.tax_amount), 0))} will be recorded as submitted on ${fmtDate(submissionDate)}${to ? ', the end of the selected period' : ''}. This cannot be undone.`}
        </p>
      </Modal>
    </Layout>
  );
}

import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';
import DateInput from '../../components/common/DateInput';
import { HrStyles, useSort, sortRows, num } from '../hr/HrKit';
import { MfgStyles, SortHead } from './mfgKit';

// Both tables sort on every column (HrKit sorting, manufacturing rules):
// transactions newest first, the summary by product A to Z. Totals stay last.
const LEDGER_SORT = {
  date: { value: r => String(r.sale_date || '').slice(0, 10) },
  invoice: { value: r => r.invoice_no, text: true },
  customer: { value: r => r.customer_name, text: true },
  product: { value: r => r.product_name, text: true },
  rate: { value: r => num(r.tax_rate) },
  taxable: { value: r => num(r.taxable_amount) },
  tax: { value: r => num(r.tax_amount) },
  status: { value: r => (r.submitted_to_fbr ? 'Submitted' : 'Pending'), text: true },
  fbr_date: { value: r => (r.fbr_submission_date ? String(r.fbr_submission_date).slice(0, 10) : null) },
};
const ledgerOrder = (a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')) || b.id - a.id;
const SUMMARY_SORT = {
  product: { value: p => p.product_name, text: true },
  rate: { value: p => num(p.tax_rate) },
  taxable: { value: p => num(p.taxable) },
  tax: { value: p => num(p.tax) },
  count: { value: p => p.rows?.length || 0 },
};
const summaryOrder = (a, b) => String(a.product_name || '').localeCompare(String(b.product_name || ''), undefined, { sensitivity: 'base' })
  || num(a.tax_rate) - num(b.tax_rate);
const right = { textAlign: 'right' };

export default function TaxLedger() {
  const [data, setData] = useState({ rows: [], summary: {}, by_product: [] });
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [submittedFilter, setSubmittedFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('ledger');
  const [reportData, setReportData] = useState(null);
  const ledgerSort = useSort('date', 'desc');
  const summarySort = useSort('product');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (submittedFilter !== '') params.append('submitted', submittedFilter);
      const r = await api.get(`/tax-ledger?${params}`);
      setData(r.data);
    } catch { toast.error('Error loading tax ledger'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadReport = async () => {
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      const r = await api.get(`/tax-ledger/report?${params}`);
      setReportData(r.data);
    } catch { toast.error('Error loading report'); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAllPending = () => {
    const pending = data.rows.filter(r => !r.submitted_to_fbr).map(r => r.id);
    setSelected(prev => prev.length === pending.length ? [] : pending);
  };

  const handleSubmitFBR = async () => {
    if (!selected.length) return toast.error('Select at least one record');
    setSubmitting(true);
    try {
      const submissionDate = toDate || todayPKT();
      await api.post('/tax-ledger/submit-fbr', { ids: selected, submission_date: submissionDate });
      toast.success(`${selected.length} records marked as submitted to FBR`);
      setSelected([]);
      load();
    } catch { toast.error('Error submitting'); } finally { setSubmitting(false); }
  };

  const fmtPKR = formatCurrency;
  const ledgerRows = sortRows(data.rows || [], ledgerSort.sortConfig, LEDGER_SORT, ledgerOrder);
  const summaryRows = sortRows(reportData?.by_product || [], summarySort.sortConfig, SUMMARY_SORT, summaryOrder);

  return (
    <Layout title="FBR Tax Ledger">
      <HrStyles />
      <MfgStyles />
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dbeafe' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>bar_chart</span></div>
          <div><div className="stat-label">Total Taxable Amount</div><div className="stat-value" style={{ fontSize: 18 }}>{fmtPKR(data.summary.totalTaxable)}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef3c7' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>receipt_long</span></div>
          <div><div className="stat-label">Total Tax Collected</div><div className="stat-value" style={{ fontSize: 18 }}>{fmtPKR(data.summary.totalTax)}</div></div>
        </div>
        <div className="stat-card" style={{ borderColor: parseFloat(data.summary.pendingTax) > 0 ? '#fecaca' : undefined }}>
          <div className="stat-icon" style={{ background: '#fee2e2' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>warning</span></div>
          <div>
            <div className="stat-label">Pending Submission (FBR)</div>
            <div className="stat-value" style={{ fontSize: 18, color: parseFloat(data.summary.pendingTax) > 0 ? 'var(--red)' : 'var(--green)' }}>{fmtPKR(data.summary.pendingTax)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">FBR Tax Records</div>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <DateInput className="form-control" style={{ width: 160 }} value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From date" />
            <DateInput className="form-control" style={{ width: 160 }} value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To date" />
            <select className="form-control" style={{ width: 160 }} value={submittedFilter} onChange={e => setSubmittedFilter(e.target.value)}>
              <option value="">All Records</option>
              <option value="0">Pending</option>
              <option value="1">Submitted</option>
            </select>
            <button className="btn btn-outline" onClick={load}><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>search</span>Filter</button>
            <button className="btn btn-outline" onClick={() => { loadReport(); setActiveTab('report'); }}><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>description</span>FBR Report</button>
            {selected.length > 0 && (
              <button className="btn btn-primary" onClick={handleSubmitFBR} disabled={submitting}>
                {submitting ? 'Submitting...' : `Mark ${selected.length} as Submitted`}
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: '0 22px' }}>
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>Tax Ledger ({data.rows?.length || 0})</button>
            <button className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`} onClick={() => { setActiveTab('report'); loadReport(); }}>FBR Summary Report</button>
          </div>
        </div>

        {activeTab === 'ledger' && (
          <div className="table-wrap">
            {loading ? <div className="loading-center"><div className="spinner" /></div>
            : data.rows?.length === 0
              ? <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>receipt_long</span></div><div className="empty-state-title">No tax records found</div><div className="empty-state-desc">Tax is recorded automatically on taxable product sales</div></div>
              : (
                <table className="mfg-list">
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox"
                          checked={selected.length === data.rows.filter(r => !r.submitted_to_fbr).length && data.rows.some(r => !r.submitted_to_fbr)}
                          onChange={selectAllPending} title="Select all pending" />
                      </th>
                      <SortHead sort={ledgerSort} column="date" label="Date" date />
                      <SortHead sort={ledgerSort} column="invoice" label="Invoice" />
                      <SortHead sort={ledgerSort} column="customer" label="Customer" />
                      <SortHead sort={ledgerSort} column="product" label="Product" />
                      <SortHead sort={ledgerSort} column="rate" label="Tax Rate" num />
                      <SortHead sort={ledgerSort} column="taxable" label="Taxable Amt" num />
                      <SortHead sort={ledgerSort} column="tax" label="Tax Amount" num />
                      <SortHead sort={ledgerSort} column="status" label="Status" />
                      <SortHead sort={ledgerSort} column="fbr_date" label="FBR Date" date />
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map(r => (
                      <tr key={r.id} style={{ background: r.submitted_to_fbr ? '#f0fdf4' : undefined }}>
                        <td>
                          {!r.submitted_to_fbr && (
                            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                          )}
                        </td>
                        <td>{formatDatePKT(r.sale_date)}</td>
                        <td><span className="mono badge badge-gray" style={{ fontSize: 10 }}>{r.invoice_no || '—'}</span></td>
                        <td>{r.customer_name || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{r.product_name}</td>
                        <td style={right}><span className="badge badge-amber">{r.tax_rate}%</span></td>
                        <td className="mono" style={right}>{fmtPKR(r.taxable_amount)}</td>
                        <td style={{ ...right, fontWeight: 700, color: 'var(--amber)' }}>{fmtPKR(r.tax_amount)}</td>
                        <td>
                          {r.submitted_to_fbr
                            ? <span className="badge badge-green">Submitted</span>
                            : <span className="badge badge-red">Pending</span>}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                          {formatDatePKT(r.fbr_submission_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--navy)', color: 'white' }}>
                      <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700 }}>TOTALS</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right' }}>{fmtPKR(data.summary.totalTaxable)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#fcd34d', textAlign: 'right' }}>{fmtPKR(data.summary.totalTax)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
          </div>
        )}

        {activeTab === 'report' && reportData && (
          <div style={{ padding: 22 }}>
            <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--navy)', marginBottom: 4 }}>FBR Sales Tax Summary Report</div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                Period: {reportData.from_date || 'All time'} — {reportData.to_date || 'Present'}
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
                <div><span style={{ color: 'var(--gray-500)', fontSize: 13 }}>Total Taxable: </span><strong style={{ fontSize: 15 }}>{fmtPKR(reportData.totals?.taxable)}</strong></div>
                <div><span style={{ color: 'var(--gray-500)', fontSize: 13 }}>Total Tax to Submit: </span><strong style={{ fontSize: 15, color: 'var(--amber)' }}>{fmtPKR(reportData.totals?.tax)}</strong></div>
              </div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Breakdown by Product</div>
            <table className="mfg-list">
              <thead>
                <tr>
                  <SortHead sort={summarySort} column="product" label="Product" />
                  <SortHead sort={summarySort} column="rate" label="Tax Rate" num />
                  <SortHead sort={summarySort} column="taxable" label="Total Taxable" num />
                  <SortHead sort={summarySort} column="tax" label="Tax to Submit" num />
                  <SortHead sort={summarySort} column="count" label="Transactions" num />
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(p => (
                  <tr key={p.rows?.[0]?.product_id ?? p.product_name}>
                    <td style={{ fontWeight: 600 }}>{p.product_name}</td>
                    <td style={right}><span className="badge badge-amber">{p.tax_rate}%</span></td>
                    <td className="mono" style={right}>{fmtPKR(p.taxable)}</td>
                    <td style={{ ...right, fontWeight: 700, color: 'var(--amber)' }}>{fmtPKR(p.tax)}</td>
                    <td style={right}><span className="badge badge-gray">{p.rows?.length || 0}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--navy)', color: 'white' }}>
                  <td colSpan={2} style={{ padding: '10px 14px', fontWeight: 700 }}>GRAND TOTAL</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right' }}>{fmtPKR(reportData.totals?.taxable)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: '#fcd34d', textAlign: 'right' }}>{fmtPKR(reportData.totals?.tax)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';
import { formatDatePKT } from '../../utils/dateUtils';

const fmt = formatCurrency;

// Entities available for the layered Sale Summary report, in the order
// they're offered when a layer slot is open.
const SUMMARY_ENTITY_OPTIONS = [
  { key: 'salesman', label: 'Sales Man' },
  { key: 'company', label: 'Company' },
  { key: 'product', label: 'Product' },
  { key: 'customer', label: 'Customer' },
];
const SUMMARY_ENTITY_LABEL = Object.fromEntries(SUMMARY_ENTITY_OPTIONS.map(o => [o.key, o.label]));

// Given the flat, already-sorted rows returned by the API (sorted by
// layer1..layerN, matching the SQL ORDER BY), work out which cells should
// be merged (rowSpan) so repeated outer-group values show once instead of
// on every row — the standard "grouped ledger" look.
function buildSummarySpans(rows, nLayers) {
  const key = (row, i) => Array.from({ length: i + 1 }, (_, k) => row[`layer${k + 1}`] || '').join('\u241F');
  return rows.map((row, r) => Array.from({ length: nLayers }, (_, i) => {
    const isStart = r === 0 || key(row, i) !== key(rows[r - 1], i);
    if (!isStart) return { show: false, span: 0 };
    let span = 1;
    while (r + span < rows.length && key(rows[r + span], i) === key(row, i)) span++;
    return { show: true, span };
  }));
}

// Inline emphasis for the UI-only subtotal row (kept out of the printed
// PDF per feedback) — everything else uses the same .report-table /
// .report-tfoot-* classes as the other report tabs for visual consistency.
const summarySubtotalStyle = { fontWeight: 700, background: 'var(--gray-50, #f7f9fb)' };

// Vertical divider rule for the Sale Summary table body: with a single
// layer, no dividers at all (not even after Sr). With 2+ layers, a divider
// after Sr and after every layer column except the last one — e.g. with 3
// layers: Sr | L1 | L2 | L3 (dividers after Sr, L1, L2; none after L3).
// colIndex: 0 = Sr, 1..nLayers = L1..Ln. The header row never gets these —
// it stays completely free of vertical rules.
function summaryVLine(colIndex, nLayers) {
  if (nLayers <= 1) return false;
  return colIndex < nLayers;
}
const VLINE_STYLE = { borderRight: '1px solid var(--gray-300, #d7dee6)' };

function ReportFilterLayout({ fields, loading, onGenerate, onDownload, hasData, generateDisabled }) {
  return (
    <div className="report-filter-layout">
      <div className="report-filter-fields">{fields}</div>
      <div className="report-filter-actions">
        <button className="btn btn-primary" onClick={onGenerate} disabled={loading || generateDisabled}>
          {loading ? 'Loading...' : 'Generate'}
        </button>
        {hasData && (
          <button className="btn btn-outline" onClick={onDownload}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
            Download PDF
          </button>
        )}
      </div>
    </div>
  );
}

function downloadBlob(res, filename) {
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export default function Reports() {
  const [reportTab, setReportTab] = useState('ledger');

  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [employeesSalesman, setEmployeesSalesman] = useState([]);
  const [employeesSupplier, setEmployeesSupplier] = useState([]);
  const [areas, setAreas] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Ledger state
  const [ledgerType, setLedgerType] = useState('customer');
  const [ledgerEntityId, setLedgerEntityId] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Sales report state
  const [salesFrom, setSalesFrom] = useState('');
  const [salesTo, setSalesTo] = useState('');
  const [salesSalesman, setSalesSalesman] = useState('');
  const [salesRows, setSalesRows] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);

  // Recovery report state
  const [recFrom, setRecFrom] = useState('');
  const [recTo, setRecTo] = useState('');
  const [recSupplier, setRecSupplier] = useState('');
  const [recRows, setRecRows] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  // Sale Summary report state
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [summaryLayers, setSummaryLayers] = useState([]); // ordered array of entity keys, e.g. ['salesman','company']
  const [summaryData, setSummaryData] = useState(null);   // { rows, layers }
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/customers'),
      api.get('/suppliers'),
      api.get('/employees?role=Salesman'),
      api.get('/employees?role=Supplier'),
      api.get('/geography/geo'),
    ])
      .then(([c, s, e_sm, e_sp, g]) => {
        setCustomers(c.data);
        setSuppliers(s.data);
        setEmployeesSalesman(e_sm.data);
        setEmployeesSupplier(e_sp.data);
        setAreas(g.data.areas);
        setTerritories(g.data.territories);
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  const fetchLedger = async () => {
    if (!ledgerEntityId) return toast.error('Please select a customer or supplier');
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      if (ledgerType === 'customer') params.append('customer_id', ledgerEntityId);
      else params.append('supplier_id', ledgerEntityId);
      if (ledgerFrom) params.append('from_date', ledgerFrom);
      if (ledgerTo) params.append('to_date', ledgerTo);
      const endpoint = ledgerType === 'customer' ? '/reports/customer-ledger' : '/reports/supplier-ledger';
      const r = await api.get(`${endpoint}?${params}`);
      setLedger(r.data);
    } catch {
      toast.error('Error fetching ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const downloadLedgerPDF = async () => {
    if (!ledgerEntityId) return toast.error('Please select a customer or supplier');
    const params = new URLSearchParams();
    if (ledgerType === 'customer') params.append('customer_id', ledgerEntityId);
    else params.append('supplier_id', ledgerEntityId);
    if (ledgerFrom) params.append('from_date', ledgerFrom);
    if (ledgerTo) params.append('to_date', ledgerTo);
    const endpoint = ledgerType === 'customer' ? 'customer-ledger' : 'supplier-ledger';
    try {
      const res = await api.get(`/reports/${endpoint}/pdf?${params}`, { responseType: 'blob' });
      const entity = (ledgerType === 'customer' ? customers : suppliers).find(x => String(x.id) === String(ledgerEntityId));
      downloadBlob(res, `${ledgerType}-ledger-${(entity?.name || ledgerType).replace(/[^a-z0-9]+/gi, '-')}.pdf`);
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchSalesReport = async () => {
    setSalesLoading(true);
    try {
      const params = new URLSearchParams();
      if (salesFrom) params.append('from_date', salesFrom);
      if (salesTo) params.append('to_date', salesTo);
      if (salesSalesman) params.append('salesman_id', salesSalesman);
      const r = await api.get(`/reports/sales-report?${params}`);
      setSalesRows(r.data.rows || []);
    } catch {
      toast.error('Error fetching sales report');
    } finally {
      setSalesLoading(false);
    }
  };

  const downloadSalesPDF = async () => {
    const params = new URLSearchParams();
    if (salesFrom) params.append('from_date', salesFrom);
    if (salesTo) params.append('to_date', salesTo);
    if (salesSalesman) params.append('salesman_id', salesSalesman);
    try {
      const res = await api.get(`/reports/sales-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'sales-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchRecoveryReport = async () => {
    setRecLoading(true);
    try {
      const params = new URLSearchParams();
      if (recFrom) params.append('from_date', recFrom);
      if (recTo) params.append('to_date', recTo);
      if (recSupplier) params.append('supplier_id', recSupplier);
      const r = await api.get(`/reports/recovery-report?${params}`);
      setRecRows(r.data.rows || []);
    } catch {
      toast.error('Error fetching recovery report');
    } finally {
      setRecLoading(false);
    }
  };

  const downloadRecoveryPDF = async () => {
    const params = new URLSearchParams();
    if (recFrom) params.append('from_date', recFrom);
    if (recTo) params.append('to_date', recTo);
    if (recSupplier) params.append('supplier_id', recSupplier);
    try {
      const res = await api.get(`/reports/recovery-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'recovery-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  // Sets/clears the layer at `index`, truncating any layers chosen after it
  // (choosing an earlier layer differently invalidates later selections).
  const setSummaryLayerAt = (index, key) => {
    setSummaryLayers(prev => {
      const next = prev.slice(0, index);
      if (key) next.push(key);
      return next;
    });
    setSummaryData(null);
  };

  const fetchSaleSummary = async () => {
    if (summaryLayers.length === 0) return toast.error('Please select at least Layer 1');
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams();
      if (summaryFrom) params.append('from_date', summaryFrom);
      if (summaryTo) params.append('to_date', summaryTo);
      params.append('layers', summaryLayers.join(','));
      const r = await api.get(`/reports/sale-summary?${params}`);
      setSummaryData(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Error fetching sale summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const downloadSaleSummaryPDF = async () => {
    if (summaryLayers.length === 0) return toast.error('Please select at least Layer 1');
    const params = new URLSearchParams();
    if (summaryFrom) params.append('from_date', summaryFrom);
    if (summaryTo) params.append('to_date', summaryTo);
    params.append('layers', summaryLayers.join(','));
    try {
      const res = await api.get(`/reports/sale-summary/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'sale-summary-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const ledgerEntity = ledger?.customer || ledger?.supplier;
  const ledgerRows = ledger?.ledger || [];
  const ob = parseFloat(ledger?.openingBalance || 0);
  let runBal = ob;
  const rowsWithBalance = ledgerRows.map(r => {
    runBal += parseFloat(r.dr || 0) - parseFloat(r.cr || 0);
    return { ...r, _balance: runBal };
  });
  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1]._balance : ob;

  const salesTotals = (salesRows || []).reduce((t, r) => ({
    gross: t.gross + parseFloat(r.gross_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    net: t.net + parseFloat(r.net_amount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
  }), { gross: 0, ret: 0, disc: 0, net: 0, rec: 0 });

  const recTotals = (recRows || []).reduce((t, r) => ({
    gross: t.gross + parseFloat(r.gross_amount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    pending: t.pending + parseFloat(r.net_pending || 0),
  }), { gross: 0, rec: 0, ret: 0, disc: 0, pending: 0 });

  const summaryRows = summaryData?.rows || [];
  const summaryLayerLabels = summaryData?.layers?.map(l => l.label) || summaryLayers.map(k => SUMMARY_ENTITY_LABEL[k]);
  const summaryTotals = summaryRows.reduce((t, r) => ({
    gross: t.gross + parseFloat(r.gross_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    net: t.net + parseFloat(r.net_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
  }), { gross: 0, ret: 0, net: 0, disc: 0, rec: 0 });

  if (dataLoading) {
    return (
      <Layout title="Reports">
        <div className="loading-center"><div className="spinner" /></div>
      </Layout>
    );
  }

  return (
    <Layout title="Reports">
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'ledger', label: 'Ledger Reports', icon: 'account_balance' },
          { id: 'sales', label: 'Sales Report', icon: 'sell' },
          { id: 'recovery', label: 'Recovery Report', icon: 'account_balance_wallet' },
          { id: 'summary', label: 'Sale Summary', icon: 'layers' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`btn ${reportTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setReportTab(tab.id)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Ledger Report ── */}
      {reportTab === 'ledger' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Generate Ledger Report</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {['customer', 'supplier'].map(t => (
                  <button key={t} className={`btn ${ledgerType === t ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => { setLedgerType(t); setLedgerEntityId(''); setLedger(null); }}>
                    {t === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'}
                  </button>
                ))}
              </div>
              <div className="form-grid form-grid-4" style={{ alignItems: 'flex-end', gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">{ledgerType === 'customer' ? 'Customer' : 'Supplier'} *</label>
                  {ledgerType === 'customer' ? (
                    <CustomerAutocomplete
                      customers={customers}
                      areas={areas}
                      territories={territories}
                      value={ledgerEntityId}
                      onChange={id => { setLedgerEntityId(id); setLedger(null); }}
                      placeholder="Search customer by name…"
                      style={{ minWidth: 260 }}
                    />
                  ) : (
                    <select className="form-control" style={{ minWidth: 260 }} value={ledgerEntityId} onChange={e => { setLedgerEntityId(e.target.value); setLedger(null); }}>
                      <option value="">— Select —</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">From Date</label>
                  <input className="form-control" type="date" value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">To Date</label>
                  <input className="form-control" type="date" value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={fetchLedger} disabled={ledgerLoading || !ledgerEntityId}>
                    {ledgerLoading ? 'Loading...' : 'Generate'}
                  </button>
                  {ledger && (
                    <button className="btn btn-outline" onClick={downloadLedgerPDF}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
                      Download PDF
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {ledger && (
            <div className="card">
              <div style={{ padding: '18px 22px', background: 'var(--blue-ultra)', borderBottom: '1px solid var(--blue-pale)' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>{ledgerEntity?.name}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
                  Balance: {fmt(Math.abs(finalBalance))} {finalBalance >= 0 ? 'Dr' : 'Cr'}
                </div>
              </div>
              {ob !== 0 && (
                <div style={{ padding: '10px 22px', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                  Opening Balance: {fmt(Math.abs(ob))} {ob >= 0 ? 'Dr' : 'Cr'}
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Invoice No</th><th>Description</th>
                      <th style={{ textAlign: 'right' }}>Dr</th>
                      <th style={{ textAlign: 'right' }}>Cr</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithBalance.map((row, i) => (
                      <tr key={i}>
                        <td>{formatDatePKT(row.date)}</td>
                        <td>{row.invoice_no || '—'}</td>
                        <td>{row.description || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(row.dr) > 0 ? fmt(row.dr) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(row.cr) > 0 ? fmt(row.cr) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {fmt(Math.abs(row._balance))} {row._balance >= 0 ? 'Dr' : 'Cr'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sales Report ── */}
      {reportTab === 'sales' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Sales Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={salesLoading}
                onGenerate={fetchSalesReport}
                onDownload={downloadSalesPDF}
                hasData={!!salesRows}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date</label>
                      <input className="form-control" type="date" value={salesFrom} onChange={e => setSalesFrom(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date</label>
                      <input className="form-control" type="date" value={salesTo} onChange={e => setSalesTo(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Salesman</label>
                      <select className="form-control" value={salesSalesman} onChange={e => setSalesSalesman(e.target.value)}>
                        <option value="">All</option>
                        {employeesSalesman.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {salesRows && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">{salesRows.length} sale{salesRows.length !== 1 ? 's' : ''}</div>
              </div>
              <div className="table-wrap">
                {salesRows.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-title">No sales in selected period</div></div>
                ) : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '4%' }}>Sr</th>
                        <th style={{ width: '10%' }}>Date</th>
                        <th style={{ width: '10%' }}>Invoice No</th>
                        <th>Customer</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Gross</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Net</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Recovered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{formatDatePKT(row.date)}</td>
                          <td className="mono">{row.invoice_no}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.discount) > 0 ? fmt(row.discount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_amount) > 0 ? fmt(row.return_amount) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.net_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.recovered_amount) > 0 ? fmt(row.recovered_amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.disc)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.ret)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.net)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.rec)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Recovery Report ── */}
      {reportTab === 'recovery' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Recovery Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={recLoading}
                onGenerate={fetchRecoveryReport}
                onDownload={downloadRecoveryPDF}
                hasData={!!recRows}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date</label>
                      <input className="form-control" type="date" value={recFrom} onChange={e => setRecFrom(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date</label>
                      <input className="form-control" type="date" value={recTo} onChange={e => setRecTo(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Supplier</label>
                      <select className="form-control" value={recSupplier} onChange={e => setRecSupplier(e.target.value)}>
                        <option value="">All</option>
                        {employeesSupplier.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {recRows && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">{recRows.length} recover{recRows.length !== 1 ? 'ies' : 'y'}</div>
              </div>
              <div className="table-wrap">
                {recRows.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-title">No recoveries in selected period</div></div>
                ) : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '5%' }}>Sr</th>
                        <th style={{ width: '12%' }}>Date</th>
                        <th style={{ width: '10%' }}>Invoice No</th>
                        <th>Customer</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Gross Pending</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Recovered</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Net Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{formatDatePKT(row.date)}</td>
                          <td className="mono">{row.invoice_no}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.discount) > 0 ? fmt(row.discount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_amount) > 0 ? fmt(row.return_amount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.recovered_amount)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: parseFloat(row.net_pending) > 0 ? 'var(--amber)' : 'var(--green)' }}>
                            {fmt(row.net_pending)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(recTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.disc)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.ret)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.rec)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.pending)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sale Summary Report (layered / multi-level) ── */}
      {reportTab === 'summary' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Sale Summary Report</div></div>
            <div className="card-body">
              <div className="form-grid form-grid-4" style={{ marginBottom: 20 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">From Date</label>
                  <input className="form-control" type="date" value={summaryFrom}
                    onChange={e => { setSummaryFrom(e.target.value); setSummaryData(null); }} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">To Date</label>
                  <input className="form-control" type="date" value={summaryTo}
                    onChange={e => { setSummaryTo(e.target.value); setSummaryData(null); }} />
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 10 }}>
                Choose how to group your sales — add up to 4 grouping levels.
              </div>

              <div className="form-grid form-grid-4">
                {[0, 1, 2, 3].map(idx => {
                  // Only render this slot if it's the first ("Group By"), or
                  // the previous slot has already been filled in.
                  if (idx > 0 && summaryLayers.length < idx) return null;
                  const usedElsewhere = summaryLayers.slice(0, idx);
                  const availableOptions = SUMMARY_ENTITY_OPTIONS.filter(o => !usedElsewhere.includes(o.key));
                  const currentValue = summaryLayers[idx] || '';
                  return (
                    <div className="form-group" style={{ margin: 0 }} key={idx}>
                      <label className="form-label">{idx === 0 ? 'Group By *' : 'Then By'}</label>
                      <select
                        className="form-control"
                        value={currentValue}
                        onChange={e => setSummaryLayerAt(idx, e.target.value)}
                      >
                        {idx === 0 && <option value="">— Select —</option>}
                        {idx > 0 && <option value="">— None —</option>}
                        {availableOptions.map(o => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={fetchSaleSummary}
                  disabled={summaryLoading || summaryLayers.length === 0}>
                  {summaryLoading ? 'Loading...' : 'Generate'}
                </button>
                {summaryData && (
                  <button className="btn btn-outline" onClick={downloadSaleSummaryPDF}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
                    Download PDF
                  </button>
                )}
              </div>
            </div>
          </div>

          {summaryData && (() => {
            const nLayers = summaryLayerLabels.length;
            const spans = buildSummarySpans(summaryRows, nLayers);
            let runningSubtotal = { gross: 0, ret: 0, net: 0, disc: 0, rec: 0 };

            return (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    {summaryRows.length} group{summaryRows.length !== 1 ? 's' : ''}
                    <span style={{ fontWeight: 400, color: 'var(--gray-500)', marginLeft: 8 }}>
                      (Grouped By: {summaryLayerLabels.join(', ')})
                    </span>
                  </div>
                </div>
                <div className="table-wrap">
                  {summaryRows.length === 0 ? (
                    <div className="empty-state"><div className="empty-state-title">No sales in selected period</div></div>
                  ) : (
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th style={{ width: '4%' }}>Sr</th>
                          {summaryLayerLabels.map((lbl, i) => <th key={i}>{lbl}</th>)}
                          <th style={{ width: '11%', textAlign: 'right' }}>Gross Sale</th>
                          <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                          <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                          <th style={{ width: '11%', textAlign: 'right' }}>Net Sale</th>
                          <th style={{ width: '11%', textAlign: 'right' }}>Recovered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.map((row, r) => {
                          const gross = parseFloat(row.gross_amount) || 0;
                          const ret = parseFloat(row.return_amount) || 0;
                          const net = parseFloat(row.net_amount) || 0;
                          const disc = parseFloat(row.discount) || 0;
                          const rec = parseFloat(row.recovered_amount) || 0;
                          runningSubtotal = {
                            gross: runningSubtotal.gross + gross, ret: runningSubtotal.ret + ret,
                            net: runningSubtotal.net + net, disc: runningSubtotal.disc + disc, rec: runningSubtotal.rec + rec,
                          };

                          const isLastRow = r === summaryRows.length - 1;
                          const layer1Ends = nLayers > 1 && (isLastRow || (row.layer1 || '') !== (summaryRows[r + 1].layer1 || ''));
                          const subtotalToRender = layer1Ends ? runningSubtotal : null;
                          if (layer1Ends) runningSubtotal = { gross: 0, ret: 0, net: 0, disc: 0, rec: 0 };

                          return (
                            <React.Fragment key={r}>
                              <tr>
                                <td style={{ verticalAlign: 'top', ...(summaryVLine(0, nLayers) ? VLINE_STYLE : null) }}>{r + 1}</td>
                                {Array.from({ length: nLayers }, (_, li) => (
                                  spans[r][li].show ? (
                                    <td key={li} rowSpan={spans[r][li].span}
                                      style={{
                                        verticalAlign: 'top',
                                        fontWeight: li === 0 ? 600 : undefined,
                                        ...(summaryVLine(li + 1, nLayers) ? VLINE_STYLE : null),
                                      }}>
                                      {row[`layer${li + 1}`] || '—'}
                                    </td>
                                  ) : null
                                ))}
                                <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{fmt(row.gross_amount)}</td>
                                <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{disc > 0 ? fmt(row.discount) : '—'}</td>
                                <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{ret > 0 ? fmt(row.return_amount) : '—'}</td>
                                <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: 700 }}>{fmt(row.net_amount)}</td>
                                <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{rec > 0 ? fmt(row.recovered_amount) : '—'}</td>
                              </tr>
                              {subtotalToRender && (
                                <tr style={summarySubtotalStyle}>
                                  <td colSpan={1 + nLayers} style={summarySubtotalStyle}>
                                    {row.layer1 ? `Subtotal — ${row.layer1}` : 'Subtotal'}
                                  </td>
                                  <td style={{ ...summarySubtotalStyle, textAlign: 'right' }}>{fmt(subtotalToRender.gross)}</td>
                                  <td style={{ ...summarySubtotalStyle, textAlign: 'right' }}>{subtotalToRender.disc > 0 ? fmt(subtotalToRender.disc) : '—'}</td>
                                  <td style={{ ...summarySubtotalStyle, textAlign: 'right' }}>{subtotalToRender.ret > 0 ? fmt(subtotalToRender.ret) : '—'}</td>
                                  <td style={{ ...summarySubtotalStyle, textAlign: 'right' }}>{fmt(subtotalToRender.net)}</td>
                                  <td style={{ ...summarySubtotalStyle, textAlign: 'right' }}>{fmt(subtotalToRender.rec)}</td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={1 + nLayers} className="report-tfoot-label">Grand Total</td>
                          <td className="report-tfoot-num">{fmt(summaryTotals.gross)}</td>
                          <td className="report-tfoot-num">{summaryTotals.disc > 0 ? fmt(summaryTotals.disc) : '—'}</td>
                          <td className="report-tfoot-num">{summaryTotals.ret > 0 ? fmt(summaryTotals.ret) : '—'}</td>
                          <td className="report-tfoot-num">{fmt(summaryTotals.net)}</td>
                          <td className="report-tfoot-num">{fmt(summaryTotals.rec)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </Layout>
  );
}
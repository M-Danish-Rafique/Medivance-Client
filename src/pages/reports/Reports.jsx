import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';

const fmt = formatCurrency;

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

  const areaNameById = Object.fromEntries(areas.map(a => [String(a.id), a.name]));
  const territoryNameById = Object.fromEntries(territories.map(t => [String(t.id), t.name]));
  const customerLabel = (c) => {
    const loc = [areaNameById[String(c.area_id)], territoryNameById[String(c.territory_id)]].filter(Boolean).join(', ');
    return loc ? `${c.name} — ${loc}` : c.name;
  };

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
    rd: t.rd + parseFloat(r.return_discount || 0),
    pending: t.pending + parseFloat(r.net_pending || 0),
  }), { gross: 0, rec: 0, rd: 0, pending: 0 });

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
              <div className="form-grid form-grid-4" style={{ alignItems: 'flex-end', gridTemplateColumns: '3fr 1fr 1fr 1fr' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">{ledgerType === 'customer' ? 'Customer' : 'Supplier'} *</label>
                  <select className="form-control" style={{ minWidth: 340, width: '100%' }} value={ledgerEntityId} onChange={e => { setLedgerEntityId(e.target.value); setLedger(null); }}>
                    <option value="">— Select —</option>
                    {ledgerType === 'customer'
                      ? customers.map(c => <option key={c.id} value={c.id}>{customerLabel(c)}</option>)
                      : suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
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
                        <td>{new Date(row.date).toLocaleDateString()}</td>
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
                        <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Net</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Recovered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{new Date(row.date).toLocaleDateString()}</td>
                          <td className="mono">{row.invoice_no}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_amount) > 0 ? fmt(row.return_amount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.discount) > 0 ? fmt(row.discount) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.net_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.recovered_amount) > 0 ? fmt(row.recovered_amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.ret)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.disc)}</td>
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
                        <th>Customer</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Gross</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Recovered</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Return / Discount</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Net Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{new Date(row.date).toLocaleDateString()}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.recovered_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_discount) > 0 ? fmt(row.return_discount) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: parseFloat(row.net_pending) > 0 ? 'var(--amber)' : 'var(--green)' }}>
                            {fmt(row.net_pending)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(recTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.rec)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.rd)}</td>
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
    </Layout>
  );
}
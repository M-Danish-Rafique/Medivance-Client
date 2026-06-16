import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';

export default function Reports() {
  const [type, setType] = useState('customer'); // 'customer' | 'supplier'
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/customers'), api.get('/suppliers')])
      .then(([c, s]) => { setCustomers(c.data); setSuppliers(s.data); setDataLoading(false); })
      .catch(() => setDataLoading(false));
  }, []);

  const fetchLedger = async () => {
    if (!selectedId) return toast.error('Please select a customer or supplier');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type === 'customer') params.append('customer_id', selectedId);
      else params.append('supplier_id', selectedId);
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);

      const endpoint = type === 'customer' ? '/reports/customer-ledger' : '/reports/supplier-ledger';
      const r = await api.get(`${endpoint}?${params}`);
      setLedger(r.data);
    } catch (err) {
      toast.error('Error fetching ledger');
    } finally { setLoading(false); }
  };

  const downloadPDF = async () => {
    if (!selectedId) return toast.error('Please select a customer or supplier');
    const params = new URLSearchParams();
    if (type === 'customer') params.append('customer_id', selectedId);
    else params.append('supplier_id', selectedId);
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const endpoint = type === 'customer' ? 'customer-ledger' : 'supplier-ledger';

    try {
      const res = await api.get(`/reports/${endpoint}/pdf?${params}`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const entityName = (entity?.name || type).replace(/[^a-z0-9]+/gi, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-ledger-${entityName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Error downloading PDF');
    }
  };

  const fmt = formatCurrency;

  const entity = ledger?.customer || ledger?.supplier;
  const rows = ledger?.ledger || [];
  const ob = parseFloat(ledger?.openingBalance || 0);

  // running balance
  let runBal = ob;
  const rowsWithBalance = rows.map(r => {
    runBal += parseFloat(r.dr || 0) - parseFloat(r.cr || 0);
    return { ...r, _balance: runBal };
  });
  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1]._balance : ob;

  return (
    <Layout title="Ledger Reports">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Generate Ledger Report</div>
        </div>
        <div className="card-body">
          {/* Type selector */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {['customer', 'supplier'].map(t => (
              <button key={t} className={`btn ${type === t ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => { setType(t); setSelectedId(''); setLedger(null); }}>
                {t === 'customer' ? (
                  <><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>account_circle</span>Customer Ledger</>
                ) : (
                  <><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>local_shipping</span>Supplier Ledger</>
                )}
              </button>
            ))}
          </div>

          <div className="form-grid form-grid-4" style={{ alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{type === 'customer' ? 'Select Customer' : 'Select Supplier'} *</label>
              <select className="form-control" value={selectedId} onChange={e => { setSelectedId(e.target.value); setLedger(null); }}>
                <option value="">— Select —</option>
                {(type === 'customer' ? customers : suppliers).map(x => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">From Date</label>
              <input className="form-control" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">To Date</label>
              <input className="form-control" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={fetchLedger} disabled={loading || !selectedId}>
                {loading ? 'Loading...' : <><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>bar_chart</span>Generate</>}
              </button>
              {ledger && (
                <button className="btn btn-outline" onClick={downloadPDF}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>PDF
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {ledger && (
        <div className="card">
          {/* Entity info */}
          <div style={{ padding: '18px 22px', background: 'var(--blue-ultra)', borderBottom: '1px solid var(--blue-pale)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  {type === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'}
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>{entity?.name}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>
                  {entity?.phone && <span style={{ display: 'inline-flex', alignItems: 'center' }}><span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6 }}>phone</span>{entity.phone}</span>}
                  {entity?.address && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 12 }}><span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6 }}>place</span>{entity.address}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>Current Balance</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: finalBalance >= 0 ? 'var(--red)' : 'var(--green)' }}>
                  {formatCurrency(Math.abs(finalBalance))}
                  <span style={{ fontSize: 12, marginLeft: 6 }}>{finalBalance >= 0 ? 'Dr' : 'Cr'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Opening balance */}
          {ob !== 0 && (
            <div style={{ padding: '10px 22px', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                Opening Balance: {formatCurrency(Math.abs(ob))} {ob >= 0 ? 'Dr' : 'Cr'}
              </span>
              {fromDate && <span style={{ fontSize: 12, color: '#b45309', marginLeft: 8 }}>before {fromDate}</span>}
            </div>
          )}

          <div className="table-wrap">
            {rows.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>description</span></div><div className="empty-state-title">No transactions in selected period</div></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice No</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Dr (PKR)</th>
                    <th style={{ textAlign: 'right' }}>Cr (PKR)</th>
                    <th style={{ textAlign: 'right' }}>Balance (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithBalance.map((row, i) => (
                    <tr key={i}>
                      <td>{new Date(row.date).toLocaleDateString()}</td>
                      <td>{row.invoice_no ? <span className="mono badge badge-gray">{row.invoice_no}</span> : '—'}</td>
                      <td style={{ color: 'var(--gray-600)' }}>{row.description || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: parseFloat(row.dr) > 0 ? 700 : 400, color: parseFloat(row.dr) > 0 ? 'var(--red)' : 'var(--gray-400)' }}>
                        {parseFloat(row.dr) > 0 ? fmt(row.dr) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: parseFloat(row.cr) > 0 ? 700 : 400, color: parseFloat(row.cr) > 0 ? 'var(--green)' : 'var(--gray-400)' }}>
                        {parseFloat(row.cr) > 0 ? fmt(row.cr) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: row._balance >= 0 ? 'var(--red)' : 'var(--green)' }}>
                        {formatCurrency(Math.abs(row._balance))} {row._balance >= 0 ? 'Dr' : 'Cr'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--navy)', color: 'white' }}>
                    <td colSpan={3} style={{ padding: '12px 14px', fontWeight: 700 }}>TOTALS</td>
                    <td style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700, color: '#fca5a5' }}>
                      {fmt(rows.reduce((s, r) => s + parseFloat(r.dr || 0), 0))}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700, color: '#86efac' }}>
                      {fmt(rows.reduce((s, r) => s + parseFloat(r.cr || 0), 0))}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700 }}>
                      {formatCurrency(Math.abs(finalBalance))} {finalBalance >= 0 ? 'Dr' : 'Cr'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

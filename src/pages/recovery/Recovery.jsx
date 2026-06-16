import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const today = () => new Date().toISOString().split('T')[0];
const fmt = formatCurrency;

export default function Recovery() {
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

  const [modal, setModal] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleDetail, setSaleDetail] = useState(null);
  const [recoveryLines, setRecoveryLines] = useState([]);
  const [returnLines, setReturnLines] = useState([]);
  const [recHeader, setRecHeader] = useState({ date: today(), salesman_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('recovery');

  // Cross-invoice return state
  const [selectedReturnInvoiceId, setSelectedReturnInvoiceId] = useState('');
  const [returnInvoiceDetail, setReturnInvoiceDetail] = useState(null);
  const [loadingReturnInvoice, setLoadingReturnInvoice] = useState(false);
  const [crossReturnLines, setCrossReturnLines] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/sales'),
      api.get('/customers'),
      api.get('/employees?role=Salesman'),
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
    setSales(filtered);
  }, [filterCity, filterArea, filterTerritory, filterSalesman, filterCustomer, allSales, customers]);

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
      const retLines = (r.data.items || []).map(item => ({
        sale_item_id: item.id, sale_id: sale.id, product_id: item.product_id,
        batch_no: item.batch_no, qty_returned: '', return_rate: item.sale_rate, return_amount: 0,
        product_name: item.product_name, original_qty: item.qty, exp_date: item.exp_date
      }));
      setRecoveryLines(recLines);
      setReturnLines(retLines);
      setCrossReturnLines([]);
      setSelectedReturnInvoiceId('');
      setReturnInvoiceDetail(null);
      setRecHeader({ date: today(), salesman_id: sale.salesman_id || '', notes: '' });
      setActiveTab('recovery');
      setModal(true);
    } catch { toast.error('Error loading invoice'); }
  };

  /* ── Load cross-invoice return detail ── */
  const loadReturnInvoice = async (invoiceId) => {
    setSelectedReturnInvoiceId(invoiceId);
    if (!invoiceId) { setReturnInvoiceDetail(null); setCrossReturnLines([]); return; }
    setLoadingReturnInvoice(true);
    try {
      const r = await api.get(`/sales/${invoiceId}`);
      setReturnInvoiceDetail(r.data);
      setCrossReturnLines((r.data.items || []).map(item => ({
        sale_item_id: item.id, sale_id: parseInt(invoiceId), product_id: item.product_id,
        batch_no: item.batch_no, qty_returned: '', return_rate: item.sale_rate, return_amount: 0,
        product_name: item.product_name, original_qty: item.qty, exp_date: item.exp_date
      })));
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

  const totalDiscount = recoveryLines.reduce((s, l) => s + parseFloat(l.discount_given || 0), 0);
  const currentReturnAmt = returnLines.reduce((s, l) => s + parseFloat(l.return_amount || 0), 0);
  const crossReturnAmt = crossReturnLines.reduce((s, l) => s + parseFloat(l.return_amount || 0), 0);
  const totalReturnAmt = currentReturnAmt + crossReturnAmt;
  const invoiceTotal = saleDetail ? parseFloat(saleDetail.total_amount) : 0;
  const netCollected = invoiceTotal - totalDiscount - currentReturnAmt - crossReturnAmt;

  const handleSave = async () => {
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
    if (!validRecovery.length && !allReturns.length) {
      return toast.error('Enter at least one discount or return');
    }

    // Front-end expiry check: block if batch expiry is within 5 months
    for (const retLine of allReturns) {
      if (!parseInt(retLine.qty_returned)) continue;
      if (retLine.exp_date) {
        const expiry = new Date(retLine.exp_date);
        const threshold = new Date(expiry);
        threshold.setMonth(threshold.getMonth() - 5);
        if (new Date() > threshold) {
          return toast.error(
            `Return blocked for "${retLine.product_name}" (Batch: ${retLine.batch_no}): expires ${expiry.toLocaleDateString()} — within 5-month return window.`
          );
        }
      }
    }

    setSaving(true);
    try {
      await api.post('/recoveries', {
        sale_id: selectedSale.id,
        salesman_id: recHeader.salesman_id || null,
        date: recHeader.date, notes: recHeader.notes,
        recovery_items: validRecovery,
        return_items: allReturns,
      });
      toast.success('Recovery saved! Invoice locked. Payment recorded in ledger.');
      setModal(false); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving recovery');
    } finally { setSaving(false); }
  };

  const resetFilters = () => {
    setFilterCity(''); setFilterArea(''); setFilterTerritory('');
    setFilterSalesman(''); setFilterCustomer('');
  };

  /* ── Return items table ── */
  const ReturnTable = ({ lines, items, isCross }) => (
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
            // Expiry check: within 5 months = blocked
            let expiryBlocked = false;
            let expiryLabel = null;
            if (line.exp_date) {
              const expiry = new Date(line.exp_date);
              const threshold = new Date(expiry);
              threshold.setMonth(threshold.getMonth() - 5);
              expiryBlocked = new Date() > threshold;
              expiryLabel = expiry.toLocaleDateString();
            }
            return (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', marginBottom: 5, background: expiryBlocked ? '#fff7ed' : 'white', border: `1.5px solid ${expiryBlocked ? 'var(--amber)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{line.product_name}</div>
                <div>
                  <span className="mono badge badge-gray" style={{ fontSize: 11 }}>{line.batch_no || '—'}</span>
                  {expiryLabel && (
                    <div style={{ fontSize: 10, marginTop: 2, color: expiryBlocked ? 'var(--red)' : 'var(--gray-500)' }}>
                      {expiryBlocked ? '⛔ Return window expired' : `Exp: ${expiryLabel}`}
                    </div>
                  )}
                </div>
                <div style={{ color: 'var(--gray-600)' }}>{line.original_qty ?? '—'}</div>
                <input className="form-control" type="number" min="0" max={line.original_qty}
                  style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1 }}
                  placeholder="0" value={line.qty_returned} disabled={expiryBlocked}
                  onChange={e => updateReturnLine(idx, 'qty_returned', e.target.value, line, isCross)} />
                <input className="form-control" type="number" step="0.01"
                  style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1 }}
                  value={line.return_rate} disabled={expiryBlocked}
                  onChange={e => updateReturnLine(idx, 'return_rate', e.target.value, line, isCross)} />
                <div style={{ fontWeight: 700, color: retAmt > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>
                  {retAmt > 0 ? fmt(retAmt) : '—'}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );

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
              <select className="form-control" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
                <option value="">All Customers</option>
                {filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : sales.length === 0
            ? <div className="empty-state"><div className="empty-state-title">No invoices found</div></div>
            : (
              <table>
                <thead>
                  <tr><th>Invoice No</th><th>Date</th><th>Customer</th><th>Salesman</th><th>City / Area</th><th>Total</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {pagedSales.map(s => (
                    <tr key={s.id}>
                      <td className="mono">{s.invoice_no || '—'}</td>
                      <td>{new Date(s.date).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600 }}>{s.customer_name}</td>
                      <td>{s.salesman_name || '—'}</td>
                      <td>{[s.city_name, s.area_name].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(s.total_amount)}</td>
                      <td>
                        {s.is_locked
                          ? <span className="badge badge-amber">Recovered</span>
                          : <span className="badge badge-blue">Open</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s.is_locked
                          ? <span style={{ fontSize: 12, color: 'var(--gray-400)', padding: '5px 8px' }}>Locked</span>
                          : <button className="btn btn-primary btn-sm" onClick={() => openRecovery(s)}>Recovery / Return</button>}
                      </td>
                    </tr>
                  ))}
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
          <div className="flex items-center justify-between w-full">
            <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
              <div>Invoice: <strong>{fmt(invoiceTotal)}</strong></div>
              <div>Discount: <strong style={{ color: 'var(--amber)' }}>−{fmt(totalDiscount)}</strong></div>
              <div>Returns: <strong style={{ color: 'var(--amber)' }}>−{fmt(totalReturnAmt)}</strong></div>
              <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--gray-200)' }}>
                Net Collectible: <strong style={{ fontSize: 15, color: netCollected >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(Math.max(0, netCollected))}
                </strong>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
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
              <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Date</div><div style={{ fontWeight: 600 }}>{new Date(saleDetail.date).toLocaleDateString()}</div></div>
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
                <label className="form-label">Salesman</label>
                <select className="form-control" value={recHeader.salesman_id}
                  onChange={e => setRecHeader(p => ({ ...p, salesman_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Notes</label>
                <input className="form-control" placeholder="Optional notes" value={recHeader.notes}
                  onChange={e => setRecHeader(p => ({ ...p, notes: e.target.value }))} />
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
            </div>

            {activeTab === 'recovery' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                  <span>Product</span><span>Batch</span><span>Invoice Amt</span><span>Discount Given</span><span>Final Amount</span>
                </div>
                {(saleDetail.items || []).map((item, idx) => {
                  const line = recoveryLines[idx] || { discount_given: '' };
                  const finalAmt = parseFloat(item.total) - parseFloat(line.discount_given || 0);
                  return (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', marginBottom: 5, background: 'white', border: '1.5px solid var(--gray-200)', borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                      <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{item.batch_no || '—'}</span></div>
                      <div style={{ fontWeight: 700 }}>{fmt(item.total)}</div>
                      <input className="form-control" type="number" step="0.01" min="0" max={item.total}
                        style={{ fontSize: 12, padding: '5px 8px' }} placeholder="0.00"
                        value={line.discount_given}
                        onChange={e => updateRecoveryLine(idx, 'discount_given', e.target.value, item)} />
                      <div style={{ fontWeight: 700, color: finalAmt < 0 ? 'var(--red)' : 'var(--green)' }}>
                        {fmt(Math.max(0, finalAmt))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'return' && (
              <ReturnTable lines={returnLines} items={saleDetail.items} isCross={false} />
            )}

            {activeTab === 'cross-return' && (
              <div>
                <div className="alert alert-info" style={{ marginBottom: 14 }}>
                  Select a previous invoice to return products from it. If that invoice is unpaid, its qty and ledger will be updated. If it is locked (paid), the credit will be applied to the current invoice.
                </div>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Select Previous Invoice *</label>
                  <select className="form-control" style={{ maxWidth: 400 }}
                    value={selectedReturnInvoiceId}
                    onChange={e => loadReturnInvoice(e.target.value)}>
                    <option value="">— Select Invoice —</option>
                    {eligibleReturnInvoices.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.invoice_no} — {new Date(s.date).toLocaleDateString()} — {fmt(s.total_amount)}{s.is_locked ? ' (Locked)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {loadingReturnInvoice && <div className="loading-center"><div className="spinner" /></div>}
                {returnInvoiceDetail && !loadingReturnInvoice && (
                  <>
                    <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 12 }}>
                      Invoice <strong>{returnInvoiceDetail.invoice_no}</strong> — {fmt(returnInvoiceDetail.total_amount)}
                      {returnInvoiceDetail.is_locked && <span className="badge badge-amber" style={{ marginLeft: 8, fontSize: 10 }}>Locked — credit will apply to current invoice</span>}
                    </div>
                    <ReturnTable lines={crossReturnLines} items={returnInvoiceDetail.items} isCross={true} />
                  </>
                )}
              </div>
            )}

            {/* Net summary */}
            <div style={{
              marginTop: 18, padding: '12px 16px',
              background: netCollected >= 0 ? '#f0fdf4' : '#fef2f2',
              border: `1.5px solid ${netCollected >= 0 ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 3 }}>Net Amount to Collect + record in ledger</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: netCollected >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(Math.max(0, netCollected))}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--gray-500)' }}>
                <div>Invoice: <strong>{fmt(invoiceTotal)}</strong></div>
                <div>− Discounts: <strong style={{ color: 'var(--amber)' }}>{fmt(totalDiscount)}</strong></div>
                <div>− Returns: <strong style={{ color: 'var(--amber)' }}>{fmt(totalReturnAmt)}</strong></div>
              </div>
            </div>
            <div className="alert alert-warning" style={{ marginTop: 12 }}>
              <span style={{ fontWeight: 700, marginRight: 8 }}>Warning:</span>
              <span>After saving, this invoice will be <strong>locked</strong>. The net collectible amount will be recorded as payment received in the customer ledger.</span>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import DateInput from '../../components/common/DateInput';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import { HrStyles, Segmented, TableSkeleton, useSort, sortRows, fmtAmount, fmtDate, num } from '../hr/HrKit';
import { MfgStyles, Picker, NameWithTag, Rate, SortHead, fmtQty } from './mfgKit';
import { byQtyLabel } from './batchKit';

// ─── Yield: production output record ───────────────────────────────────────
// Read-only (brief section 3): one row per item a batch sent to inventory,
// packs and by-products alike. Sending happens on the Batches page.
// Filters: date range (this month by default), product, type, batch code.
// Every column sorts (newest sent first by default); the total row stays last.

const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const monthStart = () => `${todayPKT().slice(0, 8)}01`;
const byQtyAmount = (r) => (r.is_by_product && r.uom_symbol ? num(r.qty) * (num(r.volume) || 1) : num(r.qty));
const YIELD_SORT = {
  sent: { value: r => r.sent_at },
  batch_code: { value: r => r.batch_code, text: true },
  item: { value: r => `${r.product_name} ${r.pack_size || ''}`, text: true },
  type: { value: r => (r.is_by_product ? 'By-product' : 'Pack'), text: true },
  batch_no: { value: r => r.batch_no, text: true },
  expiry: { value: r => r.exp_date },
  qty: { value: byQtyAmount },
  cost: { value: r => num(r.cost_per_unit) },
  value: { value: r => num(r.value) },
};
const yieldOrder = (a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')) || b.id - a.id;

export default function Yields() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayPKT);
  const [productId, setProductId] = useState('');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [rangeError, setRangeError] = useState(null);
  const sort = useSort('sent', 'desc');

  useEffect(() => {
    Promise.all([api.get('/manufacturing/products'), api.get('/manufacturing/by-products')])
      .then(([p, b]) => setProducts([...p.data, ...b.data]))
      .catch(() => {});
  }, []);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!from || !to) return undefined;
    if (from > to) { setRangeError('The start date must be on or before the end date.'); return undefined; }
    setRangeError(null);
    let live = true;
    setRows(null);
    api.get('/manufacturing/yields', {
      params: { from, to, product_id: productId || undefined, type: type === 'all' ? undefined : type, q: query || undefined },
    }).then(r => { if (live) setRows(r.data.rows); })
      .catch(err => { if (live) { setRows([]); toast.error(err?.response?.data?.message || 'The production record could not be loaded.'); } });
    return () => { live = false; };
  }, [from, to, productId, type, query]);

  // Footer: quantity per unit ("126 units · 60 kg") and total value. A
  // by-product's quantity is in its unit (an unconverted "25 kg Bag" row counts
  // packs and adds qty × 25 kg).
  const totals = useMemo(() => {
    const perUnit = new Map();
    let value = 0;
    (rows || []).forEach(r => {
      const unit = r.is_by_product ? (r.uom_symbol || 'packs') : 'units';
      const amount = byQtyAmount(r);
      perUnit.set(unit, (perUnit.get(unit) || 0) + amount);
      value += num(r.value);
    });
    return { qty: [...perUnit.entries()].map(([u, q]) => fmtQty(q, u)).join(' · '), value };
  }, [rows]);
  const shown = useMemo(() => (rows ? sortRows(rows, sort.sortConfig, YIELD_SORT, yieldOrder) : rows), [rows, sort.sortConfig]);

  const productOptions = [
    { value: '', label: 'All products' },
    ...products.map(p => ({ value: p.id, label: `${p.name} · ${p.pack_size}`, hint: p.is_by_product ? 'By-product' : undefined })),
  ];

  return (
    <Layout title="Yield">
      <HrStyles />
      <MfgStyles />
      <div className="card">
        <div className="card-header">
          <div className="card-title">Production output</div>
        </div>
        <div className="mfg-filterbar">
          <div className="mfg-filters">
            <div className="mfg-filter-range">
              <DateInput aria-label="From date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ width: 136 }} />
              <span aria-hidden="true">to</span>
              <DateInput aria-label="To date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ width: 136 }} />
            </div>
            <div style={{ width: 180 }}>
              <Picker ariaLabel="Product" value={productId} options={productOptions} placeholder="All products"
                searchPlaceholder="All products" onChange={setProductId} />
            </div>
            <Segmented
              ariaLabel="Type"
              value={type}
              onChange={setType}
              options={[{ val: 'all', label: 'All' }, { val: 'pack', label: 'Packs' }, { val: 'by_product', label: 'By-products' }]}
            />
            <div className="search-bar">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input placeholder="Search batch code" aria-label="Search by batch code" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 140 }} />
            </div>
          </div>
        </div>

        {rangeError ? (
          <div className="hr-empty hr-empty-sm" role="alert">
            <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">date_range</span></div>
            <div className="hr-empty-title">{rangeError}</div>
          </div>
        ) : rows === null ? (
          <div style={{ padding: '8px 22px' }}><TableSkeleton columns={8} rows={5} /></div>
        ) : rows.length === 0 ? (
          <div className="hr-empty">
            <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">inventory_2</span></div>
            <div className="hr-empty-title">Nothing was sent to inventory in this period.</div>
          </div>
        ) : (
          <div className="hr-page-scroll">
            <table className="hr-table hr-page-table mfg-compact">
              <thead>
                <tr>
                  <SortHead sort={sort} column="sent" label="Date sent" date style={{ width: '10%' }} />
                  <SortHead sort={sort} column="batch_code" label="Batch code" style={{ width: '11%' }} />
                  <SortHead sort={sort} column="item" label="Item" />
                  <SortHead sort={sort} column="type" label="Type" style={{ width: '9%' }} />
                  <SortHead sort={sort} column="batch_no" label="Batch no." style={{ width: '12%' }} />
                  <SortHead sort={sort} column="expiry" label="Expiry" date style={{ width: '9%' }} />
                  <SortHead sort={sort} column="qty" label="Qty" title="Quantity" num style={{ width: '9%' }} />
                  <SortHead sort={sort} column="cost" label="Unit cost" title="Cost per unit" num style={{ width: '10%' }} />
                  <SortHead sort={sort} column="value" label="Value (PKR)" num style={{ width: '11%' }} />
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td style={tabular}>{fmtDate(String(r.sent_at || '').slice(0, 10))}</td>
                    <td style={tabular}><Link className="mfg-link" to={`/manufacturing/batches/${r.batch_id}`}>{r.batch_code}</Link></td>
                    <td><NameWithTag name={r.product_name} tag={r.pack_size} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.is_by_product ? 'By-product' : 'Pack'}</td>
                    <td style={tabular}>{r.batch_no}</td>
                    <td style={tabular}>{fmtDate(r.exp_date)}</td>
                    <td className="hr-num">{r.is_by_product ? byQtyLabel(r) : fmtQty(r.qty)}</td>
                    <td className="hr-num"><Rate value={r.cost_per_unit} /></td>
                    <td className="hr-num">{fmtAmount(r.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mfg-total-row">
                  <td colSpan={6}>{`Total · ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}</td>
                  <td colSpan={2} className="hr-num">{totals.qty}</td>
                  <td className="hr-num">{fmtAmount(totals.value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

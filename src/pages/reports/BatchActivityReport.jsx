import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { formatDatePKT } from '../../utils/dateUtils';
import {
  DateRangeFields, EmptyResult, FilterCard, ReportPlaceholder, Req, ResultHead, StatTiles,
  periodText, plural, qty, rangeError, safeName, useReport,
} from './reportUi';

// ─── Batch Activity ────────────────────────────────────────────────────────
// Where one batch of a product went: every invoice line from that batch with
// the units invoiced (incl. bonus), returned and kept. Dates are optional
// (blank = the batch's whole history). Expired and empty batches are listed
// too — auditing old batches is the point of the report.

const BATCH_INFO = (
  <>
    <p>Every invoice line that took units from the chosen batch, with the units invoiced (including bonus), returned, and kept by the customer. Leave the dates blank for the batch&rsquo;s whole history.</p>
    <p>Expired and empty batches are listed too, so old batches can be audited.</p>
  </>
);

export default function BatchActivityReport({ lookups }) {
  const { products } = lookups;
  const [productId, setProductId] = useState('');
  const [batches, setBatches] = useState([]);
  const [batchNo, setBatchNo] = useState('');
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const report = useReport('/reports/batch-activity', 'Error fetching Batch Activity report');

  useEffect(() => {
    setBatchNo('');
    if (!productId) { setBatches([]); return undefined; }
    let live = true;
    setBatchesLoading(true);
    api.get(`/inventory/product/${productId}`)
      .then(r => {
        if (!live) return;
        const list = Array.isArray(r.data) ? r.data.slice() : [];
        // Batches with stock first, then by expiry, latest first.
        list.sort((a, b) => {
          const aq = parseFloat(a.qty) || 0, bq = parseFloat(b.qty) || 0;
          if ((aq > 0) !== (bq > 0)) return aq > 0 ? -1 : 1;
          return String(b.exp_date || '').localeCompare(String(a.exp_date || ''));
        });
        setBatches(list);
      })
      .catch(() => { if (live) setBatches([]); })
      .finally(() => { if (live) setBatchesLoading(false); });
    return () => { live = false; };
  }, [productId]);

  const params = { product_id: productId, batch_no: batchNo, from_date: from, to_date: to };
  const generate = () => {
    if (!productId) return toast.error('Please select a product');
    if (!batchNo) return toast.error('Please select a batch');
    const err = rangeError(from, to, false);
    if (err) return toast.error(err);
    report.run(params);
  };

  const data = report.data;
  const rows = data?.rows || [];
  const totals = data?.totals || { gross_qty: 0, return_qty: 0, received_qty: 0 };
  const product = products.find(p => String(p.id) === String(report.params?.product_id));

  return (
    <>
      <FilterCard
        title="Batch Activity"
        description="Every invoice a batch went out on, with units invoiced, returned and kept by the customer."
        info={BATCH_INFO}
        onGenerate={generate}
        loading={report.loading}
        disabled={!productId || !batchNo}
      >
        <div className="form-group rp-f-wide">
          <label className="form-label">Product<Req /></label>
          <select className="form-control" value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.pack_size ? ` · ${p.pack_size}` : ''}</option>)}
          </select>
        </div>
        <div className="form-group rp-f-narrow">
          <label className="form-label">Batch<Req /></label>
          <select className="form-control" value={batchNo} disabled={!productId || batchesLoading}
            onChange={e => setBatchNo(e.target.value)}>
            <option value="">
              {!productId ? '— Pick a product first —'
                : batchesLoading ? 'Loading batches…'
                  : batches.length === 0 ? 'No batches found'
                    : '— Select batch —'}
            </option>
            {batches.map(b => (
              <option key={b.batch_no} value={b.batch_no}>
                {b.batch_no}  ·  qty {parseInt(b.qty, 10) || 0}{b.exp_date ? ` · exp ${formatDatePKT(b.exp_date)}` : ''}
              </option>
            ))}
          </select>
        </div>
        <DateRangeFields from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </FilterCard>

      {!data && <ReportPlaceholder loading={report.loading} icon="science" text="Choose a product and one of its batches, then select Generate report." />}
      {data && (
        <div className="card">
          <ResultHead
            onDownload={() => report.download(`batch-activity-${safeName(report.params?.batch_no)}.pdf`)}
            stale={!report.isCurrent(params)}
            onRefresh={productId && batchNo ? generate : undefined}
            refreshing={report.loading}
            title={`Batch ${report.params.batch_no}`}
            meta={[product ? `${product.name}${product.pack_size ? ` · ${product.pack_size}` : ''}` : null, periodText(report.params), plural(rows.length, 'invoice line')].filter(Boolean).join(' · ')}
          />
          {rows.length > 0 && (
            <StatTiles items={[
              { label: 'Invoiced (incl. bonus)', value: qty(totals.gross_qty) },
              { label: 'Returned', value: qty(totals.return_qty) },
              { label: 'Kept by customers', value: qty(totals.received_qty), strong: true },
            ]} />
          )}
          <div className="table-wrap">
            {rows.length === 0 ? (
              <EmptyResult title="No activity for this batch in the selected period" />
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th style={{ width: '5%' }}>Sr</th>
                    <th style={{ width: '10%' }}>Date</th>
                    <th style={{ width: '11%' }}>Invoice No</th>
                    <th>Customer</th>
                    <th style={{ width: '27%' }}>Ship-To Address</th>
                    <th className="num" style={{ width: '9%' }}>Gross Qty</th>
                    <th className="num" style={{ width: '9%' }}>Return Qty</th>
                    <th className="num" style={{ width: '10%' }}>Received Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.sale_id}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{formatDatePKT(row.date)}</td>
                      <td className="mono">{row.invoice_no}</td>
                      <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                      <td>{row.ship_to || '—'}</td>
                      <td className="num">{qty(row.gross_qty)}</td>
                      <td className="num">{row.return_qty > 0 ? qty(row.return_qty) : '—'}</td>
                      <td className="num strong">{qty(row.received_qty)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="report-tfoot-label">Total</td>
                    <td className="report-tfoot-num">{qty(totals.gross_qty)}</td>
                    <td className="report-tfoot-num">{qty(totals.return_qty)}</td>
                    <td className="report-tfoot-num">{qty(totals.received_qty)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
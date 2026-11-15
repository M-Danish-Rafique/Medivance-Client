import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';
import {
  DateRangeFields, EmptyResult, FilterCard, ReportPlaceholder, ResultHead, StatTiles,
  money, periodText, plural, rangeError, sumMoney, toPaisa, useReport,
} from './reportUi';

// ─── Recovery Report ───────────────────────────────────────────────────────
// Every recovery entry in the period (by recovery date): what the invoice
// still owed before it, the discount, returns and cash it settled, and what
// it left pending. An invoice recovered in several entries has several rows.

const RECOVERY_INFO = (
  <>
    <p>One row per recovery entry dated in the period. <b>Pending before</b> is what the invoice still owed just before the entry — its total less the discount, returns and cash of every earlier entry, including entries before the From date. <b>Pending after</b> is what it owed once the entry was recorded.</p>
    <p>An invoice recovered in several entries has several rows; the totals count each invoice once (pending before its first entry here, after its last). <b>Delivered by</b> keeps only invoices delivered by that supplier.</p>
  </>
);

export default function RecoveryReport({ lookups }) {
  const { deliveryStaff } = lookups;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplier, setSupplier] = useState('');
  const report = useReport('/reports/recovery-report', 'Error fetching recovery report');

  const params = { from_date: from, to_date: to, supplier_id: supplier };
  const generate = () => {
    const err = rangeError(from, to, false);
    if (err) return toast.error(err);
    report.run(params);
  };

  const rows = report.data?.rows || null;
  // Per invoice: pending before its first entry here, and after its last.
  // Adding every row's pending would count an invoice once per entry.
  let opening = 0, closing = 0, invoices = 0;
  if (rows) {
    const first = new Map(), last = new Map();
    rows.forEach(r => {
      if (!first.has(r.sale_id)) first.set(r.sale_id, r);
      last.set(r.sale_id, r);
    });
    invoices = first.size;
    opening = [...first.values()].reduce((s, r) => s + toPaisa(r.gross_amount), 0) / 100;
    closing = [...last.values()].reduce((s, r) => s + toPaisa(r.net_pending), 0) / 100;
  }
  const t = rows && {
    disc: sumMoney(rows, r => r.discount),
    ret: sumMoney(rows, r => r.return_amount),
    rec: sumMoney(rows, r => r.recovered_amount),
  };
  const supplierName = report.params?.supplier_id
    ? deliveryStaff.find(e => String(e.id) === String(report.params.supplier_id))?.name : null;

  return (
    <>
      <FilterCard
        title="Recovery Report"
        description="Every recovery entry in the period: cash collected, discounts, returns and what is still pending."
        info={RECOVERY_INFO}
        onGenerate={generate}
        loading={report.loading}
      >
        <DateRangeFields from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <div className="form-group">
          <label className="form-label">Delivered by</label>
          <select className="form-control" value={supplier} onChange={e => setSupplier(e.target.value)}>
            <option value="">All</option>
            {deliveryStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </FilterCard>

      {!rows && <ReportPlaceholder loading={report.loading} icon="account_balance_wallet" />}
      {rows && (
        <div className="card">
          <ResultHead
            onDownload={() => report.download('recovery-report.pdf')}
            stale={!report.isCurrent(params)}
            onRefresh={generate}
            refreshing={report.loading}
            title={`${plural(rows.length, 'recovery entry', 'recovery entries')} · ${plural(invoices, 'invoice')}`}
            meta={[periodText(report.params), supplierName && `Supplier: ${supplierName}`].filter(Boolean).join(' · ')}
          />
          {rows.length > 0 && (
            <StatTiles items={[
              { label: 'Pending before', value: money(opening), sub: 'on these invoices' },
              { label: 'Discount', value: money(t.disc) },
              { label: 'Returns', value: money(t.ret) },
              { label: 'Recovered', value: money(t.rec), tone: 'good', strong: true },
              { label: 'Still pending', value: money(closing), tone: closing > 0.005 ? 'warn' : undefined, sub: 'after these entries' },
            ]} />
          )}
          <div className="table-wrap">
            {rows.length === 0 ? (
              <EmptyResult title="No recoveries in the selected period" />
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th style={{ width: '5%' }}>Sr</th>
                    <th style={{ width: '10%' }}>Date</th>
                    <th style={{ width: '11%' }}>Invoice No</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: '12%' }}>Pending Before</th>
                    <th className="num" style={{ width: '10%' }}>Discount</th>
                    <th className="num" style={{ width: '10%' }}>Return</th>
                    <th className="num" style={{ width: '11%' }}>Recovered</th>
                    <th className="num" style={{ width: '12%' }}>Pending After</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.id}>
                      <td>{i + 1}</td>
                      <td>{formatDatePKT(row.date)}</td>
                      <td className="mono">{row.invoice_no}</td>
                      <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                      <td className="num">{money(row.gross_amount)}</td>
                      <td className="num">{parseFloat(row.discount) > 0 ? money(row.discount) : '—'}</td>
                      <td className="num">{parseFloat(row.return_amount) > 0 ? money(row.return_amount) : '—'}</td>
                      <td className="num">{money(row.recovered_amount)}</td>
                      <td className={`num strong ${parseFloat(row.net_pending) > 0.005 ? 'rp-warn' : ''}`}>{money(row.net_pending)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="report-tfoot-label">Total (pending per invoice)</td>
                    <td className="report-tfoot-num">{money(opening)}</td>
                    <td className="report-tfoot-num">{money(t.disc)}</td>
                    <td className="report-tfoot-num">{money(t.ret)}</td>
                    <td className="report-tfoot-num">{money(t.rec)}</td>
                    <td className="report-tfoot-num">{money(closing)}</td>
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

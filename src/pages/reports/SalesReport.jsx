import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';
import {
  DateRangeFields, EmptyResult, FilterCard, ReportPlaceholder, ResultHead, StatTiles,
  money, periodText, plural, rangeError, sumMoney, useReport,
} from './reportUi';

// ─── Sales Report ──────────────────────────────────────────────────────────
// Invoice by invoice for a period (by invoice date): gross, recovery-time
// discount, returns, net and what has been recovered so far.

const SALES_INFO = (
  <>
    <p>One row per invoice dated in the period. <b>Gross</b> is the invoice total. <b>Discount</b> and <b>Recovered</b> add up every recovery entry made on the invoice so far, and <b>Return</b> is the value of the units returned — whatever date those were recorded on.</p>
    <p>Net = Gross − Discount − Return.</p>
  </>
);

export default function SalesReport({ lookups }) {
  const { salesmen } = lookups;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [salesman, setSalesman] = useState('');
  const report = useReport('/reports/sales-report', 'Error fetching sales report');

  const params = { from_date: from, to_date: to, salesman_id: salesman };
  const generate = () => {
    const err = rangeError(from, to, false);
    if (err) return toast.error(err);
    report.run(params);
  };

  const rows = report.data?.rows || null;
  const t = rows && {
    gross: sumMoney(rows, r => r.gross_amount),
    disc: sumMoney(rows, r => r.discount),
    ret: sumMoney(rows, r => r.return_amount),
    net: sumMoney(rows, r => r.net_amount),
    rec: sumMoney(rows, r => r.recovered_amount),
  };
  const salesmanName = report.params?.salesman_id
    ? salesmen.find(e => String(e.id) === String(report.params.salesman_id))?.name : null;

  return (
    <>
      <FilterCard
        title="Sales Report"
        description="Every invoice in the period with its discounts, returns, net value and recoveries."
        info={SALES_INFO}
        onGenerate={generate}
        loading={report.loading}
      >
        <DateRangeFields from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <div className="form-group">
          <label className="form-label">Salesman</label>
          <select className="form-control" value={salesman} onChange={e => setSalesman(e.target.value)}>
            <option value="">All salesmen</option>
            {salesmen.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </FilterCard>

      {!rows && <ReportPlaceholder loading={report.loading} icon="sell" />}
      {rows && (
        <div className="card">
          <ResultHead
            onDownload={() => report.download('sales-report.pdf')}
            stale={!report.isCurrent(params)}
            onRefresh={generate}
            refreshing={report.loading}
            title={plural(rows.length, 'invoice')}
            meta={[periodText(report.params), salesmanName && `Salesman: ${salesmanName}`].filter(Boolean).join(' · ')}
          />
          {rows.length > 0 && (
            <StatTiles items={[
              { label: 'Gross', value: money(t.gross) },
              { label: 'Discount', value: money(t.disc) },
              { label: 'Returns', value: money(t.ret) },
              { label: 'Net sales', value: money(t.net), strong: true },
              { label: 'Recovered', value: money(t.rec), tone: 'good' },
              { label: 'Outstanding', value: money(Math.round((t.net - t.rec) * 100) / 100), tone: t.net - t.rec > 0.005 ? 'warn' : undefined },
            ]} />
          )}
          <div className="table-wrap">
            {rows.length === 0 ? (
              <EmptyResult title="No sales in the selected period" hint="Try a wider date range or another salesman." />
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th style={{ width: '5%' }}>Sr</th>
                    <th style={{ width: '10%' }}>Date</th>
                    <th style={{ width: '11%' }}>Invoice No</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: '11%' }}>Gross</th>
                    <th className="num" style={{ width: '10%' }}>Discount</th>
                    <th className="num" style={{ width: '10%' }}>Return</th>
                    <th className="num" style={{ width: '11%' }}>Net</th>
                    <th className="num" style={{ width: '11%' }}>Recovered</th>
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
                      <td className="num strong">{money(row.net_amount)}</td>
                      <td className="num">{parseFloat(row.recovered_amount) > 0 ? money(row.recovered_amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="report-tfoot-label">Total</td>
                    <td className="report-tfoot-num">{money(t.gross)}</td>
                    <td className="report-tfoot-num">{money(t.disc)}</td>
                    <td className="report-tfoot-num">{money(t.ret)}</td>
                    <td className="report-tfoot-num">{money(t.net)}</td>
                    <td className="report-tfoot-num">{money(t.rec)}</td>
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


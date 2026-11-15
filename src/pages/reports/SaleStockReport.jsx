import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  DateRangeFields, EmptyResult, FilterCard, MenuButton, ReportPlaceholder, ResultHead, StatTiles,
  money, monthToDate, periodText, plural, qty, rangeError, sumMoney, useReport,
} from './reportUi';

// ─── Sale & Stock ──────────────────────────────────────────────────────────
// Per product over the period: opening stock, purchases (incl. manufacturing
// yield), manual adjustments, gross sale, returns, net sale and closing
// stock. Closing = Opening + Purchase + Adjustment − Gross Sale + Return.
// Dates are required — an open range would make the opening meaningless.
// Purchase / Adjustment columns are hidden by default; the ⚙ menu shows them
// separately or combined, and the PDF follows the same choice.

const STOCK_COLUMN_OPTIONS = [
  { key: 'split', title: 'Show Purchase and Adjustment separately', description: 'Dedicated Purchase and Adjustment columns.' },
  { key: 'combined', title: 'Show Purchase and Adjustment combined', description: 'One merged Purchase + Adjustment column.' },
];

const STOCK_INFO = (
  <>
    <p>For each product: <b>Closing = Opening + Purchase + Adjustment − Gross sale + Return</b>. Purchase includes manufactured units added to stock; gross sale includes bonus units. Sales count by invoice date, returns by return date.</p>
    <p>Purchase and Adjustment columns are hidden at first — show them, separately or combined, from the column menu on the results. The PDF follows the same choice.</p>
  </>
);

const blankIfZero = (n) => (n === 0 ? '—' : qty(n));

export default function SaleStockReport({ lookups }) {
  const { companies } = lookups;
  const initial = monthToDate();
  const [company, setCompany] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [mode, setMode] = useState('none');
  const report = useReport('/reports/sale-stock-report', 'Error fetching Sale & Stock report');

  const params = { from_date: from, to_date: to, company_id: company };
  const generate = () => {
    const err = rangeError(from, to, true);
    if (err) return toast.error(err);
    report.run(params);
  };

  const rows = report.data?.rows || null;
  const t = (rows || []).reduce((a, r) => ({
    opening: a.opening + (r.opening_stock || 0),
    purchase: a.purchase + (r.purchase_qty || 0),
    adjust: a.adjust + (r.adjustment_qty || 0),
    gross: a.gross + (r.gross_qty || 0),
    ret: a.ret + (r.return_qty || 0),
    netU: a.netU + (r.net_sale_unit || 0),
    closing: a.closing + (r.closing_stock || 0),
  }), { opening: 0, purchase: 0, adjust: 0, gross: 0, ret: 0, netU: 0, closing: 0 });
  const netValue = rows ? sumMoney(rows, r => r.net_sale_value) : 0;
  const negatives = (rows || []).filter(r => r.closing_stock < 0 || r.opening_stock < 0).length;
  const companyName = report.params?.company_id
    ? companies.find(c => String(c.id) === String(report.params.company_id))?.name : null;
  const split = mode === 'split';
  const combined = mode === 'combined';

  return (
    <>
      <FilterCard
        title="Sale & Stock"
        description="Opening stock, stock in, sales, returns and closing stock for each product."
        info={STOCK_INFO}
        onGenerate={generate}
        loading={report.loading}
        disabled={!from || !to}
      >
        <DateRangeFields required from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <div className="form-group">
          <label className="form-label">Company</label>
          <select className="form-control" value={company} onChange={e => setCompany(e.target.value)}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </FilterCard>

      {!rows && <ReportPlaceholder loading={report.loading} icon="inventory_2" />}
      {rows && (
        <div className="card">
          <ResultHead
            onDownload={() => report.download('sale-stock-report.pdf', { stock_mode: mode })}
            stale={!report.isCurrent(params)}
            onRefresh={generate}
            refreshing={report.loading}
            title={plural(rows.length, 'product')}
            meta={[periodText(report.params), companyName].filter(Boolean).join(' · ')}
          >
            <MenuButton icon="tune" label="Purchase and Adjustment columns" minWidth={320}>
              <div className="rp-menu-title">PURCHASE &amp; ADJUSTMENT COLUMNS</div>
              {STOCK_COLUMN_OPTIONS.map(opt => (
                <label key={opt.key} className="rp-menu-item">
                  <input type="checkbox" checked={mode === opt.key}
                    onChange={() => setMode(prev => (prev === opt.key ? 'none' : opt.key))} />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{opt.title}</div>
                    <div className="rp-menu-sub">{opt.description}</div>
                  </div>
                </label>
              ))}
            </MenuButton>
          </ResultHead>
          {rows.length > 0 && (
            <StatTiles items={[
              { label: 'Opening', value: qty(t.opening) },
              { label: 'Stock in', value: qty(t.purchase + t.adjust), sub: t.adjust ? `incl. ${qty(t.adjust)} adjustment` : 'purchase + manufacturing' },
              { label: 'Net sale (units)', value: qty(t.netU), sub: `${qty(t.gross)} sold · ${qty(t.ret)} returned` },
              { label: 'Net sale (value)', value: money(netValue), strong: true },
              { label: 'Closing', value: qty(t.closing), tone: negatives ? 'warn' : undefined, sub: negatives ? `${plural(negatives, 'product')} below zero` : undefined },
            ]} />
          )}
          <div className="table-wrap">
            {rows.length === 0 ? (
              <EmptyResult title="No product activity in the selected period" hint="Try widening the date range or clearing the company filter." />
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>Sr</th>
                    <th>Product</th>
                    <th style={{ width: '8%' }}>Pack Size</th>
                    <th className="num" style={{ width: '7%' }}>Opening</th>
                    {split && <th className="num" style={{ width: '7%' }}>Purchase</th>}
                    {split && <th className="num" style={{ width: '8%' }}>Adjustment</th>}
                    {combined && <th className="num" style={{ width: '8%' }}>Pur. / Adj.</th>}
                    <th className="num" style={{ width: '8%' }}>Gross Sale</th>
                    <th className="num" style={{ width: '6%' }}>Return</th>
                    <th className="num" style={{ width: '9%' }}>Net Sale (Unit)</th>
                    <th className="num" style={{ width: '11%' }}>Net Sale (Value)</th>
                    <th className="num" style={{ width: '7%' }}>Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const adj = row.adjustment_qty || 0;
                    const pur = row.purchase_qty || 0;
                    return (
                      <tr key={row.product_id}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{row.product_name}</td>
                        <td className="muted">{row.pack_size || '—'}</td>
                        <td className={`num${row.opening_stock < 0 ? ' rp-warn' : ''}`}>{qty(row.opening_stock)}</td>
                        {split && <td className="num">{blankIfZero(pur)}</td>}
                        {split && <td className={`num${adj < 0 ? ' rp-warn' : ''}`}>{blankIfZero(adj)}</td>}
                        {combined && <td className={`num${pur + adj < 0 ? ' rp-warn' : ''}`} title={`Purchase ${pur} + Adjustment ${adj}`}>{blankIfZero(pur + adj)}</td>}
                        <td className="num">{blankIfZero(row.gross_qty)}</td>
                        <td className="num">{blankIfZero(row.return_qty)}</td>
                        <td className="num strong">{qty(row.net_sale_unit)}</td>
                        <td className="num strong">{money(row.net_sale_value)}</td>
                        <td className={`num strong${row.closing_stock < 0 ? ' rp-warn' : ''}`}
                          title={row.closing_stock < 0 ? 'Negative closing stock — data integrity check needed' : undefined}>
                          {qty(row.closing_stock)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="report-tfoot-label">Total</td>
                    <td className="report-tfoot-num">{qty(t.opening)}</td>
                    {split && <td className="report-tfoot-num">{qty(t.purchase)}</td>}
                    {split && <td className="report-tfoot-num">{blankIfZero(t.adjust)}</td>}
                    {combined && <td className="report-tfoot-num">{blankIfZero(t.purchase + t.adjust)}</td>}
                    <td className="report-tfoot-num">{qty(t.gross)}</td>
                    <td className="report-tfoot-num">{qty(t.ret)}</td>
                    <td className="report-tfoot-num">{qty(t.netU)}</td>
                    <td className="report-tfoot-num">{money(netValue)}</td>
                    <td className="report-tfoot-num">{qty(t.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <div className="rp-note">
            Closing = Opening + Purchase + Adjustment − Gross Sale + Return. Purchase includes manufactured units added to stock; gross sale includes bonus units.
            Sales count by invoice date, returns by return date.
          </div>
        </div>
      )}
    </>
  );
}

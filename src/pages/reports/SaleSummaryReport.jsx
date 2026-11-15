import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  DateRangeFields, EmptyResult, FilterCard, MenuButton, ReportPlaceholder, Req, ResultHead, SearchableMultiSelect, StatTiles,
  money, periodText, plural, rangeError, toPaisa, useReport,
} from './reportUi';

// ─── Sale Summary (layered) ────────────────────────────────────────────────
// Sales grouped by up to four levels of Salesman / Company / Product /
// Customer, by invoice date. Each level can be narrowed to chosen entries.
// The value columns are chosen from the ⋮ menu; the PDF prints the same ones.

const ENTITY_OPTIONS = [
  { key: 'salesman', label: 'Salesman' },
  { key: 'company', label: 'Company' },
  { key: 'product', label: 'Product' },
  { key: 'customer', label: 'Customer' },
];
const ENTITY_PLURAL = { salesman: 'salesmen', company: 'companies', product: 'products', customer: 'customers' };
const FILTER_PARAM = { salesman: 'salesman_ids', company: 'company_ids', product: 'product_ids', customer: 'customer_ids' };

const VALUE_COLUMNS = [
  { key: 'gross_qty', label: 'Gross Qty', type: 'qty', read: r => parseInt(r.gross_qty, 10) || 0 },
  { key: 'ret_qty', label: 'Ret Qty', type: 'qty', read: r => parseInt(r.return_qty, 10) || 0 },
  { key: 'net_qty', label: 'Net Qty', type: 'qty', read: r => parseInt(r.net_qty, 10) || 0 },
  { key: 'gross', label: 'Gross Sale', type: 'money', read: r => toPaisa(r.gross_amount) },
  { key: 'disc', label: 'Discount', type: 'money', read: r => toPaisa(r.discount) },
  { key: 'ret', label: 'Return', type: 'money', read: r => toPaisa(r.return_amount) },
  { key: 'net', label: 'Net Sale', type: 'money', read: r => toPaisa(r.net_amount) },
  { key: 'rec', label: 'Recovered', type: 'money', read: r => toPaisa(r.recovered_amount) },
];
const DEFAULT_VISIBLE = { gross_qty: false, ret_qty: false, net_qty: true, gross: true, disc: true, ret: true, net: true, rec: true };
const zero = () => Object.fromEntries(VALUE_COLUMNS.map(c => [c.key, 0]));

/** Money values are kept in paisa while adding up; shown in rupees. */
function formatValue(key, type, v) {
  if (type === 'qty') return v > 0 ? v.toLocaleString('en-PK') : (key === 'net_qty' ? String(v) : '—');
  if ((key === 'disc' || key === 'ret' || key === 'rec') && v <= 0) return '—';
  return money(v / 100);
}

// Which layer cells start a merged block (rowSpan) in the already-sorted rows.
function buildSpans(rows, nLayers) {
  const key = (row, i) => Array.from({ length: i + 1 }, (_, k) => row[`layer${k + 1}`] || '').join('␟');
  return rows.map((row, r) => Array.from({ length: nLayers }, (_, i) => {
    const isStart = r === 0 || key(row, i) !== key(rows[r - 1], i);
    if (!isStart) return { show: false, span: 0 };
    let span = 1;
    while (r + span < rows.length && key(rows[r + span], i) === key(row, i)) span++;
    return { show: true, span };
  }));
}
const VLINE = { borderRight: '1px solid var(--gray-300, #d7dee6)' };

const SUMMARY_INFO = (
  <>
    <p>Sales by invoice date, grouped by up to four levels of salesman, company, product and customer — for example Salesman, then Product. The filter under each level narrows it to the entries you choose.</p>
    <p>Pick the value columns from the menu on the results; the PDF prints the same columns.</p>
  </>
);

export default function SaleSummaryReport({ lookups }) {
  const { salesmen, companies, products, customers } = lookups;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [layers, setLayers] = useState([]);
  const [filters, setFilters] = useState({});
  const [visible, setVisible] = useState(DEFAULT_VISIBLE);
  const report = useReport('/reports/sale-summary', 'Error fetching sale summary');

  // Keep only the filters of the levels still chosen.
  useEffect(() => {
    setFilters(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => layers.includes(k))));
  }, [layers]);

  const setLayerAt = (index, key) => {
    setLayers(prev => {
      const next = prev.slice(0, index);
      if (key) next.push(key);
      return next;
    });
  };

  const params = () => {
    const p = { from_date: from, to_date: to, layers: layers.join(',') };
    layers.forEach(l => { if ((filters[l] || []).length) p[FILTER_PARAM[l]] = filters[l].join(','); });
    return p;
  };

  const generate = () => {
    if (layers.length === 0) return toast.error('Please select at least Layer 1');
    const err = rangeError(from, to, false);
    if (err) return toast.error(err);
    report.run(params());
  };
  // Results stay on screen when the filters change, marked "Filters changed".
  const stale = !!report.data && (layers.length === 0 || !report.isCurrent(params()));

  const shownColumns = VALUE_COLUMNS.filter(c => visible[c.key] !== false);
  const data = report.data;
  const rows = data?.rows || [];
  const layerLabels = data?.layers?.map(l => l.label) || [];
  const nLayers = layerLabels.length;
  const maxColumns = Math.max(0, 10 - nLayers);

  const download = () => {
    if (shownColumns.length === 0) return toast.error('Please select at least one value column for PDF.');
    if (shownColumns.length > maxColumns) {
      return toast.error(`With ${nLayers} tier${nLayers !== 1 ? 's' : ''}, you can select only ${maxColumns} value column${maxColumns !== 1 ? 's' : ''}.`);
    }
    report.download('sale-summary-report.pdf', { value_cols: shownColumns.map(c => c.key).join(',') });
  };

  const totals = zero();
  rows.forEach(r => VALUE_COLUMNS.forEach(c => { totals[c.key] += c.read(r); }));

  const optionsFor = (layerKey) => (
    layerKey === 'salesman' ? salesmen.map(e => ({ value: String(e.id), label: e.name }))
      : layerKey === 'company' ? companies.map(c => ({ value: String(c.id), label: c.name }))
        : layerKey === 'product' ? products.map(p => ({ value: String(p.id), label: `${p.name}${p.pack_size ? ` · ${p.pack_size}` : ''}` }))
          : customers.map(c => ({ value: String(c.id), label: c.name }))
  );

  return (
    <>
      <FilterCard
        title="Sale Summary"
        description="Sales grouped by up to four levels — salesman, company, product or customer."
        info={SUMMARY_INFO}
        onGenerate={generate}
        loading={report.loading}
        disabled={layers.length === 0}
      >
        <DateRangeFields from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="rp-fields-break" />
        {/* Four grouping levels side by side; each chosen level gets its own
            "only these" filter under it. A level opens once the one before is set. */}
        <div className="rp-levels" role="group" aria-label="Grouping">
          {[0, 1, 2, 3].map(idx => {
            const used = layers.slice(0, idx);
            const key = layers[idx] || '';
            const open = idx === 0 || layers.length >= idx;
            return (
              <div className={`rp-level${key ? ' is-set' : ''}`} key={idx}>
                <label className="form-label" htmlFor={`rp-level-${idx}`}>
                  <span className="rp-level-no" aria-hidden="true">{idx + 1}</span>
                  {idx === 0 ? <>Group by<Req /></> : 'Then by'}
                </label>
                <select id={`rp-level-${idx}`} className="form-control" value={key} disabled={!open}
                  onChange={e => setLayerAt(idx, e.target.value)}>
                  <option value="">{idx === 0 ? '— Select —' : '— None —'}</option>
                  {ENTITY_OPTIONS.filter(o => !used.includes(o.key)).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                {key && (
                  <div className="rp-level-filter">
                    <SearchableMultiSelect
                      icon="filter_alt"
                      allLabel={`All ${ENTITY_PLURAL[key]}`}
                      options={optionsFor(key)}
                      value={filters[key] || []}
                      onChange={(ids) => setFilters(prev => ({ ...prev, [key]: ids }))}
                      placeholder={`Search ${ENTITY_PLURAL[key]}…`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </FilterCard>

      {!data && <ReportPlaceholder loading={report.loading} icon="layers" text="Choose what to group by, then select Generate report." />}
      {data && (() => {
        const spans = buildSpans(rows, nLayers);
        let running = zero();
        return (
          <div className="card">
            <ResultHead
              onDownload={download}
              stale={stale}
              onRefresh={layers.length ? generate : undefined}
              refreshing={report.loading}
              title={plural(rows.length, 'group')}
              meta={`${periodText(report.params)} · Grouped by ${layerLabels.join(' › ')}`}
            >
              <MenuButton label="Value columns">
                <div className="rp-menu-title">VALUE COLUMNS</div>
                {VALUE_COLUMNS.map(col => (
                  <label key={col.key} className="rp-menu-item">
                    <input type="checkbox" checked={visible[col.key] !== false}
                      onChange={() => setVisible(prev => ({ ...prev, [col.key]: !prev[col.key] }))} />
                    <span style={{ flex: 1 }}>{col.label}</span>
                  </label>
                ))}
                <div className="rp-menu-foot">
                  <button type="button" className="rp-link-btn" onClick={() => setVisible(DEFAULT_VISIBLE)}>Reset to default</button>
                </div>
              </MenuButton>
            </ResultHead>
            {rows.length > 0 && (
              <StatTiles items={[
                { label: 'Net qty', value: totals.net_qty.toLocaleString('en-PK') },
                { label: 'Gross sale', value: money(totals.gross / 100) },
                { label: 'Discount', value: money(totals.disc / 100) },
                { label: 'Returns', value: money(totals.ret / 100) },
                { label: 'Net sale', value: money(totals.net / 100), strong: true },
                { label: 'Recovered', value: money(totals.rec / 100), tone: 'good' },
              ]} />
            )}
            <div className="table-wrap">
              {rows.length === 0 ? (
                <EmptyResult title="No sales in the selected period" />
              ) : (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th style={{ width: '4%' }}>Sr</th>
                      {layerLabels.map((lbl, i) => <th key={i}>{lbl}</th>)}
                      {shownColumns.map(col => <th key={col.key} className="num" style={{ width: '10%' }}>{col.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, r) => {
                      const values = Object.fromEntries(VALUE_COLUMNS.map(c => [c.key, c.read(row)]));
                      VALUE_COLUMNS.forEach(c => { running[c.key] += values[c.key]; });
                      const isLast = r === rows.length - 1;
                      const layer1Ends = nLayers > 1 && (isLast || (row.layer1 || '') !== (rows[r + 1].layer1 || ''));
                      const subtotal = layer1Ends ? running : null;
                      if (layer1Ends) running = zero();
                      return (
                        <React.Fragment key={r}>
                          <tr>
                            <td style={{ verticalAlign: 'top', ...(nLayers > 1 ? VLINE : null) }}>{r + 1}</td>
                            {Array.from({ length: nLayers }, (_, li) => (spans[r][li].show ? (
                              <td key={li} rowSpan={spans[r][li].span}
                                style={{ verticalAlign: 'top', fontWeight: li === 0 ? 600 : undefined, ...(nLayers > 1 && li + 1 < nLayers ? VLINE : null) }}>
                                {row[`layer${li + 1}`] || '—'}
                              </td>
                            ) : null))}
                            {shownColumns.map(col => (
                              <td key={col.key} className={`num${col.key === 'net' || col.key === 'net_qty' ? ' strong' : ''}`} style={{ verticalAlign: 'top' }}>
                                {formatValue(col.key, col.type, values[col.key])}
                              </td>
                            ))}
                          </tr>
                          {subtotal && (
                            <tr className="rp-subtotal">
                              <td colSpan={1 + nLayers}>{row.layer1 ? `Subtotal — ${row.layer1}` : 'Subtotal'}</td>
                              {shownColumns.map(col => (
                                <td key={col.key} className="num">{formatValue(col.key, col.type, subtotal[col.key])}</td>
                              ))}
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={1 + nLayers} className="report-tfoot-label">Grand Total</td>
                      {shownColumns.map(col => (
                        <td key={col.key} className="report-tfoot-num">{formatValue(col.key, col.type, totals[col.key])}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}

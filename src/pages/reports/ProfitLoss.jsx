import React, { useRef, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';
import {
  DateRangeFields, EmptyResult, FilterCard, ReportPlaceholder, ResultHead, SearchableMultiSelect, Segmented, SidePanel, StatTiles,
  apiMessage, monthToDate, plural, rangeError, stampPKT, toPaisa, useReport,
} from './reportUi';

// ─── Profit & Loss ─────────────────────────────────────────────────────────
// One tab for profitability, three views over the same From – To range:
//
//   Statement    the whole company's statement of profit or loss, as an
//                accountant lays it out: Revenue (gross sales less trade
//                discounts, returns, discounts allowed on recovery and sales
//                tax) → Net sales; Cost of sales; Gross profit; Operating
//                expenses by expense type; Net profit.
//   By Company   the statement's Net sales, Cost of sales and Gross profit
//   By Salesman  split by the product's company / the invoice's salesman.
//                Same per-line figures, so the rows add up to the statement.
//                Expenses are not shared out, so these stop at gross profit.
//
// Drill-downs open in a panel on the right, next to the statement:
//   • a statement line → the invoices or expense entries behind it (their
//     total equals the line);
//   • the checks status in the statement header → the checks (what needs
//     attention first, then what passed); a check steps into its invoices,
//     with Back to return to the list.
//
// Every figure is worked out on the server (server/utils/profitLoss.js,
// authoritative); this screen only shows it.

/** 1,234.50 — always two decimals. */
const amt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Deductions and negative figures in brackets. */
const shown = (n, bracket) => (bracket || Number(n) < 0 ? `(${amt(Math.abs(Number(n)))})` : amt(n));
const pctText = (p) => (p === null || p === undefined ? '' : `${p.toFixed(1)}%`);

// The invoice columns a drill-down can show.
const INVOICE_COLUMNS = {
  gross_sales: 'Gross sales',
  trade_discounts: 'Trade discounts',
  sales_returns: 'Sales returns',
  recovery_discounts: 'Recovery discounts',
  sales_tax: 'Sales tax',
  net_sales: 'Net sales',
  cost_of_sales: 'Cost of sales',
  gross_profit: 'Gross profit',
  line_tax: 'Invoice Tax % amount',
  late_activity: 'Recorded after period',
  problem: 'What disagrees',
};
const TEXT_COLUMNS = new Set(['problem']);
// What each statement line (or check) opens: its title, the columns, and the
// column an invoice must have a non-zero figure in to be listed.
const INVOICE_DETAILS = {
  gross_sales:        { title: 'Gross sales', columns: ['gross_sales'], nonZero: 'gross_sales' },
  trade_discounts:    { title: 'Trade discounts', columns: ['gross_sales', 'trade_discounts'], nonZero: 'trade_discounts' },
  sales_returns:      { title: 'Sales returns', columns: ['sales_returns'], nonZero: 'sales_returns' },
  recovery_discounts: { title: 'Discounts allowed on recovery', columns: ['recovery_discounts'], nonZero: 'recovery_discounts' },
  sales_tax:          { title: 'Sales tax', columns: ['sales_tax'], nonZero: 'sales_tax' },
  net_sales:          { title: 'Net sales', columns: ['gross_sales', 'trade_discounts', 'sales_returns', 'recovery_discounts', 'sales_tax', 'net_sales'] },
  cost_of_sales:      { title: 'Cost of sales', columns: ['net_sales', 'cost_of_sales', 'gross_profit'] },
  gross_profit:       { title: 'Gross profit by invoice', columns: ['net_sales', 'cost_of_sales', 'gross_profit'] },
  missing_cost:       { title: 'Invoices with lines that have no cost', columns: ['net_sales', 'cost_of_sales', 'gross_profit'], only: 'missing_cost' },
  line_tax:           { title: 'Invoices using the invoice Tax % field', columns: ['gross_sales', 'line_tax'], only: 'line_tax' },
  late:               { title: 'Recorded after the period ended', columns: ['sales_returns', 'recovery_discounts', 'late_activity'], only: 'late' },
  records:            { title: 'Invoices whose records disagree', columns: ['gross_sales', 'sales_returns', 'net_sales', 'problem'], only: 'records' },
};

export const PROFIT_VIEWS = [
  { key: 'statement', label: 'Statement', icon: 'receipt_long' },
  { key: 'company', label: 'By Company', icon: 'domain' },
  { key: 'salesman', label: 'By Salesman', icon: 'badge' },
];

const STATEMENT_INFO = (
  <>
    <p>Sales are taken by <b>invoice date</b>. Returns and recovery-time discounts on those invoices count in the same period, whenever they were recorded — so a past period can change when a later return is recorded (the checks show how much).</p>
    <p>Sales tax is each product&rsquo;s tax % on the units the customer kept. Cost of sales uses the purchase cost frozen on each invoice line when it was sold. Operating expenses are Finance → Expense entries by their date, one line per expense type.</p>
    <p>Payments to suppliers and from customers are cash movements, not income or cost, and are left out.</p>
  </>
);
const SEGMENT_INFO = (
  <>
    <p>The statement&rsquo;s Net sales, Cost of sales and Gross profit, split by the <b>company of the product sold</b> or the <b>salesman of the invoice</b>. With nothing selected the totals equal the statement for the same dates.</p>
    <p>Operating expenses are not shared out between companies or salesmen, so this view stops at gross profit. Margin is gross profit as a % of the row&rsquo;s net sales; Share is the row&rsquo;s net sales as a % of the whole company&rsquo;s.</p>
  </>
);

export default function ProfitLoss({ lookups, view, onViewChange }) {
  const { companies, salesmen } = lookups;
  const initial = monthToDate();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [entityIds, setEntityIds] = useState([]);
  const statement = useReport('/reports/profit-loss', 'The Profit & Loss report could not be produced. Try again.');
  const segments = useReport('/reports/profit-loss/segments', 'The report could not be produced. Try again.');
  const isStatement = view === 'statement';
  const active = isStatement ? statement : segments;

  const paramsFor = (v, f, t, ids) => (v === 'statement'
    ? { from_date: f, to_date: t }
    : { from_date: f, to_date: t, group_by: v, entity_ids: ids.join(',') });

  const runView = (v, f, t, ids) => {
    const err = rangeError(f, t, true);
    if (err) { toast.error(err); return; }
    (v === 'statement' ? statement : segments).run(paramsFor(v, f, t, ids));
  };
  const generate = () => runView(view, from, to, entityIds);

  // Switching view keeps the dates; if a report is already on screen, the
  // new view is produced straight away for the same range.
  const changeView = (v) => {
    if (v === view) return;
    const hasReport = !!(statement.data || segments.data);
    setEntityIds([]);
    if (v !== 'statement') segments.clear();
    onViewChange(v);
    if (hasReport) runView(v, from, to, []);
  };

  const options = view === 'company'
    ? companies.map(c => ({ value: String(c.id), label: c.name }))
    : salesmen.map(e => ({ value: String(e.id), label: e.name }));

  const download = () => {
    const p = active.params;
    active.download(isStatement
      ? `profit-and-loss-${p.from_date}-to-${p.to_date}.pdf`
      : `gross-profit-by-${p.group_by}-${p.from_date}-to-${p.to_date}.pdf`);
  };
  const head = {
    onDownload: download,
    stale: !!active.data && !active.isCurrent(paramsFor(view, from, to, entityIds)),
    onRefresh: generate,
    refreshing: active.loading,
  };

  return (
    <>
      <FilterCard
        title="Profit & Loss"
        description={isStatement
          ? 'Statement of profit or loss for the whole company.'
          : `Net sales, cost of sales and gross profit by ${view === 'company' ? 'company' : 'salesman'} — the statement's figures, split.`}
        info={isStatement ? STATEMENT_INFO : SEGMENT_INFO}
        toolbar={<Segmented value={view} onChange={changeView} options={PROFIT_VIEWS} ariaLabel="Profit & Loss view" />}
        onGenerate={generate}
        loading={active.loading}
        disabled={!from || !to}
      >
        <DateRangeFields required from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {!isStatement && (
          <div className="form-group rp-f-wide">
            <label className="form-label">{view === 'company' ? 'Companies' : 'Salesmen'}</label>
            <SearchableMultiSelect
              icon="filter_alt"
              allLabel={view === 'company' ? 'All companies' : 'All salesmen'}
              options={options}
              value={entityIds}
              onChange={setEntityIds}
              placeholder={`Search ${view === 'company' ? 'company' : 'salesman'}…`}
            />
          </div>
        )}
      </FilterCard>

      {isStatement && (statement.data
        ? <Statement data={statement.data} head={head} onShowBreakdown={changeView} />
        : <ReportPlaceholder loading={statement.loading} icon="receipt_long" />)}
      {!isStatement && (segments.data
        ? <Segments data={segments.data} head={head} />
        : <ReportPlaceholder loading={segments.loading} icon={view === 'company' ? 'domain' : 'badge'} />)}
      <style dangerouslySetInnerHTML={{ __html: PL_STYLES }} />
    </>
  );
}

// ── Statement view ─────────────────────────────────────────────────────────
function Row({ kind, label, amount, pct, bracket, onOpen, title }) {
  const clickable = !!onOpen;
  return (
    <tr
      className={`pl-row is-${kind}${clickable ? ' is-link' : ''}`}
      onClick={onOpen}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }) : undefined}
      title={clickable ? (title || 'Show the entries behind this line') : undefined}
    >
      <td className="pl-label">
        <span>{label}</span>
        {clickable && <span className="material-symbols-outlined pl-go" aria-hidden="true">chevron_right</span>}
      </td>
      <td className="pl-num">{kind === 'head' ? '' : shown(amount, bracket)}</td>
      <td className="pl-pct">{kind === 'head' ? '' : pctText(pct)}</td>
    </tr>
  );
}

function Statement({ data, head, onShowBreakdown }) {
  // The side panel shows a stack of views: the last one is on screen and
  // Back pops it (e.g. Checks → Invoices whose records disagree).
  const [stack, setStack] = useState([]);
  const nextId = useRef(0);
  const range = { from_date: data.from_date, to_date: data.to_date };
  const period = `${formatDatePKT(data.from_date)} to ${formatDatePKT(data.to_date)}`;

  const show = (entry, push) => {
    const id = ++nextId.current;
    setStack(s => [...(push ? s : []), { ...entry, id }]);
    return id;
  };
  const fill = (id, patch) => setStack(s => s.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const failed = async (id, err) => {
    setStack(s => s.filter(e => e.id !== id));
    toast.error(await apiMessage(err, 'The details could not be loaded. Try again.'));
  };

  const openInvoices = async (key, push = false) => {
    const cfg = INVOICE_DETAILS[key];
    const id = show({ kind: 'invoices', title: cfg.title, columns: cfg.columns, fromCheck: !!cfg.only, loading: true }, push);
    try {
      const r = await api.get('/reports/profit-loss/details', {
        params: { ...range, kind: 'invoices', ...(cfg.only ? { only: cfg.only } : {}) },
      });
      const rows = cfg.nonZero ? r.data.rows.filter(x => toPaisa(x[cfg.nonZero]) !== 0) : r.data.rows;
      fill(id, { loading: false, rows });
    } catch (err) { failed(id, err); }
  };
  const openExpenses = async (line, push = false) => {
    const id = show({ kind: 'expenses', title: line.name, loading: true }, push);
    try {
      const r = await api.get('/reports/profit-loss/details', {
        params: { ...range, kind: 'expenses', type_id: line.expense_type_id === null ? 'none' : line.expense_type_id },
      });
      fill(id, { loading: false, rows: r.data.rows });
    } catch (err) { failed(id, err); }
  };
  const openCheckDetails = (which) => {
    if (which === 'untyped') {
      const line = data.expenses.lines.find(l => l.expense_type_id === null);
      if (line) openExpenses(line, true);
      return;
    }
    openInvoices(which, true);
  };

  const rv = data.revenue;
  const cs = data.cost_of_sales;
  const pc = data.percent_of_net_sales;
  const issues = data.checks.filter(c => !c.ok);
  const loss = data.net_profit < 0;
  const top = stack[stack.length - 1];
  const panelWidth = !top ? 760 : top.kind === 'checks' ? 600 : top.kind === 'expenses' ? 720
    : (top.columns.length > 3 ? 1060 : 860);

  return (
    <>
      <div className="card">
        <ResultHead
          {...head}
          title={`Profit and Loss · ${period}`}
          meta={`${plural(data.invoices, 'invoice')} · figures as of ${stampPKT(data.generated_at)}`}
        >
          <button
            type="button"
            className={`pl-status ${issues.length ? 'is-warn' : 'is-ok'}`}
            onClick={() => show({ kind: 'checks' }, false)}
            aria-haspopup="dialog"
          >
            <span className="material-symbols-outlined" aria-hidden="true">{issues.length ? 'error' : 'verified'}</span>
            {issues.length
              ? `${plural(issues.length, 'check needs', 'checks need')} attention`
              : `All ${data.checks.length} checks passed`}
            <span className="material-symbols-outlined pl-status-go" aria-hidden="true">chevron_right</span>
          </button>
        </ResultHead>
        <StatTiles items={[
          { label: 'Net sales', value: amt(rv.net_sales) },
          { label: 'Gross profit', value: shown(data.gross_profit, false), sub: pctText(pc.gross_profit) && `${pctText(pc.gross_profit)} of net sales`, tone: data.gross_profit < 0 ? 'bad' : undefined },
          { label: 'Operating expenses', value: amt(data.expenses.total), sub: pctText(pc.expenses) && `${pctText(pc.expenses)} of net sales` },
          { label: loss ? 'Net loss' : 'Net profit', value: shown(data.net_profit, false), strong: true, tone: loss ? 'bad' : 'good', sub: pctText(pc.net_profit) && `${pctText(pc.net_profit)} of net sales` },
        ]} />
        <div className="table-wrap">
          <table className="report-table pl-statement">
            <thead>
              <tr>
                <th>Particulars</th>
                <th style={{ width: 180, textAlign: 'right' }}>Amount (PKR)</th>
                <th style={{ width: 130, textAlign: 'right' }}>% of net sales</th>
              </tr>
            </thead>
            <tbody>
              <Row kind="head" label="Revenue" />
              <Row kind="item" label="Gross sales" amount={rv.gross_sales} onOpen={() => openInvoices('gross_sales')} />
              <Row kind="item" label="Less: Trade discounts" amount={rv.trade_discounts} bracket onOpen={() => openInvoices('trade_discounts')} />
              <Row kind="item" label="Less: Sales returns" amount={rv.sales_returns} bracket onOpen={() => openInvoices('sales_returns')} />
              <Row kind="item" label="Less: Discounts allowed on recovery" amount={rv.recovery_discounts} bracket onOpen={() => openInvoices('recovery_discounts')} />
              <Row kind="item" label="Less: Sales tax" amount={rv.sales_tax} bracket onOpen={() => openInvoices('sales_tax')} />
              <Row kind="total" label="Net sales" amount={rv.net_sales} pct={pc.net_sales} onOpen={() => openInvoices('net_sales')} />

              <Row kind="head" label="Cost of sales" />
              <Row kind="item" label="Cost of goods sold" amount={cs.goods_sold} onOpen={() => openInvoices('cost_of_sales')} />
              <Row kind="item" label="Cost of bonus (free) units" amount={cs.bonus_units} onOpen={() => openInvoices('cost_of_sales')} />
              <Row kind="item" label="Less: Cost of goods returned" amount={cs.goods_returned} bracket onOpen={() => openInvoices('cost_of_sales')} />
              <Row kind="total" label="Cost of sales" amount={cs.total} pct={pc.cost_of_sales} onOpen={() => openInvoices('cost_of_sales')} />

              <Row kind="key" label="Gross profit" amount={data.gross_profit} pct={pc.gross_profit} onOpen={() => openInvoices('gross_profit')} />

              <Row kind="head" label="Operating expenses" />
              {data.expenses.lines.length === 0 ? (
                <tr className="pl-row is-item"><td className="pl-label pl-muted" colSpan={3}>No expenses recorded in this period.</td></tr>
              ) : data.expenses.lines.map(line => (
                <Row key={line.expense_type_id ?? 'none'} kind="item" label={line.name} amount={line.amount}
                  onOpen={() => openExpenses(line)} title={`${plural(line.entries, 'entry', 'entries')} · show them`} />
              ))}
              <Row kind="total" label="Total operating expenses" amount={data.expenses.total} pct={pc.expenses} />
            </tbody>
            <tfoot>
              <tr>
                <td className="report-tfoot-label">{loss ? 'Net loss' : 'Net profit'}</td>
                <td className="report-tfoot-num">{shown(data.net_profit, false)}</td>
                <td className="report-tfoot-num">{pctText(pc.net_profit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="rp-note">
          Select a line to see the invoices or expense entries behind it. Gross profit split up:{' '}
          <button type="button" className="pl-inline-link" onClick={() => onShowBreakdown('company')}>by company</button>
          {' · '}
          <button type="button" className="pl-inline-link" onClick={() => onShowBreakdown('salesman')}>by salesman</button>.
        </div>
      </div>

      <SidePanel
        open={!!top}
        onClose={() => setStack([])}
        onBack={stack.length > 1 ? () => setStack(s => s.slice(0, -1)) : undefined}
        width={panelWidth}
        title={!top ? '' : top.kind === 'checks' ? 'Report checks' : top.title}
        subtitle={period}
      >
        {top?.kind === 'checks' && <ChecksPanel checks={data.checks} generatedAt={data.generated_at} onOpen={openCheckDetails} />}
        {top?.kind === 'invoices' && <InvoiceList entry={top} />}
        {top?.kind === 'expenses' && <ExpenseList entry={top} />}
      </SidePanel>
    </>
  );
}

// ── Side panel contents ────────────────────────────────────────────────────
function ChecksPanel({ checks, generatedAt, onOpen }) {
  const attention = checks.filter(c => !c.ok);
  const passed = checks.filter(c => c.ok);
  return (
    <div className="pl-ck">
      <div className={`pl-ck-banner ${attention.length ? 'is-warn' : 'is-ok'}`}>
        <span className="material-symbols-outlined" aria-hidden="true">{attention.length ? 'error' : 'verified'}</span>
        <div>
          <div className="pl-ck-banner-title">
            {attention.length ? `${plural(attention.length, 'check needs', 'checks need')} attention` : 'Every check passed'}
          </div>
          <div className="pl-ck-banner-sub">
            {`${passed.length} of ${checks.length} passed · figures as of ${stampPKT(generatedAt)}`}
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <section>
          <h3 className="pl-ck-h">Needs attention</h3>
          {attention.map(c => (
            <article key={c.key} className="pl-ck-card">
              <div className="pl-ck-title">{c.topic || c.title}</div>
              <p className="pl-ck-detail">{c.detail}</p>
              {c.details && (
                <button type="button" className="btn btn-outline btn-sm pl-ck-open" onClick={() => onOpen(c.details)}>
                  {c.details === 'untyped' ? 'View the entries' : 'View the invoices'}
                  <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </button>
              )}
            </article>
          ))}
        </section>
      )}

      {passed.length > 0 && (
        <section>
          <h3 className="pl-ck-h">Passed</h3>
          <ul className="pl-ck-passed">
            {passed.map(c => (
              <li key={c.key}>
                <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                <div>
                  <div className="pl-ck-passed-title">{c.title}</div>
                  <div className="pl-ck-passed-detail">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pl-ck-foot">
        The checks compare this statement with the Profit Report, Sale Summary and Tax Ledger, and look for records
        that need correcting. Notes for any check that needs attention are also printed on the PDF.
      </p>
    </div>
  );
}

function PanelLoading() {
  return <div className="loading-center" style={{ padding: 40 }}><div className="spinner" /></div>;
}

function InvoiceList({ entry }) {
  const { rows, columns, loading } = entry;
  if (loading) return <PanelLoading />;
  if (!rows || rows.length === 0) return <EmptyResult title="Nothing to show for this line." />;
  const total = (key) => rows.reduce((s, r) => s + toPaisa(r[key]), 0) / 100;
  return (
    <>
      <div className="pl-list-meta">
        {entry.fromCheck ? plural(rows.length, 'invoice') : `${plural(rows.length, 'invoice')} · the totals equal the statement line`}
      </div>
      <div className="table-wrap pl-dwrap">
        <table className="report-table rp-dtable">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Customer</th>
              {columns.map(c => <th key={c} className={TEXT_COLUMNS.has(c) ? 'txt' : 'num'}>{INVOICE_COLUMNS[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sale_id}>
                <td className="inv">{r.invoice_no}</td>
                <td className="nowrap">{formatDatePKT(r.date)}</td>
                <td className="cust" title={r.customer_name || ''}>
                  {r.customer_name || '—'}
                  {r.missing_cost_lines > 0 && (
                    <span className="rp-flag" title={`${plural(r.missing_cost_lines, 'line')} with no recorded cost`}>⚠</span>
                  )}
                </td>
                {columns.map(c => (TEXT_COLUMNS.has(c)
                  ? <td key={c} className="txt">{r[c] || '—'}</td>
                  : <td key={c} className="num">{shown(r[c], false)}</td>))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="report-tfoot-label">Total</td>
              {columns.map(c => <td key={c} className="report-tfoot-num">{TEXT_COLUMNS.has(c) ? '' : shown(total(c), false)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function ExpenseList({ entry }) {
  const { rows, loading } = entry;
  if (loading) return <PanelLoading />;
  if (!rows || rows.length === 0) return <EmptyResult title="Nothing to show for this line." />;
  const total = rows.reduce((s, r) => s + toPaisa(r.amount), 0) / 100;
  return (
    <>
      <div className="pl-list-meta">{plural(rows.length, 'entry', 'entries')} from Finance → Expense</div>
      <div className="table-wrap pl-dwrap">
        <table className="report-table rp-dtable">
          <thead>
            <tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="nowrap">{formatDatePKT(r.date)}</td>
                <td className="txt">
                  {r.description || '—'}
                  {r.from_pay_run && <span className="badge badge-gray" style={{ marginLeft: 8, fontSize: 11 }}>Pay Run</span>}
                </td>
                <td className="num">{amt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="report-tfoot-label">Total</td>
              <td className="report-tfoot-num">{amt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// ── By Company / By Salesman view ──────────────────────────────────────────
function Segments({ data, head }) {
  const byCompany = data.group_by === 'company';
  const who = byCompany ? 'Company' : 'Salesman';
  const t = data.totals;
  const period = `${formatDatePKT(data.from_date)} to ${formatDatePKT(data.to_date)}`;
  const filtered = t.share_pct !== null && t.share_pct < 100;
  return (
    <div className="card">
      <ResultHead
        {...head}
        title={`Gross profit by ${who.toLowerCase()} · ${period}`}
        meta={`${plural(data.rows.length, byCompany ? 'company' : 'salesman', byCompany ? 'companies' : 'salesmen')} · ${plural(t.invoices, 'invoice')} · figures as of ${stampPKT(data.generated_at)}`}
      />
      {data.rows.length > 0 && (
        <StatTiles items={[
          { label: 'Net sales', value: amt(t.net_sales), sub: filtered ? `${pctText(t.share_pct)} of the company's` : undefined },
          { label: 'Cost of sales', value: amt(t.cost_of_sales) },
          { label: 'Gross profit', value: shown(t.gross_profit, false), strong: true, tone: t.gross_profit < 0 ? 'bad' : 'good' },
          { label: 'Gross margin', value: pctText(t.margin_pct) || '—' },
        ]} />
      )}
      <div className="table-wrap">
        {data.rows.length === 0 ? (
          <EmptyResult title="No sales in the selected period" hint="Try widening the date range or clearing the selection." />
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>Sr</th>
                <th>{who}</th>
                <th className="num" style={{ width: '9%' }}>Invoices</th>
                <th className="num" style={{ width: '14%' }}>Net Sales</th>
                <th className="num" style={{ width: '14%' }}>Cost of Sales</th>
                <th className="num" style={{ width: '14%' }}>Gross Profit</th>
                <th className="num" style={{ width: '9%' }}>Margin</th>
                <th className="num" style={{ width: '13%' }}>Share of Sales</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={`${row.group_id ?? 'none'}-${i}`}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>
                    {row.group_name}
                    {row.missing_cost_lines > 0 && (
                      <span className="rp-flag" title={`${plural(row.missing_cost_lines, 'line')} with no recorded cost — gross profit is overstated for this row.`}>⚠</span>
                    )}
                  </td>
                  <td className="num">{Number(row.invoices).toLocaleString('en-PK')}</td>
                  <td className="num">{shown(row.net_sales, false)}</td>
                  <td className="num">{amt(row.cost_of_sales)}</td>
                  <td className={`num strong${row.gross_profit < 0 ? ' rp-neg' : ''}`}>{shown(row.gross_profit, false)}</td>
                  <td className={`num${row.margin_pct !== null && row.margin_pct < 0 ? ' rp-neg' : ''}`}>{pctText(row.margin_pct) || '—'}</td>
                  <td className="num">{pctText(row.share_pct) || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="report-tfoot-label">Total</td>
                <td className="report-tfoot-num">{Number(t.invoices).toLocaleString('en-PK')}</td>
                <td className="report-tfoot-num">{shown(t.net_sales, false)}</td>
                <td className="report-tfoot-num">{amt(t.cost_of_sales)}</td>
                <td className="report-tfoot-num">{shown(t.gross_profit, false)}</td>
                <td className="report-tfoot-num">{pctText(t.margin_pct) || '—'}</td>
                <td className="report-tfoot-num">{pctText(t.share_pct) || '—'}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <div className="rp-note">
        {filtered
          ? 'Only the selected rows are shown; the totals are theirs. Share = a row’s net sales as a % of the whole company’s net sales for the period.'
          : 'The totals equal Net sales, Cost of sales and Gross profit on the Statement for the same dates. Share = a row’s net sales as a % of the whole company’s.'}
        {byCompany && ' An invoice with products of several companies is counted under each of them, so the invoice counts do not add up to the total.'}
        {t.missing_cost_lines > 0 && ` ${plural(t.missing_cost_lines, 'invoice line')} ${t.missing_cost_lines === 1 ? 'has' : 'have'} no recorded cost (⚠); ${t.missing_cost_lines === 1 ? 'its' : 'their'} cost counts as 0.`}
      </div>
    </div>
  );
}

const PL_STYLES = `
  .pl-status {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px 6px 10px; border-radius: 8px;
    font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid;
    transition: background 150ms ease, box-shadow 150ms ease;
  }
  .pl-status .material-symbols-outlined { font-size: 18px; }
  .pl-status .pl-status-go { font-size: 18px; margin-left: -2px; opacity: 0.7; }
  .pl-status.is-warn { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
  .pl-status.is-warn:hover { background: #fef3c7; }
  .pl-status.is-ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .pl-status.is-ok:hover { background: #d1fae5; }
  .pl-status:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 2px; }

  .pl-statement td { font-variant-numeric: tabular-nums; }
  .pl-statement .pl-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pl-statement .pl-pct { text-align: right; white-space: nowrap; color: var(--gray-500); font-variant-numeric: tabular-nums; }
  .pl-row.is-head td {
    padding-top: 16px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
    color: var(--gray-500); background: transparent; border-bottom: none;
  }
  .pl-row.is-head:hover { background: transparent; }
  .pl-row.is-item .pl-label { padding-left: 30px; }
  .pl-row.is-total td { font-weight: 700; color: var(--gray-900); border-top: 1px solid var(--gray-300, #d7dee6); }
  .pl-row.is-total .pl-pct { color: var(--gray-700); }
  .pl-row.is-key td {
    font-weight: 700; font-size: 14px; color: var(--gray-900);
    background: var(--gray-50); border-top: 1px solid var(--gray-300, #d7dee6); border-bottom: 1px solid var(--gray-300, #d7dee6);
  }
  .pl-go {
    font-size: 18px; vertical-align: middle; margin-left: 4px; color: var(--blue); opacity: 0;
    display: inline-block; transform: translateX(-4px); transition: opacity 150ms ease, transform 150ms ease;
  }
  .pl-row.is-link { cursor: pointer; }
  .pl-row.is-link:hover .pl-label > span:first-child { color: var(--blue); }
  .pl-row.is-link:hover .pl-go, .pl-row.is-link:focus-visible .pl-go { opacity: 1; transform: none; }
  .pl-row.is-link:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .pl-muted { color: var(--gray-500); font-style: italic; }

  .pl-inline-link { border: 0; background: none; padding: 0; font: inherit; color: var(--blue); font-weight: 600; cursor: pointer; }
  .pl-inline-link:hover { text-decoration: underline; text-underline-offset: 3px; }

  /* Side panel: checks */
  .pl-ck-banner { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 10px; border: 1px solid; }
  .pl-ck-banner .material-symbols-outlined { font-size: 24px; }
  .pl-ck-banner.is-warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .pl-ck-banner.is-ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .pl-ck-banner-title { font-size: 14px; font-weight: 700; }
  .pl-ck-banner-sub { font-size: 12px; opacity: 0.85; margin-top: 1px; }
  .pl-ck-h {
    margin: 22px 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--gray-500);
  }
  .pl-ck-card {
    padding: 14px 16px; border: 1px solid var(--gray-200); border-left: 3px solid var(--amber); border-radius: 10px; background: white;
  }
  .pl-ck-card + .pl-ck-card { margin-top: 10px; }
  .pl-ck-title { font-size: 13.5px; font-weight: 700; color: var(--gray-900); }
  .pl-ck-detail { margin: 4px 0 0; font-size: 12.5px; color: var(--gray-600); line-height: 1.5; }
  .pl-ck-open { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; }
  .pl-ck-open .material-symbols-outlined { font-size: 16px; }
  .pl-ck-passed { list-style: none; margin: 0; padding: 0; border: 1px solid var(--gray-100); border-radius: 10px; }
  .pl-ck-passed li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; }
  .pl-ck-passed li + li { border-top: 1px solid var(--gray-100); }
  .pl-ck-passed .material-symbols-outlined { font-size: 18px; color: var(--green); margin-top: 1px; }
  .pl-ck-passed-title { font-size: 12.5px; font-weight: 600; color: var(--gray-800); }
  .pl-ck-passed-detail { font-size: 12px; color: var(--gray-500); line-height: 1.45; }
  .pl-ck-foot { margin: 18px 0 0; font-size: 12px; color: var(--gray-500); line-height: 1.5; }

  /* Side panel: invoice / expense lists. Auto layout so no column can be
     squeezed to nothing (the fixed layout let Customer collapse to 0). */
  .pl-list-meta { margin-bottom: 10px; font-size: 12.5px; color: var(--gray-500); }
  .pl-dwrap { border: 1px solid var(--gray-100); border-radius: 10px; }
  .report-table.rp-dtable { table-layout: auto; width: 100%; }
  .rp-dtable th { white-space: nowrap; }
  .rp-dtable th.num, .rp-dtable td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .rp-dtable td.inv { white-space: nowrap; font-weight: 600; }
  .rp-dtable td.nowrap { white-space: nowrap; }
  .rp-dtable td.cust { min-width: 140px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-dtable th.txt, .rp-dtable td.txt { min-width: 220px; white-space: normal; }
  .rp-dtable td.txt { font-size: 12px; color: var(--gray-600); line-height: 1.45; }
`;

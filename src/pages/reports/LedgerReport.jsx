import React, { useState } from 'react';
import toast from 'react-hot-toast';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';
import { formatDatePKT } from '../../utils/dateUtils';
import {
  DateRangeFields, EmptyResult, FilterCard, ReportPlaceholder, Req, ResultHead, Segmented, StatTiles,
  money, periodText, plural, rangeError, safeName, toPaisa, useReport,
} from './reportUi';

// ─── Ledger ────────────────────────────────────────────────────────────────
// A customer's or supplier's account statement: opening balance at the From
// date, every entry in the range with a running balance, and the closing
// balance. Dates are optional (blank = from the first entry / up to today).

const LEDGER_INFO = (
  <>
    <p>The <b>opening balance</b> is the account balance before the From date; every entry in the period then moves the running balance. Leave the dates blank to see the account from its first entry up to today.</p>
    <p>Balances are amounts outstanding: <b>Dr</b> means the customer owes you, or you owe the supplier; <b>Cr</b> is an advance — received from a customer, or paid to a supplier, ahead of invoices.</p>
  </>
);

const drCr = (n) => `${money(Math.abs(n))} ${n >= 0 ? 'Dr' : 'Cr'}`;

export default function LedgerReport({ lookups }) {
  const { customers, suppliers, areas, territories } = lookups;
  const [type, setType] = useState('customer');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const report = useReport(type === 'customer' ? '/reports/customer-ledger' : '/reports/supplier-ledger', 'Error fetching ledger');

  const params = { [type === 'customer' ? 'customer_id' : 'supplier_id']: entityId, from_date: from, to_date: to };
  const generate = () => {
    if (!entityId) return toast.error(`Please select a ${type}`);
    const err = rangeError(from, to, false);
    if (err) return toast.error(err);
    report.run(params);
  };

  const data = report.data;
  const entity = data?.customer || data?.supplier;
  const ob = parseFloat(data?.openingBalance || 0);
  let run = toPaisa(ob);
  const rows = (data?.ledger || []).map(r => {
    run += toPaisa(r.dr) - toPaisa(r.cr);
    return { ...r, _balance: run / 100 };
  });
  const totalDr = rows.reduce((s, r) => s + toPaisa(r.dr), 0) / 100;
  const totalCr = rows.reduce((s, r) => s + toPaisa(r.cr), 0) / 100;
  const closing = run / 100;
  const isCustomer = !!data?.customer;

  return (
    <>
      <FilterCard
        title="Ledger"
        description="Account statement with opening balance, every entry and a running balance."
        info={LEDGER_INFO}
        onGenerate={generate}
        loading={report.loading}
        disabled={!entityId}
      >
        <div className="form-group rp-f-auto">
          <span className="form-label">Ledger of</span>
          <Segmented
            field
            value={type}
            onChange={(t) => { setType(t); setEntityId(''); report.clear(); }}
            options={[{ key: 'customer', label: 'Customer' }, { key: 'supplier', label: 'Supplier' }]}
            ariaLabel="Ledger of"
          />
        </div>
        <div className="form-group rp-f-wide">
          <label className="form-label">{type === 'customer' ? 'Customer' : 'Supplier'}<Req /></label>
          {type === 'customer' ? (
            <CustomerAutocomplete
              customers={customers}
              areas={areas}
              territories={territories}
              value={entityId}
              onChange={id => setEntityId(id)}
              placeholder="Search customer by name…"
            />
          ) : (
            <select className="form-control" value={entityId} onChange={e => setEntityId(e.target.value)}>
              <option value="">— Select —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <DateRangeFields from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </FilterCard>

      {!data && <ReportPlaceholder loading={report.loading} icon="account_balance" text="Choose a customer or supplier, then select Generate report." />}
      {data && (
        <div className="card">
          <ResultHead
            onDownload={() => report.download(`${type}-ledger-${safeName(entity?.name)}.pdf`)}
            stale={!report.isCurrent(params)}
            onRefresh={generate}
            refreshing={report.loading}
            title={entity?.name}
            meta={[
              isCustomer ? 'Customer ledger' : 'Supplier ledger',
              periodText(report.params),
              plural(rows.length, 'entry', 'entries'),
            ].join(' · ')}
          />
          <StatTiles items={[
            { label: 'Opening balance', value: drCr(ob) },
            { label: 'Debit', value: money(totalDr) },
            { label: 'Credit', value: money(totalCr) },
            {
              label: 'Closing balance', value: drCr(closing), strong: true,
              // Both ledgers are kept as amount outstanding: Dr = owed.
              sub: closing === 0 ? 'Settled'
                : closing > 0 ? (isCustomer ? 'Receivable from customer' : 'Payable to supplier')
                  : (isCustomer ? 'Advance from customer' : 'Advance to supplier'),
            },
          ]} />
          <div className="table-wrap">
            {rows.length === 0 ? (
              <EmptyResult title="No entries in the selected period" hint={ob !== 0 ? `The balance stays at ${drCr(ob)}.` : undefined} />
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th style={{ width: '11%' }}>Date</th>
                    <th style={{ width: '12%' }}>Invoice No</th>
                    <th>Description</th>
                    <th className="num" style={{ width: '13%' }}>Debit</th>
                    <th className="num" style={{ width: '13%' }}>Credit</th>
                    <th className="num" style={{ width: '15%' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="muted">—</td>
                    <td className="muted">—</td>
                    <td style={{ fontWeight: 600 }}>Opening balance</td>
                    <td className="num muted">—</td>
                    <td className="num muted">—</td>
                    <td className="num strong">{drCr(ob)}</td>
                  </tr>
                  {rows.map((row, i) => (
                    <tr key={row.id ?? i}>
                      <td>{formatDatePKT(row.date)}</td>
                      <td className="mono">{row.invoice_no || '—'}</td>
                      <td>{row.description || '—'}</td>
                      <td className="num">{parseFloat(row.dr) > 0 ? money(row.dr) : '—'}</td>
                      <td className="num">{parseFloat(row.cr) > 0 ? money(row.cr) : '—'}</td>
                      <td className="num strong">{drCr(row._balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="report-tfoot-label">Total · Closing balance</td>
                    <td className="report-tfoot-num">{money(totalDr)}</td>
                    <td className="report-tfoot-num">{money(totalCr)}</td>
                    <td className="report-tfoot-num">{drCr(closing)}</td>
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

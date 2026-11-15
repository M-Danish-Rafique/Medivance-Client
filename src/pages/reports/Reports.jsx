import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import { REPORT_STYLES } from './reportUi';
import LedgerReport from './LedgerReport';
import SalesReport from './SalesReport';
import RecoveryReport from './RecoveryReport';
import SaleSummaryReport from './SaleSummaryReport';
import SaleStockReport from './SaleStockReport';
import BatchActivityReport from './BatchActivityReport';
import ProfitLoss, { PROFIT_VIEWS } from './ProfitLoss';

// ─── Reports ───────────────────────────────────────────────────────────────
// The page shell: one horizontal report bar, grouped like a ribbon
// (Accounts · Sales · Stock · Profitability; it scrolls sideways on narrow
// screens), and the chosen report below it. Each report lives in its own
// file and shares the building blocks in reportUi.jsx. The open report (and
// the Profit & Loss view) is kept in the URL — ?report=profit&view=company —
// so a refresh or a shared link opens the same place.
//
// Look-up lists (customers, suppliers, staff, companies, products, areas)
// are loaded once here and passed down.

const REPORT_GROUPS = [
  {
    label: 'Accounts',
    items: [
      { id: 'ledger', label: 'Ledgers', icon: 'account_balance', hint: 'Customer & supplier statements' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { id: 'sales', label: 'Sales Report', icon: 'sell', hint: 'Invoice by invoice' },
      { id: 'summary', label: 'Sale Summary', icon: 'layers', hint: 'Grouped totals' },
      { id: 'recovery', label: 'Recovery Report', icon: 'account_balance_wallet', hint: 'Collections & returns' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { id: 'saleStock', label: 'Sale & Stock', icon: 'inventory_2', hint: 'Opening to closing stock' },
      { id: 'batchActivity', label: 'Batch Activity', icon: 'science', hint: 'Where a batch went' },
    ],
  },
  {
    label: 'Profitability',
    items: [
      { id: 'profit', label: 'Profit & Loss', icon: 'monitoring', hint: 'Statement · by company · by salesman' },
    ],
  },
];
const REPORT_IDS = REPORT_GROUPS.flatMap(g => g.items.map(i => i.id));
// Earlier tab ids, so old links still land on the right report.
const LEGACY_IDS = { profitReport: 'profit', profitLoss: 'profit' };

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const asked = searchParams.get('report');
  const report = REPORT_IDS.includes(asked) ? asked : (LEGACY_IDS[asked] || 'ledger');
  const askedView = searchParams.get('view');
  const profitView = PROFIT_VIEWS.some(v => v.key === askedView) ? askedView : 'statement';

  const [lookups, setLookups] = useState(null);

  useEffect(() => {
    let live = true;
    const list = (p) => p.then(r => r.data).catch(() => null);
    Promise.all([
      list(api.get('/customers')),
      list(api.get('/suppliers')),
      list(api.get('/employees?role=Salesman')),
      list(api.get('/employees?role=Supplier')),
      list(api.get('/geography/geo')),
      list(api.get('/companies')),
      list(api.get('/products')),
    ]).then(([customers, suppliers, salesmen, deliveryStaff, geo, companies, products]) => {
      if (!live) return;
      setLookups({
        customers: customers || [],
        suppliers: suppliers || [],
        salesmen: salesmen || [],
        deliveryStaff: deliveryStaff || [],
        areas: geo?.areas || [],
        territories: geo?.territories || [],
        companies: companies || [],
        // Alphabetical, so long product pickers are easy to scan.
        products: (products || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      });
    });
    return () => { live = false; };
  }, []);

  const open = (id, view) => {
    const next = { report: id };
    if (id === 'profit' && view && view !== 'statement') next.view = view;
    setSearchParams(next, { replace: true });
  };

  return (
    <Layout title="Reports">
      <style dangerouslySetInnerHTML={{ __html: REPORT_STYLES }} />
      <div className="rp-page">
        <nav className="card rp-tabs" aria-label="Reports">
          {REPORT_GROUPS.map(group => (
            <div key={group.label} className="rp-tab-group" role="group" aria-label={group.label}>
              <div className="rp-tab-group-label" aria-hidden="true">{group.label}</div>
              <div className="rp-tab-row">
                {group.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`rp-tab${report === item.id ? ' is-active' : ''}`}
                    aria-current={report === item.id ? 'page' : undefined}
                    title={item.hint}
                    onClick={() => open(item.id)}
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <main className="rp-main">
          {!lookups ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : (
            <>
              {/* Each report keeps its filters and results while another is open. */}
              <Panel show={report === 'ledger'}><LedgerReport lookups={lookups} /></Panel>
              <Panel show={report === 'sales'}><SalesReport lookups={lookups} /></Panel>
              <Panel show={report === 'summary'}><SaleSummaryReport lookups={lookups} /></Panel>
              <Panel show={report === 'recovery'}><RecoveryReport lookups={lookups} /></Panel>
              <Panel show={report === 'saleStock'}><SaleStockReport lookups={lookups} /></Panel>
              <Panel show={report === 'batchActivity'}><BatchActivityReport lookups={lookups} /></Panel>
              <Panel show={report === 'profit'}>
                <ProfitLoss lookups={lookups} view={profitView} onViewChange={(v) => open('profit', v)} />
              </Panel>
            </>
          )}
        </main>
      </div>
    </Layout>
  );
}

/** Keeps a report mounted (filters and results survive switching) but hidden. */
function Panel({ show, children }) {
  return <div className="rp-main" hidden={!show}>{children}</div>;
}

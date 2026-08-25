import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import { formatDatePKT } from '../../utils/dateUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ─── Formatting helpers ────────────────────────────────────────────────────
// Compact currency ("PKR 1.2M", "PKR 450K") for the visible label. `en-US`
// locale is used deliberately so the compact suffix follows the M/K
// convention the exec brief calls for rather than the local L/Cr scale.
const fmtCompact = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'PKR', currencyDisplay: 'code',
  notation: 'compact', compactDisplay: 'short',
  maximumFractionDigits: 1,
}).format(parseFloat(n) || 0);

// Exact, unabbreviated currency — surfaced via the value's `title` attribute
// so hovering any compact figure reveals the true underlying number.
const fmtExact = (n) => new Intl.NumberFormat('en-PK', {
  style: 'currency', currency: 'PKR', maximumFractionDigits: 0,
}).format(parseFloat(n) || 0);

// ─── Design tokens ─────────────────────────────────────────────────────────
// Kept local to this page — the dashboard has a distinct "exec brief"
// typography that differs from the denser transactional pages.
const SECTION_TITLE_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: 'var(--gray-500)',
  textTransform: 'uppercase',
  margin: '4px 0 10px',
};

const CARD_STYLE = {
  background: 'white',
  border: '1px solid var(--gray-200)',
  borderRadius: 10,
  padding: '16px 18px',
  minHeight: 96,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
};

const LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: 'var(--gray-500)',
  textTransform: 'uppercase',
};

const VALUE_STYLE = {
  fontSize: 26,
  fontWeight: 700,
  color: 'var(--gray-900)',
  lineHeight: 1.15,
  marginTop: 8,
  whiteSpace: 'nowrap',
};

const SUB_STYLE = {
  fontSize: 11,
  color: 'var(--gray-500)',
  marginTop: 4,
};

const GRID = { display: 'grid', gap: 14, marginBottom: 22 };

// Stat card. Tone is used sparingly — only for alerts and derived profit —
// so the palette stays quiet enough that important numbers pop on their own.
function StatCard({ label, value, exact, sub, tone = 'default' }) {
  const toneColor =
    tone === 'danger' ? '#b91c1c' :   // WCAG AA on white
    tone === 'warn'   ? '#b45309' :
    tone === 'good'   ? '#047857' :
                        'var(--gray-900)';
  return (
    <div style={CARD_STYLE}>
      <div style={LABEL_STYLE}>{label}</div>
      <div>
        <div
          style={{ ...VALUE_STYLE, color: toneColor }}
          title={exact != null ? exact : undefined}
        >
          {value}
        </div>
        {sub && <div style={SUB_STYLE}>{sub}</div>}
      </div>
    </div>
  );
}

// Placeholder shown while the dashboard payload is in flight. Uses the
// same card footprint as the real content so the layout doesn't jump on
// data arrival.
function SkeletonCard() {
  return (
    <div style={CARD_STYLE} aria-hidden="true">
      <div style={{ background: 'var(--gray-100)', height: 10, width: 90,  borderRadius: 4 }} />
      <div>
        <div style={{ background: 'var(--gray-100)', height: 24, width: 130, borderRadius: 4, marginTop: 12 }} />
        <div style={{ background: 'var(--gray-100)', height:  9, width:  80, borderRadius: 4, marginTop:  8 }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/dashboard')
      .then(r => { if (!cancelled) { setStats(r.data); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const renderStat = (props) => loading ? <SkeletonCard /> : <StatCard {...props} />;

  const hasLowStock   = !loading && stats?.low_stock_count > 0;
  const hasPendingTax = !loading && stats?.pending_tax > 0;
  const showAlerts    = hasLowStock || hasPendingTax;

  return (
    <Layout title="Dashboard">
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          Unable to load dashboard data. Please refresh the page.
        </div>
      )}

      {/* 1. TODAY — highest-frequency operational read: what happened today. */}
      <div style={SECTION_TITLE_STYLE}>Today</div>
      <div style={{ ...GRID, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {renderStat({
          label: "Today's Sale",
          value: fmtCompact(stats?.today_sale),
          exact: fmtExact(stats?.today_sale),
          sub: 'Invoiced today',
        })}
        {renderStat({
          label: "Today's Recovery",
          value: fmtCompact(stats?.today_recovery),
          exact: fmtExact(stats?.today_recovery),
          sub: 'Collected today',
        })}
      </div>

      {/* 2. CASH POSITION — money owed to us and by us. */}
      <div style={SECTION_TITLE_STYLE}>Cash Position</div>
      <div style={{ ...GRID, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {renderStat({
          label: 'Total Receivable',
          value: fmtCompact(stats?.total_receivable),
          exact: fmtExact(stats?.total_receivable),
          sub: 'Outstanding from customers',
        })}
        {renderStat({
          label: 'Total Payable',
          value: fmtCompact(stats?.total_payable),
          exact: fmtExact(stats?.total_payable),
          sub: 'Outstanding to suppliers',
        })}
      </div>

      {/* 3. ALERTS — surfaced only when non-zero so a clean dashboard stays clean. */}
      {showAlerts && (
        <>
          <div style={SECTION_TITLE_STYLE}>Requires Attention</div>
          <div style={{
            ...GRID,
            gridTemplateColumns: `repeat(${(hasLowStock ? 1 : 0) + (hasPendingTax ? 1 : 0)}, minmax(0, 1fr))`,
          }}>
            {hasLowStock && (
              <StatCard
                label="Low Stock Batches"
                value={stats.low_stock_count.toLocaleString()}
                sub="At or below threshold"
                tone="danger"
              />
            )}
            {hasPendingTax && (
              <StatCard
                label="Pending FBR Tax"
                value={fmtCompact(stats.pending_tax)}
                exact={fmtExact(stats.pending_tax)}
                sub="Unsubmitted to FBR"
                tone="warn"
              />
            )}
          </div>
        </>
      )}

      {/* 4. MONTHLY PERFORMANCE — a step back from the daily view. */}
      <div style={SECTION_TITLE_STYLE}>Monthly Performance</div>
      <div style={{ ...GRID, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {renderStat({
          label: 'Monthly Sales',
          value: fmtCompact(stats?.monthly_sales),
          exact: fmtExact(stats?.monthly_sales),
          sub: 'This month, to date',
        })}
        {renderStat({
          label: 'Monthly Purchases',
          value: fmtCompact(stats?.monthly_purchases),
          exact: fmtExact(stats?.monthly_purchases),
          sub: 'This month, to date',
        })}
      </div>

      {/* 5. INVENTORY POSITION — stock valued at cost, at retail, and the
             derived gross-profit if it all sold at sale rate today. */}
      <div style={SECTION_TITLE_STYLE}>Inventory Position</div>
      <div style={{ ...GRID, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {renderStat({
          label: 'Inventory Asset Value',
          value: fmtCompact(stats?.inventory_asset_value),
          exact: fmtExact(stats?.inventory_asset_value),
          sub: 'Stock valued at purchase cost',
        })}
        {renderStat({
          label: 'Estimated Retail Value',
          value: fmtCompact(stats?.estimated_retail_value),
          exact: fmtExact(stats?.estimated_retail_value),
          sub: 'Stock valued at sale rate',
        })}
        {renderStat({
          label: 'Estimated Gross Profit',
          value: fmtCompact(stats?.estimated_gross_profit),
          exact: fmtExact(stats?.estimated_gross_profit),
          sub: 'Retail − Asset value',
          tone: 'good',
        })}
      </div>

      {/* 6. DETAIL — recent transactional context and top-mover chart. */}
      <div style={SECTION_TITLE_STYLE}>Recent Activity</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Sales</div>
            <a href="/sale" className="btn btn-outline btn-sm">View All</a>
          </div>
          <div className="table-wrap">
            {loading ? (
              <div className="loading-center" style={{ padding: 30 }}><div className="spinner" /></div>
            ) : stats?.recent_sales?.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_sales.map(s => (
                    <tr key={s.invoice_no}>
                      <td><span className="mono badge badge-blue">{s.invoice_no}</span></td>
                      <td>{s.customer_name}</td>
                      <td>{formatDatePKT(s.date)}</td>
                      <td style={{ fontWeight: 700 }} title={fmtExact(s.total_amount)}>
                        {fmtCompact(s.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-desc">No sales recorded yet</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Top Products (by Qty Sold)</div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {loading ? (
              <div className="loading-center" style={{ padding: 30 }}><div className="spinner" /></div>
            ) : stats?.top_products?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.top_products} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number"     tick={{ fontSize: 11 }} />
                  <YAxis type="category"   dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v) => [v, 'Units']} />
                  <Bar dataKey="total_qty" fill="#1e3a8a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-desc">No sales data yet</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import {
  BarChart, Bar, LabelList,
  LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

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

// Responsive column templates. `auto-fit` + `minmax` lets each grid collapse
// cleanly to a single-column stack once viewport gets tight — no media
// queries needed and behaviour matches the Fiori/Lightning wrap rule.
const STAT_COLS_2 = { gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' };
const STAT_COLS_3 = { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' };
const CHART_COLS  = { gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' };

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

  const hasPendingTax = !loading && stats?.pending_tax > 0;

  // Chart-ready projections. Kept out of the JSX so the render tree stays
  // readable and so recharts sees stable references between renders.
  const topProducts = (stats?.top_products || []).map(p => ({
    name:         p.name,
    total_qty:    parseFloat(p.total_qty)    || 0,
    gross_profit: parseFloat(p.gross_profit) || 0,
    // Pre-formatted secondary label rendered at the end of each bar.
    // Kept short so it doesn't crowd the chart at narrow widths.
    profit_label: fmtCompact(parseFloat(p.gross_profit) || 0),
  }));

  const trajectory = (stats?.trajectory || []).map(t => {
    // "2026-01" → "Jan 26". Short label keeps 12 months readable on the axis.
    const [y, m] = t.month.split('-');
    const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return {
      month:     d.toLocaleString('en-US', { month: 'short' }) + " '" + String(y).slice(-2),
      sales:     parseFloat(t.sales)     || 0,
      purchases: parseFloat(t.purchases) || 0,
    };
  });

  return (
    <Layout title="Dashboard">
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          Unable to load dashboard data. Please refresh the page.
        </div>
      )}

      {/* 1. TODAY — highest-frequency operational read: what happened today. */}
      <div style={SECTION_TITLE_STYLE}>Today</div>
      <div style={{ ...GRID, ...STAT_COLS_2 }}>
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
      <div style={{ ...GRID, ...STAT_COLS_2 }}>
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
      {hasPendingTax && (
        <>
          <div style={SECTION_TITLE_STYLE}>Requires Attention</div>
          <div style={{ ...GRID, ...STAT_COLS_2 }}>
            <StatCard
              label="Pending FBR Tax"
              value={fmtCompact(stats.pending_tax)}
              exact={fmtExact(stats.pending_tax)}
              sub="Unsubmitted to FBR"
              tone="warn"
            />
          </div>
        </>
      )}

      {/* 4. MONTHLY PERFORMANCE — a step back from the daily view. */}
      <div style={SECTION_TITLE_STYLE}>Monthly Performance</div>
      <div style={{ ...GRID, ...STAT_COLS_2 }}>
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
      <div style={{ ...GRID, ...STAT_COLS_3 }}>
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

      {/* 6. ANALYTICS — dual chart layout.
             Left  : Top Products (horizontal bar, gross-profit secondary label).
             Right : Sales vs Purchase Trajectory (dual-axis rolling 12 months). */}
      <div style={SECTION_TITLE_STYLE}>Analytics</div>
      <div style={{ display: 'grid', gap: 14, ...CHART_COLS }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Top Products</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Qty sold · Gross profit</div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {loading ? (
              <div className="loading-center" style={{ padding: 30 }}><div className="spinner" /></div>
            ) : topProducts.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={topProducts}
                  layout="vertical"
                  margin={{ top: 8, right: 60, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--gray-100)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'var(--gray-500)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11, fill: 'var(--gray-700)' }}
                    tickFormatter={(v) => (v && v.length > 22 ? v.slice(0, 21) + '…' : v)}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(30,58,138,0.05)' }}
                    formatter={(value, key, entry) => {
                      if (key === 'total_qty') return [Number(value).toLocaleString(), 'Units sold'];
                      return [value, key];
                    }}
                    labelFormatter={(label, payload) => {
                      const row = payload?.[0]?.payload;
                      if (!row) return label;
                      return `${label} — Gross profit: ${fmtExact(row.gross_profit)}`;
                    }}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--gray-200)' }}
                  />
                  <Bar dataKey="total_qty" fill="#1e3a8a" radius={[0, 4, 4, 0]} barSize={18}>
                    <LabelList
                      dataKey="profit_label"
                      position="right"
                      style={{ fontSize: 10, fill: 'var(--gray-600)', fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-desc">No sales data yet</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Sales vs Purchase Trajectory</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Rolling 12 months</div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {loading ? (
              <div className="loading-center" style={{ padding: 30 }}><div className="spinner" /></div>
            ) : trajectory.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={trajectory}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: 'var(--gray-500)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {/* Sales axis on the left, Purchases on the right — two
                      axes let both series scale independently even when
                      one dominates the other (typical when purchase
                      cadence is chunkier than sale cadence). */}
                  <YAxis
                    yAxisId="sales"
                    orientation="left"
                    tick={{ fontSize: 10, fill: '#1e3a8a' }}
                    tickFormatter={(v) => fmtCompact(v).replace('PKR ', '')}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <YAxis
                    yAxisId="purchases"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#b45309' }}
                    tickFormatter={(v) => fmtCompact(v).replace('PKR ', '')}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <Tooltip
                    formatter={(value, key) => [fmtExact(value), key === 'sales' ? 'Sales' : 'Purchases']}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--gray-200)' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    iconType="circle"
                    formatter={(v) => v === 'sales' ? 'Sales' : 'Purchases'}
                  />
                  <Line
                    yAxisId="sales"
                    type="monotone"
                    dataKey="sales"
                    stroke="#1e3a8a"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="purchases"
                    type="monotone"
                    dataKey="purchases"
                    stroke="#b45309"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-desc">No trajectory data yet</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
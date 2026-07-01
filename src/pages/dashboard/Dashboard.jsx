import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then(r => { setStats(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <Layout title="Dashboard">
      <div className="loading-center"><div className="spinner" /></div>
    </Layout>
  );

  const fmt = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0);

  return (
    <Layout title="Dashboard">
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dbeafe' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>payments</span></div>
          <div>
            <div className="stat-label">Monthly Sales</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.monthly_sales)}</div>
            <div className="stat-sub">This month</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#d1fae5' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>shopping_cart</span></div>
          <div>
            <div className="stat-label">Monthly Purchases</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.monthly_purchases)}</div>
            <div className="stat-sub">This month</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#e0e7ff' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>point_of_sale</span></div>
          <div>
            <div className="stat-label">Today's Sale</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.today_sale)}</div>
            <div className="stat-sub">Today</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dcfce7' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>savings</span></div>
          <div>
            <div className="stat-label">Today's Recovery</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.today_recovery)}</div>
            <div className="stat-sub">Today</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fee2e2' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>call_received</span></div>
          <div>
            <div className="stat-label">Total Receivable</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.total_receivable)}</div>
            <div className="stat-sub">Outstanding from customers</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef3c7' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>call_made</span></div>
          <div>
            <div className="stat-label">Total Payable</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmt(stats?.total_payable)}</div>
            <div className="stat-sub">Outstanding to suppliers</div>
          </div>
        </div>
        {stats?.low_stock_count > 0 && (
          <div className="stat-card" style={{ borderColor: '#fecaca' }}>
            <div className="stat-icon" style={{ background: '#fee2e2' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>warning</span></div>
            <div>
              <div className="stat-label">Low Stock Items</div>
              <div className="stat-value" style={{ color: '#dc2626' }}>{stats.low_stock_count}</div>
              <div className="stat-sub" style={{ color: '#dc2626' }}>Needs attention</div>
            </div>
          </div>
        )}
        {stats?.pending_tax > 0 && (
          <div className="stat-card" style={{ borderColor: '#fde68a' }}>
            <div className="stat-icon" style={{ background: '#fef3c7' }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>receipt_long</span></div>
            <div>
              <div className="stat-label">Pending FBR Tax</div>
              <div className="stat-value" style={{ fontSize: 16, color: '#d97706' }}>{fmt(stats.pending_tax)}</div>
              <div className="stat-sub" style={{ color: '#d97706' }}>Unsubmitted to FBR</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Sales</div>
            <a href="/sale" className="btn btn-outline btn-sm">View All</a>
          </div>
          <div className="table-wrap">
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
                {stats?.recent_sales?.map(s => (
                  <tr key={s.invoice_no}>
                    <td><span className="mono badge badge-blue">{s.invoice_no}</span></td>
                    <td>{s.customer_name}</td>
                    <td>{new Date(s.date).toLocaleDateString()}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(s.total_amount)}</td>
                  </tr>
                ))}
                {!stats?.recent_sales?.length && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 30 }}>No sales yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Top Products (by Qty Sold)</div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats?.top_products?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.top_products} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(v) => [v, 'Units']} />
                  <Bar dataKey="total_qty" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 32 }}>bar_chart</span></div>
                <div className="empty-state-desc">No sales data yet</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
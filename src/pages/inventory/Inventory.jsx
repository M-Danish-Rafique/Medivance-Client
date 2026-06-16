import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

export default function Inventory() {
  const [data, setData] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);        // false = active only (qty > 0)
  const [companyFilter, setCompanyFilter] = useState(''); // company_id or ''

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/inventory'),
      api.get('/inventory/low-stock'),
      api.get('/companies'),
    ]).then(([inv, low, comp]) => {
      setData(inv.data);
      setLowStock(low.data);
      setCompanies(comp.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = data.filter(item => {
    const matchSearch =
      item.product_name.toLowerCase().includes(search.toLowerCase()) ||
      item.batch_no.toLowerCase().includes(search.toLowerCase());
    const matchActive = showAll || item.qty > 0;
    const matchCompany = !companyFilter || String(item.company_id) === String(companyFilter);
    return matchSearch && matchActive && matchCompany;
  });
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedInventory } = usePagination(filtered, 25);

  const expiringSoon = data.filter(item => {
    if (!item.exp_date) return false;
    const exp = new Date(item.exp_date);
    const now = new Date();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 90 && diffDays > 0;
  });

  const expired = data.filter(item => item.exp_date && new Date(item.exp_date) < new Date());

  const getRowStyle = (item) => {
    if (!item.exp_date) return {};
    const exp = new Date(item.exp_date);
    const now = new Date();
    if (exp < now) return { background: '#fef2f2' };
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    if (diffDays <= 30) return { background: '#fff7ed' };
    return {};
  };

  return (
    <Layout title="Inventory">
      {lowStock.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          <span className="material-symbols-outlined" style={{ marginRight: 8, fontSize: 18 }}>warning</span>
          <span>
            <strong>{lowStock.length} item{lowStock.length > 1 ? 's' : ''}</strong> running low on stock:&nbsp;
            {lowStock.slice(0, 3).map(i => i.product_name).join(', ')}
            {lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Batches', value: data.length, icon: 'inventory_2', color: '#dbeafe' },
          { label: 'Low Stock', value: lowStock.length, icon: 'warning', color: '#fef3c7', textColor: '#d97706' },
          { label: 'Expiring (90d)', value: expiringSoon.length, icon: 'schedule', color: '#fce7f3', textColor: '#be185d' },
          { label: 'Expired', value: expired.length, icon: 'cancel', color: '#fee2e2', textColor: '#dc2626' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className="stat-icon" style={{ background: s.color }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>{s.icon}</span></div>
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.textColor || 'var(--gray-900)' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Stock Ledger
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
              {filtered.length} {showAll ? 'total' : 'active'} batches
            </span>
          </div>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            {/* Company filter */}
            <select
              className="form-control"
              style={{ width: 180, fontSize: 13 }}
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
            >
              <option value="">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Active / All toggle */}
            <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
              <button
                className="btn btn-sm"
                style={{
                  background: !showAll ? 'white' : 'transparent',
                  boxShadow: !showAll ? 'var(--shadow-sm)' : 'none',
                  color: !showAll ? 'var(--navy)' : 'var(--gray-500)',
                  fontWeight: !showAll ? 700 : 500,
                  border: 'none', borderRadius: 6, padding: '5px 14px'
                }}
                onClick={() => setShowAll(false)}
              >
                Active Only
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: showAll ? 'white' : 'transparent',
                  boxShadow: showAll ? 'var(--shadow-sm)' : 'none',
                  color: showAll ? 'var(--navy)' : 'var(--gray-500)',
                  fontWeight: showAll ? 700 : 500,
                  border: 'none', borderRadius: 6, padding: '5px 14px'
                }}
                onClick={() => setShowAll(true)}
              >
                All Products
              </button>
            </div>

            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input
                placeholder="Search product or batch..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory_2</span></div>
              <div className="empty-state-title">No inventory found</div>
              <div className="empty-state-desc">
                {!showAll ? 'Try switching to "All Products" to see zero-stock items' : 'No records match your filters'}
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Company</th>
                  <th>Pack Size</th>
                  <th>Batch No</th>
                  <th>Qty</th>
                  <th>Purchase Rate</th>
                  <th>Sale Rate</th>
                  <th>Retail Price</th>
                  <th>Exp Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedInventory.map((item, i) => {
                  const isLow = item.qty > 0 && item.qty <= item.low_stock_threshold;
                  const isExpired = item.exp_date && new Date(item.exp_date) < new Date();
                  const isExpiringSoon = !isExpired && item.exp_date &&
                    (new Date(item.exp_date) - new Date()) / (1000 * 60 * 60 * 24) <= 90;
                  const isInactive = item.qty === 0;

                  return (
                    <tr key={i} style={{ ...getRowStyle(item), opacity: isInactive ? 0.55 : 1 }}>
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      <td>
                        {item.company_name
                          ? <span className="badge badge-blue" style={{ fontSize: 11 }}>{item.company_name}</span>
                          : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                      </td>
                      <td>{item.pack_size || '—'}</td>
                      <td><span className="mono badge badge-gray">{item.batch_no}</span></td>
                      <td>
                        <span style={{ fontWeight: 700, color: isInactive ? 'var(--gray-400)' : isLow ? 'var(--red)' : 'var(--green)' }}>
                          {isLow && <span className="low-stock-dot" style={{ marginRight: 5 }} />}
                          {item.qty}
                        </span>
                      </td>
                      <td className="mono">{formatCurrency(item.purchase_rate)}</td>
                      <td className="mono">{formatCurrency(item.sale_rate)}</td>
                      <td className="mono">{formatCurrency(item.retail_price)}</td>
                      <td>
                        {item.exp_date ? (
                          <span style={{
                            color: isExpired ? 'var(--red)' : isExpiringSoon ? 'var(--amber)' : 'var(--gray-700)',
                            fontWeight: isExpired || isExpiringSoon ? 700 : 400
                          }}>
                            {new Date(item.exp_date).toLocaleDateString()}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        {isInactive
                          ? <span className="badge badge-gray">Out of Stock</span>
                          : isExpired ? <span className="badge badge-red">Expired</span>
                          : isExpiringSoon ? <span className="badge badge-amber">Expiring Soon</span>
                          : isLow ? <span className="badge badge-red">Low Stock</span>
                          : <span className="badge badge-green">In Stock</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
          pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
    </Layout>
  );
}

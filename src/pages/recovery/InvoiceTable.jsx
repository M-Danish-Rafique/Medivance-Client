import React from 'react';
import Pagination from '../../components/common/Pagination';
import { formatCurrency } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import { getRecoveryStatus, getPendingAmount, getRecoveredAmount } from './recoveryUtils';

export default function InvoiceTable({
  loading,
  sales,
  pagedSales,
  filterStatus,
  onFilterStatusChange,
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onOpenHistory,
  onOpenRecovery,
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Sales Invoices</div>
          <div className="text-sm text-muted mt-1">{sales.length} invoice{sales.length !== 1 ? 's' : ''} found</div>
        </div>
        {/* Pending / All toggle */}
        <div style={{ display: 'flex', background: 'var(--gray-100)', borderRadius: 8, padding: 3, gap: 2 }}>
          <button
            className="btn btn-sm"
            style={{
              background: filterStatus === 'pending' ? 'white' : 'transparent',
              boxShadow: filterStatus === 'pending' ? 'var(--shadow-sm)' : 'none',
              color: filterStatus === 'pending' ? 'var(--navy)' : 'var(--gray-500)',
              fontWeight: filterStatus === 'pending' ? 700 : 500,
              border: 'none', borderRadius: 6, padding: '5px 14px'
            }}
            onClick={() => onFilterStatusChange('pending')}
          >
            Pending Only
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: filterStatus === 'settled' ? 'white' : 'transparent',
              boxShadow: filterStatus === 'settled' ? 'var(--shadow-sm)' : 'none',
              color: filterStatus === 'settled' ? 'var(--navy)' : 'var(--gray-500)',
              fontWeight: filterStatus === 'settled' ? 700 : 500,
              border: 'none', borderRadius: 6, padding: '5px 14px'
            }}
            onClick={() => onFilterStatusChange('settled')}
          >
            Settled Only
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: filterStatus === 'all' ? 'white' : 'transparent',
              boxShadow: filterStatus === 'all' ? 'var(--shadow-sm)' : 'none',
              color: filterStatus === 'all' ? 'var(--navy)' : 'var(--gray-500)',
              fontWeight: filterStatus === 'all' ? 700 : 500,
              border: 'none', borderRadius: 6, padding: '5px 14px'
            }}
            onClick={() => onFilterStatusChange('all')}
          >
            All Invoices
          </button>
        </div>
      </div>
      <div className="table-wrap">
        {loading ? <div className="loading-center"><div className="spinner" /></div>
        : sales.length === 0
          ? <div className="empty-state"><div className="empty-state-title">No invoices found</div></div>
          : (
            <table>
              <thead>
                <tr><th>Invoice No</th><th>Date</th><th>Customer</th><th>Salesman</th><th>City / Area</th><th>Total</th><th>Recovered</th><th>Pending</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
              </thead>
              <tbody>
                {pagedSales.map(s => {
                  const status = getRecoveryStatus(s);
                  const pending = getPendingAmount(s);
                  const recovered = getRecoveredAmount(s);
                  const isCompleted = status === 'completed';
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onOpenHistory(s)} title="Click to view payment history">
                      <td className="mono">{s.invoice_no || '—'}</td>
                      <td>{formatDatePKT(s.date)}</td>
                      <td style={{ fontWeight: 600 }}>{s.customer_name}</td>
                      <td>{s.salesman_name || '—'}</td>
                      <td>{[s.city_name, s.area_name].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(s.total_amount)}</td>
                      <td style={{ color: 'var(--green)' }}>{formatCurrency(recovered)}</td>
                      <td style={{ fontWeight: 600, color: pending > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{formatCurrency(pending)}</td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        {isCompleted
                          ? <span style={{ fontSize: 12, color: 'var(--gray-400)', padding: '5px 8px' }}>
                              Settled
                            </span>
                          : <button className="btn btn-primary btn-sm" onClick={() => onOpenRecovery(s)}>
                              {s.is_locked ? 'Collect Payment' : 'Recovery / Return'}
                            </button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
      <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
        pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}

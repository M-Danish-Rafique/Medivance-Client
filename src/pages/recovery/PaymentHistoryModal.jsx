import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import { getPendingAmount, getRecoveredAmount } from './recoveryUtils';

export default function PaymentHistoryModal({
  isOpen,
  onClose,
  historySale,
  historyLoading,
  historyList,
  isAdmin,
  onEditRecovery,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={`Payment History — ${historySale?.invoice_no || ''}`} size="lg">
      {historySale && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '10px 14px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10, marginBottom: 18 }}>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Customer</div><div style={{ fontWeight: 700 }}>{historySale.customer_name}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice Total</div><div style={{ fontWeight: 700 }}>{formatCurrency(historySale.total_amount)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Recovered</div><div style={{ fontWeight: 700, color: 'var(--green)' }}>{formatCurrency(getRecoveredAmount(historySale))}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Pending</div><div style={{ fontWeight: 700, color: getPendingAmount(historySale) > 0 ? 'var(--amber)' : 'var(--green)' }}>{formatCurrency(getPendingAmount(historySale))}</div></div>
          </div>

          {historyLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : historyList.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-state-desc">No recovery activity recorded yet for this invoice.</div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr 1fr 1fr 1fr 1.4fr 0.7fr' : '1fr 1fr 1fr 1fr 1fr 1.4fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                <span>Date</span><span>Discount</span><span>Return</span><span>Collected</span><span>Pending After</span><span>Notes</span>{isAdmin && <span>Actions</span>}
              </div>
              {historyList.map(h => (
                <div key={h.id} style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr 1fr 1fr 1fr 1.4fr 0.7fr' : '1fr 1fr 1fr 1fr 1fr 1.4fr', gap: 6, alignItems: 'center', padding: '7px 8px', marginBottom: 5, background: 'white', border: '1.5px solid var(--gray-200)', borderRadius: 8 }}>
                  <div>{formatDatePKT(h.date)}</div>
                  <div style={{ color: parseFloat(h.total_discount) > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{formatCurrency(h.total_discount)}</div>
                  <div style={{ color: parseFloat(h.total_return_amount) > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>{formatCurrency(h.total_return_amount)}</div>
                  <div style={{ fontWeight: 700, color: 'var(--green)' }}>{formatCurrency(h.net_collected)}</div>
                  <div style={{ fontWeight: 600, color: parseFloat(h.pending_amount) > 0 ? 'var(--amber)' : 'var(--green)' }}>{formatCurrency(h.pending_amount)}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{h.notes || (h.salesman_name ? `Collected by ${h.salesman_name}` : '—')}</div>
                  {isAdmin && (
                    <div>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => onEditRecovery(h.id)}>
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

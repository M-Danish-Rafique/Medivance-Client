import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import { getPendingAmount, getRecoveredAmount } from './recoveryUtils';

// Little labelled cell used for the top-of-modal invoice summary. Keeps the
// five totals visually identical so the eye can compare them quickly.
function SummaryCell({ label, value, tone = 'default' }) {
  const tones = {
    default: { color: 'var(--gray-900)' },
    warn:    { color: 'var(--amber)' },
    good:    { color: 'var(--green)' },
    muted:   { color: 'var(--gray-500)' },
  };
  const t = tones[tone] || tones.default;
  return (
    <div>
      <div style={{
        fontSize: 10,
        color: 'var(--gray-500)',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        fontWeight: 700,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: t.color }}>{value}</div>
    </div>
  );
}

export default function PaymentHistoryModal({
  isOpen,
  onClose,
  historySale,
  historyLoading,
  historyList,
  isAdmin,
  onEditRecovery,
}) {
  // Invoice-level roll-ups. `getRecoveredAmount` / `getPendingAmount` already
  // encapsulate the fallback logic for older sales rows that predate the
  // `total_recovered` column, so we reuse them here for consistency.
  const invoiceTotal = historySale ? parseFloat(historySale.total_amount || 0) : 0;
  const totalDiscount = historySale ? parseFloat(historySale.total_discount || 0) : 0;
  const totalReturn = historySale ? parseFloat(historySale.total_return_amount || 0) : 0;
  const totalRecovered = historySale ? getRecoveredAmount(historySale) : 0;
  const totalPending = historySale ? getPendingAmount(historySale) : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={`Payment History — ${historySale?.invoice_no || ''}`} size="lg">
      {historySale && (
        <div>
          {/* Customer strip — kept above the numeric summary so the reader
              always knows which invoice's rollup they're looking at. */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 14px',
            background: 'var(--blue-ultra)',
            border: '1px solid var(--blue-pale)',
            borderRadius: 10,
            marginBottom: 10,
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--gray-500)', letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 700 }}>
                Customer
              </div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{historySale.customer_name}</div>
            </div>
            {historySale.date && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--gray-500)', letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 700 }}>
                  Invoice Date
                </div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDatePKT(historySale.date)}</div>
              </div>
            )}
          </div>

          {/* Invoice summary — overall rollup across every recovery event
              recorded against this invoice. Five fields, evenly weighted. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            padding: '12px 14px',
            background: 'white',
            border: '1px solid var(--gray-200)',
            borderRadius: 10,
            marginBottom: 18,
            boxShadow: 'var(--shadow-sm)',
          }}>
            <SummaryCell label="Invoice Total" value={formatCurrency(invoiceTotal)} />
            <SummaryCell label="Discount"      value={formatCurrency(totalDiscount)} tone={totalDiscount > 0 ? 'warn' : 'muted'} />
            <SummaryCell label="Return"        value={formatCurrency(totalReturn)}   tone={totalReturn   > 0 ? 'warn' : 'muted'} />
            <SummaryCell label="Recovered"     value={formatCurrency(totalRecovered)} tone="good" />
            <SummaryCell label="Pending"       value={formatCurrency(totalPending)}   tone={totalPending > 0 ? 'warn' : 'good'} />
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

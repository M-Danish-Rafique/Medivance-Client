import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';

export default function ConfirmRecoveryModal({
  isOpen,
  onClose,
  pendingAction,
  saving,
  editSaving,
  onConfirm,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={pendingAction?.type === 'edit' ? 'Confirm Recovery Edit' : 'Confirm Recovery'}
      footer={
        <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btn-outline" onClick={onClose}>
            Back
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={saving || editSaving}
          >
            {(saving || editSaving) ? 'Saving...' : 'Confirm & Save'}
          </button>
        </div>
      }>
      {pendingAction && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14 }}>
            {pendingAction.type === 'edit'
              ? 'Please review the corrected entry below before saving.'
              : `Please review this recovery for invoice ${pendingAction.summary.invoiceNo || ''} before saving.`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Discount</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{formatCurrency(pendingAction.summary.discount)}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Returns</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{formatCurrency(pendingAction.summary.returns)}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Amount Recovered</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{formatCurrency(pendingAction.summary.recovered)}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>Pending After</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: pendingAction.summary.pending > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {formatCurrency(pendingAction.summary.pending)}
              </div>
            </div>
          </div>
          {pendingAction.type === 'add' && pendingAction.summary.otherCount > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-500)' }}>
              Plus {formatCurrency(pendingAction.summary.otherPaymentsTotal)} collected against {pendingAction.summary.otherCount} other invoice(s).
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

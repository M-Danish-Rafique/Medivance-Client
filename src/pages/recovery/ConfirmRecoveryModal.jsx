import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';

// Uniform stat tile used across the confirmation grid. Kept locally so the
// modal renders as a consistent 6-cell summary without repeating markup.
function StatTile({ label, value, tone = 'default' }) {
  const tones = {
    default: { color: 'var(--gray-900)' },
    muted:   { color: 'var(--gray-700)' },
    warn:    { color: 'var(--amber)' },
    good:    { color: 'var(--green)' },
  };
  const t = tones[tone] || tones.default;
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--gray-50)',
      borderRadius: 8,
      border: '1px solid var(--gray-200)',
    }}>
      <div style={{
        fontSize: 11,
        color: 'var(--gray-500)',
        textTransform: 'uppercase',
        fontWeight: 700,
        letterSpacing: 0.3,
      }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, color: t.color, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

export default function ConfirmRecoveryModal({
  isOpen,
  onClose,
  pendingAction,
  saving,
  editSaving,
  onConfirm,
}) {
  const s = pendingAction?.summary || {};
  // Only fall back to "N/A" when a field is genuinely absent from the summary
  // (undefined/null). A real 0 is still meaningful \u2014 e.g. "no discount was
  // given" \u2014 so we keep formatting those as currency. Net Total is derived
  // from the other numbers only when *any* of its inputs is present.
  const fmt = (v) => (v === undefined || v === null || Number.isNaN(Number(v)))
    ? 'N/A'
    : formatCurrency(Number(v));

  const hasInvoice  = s.invoiceTotal !== undefined && s.invoiceTotal !== null;
  const hasDiscount = s.discount     !== undefined && s.discount     !== null;
  const hasReturns  = s.returns      !== undefined && s.returns      !== null;

  const invoiceTotalDisplay = fmt(s.invoiceTotal);
  const discountDisplay     = fmt(s.discount);
  const returnsDisplay      = fmt(s.returns);
  const recoveredDisplay    = fmt(s.recovered);
  const pendingDisplay      = fmt(s.pending);

  // Prefer an explicit netTotal from the caller. Otherwise derive it, but only
  // if we actually have the inputs \u2014 never manufacture a fake 0.
  let netTotalDisplay;
  if (s.netTotal !== undefined && s.netTotal !== null) {
    netTotalDisplay = fmt(s.netTotal);
  } else if (hasInvoice && hasDiscount && hasReturns) {
    netTotalDisplay = formatCurrency(Math.max(0, Number(s.invoiceTotal) - Number(s.discount) - Number(s.returns)));
  } else {
    netTotalDisplay = 'N/A';
  }

  // Tone helpers: only apply the semantic color when we actually have a number
  // to reason about \u2014 a missing value stays neutral so "N/A" doesn't get
  // colored as if it were a warning.
  const discountTone = hasDiscount ? (Number(s.discount) > 0 ? 'warn' : 'muted') : 'muted';
  const returnsTone  = hasReturns  ? (Number(s.returns)  > 0 ? 'warn' : 'muted') : 'muted';
  const recoveredTone = (s.recovered !== undefined && s.recovered !== null) ? 'good' : 'muted';
  const pendingTone   = (s.pending   !== undefined && s.pending   !== null)
    ? (Number(s.pending) > 0 ? 'warn' : 'good')
    : 'muted';

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
              ? `Please review the corrected entry for invoice ${s.invoiceNo || ''} before saving.`
              : `Please review this recovery for invoice ${s.invoiceNo || ''} before saving.`}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <StatTile label="Invoice Amount"   value={invoiceTotalDisplay} />
            <StatTile label="Discount"         value={discountDisplay}  tone={discountTone} />
            <StatTile label="Return"           value={returnsDisplay}   tone={returnsTone} />
            <StatTile label="Net Total"        value={netTotalDisplay} />
            <StatTile label="Recovered Amount" value={recoveredDisplay} tone={recoveredTone} />
            <StatTile label="Pending Amount"   value={pendingDisplay}   tone={pendingTone} />
          </div>

          {pendingAction.type === 'add' && s.otherCount > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-500)' }}>
              Plus {formatCurrency(s.otherPaymentsTotal)} collected against {s.otherCount} other invoice(s).
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

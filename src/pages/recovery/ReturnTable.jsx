import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import { blockWheelChange, getExpiryStatus } from './recoveryUtils';

export default function ReturnTable({ lines, isCross, updateReturnLine, isAdmin, errors = [] }) {
  return (
    <div>
      {lines.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-state-desc">No items in this invoice</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
            <span>Product</span><span>Batch / Expiry</span><span>Sold Qty</span><span>Return Qty</span><span>Rate</span><span>Return Amt</span>
          </div>
          {lines.map((line, idx) => {
            const retAmt = parseFloat(line.return_amount || 0);
            const err = errors[idx];
            const { blocked: expiryBlocked, warning: expiryWarning, label: expiryLabel } = getExpiryStatus(line.exp_date, isAdmin);
            const rowBg = expiryBlocked ? '#fef2f2' : expiryWarning ? '#fffbeb' : 'white';
            const rowBorder = err ? 'var(--red)' : expiryBlocked ? 'var(--red)' : expiryWarning ? '#f59e0b' : 'var(--gray-200)';
            return (
              <div key={line.row_id || idx} style={{ marginBottom: 5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: rowBg, border: `1.5px solid ${rowBorder}`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{line.product_name}</div>
                  <div>
                    <span className="mono badge badge-gray" style={{ fontSize: 11 }}>{line.batch_no || '—'}</span>
                    {expiryLabel && (
                      <div style={{ fontSize: 10, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, color: expiryBlocked ? 'var(--red)' : expiryWarning ? '#b45309' : 'var(--gray-500)' }}>
                        {expiryBlocked ? (
                          <span className="material-symbols-outlined" style={{ fontSize: 12, lineHeight: 1 }} aria-hidden="true">cancel</span>
                        ) : expiryWarning ? (
                          <span className="material-symbols-outlined" style={{ fontSize: 12, lineHeight: 1 }} aria-hidden="true">warning</span>
                        ) : null}
                        {expiryBlocked ? 'Return window expired' : expiryWarning ? 'Within 5-month window (admin override)' : `Exp: ${expiryLabel}`}
                      </div>
                    )}
                  </div>
                  <div style={{ color: 'var(--gray-600)' }}>{line.original_qty ?? '—'}</div>
                  <input className="form-control" type="number" step="1"
                    style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1, borderColor: err ? 'var(--red)' : undefined }}
                    placeholder="0" value={line.qty_returned} disabled={expiryBlocked}
                    onChange={e => updateReturnLine(idx, 'qty_returned', e.target.value, line, isCross)}
                    onWheel={blockWheelChange}
                    inputMode="numeric" />
                  <input className="form-control" type="number" step="0.01"
                    style={{ fontSize: 12, padding: '5px 8px', opacity: expiryBlocked ? 0.4 : 1 }}
                    value={line.return_rate} disabled={expiryBlocked}
                    onChange={e => updateReturnLine(idx, 'return_rate', e.target.value, line, isCross)}
                    onWheel={blockWheelChange} />
                  <div style={{ fontWeight: 700, color: retAmt > 0 ? 'var(--amber)' : 'var(--gray-400)' }}>
                    {retAmt > 0 ? formatCurrency(retAmt) : '—'}
                  </div>
                </div>
                {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

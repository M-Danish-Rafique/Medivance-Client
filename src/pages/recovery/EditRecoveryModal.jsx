import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { blockWheelChange } from './recoveryUtils';

export default function EditRecoveryModal({
  isOpen,
  onClose,
  selectedSale,
  editLoading,
  editSaving,
  canSaveEdit,
  onSave,
  editDate,
  setEditDate,
  editNotes,
  setEditNotes,
  editRecoveryLines,
  setEditRecoveryLines,
  editRecoveryLineErrors,
  editReturnLines,
  setEditReturnLines,
  editReturnLineErrors,
  editAmountRecovered,
  setEditAmountRecovered,
  editAmountRecoveredError,
  editPendingBeforePayment,
  editPendingAmount,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={`Edit Recovery Entry — ${selectedSale?.invoice_no}`} size="lg"
      footer={
        <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={editSaving || editLoading || !canSaveEdit}>
            {editSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      }>
      {editLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <div>
          <div className="form-grid form-grid-2" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Date *</label>
              <input className="form-control" type="date" value={editDate}
                onChange={e => setEditDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Notes</label>
              <input className="form-control" placeholder="Optional notes" value={editNotes}
                onChange={e => setEditNotes(e.target.value)} />
            </div>
          </div>

          {editRecoveryLines.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Discounts</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                <span>Product</span><span>Batch</span><span>Invoice Amt</span><span>Discount Given</span>
              </div>
              {editRecoveryLines.map((l, idx) => {
                const err = editRecoveryLineErrors[idx];
                return (
                  <div key={idx} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{l.product_name}</div>
                      <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{l.batch_no || '—'}</span></div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(l.original_total)}</div>
                      <input className="form-control" type="number" step="1" min="0"
                        style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }} value={l.discount_given}
                        onChange={e => setEditRecoveryLines(prev => {
                          const u = [...prev]; u[idx] = { ...u[idx], discount_given: e.target.value }; return u;
                        })}
                        onWheel={blockWheelChange} />
                    </div>
                    {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                  </div>
                );
              })}
              <div className="divider" />
            </>
          )}

          {editReturnLines.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Returns</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                <span>Product / Invoice</span><span>Batch</span><span>Return Qty</span><span>Rate</span><span>Return Amt</span>
              </div>
              {editReturnLines.map((l, idx) => {
                const err = editReturnLineErrors[idx];
                return (
                  <div key={l.row_id} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.product_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--gray-500)' }}>{l.source_invoice}</div>
                      </div>
                      <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{l.batch_no || '—'}</span></div>
                      <input className="form-control" type="number" step="1" min="0"
                        style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }} value={l.qty_returned}
                        onChange={e => setEditReturnLines(prev => {
                          const u = [...prev]; u[idx] = { ...u[idx], qty_returned: e.target.value }; return u;
                        })}
                        onWheel={blockWheelChange} />
                      <input className="form-control" type="number" step="1" min="0"
                        style={{ fontSize: 12, padding: '5px 8px' }} value={l.return_rate}
                        onChange={e => setEditReturnLines(prev => {
                          const u = [...prev]; u[idx] = { ...u[idx], return_rate: e.target.value }; return u;
                        })}
                        onWheel={blockWheelChange} />
                      <div style={{ fontWeight: 700, color: 'var(--amber)' }}>
                        {formatCurrency((parseFloat(l.qty_returned || 0)) * (parseFloat(l.return_rate || 0)))}
                      </div>
                    </div>
                    {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                  </div>
                );
              })}
              <div className="divider" />
            </>
          )}

          <div className="form-grid form-grid-2">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Amount Recovered (Cash)</label>
              <input className="form-control" type="number" step="1" min="0"
                placeholder="Enter amount collected"
                style={{ borderColor: editAmountRecoveredError ? 'var(--red)' : undefined }}
                value={editAmountRecovered}
                onChange={e => setEditAmountRecovered(e.target.value)}
                onWheel={blockWheelChange} />
              {editAmountRecoveredError ? (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{editAmountRecoveredError}</div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                  Max collectible: {formatCurrency(editPendingBeforePayment)}.
                </div>
              )}
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Pending Amount (remaining after this entry)</label>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, fontWeight: 700, fontSize: 16, color: editPendingAmount > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {formatCurrency(editPendingAmount)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

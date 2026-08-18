import React from 'react';
import Modal from '../../components/common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import { blockWheelChange } from './recoveryUtils';
import ReturnTable from './ReturnTable';

export default function RecoveryModal({
  isOpen,
  onClose,
  selectedSale,
  saleDetail,
  employees,
  recHeader,
  setRecHeader,
  amountRecovered,
  setAmountRecovered,
  amountRecoveredError,
  pendingAmount,
  invoiceTotal,
  totalDiscount,
  totalReturnAmt,
  netCollectible,
  recoveredValue,
  currentReturnAmt,
  activeTab,
  setActiveTab,
  recoveryLines,
  recoveryLineErrors,
  updateRecoveryLine,
  returnLines,
  returnLineErrors,
  fullReturnCurrent,
  handleFullReturnToggle,
  updateReturnLine,
  isAdmin,
  saving,
  canSaveRecovery,
  onSave,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={`Recovery & Return — ${selectedSale?.invoice_no}`} size="xl"
      footer={
        <div className="flex items-center w-full" style={{ gap: 32 }}>
          <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
            {/* Group 1: Invoice, Discount, Returns */}
            <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', paddingRight: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Invoice</span>
                <strong>{formatCurrency(invoiceTotal)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Discount</span>
                <strong style={{ color: 'var(--amber)' }}>{formatCurrency(totalDiscount)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Returns</span>
                <strong style={{ color: 'var(--amber)' }}>{formatCurrency(totalReturnAmt)}</strong>
              </div>
            </div>

            {/* Group 2: Net Collectible, Recovered, Pending */}
            <div style={{
              display: 'flex', flex: 1, justifyContent: 'space-between',
              paddingLeft: 24, borderLeft: '2px solid var(--gray-200)'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Net Collectible</span>
                <strong style={{ color: 'var(--green)' }}>{formatCurrency(netCollectible)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Recovered</span>
                <strong style={{ color: 'var(--blue)' }}>{formatCurrency(Number.isNaN(recoveredValue) ? 0 : recoveredValue)}</strong>
              </div>
              {pendingAmount > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Pending</span>
                  <strong style={{ color: 'var(--amber)' }}>{formatCurrency(pendingAmount)}</strong>
                </div>
              ) : (
                // keeps the 3-item spacing consistent in group 2 when Pending is hidden
                <div style={{ visibility: 'hidden' }} />
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-lg" onClick={onSave} disabled={saving || !canSaveRecovery}>
              {saving ? 'Saving...' : 'Save Recovery'}
            </button>
          </div>
        </div>
      }>

      {saleDetail && (
        <div>
          {/* Invoice summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '10px 14px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10, marginBottom: 18 }}>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Customer</div><div style={{ fontWeight: 700 }}>{saleDetail.customer_name}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice</div><span className="badge badge-green">{saleDetail.invoice_no}</span></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Date</div><div style={{ fontWeight: 600 }}>{formatDatePKT(saleDetail.date)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>Invoice Total</div><div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: 15 }}>{formatCurrency(saleDetail.total_amount)}</div></div>
          </div>

          {/* Recovery header */}
          <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Recovery Date *</label>
              <input className="form-control" type="date" value={recHeader.date}
                onChange={e => setRecHeader(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Supplier</label>
              <select
                className="form-control"
                value={recHeader.salesman_id || ''}
                onChange={e => setRecHeader(p => ({ ...p, salesman_id: e.target.value }))}
              >
                <option value="">— Select —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Notes</label>
              <input className="form-control" placeholder="Optional notes" value={recHeader.notes}
                onChange={e => setRecHeader(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          {/* Recovered amount */}
          <div className="form-grid form-grid-2" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Amount Recovered (Cash)</label>
              <input
                className="form-control"
                type="number"
                step="1"
                placeholder="Enter amount collected"
                style={{ borderColor: amountRecoveredError ? 'var(--red)' : undefined }}
                value={amountRecovered}
                onChange={e => setAmountRecovered(e.target.value)}
                onWheel={blockWheelChange}
              />
              {amountRecoveredError && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{amountRecoveredError}</div>}
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Pending Amount (remaining after this entry)</label>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, fontWeight: 700, fontSize: 16, color: pendingAmount > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {formatCurrency(pendingAmount)}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="tabs" style={{ marginBottom: 14 }}>
            <button className={`tab-btn ${activeTab === 'recovery' ? 'active' : ''}`} onClick={() => setActiveTab('recovery')}>
              Recovery (Discounts)
              {totalDiscount > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{formatCurrency(totalDiscount)}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'return' ? 'active' : ''}`} onClick={() => setActiveTab('return')}>
              Returns — Current Invoice
              {currentReturnAmt > 0 && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>{formatCurrency(currentReturnAmt)}</span>}
            </button>
          </div>

          {activeTab === 'recovery' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
                <span>Product</span><span>Batch</span><span>Invoice Amt</span><span>Discount Given</span><span>Final Amount</span>
              </div>
              {(saleDetail.items || []).map((item, idx) => {
                const line = recoveryLines[idx] || { discount_given: '' };
                const finalAmt = parseFloat(item.total) - parseFloat(line.discount_given || 0);
                const err = recoveryLineErrors[idx];
                return (
                  <div key={idx} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${err ? 'var(--red)' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                      <div><span className="mono badge badge-gray" style={{ fontSize: 11 }}>{item.batch_no || '—'}</span></div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(item.total)}</div>
                      <input className="form-control" type="number" step="0.01"
                        style={{ fontSize: 12, padding: '5px 8px', borderColor: err ? 'var(--red)' : undefined }}
                        placeholder="0.00"
                        value={line.discount_given}
                        onChange={e => updateRecoveryLine(idx, 'discount_given', e.target.value, item)}
                        onWheel={blockWheelChange} />
                      <div style={{ fontWeight: 700, color: finalAmt < 0 ? 'var(--red)' : 'var(--green)' }}>
                        {formatCurrency(Math.max(0, finalAmt))}
                      </div>
                    </div>
                    {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, paddingLeft: 4 }}>{err}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'return' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', cursor: returnLines.length === 0 ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={fullReturnCurrent}
                    disabled={returnLines.length === 0}
                    onChange={e => handleFullReturnToggle(e.target.checked)} />
                  Return Full Invoice
                </label>
              </div>
              <ReturnTable lines={returnLines} isCross={false} updateReturnLine={updateReturnLine} isAdmin={isAdmin} errors={returnLineErrors} />
            </div>
          )}

        </div>
      )}
    </Modal>
  );
}
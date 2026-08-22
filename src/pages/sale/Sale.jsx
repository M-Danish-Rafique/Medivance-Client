import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency, handlePhoneInput } from '../../utils/formatters';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';
import { useAuth } from '../../context/AuthContext';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';

const emptySaleItem = {
  row_id: null,
  product_id: '', product_search: '', product_name: '', pack_size: '', batch_no: '',
  sale_rate: '', qty: '', bonus: 0, discount_pct: 0, tax_pct: 0, total: 0,
  _batches: [], _rateHistory: null
};

// Guard against the classic <input type="number"> footgun where scrolling
// over a focused field silently increments/decrements its value. Blurring on
// wheel lets the page scroll act as intended and leaves the value untouched.
const blockNumberWheel = (e) => e.currentTarget.blur();

const createSaleItem = () => ({ ...emptySaleItem, row_id: `sale-${Date.now()}-${Math.random().toString(16).slice(2)}` });

const getProductSuggestions = (products, query) => {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return [];
  return products
    .map(p => ({
      product: p,
      score: p.name.toLowerCase().startsWith(normalized) ? 0 : p.name.toLowerCase().includes(normalized) ? 1 : 2,
    }))
    .filter(item => item.score < 2)
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 8)
    .map(item => item.product);
};

const today = () => todayPKT();

// Open the Bulk Print preview in a new tab. `ids` is an array of sale ids;
// `type` is either 'smart' (per-invoice: licensed → warranty,
// non-licensed → non-warranty) or one of the three concrete invoice types.
// A soft warning at 50 and a hard cap at 200 mirror the batch-cap policy
// enforced server-side by POST /sales/mark-printed.
function openBatchPrint(ids, type = 'smart') {
  if (!ids || ids.length === 0) return false;
  if (ids.length > 200) {
    toast.error(`Please select 200 or fewer invoices at a time (${ids.length} selected).`);
    return false;
  }
  if (ids.length > 50) {
    // Soft warn on large batches — they still work, but the browser may
    // spend a few seconds rendering N A4 pages before the print dialog
    // opens. Native confirm() is enough here; no modal needed.
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Printing ${ids.length} invoices may be slow. Continue?`);
    if (!ok) return false;
  }
  const idsParam = ids.join(',');
  window.open(`/sales/print-batch?ids=${idsParam}&type=${type}`, '_blank');
  return true;
}

// Human label for an invoice-type enum. Used both by the bulk-selection
// breakdown and by the row-level "Printed as …" tooltip.
function prettyPrintType(t) {
  if (t === 'warranty')     return 'Warranty';
  if (t === 'warranty10')   return 'Warranty +10%';
  if (t === 'non-warranty') return 'Non-Warranty';
  return t || 'Warranty';
}

// Sortable-column comparator map. Every entry returns the standard
// Array.prototype.sort signed number; the direction (asc/desc) is applied
// by the caller. String columns use localeCompare so accented / mixed-case
// names sort consistently. Invoice numbers (S26-00001) sort correctly as
// plain strings because the YY prefix and 5-digit sequence are both
// fixed-width.
const SORT_COMPARATORS = {
  invoice_no:       (a, b) => (a.invoice_no || '').localeCompare(b.invoice_no || ''),
  customer_name:    (a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''),
  salesman_name:    (a, b) => (a.salesman_name || '').localeCompare(b.salesman_name || ''),
  delivery_by_name: (a, b) => (a.delivery_by_name || '').localeCompare(b.delivery_by_name || ''),
  date:             (a, b) => (a.date || '').localeCompare(b.date || ''),
  total_amount:     (a, b) => parseFloat(a.total_amount || 0) - parseFloat(b.total_amount || 0),
  is_locked:        (a, b) => (a.is_locked ? 1 : 0) - (b.is_locked ? 1 : 0),
};

// Sortable table header cell. Shows the label with a subtle tri-state
// chevron: dual arrows (unfold_more) when the column isn't the active
// sort, or a single up/down arrow when it is. Click cycles asc ↔ desc on
// the active column, or switches to a new column (starting ascending).
function SortableHeader({ column, label, sortConfig, onSort, align, style }) {
  const active = sortConfig.column === column;
  const iconName = active
    ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward')
    : 'unfold_more';
  const isRight = align === 'right';
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align || 'left',
        ...(style || {})
      }}
      title={`Sort by ${label}`}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        justifyContent: isRight ? 'flex-end' : 'flex-start',
        width: '100%'
      }}>
        {label}
        <span className="material-symbols-outlined" style={{
          fontSize: 14,
          color: active ? 'var(--gray-700)' : 'var(--gray-300)',
          transition: 'color 0.2s ease',
          lineHeight: 1
        }}>{iconName}</span>
      </span>
    </th>
  );
}

// Segmented pill control used by the filter panel for Status and Print
// Status. Extracted so both filters share exactly one implementation and
// feel visually paired — same padding, same active-thumb animation.
function SegmentedFilter({ options, value, onChange }) {
  const activeIndex = Math.max(0, options.findIndex(o => o.v === value));
  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      background: 'var(--gray-100)',
      borderRadius: 12,
      padding: 4,
      marginTop: 5
    }}>
      <div style={{
        position: 'absolute',
        top: 4, bottom: 4, left: 4,
        width: `calc((100% - 8px) / ${options.length})`,
        borderRadius: 9,
        background: '#fff',
        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.10)',
        transform: `translateX(${activeIndex * 100}%)`,
        transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)'
      }} />
      {options.map(opt => {
        const active = value === opt.v;
        return (
          <button key={opt.v} type="button"
            onClick={() => onChange(opt.v)}
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              border: 'none',
              borderRadius: 9,
              padding: '9px 6px',
              fontSize: 12.5,
              fontWeight: active ? 550 : 500,
              color: active ? 'var(--gray-900)' : 'var(--gray-500)',
              background: 'transparent',
              cursor: 'pointer',
              transition: 'color 0.28s ease, font-weight 0.28s ease'
            }}>
            {opt.l}
          </button>
        );
      })}
    </div>
  );
}

// Row-level Print picker (Warranty / +10% / Non-Warranty). Bulk print
// intentionally does NOT expose this dropdown — it always resolves per
// invoice via the "smart" default (licensed → warranty, non-licensed →
// non-warranty). This modal is the only surface where the operator gets
// to override the type, one invoice at a time.
function PrintOptionsModal({ isOpen, onClose, invoice }) {
  if (!isOpen || !invoice) return null;
  const printAs = (type) => {
    openBatchPrint([invoice.id], type);
    onClose();
  };
  const btnRowStyle = {
    justifyContent: 'flex-start',
    gap: 12,
    textAlign: 'left'
  };
  return (
    <div className="modal-backdrop">
      <div className="modal modal-sm">
        <div className="modal-header">
          <div className="modal-title">Print Invoice</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--navy)' }}>{invoice.invoice_no}</div>
            {invoice.total_amount != null && (
              <div style={{ color: 'var(--gray-500)', fontSize: 13, marginTop: 4 }}>
                {formatCurrency(invoice.total_amount)}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10, textAlign: 'center' }}>
            Select invoice type to print
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-outline w-full" style={btnRowStyle}
              onClick={() => printAs('warranty')}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div>
                <div style={{ fontWeight: 700 }}>Warranty</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Retail Price −15% rate · With warranty statement</div>
              </div>
            </button>
            <button className="btn btn-outline w-full" style={btnRowStyle}
              onClick={() => printAs('warranty10')}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div>
                <div style={{ fontWeight: 700 }}>Warranty +10% Discount</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Warranty + additional 10% discount applied</div>
              </div>
            </button>
            <button className="btn btn-outline w-full" style={btnRowStyle}
              onClick={() => printAs('non-warranty')}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
              <div>
                <div style={{ fontWeight: 700 }}>Non-Warranty</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Actual sale rate · No warranty statement</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RateInfoPanel({ rateHistory, activeRowIdx, activeItem, canViewPurchaseRates }) {
  if (!rateHistory || activeRowIdx === null) return null;
  const info = rateHistory[activeRowIdx];
  if (!info) return null;

  // Prefer the SELECTED batch's purchase_rate (inventory row) over the fallback
  // from /sales/history/rates (which returns the latest-updated batch). The
  // user-visible "Purchase Rate" must reflect the specific batch being sold,
  // not a product-level or most-recent-batch rate.
  const selectedBatch = (activeItem?._batches || []).find(
    b => b.batch_no === activeItem?.batch_no
  );
  const batchPurchaseRate = selectedBatch ? selectedBatch.purchase_rate : null;
  const batchRateVisible  = selectedBatch
    ? (selectedBatch.purchase_rate_visible !== false && selectedBatch.purchase_rate_visible !== 0)
    : true;
  const effectivePurchaseRate = batchPurchaseRate != null ? batchPurchaseRate : info.purchase_rate;
  const rateSource = selectedBatch && batchPurchaseRate != null
    ? `Batch ${selectedBatch.batch_no}`
    : (effectivePurchaseRate != null ? 'Latest batch' : null);

  const canShowPurchaseRate = canViewPurchaseRates
    && info.purchase_rate_visible !== false && info.purchase_rate_visible !== 0
    && batchRateVisible;

  return (
    <div style={{
      marginTop: 16, padding: '14px 16px',
      background: 'var(--blue-ultra)', border: '1.5px solid var(--blue-pale)',
      borderRadius: 10
    }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bar_chart</span>
        Rate Info — Row {activeRowIdx + 1} {info.product_name ? `· ${info.product_name}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: canShowPurchaseRate ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 12 }}>
        {canShowPurchaseRate && (
          <div style={{ padding: '8px 10px', background: 'white', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 4 }}>Purchase Rate</div>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              {effectivePurchaseRate != null ? formatCurrency(effectivePurchaseRate) : 'N/A'}
            </div>
            {rateSource && (
              <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>{rateSource}</div>
            )}
          </div>
        )}
        {[0, 1, 2].map(i => (
          <div key={i} style={{ padding: '8px 10px', background: 'white', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 4 }}>
              {i === 0 ? 'Last Rate' : i === 1 ? '2nd Last' : '3rd Last'}
            </div>
            {info.history && info.history[i] ? (
              <>
                <div style={{ fontWeight: 700, color: 'var(--blue)' }}>{formatCurrency(info.history[i].sale_rate)}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>{formatDatePKT(info.history[i].date)}</div>
              </>
            ) : (
              <div style={{ fontWeight: 600, color: 'var(--gray-400)' }}>N/A</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SaleFormBody({
  header, setHeader, customers, employees, suppliers, setNewCustModal,
  items, activeRowIdx, setActiveRowIdx, updateItem, selectProduct, removeItem, addItem,
  setItems, products, rateHistory, canViewPurchaseRates, fmt, colStyle, gridCols, geo,
  getMaxQtyForItem, usedBatchKeys, getItemErrors
}) {
  return (
    <>
      <div className="form-grid form-grid-4" style={{ marginBottom: 20 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label className="form-label" style={{ margin: 0 }}>Customer *</label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
              onClick={() => setNewCustModal(true)}>+ New</button>
          </div>
          <CustomerAutocomplete
            customers={customers}
            areas={geo?.areas}
            territories={geo?.territories}
            value={header.customer_id}
            onChange={id => setHeader(p => ({ ...p, customer_id: id }))}
            placeholder="Search customer by name…"
            style={{ minWidth: 420 }}
          />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Salesman</label>
          <select className="form-control" value={header.salesman_id} onChange={e => setHeader(p => ({ ...p, salesman_id: e.target.value }))}>
            <option value="">— Select Salesman —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Delivery By</label>
          <select className="form-control" value={header.delivery_by} onChange={e => setHeader(p => ({ ...p, delivery_by: e.target.value }))}>
            <option value="">— Select Supplier —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Date *</label>
          <input className="form-control" type="date" value={header.date} onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
        </div>
      </div>

      <div className="divider" />
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)', marginBottom: 12 }}>Product Details</div>

      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 5, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
        <span>Product</span><span>Pack Size</span><span>Batch No</span><span>Qty</span>
        <span>Sale Rate</span><span>Bonus</span><span>Disc%</span><span>Tax%</span><span>Total</span><span></span>
      </div>

      {items.map((item, idx) => (
        <div key={item.row_id || idx} style={{
          display: 'grid', gridTemplateColumns: gridCols, gap: 5, alignItems: 'center',
          padding: '7px 8px', marginBottom: 6,
          background: activeRowIdx === idx ? '#f0f7ff' : 'white',
          border: `1.5px solid ${activeRowIdx === idx ? 'var(--blue-light)' : 'var(--gray-200)'}`,
          borderRadius: 8, cursor: 'pointer', position: 'relative'
        }} onClick={(e) => {
          const tag = e.target.tagName;
          if (['INPUT', 'SELECT', 'BUTTON', 'OPTION', 'TEXTAREA', 'A'].includes(tag)) return;
          setActiveRowIdx(idx);
        }}>
          <div style={{ position: 'relative' }}>
            <input className="form-control" style={colStyle} value={item.product_search}
              placeholder="Search product" autoComplete="off"
              onChange={e => updateItem(idx, 'product_search', e.target.value)}
              onBlur={() => setTimeout(() => {
                setItems(prev => {
                  const updated = [...prev];
                  const it = updated[idx];
                  if (it && !it.product_id) {
                    updated[idx] = { ...it, product_search: '' };
                  }
                  return updated;
                });
              }, 150)}
            />
            {item.product_search && !item.product_id && (
              <div style={{
                position: 'absolute', top: 38, left: 0, right: 0, zIndex: 20,
                background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8,
                boxShadow: '0 10px 20px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto'
              }}>
                {getProductSuggestions(products, item.product_search).map(prod => (
                  <button key={prod.id} type="button" onMouseDown={() => selectProduct(idx, prod)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                      background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--gray-900)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10
                    }}>
                    <span>{prod.name}</span>
                    {prod.pack_size && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                        {prod.pack_size}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input className="form-control" style={colStyle} readOnly placeholder="Pack size" value={item.pack_size} />
          <select className="form-control" style={colStyle} value={item.batch_no}
            onChange={e => updateItem(idx, 'batch_no', e.target.value)} disabled={!item._batches?.length}>
            <option value="">— Batch —</option>
            {(() => {
              const used = usedBatchKeys(items, idx);
              return (item._batches || [])
                .filter(b => b.batch_no === item.batch_no || !used.has(`${item.product_id}::${b.batch_no}`))
                .map(b => <option key={b.batch_no} value={b.batch_no}>{b.batch_no} (Avail: {b.qty})</option>);
            })()}
          </select>
          {(() => {
            const e = getItemErrors(item);
            return (
              <div>
                <input className="form-control" type="number" step="1" min="1" style={{ ...colStyle, borderColor: (e.belowMinQty || e.overQty) ? 'var(--red)' : undefined }}
                  placeholder="Qty" value={item.qty}
                  onChange={ev => updateItem(idx, 'qty', ev.target.value)}
                  onWheel={blockNumberWheel}
                  inputMode="numeric" />
                {e.belowMinQty && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Qty must be ≥ 1</div>}
                {e.overQty && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Qty+Bonus max: {e.maxQty}</div>}
              </div>
            );
          })()}
          {(() => {
            const e = getItemErrors(item);
            return (
              <div>
                <input className="form-control" type="number" step="1" min="1" style={{ ...colStyle, borderColor: e.belowMinRate ? 'var(--red)' : undefined }}
                  placeholder="Rate" value={item.sale_rate} onChange={ev => updateItem(idx, 'sale_rate', ev.target.value)}
                  onWheel={blockNumberWheel} />
                {e.belowMinRate && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Rate must be ≥ 1</div>}
              </div>
            );
          })()}
          {(() => {
            const e = getItemErrors(item);
            return (
              <div>
                <input className="form-control no-spinner" type="number" step="1" min="0" style={{ ...colStyle, borderColor: e.negBonus ? 'var(--red)' : undefined }}
                  placeholder="0" value={item.bonus} onChange={ev => updateItem(idx, 'bonus', ev.target.value)}
                  onWheel={blockNumberWheel}
                  inputMode="numeric" />
                {e.negBonus && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Bonus can't be -ve</div>}
              </div>
            );
          })()}
          {(() => {
            const e = getItemErrors(item);
            return (
              <div>
                <input className="form-control no-spinner" type="number" step="0.5" min="0" max="100" style={{ ...colStyle, borderColor: e.negDisc ? 'var(--red)' : undefined }}
                  placeholder="0%" value={item.discount_pct} onChange={ev => updateItem(idx, 'discount_pct', ev.target.value)}
                  onWheel={blockNumberWheel}
                  inputMode="decimal" />
                {e.negDisc && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Disc% can't be -ve</div>}
              </div>
            );
          })()}
          {(() => {
            const e = getItemErrors(item);
            return (
              <div>
                <input className="form-control no-spinner" type="number" step="0.5" min="0" max="100" style={{ ...colStyle, borderColor: e.negTax ? 'var(--red)' : undefined }}
                  placeholder="0%" value={item.tax_pct} onChange={ev => updateItem(idx, 'tax_pct', ev.target.value)}
                  onWheel={blockNumberWheel}
                  inputMode="decimal" />
                {e.negTax && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 1 }}>Tax% can't be -ve</div>}
              </div>
            );
          })()}
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--green)', textAlign: 'right' }}>
            {item.total > 0 ? fmt(item.total) : '—'}
          </div>
          <button className="btn btn-danger btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); removeItem(idx); }}
            disabled={items.length === 1} title="Remove row"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, borderRadius: 4, fontSize: 12, lineHeight: 1, boxSizing: 'border-box' }}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}

      <button className="btn btn-outline btn-sm mt-2" onClick={addItem}>+ Add Row</button>

      <RateInfoPanel
        rateHistory={rateHistory}
        activeRowIdx={activeRowIdx}
        activeItem={activeRowIdx !== null ? items[activeRowIdx] : null}
        canViewPurchaseRates={canViewPurchaseRates}
      />
    </>
  );
}

// Standalone searchable product-filter field for the invoice-table filter panel.
// Mirrors the product search UX used inside the Add/Edit Invoice modal
// (getProductSuggestions), but is deliberately backed by the FULL product
// list (not the active-batch-only list) so users can filter by a product
// that no longer has active stock but still appears on old invoices.
function ProductFilterAutocomplete({ products, value, onChange, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // Keep the visible text in sync with an externally-set value (e.g. Clear Filters)
  useEffect(() => {
    if (!value) { setSearch(''); return; }
    const prod = products.find(p => p.id === value || p.id === parseInt(value));
    if (prod) setSearch(prod.name);
  }, [value, products]);

  const suggestions = getProductSuggestions(products, search);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder={placeholder}
        autoComplete="off"
        value={search}
        onChange={e => {
          setSearch(e.target.value);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onChange(''); setSearch(''); }}
          title="Clear"
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--gray-400)', fontSize: 16, lineHeight: 1, padding: 2
          }}
        >×</button>
      )}
      {open && search && !value && (
        <div style={{
          position: 'absolute', top: 38, left: 0, right: 0, zIndex: 60,
          background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8,
          boxShadow: '0 10px 20px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto'
        }}>
          {suggestions.length === 0 ? (
            <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--gray-400)' }}>No products found</div>
          ) : suggestions.map(prod => (
            <button key={prod.id} type="button" onMouseDown={() => { onChange(prod.id); setSearch(prod.name); setOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--gray-900)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10
              }}>
              <span>{prod.name}</span>
              {prod.pack_size && (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                  {prod.pack_size}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sale() {
  const { user, can } = useAuth();
  const [sales, setSales] = useState([]);

  // Filters — collapsed and inactive by default.
  // `draftFilters` is what the fields in the open panel edit; it only takes
  // effect on `filters` (which actually drives filteredSales) once the user
  // hits Apply — so typing/selecting doesn't refilter the table on every
  // keystroke.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const emptyFilters = { customer_id: '', salesman_id: '', delivery_by: '', date_from: '', date_to: '', status: 'all', invoice_no: '', product_id: '', print_status: 'all' };
  const [filters, setFilters] = useState(emptyFilters);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  // Sortable table column state. Declared alongside the filter state
  // because the sortedSales useMemo below reads it — keeping the two
  // in the same block avoids a temporal-dead-zone error at mount.
  // Defaults to date DESC — matches the backend's
  // `ORDER BY s.date DESC, s.id DESC`, so an operator who never touches
  // a header sees the same order the server delivered.
  const [sortConfig, setSortConfig] = useState({ column: 'date', direction: 'desc' });
  // Both `status` and `print_status` are segmented enums whose "off" value
  // is 'all' rather than empty — treat them the same way when counting
  // active filters and when checking whether the filter set is empty.
  const ENUM_FILTER_KEYS = new Set(['status', 'print_status']);
  const isEmptyFilters = (f) => Object.entries(f).every(([k, v]) => ENUM_FILTER_KEYS.has(k) ? v === 'all' : !v);
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => ENUM_FILTER_KEYS.has(k) ? v !== 'all' : !!v).length;
  const clearFilters = () => { setDraftFilters(emptyFilters); setFilters(emptyFilters); };
  const applyFilters = () => { setFilters(draftFilters); setFiltersOpen(false); };

  const filteredSales = useMemo(() => {
    const invoiceQuery = filters.invoice_no.trim().toLowerCase();
    const productFilterId = filters.product_id ? String(filters.product_id) : '';
    return sales.filter(s => {
      if (filters.customer_id && String(s.customer_id) !== String(filters.customer_id)) return false;
      if (filters.salesman_id && String(s.salesman_id) !== String(filters.salesman_id)) return false;
      if (filters.delivery_by && String(s.delivery_by) !== String(filters.delivery_by)) return false;
      if (filters.date_from && s.date < filters.date_from) return false;
      if (filters.date_to && s.date > filters.date_to) return false;
      if (filters.status === 'open' && s.is_locked) return false;
      if (filters.status === 'locked' && !s.is_locked) return false;
      if (filters.print_status === 'unprinted' && s.printed_at) return false;
      if (filters.print_status === 'printed' && !s.printed_at) return false;
      if (invoiceQuery && !(s.invoice_no || '').toLowerCase().includes(invoiceQuery)) return false;
      if (productFilterId) {
        // product_ids comes from the backend as a comma-separated string of
        // every distinct product_id sold on that invoice (see GET /sales).
        const productIds = (s.product_ids || '').split(',').filter(Boolean);
        if (!productIds.includes(productFilterId)) return false;
      }
      return true;
    });
  }, [sales, filters]);

  // Sort applied on top of filteredSales. Kept in its own useMemo so
  // toggling sort direction doesn't re-run the filter predicate (which
  // is more expensive on large sales lists).
  const sortedSales = useMemo(() => {
    const cmp = SORT_COMPARATORS[sortConfig.column];
    if (!cmp) return filteredSales;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return [...filteredSales].sort((a, b) => cmp(a, b) * dir);
  }, [filteredSales, sortConfig]);

  // --- Pagination is disabled for now (client-side slicing doesn't make
  // sense once the backend paginates too). Left in place, commented, so it
  // can be reactivated as soon as GET /sales accepts page & pageSize and
  // returns { rows, totalItems } instead of the full array. ---
  // const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedSales } = usePagination(filteredSales, 25);
  // useEffect(() => { setPage(1); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const pagedSales = sortedSales;
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [products, setProducts] = useState([]);
  // Unfiltered product list (all products, regardless of active-batch stock),
  // used only by the invoice-table Product filter — a product with no current
  // stock can still legitimately appear on old invoices and should stay
  // filterable.
  const [allProducts, setAllProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [geo, setGeo] = useState({ cities: [], areas: [], territories: [] });
  const [loading, setLoading] = useState(true);

  // Modals
  const [modal, setModal] = useState(false);   // 'add' | 'edit' | null
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [newCustModal, setNewCustModal] = useState(false);

  const [selected, setSelected] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ─── Bulk print state ────────────────────────────────────────────────
  // Bulk print only surfaces when the filter panel is active. Every row
  // in filteredSales is IMPLICITLY included; `excludedIds` tracks the
  // rows the operator has explicitly unchecked to refine the batch.
  // When the filter set changes, exclusions reset so a new query starts
  // fresh.
  const [excludedIds, setExcludedIds] = useState(() => new Set());

  // Row-level Print picker (Warranty / +10% / Non-Warranty). Populated
  // by the row's Print button; the modal invokes /sales/print-batch with
  // a single id and the chosen type. Bulk print is always Smart and
  // never opens this modal.
  //
  // NOTE: sortConfig lives up with the filter state (before the
  // filteredSales / sortedSales useMemos) to avoid a TDZ error at mount.
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printSaleTarget, setPrintSaleTarget] = useState(null);

  // Form state
  const [header, setHeader] = useState({ customer_id: '', salesman_id: '', delivery_by: '', date: today() });
  const [items, setItems] = useState([createSaleItem()]);
  const [activeRowIdx, setActiveRowIdx] = useState(null);
  const [rateHistory, setRateHistory] = useState({});

  // New customer form
  const [newCustForm, setNewCustForm] = useState({ name: '', phone: '', address: '', city_id: '' });
  const [savingCust, setSavingCust] = useState(false);
  const canViewPurchaseRates = user?.role === 'admin' || can('perm_view_purchase_rate');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/sales'), api.get('/customers'),
      api.get('/employees?role=Salesman'), api.get('/products'),
      api.get('/geography/geo'), api.get('/employees?role=Supplier'),
      api.get('/inventory/active-products')
    ]).then(([s, c, e, p, g, sup, activeIds]) => {
      const activeSet = new Set(activeIds.data || []);
      setSales(s.data); setCustomers(c.data); setEmployees(e.data);
      // Full product list — used by the invoice-table Product filter, which
      // needs to match against products on old invoices even if those
      // products have since gone out of stock.
      setAllProducts(p.data);
      // Only list products that currently have at least one active batch
      // (qty > 0 and not expired) so users can't start a sale for dead stock.
      setProducts(p.data.filter(prod => activeSet.has(prod.id)));
      setGeo(g.data); setSuppliers(sup.data); setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  // Reset the bulk-print exclusion set whenever the applied filter set
  // changes — the operator's intent for a new query is to print every
  // row in that new result set until they explicitly opt some out. Same
  // reasoning applies when filters are cleared: no stale exclusions
  // carry over.
  useEffect(() => {
    setExcludedIds(new Set());
  }, [filters]);

  const calcTotal = (item) => {
    const qty = parseFloat(item.qty) || 0;
    const rate = parseFloat(item.sale_rate) || 0;
    const disc = parseFloat(item.discount_pct) || 0;
    const tax = parseFloat(item.tax_pct) || 0;
    // Bonus = free extra units delivered at no charge; invoice is based on qty only (not qty+bonus)
    const gross = qty * rate;
    const discAmt = gross * disc / 100;
    const afterDisc = gross - discAmt;
    const taxAmt = afterDisc * tax / 100;
    return +(afterDisc + taxAmt).toFixed(2);
  };

  const loadBatches = async (product_id) => {
    if (!product_id) return [];
    try {
      // active_only: server excludes zero-qty and expired batches (expiry
      // judged by year+month only — a batch is still valid through the end
      // of its expiry month).
      const r = await api.get(`/inventory/product/${product_id}?active_only=1`);
      return r.data.filter(b => b.qty > 0);
    } catch { return []; }
  };

  // Same as loadBatches, but for edit mode: if the row's originally-saved
  // batch is no longer "active" (fully depleted or expired since this
  // invoice was created), keep it in the list anyway so it stays visible/
  // selectable — this invoice still holds that stock until the edit is saved.
  const loadBatchesForRow = async (product_id, keepBatchNo) => {
    const batches = await loadBatches(product_id);
    if (keepBatchNo && !batches.some(b => b.batch_no === keepBatchNo)) {
      try {
        const r = await api.get(`/inventory/check-batch?product_id=${product_id}&batch_no=${keepBatchNo}`);
        if (r.data) batches.push(r.data);
      } catch { /* ignore — batch just won't show up */ }
    }
    return batches;
  };

  // Given a product's active batches, decide which one (if any) to
  // auto-select: the only batch if there's just one, otherwise the batch
  // with the shortest (minimum/soonest) upcoming expiry date — i.e. the
  // stock that needs to move first.
  const pickDefaultBatch = (batches) => {
    if (!batches || batches.length === 0) return null;
    if (batches.length === 1) return batches[0];
    return batches.reduce((best, b) => {
      if (!best) return b;
      if (!b.exp_date) return best;
      if (!best.exp_date) return b;
      return new Date(b.exp_date) < new Date(best.exp_date) ? b : best;
    }, null);
  };

  // product_id+batch_no keys already used by OTHER rows, so a batch can't be
  // picked twice across the invoice. Excludes the row at `excludeIdx` itself.
  const usedBatchKeys = (itemsArr, excludeIdx) => new Set(
    itemsArr
      .filter((it, i) => i !== excludeIdx && it.product_id && it.batch_no)
      .map(it => `${it.product_id}::${it.batch_no}`)
  );

  // Max qty+bonus allowed for a row's currently selected batch. In edit mode,
  // if the row's batch is unchanged from what this invoice originally had,
  // the stock this invoice already "owns" (previous qty + previous bonus) is
  // added back on top of the current available qty, since that stock was
  // deducted from inventory when the sale was first created and hasn't been
  // released back yet (only happens on save):
  //   (Previous Qty + Previous Bonus + Available Qty) >= (New Qty + New Bonus)
  const getMaxQtyForItem = (item) => {
    const batch = (item._batches || []).find(b => b.batch_no === item.batch_no);
    if (!batch) return Infinity;
    let maxQty = parseFloat(batch.qty) || 0;
    if (item._original && item._original.batch_no === item.batch_no) {
      maxQty += (parseFloat(item._original.qty) || 0) + (parseFloat(item._original.bonus) || 0);
    }
    return maxQty;
  };

  const loadRateHistory = useCallback(async (idx, product_id, customer_id, product_name) => {
    if (!product_id || !customer_id) {
      setRateHistory(prev => ({ ...prev, [idx]: null }));
      return;
    }
    try {
      const r = await api.get(`/sales/history/rates?product_id=${product_id}&customer_id=${customer_id}`);
      setRateHistory(prev => ({ ...prev, [idx]: { ...r.data, product_name } }));
    } catch { }
  }, []);

  const selectProduct = async (idx, product) => {
    setActiveRowIdx(idx);
    setItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx] };
      it.product_id = product.id;
      it.product_search = product.name;
      it.product_name = product.name;
      it.pack_size = product.pack_size || '';
      it.sale_rate = product.sale_rate || '';
      it.batch_no = '';
      it._batches = [];
      it.total = calcTotal(it);
      updated[idx] = it;
      return updated;
    });
    loadRateHistory(idx, product.id, header.customer_id, product.name);
    const batches = await loadBatches(product.id);
    setItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx], _batches: batches };
      const used = usedBatchKeys(prev, idx);
      const candidates = batches.filter(b => !used.has(`${product.id}::${b.batch_no}`));
      const defaultBatch = pickDefaultBatch(candidates);
      if (defaultBatch) {
        it.batch_no = defaultBatch.batch_no;
        if (parseFloat(defaultBatch.sale_rate) > 0) it.sale_rate = defaultBatch.sale_rate;
      }
      it.total = calcTotal(it);
      updated[idx] = it;
      return updated;
    });
  };

  const updateItem = async (idx, field, value) => {
    setItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx], [field]: value };
      if (field === 'product_search') {
        it.product_id = '';
        it.product_name = '';
        it.pack_size = '';
        it.sale_rate = '';
        it.batch_no = '';
        it._batches = [];
      }
      if (field === 'product_id') {
        const prod = products.find(p => p.id === parseInt(value));
        if (prod) {
          it.product_name = prod.name;
          it.pack_size = prod.pack_size || '';
          it.sale_rate = prod.sale_rate || '';
          it.batch_no = '';
          it._batches = [];
        } else {
          it.product_name = '';
        }
      }
      it.total = calcTotal(it);
      updated[idx] = it;
      return updated;
    });
    if (field === 'product_id' && value) {
      setActiveRowIdx(idx);
      const batches = await loadBatches(value);
      const prod = products.find(p => p.id === parseInt(value));
      setItems(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], _batches: batches };
        const used = usedBatchKeys(prev, idx);
        const candidates = batches.filter(b => !used.has(`${value}::${b.batch_no}`));
        const defaultBatch = pickDefaultBatch(candidates);
        if (defaultBatch) {
          updated[idx].batch_no = defaultBatch.batch_no;
          if (parseFloat(defaultBatch.sale_rate) > 0) updated[idx].sale_rate = defaultBatch.sale_rate;
        }
        updated[idx].total = calcTotal(updated[idx]);
        return updated;
      });
      loadRateHistory(idx, value, header.customer_id, prod?.name);
    }
    if (field === 'batch_no' && value) {
      setItems(prev => {
        const it = prev[idx];
        const batch = it._batches.find(b => b.batch_no === value);
        if (batch && parseFloat(batch.sale_rate) > 0) {
          const updated = [...prev];
          updated[idx] = { ...it, sale_rate: batch.sale_rate };
          updated[idx].total = calcTotal(updated[idx]);
          return updated;
        }
        return prev;
      });
    }
  };

  // When customer changes, refresh all rate histories
  useEffect(() => {
    items.forEach((it, idx) => {
      if (it.product_id && header.customer_id) {
        loadRateHistory(idx, it.product_id, header.customer_id, it.product_name);
      }
    });
  // eslint-disable-next-line
  }, [header.customer_id]);

  const addItem = () => { setItems(p => [...p, createSaleItem()]); };
  const removeItem = (idx) => {
    setItems(p => p.filter((_, i) => i !== idx));
    // Re-key rateHistory so it stays aligned with the shifted row indices
    // instead of leaving stale/misplaced entries behind.
    setRateHistory(prev => {
      const next = {};
      Object.keys(prev).forEach(k => {
        const i = parseInt(k, 10);
        if (i < idx) next[i] = prev[k];
        else if (i > idx) next[i - 1] = prev[k];
      });
      return next;
    });
    setActiveRowIdx(prev => {
      if (prev === null) return null;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };
  // Centralized per-row validation so the inline row errors, the Save-button
  // disable check, and the pre-submit guard all agree on the same rules:
  //   - Qty must be at least 1 (and, together with bonus, within available stock)
  //   - Sale Rate must be at least 1
  //   - Bonus, Disc%, Tax% must not be negative
  const getItemErrors = (item) => {
    const num = (v) => (v === '' || v === null || v === undefined) ? null : parseFloat(v);

    const qtyNum = num(item.qty);
    const belowMinQty = qtyNum !== null && (isNaN(qtyNum) || qtyNum < 1);
    const maxQty = getMaxQtyForItem(item);
    const totalDispatched = (qtyNum === null || isNaN(qtyNum) ? 0 : qtyNum) + (parseFloat(item.bonus) || 0);
    const overQty = !belowMinQty && qtyNum !== null && totalDispatched > maxQty;

    const rateNum = num(item.sale_rate);
    const belowMinRate = rateNum !== null && (isNaN(rateNum) || rateNum < 1);

    const bonusNum = num(item.bonus);
    const negBonus = bonusNum !== null && (isNaN(bonusNum) || bonusNum < 0);

    const discNum = num(item.discount_pct);
    const negDisc = discNum !== null && (isNaN(discNum) || discNum < 0);

    const taxNum = num(item.tax_pct);
    const negTax = taxNum !== null && (isNaN(taxNum) || taxNum < 0);

    return { belowMinQty, overQty, maxQty, belowMinRate, negBonus, negDisc, negTax };
  };

  const grandTotal = items.reduce((s, it) => s + (parseFloat(it.total) || 0), 0);
  // Any row that fails any of the checks above
  const hasInvalidItems = items.some(it => {
    const e = getItemErrors(it);
    return e.belowMinQty || e.overQty || e.belowMinRate || e.negBonus || e.negDisc || e.negTax;
  });

  const openAdd = () => {
    setSelected(null); setHeader({ customer_id: '', salesman_id: '', delivery_by: '', date: today() });
    setItems([{ ...emptySaleItem }]); setRateHistory({}); setActiveRowIdx(null);
    setModal('add');
  };

  const openEdit = async (sale) => {
    if (sale.is_locked) return toast.error('This invoice is locked after recovery and cannot be edited.');
    try {
      const r = await api.get(`/sales/${sale.id}`);
      setSelected(r.data);
      setHeader({ customer_id: r.data.customer_id, salesman_id: r.data.salesman_id || '', delivery_by: r.data.delivery_by || '', date: r.data.date.split('T')[0] });
      const mappedItems = await Promise.all(r.data.items.map(async (it) => {
        const batches = await loadBatchesForRow(it.product_id, it.batch_no);
        return {
          ...createSaleItem(), product_id: it.product_id, product_search: it.product_name || '', product_name: it.product_name,
          pack_size: it.pack_size || '', batch_no: it.batch_no || '', sale_rate: it.sale_rate, qty: it.qty, bonus: it.bonus || 0,
          discount_pct: it.discount_pct || 0, tax_pct: it.tax_pct || 0, total: it.total, _batches: batches,
          // Snapshot of what this row's stock impact already is, so qty validation can
          // add it back to the currently available qty for this same batch.
          _original: { batch_no: it.batch_no || '', qty: parseFloat(it.qty) || 0, bonus: parseFloat(it.bonus) || 0 }
        };
      }));
      setItems(mappedItems); setRateHistory({});
      // Load rate info directly rather than relying on the customer-change
      // effect, since editing back-to-back invoices for the SAME customer
      // means header.customer_id never actually changes value — that effect
      // wouldn't fire and rate info would silently stay empty.
      mappedItems.forEach((it, idx) => {
        if (it.product_id) loadRateHistory(idx, it.product_id, r.data.customer_id, it.product_name);
      });
      setActiveRowIdx(mappedItems.length ? 0 : null);
      setModal('edit');
    } catch { toast.error('Error loading sale'); }
  };

  const openView = async (sale) => {
    try {
      const r = await api.get(`/sales/${sale.id}`);
      setViewData(r.data); setViewModal(true);
    } catch { toast.error('Error loading sale'); }
  };

  const handleSave = async () => {
    if (!header.customer_id) return toast.error('Please select a customer');
    if (!header.date) return toast.error('Date is required');
    const validItems = items.filter(it => it.product_id && it.qty && it.sale_rate && it.batch_no);
    if (validItems.length === 0) return toast.error('Add at least one product with batch, qty and rate');
    // Validate qty, sale rate, bonus, disc%, tax% via the shared per-row rules
    for (const it of validItems) {
      const e = getItemErrors(it);
      if (e.belowMinQty) return toast.error(`Qty for ${it.product_name} must be at least 1`);
      if (e.belowMinRate) return toast.error(`Sale Rate for ${it.product_name} must be at least 1`);
      if (e.negBonus) return toast.error(`Bonus for ${it.product_name} cannot be negative`);
      if (e.negDisc) return toast.error(`Disc% for ${it.product_name} cannot be negative`);
      if (e.negTax) return toast.error(`Tax% for ${it.product_name} cannot be negative`);
    }
    // Prevent the same product+batch being selected in more than one row
    const seenKeys = new Set();
    for (const it of validItems) {
      const key = `${it.product_id}::${it.batch_no}`;
      if (seenKeys.has(key)) {
        return toast.error(`${it.product_name} (batch ${it.batch_no}) is selected in more than one row`);
      }
      seenKeys.add(key);
    }
    // Validate qty+bonus against inventory (both are physically dispatched).
    // In edit mode, a row's own previously-reserved qty+bonus is folded back
    // into the available qty for that same batch (see getMaxQtyForItem).
    for (const it of validItems) {
      const maxQty = getMaxQtyForItem(it);
      const totalDispatched = parseFloat(it.qty || 0) + parseFloat(it.bonus || 0);
      if (totalDispatched > maxQty) {
        return toast.error(`Qty + Bonus for ${it.product_name} (batch ${it.batch_no}) exceeds available stock (${maxQty} units)`);
      }
    }
    setSaving(true);
    try {
      let result;
      if (modal === 'edit' && selected) {
        await api.put(`/sales/${selected.id}`, { ...header, items: validItems });
        toast.success('Sale updated!');
        setModal(false); load();
      } else {
        result = await api.post('/sales', { ...header, items: validItems });
        // New invoices default to "unprinted" (sales.printed_at IS NULL)
        // and land at the top of the Sales list. Operators either print
        // them one-off from the row's Print action or select them into
        // the Bulk Print flow — no post-save prompt.
        toast.success(`Invoice ${result.data.invoice_no} saved`);
        setModal(false);
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/sales/${selected.id}`);
      toast.success('Sale deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error deleting'); } finally { setDeleting(false); }
  };

  const saveNewCustomer = async () => {
    if (!newCustForm.name) return toast.error('Name required');
    setSavingCust(true);
    try {
      const r = await api.post('/customers', newCustForm);
      const newList = await api.get('/customers');
      setCustomers(newList.data);
      setHeader(p => ({ ...p, customer_id: r.data.id }));
      setNewCustModal(false);
      setNewCustForm({ name: '', phone: '', address: '', city_id: '' });
      toast.success('Customer added');
    } catch { toast.error('Error'); } finally { setSavingCust(false); }
  };

  const fmt = formatCurrency;
  const colStyle = { fontSize: 12, padding: '6px 8px' };
  // Product | Pack Size | Batch No | Qty | Sale Rate | Bonus | Disc% | Tax% | Total | remove
  // Pack Size reduced ~35% and Qty trimmed ~18% off its widened value; both
  // give their freed space to Batch No, which needs the most room to fit
  // batch numbers.
  const gridCols = '2fr 0.65fr 1.57fr 0.78fr 1fr 0.6fr 0.6fr 0.6fr 1fr 36px';

  // ─── Bulk print helpers (derived state) ──────────────────────────────
  // Bulk print is opt-in: it only surfaces when the filter panel actually
  // constrains the visible set. Without filters the Sales page stays a
  // clean browse view — no checkbox column, no toolbar action.
  const hasActiveFilters = activeFilterCount > 0;

  // Row → checkbox state derives directly from excludedIds. A row is
  // "included" (checkbox ON) when the operator hasn't ticked it off.
  const isRowIncluded = (id) => !excludedIds.has(id);
  const toggleRowInclusion = (id) => setExcludedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Header checkbox mirrors ONLY the currently visible rows — clicking
  // it toggles inclusion for every row in filteredSales. Tri-state via
  // the input's `indeterminate` DOM property (React doesn't expose it
  // as an attribute).
  const includedInView = filteredSales.reduce((n, s) => n + (isRowIncluded(s.id) ? 1 : 0), 0);
  const headerCheckboxChecked = filteredSales.length > 0 && includedInView === filteredSales.length;
  const headerCheckboxIndeterminate = includedInView > 0 && includedInView < filteredSales.length;
  const toggleHeaderCheckbox = () => {
    if (headerCheckboxChecked) {
      setExcludedIds(prev => {
        const next = new Set(prev);
        filteredSales.forEach(s => next.add(s.id));
        return next;
      });
    } else {
      setExcludedIds(prev => {
        const next = new Set(prev);
        filteredSales.forEach(s => next.delete(s.id));
        return next;
      });
    }
  };

  // Ids that will actually be sent to the batch-print preview when the
  // operator clicks Print. Empty (and the toolbar CTA vanishes) when no
  // filters are active.
  const printableIds = hasActiveFilters
    ? filteredSales.filter(s => isRowIncluded(s.id)).map(s => s.id)
    : [];
  const printableCount = printableIds.length;

  const handleBulkPrint = () => {
    if (printableCount === 0) {
      return toast.error('Nothing to print — refine your filters or re-check some rows.');
    }
    // Bulk print is intentionally always Smart: the type is resolved per
    // invoice from customers.is_licensed. Per-invoice type overrides are
    // only available through the row-level Print action (PrintOptionsModal).
    openBatchPrint(printableIds, 'smart');
  };

  // Column sort cycles asc ↔ desc on the active column, or switches to
  // a new column (starting ascending).
  const handleSort = (col) => {
    setSortConfig(prev => (
      prev.column === col
        ? { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column: col, direction: 'asc' }
    ));
  };

  return (
    <Layout title="Sale">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Sales Invoices</div>
            <div className="text-sm text-muted mt-1">
              {activeFilterCount > 0 ? `${filteredSales.length} of ${sales.length} invoices` : `${sales.length} invoices`}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-outline"
              onClick={() => setFiltersOpen(o => !o)}
              style={{
                justifyContent: 'center',
                padding: '9px 12px',
                background: '#fff',
                color: 'var(--gray-500)',
                borderColor: 'var(--gray-200)',
                fontWeight: 550
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 0, color: 'var(--gray-400)' }}>filter_list</span>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginLeft: 0, color: 'var(--gray-400)' }}>
                {filtersOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {/* Bulk Print CTA — only appears when the filter set is
                actually constraining the visible rows. Kept as a distinct
                surface from the primary "+ New Sale" so it never competes
                for the primary action slot. */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleBulkPrint}
                disabled={printableCount === 0}
                style={{
                  padding: '9px 14px',
                  background: printableCount === 0 ? 'var(--gray-100)' : 'var(--blue-ultra, #eff6ff)',
                  color: printableCount === 0 ? 'var(--gray-400)' : 'var(--navy, #1e3a8a)',
                  border: `1px solid ${printableCount === 0 ? 'var(--gray-200)' : 'var(--blue-light, #93c5fd)'}`,
                  borderRadius: 6,
                  fontWeight: 650,
                  fontSize: 13,
                  cursor: printableCount === 0 ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.2s ease, border-color 0.2s ease'
                }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
                Print {printableCount} invoice{printableCount === 1 ? '' : 's'}
              </button>
            )}
            <button className="btn btn-primary" onClick={openAdd}>+ New Sale Invoice</button>
          </div>
        </div>

        <div
          style={{
            maxHeight: filtersOpen ? 520 : 0,
            opacity: filtersOpen ? 1 : 0,
            // Once open, allow the product-filter dropdown to escape this
            // container's bounds instead of being clipped by it.
            overflow: filtersOpen ? 'visible' : 'hidden',
            background: '#fff',
            borderTop: filtersOpen ? '1px solid var(--gray-200)' : 'none',
            borderBottom: filtersOpen ? '1px solid var(--gray-200)' : 'none',
            transition: 'max-height 0.32s ease, opacity 0.24s ease, border-color 0.24s ease',
            // Establish a stacking context above the table below so the
            // dropdown suggestion list always paints on top of it.
            position: 'relative',
            zIndex: 30
          }}
        >
          <div style={{ padding: '18px 20px' }}>
            {/* Balanced 3\u00d73 filter grid \u2014 no bolted-on rows, no empty
                cells. Row 1 = who ordered / delivered, Row 2 = when +
                invoice no, Row 3 = what + state (Status, Print Status). */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 14 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Customer</label>
                <CustomerAutocomplete
                  customers={customers}
                  areas={geo?.areas}
                  territories={geo?.territories}
                  value={draftFilters.customer_id}
                  onChange={id => setDraftFilters(p => ({ ...p, customer_id: id }))}
                  placeholder="Search customer…"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Salesman</label>
                <select className="form-control" value={draftFilters.salesman_id}
                  onChange={e => setDraftFilters(p => ({ ...p, salesman_id: e.target.value }))}>
                  <option value="">— All Salesmen —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Delivery By</label>
                <select className="form-control" value={draftFilters.delivery_by}
                  onChange={e => setDraftFilters(p => ({ ...p, delivery_by: e.target.value }))}>
                  <option value="">— All Suppliers —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 14 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Date From</label>
                <input className="form-control" type="date" value={draftFilters.date_from}
                  onChange={e => setDraftFilters(p => ({ ...p, date_from: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Date To</label>
                <input className="form-control" type="date" value={draftFilters.date_to}
                  onChange={e => setDraftFilters(p => ({ ...p, date_to: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Invoice No</label>
                <input className="form-control" placeholder="Search invoice no…" value={draftFilters.invoice_no}
                  onChange={e => setDraftFilters(p => ({ ...p, invoice_no: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Product</label>
                <ProductFilterAutocomplete
                  products={allProducts}
                  value={draftFilters.product_id}
                  onChange={id => setDraftFilters(p => ({ ...p, product_id: id }))}
                  placeholder="Search product…"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Status</label>
                <SegmentedFilter
                  options={[{ v: 'open', l: 'Open' }, { v: 'locked', l: 'Locked' }, { v: 'all', l: 'All' }]}
                  value={draftFilters.status}
                  onChange={v => setDraftFilters(p => ({ ...p, status: v }))}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Print Status</label>
                <SegmentedFilter
                  options={[{ v: 'unprinted', l: 'Not printed' }, { v: 'printed', l: 'Printed' }, { v: 'all', l: 'All' }]}
                  value={draftFilters.print_status}
                  onChange={v => setDraftFilters(p => ({ ...p, print_status: v }))}
                />
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--gray-100)'
            }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={clearFilters}
                disabled={isEmptyFilters(draftFilters) && isEmptyFilters(filters)}
                style={{ background: 'transparent', border: 'none', color: 'var(--gray-500)', fontWeight: 600, padding: '8px 4px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>filter_alt_off</span>
                Clear Filters
              </button>
              <button type="button" className="btn btn-primary" onClick={applyFilters}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>search</span>
                Apply Filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
            : sales.length === 0 ? <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>sell</span></div><div className="empty-state-title">No sales yet</div></div>
            : filteredSales.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>filter_alt_off</span></div>
                <div className="empty-state-title">No invoices match your filters</div>
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={clearFilters}>Clear Filters</button>
              </div>
            )
            : (
              <table>
                <thead>
                  <tr>
                    {hasActiveFilters && (
                      <th style={{ width: 36 }}>
                        <input type="checkbox"
                          checked={headerCheckboxChecked}
                          ref={el => { if (el) el.indeterminate = headerCheckboxIndeterminate; }}
                          onChange={toggleHeaderCheckbox}
                          title="Include every visible invoice in bulk print" />
                      </th>
                    )}
                    <SortableHeader column="invoice_no"       label="Invoice No"  sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="customer_name"    label="Customer"    sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="salesman_name"    label="Salesman"    sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="delivery_by_name" label="Delivery By" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="date"             label="Date"        sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader column="total_amount"     label="Total"       sortConfig={sortConfig} onSort={handleSort} align="right" />
                    <SortableHeader column="is_locked"        label="Status"      sortConfig={sortConfig} onSort={handleSort} />
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSales.map(s => {
                    const included = isRowIncluded(s.id);
                    // Fade excluded rows so it's obvious which invoices are
                    // out of the current bulk-print set without stripping
                    // them from the visible table.
                    const rowStyle = hasActiveFilters && !included
                      ? { opacity: 0.5, background: 'var(--gray-50)' }
                      : undefined;
                    return (
                      <tr key={s.id} style={rowStyle}>
                        {hasActiveFilters && (
                          <td>
                            <input type="checkbox"
                              checked={included}
                              onChange={() => toggleRowInclusion(s.id)} />
                          </td>
                        )}
                        <td className="mono" style={{ color: 'var(--gray-700)' }}>{s.invoice_no}</td>
                        <td>{s.customer_name}</td>
                        <td>{s.salesman_name || '—'}</td>
                        <td>{s.delivery_by_name || '—'}</td>
                        <td>{formatDatePKT(s.date)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{fmt(s.total_amount)}</td>
                        <td>
                          {s.is_locked
                            ? <span className="badge badge-amber"><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>lock</span>Locked</span>
                            : <span className="badge badge-green">Open</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm btn-icon" title="View invoice" onClick={() => openView(s)}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                            </button>
                            <button className="btn btn-outline btn-sm btn-icon" title="Print invoice"
                              onClick={() => { setPrintSaleTarget(s); setPrintModalOpen(true); }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>print</span>
                            </button>
                            {!s.is_locked && <button className="btn btn-outline btn-sm btn-icon" title="Edit invoice" onClick={() => openEdit(s)}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                            </button>}
                            {!s.is_locked && <button className="btn btn-danger btn-sm btn-icon" title="Delete invoice" onClick={() => { setSelected(s); setDeleteModal(true); }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                            </button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        {/* Pagination disabled until GET /sales supports server-side page & pageSize.
            Re-enable by restoring the usePagination destructure above and uncommenting this:
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
          pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        */}
      </div>

      {/* Add/Edit Sale Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(false)}
        title={modal === 'edit' ? `Edit Invoice ${selected?.invoice_no}` : 'New Sale Invoice'} size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div style={{ fontWeight: 700, fontSize: 16 }}>Grand Total: <span style={{ color: 'var(--green)' }}>{fmt(grandTotal)}</span></div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-success btn-lg" onClick={handleSave} disabled={saving || hasInvalidItems}>
                {saving ? 'Saving...' : modal === 'edit' ? 'Update Invoice' : 'Save Invoice'}
              </button>
            </div>
          </div>
        }>
        <SaleFormBody
          header={header} setHeader={setHeader}
          customers={customers} employees={employees} suppliers={suppliers}
          setNewCustModal={setNewCustModal}
          items={items} activeRowIdx={activeRowIdx} setActiveRowIdx={setActiveRowIdx}
          updateItem={updateItem} selectProduct={selectProduct} removeItem={removeItem} addItem={addItem}
          setItems={setItems}
          products={products} rateHistory={rateHistory} canViewPurchaseRates={canViewPurchaseRates} geo={geo}
          fmt={fmt} colStyle={colStyle} gridCols={gridCols}
          getMaxQtyForItem={getMaxQtyForItem} usedBatchKeys={usedBatchKeys} getItemErrors={getItemErrors}
        />
      </Modal>

      {/* View Invoice Modal */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)}
        title={`Invoice ${viewData?.invoice_no || ''}`} size="lg">
        {viewData && (
          <div>
            {viewData.is_locked && (
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                🔒 This invoice is locked after recovery entry and cannot be edited.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <div className="text-sm text-muted">Customer</div>
                <div style={{ fontWeight: 700 }}>{viewData.customer_name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{viewData.customer_phone}</div>
                {viewData.license_no && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>License: {viewData.license_no}</div>}
              </div>
              <div>
                <div className="text-sm text-muted">Invoice Details</div>
                <div style={{ color: 'var(--gray-800)' }}>{viewData.invoice_no}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Date: {formatDatePKT(viewData.date)}</div>
                {viewData.salesman_name && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Salesman: {viewData.salesman_name}</div>}
                {viewData.delivery_by_name && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Delivery By: {viewData.delivery_by_name}</div>}
              </div>
            </div>
            <table style={{ marginBottom: 12 }}>
              <thead>
                <tr><th>Product</th><th>Batch</th><th>Qty</th><th>Bonus</th><th>Rate</th><th>Disc%</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {(viewData.items || []).map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{it.product_name}</td>
                    <td className="mono">{it.batch_no || '—'}</td>
                    <td>{it.qty}</td>
                    <td>{it.bonus || 0}</td>
                    <td className="mono">{fmt(it.sale_rate)}</td>
                    <td>{it.discount_pct || 0}%</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right' }}>Grand Total</td>
                  <td style={{ padding: '10px 14px', fontWeight: 800, color: 'var(--green)', textAlign: 'right' }}>{fmt(viewData.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>

      {/* New Customer Mini Modal */}
      <Modal isOpen={newCustModal} onClose={() => setNewCustModal(false)} title="Quick Add Customer" size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setNewCustModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveNewCustomer} disabled={savingCust}>{savingCust ? 'Saving...' : 'Add'}</button></>}>
        <div className="form-group"><label className="form-label">Name *</label>
          <input className="form-control" placeholder="Customer name" value={newCustForm.name} onChange={e => setNewCustForm(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
        <div className="form-group"><label className="form-label">Phone</label>
          <input className="form-control" placeholder="0308 8421202" value={newCustForm.phone}
            onChange={e => handlePhoneInput(e, v => setNewCustForm(p => ({ ...p, phone: v })))} maxLength={16} /></div>
        <div className="form-group"><label className="form-label">City</label>
          <select className="form-control" value={newCustForm.city_id} onChange={e => setNewCustForm(p => ({ ...p, city_id: e.target.value }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting}
        message="Delete this invoice? Inventory will be restored and customer ledger updated." />

      {/* Row-level Print picker. Bulk print goes straight to Smart and
          never opens this modal. */}
      <PrintOptionsModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        invoice={printSaleTarget}
      />
    </Layout>
  );
}
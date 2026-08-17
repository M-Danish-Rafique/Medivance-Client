import { formatDatePKT, todayPKT, addMonthsPKT } from '../../utils/dateUtils';

// Year-month only comparison (day of month ignored) — matches backend rule:
// a batch is only truly "expired" once the calendar month has rolled past its expiry month.
export const isPastExpiryMonth = (expiryStr) => todayPKT().slice(0, 7) > expiryStr.slice(0, 7);

// Shared expiry classification for a return line, used both by the row-level
// display logic in ReturnTable and by the "Return Full Invoice" bulk-fill
// handler, so the two never disagree about which lines are blocked.
export const getExpiryStatus = (exp_date, isAdmin) => {
  if (!exp_date) return { blocked: false, warning: false, label: null };
  const expiryStr = String(exp_date).slice(0, 10);
  const threshold = addMonthsPKT(expiryStr, -5);
  const withinWindow = todayPKT() > threshold;
  const label = formatDatePKT(expiryStr);
  if (!withinWindow) return { blocked: false, warning: false, label };
  if (isPastExpiryMonth(expiryStr)) return { blocked: true, warning: false, label };
  if (isAdmin) return { blocked: false, warning: true, label };
  return { blocked: true, warning: false, label };
};

// Number inputs change value on mouse-wheel/trackpad scroll by default when focused.
// Blurring on wheel disables that, so only the up/down buttons or keyboard editing change the value,
// and the page still scrolls normally underneath the cursor.
export const blockWheelChange = (e) => e.target.blur();

// Returns a human-readable error for a numeric field, or null when it's valid.
// Never modifies the raw value — callers keep whatever the user actually typed
// and use this only to decide whether to show an error / red border / disable Save.
export const fieldError = (raw, max, label, maxLabel) => {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return `Enter a valid number for ${label}`;
  if (n < 0) return `${label} cannot be negative`;
  if (max !== undefined && max !== null && !Number.isNaN(max) && n > max + 0.009) {
    return `${label} cannot exceed ${maxLabel}`;
  }
  return null;
};

// Falls back gracefully for invoices saved before the recovery_status column existed.
export const getRecoveryStatus = (sale) => {
  if (sale.recovery_status) return sale.recovery_status;
  return sale.is_locked ? 'completed' : 'pending';
};

export const getPendingAmount = (sale) => {
  if (sale.pending_amount !== undefined && sale.pending_amount !== null) return parseFloat(sale.pending_amount);
  return sale.is_locked ? 0 : parseFloat(sale.total_amount || 0);
};

export const getRecoveredAmount = (sale) => {
  if (sale.total_recovered !== undefined && sale.total_recovered !== null) return parseFloat(sale.total_recovered);
  return sale.is_locked ? parseFloat(sale.total_amount || 0) : 0;
};

// "Returnable" qty is what's left to return on this line, not what was
// originally sold — sale_items.qty stays frozen at the original sold qty once
// an invoice is locked, so already-returned quantity (from any past recovery
// event, tracked via return_items) has to be subtracted here. Matches the
// server-side guard in recoveries.js exactly — keep the two in sync.
export const getReturnableQty = (item) =>
  Math.max(0, parseInt(item.qty || 0, 10) - parseInt(item.already_returned || 0, 10));

export const createRecoveryReturnLine = (item) => ({
  row_id: `return-${item.id}-${Math.random().toString(16).slice(2)}`,
  sale_item_id: item.id, sale_id: item.sale_id || null, product_id: item.product_id,
  batch_no: item.batch_no, qty_returned: '', return_rate: item.sale_rate, return_amount: 0,
  product_name: item.product_name, original_qty: getReturnableQty(item), exp_date: item.exp_date
});

// For a cross-invoice return: if the source invoice is already fully
// recovered, the return becomes a credit note against the invoice currently
// being settled (no cap tied to the source invoice's own balance). If the
// source invoice is still pending, the return can only reduce ITS OWN
// pending balance — so it's capped there. Mirrors the backend's branch logic
// in classifyReturnLine (recoveries.js).
// Previous-invoice return logic removed; cross-return cap helper no longer needed.
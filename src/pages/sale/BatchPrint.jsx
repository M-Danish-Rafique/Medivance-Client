import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import InvoiceDocument, { INVOICE_STYLES } from './InvoiceDocument';
import { fetchInvoiceRenderData } from '../../utils/invoiceData';
import api from '../../utils/api';

// ─── Bulk Invoice Print preview ────────────────────────────────────────────
// One route (`/sales/print-batch?ids=1,2,3&type=smart`) renders N invoices
// stacked as A4 pages using the same InvoiceDocument the live single-
// invoice `/invoice/:id/print` route uses — so the two outputs are byte-
// identical. The browser's own print dialog then handles either paper
// output or "Save as PDF", so there is no server-side PDF renderer, no
// filename picker, and no filesystem API.
//
// Type resolution
//   type=smart  →  per-invoice: customer.is_licensed ? 'warranty' : 'non-warranty'
//   type=warranty | warranty10 | non-warranty  →  applied uniformly
//
// Auto-print
//   Fires window.print() as soon as every invoice has resolved AND every
//   in-page image (logos) has decoded. Skip with `&preview=1` when an
//   operator wants to eyeball the batch before printing.
//
// Marking printed
//   On the `afterprint` event we POST to /sales/mark-printed once per
//   distinct resolved type in the batch. `afterprint` fires whether the
//   user printed or cancelled — that's a browser limitation. A cancelled
//   print therefore marks the invoices as printed; the operator can
//   simply print again and printed_at will update, so no data is lost.
//
// Batch caps
//   Soft warn at 50 lives on the Sales page (before entering this route).
//   Hard cap at 200 is enforced both here and on the backend
//   POST /sales/mark-printed handler.

const HARD_CAP = 200;
const PRINT_TYPES = new Set(['warranty', 'warranty10', 'non-warranty']);

// Resolve the invoice type to use for one sale, given the batch-level
// selection. Kept as a plain fn so it can be re-used in tests / future
// per-page overrides without touching the component.
function resolveType(saleData, batchType) {
  if (batchType === 'smart') {
    return saleData?.is_licensed ? 'warranty' : 'non-warranty';
  }
  return PRINT_TYPES.has(batchType) ? batchType : 'warranty';
}

export default function BatchPrint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const idsParam    = params.get('ids') || '';
  const typeParam   = params.get('type') || 'smart';
  const previewMode = params.get('preview') === '1';

  // Parse ids once — the URL is treated as immutable for the life of the
  // tab; re-navigating with a new ids= string remounts the component.
  const ids = useMemo(() => (
    idsParam.split(',')
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n) && n > 0)
  ), [idsParam]);

  const [items, setItems] = useState(null); // Array<{ id, saleData?, error?, resolvedType?, company?, customerBalance?, printedAt }>
  const [fatalError, setFatalError] = useState(null);
  const printedRef = useRef(false);
  const markedRef  = useRef(false);

  // ── Load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (ids.length === 0) {
      setFatalError('No invoices selected.');
      return;
    }
    if (ids.length > HARD_CAP) {
      setFatalError(`Batch cap is ${HARD_CAP} invoices. You selected ${ids.length}. Please split the batch.`);
      return;
    }
    let cancelled = false;
    const printedAt = new Date();
    Promise.all(ids.map(async (id) => {
      try {
        const { saleData, company, customerBalance } = await fetchInvoiceRenderData(id);
        return {
          id,
          saleData,
          company,
          customerBalance,
          resolvedType: resolveType(saleData, typeParam),
          printedAt,
        };
      } catch (err) {
        return {
          id,
          error: err?.response?.data?.message || err?.message || 'Failed to load',
          printedAt,
        };
      }
    })).then(loaded => {
      if (!cancelled) setItems(loaded);
    });
    return () => { cancelled = true; };
  }, [ids, typeParam]);

  const successful = useMemo(() => (items || []).filter(i => i.saleData), [items]);
  const failed     = useMemo(() => (items || []).filter(i => i.error),    [items]);

  // ── Set <title> so the browser's Save-as-PDF suggests a sensible name
  useEffect(() => {
    if (!items) return;
    if (successful.length === 0) { document.title = 'Invoices'; return; }
    const first = successful[0].saleData.invoice_no;
    const last  = successful[successful.length - 1].saleData.invoice_no;
    document.title = successful.length === 1
      ? `Invoice ${first}.pdf`
      : `Invoices ${first} to ${last}.pdf`;
  }, [items, successful]);

  // ── Auto-print once, after all invoice logos have decoded ────────────
  useEffect(() => {
    if (!items || previewMode || printedRef.current) return;
    if (successful.length === 0) return;
    const imgs = Array.from(document.querySelectorAll('.invoice-page img'));
    const readyPromises = imgs.map(img => (
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    ));
    Promise.all(readyPromises).then(() => {
      if (printedRef.current) return;
      printedRef.current = true;
      window.print();
    });
  }, [items, successful, previewMode]);

  // ── On `afterprint`, stamp printed_at server-side ────────────────────
  //   Grouped by resolvedType so a mixed "smart" batch produces one POST
  //   per type (typically 1, sometimes 2). Each POST is capped at 200
  //   entries by the backend, which is already guaranteed by our HARD_CAP.
  useEffect(() => {
    if (!items) return;
    const onAfter = () => {
      if (markedRef.current) return;
      markedRef.current = true;
      if (successful.length === 0) return;
      const byType = successful.reduce((m, it) => {
        (m[it.resolvedType] = m[it.resolvedType] || []).push(it.id);
        return m;
      }, {});
      const calls = Object.entries(byType).map(([t, tIds]) => (
        api.post('/sales/mark-printed', { ids: tIds, type: t })
      ));
      Promise.all(calls)
        .then(() => toast.success(`${successful.length} invoice${successful.length === 1 ? '' : 's'} marked as printed`))
        .catch(err => toast.error(err?.response?.data?.message || 'Could not update print status'));
    };
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, [items, successful]);

  // ── Render states ────────────────────────────────────────────────────

  if (fatalError) {
    return (
      <div style={fatalErrorWrap}>
        <div style={{ fontSize: 18, marginBottom: 12, color: '#0f172a', fontWeight: 700 }}>{fatalError}</div>
        <button type="button" onClick={() => navigate(-1)} style={backButton}>← Back</button>
      </div>
    );
  }

  if (!items) {
    return (
      <div style={fatalErrorWrap}>
        <div className="spinner" />
        <div style={{ marginTop: 12, color: '#64748b' }}>Preparing {ids.length} invoice{ids.length === 1 ? '' : 's'}…</div>
      </div>
    );
  }

  const typeCounts = successful.reduce((m, it) => {
    m[it.resolvedType] = (m[it.resolvedType] || 0) + 1;
    return m;
  }, {});
  const typeSummary = Object.entries(typeCounts).map(([t, n]) => `${n} ${prettyType(t)}`).join(' · ');

  return (
    <>
      {/* InvoiceDocument's CSS drives every invoice page; identical to the
          single-invoice print route so the two outputs match exactly. */}
      <style dangerouslySetInnerHTML={{ __html: INVOICE_STYLES }} />
      <style dangerouslySetInnerHTML={{ __html: BATCH_TOOLBAR_CSS }} />

      <div className="batch-toolbar">
        <div className="batch-toolbar-left">
          <div className="batch-toolbar-title">
            {successful.length} invoice{successful.length === 1 ? '' : 's'}
            {successful.length >= 2 && (
              <> · {successful[0].saleData.invoice_no} → {successful[successful.length - 1].saleData.invoice_no}</>
            )}
          </div>
          {typeSummary && <div className="batch-toolbar-sub">{typeSummary}</div>}
          {failed.length > 0 && (
            <div className="batch-toolbar-sub batch-toolbar-warn">
              {failed.length} could not be loaded
            </div>
          )}
        </div>
        <div className="batch-toolbar-actions">
          <button type="button" className="batch-btn secondary" onClick={() => navigate(-1)}>← Back</button>
          <button type="button" className="batch-btn primary" onClick={() => window.print()}>
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>

      {failed.map(f => (
        <div key={f.id} className="batch-error-card">
          Invoice id {f.id} — {f.error}
        </div>
      ))}

      {successful.map(it => (
        <InvoiceDocument
          key={it.id}
          saleData={it.saleData}
          type={it.resolvedType}
          customerBalance={it.customerBalance}
          company={it.company}
          printedAt={it.printedAt}
        />
      ))}
    </>
  );
}

function prettyType(t) {
  if (t === 'warranty')     return 'warranty';
  if (t === 'warranty10')   return 'warranty +10%';
  if (t === 'non-warranty') return 'non-warranty';
  return t;
}

const fatalErrorWrap = {
  minHeight: '60vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 40,
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const backButton = {
  background: 'transparent',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '7px 14px',
  color: '#0f172a',
  fontWeight: 600,
  cursor: 'pointer',
};

// Toolbar CSS lives here (not in InvoiceDocument.js) so the invoice
// document stays exclusively the "what prints on paper" concern.
// `@media print` hides everything on this file so the printed output
// is nothing but stacked A4 invoice pages.
const BATCH_TOOLBAR_CSS = `
  .batch-toolbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #0f172a;
    color: #fff;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    font-family: Arial, Helvetica, sans-serif;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  }
  .batch-toolbar-left { flex: 1; min-width: 0; }
  .batch-toolbar-title { font-weight: 700; font-size: 14px; letter-spacing: 0.2px; }
  .batch-toolbar-sub { font-size: 11.5px; opacity: 0.75; margin-top: 2px; }
  .batch-toolbar-warn { color: #fca5a5; opacity: 1; font-weight: 600; }
  .batch-toolbar-actions { display: flex; gap: 8px; }
  .batch-btn {
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
  }
  .batch-btn.primary   { background: #fff; color: #0f172a; }
  .batch-btn.secondary { background: transparent; color: #fff; border-color: rgba(255,255,255,0.4); }
  .batch-btn:hover     { opacity: 0.92; }
  .batch-error-card {
    margin: 12px auto;
    width: 200mm;
    padding: 14px 18px;
    border: 1.5px dashed #c53030;
    border-radius: 8px;
    color: #c53030;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    background: #fff;
  }
  @media screen {
    body { background: #e2e8f0; }
  }
  @media print {
    .batch-toolbar, .batch-error-card { display: none !important; }
    body { background: #fff !important; }
  }
`;
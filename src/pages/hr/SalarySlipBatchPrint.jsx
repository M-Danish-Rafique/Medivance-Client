import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import SalarySlipDocument, { SLIP_STYLES, SLIP_PRINT_STYLES, SLIP_SCREEN_STYLES } from './SalarySlipDocument';
import { fmtMonth } from './HrKit';

// ─── Bulk salary slip print ────────────────────────────────────────────────
// One route (/hr/salary-slips/print?ids=1,2,3) renders N slips stacked as A4
// pages using the same SalarySlipDocument the single-slip preview uses, so the
// two outputs are identical. The browser's own print dialog then handles
// either paper or "Save as PDF" — there is no server-side PDF renderer for
// salary slips.
//
// Directly mirrors pages/sale/BatchPrint.jsx, minus the mark-printed step:
// salary slips have no printed_at column and reprinting one is not an event
// worth recording.
//
// Auto-print fires once every slip has resolved and every logo/signature image
// has decoded. Skip it with &preview=1 to eyeball the batch first.

const HARD_CAP = 200;

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '', signature_url: '' };

export default function SalarySlipBatchPrint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const idsParam    = params.get('ids') || '';
  const previewMode = params.get('preview') === '1';

  const ids = useMemo(() => (
    idsParam.split(',')
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n) && n > 0)
  ), [idsParam]);

  const [items, setItems] = useState(null);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [fatalError, setFatalError] = useState(null);
  const printedRef = useRef(false);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (ids.length === 0) { setFatalError('No salary slips selected.'); return; }
    if (ids.length > HARD_CAP) {
      setFatalError(`Batch cap is ${HARD_CAP} slips. You selected ${ids.length}. Please split the batch.`);
      return;
    }

    let cancelled = false;
    const printedAt = new Date();

    Promise.all([
      api.get('/admin/company').catch(() => ({ data: null })),
      ...ids.map(async (id) => {
        try {
          const { data } = await api.get(`/hr/salary-slips/${id}`);
          return { id, slip: data, printedAt };
        } catch (err) {
          return { id, error: err?.response?.data?.message || err?.message || 'Failed to load', printedAt };
        }
      }),
    ]).then(([companyRes, ...loaded]) => {
      if (cancelled) return;
      setCompany({
        name:    companyRes.data?.name    || DEFAULT_COMPANY.name,
        address: companyRes.data?.address || '',
        phone:   companyRes.data?.phone   || '',
        email:   companyRes.data?.email   || '',
        logo_url: companyRes.data?.logo_url || '',
        // Same authorized signature the invoice prints — there is no separate
        // HR signature setting.
        signature_url: companyRes.data?.signature_url || '',
      });
      setItems(loaded);
    });

    return () => { cancelled = true; };
  }, [ids]);

  const successful = useMemo(() => (items || []).filter(i => i.slip), [items]);
  const failed     = useMemo(() => (items || []).filter(i => i.error), [items]);

  // ── Document title drives the Save-as-PDF filename ───────────────────────
  useEffect(() => {
    if (!items) return;
    if (successful.length === 0) { document.title = 'Salary Slips'; return; }
    const month = successful[0].slip.month;
    document.title = successful.length === 1
      ? `Salary Slip ${successful[0].slip.employee_code} ${month}.pdf`
      : `Salary Slips ${month}.pdf`;
  }, [items, successful]);

  // ── Auto-print once images have decoded ──────────────────────────────────
  useEffect(() => {
    if (!items || previewMode || printedRef.current) return;
    if (successful.length === 0) return;
    const imgs = Array.from(document.querySelectorAll('.slip-page img'));
    Promise.all(imgs.map(img => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())))
      .then(() => {
        if (printedRef.current) return;
        printedRef.current = true;
        window.print();
      });
  }, [items, successful, previewMode]);

  // ── Render ───────────────────────────────────────────────────────────────
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
        <div style={{ marginTop: 12, color: '#64748b' }}>
          Preparing {ids.length} salary slip{ids.length === 1 ? '' : 's'}…
        </div>
      </div>
    );
  }

  const month = successful.length ? successful[0].slip.month : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SLIP_STYLES }} />
      <style dangerouslySetInnerHTML={{ __html: SLIP_PRINT_STYLES }} />
      <style dangerouslySetInnerHTML={{ __html: SLIP_SCREEN_STYLES }} />
      <style dangerouslySetInnerHTML={{ __html: BATCH_TOOLBAR_CSS }} />

      <div className="batch-toolbar">
        <div className="batch-toolbar-left">
          <div className="batch-toolbar-title">
            {successful.length} salary slip{successful.length === 1 ? '' : 's'}
            {month && <> · {fmtMonth(month)}</>}
          </div>
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
          Salary slip id {f.id} — {f.error}
        </div>
      ))}

      {successful.map(item => (
        <SalarySlipDocument
          key={item.id}
          slip={item.slip}
          company={company}
          printedAt={item.printedAt}
        />
      ))}
    </>
  );
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

// Identical toolbar to the invoice batch route, so the two print experiences
// feel like the same feature.
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
  @media print {
    .batch-toolbar, .batch-error-card { display: none !important; }
    body { background: #fff !important; }
  }
`;

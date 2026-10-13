import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import { getLogoUrl } from '../../components/common/CompanyLogo';
import { fmtNum, fmtDate, fmtPrintedAt } from '../sale/InvoiceDocument';

// ─── Printed batch sheet ───────────────────────────────────────────────────
// One A4 page (brief 2.4) in the design language every printed document uses
// (the sales invoice and the salary slip): black on white, Arial, structure
// drawn with horizontal rules, plain labels, no formulas. Rendered here and
// handed to the browser's Print / Save as PDF dialog, like the salary slips.
// &preview=1 skips the automatic print.

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '' };
const qty = (v, unit) => `${parseFloat(v || 0).toLocaleString('en-PK', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
// A by-product's quantity is in its unit ("60 kg"); one the unit-only migration
// could not convert counts packs ("4 × 25 kg Bag"), matching its per-pack rate.
const byQty = (b) => (!b.pack_size || b.pack_size === b.uom_symbol ? qty(b.qty, b.uom_symbol || b.pack_size) : `${qty(b.qty)} × ${b.pack_size}`);
const STATUS = { ready: 'Ready for Inventory', in_inventory: 'In Inventory' };

function Line({ label, value, strong }) {
  return (
    <div className={`bs-line${strong ? ' is-strong' : ''}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

/** The company logo at its own aspect ratio: a fixed height, never cropped
 *  to a square or rounded corners. Falls back to the default logo, then to
 *  nothing (the company name beside it still identifies the document). */
function SheetLogo({ company }) {
  const [src, setSrc] = useState(() => getLogoUrl(company.logo_url, 'dark'));
  const [failed, setFailed] = useState(false);
  useEffect(() => { setSrc(getLogoUrl(company.logo_url, 'dark')); setFailed(false); }, [company.logo_url]);
  if (failed) return null;
  return (
    <img
      className="bs-logo"
      src={src}
      alt=""
      onError={() => {
        const fallback = getLogoUrl(null, 'dark');
        if (src !== fallback) setSrc(fallback); else setFailed(true);
      }}
    />
  );
}

function Detail({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="bs-detail"><span className="bs-detail-label">{label}</span><span className="bs-detail-value">{value}</span></div>;
}

export function BatchSheetDocument({ batch, company, printedAt }) {
  const unit = batch.vol_uom_symbol;
  const units = batch.packs.reduce((s, p) => s + Number(p.units || 0), 0);
  const lossPct = Number(batch.total_volume) > 0 ? (Number(batch.loss_volume) / Number(batch.total_volume)) * 100 : 0;
  const costOfPacks = Number(batch.total_cost) - Number(batch.byproduct_value);
  const contact = [company.phone && `Ph: ${company.phone}`, company.email && `Email: ${company.email}`].filter(Boolean);
  return (
    <article className="bs-page">
      <div className="bs-body">
        <header className="bs-header">
          <div className="bs-brand">
            <SheetLogo company={company} />
            <div>
              <div className="bs-company">{company.name}</div>
              {company.address && <div className="bs-meta">{company.address}</div>}
              {contact.length > 0 && <div className="bs-meta">{contact.join(', ')}</div>}
            </div>
          </div>
          <div className="bs-header-right">
            <h1 className="bs-title">BATCH SHEET</h1>
            <div className="bs-meta-row"><span>Batch Code:</span><strong>{batch.batch_code}</strong></div>
            <div className="bs-meta-row"><span>Status:</span><strong>{STATUS[batch.status] || ''}</strong></div>
          </div>
        </header>

        <section className="bs-details">
          <div>
            <div className="bs-caption">Product</div>
            <Detail label="Product" value={batch.product_name} />
            <Detail label="Category" value={batch.category_name} />
            <Detail label="Units Packed" value={qty(units)} />
          </div>
          <div>
            <div className="bs-caption">Dates</div>
            <Detail label="Batch Date" value={fmtDate(batch.batch_date)} />
            <Detail label="Expiry Date" value={fmtDate(batch.expiry_date)} />
            {batch.sent_at && <Detail label="Sent to Stock" value={fmtDate(batch.sent_at.slice(0, 10))} />}
          </div>
          <div>
            <div className="bs-caption">Output</div>
            <Detail label="Total Output" value={qty(batch.total_volume, unit)} />
            <Detail label="Packed" value={qty(batch.packed_volume, unit)} />
            <Detail label="Loss" value={Number(batch.loss_volume) > 0 ? `${qty(batch.loss_volume, unit)} (${lossPct.toFixed(1)}%)` : 'None'} />
          </div>
        </section>

        <section className="bs-block">
          <table className="bs-table">
            <thead><tr><th>RAW MATERIALS</th><th className="r">QUANTITY</th><th className="r">RATE</th><th className="r">AMOUNT (PKR)</th></tr></thead>
            <tbody>
              {batch.materials.map(m => (
                <tr key={m.raw_material_id}><td>{m.rm_name}</td><td className="r">{qty(m.qty, m.uom_symbol)}</td><td className="r">{fmtNum(m.unit_cost)}</td><td className="r">{fmtNum(m.total_cost)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total Raw Materials</td><td className="r">{fmtNum(batch.raw_material_cost)}</td></tr></tfoot>
          </table>
        </section>

        <section className="bs-block">
          <table className="bs-table">
            <thead><tr>
              <th>PACKS</th><th className="r">UNITS</th><th className="r">PACKED</th><th className="r">BATCH COST</th>
              <th className="r">PACKAGING</th><th className="r">TOTAL (PKR)</th><th className="r">COST / UNIT</th>
            </tr></thead>
            <tbody>
              {batch.packs.map(p => (
                <React.Fragment key={p.product_id}>
                  <tr>
                    <td><strong>{p.product_name} {p.pack_size}</strong></td>
                    <td className="r">{qty(p.units)}</td>
                    <td className="r">{qty(p.packed_volume, unit)}</td>
                    <td className="r">{fmtNum(p.shared_cost)}</td>
                    <td className="r">{fmtNum(p.packaging_cost)}</td>
                    <td className="r">{fmtNum(p.total_cost)}</td>
                    <td className="r"><strong>{fmtNum(p.cost_per_unit)}</strong></td>
                  </tr>
                  {p.packaging.length > 0 && (
                    <tr className="bs-sub"><td colSpan={7}>Packaging: {p.packaging.map(x => `${x.rm_name} ${qty(x.qty, x.uom_symbol)}`).join(', ')}</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </section>

        {batch.byproducts.length > 0 && (
          <section className="bs-block">
            <table className="bs-table">
              <thead><tr><th>BY-PRODUCTS</th><th className="r">QUANTITY</th><th>BATCH NO.</th><th>EXPIRY</th><th className="r">RATE</th><th className="r">VALUE (PKR)</th></tr></thead>
              <tbody>
                {batch.byproducts.map(b => (
                  <tr key={b.product_id}>
                    <td>{b.product_name}</td><td className="r">{byQty(b)}</td><td>{b.batch_no}</td>
                    <td>{fmtDate(b.exp_date)}</td><td className="r">{fmtNum(b.unit_cost)}</td><td className="r">{fmtNum(b.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="bs-summary">
          <div className="bs-summary-col">
            <div className="bs-caption">Notes</div>
            <div className="bs-note">{batch.misc_note || 'None'}</div>
          </div>
          <div className="bs-summary-col">
            <div className="bs-caption">Cost Summary (PKR)</div>
            <Line label="Raw Materials" value={fmtNum(batch.raw_material_cost)} />
            <Line label="Packaging" value={fmtNum(batch.packaging_cost)} />
            <Line label="Miscellaneous Expense" value={fmtNum(batch.misc_expense)} />
            <Line label="Less By-products" value={Number(batch.byproduct_value) > 0 ? `(${fmtNum(batch.byproduct_value)})` : fmtNum(0)} />
            <Line label="Cost of Packs" value={fmtNum(costOfPacks)} strong />
          </div>
        </section>

        <div className="bs-signs">
          <div className="bs-sign"><div className="bs-sign-line" /><div>Produced by</div></div>
          <div className="bs-sign"><div className="bs-sign-line" /><div>Checked by</div></div>
        </div>
      </div>
      <footer className="bs-footer">
        <span>{printedAt && <>Printed on <strong>{fmtPrintedAt(printedAt)}</strong></>}</span>
        <span>Powered by {company.name} Distribution System</span>
      </footer>
    </article>
  );
}

export default function BatchSheet() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [error, setError] = useState(null);
  const printed = useRef(false);
  const printedAt = useRef(new Date());

  useEffect(() => {
    Promise.all([
      api.get(`/manufacturing/batches/${id}`),
      api.get('/admin/company').catch(() => ({ data: null })),
    ]).then(([b, c]) => {
      if (b.data.status === 'draft') { setError('A draft has no batch sheet. Create the batch first.'); return; }
      setBatch(b.data);
      setCompany({ ...DEFAULT_COMPANY, ...(c.data || {}), name: c.data?.name || DEFAULT_COMPANY.name });
      document.title = `Batch Sheet ${b.data.batch_code}.pdf`;
    }).catch(err => setError(err?.response?.data?.message || 'The batch could not be loaded.'));
  }, [id]);

  useEffect(() => {
    if (!batch || printed.current || params.get('preview') === '1') return;
    const imgs = Array.from(document.querySelectorAll('.bs-page img'));
    const loaded = (img) => (img.complete ? Promise.resolve() : new Promise((done) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    })).then(() => (img.decode ? img.decode().catch(() => {}) : undefined));
    Promise.all(imgs.map(loaded)).then(() => {
      if (printed.current) return;
      printed.current = true;
      window.print();
    });
  }, [batch, params]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHEET_STYLES }} />
      <div className="bs-toolbar">
        <div className="bs-toolbar-title">{batch ? `Batch sheet · ${batch.batch_code}` : 'Batch sheet'}</div>
        <button type="button" className="bs-btn secondary" onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>Back</button>
        <button type="button" className="bs-btn primary" onClick={() => window.print()} disabled={!batch}>Print / Save as PDF</button>
      </div>
      {error && <div className="bs-error">{error}</div>}
      {!batch && !error && <div className="bs-error" style={{ borderStyle: 'none', color: '#64748b' }}>Preparing the batch sheet…</div>}
      {batch && <BatchSheetDocument batch={batch} company={company} printedAt={printedAt.current} />}
    </>
  );
}

const SHEET_STYLES = `
  .bs-page, .bs-page * { color: #000; box-sizing: border-box; }
  .bs-page {
    width: 210mm; height: 297mm; padding: 8mm 10mm 12mm; margin: 0 auto;
    position: relative; overflow: hidden; background: #fff;
    font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.35;
  }
  .bs-body { height: calc(297mm - 22mm); overflow: hidden; }
  .bs-logo { display: block; flex-shrink: 0; height: 14mm; width: auto; max-width: 60mm; object-fit: contain; background: transparent !important; }
  .bs-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 7px; border-bottom: 1.5px solid #000; margin-bottom: 4mm; }
  .bs-brand { display: flex; align-items: center; gap: 10px; }
  .bs-company { font-size: 16pt; font-weight: 700; }
  .bs-meta { font-size: 9pt; margin-top: 2px; }
  .bs-header-right { text-align: right; min-width: 170px; }
  .bs-page .bs-title { font-size: 18pt; font-weight: 700; letter-spacing: 2px; margin: 0 0 6px; line-height: 1.1; }
  .bs-meta-row { display: flex; justify-content: flex-end; gap: 4px; font-size: 9.2pt; padding: 1px 0; }
  .bs-caption { margin-bottom: 4px; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.9px; text-transform: uppercase; }
  .bs-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 8mm; padding-bottom: 4mm; margin-bottom: 4mm; border-bottom: 1px solid #000; }
  .bs-detail { display: grid; grid-template-columns: 24mm minmax(0, 1fr); gap: 6px; padding: 1.5px 0; font-size: 9pt; }
  .bs-detail-value { font-weight: 700; }
  .bs-block { margin-bottom: 4mm; }
  .bs-page .bs-table { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
  .bs-page .bs-table thead tr { border-top: 1.5px solid #000; border-bottom: 1px solid #000; }
  .bs-page .bs-table th { padding: 5px 6px; font-size: 7.8pt; font-weight: 700; letter-spacing: 0.4px; text-align: left; background: none; text-transform: none; white-space: nowrap; }
  .bs-page .bs-table td { padding: 3.5px 6px; border: none; background: none; }
  .bs-page .bs-table tbody tr + tr { border-top: 0.5px solid #c8c8c8; }
  .bs-page .bs-table tbody tr.bs-sub { border-top: none; }
  .bs-page .bs-table tr.bs-sub td { padding-top: 0; font-size: 8pt; }
  .bs-page .bs-table tfoot tr { border-top: 1px solid #000; border-bottom: 1.5px solid #000; font-weight: 700; }
  .bs-page .bs-table .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bs-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 8mm; padding: 3mm 0 3.5mm; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
  .bs-note { font-size: 9pt; }
  .bs-line { display: flex; justify-content: space-between; gap: 10px; padding: 1.5px 0; font-size: 9.2pt; }
  .bs-line > span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  .bs-line.is-strong { margin-top: 4px; padding-top: 5px; border-top: 1.5px solid #000; font-size: 11pt; font-weight: 700; }
  .bs-line.is-strong > span:last-child { border-bottom: 3px double #000; font-weight: 700; }
  .bs-signs { display: flex; justify-content: space-between; margin-top: 18mm; }
  .bs-sign { width: 60mm; text-align: center; font-size: 9pt; font-weight: 700; }
  .bs-sign-line { border-top: 1px solid #000; margin-bottom: 4px; }
  .bs-footer { position: absolute; bottom: 6mm; left: 10mm; right: 10mm; border-top: 1px solid #000; padding-top: 5px; font-size: 8pt; display: flex; justify-content: space-between; }
  .bs-toolbar {
    position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 8px;
    padding: 12px 20px; background: #0f172a; color: #fff; font-family: Arial, Helvetica, sans-serif;
  }
  .bs-toolbar-title { flex: 1; font-weight: 700; font-size: 14px; }
  .bs-btn { border-radius: 6px; padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer; border: 1px solid transparent; }
  .bs-btn.primary { background: #fff; color: #0f172a; }
  .bs-btn.secondary { background: transparent; color: #fff; border-color: rgba(255,255,255,0.4); }
  .bs-error { margin: 24px auto; width: 200mm; padding: 14px 18px; border: 1.5px dashed #c53030; border-radius: 8px; color: #c53030; font-family: Arial, Helvetica, sans-serif; background: #fff; }
  @media screen { body { background: #e2e8f0; } .bs-page { box-shadow: 0 4px 32px rgba(0,0,0,0.18); margin: 24px auto; } }
  @media print {
    .bs-toolbar, .bs-error { display: none !important; }
    html, body { margin: 0; padding: 0; background: #fff !important; width: 210mm; }
    .bs-page { margin: 0 !important; box-shadow: none !important; }
    @page { size: A4 portrait; margin: 0; }
  }
`;

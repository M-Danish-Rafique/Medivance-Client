import React from 'react';
import { computeInvoiceRows } from '../../utils/invoiceCalculations';
import { formatDatePKT, formatMonthYearPKT } from '../../utils/dateUtils';
import CompanyLogo from '../../components/common/CompanyLogo';
import { formatTaxId } from '../../components/common/TaxIdInput';

export function numberToWords(num) {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

  function helper(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
    if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED ' + helper(n % 100);
    if (n < 100000) return helper(Math.floor(n / 1000)) + 'THOUSAND ' + helper(n % 1000);
    if (n < 10000000) return helper(Math.floor(n / 100000)) + 'LAKH ' + helper(n % 100000);
    return helper(Math.floor(n / 10000000)) + 'CRORE ' + helper(n % 10000000);
  }
  const n = Math.floor(num);
  if (n === 0) return 'ZERO';
  return helper(n).trim();
}

export function fmtNum(n) {
  return parseFloat(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPlainInt(n) {
  return String(Math.round(parseFloat(n || 0)));
}

export const fmtDate = (d) => formatDatePKT(d);

export const fmtTime = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace(/\s/g, '');
};

export const fmtPrintedAt = (d) => {
  if (!d) return null;
  return `${fmtDate(d)}, ${fmtTime(d)}`;
};

function WarrantySection({ company }) {
  return (
    <div className="warranty-section">
      <div className="warranty-expiry">
        * EXPIRY CLAIMS WILL BE ACCEPTED SIX(6) MONTHS BEFORE EXPIRY.
      </div>

      <div className="warranty-drug-row">
        <div className="warranty-drug-text">
          <div>Form 2A (See Rules 19 &amp; 30)</div>
          <div className="warranty-heading">Warranty under section 23(1)(i) of the Drug Act 1976.</div>
          <div className="warranty-body">
            I being a person resident in Pakistan carrying on business at Company Address{' '}
            <strong>{company.address}</strong> under the name <strong>{company.name}</strong> and being an
            authorised agent, do hereby give this warranty that the drugs sold by me donot contravene in
            anyway the provisions of section 23 of the drug act 1976.
          </div>
          <div className="warranty-note">
            Note: This warranty does not apply to Unani, Homeopathic, Bio Chemic System of Medicine and General Items, if
          </div>
        </div>
        <div className={`warranty-sign${company.signature_url ? ' warranty-sign--has-image' : ''}`}>
          {company.signature_url && (
            <img
              className="warranty-signature-img"
              src={company.signature_url}
              alt="Authorized signature"
            />
          )}
          <div className="warranty-sign-line" />
          <div>For <strong>{company.name}</strong></div>
        </div>
      </div>

      <div className="drap-box">
        <div className="warranty-heading">Warranty under DRAP Act, 2012</div>
        <div className="warranty-body">
          It is hereby certified and undertake that above mentioned finished products of specified Batch no. / Lot no.
          supplied by me under the name <strong>{company.name}</strong> at <strong>{company.address}</strong> do not
          contravene any provision of the DRAP Act, 2012 and rules framed there under. The authorized agent (with valid
          distribution authority letter) shall pass on this warranty to the retailers in his area of jurisdiction during
          the supply
        </div>
      </div>
    </div>
  );
}

// The invoice document itself — pure, no hooks, no browser-only APIs.
// Used both by the live /invoice/:id/print page (InvoicePrint.jsx) and,
// via react-dom/server's renderToStaticMarkup, by the Print Queue's
// background PDF builder (utils/invoiceHtml.js). Keeping this as a single
// source of truth guarantees both paths look identical.
export default function InvoiceDocument({ saleData, type, customerBalance, company, printedAt }) {
  if (!saleData) return null;

  const {
    invoice_no, date, customer_name, customer_address, customer_id,
    city_name, area_name, territory_name, license_no,
    ntn, strn,
    salesman_name, delivery_by_name, items = [],
  } = saleData;

  const isWarranty = type === 'warranty' || type === 'warranty10';

  const { rows: computedRows, grossAmount, netAmount, totalDiscAmount, totalTaxAmount, referenceNo } =
    computeInvoiceRows(items, type);

  const prevBalance = parseFloat(customerBalance || 0);
  const totalBalance = prevBalance + netAmount;
  const geoLine = [city_name, area_name, territory_name].filter(Boolean).join(' , ');
  const contactParts = [company.phone && `Ph: ${company.phone}`, company.email && `Email: ${company.email}`].filter(Boolean);
  const printedAtLabel = fmtPrintedAt(printedAt);

  return (
    <div className="invoice-page">
      <div className="invoice-body">
        {/* Header */}
        <div className="invoice-header">
          <div className="invoice-header-left">
            <div className="invoice-brand-row">
              <CompanyLogo logoUrl={company.logo_url} name={company.name} size={48} variant="dark" className="invoice-logo-wrap" />
              <div className="invoice-brand-text">
                <div className="invoice-company-name">{company.name}</div>
                {company.address && <div className="invoice-meta">{company.address}</div>}
                {contactParts.length > 0 && <div className="invoice-meta">{contactParts.join(' , ')}</div>}
              </div>
            </div>
          </div>
          <div className="invoice-header-right">
            <div className="invoice-doc-title">INVOICE</div>
            <div className="invoice-meta-table">
              <div className="invoice-meta-row"><span>Invoice No:</span><strong>{invoice_no}</strong></div>
              <div className="invoice-meta-row"><span>Date:</span><strong>{fmtDate(date)}</strong></div>
              <div className="invoice-meta-row"><span>Page:</span><span>1 of 1</span></div>
            </div>
          </div>
        </div>

        {/* Customer & staff — single box, no internal dividers */}
        <div className="invoice-party-box">
          <div className="invoice-party-customer">
            <div className="party-row">
              <span className="party-label">Customer:</span>
              <span className="party-value">{customer_name}{customer_id ? ` (${customer_id})` : ''}</span>
            </div>
            {geoLine && <div className="party-detail">{geoLine}</div>}
            {customer_address && <div className="party-detail">{customer_address}</div>}
            {license_no && (
              <div className="party-row party-row-tight">
                <span className="party-label">License No:</span>
                <span className="party-value">{license_no}</span>
              </div>
            )}
            {/* Pakistan tax identifiers. Each row — label AND value — is
                hidden together when the corresponding field is NULL /
                empty on the customer record, per the spec. Clean digits
                stored in the DB are re-masked for display via the shared
                formatTaxId helper from TaxIdInput, so what prints matches
                what the operator sees on Customers.js. */}
            {ntn && (
              <div className="party-row party-row-tight">
                <span className="party-label">NTN:</span>
                <span className="party-value">{formatTaxId(ntn, 'NTN')}</span>
              </div>
            )}
            {strn && (
              <div className="party-row party-row-tight">
                <span className="party-label">STRN:</span>
                <span className="party-value">{formatTaxId(strn, 'STRN')}</span>
              </div>
            )}
          </div>
          <div className="invoice-party-staff">
            <div className="party-row">
              <span className="party-label">Salesman:</span>
              <span className="party-value">{salesman_name || 'Office'}</span>
            </div>
            <div className="party-row">
              <span className="party-label">Delivery By:</span>
              <span className="party-value">{delivery_by_name || '—'}</span>
            </div>
          </div>
        </div>

        {/* Line items */}
        <table className="invoice-table">
          <thead>
            <tr>
              <th>PRD ID</th>
              <th>QTY</th>
              <th>BNS</th>
              <th className="left">PRODUCT NAME</th>
              <th>PACK</th>
              <th>BATCH NO</th>
              <th>EXP DATE</th>
              <th>RATE</th>
              <th>AMOUNT</th>
              <th>DISC%</th>
              {!isWarranty && <th>TAX%</th>}
              <th>INV. AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {computedRows.map((row, i) => (
              <tr key={i}>
                <td>{isWarranty ? fmtPlainInt(row.prd_id) : row.prd_id}</td>
                <td>{row.qty}</td>
                <td>{row.bonus || 0}</td>
                <td className="left">{row.product_name}</td>
                <td>{row.pack_size || '—'}</td>
                <td>{row.batch_no || '—'}</td>
                <td>{formatMonthYearPKT(row.exp_date)}</td>
                <td>{fmtNum(row.rate)}</td>
                <td>{fmtNum(row.amount)}</td>
                <td>{row.disc_pct > 0 ? row.disc_pct : '0.00'}</td>
                {!isWarranty && (
                  <td>{row.tax_pct > 0 ? row.tax_pct : '0.00'}</td>
                )}
                <td className="bold">{fmtNum(row.inv_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div className="invoice-summary-panel">
          <div className="summary-col summary-col-left">
            <div><strong>Total Items :</strong> {computedRows.length} of {computedRows.length}</div>
            {isWarranty && referenceNo != null && (
              <div className="summary-ref"><strong>Refference # :</strong> {fmtPlainInt(referenceNo)}</div>
            )}
            <div className="summary-words"><strong>{numberToWords(Math.floor(netAmount))}</strong></div>
          </div>

          <div className="summary-col summary-col-mid">
            <div className="summary-line"><span>Current Amount :</span><span>{fmtPlainInt(netAmount)}</span></div>
            <div className="summary-line"><span>Previous :</span><span>{fmtPlainInt(prevBalance)}</span></div>
            <div className="summary-line"><span>Paid :</span><span>0</span></div>
            <div className="summary-line"><span>Balance :</span><span>{fmtPlainInt(totalBalance)}</span></div>
          </div>

          <div className="summary-col summary-col-right">
            <div className="summary-line"><span>Gross Amount :</span><span>{fmtNum(grossAmount)}</span></div>
            <div className="summary-line"><span>Discount :</span><span>{fmtNum(totalDiscAmount)}</span></div>
            <div className="summary-line"><span>Sp. Discount :</span><span>0.00</span></div>
            <div className="summary-line"><span>GST :</span><span>{fmtNum(isWarranty ? 0 : totalTaxAmount)}</span></div>
            <div className="summary-line"><span>Advance Inc Tax :</span><span>0.00</span></div>
            <div className="summary-line"><span>Printing Charges :</span><span>0.00</span></div>
            <div className="summary-line summary-net"><span>Net Amount :</span><span>{fmtNum(netAmount)}</span></div>
          </div>
        </div>

        {isWarranty && <WarrantySection company={company} />}
      </div>

      {/* Footer pinned to page bottom */}
      <div className="invoice-page-footer">
        <span className="footer-printed">
          {printedAtLabel ? <>Printed At: <strong>{printedAtLabel}</strong></> : 'Printed At: —'}
        </span>
        <span className="footer-powered">Powered by {company.name} Distribution System</span>
      </div>
    </div>
  );
}

// The document-only CSS (no print-bar/preview-chrome styles) — this is
// what both the live page and the static-HTML PDF builder embed, so the
// two outputs match exactly.
export const INVOICE_STYLES = `
  * { color: #000; }
  .invoice-page {
    width: 210mm;
    height: 297mm;
    min-height: 297mm;
    max-height: 297mm;
    padding: 8mm 10mm 12mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #000;
    background: #fff;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
    margin: 0 auto;
  }
  .invoice-body {
    height: calc(297mm - 22mm);
    overflow: hidden;
  }
  .invoice-logo-wrap { background: transparent !important; }
  .invoice-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 7px;
    border-bottom: 1.5px solid #000;
    margin-bottom: 9px;
  }
  .invoice-brand-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .invoice-brand-text { line-height: 1.3; }
  .invoice-company-name { font-size: 16pt; font-weight: 700; }
  .invoice-meta { font-size: 9pt; margin-top: 2px; }
  .invoice-header-right { text-align: right; min-width: 160px; }
  .invoice-doc-title { font-size: 18pt; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px; }
  .invoice-meta-table {
    font-size: 9.2pt;
    margin-left: auto;
  }
  .invoice-meta-row {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 4px;
    padding: 1px 0;
    font-weight: 400;
  }
  .invoice-meta-row strong {
    font-weight: 700;
  }
  .invoice-party-box {
    border: 1px solid #000;
    padding: 7px 10px;
    margin-bottom: 9px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    font-size: 9pt;
  }
  .invoice-party-customer { flex: 1.6; min-width: 0; }
  .invoice-party-staff {
    flex: 0.9;
    min-width: 130px;
    text-align: right;
  }
  .party-row {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin-bottom: 2px;
  }
  .invoice-party-staff .party-row { justify-content: flex-end; }
  .party-row-tight { margin-top: 3px; }
  .party-label { font-weight: 700; white-space: nowrap; }
  .party-value { font-weight: 700; }
  .party-detail { margin-left: 0; padding-left: 0; margin-bottom: 1px; line-height: 1.35; }
  .invoice-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    margin-bottom: 0;
    color: #000;
    border-color: #000;
  }
  .invoice-table thead tr {
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
  }
  .invoice-table th {
    padding: 5px 3px;
    text-align: center;
    font-weight: 700;
    font-size: 8.2pt;
    color: #000;
    border-color: #000;
    white-space: nowrap;
  }
  .invoice-table td {
    padding: 4px 3px;
    text-align: center;
    vertical-align: top;
    color: #000;
    border-color: #000;
  }
  .invoice-table .left { text-align: left; }
  .invoice-table .bold { font-weight: 700; }
  .invoice-summary-panel {
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
    display: flex;
    padding: 7px 2px;
    margin-top: 5px;
    font-size: 9.2pt;
    gap: 12px;
  }
  .summary-col { flex: 1; }
  .summary-col-left { flex: 1.15; }
  .summary-col-mid { flex: 0.95; padding: 0 10px; }
  .summary-col-right { flex: 1.15; }
  .summary-ref { margin-top: 4px; }
  .summary-words { margin-top: 5px; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.2px; }
  .summary-line {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 1px 0;
  }
  .summary-line span:last-child { text-align: right; min-width: 58px; font-weight: 600; }
  .summary-net {
    font-weight: 700;
    border-top: 1px solid #000;
    margin-top: 3px;
    padding-top: 4px;
  }
  .summary-net span { font-weight: 700 !important; }
  .warranty-section { margin-top: 7px; font-size: 8.5pt; line-height: 1.42; }
  .warranty-expiry { font-weight: 700; font-style: italic; margin-bottom: 4px; }
  .warranty-drug-row { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 6px; }
  .warranty-drug-text { flex: 1.65; }
  .warranty-heading { font-weight: 700; margin: 2px 0; }
  .warranty-body { text-align: justify; }
  .warranty-note { margin-top: 3px; }
  .warranty-sign { flex: 0.75; text-align: center; padding-top: 100px; font-size: 9pt; }
  /* When an authorized-signature image is uploaded on Company Settings,
     shrink the top padding so the image sits in what would otherwise be
     the manual wet-ink whitespace. Absence falls back to the original
     100px padding automatically. */
  .warranty-sign--has-image { padding-top: 20px; }
  .warranty-signature-img {
    display: block;
    margin: 0 auto -2px;
    max-width: 60%;
    max-height: 70px;
    object-fit: contain;
  }
  .warranty-sign-line { border-top: 1px solid #000; width: 78%; margin: 0 auto 4px; }
  .drap-box {
    border: 1px solid #000;
    padding: 5px 8px;
    font-size: 8.5pt;
    line-height: 1.42;
  }
  .invoice-page-footer {
    position: absolute;
    bottom: 6mm;
    left: 10mm;
    right: 10mm;
    border-top: 1px solid #000;
    padding-top: 5px;
    font-size: 8pt;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .footer-printed { flex: 1; }
  .footer-powered { text-align: right; }
  @media print {
    .no-print { display: none !important; }
    html, body { margin: 0; padding: 0; background: white; width: 210mm; }
    .invoice-page {
      width: 210mm !important;
      height: 297mm !important;
      min-height: 297mm !important;
      max-height: 297mm !important;
      margin: 0 !important;
      padding: 8mm 10mm 12mm !important;
      box-shadow: none !important;
    }
    @page { size: A4 portrait; margin: 0; }
  }
  @media screen {
    body { background: #e2e8f0; }
    .invoice-page { box-shadow: 0 4px 32px rgba(0,0,0,0.18); margin: 80px auto 40px; }
  }
`;
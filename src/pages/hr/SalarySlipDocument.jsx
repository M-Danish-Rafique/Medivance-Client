import React from 'react';
import CompanyLogo from '../../components/common/CompanyLogo';
import { formatCNIC } from '../../utils/formatters';
import { numberToWords, fmtNum, fmtDate, fmtPrintedAt } from '../sale/InvoiceDocument';
import { fmtMonth } from './HrKit';

// ─── Salary slip document ──────────────────────────────────────────────────
// The printable page, built exactly the way InvoiceDocument is built:
//   * pure — no hooks, no browser-only APIs, so it renders identically in the
//     live preview and in a stacked batch,
//   * one A4 page per slip, with real mm dimensions rather than screen px,
//   * the authorized signature comes from company_settings.signature_url via
//     the same company object the invoice uses — there is no separate HR
//     signature field,
//   * all PDF output is the browser's own "Print / Save as PDF". There is no
//     backend PDFKit renderer for salary slips, by design.
//
// numberToWords / fmtNum / fmtDate are imported from InvoiceDocument rather
// than reimplemented: the Lakh/Crore wording and the PKT date formatting must
// match what the invoice prints.

function parseAmount(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumLines(lines) {
  return (lines || []).reduce((total, line) => total + parseAmount(line.amount), 0);
}

// Earnings and deductions print side by side, each taking exactly half the
// width. The shorter column is padded with blank rows so both sides end level
// and the totals line up — the same convention a printed payslip book uses.
function padRows(lines, target) {
  const rows = [...(lines || [])];
  while (rows.length < target) rows.push(null);
  return rows;
}

export default function SalarySlipDocument({ slip, company, printedAt }) {
  if (!slip) return null;

  const earnings   = slip.earnings   || [];
  const deductions = slip.deductions || [];

  const totalEarnings   = sumLines(earnings);
  const totalDeductions = sumLines(deductions);
  const netPay          = parseAmount(slip.net_pay);

  const rowCount = Math.max(earnings.length, deductions.length, 6);
  const earningRows   = padRows(earnings, rowCount);
  const deductionRows = padRows(deductions, rowCount);

  // ── Sales target — TEMPORARILY DISABLED ─────────────────────────────────
  // Held back pending confirmation with the client. The slip still stores
  // target_amount / target_achieved, so re-enabling is purely this block plus
  // the JSX marked "Sales target" further down and the .slip-target-* CSS.
  //
  // const hasTarget = slip.target_amount !== null && slip.target_amount !== undefined;
  // const targetAmount   = parseAmount(slip.target_amount);
  // const targetAchieved = slip.target_achieved === null || slip.target_achieved === undefined
  //   ? null
  //   : parseAmount(slip.target_achieved);
  // const achievedPct = hasTarget && targetAmount > 0 && targetAchieved !== null
  //   ? (targetAchieved / targetAmount) * 100
  //   : null;

  const contactParts = [
    company.phone && `Ph: ${company.phone}`,
    company.email && `Email: ${company.email}`,
  ].filter(Boolean);

  const printedAtLabel = fmtPrintedAt(printedAt);

  return (
    // <article> + an <h1> per payslip: in a batch each slip is its own
    // self-contained document, so each gets its own sectioning root and
    // heading rather than a run of unlabelled divs.
    <article className="slip-page">
      <div className="slip-body">
        {/* Header */}
        <div className="slip-header">
          <div className="slip-brand-row">
            <CompanyLogo logoUrl={company.logo_url} name={company.name} size={48} variant="dark" className="slip-logo-wrap" />
            <div className="slip-brand-text">
              <div className="slip-company-name">{company.name}</div>
              {company.address && <div className="slip-meta">{company.address}</div>}
              {contactParts.length > 0 && <div className="slip-meta">{contactParts.join(' , ')}</div>}
            </div>
          </div>
          <div className="slip-header-right">
            <h1 className="slip-doc-title">SALARY SLIP</h1>
            <div className="slip-meta-table">
              <div className="slip-meta-row"><span>Pay Period:</span><strong>{fmtMonth(slip.month)}</strong></div>
              <div className="slip-meta-row"><span>Issued:</span><span>{fmtDate(slip.generated_at)}</span></div>
            </div>
          </div>
        </div>

        {/* Employee */}
        <div className="slip-party-box">
          <div className="slip-party-col">
            <div className="party-row">
              <span className="party-label">Employee:</span>
              <span className="party-value">{slip.employee_name}</span>
            </div>
            <div className="party-row">
              <span className="party-label">Employee ID:</span>
              <span className="party-value">{slip.employee_code}</span>
            </div>
            {slip.father_name && (
              <div className="party-row">
                <span className="party-label">Father&rsquo;s Name:</span>
                <span className="party-value">{slip.father_name}</span>
              </div>
            )}
            {slip.cnic && (
              <div className="party-row">
                <span className="party-label">CNIC:</span>
                <span className="party-value">{formatCNIC(slip.cnic)}</span>
              </div>
            )}
            {slip.bank_name && (
              <div className="party-row">
                <span className="party-label">Bank Name:</span>
                <span className="party-value">{slip.bank_name}</span>
              </div>
            )}
            {slip.account_number && (
              <div className="party-row">
                <span className="party-label">Account No:</span>
                <span className="party-value party-digits">{slip.account_number}</span>
              </div>
            )}
          </div>

          <div className="slip-party-col">
            <div className="party-row">
              <span className="party-label">Designation:</span>
              <span className="party-value">{slip.designation_name}</span>
            </div>
            <div className="party-row">
              <span className="party-label">Department:</span>
              <span className="party-value">{slip.department_name}</span>
            </div>
            <div className="party-row">
              <span className="party-label">Date of Joining:</span>
              <span className="party-value">{fmtDate(slip.date_of_joining)}</span>
            </div>
            {slip.account_title && (
              <div className="party-row">
                <span className="party-label">Account Title:</span>
                <span className="party-value">{slip.account_title}</span>
              </div>
            )}
            {slip.iban && (
              <div className="party-row">
                <span className="party-label">IBAN:</span>
                <span className="party-value party-digits">{slip.iban}</span>
              </div>
            )}
          </div>
        </div>

        {/* Earnings / deductions — 50% each, long descriptions wrap in place */}
        <table className="slip-table">
          <thead>
            <tr>
              <th className="left" scope="col">EARNINGS</th>
              <th className="amount" scope="col">AMOUNT</th>
              <th className="left" scope="col">DEDUCTIONS</th>
              <th className="amount" scope="col">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {earningRows.map((earning, i) => {
              const deduction = deductionRows[i];
              return (
                <tr key={i}>
                  <td className="left">{earning ? earning.title : ''}</td>
                  <td className="amount">{earning ? fmtNum(earning.amount) : ''}</td>
                  <td className="left">{deduction ? deduction.title : ''}</td>
                  <td className="amount">{deduction ? fmtNum(deduction.amount) : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="left bold">Total Earnings</td>
              <td className="amount bold">{fmtNum(totalEarnings)}</td>
              <td className="left bold">Total Deductions</td>
              <td className="amount bold">{fmtNum(totalDeductions)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Net pay */}
        <div className="slip-net-panel">
          <div className="slip-net-words">
            <div className="slip-net-words-label">Net Pay in words</div>
            <div className="slip-net-words-value">
              <strong>{numberToWords(Math.floor(netPay))} RUPEES ONLY</strong>
            </div>
          </div>
          <div className="slip-net-figure">
            <div className="slip-net-label">NET PAY</div>
            <div className="slip-net-value">{fmtNum(netPay)}</div>
          </div>
        </div>

        {/* ── Sales target — TEMPORARILY DISABLED ───────────────────────────
            Held back pending confirmation with the client. Re-enable together
            with the computations near the top of this component.

        {hasTarget && (
          <div className="slip-target-box">
            <div className="slip-target-title">Sales Target — {fmtMonth(slip.month)}</div>
            <div className="slip-target-grid">
              <div className="slip-target-cell">
                <span className="slip-target-label">Target</span>
                <span className="slip-target-value">{fmtNum(targetAmount)}</span>
              </div>
              <div className="slip-target-cell">
                <span className="slip-target-label">Achieved</span>
                <span className="slip-target-value">
                  {targetAchieved === null ? 'Not available' : fmtNum(targetAchieved)}
                </span>
              </div>
              <div className="slip-target-cell">
                <span className="slip-target-label">Variance</span>
                <span className="slip-target-value">
                  {targetAchieved === null ? '—' : fmtNum(targetAchieved - targetAmount)}
                </span>
              </div>
              <div className="slip-target-cell">
                <span className="slip-target-label">Achievement</span>
                <span className="slip-target-value">
                  {achievedPct === null ? '—' : `${achievedPct.toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>
        )}

        ─────────────────────────────────────────────────────────────────── */}

        {/* Authorized signature only — the employee signature block was removed */}
        <div className="slip-sign-row">
          <div className={`slip-sign${company.signature_url ? ' slip-sign--has-image' : ''}`}>
            {company.signature_url && (
              <img
                className="slip-signature-img"
                src={company.signature_url}
                alt="Authorized signature"
              />
            )}
            <div className="slip-sign-line" />
            <div>For <strong>{company.name}</strong></div>
          </div>
        </div>
      </div>

      {/* Footer pinned to page bottom */}
      <div className="slip-page-footer">
        <span className="footer-printed">
          {printedAtLabel ? <>Printed At: <strong>{printedAtLabel}</strong></> : 'Printed At: —'}
        </span>
        <span className="footer-powered">Powered by {company.name} Distribution System</span>
      </div>
    </article>
  );
}

// Document-only CSS — embedded by both the on-screen preview and the batch
// print route, so what is previewed is exactly what prints.
//
// The @media print and @page rules live in SLIP_PRINT_STYLES below rather than
// here, because the in-app preview mounts this stylesheet on a normal
// application page: a global `@page { margin: 0 }` there would quietly change
// how anything else on that page prints.
export const SLIP_STYLES = `
  .slip-page * { color: #000; }
  .slip-page {
    width: 210mm;
    height: 297mm;
    min-height: 297mm;
    max-height: 297mm;
    padding: 10mm 12mm 12mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #000;
    background: #fff;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
    margin: 0 auto;
  }
  .slip-body { height: calc(297mm - 24mm); overflow: hidden; }
  .slip-logo-wrap { background: transparent !important; }

  .slip-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 8px;
    border-bottom: 1.5px solid #000;
    margin-bottom: 11px;
  }
  .slip-brand-row { display: flex; align-items: center; gap: 10px; }
  .slip-brand-text { line-height: 1.3; }
  .slip-company-name { font-size: 16pt; font-weight: 700; }
  .slip-meta { font-size: 9pt; margin-top: 2px; }
  .slip-header-right { text-align: right; min-width: 175px; }
  .slip-doc-title { font-size: 16pt; font-weight: 700; letter-spacing: 2px; margin: 0 0 6px; }
  .slip-meta-table { font-size: 9.2pt; margin-left: auto; }
  .slip-meta-row {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 4px;
    padding: 1px 0;
  }
  .slip-meta-row strong { font-weight: 700; }

  .slip-party-box {
    border: 1px solid #000;
    padding: 8px 10px;
    margin-bottom: 11px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    font-size: 9pt;
  }
  .slip-party-col { flex: 1; min-width: 0; }
  .party-row { display: flex; gap: 6px; align-items: baseline; margin-bottom: 3px; }
  .party-label { font-weight: 400; white-space: nowrap; }
  .party-value { font-weight: 700; overflow-wrap: anywhere; }
  /* Long digit runs (account numbers, IBANs) are easier to read and to
     transcribe with a little extra tracking. */
  .party-digits { letter-spacing: 0.4px; }

  /* Fixed layout so the declared column widths are honoured: earnings and
     deductions each occupy exactly half the table (31% + 19%), and a long
     description wraps onto the next line inside its own cell instead of
     stretching its column and squeezing the other side. */
  .slip-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 9pt;
    margin-bottom: 11px;
  }
  /* Ruled like a printed payslip book: only four horizontal rules on the
     whole table — above and below the header, and above and below the
     totals row. The body rows are separated by whitespace alone, so a long
     wrapped description does not read as a boxed grid. The vertical rules
     stay on every cell: they are what keeps the earnings half visually
     separate from the deductions half. */
  .slip-table th, .slip-table td {
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    /* Explicit "none", not merely omitted: on the in-app preview the global
       stylesheet's tbody td rule sets a grey border-bottom, which applies to
       this table too and would otherwise keep drawing the row rules in grey.
       (No backticks in here — this whole stylesheet is a template literal.) */
    border-top: none;
    border-bottom: none;
    padding: 4px 7px;
    text-align: center;
    vertical-align: top;
  }
  .slip-table thead th {
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    font-weight: 700;
    font-size: 8.5pt;
    letter-spacing: 0.4px;
  }
  .slip-table tfoot td {
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }
  .slip-table .left { text-align: left; width: 31%; overflow-wrap: anywhere; }
  .slip-table .amount { text-align: right; width: 19%; white-space: nowrap; }
  .slip-table .bold { font-weight: 700; }
  .slip-table tbody td { height: 17px; }
  .slip-table tfoot td { font-weight: 700; }

  .slip-net-panel {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 14px;
    border: 1px solid #000;
    margin-bottom: 11px;
  }
  .slip-net-words { flex: 1; padding: 7px 10px; min-width: 0; }
  .slip-net-words-label { font-size: 8pt; margin-bottom: 2px; }
  .slip-net-words-value { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.2px; }
  .slip-net-figure {
    border-left: 1px solid #000;
    padding: 7px 14px;
    text-align: right;
    min-width: 150px;
  }
  .slip-net-label { font-size: 8.5pt; letter-spacing: 1px; }
  .slip-net-value { font-size: 15pt; font-weight: 700; margin-top: 1px; white-space: nowrap; }

  /* ── Sales target — CSS kept for the disabled block above ──────────── */
  .slip-target-box { border: 1px solid #000; padding: 7px 10px; margin-bottom: 11px; }
  .slip-target-title { font-weight: 700; font-size: 9pt; margin-bottom: 5px; }
  .slip-target-grid { display: flex; gap: 10px; }
  .slip-target-cell {
    flex: 1;
    border-left: 1px solid #000;
    padding-left: 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .slip-target-cell:first-child { border-left: none; padding-left: 0; }
  .slip-target-label { font-size: 8pt; }
  .slip-target-value { font-size: 10.5pt; font-weight: 700; white-space: nowrap; }

  /* One signature block only, kept on the right where a countersignature
     belongs on a financial document. */
  .slip-sign-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 22px;
  }
  /* The block itself is what sets the rule's length — narrowing it keeps the
     line, the signature image and the caption centred on one another and
     still flush with the right edge of the table above. min-width keeps a
     long company name from squeezing the rule down to a stub. */
  .slip-sign {
    flex: 0 0 24%;
    min-width: 46mm;
    text-align: center;
    padding-top: 62px;
    font-size: 9pt;
  }
  /* When an authorized-signature image is uploaded on Company Settings,
     shrink the top padding so the image sits in what would otherwise be the
     manual wet-ink whitespace. */
  .slip-sign--has-image { padding-top: 6px; }
  .slip-signature-img {
    display: block;
    margin: 0 auto -2px;
    max-width: 85%;
    max-height: 62px;
    object-fit: contain;
  }
  /* Full width of its block, not the invoice's inset 78%: here the signature
     block is alone on a flush-right row, so anything narrower would stop
     short of the right edge of the earnings/deductions table directly above
     it and read as misaligned. Length is controlled by .slip-sign instead. */
  .slip-sign-line { border-top: 1px solid #000; width: 100%; margin: 0 0 4px; }

  .slip-page-footer {
    position: absolute;
    bottom: 6mm;
    left: 12mm;
    right: 12mm;
    border-top: 1px solid #000;
    padding-top: 5px;
    font-size: 8pt;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .slip-page-footer .footer-printed { flex: 1; }
  .slip-page-footer .footer-powered { text-align: right; }
`;

// Print rules — mounted ONLY by the dedicated print route, never by the
// in-app preview. Mirrors INVOICE_STYLES' @media print block exactly.
export const SLIP_PRINT_STYLES = `
  @media print {
    .no-print { display: none !important; }
    html, body { margin: 0; padding: 0; background: white; width: 210mm; }
    .slip-page {
      width: 210mm !important;
      height: 297mm !important;
      min-height: 297mm !important;
      max-height: 297mm !important;
      margin: 0 !important;
      padding: 10mm 12mm 12mm !important;
      box-shadow: none !important;
    }
    @page { size: A4 portrait; margin: 0; }
  }
`;

// Screen-only chrome for the stacked batch view — kept separate so the
// document CSS above stays purely "what prints on paper".
export const SLIP_SCREEN_STYLES = `
  @media screen {
    body { background: #e2e8f0; }
    .slip-page { box-shadow: 0 4px 32px rgba(0,0,0,0.18); margin: 24px auto; }
  }
`;

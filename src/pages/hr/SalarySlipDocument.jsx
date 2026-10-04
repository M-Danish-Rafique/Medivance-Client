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
//
// Design language (2026-10-01): the SALES INVOICE's — black on white, Arial,
// structure drawn with horizontal rules rather than boxes. The page reads top
// to bottom in four bands:
//
//   1. Header         company · SALARY SLIP, pay period, issue date
//   2. Details        Employee | Employment | Payment, each a label column
//                     of fixed width so every value starts at the same x
//   3. Ledgers        Earnings and Deductions as two ruled tables side by side,
//                     each closing with its own total; amounts in PKR
//   4. Summary band   two columns on the ledgers' grid: Sales Performance and
//                     Loans (each only when it applies) | Pay Summary: Net
//                     Salary · Advance Salary · NET PAYABLE · amount in words
//
// Net Payable is the page's key figure. It is emphasised the way accounts
// emphasise a final total, with weight, size, a rule above and a double rule
// under the amount. There is no tint or box: what the screen shows is exactly
// what a mono printer, a photocopy or a scan reproduces.
//
// Printed-document rules (ui-standards.md §6): plain labels, no formulas or
// letters, no filler rows (the ledgers stretch to equal height and pin their
// totals to the bottom instead), and every loan repayment prints as ONE
// "Loan Deduction" line.

export const LOAN_DEDUCTION_TITLE = 'Loan Deduction';

function parseAmount(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumLines(lines) {
  return (lines || []).reduce((total, line) => total + parseAmount(line.amount), 0);
}

// Loan repayment lines (tagged with a loan_id) collapse into one line, placed
// first as on the client's payslip; every other deduction keeps its own line.
function printedDeductions(deductions) {
  const loanLines = (deductions || []).filter(line => line.loan_id);
  const others    = (deductions || []).filter(line => !line.loan_id);
  if (loanLines.length === 0) return others;
  return [{ title: LOAN_DEDUCTION_TITLE, amount: sumLines(loanLines) }, ...others];
}

const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';

// One label/value pair in a details column. Absent optional values are left
// out entirely rather than printed as a dash.
function Detail({ label, value, digits }) {
  if (!present(value)) return null;
  return (
    <div className="slip-detail">
      <span className="slip-detail-label">{label}</span>
      <span className={`slip-detail-value${digits ? ' is-digits' : ''}`}>{value}</span>
    </div>
  );
}

// One side of the money. The two ledgers sit in a grid row, so both stretch
// to the taller one; the total is pinned to the bottom of each, so the two
// totals always share a baseline however many lines (or wrapped lines) either
// side has, and no blank filler rows are ever printed.
//
// Built from div rows (with ARIA table roles) rather than a <table>: every
// rule is then drawn by a single element. Collapsed table borders are painted
// cell by cell, which left a visible step at the column boundary in the
// scaled in-app preview and a seam risk in PDF output.
function Ledger({ heading, rows, totalLabel, total, emptyText }) {
  return (
    <div className="slip-ledger" role="table" aria-label={heading}>
      <div className="slip-ledger-row is-head" role="row">
        <span role="columnheader">{heading}</span>
        <span role="columnheader" className="slip-amt">AMOUNT (PKR)</span>
      </div>
      {rows.length === 0 ? (
        <div className="slip-ledger-row is-body" role="row">
          <span role="cell">{emptyText}</span>
          <span role="cell" className="slip-amt" />
        </div>
      ) : rows.map((line, i) => (
        <div className="slip-ledger-row is-body" role="row" key={i}>
          <span role="cell" className="slip-ledger-title">{line.title}</span>
          <span role="cell" className="slip-amt">{fmtNum(line.amount)}</span>
        </div>
      ))}
      <div className="slip-ledger-row is-total" role="row">
        <span role="cell">{totalLabel}</span>
        <span role="cell" className="slip-amt">{fmtNum(total)}</span>
      </div>
    </div>
  );
}

// Net payable in words, Pakistani convention, title case:
// 35000      -> "Rupees Thirty-Five Thousand Only"
// 1860880.5  -> "Rupees Eighteen Lakh Sixty Thousand Eight Hundred Eighty and Fifty Paisa Only"
// Built on the invoice's numberToWords so the Lakh/Crore grouping matches.
const TENS_WORDS  = new Set(['TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']);
const UNIT_WORDS  = new Set(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']);
const titleWord   = (w) => w.charAt(0) + w.slice(1).toLowerCase();

function wordsTitleCase(n) {
  const raw = numberToWords(n).split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (TENS_WORDS.has(raw[i]) && UNIT_WORDS.has(raw[i + 1])) {
      out.push(`${titleWord(raw[i])}-${titleWord(raw[i + 1])}`);
      i++;
    } else {
      out.push(titleWord(raw[i]));
    }
  }
  return out.join(' ');
}

export function amountInWords(value) {
  const amount = Math.max(0, Math.round(parseAmount(value) * 100) / 100);
  const rupees = Math.floor(amount);
  const paisa  = Math.round((amount - rupees) * 100);
  return `Rupees ${wordsTitleCase(rupees)}${paisa ? ` and ${wordsTitleCase(paisa)} Paisa` : ''} Only`;
}

export default function SalarySlipDocument({ slip, company, printedAt }) {
  if (!slip) return null;

  const earnings   = slip.earnings || [];
  const deductions = printedDeductions(slip.deductions);

  const totalEarnings   = sumLines(earnings);
  const totalDeductions = sumLines(deductions);
  const netSalary       = totalEarnings - totalDeductions;
  const advance         = parseAmount(slip.advance_amount);
  const netPayable      = parseAmount(slip.net_pay);          // net salary − advance, as stored
  // NULL on payslips written before the pending-loan figure existed: the line
  // is left off them rather than printing a balance that was never recorded.
  const hasLoanBalance  = slip.loan_balance !== null && slip.loan_balance !== undefined;
  // The Loans block prints only when there is something to say: a balance
  // still owed, or a repayment taken on this payslip. "Total Pending Loan
  // 0.00" for someone who never borrowed is noise.
  const repaidThisSlip  = (slip.deductions || []).some(line => line.loan_id);
  const showLoans       = hasLoanBalance && (parseAmount(slip.loan_balance) > 0.005 || repaidThisSlip);

  // Sales target — field employees only. target_amount is only ever set for
  // a field employee, so its presence is the switch. Achievement is measured
  // by the linked Master Data role: invoices for a Salesman, recoveries for a
  // Supplier.
  const hasTarget = !!slip.is_field_employee
    && slip.target_amount !== null && slip.target_amount !== undefined;
  const targetAmount   = parseAmount(slip.target_amount);
  const targetAchieved = slip.target_achieved === null || slip.target_achieved === undefined
    ? null
    : parseAmount(slip.target_achieved);
  const achievedPct = hasTarget && targetAmount > 0 && targetAchieved !== null
    ? (targetAchieved / targetAmount) * 100
    : null;
  const achievedLabel = slip.master_employee_role === 'Supplier' ? 'Total Recovered' : 'Total Sales';

  const hasPayment = [slip.bank_name, slip.account_title, slip.account_number, slip.iban].some(present);
  const hasFacts   = hasTarget || showLoans;

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
        {/* ── 1. Header — identical construction to the invoice ── */}
        <header className="slip-header">
          <div className="slip-brand-row">
            <CompanyLogo logoUrl={company.logo_url} name={company.name} size={48} variant="dark" className="slip-logo-wrap" />
            <div className="slip-brand-text">
              <div className="slip-company-name">{company.name}</div>
              {company.address && <div className="slip-meta">{company.address}</div>}
              {contactParts.length > 0 && <div className="slip-meta">{contactParts.join(', ')}</div>}
            </div>
          </div>
          <div className="slip-header-right">
            <h1 className="slip-doc-title">SALARY SLIP</h1>
            <div className="slip-meta-row"><span>Pay Period:</span><strong>{fmtMonth(slip.month)}</strong></div>
            <div className="slip-meta-row"><span>Issued:</span><strong>{fmtDate(slip.generated_at)}</strong></div>
          </div>
        </header>

        {/* ── 2. Details ── */}
        <section className={`slip-details${hasPayment ? '' : ' is-two'}`} aria-label="Employee details">
          <div className="slip-details-col">
            <div className="slip-caption">Employee</div>
            <Detail label="Name" value={slip.employee_name} />
            <Detail label="Employee ID" value={slip.employee_code} />
            <Detail label="Father’s Name" value={slip.father_name} />
            <Detail label="CNIC" value={slip.cnic ? formatCNIC(slip.cnic) : null} digits />
          </div>
          <div className="slip-details-col">
            <div className="slip-caption">Employment</div>
            <Detail label="Designation" value={slip.designation_name} />
            <Detail label="Department" value={slip.department_name} />
            <Detail label="Date of Joining" value={slip.date_of_joining ? fmtDate(slip.date_of_joining) : null} />
          </div>
          {hasPayment && (
            <div className="slip-details-col">
              <div className="slip-caption">Payment</div>
              <Detail label="Bank" value={slip.bank_name} />
              <Detail label="Account Title" value={slip.account_title} />
              <Detail label="Account No." value={slip.account_number} digits />
              <Detail label="IBAN" value={slip.iban} digits />
            </div>
          )}
        </section>

        {/* ── 3. Ledgers ── */}
        <section className="slip-ledgers" aria-label="Earnings and deductions">
          <Ledger heading="EARNINGS" rows={earnings} totalLabel="Gross Earnings" total={totalEarnings} emptyText="None" />
          <Ledger heading="DEDUCTIONS" rows={deductions} totalLabel="Total Deductions" total={totalDeductions} emptyText="None" />
        </section>

        {/* ── 4. Summary band — facts under Earnings, Pay Summary under Deductions ── */}
        {/* Without a sales target or loan activity there are no facts to
            print, so the band closes up to the Pay Summary column alone, a
            totals block flush right, rather than leaving a ruled empty cell.
            Pay Summary keeps its position on every slip of a batch. */}
        <section className={`slip-summary${hasFacts ? '' : ' is-totals-only'}`} aria-label="Summary">
          {hasFacts && (
          <div className="slip-summary-col is-facts">
            {hasTarget && (
              <>
                <div className="slip-caption">Sales Performance</div>
                <div className="slip-line"><span>Target</span><span>{fmtNum(targetAmount)}</span></div>
                <div className="slip-line">
                  <span>{achievedLabel}</span>
                  <span>{targetAchieved === null ? 'Not available' : fmtNum(targetAchieved)}</span>
                </div>
                <div className="slip-line">
                  <span>Achievement</span>
                  <span>{achievedPct === null ? '—' : `${achievedPct.toFixed(1)}%`}</span>
                </div>
              </>
            )}
            {showLoans && (
              <>
                <div className={`slip-caption${hasTarget ? ' is-spaced' : ''}`}>Loans</div>
                <div className="slip-line"><span>Total Pending Loan</span><span>{fmtNum(slip.loan_balance)}</span></div>
              </>
            )}
          </div>
          )}

          <div className="slip-summary-col is-totals">
            <div className="slip-caption">Pay Summary</div>
            <div className="slip-line"><span>Net Salary</span><span>{fmtNum(netSalary)}</span></div>
            <div className="slip-line"><span>Advance Salary</span><span>{fmtNum(advance)}</span></div>
            <div className="slip-net">
              <span className="slip-net-label">Net Payable</span>
              <span className="slip-net-amount"><span className="slip-ccy">PKR</span>{fmtNum(netPayable)}</span>
            </div>
            <div className="slip-words">{amountInWords(netPayable)}</div>
          </div>
        </section>

        {/* Authorised signatory only — the employee signature block was removed */}
        <div className="slip-sign-row">
          <div className={`slip-sign${company.signature_url ? ' slip-sign--has-image' : ''}`}>
            {company.signature_url && (
              <img
                className="slip-signature-img"
                src={company.signature_url}
                alt="Authorised signature"
              />
            )}
            <div className="slip-sign-line" />
            <div className="slip-sign-title">Authorised Signatory</div>
            <div className="slip-sign-company">{company.name}</div>
          </div>
        </div>
      </div>

      {/* Footer pinned to page bottom — same as the invoice's */}
      <footer className="slip-page-footer">
        <span className="footer-printed">
          {/* Nothing in the on-screen preview (no print time yet) rather than a dash. */}
          {printedAtLabel && <>Printed on <strong>{printedAtLabel}</strong></>}
        </span>
        <span className="footer-powered">Powered by {company.name} Distribution System</span>
      </footer>
    </article>
  );
}

// Document-only CSS — embedded by both the on-screen preview and the batch
// print route, so what is previewed is exactly what prints.
//
// The in-app preview mounts this on a normal application page, where the
// global stylesheet styles every thead th (grey fill, uppercase, padding),
// every tbody td (grey bottom rule, last row cleared) and tbody tr:hover. Every
// table rule below is therefore scoped under .slip-page with at least two
// classes, so it outranks those globals and the preview matches the paper.
// (No backticks anywhere in here — this whole stylesheet is a template literal.)
//
// The @media print and @page rules live in SLIP_PRINT_STYLES below rather than
// here, because a global @page { margin: 0 } on the preview page would
// quietly change how anything else on that page prints.
export const SLIP_STYLES = `
  .slip-page, .slip-page * { color: #000; }
  .slip-page {
    width: 210mm;
    height: 297mm;
    min-height: 297mm;
    max-height: 297mm;
    padding: 8mm 10mm 12mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    line-height: 1.35;
    background: #fff;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
    margin: 0 auto;
  }
  .slip-page *, .slip-page *::before, .slip-page *::after { box-sizing: border-box; }
  .slip-body { height: calc(297mm - 22mm); overflow: hidden; }
  .slip-logo-wrap { background: transparent !important; }

  /* Small-caps section caption, shared by every band. */
  .slip-page .slip-caption {
    margin-bottom: 4px;
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.9px;
    text-transform: uppercase;
  }

  /* 1. Header (the invoice's) */
  .slip-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 7px;
    border-bottom: 1.5px solid #000;
    margin-bottom: 4mm;
  }
  .slip-brand-row { display: flex; align-items: center; gap: 10px; }
  .slip-brand-text { line-height: 1.3; }
  .slip-company-name { font-size: 16pt; font-weight: 700; }
  .slip-meta { font-size: 9pt; margin-top: 2px; }
  .slip-header-right { text-align: right; min-width: 170px; }
  .slip-page .slip-doc-title { font-size: 18pt; font-weight: 700; letter-spacing: 2px; margin: 0 0 6px; line-height: 1.1; }
  .slip-meta-row {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 4px;
    padding: 1px 0;
    font-size: 9.2pt;
  }
  .slip-meta-row strong { font-weight: 700; }

  /* 2. Details — three equal columns, a fixed label column in each. */
  .slip-details {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 8mm;
    padding: 0 0 4mm;
    margin-bottom: 4mm;
    border-bottom: 1px solid #000;
  }
  .slip-details.is-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slip-detail {
    display: grid;
    grid-template-columns: 25mm minmax(0, 1fr);
    gap: 6px;
    align-items: baseline;
    padding: 1.5px 0;
    font-size: 9pt;
  }
  .slip-detail-label { white-space: nowrap; }
  .slip-detail-value { font-weight: 700; overflow-wrap: anywhere; }
  .slip-detail-value.is-digits { letter-spacing: 0.3px; }

  /* 3. Ledgers — two ruled tables, no cell grid (the invoice's table). */
  .slip-ledgers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    gap: 8mm;
    margin-bottom: 4mm;
  }
  .slip-ledger { display: flex; flex-direction: column; font-size: 9pt; }
  .slip-ledger-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34%;
    gap: 8px;
    align-items: baseline;
    padding: 4px 2px;
  }
  .slip-ledger-row.is-head {
    padding: 5px 2px;
    border-top: 1.5px solid #000;
    border-bottom: 1px solid #000;
    font-size: 8.2pt;
    font-weight: 700;
    letter-spacing: 0.4px;
    white-space: nowrap;
  }
  /* A hairline between lines, so a wide row reads across without a grid. */
  .slip-ledger-row.is-body + .slip-ledger-row.is-body { border-top: 0.5px solid #c8c8c8; }
  /* Pinned to the bottom of the (stretched) ledger, so both totals align. */
  .slip-ledger-row.is-total {
    margin-top: auto;
    padding: 5px 2px;
    border-top: 1px solid #000;
    border-bottom: 1.5px solid #000;
    font-weight: 700;
  }
  .slip-ledger-title { overflow-wrap: anywhere; }
  .slip-amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* 4. Summary band — the ledgers' grid, so the facts sit under Earnings and
     Pay Summary under Deductions, figures on the same right edge. */
  .slip-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 8mm;
    font-size: 9.2pt;
  }
  .slip-summary,
  .slip-summary.is-totals-only .slip-summary-col.is-totals {
    padding-top: 3mm;
    padding-bottom: 3.5mm;
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
  }
  .slip-summary-col { padding: 0 2px; }
  .slip-summary-col.is-totals { grid-column: 2; }
  /* No facts: the rules close up around Pay Summary alone, a totals block
     flush right. Its top edge, padding and column are unchanged, so Net
     Payable sits at exactly the same place on every slip of a printed batch. */
  .slip-summary.is-totals-only { padding: 0; border: 0; }
  .slip-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 1.5px 0;
  }
  .slip-line > span:last-child { text-align: right; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  /* Sales Performance and Loans are context, not money paid: regular weight,
     so only the Pay Summary reads as emphasised. */
  .slip-summary-col.is-facts .slip-line > span:last-child { font-weight: 400; }
  .slip-page .slip-caption.is-spaced { margin-top: 3mm; }
  /* Net Payable — the strongest element on the page, in black only. */
  .slip-net {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-top: 5px;
    padding-top: 6px;
    border-top: 1.5px solid #000;
  }
  .slip-net-label {
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .slip-net-amount {
    padding-bottom: 1px;
    border-bottom: 3px double #000;
    font-size: 16pt;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .slip-ccy { margin-right: 5px; font-size: 10pt; font-weight: 700; }
  /* Title case, regular weight, ending on the figure's right edge; balanced so
     a lone "Only" never ends up on its own line. */
  .slip-words { margin-top: 2.5mm; font-size: 9pt; font-weight: 400; line-height: 1.4; text-align: right; text-wrap: balance; }

  /* Authorised signatory, flush right. */
  .slip-sign-row { display: flex; justify-content: flex-end; margin-top: 10mm; }
  .slip-sign {
    flex: 0 0 26%;
    min-width: 48mm;
    text-align: center;
    padding-top: 62px;
    font-size: 9pt;
  }
  .slip-sign--has-image { padding-top: 4px; }
  .slip-signature-img {
    display: block;
    margin: 0 auto -2px;
    max-width: 85%;
    max-height: 62px;
    object-fit: contain;
  }
  .slip-sign-line { border-top: 1px solid #000; width: 100%; margin: 0 0 4px; }
  .slip-sign-title { font-weight: 700; }
  .slip-sign-company { margin-top: 1px; font-weight: 400; }

  /* Footer (the invoice's) */
  .slip-page-footer {
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
      padding: 8mm 10mm 12mm !important;
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

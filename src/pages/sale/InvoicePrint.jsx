import React, { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import { computeInvoiceRows } from '../../utils/invoiceCalculations';
import { formatDatePKT } from '../../utils/dateUtils';
import CompanyLogo from '../../components/common/CompanyLogo';

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '' };

function numberToWords(num) {
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

function fmtNum(n) {
  return parseFloat(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPlainInt(n) {
  return String(Math.round(parseFloat(n || 0)));
}

const fmtDate = (d) => formatDatePKT(d);

const fmtTime = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace(/\s/g, '');
};

const fmtPrintedAt = (d) => {
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
        <div className="warranty-sign">
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

function InvoiceDocument({ saleData, type, customerBalance, company, printedAt }) {
  if (!saleData) return null;

  const {
    invoice_no, date, customer_name, customer_address, customer_id,
    city_name, area_name, territory_name, license_no,
    salesman_name, delivery_by_name, items = [],
  } = saleData;

  const isWarranty = type === 'warranty' || type === 'warranty10';

  const { rows: computedRows, grossAmount, netAmount, totalDiscAmount, referenceNo } =
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
            <table className="invoice-meta-table">
              <tbody>
                <tr><td>Invoice No:</td><td><strong>{invoice_no}</strong></td></tr>
                <tr><td>Date:</td><td><strong>{fmtDate(date)}</strong></td></tr>
                <tr><td>Page:</td><td>1 of 1</td></tr>
              </tbody>
            </table>
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
                <td>{fmtDate(row.exp_date)}</td>
                <td>{fmtNum(row.rate)}</td>
                <td>{fmtNum(row.amount)}</td>
                <td>{row.disc_pct > 0 ? row.disc_pct : '0.00'}</td>
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
            <div className="summary-line"><span>GST :</span><span>0.00</span></div>
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

function PrintBar({ type, setType, onPrint, loading }) {
  const types = [
    { key: 'warranty', label: 'Warranty' },
    { key: 'warranty10', label: 'Warranty (10% Disc)' },
    { key: 'non-warranty', label: 'Non-Warranty' },
  ];
  return (
    <div className="no-print invoice-print-bar">
      <div className="invoice-print-bar-title">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>description</span>
        Invoice Preview
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {types.map(t => (
          <button key={t.key} onClick={() => setType(t.key)}
            className={`invoice-type-btn${type === t.key ? ' active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onPrint} className="invoice-print-btn">
        <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>print</span>
        {loading ? 'Loading...' : 'Print Now'}
      </button>
      <button onClick={() => window.close()} className="invoice-close-btn">Close</button>
    </div>
  );
}

export default function InvoicePrint() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [saleData, setSaleData] = useState(null);
  const [customerBalance, setCustomerBalance] = useState(0);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState(searchParams.get('type') || 'warranty');
  const [printedAt, setPrintedAt] = useState(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/sales/${id}`),
      api.get('/admin/company').catch(() => ({ data: null })),
    ]).then(async ([saleRes, companyRes]) => {
      const sale = saleRes.data;
      setSaleData(sale);
      setCompany({
        name: companyRes.data?.name || DEFAULT_COMPANY.name,
        address: companyRes.data?.address || '',
        phone: companyRes.data?.phone || '',
        email: companyRes.data?.email || '',
        logo_url: companyRes.data?.logo_url || '',
      });
      try {
        const balRes = await api.get(`/customers/${sale.customer_id}/balance`);
        const currentBal = parseFloat(balRes.data.balance || 0);
        const invoiceAmt = parseFloat(sale.total_amount || 0);
        setCustomerBalance(Math.max(0, currentBal - invoiceAmt));
      } catch { setCustomerBalance(0); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const handlePrint = useCallback(() => {
    const now = new Date();
    flushSync(() => setPrintedAt(now));
    setTimeout(() => window.print(), 150);
  }, []);

  useEffect(() => {
    const onBeforePrint = () => {
      flushSync(() => setPrintedAt(new Date()));
    };
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontWeight: 600 }}>Loading invoice...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { color: #000; }
        .invoice-page {
          width: 210mm;
          height: 297mm;
          min-height: 297mm;
          max-height: 297mm;
          padding: 8mm 10mm 12mm;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 8.5px;
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
        .invoice-company-name { font-size: 14px; font-weight: 700; }
        .invoice-meta { font-size: 7.5px; margin-top: 2px; }
        .invoice-header-right { text-align: right; min-width: 145px; }
        .invoice-doc-title { font-size: 16px; font-weight: 700; letter-spacing: 2px; margin-bottom: 5px; }
        .invoice-meta-table { font-size: 8px; margin-left: auto; border-collapse: collapse; }
        .invoice-meta-table td { padding: 1px 0; }
        .invoice-meta-table td:first-child { padding-right: 10px; text-align: right; font-weight: 400; }
        .invoice-meta-table td:last-child { text-align: left; font-weight: 700; }
        .invoice-party-box {
          border: 1px solid #000;
          padding: 7px 10px;
          margin-bottom: 9px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          font-size: 8px;
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
          font-size: 8px;
          margin-bottom: 0;
        }
        .invoice-table thead tr {
          border-top: 1.5px solid #000;
          border-bottom: 1.5px solid #000;
        }
        .invoice-table th {
          padding: 4px 2px;
          text-align: center;
          font-weight: 700;
          font-size: 7.5px;
          color: #000;
          white-space: nowrap;
        }
        .invoice-table td { padding: 3px 2px; text-align: center; vertical-align: top; }
        .invoice-table .left { text-align: left; }
        .invoice-table .bold { font-weight: 700; }
        .invoice-summary-panel {
          border-top: 1.5px solid #000;
          border-bottom: 1.5px solid #000;
          display: flex;
          padding: 7px 2px;
          margin-top: 5px;
          font-size: 8px;
          gap: 12px;
        }
        .summary-col { flex: 1; }
        .summary-col-left { flex: 1.15; }
        .summary-col-mid { flex: 0.95; padding: 0 10px; }
        .summary-col-right { flex: 1.15; }
        .summary-ref { margin-top: 4px; }
        .summary-words { margin-top: 5px; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.2px; }
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
        .warranty-section { margin-top: 7px; font-size: 7.5px; line-height: 1.42; }
        .warranty-expiry { font-weight: 700; font-style: italic; margin-bottom: 4px; }
        .warranty-drug-row { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 6px; }
        .warranty-drug-text { flex: 1.65; }
        .warranty-heading { font-weight: 700; margin: 2px 0; }
        .warranty-body { text-align: justify; }
        .warranty-note { margin-top: 3px; }
        .warranty-sign { flex: 0.75; text-align: center; padding-top: 30px; font-size: 8px; }
        .warranty-sign-line { border-top: 1px solid #000; width: 78%; margin: 0 auto 4px; }
        .drap-box {
          border: 1px solid #000;
          padding: 5px 8px;
          font-size: 7.5px;
          line-height: 1.42;
        }
        .invoice-page-footer {
          position: absolute;
          bottom: 6mm;
          left: 10mm;
          right: 10mm;
          border-top: 1px solid #000;
          padding-top: 5px;
          font-size: 7.5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .footer-printed { flex: 1; }
        .footer-powered { text-align: right; }
        .invoice-print-bar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
          background: white; border-bottom: 2px solid #e2e8f0;
          padding: 10px 20px; display: flex; align-items: center; gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .invoice-print-bar-title {
          font-weight: 800; font-size: 15px; color: #1a365d;
          display: flex; align-items: center; gap: 6px;
        }
        .invoice-type-btn {
          padding: 7px 16px; border-radius: 8px; border: 2px solid #e2e8f0;
          background: white; color: #555; font-weight: 700; font-size: 13px; cursor: pointer;
        }
        .invoice-type-btn.active { border-color: #1a365d; background: #1a365d; color: white; }
        .invoice-print-btn {
          padding: 8px 24px; background: #2563eb; color: white;
          border: none; border-radius: 8px; font-weight: 800; font-size: 14px; cursor: pointer;
        }
        .invoice-close-btn {
          padding: 8px 16px; background: #f1f5f9; color: #555;
          border: none; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;
        }
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
      `}</style>

      <PrintBar type={type} setType={setType} onPrint={handlePrint} loading={loading} />

      <InvoiceDocument
        saleData={saleData}
        type={type}
        customerBalance={customerBalance}
        company={company}
        printedAt={printedAt}
      />
    </>
  );
}

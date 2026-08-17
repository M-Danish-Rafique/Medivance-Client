import { computeInvoiceRows } from './invoiceCalculations';
import { formatDatePKT, formatMonthYearPKT } from './dateUtils';

function fmtTimeLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s/g, '');
}

// Everything the backend needs to DRAW the invoice — no calculation left
// for it to do. The browser already has correct data and correct math
// (computeInvoiceRows is the same function Preview uses), so this payload
// is just that result, serialized.
export function buildInvoicePdfPayload({ saleData, type, customerBalance, company, printedAt }) {
  const {
    invoice_no, date, customer_name, customer_address, customer_id,
    city_name, area_name, territory_name, license_no,
    salesman_name, delivery_by_name, items = [],
  } = saleData;

  const isWarranty = type === 'warranty' || type === 'warranty10';
  const { rows, grossAmount, netAmount, totalDiscAmount, totalTaxAmount, referenceNo } =
    computeInvoiceRows(items, type);

  const prevBalance = parseFloat(customerBalance || 0);
  const totalBalance = prevBalance + netAmount;

  return {
    invoice_no,
    date_label: formatDatePKT(date),
    customer_name,
    customer_address: customer_address || null,
    customer_id: customer_id ?? null,
    geo_line: [city_name, area_name, territory_name].filter(Boolean).join(' , ') || null,
    license_no: license_no || null,
    salesman_name: salesman_name || 'Office',
    delivery_by_name: delivery_by_name || null,
    is_warranty: isWarranty,
    rows: rows.map(r => ({
      prd_id: r.prd_id,
      qty: r.qty,
      bonus: r.bonus || 0,
      product_name: r.product_name,
      pack_size: r.pack_size || null,
      batch_no: r.batch_no || null,
      exp_date_label: formatMonthYearPKT(r.exp_date),
      rate: parseFloat(r.rate) || 0,
      amount: parseFloat(r.amount) || 0,
      disc_pct: parseFloat(r.disc_pct) || 0,
      tax_pct: parseFloat(r.tax_pct) || 0,
      inv_amount: parseFloat(r.inv_amount) || 0,
    })),
    gross_amount: grossAmount,
    net_amount: netAmount,
    total_disc_amount: totalDiscAmount,
    total_tax_amount: totalTaxAmount,
    reference_no: referenceNo ?? null,
    prev_balance: prevBalance,
    total_balance: totalBalance,
    company: {
      name: company.name,
      address: company.address || null,
      phone: company.phone || null,
      email: company.email || null,
      logo_url: company.logo_url || null,
    },
    printed_at_label: printedAt ? `${formatDatePKT(printedAt)}, ${fmtTimeLabel(printedAt)}` : null,
  };
}
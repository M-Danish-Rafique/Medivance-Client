import api from './api';

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '' };

// Everything InvoiceDocument needs to render, fetched the same way for
// both the live /invoice/:id/print page and the Print Queue's background
// PDF builder — one source of truth for how this data is loaded.
export async function fetchInvoiceRenderData(saleId) {
  const [saleRes, companyRes] = await Promise.all([
    api.get(`/sales/${saleId}`),
    api.get('/admin/company').catch(() => ({ data: null })),
  ]);
  const saleData = saleRes.data;
  const company = {
    name: companyRes.data?.name || DEFAULT_COMPANY.name,
    address: companyRes.data?.address || '',
    phone: companyRes.data?.phone || '',
    email: companyRes.data?.email || '',
    logo_url: companyRes.data?.logo_url || '',
  };
  let customerBalance = 0;
  try {
    const balRes = await api.get(`/customers/${saleData.customer_id}/balance`);
    const currentBal = parseFloat(balRes.data.balance || 0);
    const invoiceAmt = parseFloat(saleData.total_amount || 0);
    customerBalance = Math.max(0, currentBal - invoiceAmt);
  } catch { customerBalance = 0; }
  return { saleData, company, customerBalance };
}
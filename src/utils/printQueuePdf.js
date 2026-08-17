// Print Queue PDF helpers.
//
// The browser computes the invoice (correct data, correct math — same
// computeInvoiceRows the Preview page uses) and sends the FINISHED numbers
// to the backend as plain JSON. The backend only draws them with PDFKit —
// the same library and helper functions your existing reports
// (ledger/sales/recovery) already use in routes/reports.js. No browser
// involved anywhere, no recalculation, no guessing at your business math.

import api from './api';
import { fetchInvoiceRenderData } from './invoiceData';
import { buildInvoicePdfPayload } from './invoicePdfPayload';

export function sanitizeFileName(name) {
  const cleaned = (name || 'invoice').replace(/[\\/:*?"<>|]+/g, '').trim();
  const base = cleaned || 'invoice';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// Fetches the invoice's data, computes it, and gets back a rendered PDF Blob.
export async function fetchInvoicePdfBlob(saleId, type) {
  const { saleData, company, customerBalance } = await fetchInvoiceRenderData(saleId);
  const payload = buildInvoicePdfPayload({
    saleData, type, customerBalance, company,
    printedAt: new Date(), // stamped at generation time, always populated
  });

  let res;
  try {
    res = await api.post('/print-queue/render-pdf', payload, {
      responseType: 'blob',
      timeout: 30000,
    });
  } catch (err) {
    const errBlob = err.response?.data;
    if (errBlob instanceof Blob) {
      try {
        const text = await errBlob.text();
        throw new Error(JSON.parse(text).message || 'Error generating PDF');
      } catch { /* fall through to generic message below */ }
    }
    throw new Error(err.message || 'Error generating PDF');
  }
  if (res.data.type && res.data.type !== 'application/pdf') {
    const text = await res.data.text();
    let message = 'Error generating PDF';
    try { message = JSON.parse(text).message || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.data;
}

// Opens the browser's native folder picker. Call this FIRST — before any
// PDFs are generated — so the user isn't left waiting on a permission
// prompt mid-export. Only supported in Chromium-based desktop browsers.
export async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('Choosing a folder isn\u2019t supported in this browser. Please use Chrome or Edge on desktop.');
  }
  return window.showDirectoryPicker();
}

// Writes a single Blob into an already-picked directory.
export async function writeBlobToDirectory(dirHandle, name, blob) {
  const fileHandle = await dirHandle.getFileHandle(sanitizeFileName(name), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
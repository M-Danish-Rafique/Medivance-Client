// Print Queue PDF helpers.
//
// PDFs are generated entirely in the browser by re-using the existing
// /invoice/:id/print page: we load it in a hidden iframe, wait for it to
// report that it has rendered (see the `invoice-ready` event dispatched by
// InvoicePrint.jsx), then rasterize the `.invoice-page` node with
// html2canvas and wrap the image in a single-page A4 PDF via jsPDF.
//
// Requires: npm install html2canvas jspdf

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

export function sanitizeFileName(name) {
  const cleaned = (name || 'invoice').replace(/[\\/:*?"<>|]+/g, '').trim();
  const base = cleaned || 'invoice';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// Renders one invoice into a PDF Blob.
export function generateInvoicePdfBlob(saleId, type) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    iframe.style.border = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    let settled = false;
    const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timeout); cleanup(); fn(arg); };

    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out rendering the invoice for PDF export. Please try again.'));
    }, 20000);

    const capture = async () => {
      try {
        const doc = iframe.contentDocument;
        const page = doc && doc.querySelector('.invoice-page');
        if (!page) throw new Error('Invoice page did not render');
        const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
        finish(resolve, pdf.output('blob'));
      } catch (err) {
        finish(reject, err);
      }
    };

    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentWindow.__invoiceReady) { capture(); return; }
        iframe.contentWindow.addEventListener('invoice-ready', capture, { once: true });
      } catch {
        // Fallback if same-origin access is briefly unavailable right after load.
        setTimeout(capture, 1200);
      }
    });

    iframe.src = `/invoice/${saleId}/print?type=${encodeURIComponent(type)}`;
    document.body.appendChild(iframe);
  });
}

// Lets the user pick a folder once, then writes every { name, blob } pair
// into it. Only supported in Chromium-based desktop browsers.
export async function saveBlobsToDirectory(files) {
  if (!window.showDirectoryPicker) {
    throw new Error('Choosing a folder isn\u2019t supported in this browser. Please use Chrome or Edge on desktop.');
  }
  const dirHandle = await window.showDirectoryPicker();
  for (const f of files) {
    const fileHandle = await dirHandle.getFileHandle(sanitizeFileName(f.name), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(f.blob);
    await writable.close();
  }
  return dirHandle;
}
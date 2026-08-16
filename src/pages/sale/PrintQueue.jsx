import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';
import { fetchInvoicePdfBlob, pickDirectory, writeBlobToDirectory } from '../../utils/printQueuePdf';

const INVOICE_TYPES = [
  { key: 'warranty', label: 'Warranty' },
  { key: 'warranty10', label: 'Warranty (10% Disc)' },
  { key: 'non-warranty', label: 'Non-Warranty' },
];

function openInvoicePrint(saleId, type) {
  window.open(`/invoice/${saleId}/print?type=${type}`, '_blank', 'width=960,height=760,scrollbars=yes');
}

export default function PrintQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null); // { done, total }

  // After a successful export/print run, ask whether to clear those rows out of the queue
  const [postAction, setPostAction] = useState(null); // { ids, verb }

  const load = () => {
    setLoading(true);
    api.get('/print-queue')
      .then(r => setRows(r.data))
      .catch(() => toast.error('Error loading print queue'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const selectedRows = useMemo(() => rows.filter(r => r.is_selected), [rows]);
  const allSelected = rows.length > 0 && rows.every(r => r.is_selected);
  const someSelected = rows.some(r => r.is_selected) && !allSelected;

  const toggleSelectAll = (checked) => setRows(prev => prev.map(r => ({ ...r, is_selected: checked })));
  const updateRow = (id, patch) => setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = async (row) => {
    try {
      await api.delete(`/print-queue/${row.id}`);
      toast.success(`${row.invoice_no} removed from print queue`);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) { toast.error(err.response?.data?.message || 'Error removing from queue'); }
  };

  const handleSaveDraft = async () => {
    if (rows.some(r => !r.pdf_name || !r.pdf_name.trim())) {
      return toast.error('PDF file name cannot be empty');
    }
    setSaving(true);
    try {
      await api.put('/print-queue/bulk', {
        rows: rows.map(r => ({ id: r.id, pdf_name: r.pdf_name, invoice_type: r.invoice_type, is_selected: r.is_selected })),
      });
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving draft');
    } finally { setSaving(false); }
  };

  const removeFromQueue = async (ids) => {
    try {
      await api.post('/print-queue/remove-bulk', { ids });
      setRows(prev => prev.filter(r => !ids.includes(r.id)));
    } catch (err) { toast.error(err.response?.data?.message || 'Error updating print queue'); }
    finally { setPostAction(null); }
  };

  const handleExportToFolder = async () => {
    if (selectedRows.length === 0) return toast.error('Select at least one invoice first');

    // Ask for the folder FIRST — don't make the user wait through PDF
    // generation before finding out where files will go.
    let dirHandle;
    try {
      dirHandle = await pickDirectory();
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled the picker
      return toast.error(err.message || 'Could not access that folder');
    }

    setExporting(true);
    setExportProgress({ done: 0, total: selectedRows.length });
    try {
      for (const row of selectedRows) {
        const blob = await fetchInvoicePdfBlob(row.sale_id, row.invoice_type);
        await writeBlobToDirectory(dirHandle, row.pdf_name, blob);
        setExportProgress(p => ({ done: (p?.done || 0) + 1, total: selectedRows.length }));
      }
      toast.success(`${selectedRows.length} invoice(s) saved`);
      setPostAction({ ids: selectedRows.map(r => r.id), verb: 'saved' });
    } catch (err) {
      toast.error(err.message || 'Error saving PDFs');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const handlePrintSelected = async () => {
    if (selectedRows.length === 0) return toast.error('Select at least one invoice first');
    setPrinting(true);
    try {
      selectedRows.forEach((row, i) => {
        setTimeout(() => openInvoicePrint(row.sale_id, row.invoice_type), i * 250);
      });
      toast.success(`Opening ${selectedRows.length} invoice(s) for printing`);
      setPostAction({ ids: selectedRows.map(r => r.id), verb: 'printed' });
    } finally { setPrinting(false); }
  };

  return (
    <Layout title="Print Queue">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Print Queue</div>
            <div className="text-sm text-muted mt-1">
              {rows.length} invoice{rows.length === 1 ? '' : 's'} pending &middot; {selectedRows.length} selected
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={load} disabled={loading}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>refresh</span>
              Refresh
            </button>
            <button className="btn btn-outline" onClick={handleSaveDraft} disabled={saving || rows.length === 0}>
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button className="btn btn-outline" onClick={handleExportToFolder} disabled={exporting || selectedRows.length === 0}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>folder_open</span>
              {exporting
                ? `Generating ${exportProgress ? `${exportProgress.done}/${exportProgress.total}` : '...'}`
                : 'Save to Folder'}
            </button>
            <button className="btn btn-primary" onClick={handlePrintSelected} disabled={printing || selectedRows.length === 0}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>print</span>
              Print Selected
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
            : rows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>print</span></div>
                <div className="empty-state-title">Print queue is empty</div>
                <div className="text-sm text-muted mt-1">New invoices land here automatically when they're saved.</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected; }}
                        onChange={e => toggleSelectAll(e.target.checked)} />
                    </th>
                    <th>Invoice No</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th style={{ minWidth: 260 }}>PDF File Name</th>
                    <th>Invoice Type</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <input type="checkbox" checked={!!row.is_selected}
                          onChange={e => updateRow(row.id, { is_selected: e.target.checked })} />
                      </td>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{row.invoice_no}</td>
                      <td>{row.customer_name}</td>
                      <td>{formatDatePKT(row.sale_date)}</td>
                      <td>
                        <input className="form-control" style={{ fontSize: 12, padding: '6px 8px' }}
                          value={row.pdf_name}
                          onChange={e => updateRow(row.id, { pdf_name: e.target.value })} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {INVOICE_TYPES.map(t => (
                            <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                              <input type="radio" name={`type-${row.id}`} checked={row.invoice_type === t.key}
                                onChange={() => updateRow(row.id, { invoice_type: t.key })} />
                              {t.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-danger btn-sm btn-icon" title="Remove from queue" onClick={() => removeRow(row)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!postAction}
        onClose={() => setPostAction(null)}
        onConfirm={() => postAction && removeFromQueue(postAction.ids)}
        message={`${postAction?.ids.length || 0} invoice(s) were just ${postAction?.verb || 'processed'}. Remove them from the print queue now?`}
      />
    </Layout>
  );
}
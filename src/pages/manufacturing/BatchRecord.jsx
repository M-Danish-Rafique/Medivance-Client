import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { HrStyles, Notice, FieldGridSkeleton, TableSkeleton, fmtDate } from '../hr/HrKit';
import { MfgStyles, MfgPageHead, BatchStatus } from './mfgKit';
import {
  BatchSections, CostSummary, SendToInventoryDialog, buildBatchModel, openBatchSheet,
} from './batchKit';

// ─── Batch record (read-only) ──────────────────────────────────────────────
// The same sections as the editor, read-only, with the actions the status
// allows (brief 2.3):
//   Draft         Edit · Delete
//   Ready         Send to inventory (primary) · Print batch sheet · Delete
//   In inventory  Print batch sheet
// A draft has no stored costing yet, so its figures are worked out from the
// saved form with the same client costing the editor uses.

// "12/10/2026 at 6:47 PM", the app's printed-time style (stamps are PKT strings).
const fmtStamp = (stamp) => {
  if (!stamp) return null;
  const [h, m] = stamp.slice(11, 16).split(':').map(Number);
  return `${fmtDate(stamp.slice(0, 10))} at ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

function DraftBody({ batch }) {
  const [refs, setRefs] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      api.get('/manufacturing/products'), api.get('/manufacturing/by-products'),
      api.get('/raw-materials'), api.get('/raw-materials/uom'),
    ]).then(([p, b, m, u]) => { if (live) setRefs({ products: p.data, byProducts: b.data, materials: m.data, uoms: u.data }); })
      .catch(() => { if (live) setRefs({ products: [], byProducts: [], materials: [], uoms: [] }); });
    return () => { live = false; };
  }, []);
  const model = useMemo(() => (refs && batch.draft?.form ? buildBatchModel(batch.draft.form, refs, null) : null), [refs, batch]);
  if (!refs) return <RecordSkeleton />;
  const view = model ? model.view : {
    ...batch, materials: [], packs: [], byproducts: [], raw_material_cost: 0, packaging_cost: 0, byproduct_value: 0, total_cost: 0,
  };
  return (
    <div className="mfg-record">
      <div className="mfg-record-main">
        <Notice tone="neutral" style={{ marginBottom: 16 }}>Draft: holds no stock until the batch is created.</Notice>
        <BatchSections batch={view} codeLabel="Draft" />
      </div>
      <div className="mfg-record-side">
        <CostSummary view={view} warnings={model?.warnings || []} shortfalls={model?.shortfalls || []} title="Cost summary (estimate)" />
        <History batch={batch} />
      </div>
    </div>
  );
}

function History({ batch }) {
  const rows = [
    [batch.status === 'draft' ? 'Drafted by' : 'Created by', batch.created_by_name, fmtStamp(batch.created_at)],
    ...(batch.status === 'in_inventory' ? [['Sent by', batch.sent_by_name, fmtStamp(batch.sent_at)]] : []),
  ];
  return (
    <div className="mfg-history">
      <div className="mfg-summary-title">History</div>
      {rows.map(([label, who, when]) => (
        <div key={label} className="mfg-history-row">
          <span className="mfg-history-label">{label}</span>
          <span className="mfg-history-value">{who || 'Unknown user'}<span className="mfg-history-when">{when}</span></span>
        </div>
      ))}
    </div>
  );
}

function RecordSkeleton() {
  return (
    <div className="mfg-record">
      <div className="mfg-record-main">
        <div className="hr-panel"><div className="hr-panel-body"><FieldGridSkeleton fields={8} cols={4} /></div></div>
        <div className="hr-panel"><div className="hr-panel-body"><TableSkeleton columns={4} rows={3} /></div></div>
      </div>
    </div>
  );
}

export default function BatchRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => api.get(`/manufacturing/batches/${id}`)
    .then(r => setBatch(r.data))
    .catch(err => setError(err?.response?.data?.message || 'The batch could not be loaded.')), [id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setSending(true); setSendError(null);
    try {
      await api.post(`/manufacturing/batches/${batch.id}/send-to-inventory`);
      toast.success(`Batch ${batch.batch_code} is in inventory.`);
      setSendOpen(false);
      load();
    } catch (err) {
      setSendError(err?.response?.data?.message || 'The batch could not be sent to inventory. Try again.');
    } finally { setSending(false); }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/manufacturing/batches/${batch.id}`);
      toast.success(batch.status === 'draft' ? 'Draft deleted.' : `Batch ${batch.batch_code} deleted. Its materials are back in stock.`);
      navigate('/manufacturing/batches');
    } catch (err) {
      setDeleteOpen(false);
      toast.error(err?.response?.data?.message || 'The batch could not be deleted. Try again.');
      load();
    } finally { setDeleting(false); }
  };

  const title = batch ? (batch.status === 'draft' ? 'Draft batch' : batch.batch_code) : 'Batch';
  const crumbs = [{ label: 'Batches', to: '/manufacturing/batches' }, { label: title }];
  const actions = !batch ? null : (
    <>
      {batch.status === 'draft' && (
        <>
          <button type="button" className="btn btn-outline-danger" onClick={() => setDeleteOpen(true)}>Delete</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/manufacturing/batches/${batch.id}/edit`)}>
            <span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit
          </button>
        </>
      )}
      {batch.status === 'ready' && (
        <>
          <button type="button" className="btn btn-outline-danger" onClick={() => setDeleteOpen(true)}>Delete</button>
          <button type="button" className="btn btn-outline" onClick={() => openBatchSheet(batch.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">print</span>Print batch sheet
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { setSendError(null); setSendOpen(true); }}>
            <span className="material-symbols-outlined" aria-hidden="true">move_to_inbox</span>Send to inventory
          </button>
        </>
      )}
      {batch.status === 'in_inventory' && (
        <button type="button" className="btn btn-outline" onClick={() => openBatchSheet(batch.id)}>
          <span className="material-symbols-outlined" aria-hidden="true">print</span>Print batch sheet
        </button>
      )}
    </>
  );

  return (
    <Layout title="Batches">
      <HrStyles />
      <MfgStyles />
      <div className="mfg-page">
        <MfgPageHead
          sticky={!!batch}
          crumbs={crumbs}
          title={batch ? title : null}
          meta={batch ? (
            <>
              <span className="mfg-record-product">{batch.product_name}</span>
              <BatchStatus status={batch.status} />
            </>
          ) : null}
          actions={actions}
        />
        {error ? (
          <div className="card">
            <div className="hr-empty" role="alert">
              <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">block</span></div>
              <div className="hr-empty-title">{error}</div>
              <Link className="mfg-link" to="/manufacturing/batches">Back to batches</Link>
            </div>
          </div>
        ) : !batch ? <RecordSkeleton /> : batch.status === 'draft' ? <DraftBody batch={batch} /> : (
          <div className="mfg-record">
            <div className="mfg-record-main">
              {batch.status === 'in_inventory' && (
                <Notice tone="neutral" icon="lock" style={{ marginBottom: 16 }}>{`Read-only: sent to inventory on ${fmtStamp(batch.sent_at)}`}</Notice>
              )}
              <BatchSections batch={batch} />
            </div>
            <div className="mfg-record-side">
              <CostSummary view={batch} warnings={batch.packs.filter(p => Number(p.sale_rate) > 0 && Number(p.cost_per_unit) > Number(p.sale_rate)).map(p => `${p.pack_size} costs more per unit than its sale rate.`)} shortfalls={[]} />
              <History batch={batch} />
            </div>
          </div>
        )}
      </div>

      <SendToInventoryDialog batch={sendOpen ? batch : null} busy={sending} error={sendError}
        onCancel={() => setSendOpen(false)} onConfirm={send} />
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        loading={deleting}
        title={batch?.status === 'draft' ? 'Delete this draft?' : `Delete batch ${batch?.batch_code}?`}
        message={batch?.status === 'draft' ? 'The draft is removed. No stock is affected.' : 'Its raw materials and packaging go back into stock. This cannot be undone.'}
      />
    </Layout>
  );
}

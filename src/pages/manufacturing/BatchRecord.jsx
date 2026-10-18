import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { HrStyles, Notice, KebabMenu, FieldGridSkeleton, TableSkeleton } from '../hr/HrKit';
import { MfgStyles, MfgPageHead, BatchStatus, fmtStamp, mfgError, isTransient, retryOnce } from './mfgKit';
import {
  BatchSections, CostSummary, SendToInventoryDialog, buildBatchModel, openBatchSheet, formulaPath,
} from './batchKit';

// ─── Batch record (read-only) ──────────────────────────────────────────────
// The same sections as the editor, read-only, with the actions the status
// allows (brief 2.3):
//   Draft         Edit · Delete
//   Ready         More (Use as formula, Delete) · Print batch sheet · Send to inventory (primary)
//   In inventory  Print batch sheet · More (Use as formula)
// Use as formula opens the product's formula page filled from this batch
// (?from_batch); nothing is saved there until Save formula.
// A draft has no stored costing yet, so its figures are worked out from the
// saved form with the same client costing the editor uses.

const LOAD_FAILED = 'Couldn’t load the batch. Check your connection and try again.';

function LoadError({ error, onRetry }) {
  return (
    <div className="card">
      <div className="hr-empty" role="alert">
        <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{error.retry ? 'cloud_off' : 'block'}</span></div>
        <div className="hr-empty-title">{error.message}</div>
        {error.retry
          ? <button type="button" className="btn btn-outline" onClick={onRetry}>Try again</button>
          : <Link className="mfg-link" to="/manufacturing/batches">Back to batches</Link>}
      </div>
    </div>
  );
}

function DraftBody({ batch }) {
  const [refs, setRefs] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    retryOnce(() => Promise.all([
      api.get('/manufacturing/products'), api.get('/manufacturing/by-products'),
      api.get('/raw-materials'), api.get('/raw-materials/uom'),
    ]), () => live).then(([p, b, m, u]) => { if (live) setRefs({ products: p.data, byProducts: b.data, materials: m.data, uoms: u.data }); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [reloadKey]);
  const model = useMemo(() => (refs && batch.draft?.form ? buildBatchModel(batch.draft.form, refs, null) : null), [refs, batch]);
  if (failed) return <LoadError error={{ message: LOAD_FAILED, retry: true }} onRetry={() => setReloadKey(k => k + 1)} />;
  if (!refs) return <RecordSkeleton />;
  const view = model ? model.view : {
    ...batch, materials: [], packs: [], byproducts: [], raw_material_cost: 0, packaging_cost: 0, byproduct_value: 0, total_cost: 0,
  };
  return (
    <div className="mfg-record">
      <div className="mfg-record-main">
        <Notice tone="neutral" style={{ marginBottom: 16 }}>This draft holds no stock. Materials are taken from stock when the batch is created.</Notice>
        <BatchSections batch={view} />
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
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => retryOnce(() => api.get(`/manufacturing/batches/${id}`))
    .then(r => { setError(null); setBatch(r.data); })
    .catch(err => setError(err?.response?.status === 404
      ? { message: 'This batch no longer exists.' }
      : isTransient(err) ? { message: LOAD_FAILED, retry: true } : { message: mfgError(err, 'This batch cannot be opened.') })), [id]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const send = async () => {
    setSending(true); setSendError(null);
    try {
      await api.post(`/manufacturing/batches/${batch.id}/send-to-inventory`);
      toast.success(`Batch ${batch.batch_code} is in inventory.`);
      setSendOpen(false);
      load();
    } catch (err) {
      setSendError(mfgError(err, 'The batch could not be sent to inventory. Try again.'));
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
      toast.error(mfgError(err, 'The batch could not be deleted. Try again.'));
      load();
    } finally { setDeleting(false); }
  };

  const title = batch ? (batch.status === 'draft' ? 'Draft batch' : batch.batch_code) : 'Batch';
  const useAsFormula = batch?.packs?.length
    ? () => navigate(`${formulaPath(batch.packs[0].product_id)}?from_batch=${batch.id}`) : null;
  // The occasional actions share one "More" menu, a header button of the same
  // height as its neighbours. Its name reads "More actions".
  const moreMenu = (items) => (
    <KebabMenu
      label="More actions"
      trigger={{ icon: 'more_vert', label: <>More<span className="hr-sr-only"> actions</span></>, className: 'btn btn-outline' }}
      items={items}
    />
  );
  const formulaItem = useAsFormula ? [{ label: 'Use as formula', icon: 'content_copy', onClick: useAsFormula }] : [];
  const crumbs = [{ label: 'Batches', to: '/manufacturing/batches' }, { label: title }];
  const actions = !batch ? null : (
    <>
      {batch.status === 'draft' && (
        <>
          {moreMenu([{ label: 'Delete', icon: 'delete', danger: true, onClick: () => setDeleteOpen(true) }])}
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/manufacturing/batches/${batch.id}/edit`)}>
            <span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit
          </button>
        </>
      )}
      {batch.status === 'ready' && (
        <>
          {moreMenu([
            ...(formulaItem.length ? [...formulaItem, { divider: true }] : []),
            { label: 'Delete', icon: 'delete', danger: true, onClick: () => setDeleteOpen(true) },
          ])}
          <button type="button" className="btn btn-outline" onClick={() => openBatchSheet(batch.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">print</span>Print batch sheet
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { setSendError(null); setSendOpen(true); }}>
            <span className="material-symbols-outlined" aria-hidden="true">move_to_inbox</span>Send to inventory
          </button>
        </>
      )}
      {batch.status === 'in_inventory' && (
        <>
          {formulaItem.length > 0 && moreMenu(formulaItem)}
          <button type="button" className="btn btn-outline" onClick={() => openBatchSheet(batch.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">print</span>Print batch sheet
          </button>
        </>
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
        {error ? <LoadError error={error} onRetry={() => { setError(null); setBatch(null); setReloadKey(k => k + 1); }} /> : !batch ? <RecordSkeleton /> : batch.status === 'draft' ? <DraftBody batch={batch} /> : (
          <div className="mfg-record">
            <div className="mfg-record-main">
              {batch.status === 'in_inventory' && (
                <Notice tone="neutral" icon="lock" style={{ marginBottom: 16 }}>{`Sent to inventory on ${fmtStamp(batch.sent_at)}. This batch is read-only.`}</Notice>
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import {
  HrStyles, Tabs, KebabMenu, useSort, sortRows, fmtAmount, fmtDate, num,
} from '../hr/HrKit';
import { MfgStyles, BatchStatus, EMPTY, SortHead, fmtQty } from './mfgKit';
import { SendToInventoryDialog, openBatchSheet } from './batchKit';

// ─── Batches ───────────────────────────────────────────────────────────────
// Batches own their whole life (brief 2.1): Draft -> Ready for inventory ->
// In inventory. The list opens on All, newest first; a row opens the batch
// record; New batch opens the full-page editor. Send to inventory, print and
// delete are also in each row's menu, as far as the status allows.
// Sorting follows the module's rules: dates and numbers newest/largest first,
// blank values (a draft's code or cost) last, ties newest first.

const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const stamp = (b) => `${b.created_at || ''}#${String(b.id).padStart(9, '0')}`;
const COMPARATORS = {
  created: { value: stamp },
  batch_code: { value: b => b.batch_code, text: true },
  product_name: { value: b => b.product_name, text: true },
  batch_date: { value: b => b.batch_date },
  expiry_date: { value: b => b.expiry_date },
  units: { value: b => (num(b.pack_units) > 0 ? num(b.pack_units) : null) },
  total_cost: { value: b => (b.status === 'draft' ? null : num(b.total_cost)) },
};
const newestFirst = (a, b) => stamp(b).localeCompare(stamp(a));

export default function Batches() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const sort = useSort('created', 'desc');
  const [sendBatch, setSendBatch] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => api.get('/manufacturing/batches')
    .then(r => setBatches(r.data))
    .catch(err => toast.error(err?.response?.data?.message || 'The batches could not be loaded. Refresh the page.'))
    .finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: batches.length,
    draft: batches.filter(b => b.status === 'draft').length,
    ready: batches.filter(b => b.status === 'ready').length,
    in_inventory: batches.filter(b => b.status === 'in_inventory').length,
  }), [batches]);
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => sortRows(
    batches.filter(b => (tab === 'all' || b.status === tab)
      && (!q || String(b.batch_code || '').toLowerCase().includes(q) || b.product_name.toLowerCase().includes(q))),
    sort.sortConfig, COMPARATORS, newestFirst,
  ), [batches, tab, q, sort.sortConfig]);

  const openSend = async (b) => {
    setSendError(null);
    try {
      const r = await api.get(`/manufacturing/batches/${b.id}`);
      setSendBatch(r.data);
    } catch (err) { toast.error(err?.response?.data?.message || 'The batch could not be loaded.'); }
  };
  const send = async () => {
    setSending(true); setSendError(null);
    try {
      await api.post(`/manufacturing/batches/${sendBatch.id}/send-to-inventory`);
      toast.success(`Batch ${sendBatch.batch_code} is in inventory.`);
      setSendBatch(null); load();
    } catch (err) {
      setSendError(err?.response?.data?.message || 'The batch could not be sent to inventory. Try again.');
    } finally { setSending(false); }
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/manufacturing/batches/${deleteTarget.id}`);
      toast.success(deleteTarget.status === 'draft' ? 'Draft deleted.' : `Batch ${deleteTarget.batch_code} deleted. Its materials are back in stock.`);
      setDeleteTarget(null); load();
    } catch (err) {
      setDeleteTarget(null);
      toast.error(err?.response?.data?.message || 'The batch could not be deleted. Try again.');
      load();
    } finally { setDeleting(false); }
  };

  const menu = (b) => {
    const items = [{ label: 'Open', icon: 'open_in_new', onClick: () => navigate(`/manufacturing/batches/${b.id}`) }];
    if (b.status === 'draft') items.push({ label: 'Edit', icon: 'edit', onClick: () => navigate(`/manufacturing/batches/${b.id}/edit`) });
    if (b.status === 'ready') items.push({ label: 'Send to inventory', icon: 'move_to_inbox', onClick: () => openSend(b) });
    if (b.status !== 'draft') items.push({ label: 'Print batch sheet', icon: 'print', onClick: () => openBatchSheet(b.id) });
    items.push({ divider: true });
    items.push({
      label: 'Delete', icon: 'delete', danger: true,
      disabled: b.status === 'in_inventory',
      title: b.status === 'in_inventory' ? 'In inventory. The batch is read-only.' : undefined,
      onClick: () => setDeleteTarget(b),
    });
    return items;
  };

  // One small icon and one sentence.
  const empty = q
    ? { icon: 'search_off', title: `No batch matches "${search.trim()}".` }
    : {
      all: { icon: 'factory', title: 'No batches yet. Start one with New batch.' },
      draft: { icon: 'edit_note', title: 'No drafts.' },
      ready: { icon: 'pending_actions', title: 'No batches are waiting for inventory.' },
      in_inventory: { icon: 'inventory', title: 'No batches have been sent to inventory yet.' },
    }[tab];

  return (
    <Layout title="Batches">
      <HrStyles />
      <MfgStyles />
      <div className="card">
        <div className="mfg-card-head">
          <Tabs
            ariaLabel="Batch status"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'all', label: `All (${counts.all})` },
              { value: 'draft', label: `Draft (${counts.draft})` },
              { value: 'ready', label: `Ready for inventory (${counts.ready})` },
              { value: 'in_inventory', label: `In inventory (${counts.in_inventory})` },
            ]}
          />
          <div className="mfg-head-actions">
            <div className="search-bar">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input placeholder="Search batches" aria-label="Search batches by code or product" value={search}
                onChange={e => setSearch(e.target.value)} style={{ width: 170 }} />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/manufacturing/batches/new')}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
              New batch
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : shown.length === 0 ? (
          <div className="hr-empty">
            <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{empty.icon}</span></div>
            <div className="hr-empty-title">{empty.title}</div>
          </div>
        ) : (
          <div className="hr-page-scroll">
            <table className="hr-table hr-page-table">
              <thead>
                <tr>
                  <SortHead sort={sort} column="batch_code" label="Batch code" style={{ width: '13%' }} />
                  <SortHead sort={sort} column="product_name" label="Product" />
                  <SortHead sort={sort} column="batch_date" label="Batch date" date style={{ width: '11%' }} />
                  <SortHead sort={sort} column="expiry_date" label="Expiry" date style={{ width: '11%' }} />
                  <th className="hr-th-num" style={{ width: '9%' }}>Output</th>
                  <SortHead sort={sort} column="units" label="Units" num style={{ width: '8%' }} />
                  <SortHead sort={sort} column="total_cost" label="Total cost (PKR)" num style={{ width: '14%' }} />
                  <th style={{ width: '15%' }}>Status</th>
                  <th style={{ width: 56 }}><span className="hr-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(b => (
                  <tr key={b.id} className="hr-row-click" tabIndex={0}
                    onClick={() => navigate(`/manufacturing/batches/${b.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/manufacturing/batches/${b.id}`); }}>
                    <td className="mfg-code">{b.batch_code || <span className="mfg-sub">Draft</span>}</td>
                    <td className="hr-cell-strong">{b.product_name}</td>
                    <td style={tabular}>{b.batch_date ? fmtDate(b.batch_date) : EMPTY}</td>
                    <td style={tabular}>{b.expiry_date ? fmtDate(b.expiry_date) : EMPTY}</td>
                    <td className="hr-num">{num(b.total_volume) > 0 ? fmtQty(b.total_volume, b.vol_uom_symbol) : EMPTY}</td>
                    <td className="hr-num">{b.pack_units > 0 ? fmtQty(b.pack_units) : EMPTY}</td>
                    <td className="hr-num">{b.status === 'draft' ? EMPTY : fmtAmount(b.total_cost)}</td>
                    <td><BatchStatus status={b.status} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <KebabMenu label={`Actions for ${b.batch_code || `draft ${b.product_name}`}`} items={menu(b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SendToInventoryDialog batch={sendBatch} busy={sending} error={sendError} onCancel={() => setSendBatch(null)} onConfirm={send} />
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title={deleteTarget?.status === 'draft' ? 'Delete this draft?' : `Delete batch ${deleteTarget?.batch_code}?`}
        message={deleteTarget?.status === 'draft' ? 'The draft is removed. No stock is affected.' : 'Its raw materials and packaging go back into stock. This cannot be undone.'}
      />
    </Layout>
  );
}

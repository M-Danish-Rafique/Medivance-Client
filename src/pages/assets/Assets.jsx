import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import DateInput from '../../components/common/DateInput';
import { InlineNew, ListsDialog, sortByName } from '../../components/common/ManagedLists';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { todayPKT } from '../../utils/dateUtils';
import {
  HrStyles, Tabs, KebabMenu, FormField, BusyButton, Notice, EmptyState, TableSkeleton,
  useSort, sortRows, fmtAmount, fmtDate, fmtDay, num,
} from '../hr/HrKit';
import {
  MfgStyles, Picker, NumberField, MfgField, WarnText, EMPTY, SortHead, ColumnMenu, useColumnPrefs,
  parseNum, normKey, cleanText, plural, round2, mfgError, retryOnce, fmtClock, fmtStamp,
} from '../manufacturing/mfgKit';

// ─── Assets register ───────────────────────────────────────────────────────
// What the organization owns (furniture, computers, vehicles, machinery),
// who owns each item and what it cost. One page, two tabs (In use /
// Disposed, kept in the URL as ?tab=in-use|disposed); add, edit, dispose,
// move back and delete happen in dialogs. Nothing here posts to Finance.
//   Price: the total is what was paid; the unit price agrees with it. In the
//     form, whichever price the user typed last drives the other
//     (total = qty × unit, or unit = total ÷ qty rounded to the paisa).
//   Disposing part of the quantity splits the entry on the server: the
//     disposed part becomes a new entry with its own code.
//   Types and owners are managed lists (components/common/ManagedLists).
// Rules mirror server/routes/assets.js (authoritative).

const MAX_PRICE = 999999999.99;
const MAX_QTY = 99999;

const onThose = (n) => (Number(n) === 1 ? 'on that asset' : 'on those assets');
const LISTS = {
  types: {
    path: '/assets/types', noun: 'asset type', Noun: 'Asset type', aNoun: 'an asset type', nounPlural: 'asset types',
    listLabel: 'Asset types', maxLength: 40, placeholder: 'New asset type name',
    countKey: 'asset_count', countOne: 'asset', countMany: 'assets',
    lockedRename: () => null,
    lockedDelete: (t) => `${t.name} is used by ${plural(t.asset_count, 'asset', 'assets')}. Choose another type ${onThose(t.asset_count)} first.`,
  },
  owners: {
    path: '/assets/owners', noun: 'owner', Noun: 'Owner', aNoun: 'an owner', nounPlural: 'owners',
    listLabel: 'Owners', maxLength: 60, placeholder: 'New owner name',
    countKey: 'asset_count', countOne: 'asset', countMany: 'assets',
    lockedRename: () => null,
    lockedDelete: (o) => `${o.name} is the owner of ${plural(o.asset_count, 'asset', 'assets')}. Choose another owner ${onThose(o.asset_count)} first.`,
  },
};

// Optional columns. Asset, Qty and Total are always shown. Type, Owned by,
// the date column (Purchased / Disposed on) and Description are one choice
// for both tabs; Unit price is chosen per tab (off by default on Disposed).
const COLUMN_DEFAULTS = { type: true, owner: true, date: true, unit: true, unit_disposed: false, description: false };
const COLUMNS = {
  in_use: [
    { key: 'type', label: 'Type' },
    { key: 'owner', label: 'Owned by' },
    { key: 'date', label: 'Purchased' },
    { key: 'unit', label: 'Unit price' },
    { key: 'description', label: 'Description' },
  ],
  disposed: [
    { key: 'type', label: 'Type' },
    { key: 'owner', label: 'Owned by' },
    { key: 'date', label: 'Disposed on' },
    { key: 'unit_disposed', label: 'Unit price' },
    { key: 'description', label: 'Description' },
  ],
};
const FIXED_COLUMNS = ['Asset', 'Qty', 'Total'];

// Sorting: blank values last, ties in the default order (name, then code).
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true });
const defaultOrder = (a, b) => byName(a, b) || byCode(a, b);
const SORTS = {
  asset: byName,
  type: { value: a => a.type_name, text: true },
  owner: { value: a => a.owner_name, text: true },
  purchased: { value: a => a.purchase_date || null },
  disposed: { value: a => a.disposed_on || null },
  qty: { value: a => a.qty },
  unit: { value: a => num(a.unit_price) },
  total: { value: a => num(a.total_price) },
  description: { value: a => a.description || null, text: true },
};
// The column a sort key needs to be visible (fixed columns need none).
const SORT_COLUMN = { type: 'type', owner: 'owner', purchased: 'date', disposed: 'date', unit: 'unit', description: 'description' };

const paisa = (value) => Math.round(Number(value) * 100);
const fix2 = (n) => round2(n).toFixed(2);
const searchText = (a) => [a.code, a.name, a.serial_no, a.description, a.type_name, a.owner_name]
  .filter(Boolean).join('\n').toLowerCase();

// ── Add / edit form ────────────────────────────────────────────────────────
const FIELD_ORDER = ['name', 'serial_no', 'asset_type_id', 'owner_id', 'qty', 'unit_price', 'total_price',
  'purchase_date', 'description', 'disposed_on', 'disposal_note'];
const emptyForm = {
  name: '', serial_no: '', asset_type_id: '', owner_id: '', qty: '1', unit_price: '', total_price: '',
  purchase_date: '', description: '', disposed_on: '', disposal_note: '',
};
const toForm = (a) => ({
  name: a.name || '',
  serial_no: a.serial_no || '',
  asset_type_id: a.asset_type_id ?? '',
  owner_id: a.owner_id ?? '',
  qty: String(a.qty),
  unit_price: fix2(num(a.unit_price)),
  total_price: fix2(num(a.total_price)),
  purchase_date: a.purchase_date || '',
  description: a.description || '',
  disposed_on: a.disposed_on || '',
  disposal_note: a.disposal_note || '',
});

const validQty = (v) => { const n = parseNum(v); return Number.isInteger(n) && n >= 1 && n <= MAX_QTY ? n : null; };
function priceError(value) {
  if (String(value).trim() === '') return 'Enter the price.';
  const n = parseNum(value);
  if (!(n >= 0)) return 'Enter a price of 0 or more.';
  if (n > MAX_PRICE) return 'Enter a price of PKR 999,999,999.99 or less.';
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return 'Enter the price with no more than 2 decimals.';
  return null;
}

/** The price field the user typed in last drives the other one. */
function recompute(form, driver) {
  const qty = validQty(form.qty);
  if (driver === 'unit') {
    const unit = parseNum(form.unit_price);
    return { ...form, total_price: qty && unit >= 0 ? fix2(qty * unit) : '' };
  }
  if (driver === 'total') {
    const total = parseNum(form.total_price);
    return { ...form, unit_price: qty && total >= 0 ? fix2(total / qty) : '' };
  }
  return form;
}

function validate(form, { disposed }) {
  const e = {};
  const name = cleanText(form.name);
  if (!name) e.name = 'Enter the asset name.';
  else if (name.length > 120) e.name = 'The asset name must have 120 characters or fewer.';
  if (!form.asset_type_id) e.asset_type_id = 'Choose a type.';
  if (!form.owner_id) e.owner_id = 'Choose who owns it.';
  const qty = parseNum(form.qty);
  if (!(Number.isInteger(qty) && qty >= 1)) e.qty = 'Enter a whole number of 1 or more.';
  else if (qty > MAX_QTY) e.qty = 'Enter a quantity of 99,999 or less.';
  const unitError = priceError(form.unit_price);
  const totalError = priceError(form.total_price);
  if (unitError) e.unit_price = unitError;
  if (totalError) e.total_price = totalError;
  if (!e.qty && !unitError && !totalError
    && Math.abs(qty * paisa(form.unit_price) - paisa(form.total_price)) > 0.5 * qty + 1e-9) {
    e.unit_price = 'The unit price does not match the total for this quantity. Check the figures.';
  }
  const today = todayPKT();
  if (form.purchase_date && form.purchase_date > today) e.purchase_date = "The purchase date can't be in the future.";
  if (cleanText(form.description).length > 500) e.description = 'The description must have 500 characters or fewer.';
  if (disposed) {
    if (!form.disposed_on) e.disposed_on = 'Enter the disposal date.';
    else if (form.disposed_on > today) e.disposed_on = "The disposal date can't be in the future.";
    else if (form.purchase_date && form.disposed_on < form.purchase_date) e.disposed_on = "The disposal date can't be before the purchase date.";
  }
  return e;
}

function changed(form, record) {
  const base = toForm(record);
  const text = (k) => cleanText(form[k]) !== cleanText(base[k]);
  const money = (k) => paisa(form[k]) !== paisa(base[k]);
  return text('name') || text('serial_no') || text('description') || text('disposal_note')
    || String(form.asset_type_id) !== String(base.asset_type_id) || String(form.owner_id) !== String(base.owner_id)
    || parseNum(form.qty) !== parseNum(base.qty) || money('unit_price') || money('total_price')
    || form.purchase_date !== base.purchase_date || form.disposed_on !== base.disposed_on;
}

/** "at 6:51 PM" today, else "on 12/10/2026 at 6:51 PM" (formula page wording). */
function whenText(stamp) {
  if (!stamp) return '';
  return stamp.slice(0, 10) === todayPKT() ? ` at ${fmtClock(stamp)}` : ` on ${fmtStamp(stamp)}`;
}

function AssetDialog({ record, assets, types, owners, onTypes, onOwners, onClose, onSaved, onGone }) {
  const { user } = useAuth();
  const [base, setBase] = useState(record);          // the version being edited (null = add)
  const [form, setForm] = useState(record ? toForm(record) : emptyForm);
  const [driver, setDriver] = useState(record ? 'total' : null);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(null);    // { byId, by, at }
  const bodyRef = useRef(null);
  const editing = !!base;
  const disposed = base?.status === 'disposed';

  const setField = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setServerErrors(p => (p[key] ? { ...p, [key]: undefined } : p));
  };
  const touch = (key) => setTouched(p => ({ ...p, [key]: true }));
  const setPrice = (key, value) => {
    const next = key === 'unit_price' ? 'unit' : 'total';
    setDriver(next);
    setForm(f => recompute({ ...f, [key]: value }, next));
    setServerErrors(p => ({ ...p, unit_price: undefined, total_price: undefined }));
  };
  const setQty = (value) => {
    setForm(f => recompute({ ...f, qty: value }, driver));
    setServerErrors(p => ({ ...p, qty: undefined, unit_price: undefined, total_price: undefined }));
  };

  const errors = validate(form, { disposed });
  const firstError = FIELD_ORDER.map(k => errors[k]).find(Boolean);
  const isChanged = editing ? changed(form, base) : true;
  const blockedReason = conflict ? 'Reload to continue.' : editing && !isChanged ? 'No changes yet' : firstError || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);

  // Under Total: how the two figures relate, once there are two or more.
  const qty = validQty(form.qty);
  const unitOk = !priceError(form.unit_price);
  const totalOk = !priceError(form.total_price);
  let totalHelp;
  if (qty && qty > 1 && unitOk && totalOk) {
    totalHelp = driver === 'total' && qty * paisa(form.unit_price) !== paisa(form.total_price)
      ? `Unit price rounded to ${fmtAmount(form.unit_price)}. The total stays ${fmtAmount(form.total_price)}.`
      : `${qty.toLocaleString('en-US')} × ${fmtAmount(form.unit_price)}`;
  }
  // Another entry with the same serial (a part split off this one, or the
  // entry it came from, shares it legitimately).
  const serial = cleanText(form.serial_no);
  const related = (a) => !!base && (a.split_from_id === base.id || a.id === base.split_from_id
    || (!!base.split_from_id && a.split_from_id === base.split_from_id));
  const sameSerial = serial
    ? assets.find(a => a.id !== base?.id && !related(a) && a.serial_no && normKey(a.serial_no) === normKey(serial)) : null;
  const descLength = form.description.length;

  const typeOptions = types.map(t => ({ value: t.id, label: t.name }));
  const ownerOptions = owners.map(o => ({ value: o.id, label: o.name }));

  const save = async () => {
    setTouched(Object.fromEntries(FIELD_ORDER.map(k => [k, true])));
    if (blockedReason) return;
    setSaving(true); setServerErrors({}); setSaveError(null);
    const payload = {
      name: cleanText(form.name),
      serial_no: serial || null,
      asset_type_id: form.asset_type_id,
      owner_id: form.owner_id,
      qty: parseNum(form.qty),
      unit_price: form.unit_price,
      total_price: form.total_price,
      purchase_date: form.purchase_date || null,
      description: cleanText(form.description) || null,
      ...(disposed ? { disposed_on: form.disposed_on, disposal_note: cleanText(form.disposal_note) || null } : {}),
    };
    try {
      const r = editing
        ? await api.put(`/assets/${base.id}`, { ...payload, expected_updated_at: base.updated_at })
        : await api.post('/assets', payload);
      toast.success(editing ? `Changes to ${r.data.code} saved.` : `Asset ${r.data.code} added.`);
      onSaved(r.data, !editing);
    } catch (err) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      if (status === 409 && body?.code === 'ASSET_CHANGED') {
        setConflict({ byId: body.updated_by_id, by: body.updated_by_name, at: body.updated_at });
        bodyRef.current?.closest('.modal')?.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (status === 404) {
        toast.error(`${base.code} no longer exists. It was deleted by someone else.`);
        onGone();
      } else if (body?.field && FIELD_ORDER.includes(body.field)) {
        setServerErrors({ [body.field]: body.message });
      } else {
        setSaveError(mfgError(err, editing ? 'The changes could not be saved. Try again.' : 'The asset could not be added. Try again.'));
      }
    } finally { setSaving(false); }
  };

  // Loads the latest version; the edits made here are dropped.
  const reload = async () => {
    try {
      const r = await api.get('/assets');
      const latest = r.data.find(a => a.id === base.id);
      if (!latest) {
        toast.error(`${base.code} no longer exists. It was deleted by someone else.`);
        onGone(r.data);
        return;
      }
      setBase(latest); setForm(toForm(latest)); setDriver('total');
      setTouched({}); setServerErrors({}); setConflict(null); setSaveError(null);
    } catch (err) {
      toast.error(mfgError(err, 'The asset could not be reloaded. Try again.'));
    }
  };

  const conflictText = !conflict ? null
    : user?.id && conflict.byId === user.id
      ? `You saved this asset in another window${whenText(conflict.at)}. Reload to see that version.`
      : conflict.by
        ? `${conflict.by} changed this asset${whenText(conflict.at)}. Reload to see their version.`
        : 'Someone else changed this asset while you were editing. Reload to see their version.';

  return (
    <Modal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title={editing ? 'Edit asset' : 'Add asset'}
      size="md"
      footer={(
        <>
          {blockedReason && <span role="status" className="mfg-foot-status" style={{ marginRight: 'auto' }}>{blockedReason}</span>}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <BusyButton busy={saving} busyLabel="Saving…" onClick={save} disabled={!!blockedReason}>
            {editing ? 'Save changes' : 'Add asset'}
          </BusyButton>
        </>
      )}
    >
      <div ref={bodyRef} className="ast-dialog">
        {conflict && (
          <Notice tone="danger" style={{ marginBottom: 14 }}>
            <span className="mfg-notice-line">
              <span>{conflictText}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={reload}>Reload</button>
            </span>
          </Notice>
        )}
        {saveError && <Notice tone="danger" style={{ marginBottom: 14 }}>{saveError}</Notice>}
        {editing && (
          <p className="ast-meta">
            {`${base.code} · Added ${fmtDay(base.created_at)}${base.created_by_name ? ` by ${base.created_by_name}` : ''}`}
          </p>
        )}
        <div className="hr-form-grid is-modal">
          <FormField label="Asset name" htmlFor="as-name" required col={8} error={errorFor('name')}>
            <input id="as-name" className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
              placeholder="Enter the asset name" value={form.name} maxLength={120} autoFocus
              onChange={e => setField('name', e.target.value)} onBlur={() => touch('name')} />
          </FormField>
          <FormField label="Serial / tag no." htmlFor="as-serial" col={4} error={errorFor('serial_no')}
            help={sameSerial ? <WarnText>{`${sameSerial.code} ${sameSerial.name} has the same serial no.`}</WarnText> : undefined}>
            <input id="as-serial" className={`form-control${errorFor('serial_no') ? ' hr-invalid' : ''}`}
              placeholder="Optional" value={form.serial_no} maxLength={60}
              onChange={e => setField('serial_no', e.target.value)} onBlur={() => touch('serial_no')} />
          </FormField>

          <MfgField label="Type" htmlFor="as-type" required className="hr-col-6" error={errorFor('asset_type_id')}
            labelAction={(
              <InlineNew list={LISTS.types} items={types} pickerId="as-type"
                onCreated={t => { onTypes(ts => sortByName([...ts, t])); setField('asset_type_id', t.id); touch('asset_type_id'); }} />
            )}>
            <Picker id="as-type" ariaLabel="Type" value={form.asset_type_id} options={typeOptions} placeholder="Select type"
              searchPlaceholder="Search types" invalid={!!errorFor('asset_type_id')}
              onChange={v => { setField('asset_type_id', v); touch('asset_type_id'); }} onBlur={() => touch('asset_type_id')} />
          </MfgField>
          <MfgField label="Owned by" htmlFor="as-owner" required className="hr-col-6" error={errorFor('owner_id')}
            help="A partner, director or the company itself."
            labelAction={(
              <InlineNew list={LISTS.owners} items={owners} pickerId="as-owner"
                onCreated={o => { onOwners(os => sortByName([...os, o])); setField('owner_id', o.id); touch('owner_id'); }} />
            )}>
            <Picker id="as-owner" ariaLabel="Owned by" value={form.owner_id} options={ownerOptions} placeholder="Select owner"
              searchPlaceholder="Search owners" invalid={!!errorFor('owner_id')}
              onChange={v => { setField('owner_id', v); touch('owner_id'); }} onBlur={() => touch('owner_id')} />
          </MfgField>

          <FormField label="Qty" htmlFor="as-qty" required col={2} error={errorFor('qty')}>
            <NumberField id="as-qty" integer value={form.qty} invalid={!!errorFor('qty')}
              onChange={setQty} onBlur={() => touch('qty')} />
          </FormField>
          <FormField label="Unit price (PKR)" htmlFor="as-unit" required col={5} error={errorFor('unit_price')}>
            <NumberField id="as-unit" value={form.unit_price} invalid={!!errorFor('unit_price')}
              onChange={v => setPrice('unit_price', v)} onBlur={() => touch('unit_price')} />
          </FormField>
          <FormField label="Total (PKR)" htmlFor="as-total" required col={5} error={errorFor('total_price')} help={totalHelp}>
            <NumberField id="as-total" value={form.total_price} invalid={!!errorFor('total_price')}
              onChange={v => setPrice('total_price', v)} onBlur={() => touch('total_price')} />
          </FormField>

          <FormField label="Purchase date" htmlFor="as-date" col={6} error={errorFor('purchase_date')}>
            <DateInput id="as-date" value={form.purchase_date} max={todayPKT()} invalid={!!errorFor('purchase_date')}
              className={`form-control${errorFor('purchase_date') ? ' hr-invalid' : ''}`}
              onChange={e => { setField('purchase_date', e.target.value); touch('purchase_date'); }}
              onBlur={() => touch('purchase_date')} />
          </FormField>
          <div className="hr-col-6" />

          <FormField label="Description" htmlFor="as-desc" col={12} error={errorFor('description')}
            help={descLength > 400 ? <span className="ast-counter">{`${descLength} / 500`}</span> : undefined}>
            <textarea id="as-desc" rows={3} className={`form-control${errorFor('description') ? ' hr-invalid' : ''}`}
              placeholder="Optional" value={form.description} maxLength={500}
              onChange={e => setField('description', e.target.value)} onBlur={() => touch('description')} />
          </FormField>

          {disposed && (
            <>
              <div className="hr-col-12 ast-form-section"><h3 className="hr-subhead">Disposal</h3></div>
              <FormField label="Disposed on" htmlFor="as-disposed" required col={6} error={errorFor('disposed_on')}>
                <DateInput id="as-disposed" value={form.disposed_on} min={form.purchase_date || undefined} max={todayPKT()}
                  invalid={!!errorFor('disposed_on')}
                  className={`form-control${errorFor('disposed_on') ? ' hr-invalid' : ''}`}
                  onChange={e => { setField('disposed_on', e.target.value); touch('disposed_on'); }}
                  onBlur={() => touch('disposed_on')} />
              </FormField>
              <FormField label="Note" htmlFor="as-note" col={6} error={errorFor('disposal_note')}>
                <input id="as-note" className={`form-control${errorFor('disposal_note') ? ' hr-invalid' : ''}`}
                  placeholder="Optional" value={form.disposal_note} maxLength={200}
                  onChange={e => setField('disposal_note', e.target.value)} onBlur={() => touch('disposal_note')} />
              </FormField>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Mark as disposed ───────────────────────────────────────────────────────
function DisposeDialog({ asset, onClose, onDone }) {
  const [qty, setQty] = useState(String(asset.qty));
  const [date, setDate] = useState(todayPKT());
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const many = asset.qty > 1;
  const today = todayPKT();

  const errors = {};
  const n = parseNum(qty);
  if (many) {
    if (!(Number.isInteger(n) && n >= 1)) errors.qty = 'Enter a whole number of 1 or more.';
    else if (n > asset.qty) errors.qty = `Enter a quantity of ${asset.qty.toLocaleString('en-US')} or less.`;
  }
  if (!date) errors.disposed_on = 'Enter the disposal date.';
  else if (date > today) errors.disposed_on = "The disposal date can't be in the future.";
  else if (asset.purchase_date && date < asset.purchase_date) errors.disposed_on = "The disposal date can't be before the purchase date.";
  const firstError = errors.qty || errors.disposed_on || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);
  const count = many ? n : 1;
  const partial = many && !errors.qty && count < asset.qty;
  const rest = asset.qty - count;

  const confirm = async () => {
    setTouched({ qty: true, disposed_on: true });
    if (firstError) return;
    setBusy(true); setServerErrors({}); setSaveError(null);
    try {
      const r = await api.post(`/assets/${asset.id}/dispose`, { qty: count, disposed_on: date, note: cleanText(note) || null });
      toast.success(partial
        ? `${count.toLocaleString('en-US')} of ${asset.qty.toLocaleString('en-US')} disposed as ${r.data.disposed.code}.`
        : `${asset.code} marked as disposed.`);
      onDone(r.data);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && ['qty', 'disposed_on', 'note'].includes(body.field)) setServerErrors({ [body.field]: body.message });
      else setSaveError(mfgError(err, 'The asset could not be marked as disposed. Try again.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={`Dispose ${asset.code} ${asset.name}`}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} busyLabel="Saving…" onClick={confirm}>Mark as disposed</BusyButton>
        </>
      )}
    >
      {saveError && <Notice tone="danger" style={{ marginBottom: 14 }}>{saveError}</Notice>}
      <p className="mfg-confirm-text" style={{ marginBottom: 16 }}>
        It moves to Disposed and stops counting in the in-use total. Nothing is posted to Finance.
      </p>
      <div className="hr-form-grid is-modal">
        {many && (
          <FormField label="Quantity to dispose" htmlFor="ad-qty" required col={5} error={errorFor('qty')}>
            <NumberField id="ad-qty" integer value={qty} suffix={`of ${asset.qty.toLocaleString('en-US')}`}
              invalid={!!errorFor('qty')} autoFocus
              onChange={v => { setQty(v); setServerErrors({}); }} onBlur={() => setTouched(t => ({ ...t, qty: true }))} />
          </FormField>
        )}
        <FormField label="Disposed on" htmlFor="ad-date" required col={many ? 7 : 12} error={errorFor('disposed_on')}>
          <DateInput id="ad-date" value={date} min={asset.purchase_date || undefined} max={today}
            invalid={!!errorFor('disposed_on')}
            className={`form-control${errorFor('disposed_on') ? ' hr-invalid' : ''}`}
            onChange={e => { setDate(e.target.value); setTouched(t => ({ ...t, disposed_on: true })); setServerErrors({}); }}
            onBlur={() => setTouched(t => ({ ...t, disposed_on: true }))} />
        </FormField>
        <FormField label="Note" htmlFor="ad-note" col={12} error={errorFor('note')}>
          <input id="ad-note" className={`form-control${errorFor('note') ? ' hr-invalid' : ''}`} placeholder="Optional"
            value={note} maxLength={200} onChange={e => { setNote(e.target.value); setServerErrors({}); }} />
        </FormField>
      </div>
      {partial && (
        <Notice tone="neutral">
          {`${count.toLocaleString('en-US')} of ${asset.qty.toLocaleString('en-US')} ${count === 1 ? 'moves' : 'move'} to Disposed as a new entry. `
            + `${rest.toLocaleString('en-US')} ${rest === 1 ? 'stays' : 'stay'} in use as ${asset.code}.`}
        </Notice>
      )}
    </Modal>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Assets() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'disposed' ? 'disposed' : 'in_use';
  const setTab = (next) => setParams({ tab: next === 'disposed' ? 'disposed' : 'in-use' }, { replace: true });

  const [assets, setAssets] = useState([]);
  const [types, setTypes] = useState([]);
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [denied, setDenied] = useState(null);           // the server's message without perm_assets
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const inUseSort = useSort('asset');
  const disposedSort = useSort('asset');
  const cols = useColumnPrefs('assets-columns-v1', COLUMN_DEFAULTS);

  const [dialog, setDialog] = useState(null);           // { record } (null record = add)
  const [disposeTarget, setDisposeTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const rowRefs = useRef({});
  const live = useRef(true);
  // Set on every mount: StrictMode (development) mounts, unmounts and mounts
  // again, and a flag left false would drop every response (endless skeleton).
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  // `quiet`: refresh after a change, without the skeleton.
  const load = (quiet) => {
    if (!quiet) { setLoading(true); setLoadFailed(false); }
    return retryOnce(() => Promise.all([api.get('/assets'), api.get('/assets/types'), api.get('/assets/owners')]), () => live.current)
      .then(([a, t, o]) => {
        if (!live.current) return;
        setAssets(a.data); setTypes(t.data); setOwners(o.data); setLoadFailed(false);
      })
      .catch((err) => {
        if (!live.current) return;
        // Opened by URL without perm_assets (the sidebar hides the item).
        if (err?.response?.data?.code === 'PERMISSION_DENIED') setDenied(mfgError(err, 'You do not have access to Assets.'));
        else if (!quiet) setLoadFailed(true);
      })
      .finally(() => { if (live.current) setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  // A filter on a type or owner that no longer exists falls away.
  useEffect(() => {
    if (typeFilter && !types.some(t => String(t.id) === String(typeFilter))) setTypeFilter('');
    if (ownerFilter && !owners.some(o => String(o.id) === String(ownerFilter))) setOwnerFilter('');
  }, [types, owners, typeFilter, ownerFilter]);

  // The added or edited row: highlighted and brought into view.
  useEffect(() => {
    if (!flashId) return undefined;
    const row = rowRefs.current[flashId];
    if (row) {
      const rect = row.getBoundingClientRect();
      if (rect.top < 64 + 48 || rect.bottom > window.innerHeight) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const t = setTimeout(() => setFlashId(null), 1900);
    return () => clearTimeout(t);
  }, [flashId]);

  // ── Lists ──
  const q = search.trim().toLowerCase();
  const filtering = !!(q || typeFilter || ownerFilter);
  const matches = (a) => (!q || searchText(a).includes(q))
    && (!typeFilter || String(a.asset_type_id) === String(typeFilter))
    && (!ownerFilter || String(a.owner_id) === String(ownerFilter));
  const clearFilters = () => { setSearch(''); setTypeFilter(''); setOwnerFilter(''); };

  const tabRows = useMemo(() => assets.filter(a => a.status === tab), [assets, tab]);
  const counts = useMemo(() => ({
    in_use: assets.filter(a => a.status === 'in_use').length,
    disposed: assets.filter(a => a.status === 'disposed').length,
  }), [assets]);

  const columns = COLUMNS[tab];
  const unitKey = tab === 'disposed' ? 'unit_disposed' : 'unit';
  const show = (key) => cols.isShown(key === 'unit' ? unitKey : key);
  // The column menu speaks for this tab's columns only.
  const tabPrefs = {
    isShown: cols.isShown,
    toggle: cols.toggle,
    isDefault: columns.every(c => cols.isShown(c.key) === (COLUMN_DEFAULTS[c.key] !== false)),
    reset: () => columns.forEach(c => { if (cols.isShown(c.key) !== (COLUMN_DEFAULTS[c.key] !== false)) cols.toggle(c.key); }),
  };
  const sort = tab === 'disposed' ? disposedSort : inUseSort;
  const sortColumn = SORT_COLUMN[sort.sortConfig.column];
  const sortConfig = sortColumn && !show(sortColumn) ? { column: 'asset', direction: 'asc' } : sort.sortConfig;
  const sortView = { ...sort, sortConfig };
  const shown = useMemo(
    () => sortRows(tabRows.filter(matches), sortConfig, SORTS, defaultOrder),
    [tabRows, q, typeFilter, ownerFilter, sortConfig.column, sortConfig.direction]
  );
  const shownItems = shown.reduce((s, a) => s + Number(a.qty), 0);
  const shownTotal = shown.reduce((s, a) => s + paisa(a.total_price), 0) / 100;

  // ── Changes ──
  const upsert = (rows) => setAssets(list => {
    const next = list.filter(a => !rows.some(r => r.id === a.id));
    return [...next, ...rows];
  });
  // After an add or edit the row must be visible: on its tab, and not hidden
  // by the search or a filter.
  const reveal = (row) => {
    if (row.status !== tab) setTab(row.status === 'disposed' ? 'disposed' : 'in_use');
    if (!matches(row)) clearFilters();
    setFlashId(row.id);
  };
  const onSaved = (row) => {
    setDialog(null);
    upsert([row]);
    reveal(row);
    load(true);
  };
  const onGone = () => { setDialog(null); load(true); };

  const confirmRestore = async () => {
    setRestoring(true);
    try {
      const r = await api.post(`/assets/${restoreTarget.id}/restore`);
      toast.success(`${r.data.code} moved back to in use.`);
      setRestoreTarget(null);
      upsert([r.data]);
      load(true);
    } catch (err) {
      setRestoreTarget(null);
      toast.error(mfgError(err, 'The asset could not be moved back to in use. Try again.'));
      load(true);
    } finally { setRestoring(false); }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleting(true);
    try {
      await api.delete(`/assets/${target.id}`);
      toast.success(`${target.code} deleted.`);
      setDeleteTarget(null);
      setAssets(list => list.filter(a => a.id !== target.id));
      load(true);
    } catch (err) {
      setDeleteTarget(null);
      toast.error(mfgError(err, 'The asset could not be deleted. Try again.'));
      load(true);
    } finally { setDeleting(false); }
  };

  const actions = (a) => [
    { label: 'Edit', icon: 'edit', onClick: () => setDialog({ record: a }) },
    a.status === 'in_use'
      ? { label: 'Mark as disposed', icon: 'output', onClick: () => setDisposeTarget(a) }
      : { label: 'Move back to in use', icon: 'undo', onClick: () => setRestoreTarget(a) },
    { divider: true },
    { label: 'Delete', icon: 'delete', danger: true, onClick: () => setDeleteTarget(a) },
  ];

  // ── Render ──
  const typeOptions = [{ value: '', label: 'All types' }, ...types.map(t => ({ value: t.id, label: t.name }))];
  const ownerOptions = [{ value: '', label: 'All owners' }, ...owners.map(o => ({ value: o.id, label: o.name }))];
  // Widths: Type and Owned by are sized so typical names ("Farhan Sheikh
  // (Partner)", "Office equipment") fit at 1366. With Description on, Asset
  // claims 22% (as Product does on Mfg Products with Formula on), the other
  // columns give up some of theirs and Description, an ellipsis column, takes
  // what is left.
  const narrow = show('description');
  const w = (wide, tight) => ({ width: narrow ? tight : wide });

  const summary = tab === 'in_use' ? (
    <>
      {plural(shown.length, 'asset', 'assets')}
      {shownItems !== shown.length && ` · ${plural(shownItems, 'item', 'items')}`}
      {' · '}<strong>{`PKR ${fmtAmount(shownTotal)}`}</strong>
    </>
  ) : (
    <>
      {plural(shown.length, 'asset', 'assets')}
      {' · '}<strong>{`PKR ${fmtAmount(shownTotal)}`}</strong> at purchase price
    </>
  );

  let body;
  if (loading) {
    body = <div className="ast-skeleton"><TableSkeleton columns={7} rows={6} /></div>;
  } else if (loadFailed) {
    body = (
      <EmptyState icon="error" title="Assets could not be loaded." desc="Check your connection and try again."
        action={<button type="button" className="btn btn-outline" onClick={() => load()}>Retry</button>} />
    );
  } else if (assets.length === 0) {
    body = (
      <EmptyState icon="chair" title="No assets yet"
        desc="Record what the organization owns, such as furniture, computers, vehicles and machinery, with who owns it and what it cost."
        action={(
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ record: null })}>
            <span className="material-symbols-outlined" aria-hidden="true">add</span>Add asset
          </button>
        )} />
    );
  } else if (tabRows.length === 0) {
    body = tab === 'disposed' ? (
      <EmptyState small icon="inventory" title="Nothing disposed"
        desc="Assets you mark as sold, scrapped or lost move here, with the date." />
    ) : (
      <EmptyState small icon="chair" title="No assets in use"
        desc="Every asset on record is disposed. Add an asset, or move one back to in use from Disposed." />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState small icon="search_off" title="No assets match"
        action={<button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>} />
    );
  } else {
    body = (
      <div className="hr-page-scroll">
        <table className="hr-table hr-page-table ast-table">
          <thead>
            <tr>
              <SortHead sort={sortView} column="asset" label="Asset" style={narrow ? { width: '22%' } : undefined} />
              {show('type') && <SortHead sort={sortView} column="type" label="Type" style={w('14%', '10%')} />}
              {show('owner') && <SortHead sort={sortView} column="owner" label="Owned by" style={w('17%', '13%')} />}
              {show('date') && (tab === 'in_use'
                ? <SortHead sort={sortView} column="purchased" label="Purchased" date style={w('11%', '10.5%')} />
                : <SortHead sort={sortView} column="disposed" label="Disposed on" date style={w('13%', '11.5%')} />)}
              <SortHead sort={sortView} column="qty" label="Qty" num style={{ width: '6%' }} />
              {show('unit') && <SortHead sort={sortView} column="unit" label="Unit price" num style={w('11%', '10%')} />}
              <SortHead sort={sortView} column="total" label="Total" num style={w('12%', '11%')} />
              {show('description') && <SortHead sort={sortView} column="description" label="Description" />}
              <th style={{ width: 56, textAlign: 'right' }}>
                <ColumnMenu columns={columns} prefs={tabPrefs} fixed={FIXED_COLUMNS} />
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(a => (
              <tr key={a.id} ref={el => { rowRefs.current[a.id] = el; }} className={flashId === a.id ? 'mfg-flash' : undefined}>
                <td className="ast-asset">
                  <div className="ast-asset-name" title={a.name}>{a.name}</div>
                  <div className="ast-asset-sub">{a.code}{a.serial_no && ` · SN ${a.serial_no}`}</div>
                </td>
                {show('type') && <td className="mfg-ellipsis" title={a.type_name}>{a.type_name}</td>}
                {show('owner') && <td className="mfg-ellipsis" title={a.owner_name}>{a.owner_name}</td>}
                {show('date') && (tab === 'in_use' ? (
                  <td className="ast-date">{a.purchase_date ? fmtDate(a.purchase_date) : EMPTY}</td>
                ) : (
                  <td className="ast-date ast-two-line">
                    <div>{fmtDate(a.disposed_on)}</div>
                    {a.disposal_note && <div className="ast-asset-sub ast-one-line" title={a.disposal_note}>{a.disposal_note}</div>}
                  </td>
                ))}
                <td className="hr-num">{Number(a.qty).toLocaleString('en-US')}</td>
                {show('unit') && <td className="hr-num">{fmtAmount(a.unit_price)}</td>}
                <td className="hr-num ast-total">{fmtAmount(a.total_price)}</td>
                {show('description') && (
                  <td className="mfg-ellipsis" title={a.description || undefined}>{a.description || EMPTY}</td>
                )}
                <td style={{ textAlign: 'right' }}>
                  <KebabMenu label={`Actions for ${a.name} (${a.code})`} items={actions(a)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (denied) {
    return (
      <Layout title="Assets">
        <HrStyles />
        <div className="card">
          <EmptyState icon="lock" title="No access to Assets" desc={denied} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Assets">
      <HrStyles />
      <MfgStyles />
      <style dangerouslySetInnerHTML={{ __html: ASSET_STYLES }} />
      <div className="card">
        <div className="mfg-card-head ast-head">
          <Tabs
            ariaLabel="Asset lists"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'in_use', label: 'In use', count: loading || loadFailed ? undefined : counts.in_use },
              { value: 'disposed', label: 'Disposed', count: loading || loadFailed ? undefined : counts.disposed },
            ]}
          />
          <div className="mfg-head-actions">
            <div className="search-bar ast-search">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input placeholder="Search assets…" aria-label="Search assets" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button type="button" className="btn btn-outline" onClick={() => setListsOpen(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">sell</span>
              Types &amp; owners
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ record: null })}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
              Add asset
            </button>
          </div>
        </div>
        {!loading && !loadFailed && (tabRows.length > 0 || filtering) && (
          <div className="ast-filterbar">
            <div className="ast-filters">
              <div className="ast-filter">
                <Picker id="af-type" ariaLabel="Filter by type" value={typeFilter} options={typeOptions}
                  placeholder="All types" searchPlaceholder="All types" onChange={setTypeFilter} />
              </div>
              <div className="ast-filter">
                <Picker id="af-owner" ariaLabel="Filter by owner" value={ownerFilter} options={ownerOptions}
                  placeholder="All owners" searchPlaceholder="All owners" onChange={setOwnerFilter} />
              </div>
              {filtering && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
            {shown.length > 0 && <div className="ast-summary" role="status">{summary}</div>}
          </div>
        )}
        {body}
      </div>

      {dialog && (
        <AssetDialog
          key={dialog.record ? dialog.record.id : 'new'}
          record={dialog.record}
          assets={assets}
          types={types}
          owners={owners}
          onTypes={setTypes}
          onOwners={setOwners}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
          onGone={onGone}
        />
      )}

      {disposeTarget && (
        <DisposeDialog
          asset={disposeTarget}
          onClose={() => setDisposeTarget(null)}
          onDone={({ asset, disposed }) => {
            setDisposeTarget(null);
            upsert(asset.id === disposed.id ? [asset] : [asset, disposed]);
            if (asset.id !== disposed.id) setFlashId(asset.id);
            load(true);
          }}
        />
      )}

      <Modal
        isOpen={!!restoreTarget}
        onClose={() => { if (!restoring) setRestoreTarget(null); }}
        title={restoreTarget ? `Move ${restoreTarget.code} ${restoreTarget.name} back to in use?` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setRestoreTarget(null)} disabled={restoring}>Cancel</button>
            <BusyButton busy={restoring} busyLabel="Moving…" onClick={confirmRestore}>Move back to in use</BusyButton>
          </>
        )}
      >
        {restoreTarget && (
          <p className="mfg-confirm-text">
            {`${restoreTarget.code} ${restoreTarget.name} moves back to In use and its disposal date and note are cleared.`}
          </p>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        title={deleteTarget ? `Delete ${deleteTarget.code} ${deleteTarget.name}?` : ''}
        message={deleteTarget?.status === 'disposed'
          ? 'This removes the entry permanently.'
          : 'This removes the entry permanently. If the organization no longer has it, use Mark as disposed instead so it stays on record.'}
      />

      <ListsDialog
        isOpen={listsOpen}
        onClose={() => setListsOpen(false)}
        title="Types & owners"
        tabs={[
          { key: 'types', label: 'Asset types', list: LISTS.types, rows: types },
          { key: 'owners', label: 'Owners', list: LISTS.owners, rows: owners },
        ]}
        onChanged={(key, next) => { if (key === 'types') setTypes(next); else setOwners(next); load(true); }}
      />
    </Layout>
  );
}

const ASSET_STYLES = `
  /* Head: the search gives up width (240 -> 180px) before anything wraps. */
  .ast-head .mfg-head-actions { flex: 1 1 auto; flex-wrap: nowrap; }
  .ast-head .ast-search { flex: 1 1 180px; min-width: 180px; max-width: 240px; box-sizing: border-box; }
  .ast-head .ast-search input { width: 100%; min-width: 0; }
  .ast-head .mfg-head-actions .btn { flex-shrink: 0; white-space: nowrap; }

  /* Filter bar: one 44px row under the head. */
  .ast-filterbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    min-height: 44px; padding: 5px 22px; box-sizing: border-box; border-bottom: 1px solid var(--gray-100);
  }
  .ast-filters { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ast-filter { width: 200px; }
  .ast-filter .hr-select-trigger.is-block { padding-top: 5px; padding-bottom: 5px; }
  .ast-filter .mfg-search .form-control { padding-top: 5px; padding-bottom: 5px; }
  .ast-summary { font-size: 13px; color: var(--gray-500); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ast-summary strong { font-weight: 600; color: var(--gray-800); }

  /* Asset cell: the name on one line, the code and serial under it. */
  .ast-table td.ast-asset, .ast-table td.ast-two-line { max-width: 0; }
  .ast-asset-name { font-weight: 500; color: var(--gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ast-asset-sub { margin-top: 2px; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; line-height: 1.4; }
  .ast-one-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ast-date { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ast-total { font-weight: 600; color: var(--gray-900); }
  .ast-skeleton { padding: 4px 8px 8px; }

  /* Dialogs. A long asset dialog (a disposed asset) keeps its buttons in
     view while the form scrolls. */
  .modal:has(.ast-dialog) .modal-footer { position: sticky; bottom: 0; z-index: 1; background: white; }
  .ast-meta { margin: 0 0 16px; font-size: 13px; color: var(--gray-500); font-variant-numeric: tabular-nums; }
  .ast-form-section { margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--gray-100); }
  .ast-form-section .hr-subhead { margin: 0 0 4px; }
  .ast-counter { display: block; text-align: right; font-variant-numeric: tabular-nums; }
`;

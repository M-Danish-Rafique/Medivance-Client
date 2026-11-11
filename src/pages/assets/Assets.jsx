import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import DateInput from '../../components/common/DateInput';
import { InlineNew, ListEditor, sortByName } from '../../components/common/ManagedLists';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { todayPKT } from '../../utils/dateUtils';
import {
  HrStyles, Segmented, KebabMenu, FormField, FieldGrid, Field, BusyButton, Notice, EmptyState, TableSkeleton,
  useSort, sortRows, fmtAmount, fmtDate, fmtDay, num,
} from '../hr/HrKit';
import {
  MfgStyles, Picker, NumberField, MfgField, WarnText, EMPTY, SortHead, ColumnMenu, useColumnPrefs,
  parseNum, normKey, cleanText, plural, round2, mfgError, retryOnce, fmtClock, fmtStamp,
} from '../manufacturing/mfgKit';

// ─── Assets register ───────────────────────────────────────────────────────
// What the organization has today (furniture, computers, vehicles,
// machinery), who owns each item and what it is worth now: the current
// value, not what was paid. One page with an Active / Retired switch (kept in
// the URL as ?tab=active|retired); a row opens the asset's detail view
// (?asset=AST-0001, so a link opens it directly). Add, edit, update value,
// retire, reinstate and delete happen in dialogs. Nothing here posts to
// Finance.
//   Value: the total is the current value of the entry; the unit value
//     agrees with it. In the form, whichever figure the user typed last
//     drives the other (total = qty × unit, or unit = total ÷ qty rounded to
//     the paisa). "Value as of" is the date that value applies to; Update
//     value records a new figure for a chosen date, and every change is kept
//     in the value history.
//   Retired: the organization no longer has or uses the asset, for a reason
//     the users keep in their own list (Sold, Scrapped, Lost …), with a
//     retirement date and a note. Retiring part of the quantity splits the
//     entry on the server: that part becomes a new entry with its own code.
//     Reinstate moves a retired asset back to Active.
//   Types, owners and reasons are managed lists (components/common/
//     ManagedLists), each in its own pop-up from the ⋮ menu in the head.
// Rules mirror server/routes/assets.js (authoritative).

const MAX_VALUE = 999999999.99;
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
  reasons: {
    path: '/assets/reasons', noun: 'reason', Noun: 'Reason', aNoun: 'a reason', nounPlural: 'reasons',
    listLabel: 'Reasons', maxLength: 40, placeholder: 'New reason, such as Sold',
    countKey: 'asset_count', countOne: 'asset', countMany: 'assets',
    lockedRename: () => null,
    lockedDelete: (r) => `${r.name} is the reason on ${plural(r.asset_count, 'asset', 'assets')}. Choose another reason ${onThose(r.asset_count)} first.`,
  },
};
// Each list opens in its own pop-up from the head's ⋮ menu.
const LIST_DIALOGS = {
  types: { title: 'Asset types', icon: 'category' },
  owners: { title: 'Owners', icon: 'person' },
  reasons: {
    title: 'Reasons', icon: 'label',
    hint: 'Why an asset is retired, such as Sold, Scrapped or Lost.',
  },
};

// The switch: active | retired, in the URL as ?tab=active|retired (an older
// ?tab=disposed or ?tab=not-in-use link lands on Retired).
const TAB_PARAM = { active: 'active', retired: 'retired' };
const tabFromParam = (p) => (['retired', 'disposed', 'not-in-use'].includes(p) ? 'retired' : 'active');

// Optional columns. Asset, Qty and Value are always shown. Type and Owned by
// are one choice for both tabs; the rest belong to one tab.
const COLUMN_DEFAULTS = {
  type: true, owner: true, purchased: true, unit: true, value_as_of: true, reason: true, retired_on: true, unit_out: false,
};
const COLUMNS = {
  active: [
    { key: 'type', label: 'Type' },
    { key: 'owner', label: 'Owned by' },
    { key: 'purchased', label: 'Purchased' },
    { key: 'unit', label: 'Unit value' },
    { key: 'value_as_of', label: 'Value as of' },
  ],
  retired: [
    { key: 'type', label: 'Type' },
    { key: 'owner', label: 'Owned by' },
    { key: 'reason', label: 'Reason' },
    { key: 'retired_on', label: 'Retired on' },
    { key: 'unit_out', label: 'Unit value' },
  ],
};
const FIXED_COLUMNS = ['Asset', 'Qty', 'Value'];

// Sorting: blank values last, ties in the default order (name, then code).
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true });
const defaultOrder = (a, b) => byName(a, b) || byCode(a, b);
const SORTS = {
  asset: byName,
  type: { value: a => a.type_name, text: true },
  owner: { value: a => a.owner_name, text: true },
  reason: { value: a => a.reason_name || null, text: true },
  purchased: { value: a => a.purchase_date || null },
  retired_on: { value: a => a.retired_on || null },
  value_as_of: { value: a => a.value_as_of || null },
  qty: { value: a => a.qty },
  unit: { value: a => num(a.unit_value) },
  total: { value: a => num(a.total_value) },
};
// The optional column a sort key needs on this tab (fixed columns need none).
const FIXED_SORTS = ['asset', 'qty', 'total'];
const sortNeeds = (column, tab) => (column === 'unit' ? (tab === 'active' ? 'unit' : 'unit_out') : column);

const paisa = (value) => Math.round(Number(value) * 100);
const fix2 = (n) => round2(n).toFixed(2);
const pkr = (value) => `PKR ${fmtAmount(value)}`;
const searchText = (a) => [a.code, a.name, a.serial_no, a.description, a.type_name, a.owner_name, a.reason_name, a.retirement_note]
  .filter(Boolean).join('\n').toLowerCase();
/** The later of two 'YYYY-MM-DD' dates (either may be empty). */
const laterDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
/** Active and last valued more than a year ago: worth a fresh look. */
const isStale = (a) => {
  if (a.status !== 'active' || !a.value_as_of) return false;
  const today = todayPKT();
  return a.value_as_of < `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
};
const STALE_TEXT = 'Valued more than a year ago. Update the value so the register shows what it is worth today.';

// ── Add / edit form ────────────────────────────────────────────────────────
const FIELD_ORDER = ['name', 'serial_no', 'asset_type_id', 'owner_id', 'qty', 'unit_value', 'total_value',
  'purchase_date', 'description', 'reason_id', 'retired_on', 'retirement_note'];
const emptyForm = {
  name: '', serial_no: '', asset_type_id: '', owner_id: '', qty: '1', unit_value: '', total_value: '',
  purchase_date: '', description: '', reason_id: '', retired_on: '', retirement_note: '',
};
const toForm = (a) => ({
  name: a.name || '',
  serial_no: a.serial_no || '',
  asset_type_id: a.asset_type_id ?? '',
  owner_id: a.owner_id ?? '',
  qty: String(a.qty),
  unit_value: fix2(num(a.unit_value)),
  total_value: fix2(num(a.total_value)),
  purchase_date: a.purchase_date || '',
  description: a.description || '',
  reason_id: a.reason_id ?? '',
  retired_on: a.retired_on || '',
  retirement_note: a.retirement_note || '',
});

const validQty = (v) => { const n = parseNum(v); return Number.isInteger(n) && n >= 1 && n <= MAX_QTY ? n : null; };
function valueError(value) {
  if (String(value).trim() === '') return 'Enter the value.';
  const n = parseNum(value);
  if (!(n >= 0)) return 'Enter a value of 0 or more.';
  if (n > MAX_VALUE) return 'Enter a value of PKR 999,999,999.99 or less.';
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return 'Enter the value with no more than 2 decimals.';
  return null;
}

/** The value field the user typed in last drives the other one. */
function recompute(form, driver) {
  const qty = validQty(form.qty);
  if (driver === 'unit') {
    const unit = parseNum(form.unit_value);
    return { ...form, total_value: qty && unit >= 0 ? fix2(qty * unit) : '' };
  }
  if (driver === 'total') {
    const total = parseNum(form.total_value);
    return { ...form, unit_value: qty && total >= 0 ? fix2(total / qty) : '' };
  }
  return form;
}

function validate(form, { retired }) {
  const e = {};
  const name = cleanText(form.name);
  if (!name) e.name = 'Enter the asset name.';
  else if (name.length > 120) e.name = 'The asset name must have 120 characters or fewer.';
  if (!form.asset_type_id) e.asset_type_id = 'Choose a type.';
  if (!form.owner_id) e.owner_id = 'Choose who owns it.';
  const qty = parseNum(form.qty);
  if (!(Number.isInteger(qty) && qty >= 1)) e.qty = 'Enter a whole number of 1 or more.';
  else if (qty > MAX_QTY) e.qty = 'Enter a quantity of 99,999 or less.';
  const unitError = valueError(form.unit_value);
  const totalError = valueError(form.total_value);
  if (unitError) e.unit_value = unitError;
  if (totalError) e.total_value = totalError;
  if (!e.qty && !unitError && !totalError
    && Math.abs(qty * paisa(form.unit_value) - paisa(form.total_value)) > 0.5 * qty + 1e-9) {
    e.unit_value = 'The unit value does not match the total for this quantity. Check the figures.';
  }
  const today = todayPKT();
  if (form.purchase_date && form.purchase_date > today) e.purchase_date = "The purchase date can't be in the future.";
  if (cleanText(form.description).length > 500) e.description = 'The description must have 500 characters or fewer.';
  if (retired) {
    if (!form.reason_id) e.reason_id = 'Choose why it is being retired.';
    if (!form.retired_on) e.retired_on = 'Enter the retirement date.';
    else if (form.retired_on > today) e.retired_on = "The retirement date can't be in the future.";
    else if (form.purchase_date && form.retired_on < form.purchase_date) e.retired_on = "The retirement date can't be before the purchase date.";
  }
  return e;
}

const valueChanged = (form, record) => paisa(form.total_value) !== paisa(record.total_value)
  || parseNum(form.qty) !== Number(record.qty);

function changed(form, record) {
  const base = toForm(record);
  const text = (k) => cleanText(form[k]) !== cleanText(base[k]);
  const money = (k) => paisa(form[k]) !== paisa(base[k]);
  return text('name') || text('serial_no') || text('description') || text('retirement_note')
    || String(form.asset_type_id) !== String(base.asset_type_id) || String(form.owner_id) !== String(base.owner_id)
    || String(form.reason_id) !== String(base.reason_id)
    || parseNum(form.qty) !== parseNum(base.qty) || money('unit_value') || money('total_value')
    || form.purchase_date !== base.purchase_date || form.retired_on !== base.retired_on;
}

/** "at 6:51 PM" today, else "on 12/10/2026 at 6:51 PM" (formula page wording). */
function whenText(stamp) {
  if (!stamp) return '';
  return stamp.slice(0, 10) === todayPKT() ? ` at ${fmtClock(stamp)}` : ` on ${fmtStamp(stamp)}`;
}

/** Reason picker with "+ New" beside its label (edit form and Retire asset). */
function ReasonField({ id, value, reasons, onReasons, onChange, onBlur, error, className = 'hr-col-12' }) {
  return (
    <MfgField label="Reason" htmlFor={id} required className={className} error={error}
      labelAction={(
        <InlineNew list={LISTS.reasons} items={reasons} pickerId={id}
          onCreated={r => { onReasons(rs => sortByName([...rs, r])); onChange(r.id); }} />
      )}>
      <Picker id={id} ariaLabel="Reason" value={value} options={reasons.map(r => ({ value: r.id, label: r.name }))}
        placeholder="Select reason" searchPlaceholder="Search reasons" invalid={!!error}
        onChange={onChange} onBlur={onBlur} />
    </MfgField>
  );
}

function AssetDialog({ record, assets, types, owners, reasons, onTypes, onOwners, onReasons, onClose, onSaved, onGone }) {
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
  const retired = base?.status === 'retired';

  const setField = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setServerErrors(p => (p[key] ? { ...p, [key]: undefined } : p));
  };
  const touch = (key) => setTouched(p => ({ ...p, [key]: true }));
  const setValue = (key, value) => {
    const next = key === 'unit_value' ? 'unit' : 'total';
    setDriver(next);
    setForm(f => recompute({ ...f, [key]: value }, next));
    setServerErrors(p => ({ ...p, unit_value: undefined, total_value: undefined }));
  };
  const setQty = (value) => {
    setForm(f => recompute({ ...f, qty: value }, driver));
    setServerErrors(p => ({ ...p, qty: undefined, unit_value: undefined, total_value: undefined }));
  };

  const errors = validate(form, { retired });
  const firstError = FIELD_ORDER.map(k => errors[k]).find(Boolean);
  const isChanged = editing ? changed(form, base) : true;
  const blockedReason = conflict ? 'Reload to continue.' : editing && !isChanged ? 'No changes yet' : firstError || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);

  // Under Current value: how the two figures relate (two or more items), or
  // what saving a new figure means for "value as of".
  const qty = validQty(form.qty);
  const unitOk = !valueError(form.unit_value);
  const totalOk = !valueError(form.total_value);
  let totalHelp;
  if (qty && qty > 1 && unitOk && totalOk) {
    totalHelp = driver === 'total' && qty * paisa(form.unit_value) !== paisa(form.total_value)
      ? `Unit value rounded to ${fmtAmount(form.unit_value)}. The total stays ${fmtAmount(form.total_value)}.`
      : `${qty.toLocaleString('en-US')} × ${fmtAmount(form.unit_value)}`;
  } else if (editing && !retired && qty && totalOk && valueChanged(form, base)) {
    totalHelp = `Saved as the value as of today, ${fmtDay(todayPKT())}.`;
  } else if (!editing) {
    totalHelp = 'What it is worth today.';
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
      unit_value: form.unit_value,
      total_value: form.total_value,
      purchase_date: form.purchase_date || null,
      description: cleanText(form.description) || null,
      ...(retired ? {
        reason_id: form.reason_id,
        retired_on: form.retired_on,
        retirement_note: cleanText(form.retirement_note) || null,
      } : {}),
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
      const r = await api.get(`/assets/${base.id}`);
      setBase(r.data); setForm(toForm(r.data)); setDriver('total');
      setTouched({}); setServerErrors({}); setConflict(null); setSaveError(null);
    } catch (err) {
      if (err?.response?.status === 404) {
        toast.error(`${base.code} no longer exists. It was deleted by someone else.`);
        onGone();
        return;
      }
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
      title={editing ? `Edit ${base.code}` : 'Add asset'}
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
          <FormField label="Unit value (PKR)" htmlFor="as-unit" required col={5} error={errorFor('unit_value')}>
            <NumberField id="as-unit" value={form.unit_value} invalid={!!errorFor('unit_value')}
              onChange={v => setValue('unit_value', v)} onBlur={() => touch('unit_value')} />
          </FormField>
          <FormField label="Current value (PKR)" htmlFor="as-total" required col={5} error={errorFor('total_value')} help={totalHelp}>
            <NumberField id="as-total" value={form.total_value} invalid={!!errorFor('total_value')}
              onChange={v => setValue('total_value', v)} onBlur={() => touch('total_value')} />
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

          {retired && (
            <>
              <div className="hr-col-12 ast-form-section"><h3 className="hr-subhead">Retirement</h3></div>
              <ReasonField id="as-reason" className="hr-col-6" value={form.reason_id} reasons={reasons} onReasons={onReasons}
                error={errorFor('reason_id')}
                onChange={v => { setField('reason_id', v); touch('reason_id'); }} onBlur={() => touch('reason_id')} />
              <FormField label="Retired on" htmlFor="as-retired" required col={6} error={errorFor('retired_on')}>
                <DateInput id="as-retired" value={form.retired_on} min={form.purchase_date || undefined} max={todayPKT()}
                  invalid={!!errorFor('retired_on')}
                  className={`form-control${errorFor('retired_on') ? ' hr-invalid' : ''}`}
                  onChange={e => { setField('retired_on', e.target.value); touch('retired_on'); }}
                  onBlur={() => touch('retired_on')} />
              </FormField>
              <FormField label="Note" htmlFor="as-note" col={12} error={errorFor('retirement_note')}>
                <input id="as-note" className={`form-control${errorFor('retirement_note') ? ' hr-invalid' : ''}`}
                  placeholder="Optional, such as who it was sold to" value={form.retirement_note} maxLength={200}
                  onChange={e => setField('retirement_note', e.target.value)} onBlur={() => touch('retirement_note')} />
              </FormField>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Retire asset ───────────────────────────────────────────────────────────
function RetireDialog({ asset, reasons, onReasons, onClose, onDone }) {
  const [qty, setQty] = useState(String(asset.qty));
  const [reasonId, setReasonId] = useState('');
  const [date, setDate] = useState(todayPKT());
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const many = asset.qty > 1;
  const today = todayPKT();
  const touch = (key) => setTouched(t => ({ ...t, [key]: true }));

  const errors = {};
  const n = parseNum(qty);
  if (many) {
    if (!(Number.isInteger(n) && n >= 1)) errors.qty = 'Enter a whole number of 1 or more.';
    else if (n > asset.qty) errors.qty = `Enter a quantity of ${asset.qty.toLocaleString('en-US')} or less.`;
  }
  if (!reasonId) errors.reason_id = 'Choose why it is being retired.';
  if (!date) errors.retired_on = 'Enter the retirement date.';
  else if (date > today) errors.retired_on = "The retirement date can't be in the future.";
  else if (asset.purchase_date && date < asset.purchase_date) errors.retired_on = "The retirement date can't be before the purchase date.";
  const firstError = errors.qty || errors.reason_id || errors.retired_on || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);
  const count = many ? n : 1;
  const partial = many && !errors.qty && count < asset.qty;
  const rest = asset.qty - count;
  const reasonName = reasons.find(r => String(r.id) === String(reasonId))?.name;

  const confirm = async () => {
    setTouched({ qty: true, reason_id: true, retired_on: true });
    if (firstError) return;
    setBusy(true); setServerErrors({}); setSaveError(null);
    try {
      const r = await api.post(`/assets/${asset.id}/retire`, {
        qty: count, reason_id: reasonId, retired_on: date, note: cleanText(note) || null,
      });
      const why = reasonName ? ` (${reasonName})` : '';
      toast.success(partial
        ? `${count.toLocaleString('en-US')} of ${asset.qty.toLocaleString('en-US')} retired as ${r.data.retired.code}${why}.`
        : `${asset.code} retired${why}.`);
      onDone(r.data);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && ['qty', 'reason_id', 'retired_on', 'note'].includes(body.field)) setServerErrors({ [body.field]: body.message });
      else setSaveError(mfgError(err, 'The asset could not be retired. Try again.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title="Retire asset"
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} busyLabel="Retiring…" onClick={confirm}>Retire asset</BusyButton>
        </>
      )}
    >
      <p className="ast-dialog-sub">{`${asset.code} · ${asset.name}`}</p>
      {saveError && <Notice tone="danger" style={{ marginBottom: 14 }}>{saveError}</Notice>}
      <div className="hr-form-grid is-modal">
        <ReasonField id="ao-reason" value={reasonId} reasons={reasons} onReasons={onReasons} error={errorFor('reason_id')}
          onChange={v => { setReasonId(v); touch('reason_id'); setServerErrors({}); }} onBlur={() => touch('reason_id')} />
        {many && (
          <FormField label="Quantity" htmlFor="ao-qty" required col={5} error={errorFor('qty')}>
            <NumberField id="ao-qty" integer value={qty} suffix={`of ${asset.qty.toLocaleString('en-US')}`}
              invalid={!!errorFor('qty')}
              onChange={v => { setQty(v); setServerErrors({}); }} onBlur={() => touch('qty')} />
          </FormField>
        )}
        <FormField label="Retired on" htmlFor="ao-date" required col={many ? 7 : 12} error={errorFor('retired_on')}>
          <DateInput id="ao-date" value={date} min={asset.purchase_date || undefined} max={today}
            invalid={!!errorFor('retired_on')}
            className={`form-control${errorFor('retired_on') ? ' hr-invalid' : ''}`}
            onChange={e => { setDate(e.target.value); touch('retired_on'); setServerErrors({}); }}
            onBlur={() => touch('retired_on')} />
        </FormField>
        <FormField label="Note" htmlFor="ao-note" col={12} error={errorFor('note')}>
          <input id="ao-note" className={`form-control${errorFor('note') ? ' hr-invalid' : ''}`}
            placeholder="Optional, such as who it was sold to"
            value={note} maxLength={200} onChange={e => { setNote(e.target.value); setServerErrors({}); }} />
        </FormField>
      </div>
      {partial ? (
        <Notice tone="neutral">
          {`${count.toLocaleString('en-US')} of ${asset.qty.toLocaleString('en-US')} ${count === 1 ? 'is' : 'are'} retired as a new entry. `
            + `${rest.toLocaleString('en-US')} ${rest === 1 ? 'stays' : 'stay'} active as ${asset.code}.`}
        </Notice>
      ) : (
        <p className="mfg-confirm-text">It moves to Retired and no longer counts in the value of active assets. Nothing is posted to Finance.</p>
      )}
    </Modal>
  );
}

// ── Update value ───────────────────────────────────────────────────────────
// What the whole entry is worth on a date (today by default). The date can't
// be before the date the current value applies to or the purchase date. The
// same figure on a later date is allowed: the value was checked and holds.
function ValueDialog({ asset, onClose, onDone }) {
  const [total, setTotal] = useState(fix2(num(asset.total_value)));
  const [date, setDate] = useState(todayPKT());
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const today = todayPKT();
  const minDate = laterDate(asset.value_as_of, asset.purchase_date);
  const touch = (key) => setTouched(t => ({ ...t, [key]: true }));

  const errors = {};
  const totalErr = valueError(total);
  if (totalErr) errors.total_value = totalErr;
  if (!date) errors.valued_on = 'Enter the date of this value.';
  else if (date > today) errors.valued_on = "The date can't be in the future.";
  else if (asset.purchase_date && date < asset.purchase_date) errors.valued_on = "The date can't be before the purchase date.";
  else if (asset.value_as_of && date < asset.value_as_of) {
    errors.valued_on = `The value is already recorded as of ${fmtDay(asset.value_as_of)}. Choose that date or later.`;
  }
  if (!totalErr && !errors.valued_on && paisa(total) === paisa(asset.total_value) && date === asset.value_as_of) {
    errors.total_value = 'This is already the value on that date. Enter a new value or a later date.';
  }
  const firstError = errors.total_value || errors.valued_on || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);

  // Under the field: the change from the current value, and the unit value.
  let help;
  if (!totalErr) {
    const diffP = paisa(total) - paisa(asset.total_value);
    const base = num(asset.total_value);
    const pct = base > 0 ? ` (${diffP > 0 ? '+' : '−'}${Math.abs((diffP / 100 / base) * 100).toFixed(1)}%)` : '';
    const change = diffP === 0 ? 'Same as the current value'
      : `${diffP > 0 ? 'Up' : 'Down'} ${pkr(Math.abs(diffP) / 100)}${pct}`;
    const each = asset.qty > 1 ? ` · ${fmtAmount(Math.round(paisa(total) / asset.qty) / 100)} each` : '';
    help = `${change}${each}`;
  }

  const confirm = async () => {
    setTouched({ total_value: true, valued_on: true });
    if (firstError) return;
    setBusy(true); setServerErrors({}); setSaveError(null);
    try {
      const r = await api.post(`/assets/${asset.id}/value`, { total_value: total, valued_on: date, note: cleanText(note) || null });
      toast.success(`Value of ${asset.code} updated to ${pkr(r.data.total_value)}.`);
      onDone(r.data);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && ['total_value', 'valued_on', 'note'].includes(body.field)) setServerErrors({ [body.field]: body.message });
      else setSaveError(mfgError(err, 'The value could not be updated. Try again.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title="Update value"
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} busyLabel="Saving…" onClick={confirm}>Update value</BusyButton>
        </>
      )}
    >
      <p className="ast-dialog-sub">
        {`${asset.code} · ${asset.name}. Now ${pkr(asset.total_value)}${asset.value_as_of ? ` as of ${fmtDay(asset.value_as_of)}` : ''}.`}
      </p>
      {saveError && <Notice tone="danger" style={{ marginBottom: 14 }}>{saveError}</Notice>}
      <div className="hr-form-grid is-modal">
        <FormField label={asset.qty > 1 ? `Value of all ${asset.qty.toLocaleString('en-US')} (PKR)` : 'Value (PKR)'}
          htmlFor="av-total" required col={7} error={errorFor('total_value')} help={help}>
          <NumberField id="av-total" value={total} invalid={!!errorFor('total_value')} autoFocus
            onChange={v => { setTotal(v); setServerErrors({}); }} onBlur={() => touch('total_value')} />
        </FormField>
        <FormField label="As of" htmlFor="av-date" required col={5} error={errorFor('valued_on')}>
          <DateInput id="av-date" value={date} min={minDate || undefined} max={today}
            invalid={!!errorFor('valued_on')}
            className={`form-control${errorFor('valued_on') ? ' hr-invalid' : ''}`}
            onChange={e => { setDate(e.target.value); touch('valued_on'); setServerErrors({}); }}
            onBlur={() => touch('valued_on')} />
        </FormField>
        <FormField label="Note" htmlFor="av-note" col={12} error={errorFor('note')}>
          <input id="av-note" className={`form-control${errorFor('note') ? ' hr-invalid' : ''}`}
            placeholder="Optional, such as how it was valued"
            value={note} maxLength={200} onChange={e => { setNote(e.target.value); setServerErrors({}); }} />
        </FormField>
      </div>
    </Modal>
  );
}

// ── Detail view ────────────────────────────────────────────────────────────
// Opened from a row (or a link with ?asset=AST-0001). The figures come from
// the list row; the value history and the entries split off it are loaded
// here and reloaded whenever the asset changes.
const HISTORY_KIND = { added: 'Added', edited: 'Edited', revalued: 'Value updated', split: 'Split' };

function StatusPill({ asset }) {
  return asset.status === 'active'
    ? <span className="ast-status is-active">Active</span>
    : <span className="ast-status is-retired">{`Retired${asset.reason_name ? ` · ${asset.reason_name}` : ''}`}</span>;
}

function AssetView({ asset, onClose, onAction, onOpenCode }) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    retryOnce(() => api.get(`/assets/${asset.id}`), () => live)
      .then(r => { if (live) setDetail(r.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [asset.id, asset.updated_at, attempt]);
  const current = detail?.id === asset.id ? detail : null;
  const isActive = asset.status === 'active';
  const stale = isStale(asset);

  const history = current ? (
    current.history.length === 0
      ? <div className="hr-lines-empty">No value changes recorded.</div>
      : (
        <ol className="ast-history">
          {current.history.map(h => {
            const showDelta = (h.kind === 'edited' || h.kind === 'revalued') && h.previous_total !== null;
            const diffP = showDelta ? paisa(h.total_value) - paisa(h.previous_total) : 0;
            return (
              <li key={h.id} className="ast-history-row">
                <div className="ast-history-date">{fmtDay(h.valued_on)}</div>
                <div className="ast-history-what">
                  <div>{HISTORY_KIND[h.kind] || h.kind}{h.note && <span className="ast-history-note">{` · ${h.note}`}</span>}</div>
                  <div className="ast-asset-sub">
                    {[h.by_name && `by ${h.by_name}`, h.qty > 1 && plural(h.qty, 'item', 'items')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="ast-history-fig">
                  <div>{pkr(h.total_value)}</div>
                  {showDelta && diffP !== 0 && (
                    <div className={`ast-delta ${diffP > 0 ? 'is-up' : 'is-down'}`}>
                      {`${diffP > 0 ? '+' : '−'}${fmtAmount(Math.abs(diffP) / 100)}`}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )
  ) : failed ? (
    <div className="ast-view-failed">
      The value history could not be loaded.
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAttempt(n => n + 1)}>Retry</button>
    </div>
  ) : <TableSkeleton columns={3} rows={2} />;

  const parts = current?.parts || [];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={asset.name}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn btn-ghost ast-danger-text" style={{ marginRight: 'auto' }}
            onClick={() => onAction('delete', asset)}>
            <span className="material-symbols-outlined" aria-hidden="true">delete</span>Delete
          </button>
          {isActive ? (
            <>
              <button type="button" className="btn btn-outline" onClick={() => onAction('retire', asset)}>Retire</button>
              <button type="button" className="btn btn-outline" onClick={() => onAction('value', asset)}>Update value</button>
            </>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => onAction('reinstate', asset)}>Reinstate</button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onAction('edit', asset)}>
            <span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit
          </button>
        </>
      )}
    >
      <div className="ast-view">
        <div className="ast-view-top">
          <div style={{ minWidth: 0 }}>
            <div className="ast-view-code">{asset.code}{asset.serial_no && ` · SN ${asset.serial_no}`}</div>
            <StatusPill asset={asset} />
          </div>
          <div className="ast-view-value">
            <div className="ast-view-value-label">{isActive ? 'Current value' : 'Value at retirement'}</div>
            <div className="ast-view-value-fig">{pkr(asset.total_value)}</div>
            <div className="ast-view-value-sub">
              {[asset.value_as_of && `as of ${fmtDay(asset.value_as_of)}`,
                asset.qty > 1 && `${Number(asset.qty).toLocaleString('en-US')} × ${fmtAmount(asset.unit_value)}`]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        {stale && (
          <Notice tone="warning" style={{ marginTop: 16 }}>
            <span className="mfg-notice-line">
              <span>{STALE_TEXT}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction('value', asset)}>Update value</button>
            </span>
          </Notice>
        )}

        <section className="ast-view-section">
          <h3 className="ast-view-head">Details</h3>
          <FieldGrid cols={3}>
            <Field label="Type" value={asset.type_name} />
            <Field label="Owned by" value={asset.owner_name} />
            <Field label="Quantity" value={Number(asset.qty).toLocaleString('en-US')} />
            <Field label="Unit value" value={pkr(asset.unit_value)} />
            <Field label="Purchased on" value={asset.purchase_date ? fmtDay(asset.purchase_date) : null} />
            <Field label="Serial / tag no." value={asset.serial_no} mono />
            {asset.description && <Field label="Description" value={asset.description} wide />}
          </FieldGrid>
        </section>

        {!isActive && (
          <section className="ast-view-section">
            <h3 className="ast-view-head">Retirement</h3>
            <FieldGrid cols={3}>
              <Field label="Reason" value={asset.reason_name} />
              <Field label="Retired on" value={asset.retired_on ? fmtDay(asset.retired_on) : null} />
              <Field label="Note" value={asset.retirement_note} empty="No note" />
            </FieldGrid>
          </section>
        )}

        {(asset.split_from_id || parts.length > 0) && (
          <section className="ast-view-section">
            <h3 className="ast-view-head">Related entries</h3>
            <div className="ast-links">
              {asset.split_from_id && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpenCode(asset.split_from_code)}
                  disabled={!asset.split_from_code}>
                  <span className="material-symbols-outlined" aria-hidden="true">call_split</span>
                  {`Split from ${asset.split_from_code || 'a deleted entry'}`}
                </button>
              )}
              {parts.map(p => (
                <button key={p.id} type="button" className="btn btn-outline btn-sm" onClick={() => onOpenCode(p.code)}>
                  {`${p.code} · ${plural(p.qty, 'item', 'items')} · ${p.status === 'active' ? 'Active' : `Retired${p.reason_name ? ` (${p.reason_name})` : ''}`}`}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="ast-view-section">
          <h3 className="ast-view-head">Value history</h3>
          {history}
        </section>
      </div>
    </Modal>
  );
}

// ── One managed list in its own pop-up ─────────────────────────────────────
function ListDialog({ which, rows, onClose, onChanged }) {
  const meta = LIST_DIALOGS[which];
  return (
    <Modal isOpen onClose={onClose} title={meta.title} size="sm">
      {meta.hint && <p className="ast-dialog-sub">{meta.hint}</p>}
      <ListEditor key={which} list={LISTS[which]} rows={rows} onChanged={onChanged} />
    </Modal>
  );
}

// ── CSV export (the rows on screen, in their order) ────────────────────────
// A text cell starting with = + - @ is prefixed with ' so a spreadsheet does
// not run it as a formula.
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function downloadCsv(rows, tab) {
  const head = ['Code', 'Asset', 'Serial / tag no.', 'Type', 'Owned by', 'Qty', 'Unit value', 'Value', 'Value as of',
    'Purchased on', 'Status', 'Reason', 'Retired on', 'Retirement note', 'Description'];
  const lines = rows.map(a => [
    a.code, a.name, a.serial_no, a.type_name, a.owner_name, Number(a.qty), fix2(num(a.unit_value)), fix2(num(a.total_value)),
    a.value_as_of, a.purchase_date, a.status === 'active' ? 'Active' : 'Retired', a.reason_name, a.retired_on,
    a.retirement_note, a.description,
  ]);
  const csv = [head, ...lines].map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `assets-${TAB_PARAM[tab]}-${todayPKT()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Assets() {
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get('tab'));
  const viewCode = params.get('asset');
  // Changes some query keys and keeps the rest (null removes a key).
  const setQuery = (patch) => setParams(prev => {
    const next = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
    return next;
  }, { replace: true });
  const setTab = (next) => setQuery({ tab: TAB_PARAM[next] });
  const openView = (code) => setQuery({ asset: code });
  const closeView = () => setQuery({ asset: null });

  const [assets, setAssets] = useState([]);
  const [types, setTypes] = useState([]);
  const [owners, setOwners] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [denied, setDenied] = useState(null);           // the server's message without perm_assets
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const activeSort = useSort('asset');
  const retiredSort = useSort('asset');
  const cols = useColumnPrefs('assets-columns-v2', COLUMN_DEFAULTS);

  // One dialog at a time: { kind: add|edit|value|retire|reinstate|delete, asset,
  // fromView }. One opened from the detail view returns to it when done.
  const [action, setAction] = useState(null);
  const [reinstating, setReinstating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listOpen, setListOpen] = useState(null);       // types | owners | reasons
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
    return retryOnce(() => Promise.all([
      api.get('/assets'), api.get('/assets/types'), api.get('/assets/owners'), api.get('/assets/reasons'),
    ]), () => live.current)
      .then(([a, t, o, r]) => {
        if (!live.current) return;
        setAssets(a.data); setTypes(t.data); setOwners(o.data); setReasons(r.data); setLoadFailed(false);
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

  // A filter on a type, owner or reason that no longer exists falls away.
  useEffect(() => {
    if (typeFilter && !types.some(t => String(t.id) === String(typeFilter))) setTypeFilter('');
    if (ownerFilter && !owners.some(o => String(o.id) === String(ownerFilter))) setOwnerFilter('');
    if (reasonFilter && !reasons.some(r => String(r.id) === String(reasonFilter))) setReasonFilter('');
  }, [types, owners, reasons, typeFilter, ownerFilter, reasonFilter]);

  // A link to an asset that is not (or no longer) on record.
  const viewing = viewCode ? assets.find(a => a.code === viewCode) : null;
  useEffect(() => {
    if (loading || loadFailed || !viewCode || viewing) return;
    toast.error(`${viewCode} was not found. It may have been deleted.`);
    closeView();
  }, [loading, loadFailed, viewCode, viewing]);

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
  const reasonOn = tab === 'retired' && !!reasonFilter;
  const filtering = !!(q || typeFilter || ownerFilter || reasonOn);
  const matches = (a) => (!q || searchText(a).includes(q))
    && (!typeFilter || String(a.asset_type_id) === String(typeFilter))
    && (!ownerFilter || String(a.owner_id) === String(ownerFilter))
    && (!reasonOn || String(a.reason_id) === String(reasonFilter));
  const clearFilters = () => { setSearch(''); setTypeFilter(''); setOwnerFilter(''); setReasonFilter(''); };

  const tabRows = useMemo(() => assets.filter(a => a.status === tab), [assets, tab]);
  const counts = useMemo(() => ({
    active: assets.filter(a => a.status === 'active').length,
    retired: assets.filter(a => a.status === 'retired').length,
  }), [assets]);

  const columns = COLUMNS[tab];
  const tabKeys = columns.map(c => c.key);
  const show = (key) => tabKeys.includes(key) && cols.isShown(key);
  // The column menu speaks for this tab's columns only.
  const tabPrefs = {
    isShown: cols.isShown,
    toggle: cols.toggle,
    isDefault: columns.every(c => cols.isShown(c.key) === (COLUMN_DEFAULTS[c.key] !== false)),
    reset: () => columns.forEach(c => { if (cols.isShown(c.key) !== (COLUMN_DEFAULTS[c.key] !== false)) cols.toggle(c.key); }),
  };
  const sort = tab === 'retired' ? retiredSort : activeSort;
  const sortColumn = sort.sortConfig.column;
  const sortConfig = FIXED_SORTS.includes(sortColumn) || show(sortNeeds(sortColumn, tab))
    ? sort.sortConfig : { column: 'asset', direction: 'asc' };
  const sortView = { ...sort, sortConfig };
  const shown = useMemo(
    () => sortRows(tabRows.filter(matches), sortConfig, SORTS, defaultOrder),
    [tabRows, q, typeFilter, ownerFilter, reasonOn, reasonFilter, sortConfig.column, sortConfig.direction]
  );
  const shownTotal = shown.reduce((s, a) => s + paisa(a.total_value), 0) / 100;

  // ── Changes ──
  const upsert = (rows) => setAssets(list => {
    const next = list.filter(a => !rows.some(r => r.id === a.id));
    return [...next, ...rows];
  });
  // After an add or edit the row must be visible: on its tab, and not hidden
  // by the search or a filter.
  const reveal = (row) => {
    if (row.status !== tab) setTab(row.status);
    if (!matches(row)) clearFilters();
    setFlashId(row.id);
  };
  const startAction = (kind, asset, fromView = false) => {
    if (fromView) closeView();
    setAction({ kind, asset, fromView });
  };
  // Closes the dialog; one opened from the detail view goes back to it
  // (`code`: the asset to show, when it is not the one the dialog was for).
  const endAction = (code) => {
    const done = action;
    setAction(null);
    if (done?.fromView && code !== null) openView(code || done.asset.code);
  };

  const onSaved = (row) => {
    upsert([row]);
    if (action?.fromView) endAction(row.code);
    else { setAction(null); reveal(row); }
    load(true);
  };
  const onGone = () => { endAction(null); load(true); };

  const confirmReinstate = async () => {
    const target = action.asset;
    setReinstating(true);
    try {
      const r = await api.post(`/assets/${target.id}/reinstate`);
      toast.success(`${r.data.code} reinstated.`);
      upsert([r.data]);
      endAction();
      load(true);
    } catch (err) {
      endAction();
      toast.error(mfgError(err, 'The asset could not be reinstated. Try again.'));
      load(true);
    } finally { setReinstating(false); }
  };

  const confirmDelete = async () => {
    const target = action.asset;
    setDeleting(true);
    try {
      await api.delete(`/assets/${target.id}`);
      toast.success(`${target.code} deleted.`);
      endAction(null);
      setAssets(list => list.filter(a => a.id !== target.id));
      load(true);
    } catch (err) {
      endAction();
      toast.error(mfgError(err, 'The asset could not be deleted. Try again.'));
      load(true);
    } finally { setDeleting(false); }
  };

  const exportCsv = () => {
    downloadCsv(shown, tab);
    toast.success(`${plural(shown.length, 'asset', 'assets')} exported.`);
  };

  const rowActions = (a) => [
    { label: 'View details', icon: 'visibility', onClick: () => openView(a.code) },
    { label: 'Edit', icon: 'edit', onClick: () => startAction('edit', a) },
    ...(a.status === 'active' ? [
      { label: 'Update value', icon: 'price_change', onClick: () => startAction('value', a) },
      { label: 'Retire asset', icon: 'archive', onClick: () => startAction('retire', a) },
    ] : [
      { label: 'Reinstate', icon: 'unarchive', onClick: () => startAction('reinstate', a) },
    ]),
    { divider: true },
    { label: 'Delete', icon: 'delete', danger: true, onClick: () => startAction('delete', a) },
  ];
  const headMenu = [
    { label: 'Asset types', icon: LIST_DIALOGS.types.icon, onClick: () => setListOpen('types') },
    { label: 'Owners', icon: LIST_DIALOGS.owners.icon, onClick: () => setListOpen('owners') },
    { label: 'Reasons', icon: LIST_DIALOGS.reasons.icon, onClick: () => setListOpen('reasons') },
    { divider: true },
    {
      label: 'Export to CSV', icon: 'download', onClick: exportCsv,
      disabled: shown.length === 0, title: shown.length === 0 ? 'No assets to export in this view' : undefined,
    },
  ];

  // ── Render ──
  const typeOptions = [{ value: '', label: 'All types' }, ...types.map(t => ({ value: t.id, label: t.name }))];
  const ownerOptions = [{ value: '', label: 'All owners' }, ...owners.map(o => ({ value: o.id, label: o.name }))];
  const reasonOptions = [{ value: '', label: 'All reasons' }, ...reasons.map(r => ({ value: r.id, label: r.name }))];

  // Under the heading: what the list below shows, like Sales Invoices.
  const summary = loading || loadFailed || assets.length === 0 ? ' ' : (
    <>
      {filtering
        ? `${shown.length.toLocaleString('en-US')} of ${plural(tabRows.length, 'asset', 'assets')}`
        : plural(shown.length, 'asset', 'assets')}
      {' · '}<strong>{pkr(shownTotal)}</strong>
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
      <EmptyState icon="business_center" title="No assets yet"
        desc="Record the organization assets, with owner and value declarations."
        action={(
          <button type="button" className="btn btn-primary" onClick={() => startAction('add', null)}>
            <span className="material-symbols-outlined" aria-hidden="true">add</span>Add asset
          </button>
        )} />
    );
  } else if (tabRows.length === 0) {
    body = tab === 'retired' ? (
      <EmptyState small icon="archive" title="No retired assets"
        desc="Assets you retire (sold, scrapped, lost or for any other reason) move here, with the reason and retirement date." />
    ) : (
      <EmptyState small icon="business_center" title="No active assets"
        desc="Every asset on record is retired. Add an asset, or reinstate one from Retired." />
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
              <SortHead sort={sortView} column="asset" label="Asset" />
              {show('type') && <SortHead sort={sortView} column="type" label="Type" style={{ width: '12%' }} />}
              {show('owner') && <SortHead sort={sortView} column="owner" label="Owned by" style={{ width: '14%' }} />}
              {show('purchased') && <SortHead sort={sortView} column="purchased" label="Purchased" date style={{ width: '10.5%' }} />}
              {show('reason') && <SortHead sort={sortView} column="reason" label="Reason" style={{ width: '12%' }} />}
              {show('retired_on') && <SortHead sort={sortView} column="retired_on" label="Retired on" date style={{ width: '12%' }} />}
              <SortHead sort={sortView} column="qty" label="Qty" num style={{ width: '6%' }} />
              {(show('unit') || show('unit_out')) && <SortHead sort={sortView} column="unit" label="Unit value" num style={{ width: '11%' }} />}
              <SortHead sort={sortView} column="total" label="Value" num style={{ width: '12%' }} />
              {show('value_as_of') && <SortHead sort={sortView} column="value_as_of" label="Value as of" date style={{ width: '11%' }} />}
              <th style={{ width: 56, textAlign: 'right' }}>
                <ColumnMenu columns={columns} prefs={tabPrefs} fixed={FIXED_COLUMNS} />
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(a => {
              const stale = isStale(a);
              return (
                <tr
                  key={a.id}
                  ref={el => { rowRefs.current[a.id] = el; }}
                  className={`hr-row-click${flashId === a.id ? ' mfg-flash' : ''}`}
                  tabIndex={0}
                  aria-label={`${a.name} (${a.code}), open details`}
                  onClick={() => openView(a.code)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) openView(a.code); }}
                >
                  <td className="ast-asset">
                    <div className="ast-asset-name" title={a.name}>{a.name}</div>
                    <div className="ast-asset-sub">{a.code}{a.serial_no && ` · SN ${a.serial_no}`}</div>
                  </td>
                  {show('type') && <td className="mfg-ellipsis" title={a.type_name}>{a.type_name}</td>}
                  {show('owner') && <td className="mfg-ellipsis" title={a.owner_name}>{a.owner_name}</td>}
                  {show('purchased') && <td className="ast-date">{a.purchase_date ? fmtDate(a.purchase_date) : EMPTY}</td>}
                  {show('reason') && (
                    <td className="ast-cell-fit">
                      {a.reason_name ? <span className="ast-reason" title={a.reason_name}>{a.reason_name}</span> : EMPTY}
                    </td>
                  )}
                  {show('retired_on') && (
                    <td className="ast-date ast-two-line">
                      <div>{fmtDate(a.retired_on)}</div>
                      {a.retirement_note && <div className="ast-asset-sub ast-one-line" title={a.retirement_note}>{a.retirement_note}</div>}
                    </td>
                  )}
                  <td className="hr-num">{Number(a.qty).toLocaleString('en-US')}</td>
                  {(show('unit') || show('unit_out')) && <td className="hr-num">{fmtAmount(a.unit_value)}</td>}
                  <td className="hr-num ast-total">{fmtAmount(a.total_value)}</td>
                  {show('value_as_of') && (
                    <td className="ast-date">
                      {a.value_as_of ? (
                        stale ? (
                          <span className="ast-stale" title={STALE_TEXT}>
                            {fmtDate(a.value_as_of)}
                            <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                            <span className="hr-sr-only">(valued more than a year ago)</span>
                          </span>
                        ) : fmtDate(a.value_as_of)
                      ) : EMPTY}
                    </td>
                  )}
                  <td style={{ textAlign: 'right' }}>
                    <KebabMenu label={`Actions for ${a.name} (${a.code})`} items={rowActions(a)} />
                  </td>
                </tr>
              );
            })}
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

  const kind = action?.kind;
  return (
    <Layout title="Assets">
      <HrStyles />
      <MfgStyles />
      <style dangerouslySetInnerHTML={{ __html: ASSET_STYLES }} />
      <div className="card">
        <div className="card-header ast-head">
          <div className="ast-head-title">
            <div className="card-title">Assets</div>
            <div className="text-sm text-muted mt-1 ast-summary" role="status">{summary}</div>
          </div>
          <div className="ast-head-actions">
            <div className="search-bar ast-search">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input placeholder="Search assets…" aria-label="Search assets" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <KebabMenu label="Types, owners, reasons and export" items={headMenu} />
            <button type="button" className="btn btn-primary" onClick={() => startAction('add', null)}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
              Add asset
            </button>
          </div>
        </div>
        {!loading && !loadFailed && assets.length > 0 && (
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
              {tab === 'retired' && (
                <div className="ast-filter">
                  <Picker id="af-reason" ariaLabel="Filter by reason" value={reasonFilter} options={reasonOptions}
                    placeholder="All reasons" searchPlaceholder="All reasons" onChange={setReasonFilter} />
                </div>
              )}
              {filtering && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
            <Segmented
              ariaLabel="Show assets"
              value={tab}
              onChange={setTab}
              options={[
                { val: 'active', label: 'Active', count: counts.active },
                { val: 'retired', label: 'Retired', count: counts.retired },
              ]}
            />
          </div>
        )}
        {body}
      </div>

      {viewing && !action && (
        <AssetView
          asset={viewing}
          onClose={closeView}
          onAction={(next, a) => startAction(next, a, true)}
          onOpenCode={openView}
        />
      )}

      {(kind === 'add' || kind === 'edit') && (
        <AssetDialog
          key={action.asset ? action.asset.id : 'new'}
          record={action.asset}
          assets={assets}
          types={types}
          owners={owners}
          reasons={reasons}
          onTypes={setTypes}
          onOwners={setOwners}
          onReasons={setReasons}
          onClose={() => endAction()}
          onSaved={onSaved}
          onGone={onGone}
        />
      )}

      {kind === 'retire' && (
        <RetireDialog
          asset={action.asset}
          reasons={reasons}
          onReasons={setReasons}
          onClose={() => endAction()}
          onDone={({ asset, retired }) => {
            upsert(asset.id === retired.id ? [asset] : [asset, retired]);
            if (action.fromView) endAction(asset.code);
            else { setAction(null); setFlashId(asset.id === retired.id ? null : asset.id); }
            load(true);
          }}
        />
      )}

      {kind === 'value' && (
        <ValueDialog
          asset={action.asset}
          onClose={() => endAction()}
          onDone={(row) => {
            upsert([row]);
            if (action.fromView) endAction(row.code);
            else { setAction(null); setFlashId(row.id); }
            load(true);
          }}
        />
      )}

      <Modal
        isOpen={kind === 'reinstate'}
        onClose={() => { if (!reinstating) endAction(); }}
        title={kind === 'reinstate' ? `Reinstate ${action.asset.code} ${action.asset.name}?` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => endAction()} disabled={reinstating}>Cancel</button>
            <BusyButton busy={reinstating} busyLabel="Reinstating…" onClick={confirmReinstate}>Reinstate</BusyButton>
          </>
        )}
      >
        {kind === 'reinstate' && (
          <p className="mfg-confirm-text">
            {'It moves back to Active and its reason, retirement date and note are cleared.'}
          </p>
        )}
      </Modal>

      <ConfirmModal
        isOpen={kind === 'delete'}
        onClose={() => { if (!deleting) endAction(); }}
        onConfirm={confirmDelete}
        loading={deleting}
        title={kind === 'delete' ? `Delete ${action.asset.code} ${action.asset.name}?` : ''}
        message={kind === 'delete' && action.asset.status === 'retired'
          ? 'This removes the entry and its value history permanently.'
          : 'This removes the entry and its value history permanently. If the organization no longer has it, retire it instead so it stays on record.'}
      />

      {listOpen && (
        <ListDialog
          which={listOpen}
          rows={{ types, owners, reasons }[listOpen]}
          onClose={() => setListOpen(null)}
          onChanged={(next) => {
            if (listOpen === 'types') setTypes(next);
            else if (listOpen === 'owners') setOwners(next);
            else setReasons(next);
            load(true);
          }}
        />
      )}
    </Layout>
  );
}

const ASSET_STYLES = `
  /* Head: the heading with what the list shows under it (as on Sales
     Invoices); search, the lists menu (⋮) and Add on the right. */
  .ast-head { flex-wrap: wrap; }
  .ast-head-title { min-width: 0; }
  .ast-summary { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ast-summary strong { font-weight: 600; color: var(--gray-800); }
  .ast-head-actions { display: flex; align-items: stretch; gap: 10px; margin-left: auto; }
  .ast-head-actions .ast-search { width: 240px; box-sizing: border-box; }
  .ast-head-actions .ast-search input { width: 100%; min-width: 0; }
  .ast-head-actions > .btn { flex-shrink: 0; }
  /* The ⋮ button matches the height of the buttons beside it. */
  .ast-head-actions .hr-kebab { display: flex; }
  .ast-head-actions .hr-kebab > .btn { padding: 0 9px; }
  .ast-head-actions .hr-kebab > .btn .material-symbols-outlined { font-size: 20px !important; }

  /* Filter bar: filters on the left, the Active / Retired switch on the right. */
  .ast-filterbar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap;
    min-height: 52px; padding: 8px 22px; box-sizing: border-box; border-bottom: 1px solid var(--gray-100);
  }
  .ast-filters { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .ast-filter { width: 190px; }
  .ast-filter .hr-select-trigger.is-block { padding-top: 5px; padding-bottom: 5px; }
  .ast-filter .mfg-search .form-control { padding-top: 5px; padding-bottom: 5px; }
  .ast-filterbar .hr-segment { margin-left: auto; }
  .ast-filterbar .hr-segment-btn { font-size: 13px; padding: 6px 14px; }

  /* Rows open the detail view. */
  .ast-table tbody tr.hr-row-click:hover { background: var(--gray-50); }
  .ast-table td.ast-asset, .ast-table td.ast-two-line, .ast-table td.ast-cell-fit { max-width: 0; }
  .ast-asset-name { font-weight: 500; color: var(--gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ast-asset-sub { margin-top: 2px; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; line-height: 1.4; }
  .ast-one-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ast-date { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ast-total { font-weight: 600; color: var(--gray-900); }
  .ast-skeleton { padding: 4px 8px 8px; }
  .ast-reason {
    display: inline-block; max-width: 100%; box-sizing: border-box; padding: 2px 9px; border-radius: 999px;
    background: var(--gray-100); color: var(--gray-700); font-size: 12px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
  }
  .ast-stale { display: inline-flex; align-items: center; gap: 4px; color: var(--amber); }
  .ast-stale .material-symbols-outlined { font-size: 15px; }

  /* Status pill (detail view). */
  .ast-status {
    display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600;
  }
  .ast-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .ast-status.is-active { background: #ecfdf5; color: #047857; }
  .ast-status.is-retired { background: var(--gray-100); color: var(--gray-700); }

  /* Detail view. */
  .ast-view-top {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
    padding-bottom: 18px; border-bottom: 1px solid var(--gray-100);
  }
  .ast-view-code { margin-bottom: 8px; font-size: 13px; color: var(--gray-500); font-variant-numeric: tabular-nums; }
  .ast-view-value { text-align: right; flex-shrink: 0; }
  .ast-view-value-label { font-size: 12px; font-weight: 500; color: var(--gray-500); }
  .ast-view-value-fig {
    font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: -0.3px;
    color: var(--gray-900); font-variant-numeric: tabular-nums;
  }
  .ast-view-value-sub { font-size: 12.5px; color: var(--gray-500); font-variant-numeric: tabular-nums; }
  .ast-view-section { margin-top: 20px; }
  .ast-view-head { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: var(--gray-800); }
  .ast-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .ast-links .material-symbols-outlined { font-size: 16px; }
  .ast-history { list-style: none; margin: 0; padding: 0; }
  .ast-history-row {
    display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 14px; align-items: start;
    padding: 10px 0; border-top: 1px solid var(--gray-100);
  }
  .ast-history-row:first-child { border-top: none; }
  .ast-history-date { font-size: 13px; color: var(--gray-600); font-variant-numeric: tabular-nums; }
  .ast-history-what { min-width: 0; font-size: 13px; font-weight: 500; color: var(--gray-800); }
  .ast-history-note { font-weight: 400; color: var(--gray-600); }
  .ast-history-fig {
    text-align: right; white-space: nowrap; font-size: 13px; font-weight: 600;
    color: var(--gray-900); font-variant-numeric: tabular-nums;
  }
  .ast-delta { font-size: 12px; font-weight: 500; }
  .ast-delta.is-up { color: var(--green); }
  .ast-delta.is-down { color: var(--red); }
  .ast-view-failed { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--gray-600); }
  .ast-danger-text { color: var(--red); }
  .ast-danger-text:hover { background: var(--red-pale); }
  .ast-danger-text .material-symbols-outlined, .modal-footer .btn-primary .material-symbols-outlined { font-size: 17px; }

  /* Dialogs. A long dialog keeps its buttons in view while it scrolls. */
  .modal:has(.ast-dialog) .modal-footer, .modal:has(.ast-view) .modal-footer {
    position: sticky; bottom: 0; z-index: 1; background: white;
  }
  .ast-dialog-sub { margin: 0 0 14px; font-size: 13px; color: var(--gray-500); }
  .ast-form-section { margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--gray-100); }
  .ast-form-section .hr-subhead { margin: 0 0 4px; }
  .ast-counter { display: block; text-align: right; font-variant-numeric: tabular-nums; }

  @media (max-width: 760px) {
    .ast-head-actions { flex-wrap: wrap; width: 100%; }
    .ast-head-actions .ast-search { flex: 1 1 100%; width: auto; }
    .ast-view-top { flex-direction: column; }
    .ast-view-value { text-align: left; }
    .ast-history-row { grid-template-columns: minmax(0, 1fr) auto; }
    .ast-history-date { grid-column: 1 / -1; }
  }
`;

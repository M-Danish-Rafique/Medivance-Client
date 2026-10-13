import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import DateInput from '../../components/common/DateInput';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import { HrStyles, Panel, FormField, Notice, BusyButton, fmtAmount, num } from '../hr/HrKit';
import {
  MfgStyles, MfgPageHead, MfgField, Picker, NumberField, RemoveLine, AddButton, BatchStatus, Tip, Rate, Qty, StockQty, fmtQty, parseNum, round2, plural,
} from './mfgKit';
import {
  buildBatchModel, draftPayload, createPayload, emptyForm, groupKeyOf, CostSummary, useUnsavedGuard, SECTIONS,
  newMaterialRow, newPkgRow, newPackRow, newByRow, byProductBatchNo, ByRateHead, byInfoContext,
} from './batchKit';

// ─── New batch / edit draft ────────────────────────────────────────────────
// A full page: five section cards on the left, a sticky Cost summary on the
// right that updates as the user types. The page head stays pinned under the
// top bar (title, status line, Cancel · Save draft · Create batch).
//   Save draft    only needs a product; never touches stock.
//   Create batch  always available. Until it is pressed the summary shows
//                 only the costs (the required fields carry their * marks);
//                 pressing it with anything open shows the red "N things to
//                 fix" list (and the same count beside the buttons, a link to
//                 it) and jumps to the first one. The server re-checks stock,
//                 deducts it, assigns the batch code, and the batch becomes
//                 "Ready for inventory".

const MAT_GRID = 'minmax(0, 2fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 40px';
const PACK_GRID = 'minmax(0, 1.3fr) minmax(0, 0.85fr) minmax(0, 0.75fr) minmax(0, 1.35fr) minmax(0, 1.15fr) 40px';
const DLG_GRID = 'minmax(0, 2.2fr) minmax(0, 1.1fr) 52px minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1fr) 40px';
const LOAD_FAILED = 'Couldn’t load the batch. Check your connection and try again.';
const LOAD_ERROR = 'The batch could not be loaded. Try again.';
const RETRY_DELAY_MS = 800;

function RowError({ message }) {
  if (!message) return null;
  return (
    <div className="mfg-line-error">
      <div className="hr-error"><span className="material-symbols-outlined" aria-hidden="true">error</span><span>{message}</span></div>
    </div>
  );
}

/**
 * Packaging of one pack row, edited on a copy. Done applies the copy to the row
 * even with problems left (the row's Packaging cell then shows a warning);
 * Cancel, Esc and the × drop it. Focus starts on the first empty material, or
 * else the first quantity, and returns to the Packaging cell on close (Modal).
 */
function PackagingDialog({ edit, materials, matById, usedElsewhere, onCancel, onDone }) {
  const [rows, setRows] = useState(edit.rows);
  const initial = useRef(edit.rows);
  const focusNext = useRef(null);

  useEffect(() => {
    const first = initial.current.find(r => !r.raw_material_id);
    const el = document.getElementById(first ? `dlg-pkg-${first.key}` : `dlg-pkgq-${initial.current[0]?.key}`);
    if (el) el.focus();
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const setLine = (key, p) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));
  const addLine = () => {
    const next = newPkgRow();
    focusNext.current = `dlg-pkg-${next.key}`;
    setRows(rs => [...rs, next]);
  };
  const options = (current) => materials.filter(x => x.material_type === 'packaging_material').map(x => ({
    value: x.id, label: x.name, hint: `${fmtQty(x.stock_qty, 'pcs')} in stock`,
    disabled: String(x.id) !== String(current) && (rows.some(r => String(r.raw_material_id) === String(x.id)) || num(x.stock_qty) <= 0),
    disabledReason: num(x.stock_qty) <= 0 ? 'Out of stock' : 'Already on this pack size',
  }));
  // The same checks the batch makes, shown on the line as soon as it has content.
  const lineError = (r) => {
    const m = matById.get(String(r.raw_material_id));
    const qty = parseNum(r.qty);
    if (!m && r.qty === '') return null;
    if (!m) return 'Choose the packaging material.';
    if (!Number.isInteger(qty) || qty <= 0) return `Enter a whole number of pcs of ${m.name}.`;
    const elsewhere = usedElsewhere(m.id);
    if (qty > num(m.stock_qty) - elsewhere + 1e-9) {
      return elsewhere > 0
        ? `Only ${fmtQty(Math.max(0, num(m.stock_qty) - elsewhere), 'pcs')} of ${m.name} left after the other pack sizes.`
        : `Only ${fmtQty(m.stock_qty, 'pcs')} of ${m.name} is in stock.`;
    }
    return null;
  };
  const total = round2(rows.reduce((s, x) => s + (parseNum(x.qty) > 0 ? round2(parseNum(x.qty) * num(matById.get(String(x.raw_material_id))?.purchase_rate)) : 0), 0));

  return (
    <Modal
      isOpen
      onClose={onCancel}
      size="lg"
      title={`Packaging — ${edit.title}`}
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onDone(rows)}>Done</button>
        </>
      )}
    >
      <div className="mfg-pkg-dialog">
        <div className="hr-lines mfg-lines">
          <div className="hr-lines-head" style={{ gridTemplateColumns: DLG_GRID }}>
            <span>Material</span><span className="mfg-lines-head-num">Quantity</span><span>Unit</span>
            <span className="mfg-lines-head-num">In stock</span><span className="mfg-lines-head-num">Rate (PKR)</span>
            <span className="mfg-lines-head-num">Amount</span><span />
          </div>
          {rows.map((x, xi) => {
            const m = matById.get(String(x.raw_material_id));
            const qty = parseNum(x.qty);
            const error = lineError(x);
            const isLast = xi === rows.length - 1;
            return (
              <div key={x.key} className="hr-line" style={{ gridTemplateColumns: DLG_GRID }}>
                <div className="hr-line-cell">
                  <Picker id={`dlg-pkg-${x.key}`} ariaLabel={`Packaging material ${xi + 1}`} value={x.raw_material_id}
                    placeholder="Select packaging" searchPlaceholder="Search packaging" options={options(x.raw_material_id)}
                    invalid={!!error && !m}
                    onChange={v => setLine(x.key, {
                      raw_material_id: v,
                      qty: x.qtyTouched || !(parseNum(edit.units) > 0) ? x.qty : String(edit.units),
                    })} />
                </div>
                <div className="hr-line-cell">
                  <NumberField id={`dlg-pkgq-${x.key}`} ariaLabel={`Packaging quantity ${xi + 1}`} value={x.qty} integer
                    invalid={!!error && !!m}
                    onChange={v => setLine(x.key, { qty: v, qtyTouched: true })}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !isLast) return;
                      e.preventDefault();
                      addLine();
                    }} />
                </div>
                <div className="hr-line-cell mfg-cell is-muted">pcs</div>
                <div className={`hr-line-cell mfg-cell is-num${m && qty > num(m.stock_qty) ? ' mfg-neg' : ' is-muted'}`}>
                  {!m ? '—' : qty > num(m.stock_qty) ? fmtQty(m.stock_qty) : <StockQty value={m.stock_qty} />}
                </div>
                <div className="hr-line-cell mfg-cell is-num">{m ? <Rate value={m.purchase_rate} /> : '—'}</div>
                <div className="hr-line-cell mfg-cell is-num">{m && qty > 0 ? fmtAmount(round2(qty * num(m.purchase_rate))) : '—'}</div>
                <RemoveLine label={`Remove packaging ${xi + 1}`} disabled={rows.length === 1}
                  onClick={() => setRows(rs => rs.filter(r => r.key !== x.key))} />
                <RowError message={error} />
              </div>
            );
          })}
          <div className="hr-lines-foot">
            <AddButton onClick={addLine} title="Or press Enter in the last quantity">Add packaging</AddButton>
            <span className="mfg-lines-total">Packaging <strong>{`PKR ${fmtAmount(total)}`}</strong></span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** A draft's stored form, made safe to edit (rows keep stable keys). */
function restoreForm(draft) {
  const base = emptyForm();
  const f = draft?.form;
  if (f && typeof f === 'object') {
    return {
      ...base,
      ...f,
      materials: Array.isArray(f.materials) && f.materials.length ? f.materials : base.materials,
      packs: Array.isArray(f.packs) && f.packs.length
        ? f.packs.map(p => ({ ...newPackRow(), ...p, packaging: Array.isArray(p.packaging) && p.packaging.length ? p.packaging : [newPkgRow()] }))
        : base.packs,
      byproducts: Array.isArray(f.byproducts) ? f.byproducts : [],
    };
  }
  // A draft saved without the form: rebuild what the columns hold.
  return { ...base, groupKey: groupKeyOf(draft?.product_name, draft?.category_id) };
}

// A request that may succeed if repeated: no response at all, or a server error.
const transient = (err) => !err?.response || err.response.status >= 500;

export default function BatchEditor() {
  const { id } = useParams();
  const draftId = id ? Number(id) : null;
  const [refs, setRefs] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saved, setSaved] = useState(() => JSON.stringify(emptyForm()));
  const [loadError, setLoadError] = useState(null);       // { message, retry?, record? }
  const [reloadKey, setReloadKey] = useState(0);
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [serverIssue, setServerIssue] = useState(null);     // { section, message }
  const [nextCode, setNextCode] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pkgEdit, setPkgEdit] = useState(null);   // { packKey, title, units, rows }
  const focusAfter = useRef(null);

  // ── Load: one automatic retry, then "Try again" reloads the data only ──
  useEffect(() => {
    let live = true;
    const fetchAll = () => Promise.all([
      api.get('/manufacturing/products'),
      api.get('/manufacturing/by-products'),
      api.get('/raw-materials'),
      api.get('/raw-materials/uom'),
      draftId ? api.get(`/manufacturing/batches/${draftId}`) : Promise.resolve(null),
    ]);
    fetchAll()
      .catch(err => (transient(err)
        ? new Promise(done => setTimeout(done, RETRY_DELAY_MS)).then(() => (live ? fetchAll() : Promise.reject(err)))
        : Promise.reject(err)))
      .then(([p, b, m, u, d]) => {
        if (!live) return;
        const nextRefs = { products: p.data, byProducts: b.data, materials: m.data, uoms: u.data };
        if (d && d.data.status !== 'draft') {
          setLoadError({ message: 'This batch has already been created and can no longer be edited.', record: true });
          return;
        }
        setRefs(nextRefs);
        if (d) {
          const restored = restoreForm({ ...d.data.draft, product_name: d.data.product_name, category_id: d.data.category_id });
          setForm(restored);
          setSaved(JSON.stringify(restored));
        }
      })
      .catch(err => {
        if (!live) return;
        if (!err?.response) setLoadError({ message: LOAD_FAILED, retry: true });
        else if (err.response.status >= 500) setLoadError({ message: err.response.data?.message || LOAD_ERROR, retry: true });
        else setLoadError({ message: err.response.data?.message || 'This batch cannot be opened.' });
      });
    return () => { live = false; };
  }, [draftId, reloadKey]);

  const retry = () => { setLoadError(null); setRefs(null); setReloadKey(k => k + 1); };

  // The code a batch on this date will get. Untouched by-product batch numbers
  // follow it with "-BP".
  useEffect(() => {
    if (!form.batch_date || !/^\d{4}-\d{2}-\d{2}$/.test(form.batch_date)) return undefined;
    let live = true;
    api.get('/manufacturing/batches/next-code', { params: { date: form.batch_date } })
      .then(r => { if (live) setNextCode(r.data.batch_code); }).catch(() => {});
    return () => { live = false; };
  }, [form.batch_date]);

  const model = useMemo(
    () => (refs ? buildBatchModel(form, refs, nextCode) : null),
    [form, refs, nextCode]
  );
  const dirty = JSON.stringify(form) !== saved;
  const guard = useUnsavedGuard(dirty && !creating);

  // Focus a newly added row once it exists.
  useEffect(() => {
    if (!focusAfter.current) return;
    const el = document.getElementById(focusAfter.current);
    focusAfter.current = null;
    if (el) el.focus();
  });

  const crumbs = [
    { label: 'Batches', to: '/manufacturing/batches' },
    { label: draftId ? 'Edit draft' : 'New batch' },
  ];

  if (loadError) {
    return (
      <Layout title="Batches">
        <HrStyles /><MfgStyles />
        <div className="mfg-page">
          <MfgPageHead crumbs={crumbs} title={draftId ? 'Edit draft' : 'New batch'} />
          <div className="card">
            <div className="hr-empty" role="alert">
              <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{loadError.retry ? 'cloud_off' : 'block'}</span></div>
              <div className="hr-empty-title">{loadError.message}</div>
              {loadError.retry && <button type="button" className="btn btn-outline" onClick={retry}>Try again</button>}
              {loadError.record && <Link className="mfg-link" to={`/manufacturing/batches/${draftId}`}>Open the batch record</Link>}
              {!loadError.retry && !loadError.record && <Link className="mfg-link" to="/manufacturing/batches">Back to batches</Link>}
            </div>
          </div>
        </div>
      </Layout>
    );
  }
  if (!refs || !model) {
    return (
      <Layout title="Batches">
        <div className="loading-center" role="status" aria-label="Loading"><div className="spinner" /></div>
      </Layout>
    );
  }

  const { group, outUom, matById, byById, view, issues, warnings, shortfalls } = model;
  const allIssues = serverIssue ? [{ section: serverIssue.section, anchor: `sec-${serverIssue.section}`, message: serverIssue.message }, ...issues] : issues;
  const byAnchor = {};
  issues.forEach(it => { if (!byAnchor[it.anchor]) byAnchor[it.anchor] = it.message; });
  const show = (anchor) => ((attempted || touched[anchor]) ? byAnchor[anchor] : null);
  const touch = (anchor) => setTouched(t => (t[anchor] ? t : { ...t, [anchor]: true }));
  const rowError = (prefix) => {
    const a = Object.keys(byAnchor).find(k => k.startsWith(prefix) && (attempted || touched[k]));
    return a ? byAnchor[a] : null;
  };

  const patch = (p) => { setForm(f => ({ ...f, ...p })); setServerIssue(null); };
  const setRow = (list, key, p) => { setForm(f => ({ ...f, [list]: f[list].map(r => (r.key === key ? { ...r, ...p } : r)) })); setServerIssue(null); };
  const removeRow = (list, key) => setForm(f => ({ ...f, [list]: f[list].filter(r => r.key !== key) }));
  const setPack = (packKey, fn) => setForm(f => ({ ...f, packs: f.packs.map(p => (p.key === packKey ? fn(p) : p)) }));

  // Scroll to a field and focus it.
  const jump = (it) => {
    setAttempted(true);
    const el = document.getElementById(it.anchor) || document.getElementById(`sec-${it.section}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => el.focus?.({ preventScroll: true }), 250);
    }
  };

  // ── Product ──
  const selectGroup = (key) => {
    const g = model.groups.find(x => x.key === key);
    const types = new Set((g?.packs || []).map(p => p.vol_uom_base_type));
    setForm(f => ({
      ...f,
      groupKey: key,
      packs: key === f.groupKey ? f.packs : [newPackRow()],
      output_uom_id: outUom && types.has(outUom.base_type) ? f.output_uom_id : '',
    }));
    touch('bf-product');
    setServerIssue(null);
  };
  const groupTypes = new Set((group?.packs || []).map(p => p.vol_uom_base_type));
  const outputUnits = refs.uoms.filter(u => !group || groupTypes.has(u.base_type)).map(u => ({ value: u.id, label: u.symbol }));

  // ── Options ──
  const used = new Map();
  [...form.materials.map(r => r.raw_material_id)].forEach(idv => { if (idv) used.set(String(idv), true); });
  const rawOptions = (current) => refs.materials.filter(x => x.material_type === 'raw_material').map(x => ({
    value: x.id, label: x.name, hint: `${fmtQty(x.stock_qty, x.uom_symbol)} in stock`,
    disabled: String(x.id) !== String(current) && (used.has(String(x.id)) || num(x.stock_qty) <= 0),
    disabledReason: num(x.stock_qty) <= 0 ? 'Out of stock' : 'Already in this batch',
  }));
  const pkgOptions = (pack, current) => refs.materials.filter(x => x.material_type === 'packaging_material').map(x => ({
    value: x.id, label: x.name, hint: `${fmtQty(x.stock_qty, 'pcs')} in stock`,
    disabled: String(x.id) !== String(current) && (pack.packaging.some(r => String(r.raw_material_id) === String(x.id)) || num(x.stock_qty) <= 0),
    disabledReason: num(x.stock_qty) <= 0 ? 'Out of stock' : 'Already on this pack size',
  }));
  const packOptions = (current) => (group?.packs || []).map(p => ({
    value: p.id, label: p.pack_size,
    disabled: String(p.id) !== String(current) && (form.packs.some(r => String(r.product_id) === String(p.id)) || (outUom && p.vol_uom_base_type !== outUom.base_type)),
    disabledReason: outUom && p.vol_uom_base_type !== outUom.base_type ? `Cannot be filled from an output in ${outUom.symbol}` : 'Already in this batch',
  }));
  // The unit is the option's hint ("Mustard Oil Cake   kg"), so the chosen
  // name stays whole in the narrow By-product column at 1366px.
  const byOptions = (current) => refs.byProducts.map(b => ({
    value: b.id, label: b.name, hint: b.pack_size,
    disabled: String(b.id) !== String(current) && form.byproducts.some(r => String(r.product_id) === String(b.id)),
    disabledReason: 'Already in this batch',
  }));

  const addPack = () => {
    if (!group || form.packs.length >= group.packs.length) return;
    const next = newPackRow();
    focusAfter.current = `pk-${next.key}-size`;
    setForm(f => ({ ...f, packs: [...f.packs, next] }));
  };
  const openPackaging = (pack, prod) => {
    const units = parseNum(pack.units);
    const title = [group?.name, prod?.pack_size || 'Pack size not chosen', units > 0 ? `${fmtQty(units)} units` : null].filter(Boolean).join(' · ');
    setPkgEdit({ packKey: pack.key, title, units: pack.units, rows: pack.packaging.map(x => ({ ...x })) });
  };
  // Packaging already taken by the other pack rows (stock is shared by the batch).
  const usedElsewhere = (materialId) => form.packs
    .filter(p => p.key !== pkgEdit?.packKey)
    .reduce((s, p) => s + p.packaging.reduce((t, x) => t + (String(x.raw_material_id) === String(materialId) && parseNum(x.qty) > 0 ? parseNum(x.qty) : 0), 0), 0);
  const applyPackaging = (rows) => {
    const key = pkgEdit.packKey;
    setPack(key, p => ({ ...p, packaging: rows.length ? rows : [newPkgRow()] }));
    touch(`pk-${key}-pkg`);
    setServerIssue(null);
    setPkgEdit(null);
  };

  const addMaterial = () => {
    const next = newMaterialRow();
    focusAfter.current = `rm-${next.key}-mat`;
    setForm(f => ({ ...f, materials: [...f.materials, next] }));
  };

  // ── Actions ──
  const saveDraft = async () => {
    if (!group) { setAttempted(true); jump({ section: 'batch', anchor: 'bf-product' }); toast.error('Choose the product before saving a draft.'); return; }
    setSavingDraft(true);
    try {
      const body = draftPayload(form, model);
      if (draftId) {
        await api.put(`/manufacturing/batches/drafts/${draftId}`, body);
        setSaved(JSON.stringify(form));
        toast.success('Draft saved.');
      } else {
        const r = await api.post('/manufacturing/batches/drafts', body);
        setSaved(JSON.stringify(form));
        toast.success('Draft saved.');
        guard.leave(`/manufacturing/batches/${r.data.id}/edit`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'The draft could not be saved. Try again.');
    } finally { setSavingDraft(false); }
  };

  const create = async () => {
    setAttempted(true);
    if (issues.length) { jump(issues[0]); return; }
    setCreating(true); setServerIssue(null);
    try {
      const r = await api.post('/manufacturing/batches', createPayload(form, model, draftId));
      toast.success(`Batch ${r.data.batch_code} created. It is ready for inventory.`);
      guard.leave(`/manufacturing/batches/${r.data.id}`);
    } catch (err) {
      const body = err?.response?.data;
      const section = SECTIONS[body?.step] ? body.step : 'batch';
      setServerIssue({ section, message: body?.message || 'The batch could not be created. Try again.' });
      document.getElementById(`sec-${section}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setCreating(false);
    }
  };

  const cancel = () => {
    const back = draftId ? `/manufacturing/batches/${draftId}` : '/manufacturing/batches';
    if (dirty) guard.confirmLeave(back); else guard.leave(back);
  };

  const unit = outUom?.symbol || '';
  // The (i) texts name the unit (and the by-product, when there is one row).
  const byCtx = byInfoContext(form.byproducts.map(b => byById.get(String(b.product_id))).filter(Boolean)
    .map(p => ({ name: p.name, unit: p.vol_uom_symbol || p.pack_size })));
  const fillPct = model.outputBase > 0 ? Math.min(100, (model.packedBase / model.outputBase) * 100) : 0;
  const over = model.outputBase > 0 && model.packedBase > model.outputBase * (1 + 1e-9) + 1e-6;
  const sectionNotice = (section) => (serverIssue?.section === section
    ? <Notice tone="danger" style={{ marginBottom: 12 }}>{serverIssue.message}</Notice> : null);

  // After Create batch: the red count beside the buttons, a link to the list.
  const toFix = attempted && allIssues.length > 0;
  const showFixList = () => {
    const el = document.getElementById('summary-issues');
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  };

  return (
    <Layout title="Batches">
      <HrStyles />
      <MfgStyles />
      <div className="mfg-page">
        <MfgPageHead
          sticky
          crumbs={crumbs}
          title={draftId ? (group ? group.name : 'Draft batch') : 'New batch'}
          meta={draftId ? <BatchStatus status="draft" /> : null}
          actions={(
            <>
              <span role="status" className="mfg-page-status-wrap">
                {toFix && (
                  <button type="button" className="mfg-page-status is-error is-link" onClick={showFixList}>
                    {`${plural(allIssues.length, 'thing', 'things')} to fix`}
                  </button>
                )}
              </span>
              <button type="button" className="btn btn-outline" onClick={cancel} disabled={creating}>Cancel</button>
              <BusyButton className="btn btn-outline" busy={savingDraft} busyLabel="Saving…" onClick={saveDraft} disabled={creating}>Save draft</BusyButton>
              <BusyButton busy={creating} busyLabel="Creating…" icon="check" onClick={create} disabled={savingDraft}>Create batch</BusyButton>
            </>
          )}
        />
        <div className="mfg-record">
          <div className="mfg-record-main">
            {/* a) Batch */}
            <section id="sec-batch" tabIndex={-1} className="mfg-sec">
              <Panel title="Batch">
                {sectionNotice('batch')}
                <div className="hr-form-grid">
                  <FormField label="Product" htmlFor="bf-product" required col={7} error={show('bf-product')}>
                    <Picker id="bf-product" value={form.groupKey} placeholder="Select product" searchPlaceholder="Search products"
                      invalid={!!show('bf-product')}
                      options={model.groups.map(g => ({ value: g.key, label: g.label, hint: plural(g.packs.length, 'pack size', 'pack sizes') }))}
                      onChange={selectGroup} />
                  </FormField>
                  <FormField label="Total output" htmlFor="bf-output" required col={5} error={show('bf-output')}>
                    <div className="mfg-qty-unit">
                      <NumberField id="bf-output" value={form.output_qty} invalid={!!show('bf-output')}
                        integer={refs.uoms.find(u => String(u.id) === String(form.output_uom_id))?.base_type === 'count'}
                        onChange={v => patch({ output_qty: v })} onBlur={() => touch('bf-output')} />
                      <Picker ariaLabel="Output unit" value={form.output_uom_id} placeholder="Unit" options={outputUnits}
                        invalid={!!show('bf-output') && !form.output_uom_id}
                        onChange={v => { patch({ output_uom_id: v }); touch('bf-output'); }} />
                    </div>
                  </FormField>
                  <MfgField label="Batch code" htmlFor="bf-code" className="hr-col-4"
                    info="Numbered in date order. If another batch with the same date is created first, this batch takes the next number.">
                    <input id="bf-code" className="form-control mfg-readonly" value={nextCode} placeholder="Enter the batch date" readOnly />
                  </MfgField>
                  <FormField label="Batch date" htmlFor="bf-date" required col={4} error={show('bf-date')}>
                    <DateInput id="bf-date" value={form.batch_date} max={todayPKT()} invalid={!!show('bf-date')}
                      onChange={e => patch({ batch_date: e.target.value })} onBlur={() => touch('bf-date')} />
                  </FormField>
                  <MfgField label="Expiry date" htmlFor="bf-expiry" required className="hr-col-4" error={show('bf-expiry')}
                    info="Applies to every pack of this batch. By-products carry their own expiry.">
                    <DateInput id="bf-expiry" value={form.expiry_date} min={form.batch_date || undefined} invalid={!!show('bf-expiry')}
                      onChange={e => { patch({ expiry_date: e.target.value }); touch('bf-expiry'); }} onBlur={() => touch('bf-expiry')} />
                  </MfgField>
                </div>
              </Panel>
            </section>

            {/* b) Raw materials */}
            <section id="sec-materials" tabIndex={-1} className="mfg-sec">
              <Panel title="Raw materials" status={view.raw_material_cost > 0 ? `PKR ${fmtAmount(view.raw_material_cost)}` : undefined}>
                {sectionNotice('materials')}
                <div className="hr-lines mfg-lines">
                  <div className="hr-lines-head" style={{ gridTemplateColumns: MAT_GRID }}>
                    <span>Material</span><span className="mfg-lines-head-num">Quantity</span>
                    <span className="mfg-lines-head-num">In stock</span><span className="mfg-lines-head-num">Rate (PKR)</span>
                    <span className="mfg-lines-head-num">Amount</span><span />
                  </div>
                  {form.materials.map((row, i) => {
                    const m = matById.get(String(row.raw_material_id));
                    const qty = parseNum(row.qty);
                    const isLast = i === form.materials.length - 1;
                    return (
                      <div key={row.key} className="hr-line" style={{ gridTemplateColumns: MAT_GRID }}>
                        <div className="hr-line-cell">
                          <Picker id={`rm-${row.key}-mat`} ariaLabel={`Raw material, line ${i + 1}`} value={row.raw_material_id}
                            placeholder="Select raw material" searchPlaceholder="Search raw materials" options={rawOptions(row.raw_material_id)}
                            invalid={!!show(`rm-${row.key}-mat`)}
                            onChange={v => { setRow('materials', row.key, { raw_material_id: v }); touch(`rm-${row.key}-mat`); }} />
                        </div>
                        <div className="hr-line-cell">
                          <NumberField id={`rm-${row.key}-qty`} ariaLabel={`Quantity, line ${i + 1}`} value={row.qty} suffix={m?.uom_symbol}
                            integer={m?.base_type === 'count'}
                            invalid={!!show(`rm-${row.key}-qty`)}
                            onChange={v => setRow('materials', row.key, { qty: v })}
                            onBlur={() => touch(`rm-${row.key}-qty`)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' || !isLast) return;
                              e.preventDefault();
                              addMaterial();
                            }} />
                        </div>
                        <div className={`hr-line-cell mfg-cell is-num${m && qty > num(m.stock_qty) ? ' mfg-neg' : ' is-muted'}`}>
                          {!m ? '—' : qty > num(m.stock_qty) ? <Qty value={m.stock_qty} unit={m.uom_symbol} /> : <StockQty value={m.stock_qty} unit={m.uom_symbol} />}
                        </div>
                        <div className="hr-line-cell mfg-cell is-num">{m ? <Rate value={m.purchase_rate} /> : '—'}</div>
                        <div className="hr-line-cell mfg-cell is-num">{m && qty > 0 ? fmtAmount(round2(qty * num(m.purchase_rate))) : '—'}</div>
                        <RemoveLine label={`Remove line ${i + 1}`} disabled={form.materials.length === 1} onClick={() => removeRow('materials', row.key)} />
                        <RowError message={rowError(`rm-${row.key}`)} />
                      </div>
                    );
                  })}
                  <div className="hr-lines-foot">
                    <AddButton onClick={addMaterial} title="Or press Enter in the last quantity">Add raw material</AddButton>
                  </div>
                </div>
              </Panel>
            </section>

            {/* c) Packs: one table; packaging is edited in a dialog per row */}
            <section id="sec-packs" tabIndex={-1} className="mfg-sec">
              <Panel
                title="Packs"
                status={view.packs.length ? `${fmtQty(view.packs.reduce((s, p) => s + p.units, 0))} units` : undefined}
                actions={group ? (
                  <div className={`mfg-fill-head${over ? ' is-over' : ''}`} id="packs-fill" tabIndex={-1}>
                    <div className="mfg-fill-figs">
                      <span>Total <strong>{model.outputBase > 0 ? fmtQty(form.output_qty, unit) : '—'}</strong></span>
                      <span>Packed <strong style={over ? { color: 'var(--red)' } : undefined}>{model.packedBase > 0 ? fmtQty(view.packed_volume, unit) : '—'}</strong></span>
                      <span>Loss <strong>{model.outputBase > 0 && !over ? fmtQty(view.loss_volume, unit) : '—'}</strong></span>
                    </div>
                    <div className="mfg-gauge-track" aria-hidden="true">
                      <div className={`mfg-gauge-fill${over ? ' is-over' : ''}`} style={{ width: `${over ? 100 : fillPct}%` }} />
                    </div>
                  </div>
                ) : undefined}
              >
                {sectionNotice('packs')}
                {!group ? (
                  <div className="mfg-empty-inline">Choose the product to add its pack sizes.</div>
                ) : (
                  <div className="hr-lines mfg-lines">
                    <div className="hr-lines-head is-wrap" style={{ gridTemplateColumns: PACK_GRID }}>
                      <span>Pack size</span><span className="mfg-lines-head-num">Units</span><span className="mfg-lines-head-num">Packed</span>
                      <span>Packaging</span><span className="mfg-lines-head-num">Packaging cost</span><span />
                    </div>
                    {form.packs.map((pack, pi) => {
                      const prod = model.packById.get(String(pack.product_id));
                      const units = parseNum(pack.units);
                      const packed = prod && units > 0 ? (units * num(prod.volume) * num(prod.vol_uom_factor)) / (model.outFactor || 1) : null;
                      const pkgLines = pack.packaging.filter(x => x.raw_material_id || x.qty !== '');
                      const pkgCost = round2(pkgLines.reduce((s, x) => s + (parseNum(x.qty) > 0 ? round2(parseNum(x.qty) * num(matById.get(String(x.raw_material_id))?.purchase_rate)) : 0), 0));
                      const cellId = `pk-${pack.key}-pkg`;
                      const pkgIssues = [...new Set(issues.filter(it => it.anchor === cellId).map(it => it.message))];
                      const flagged = pkgIssues.length > 0 && (attempted || !!touched[cellId] || pkgLines.length > 0);
                      const isLast = pi === form.packs.length - 1;
                      const packErr = [`pk-${pack.key}-size`, `pk-${pack.key}-units`].map(a => show(a)).find(Boolean);
                      const tip = pkgLines.length || flagged ? (
                        <>
                          {pkgLines.length > 0 && (
                            <ul className="mfg-tip-list">
                              {pkgLines.map(x => {
                                const m = matById.get(String(x.raw_material_id));
                                return <li key={x.key}><span>{m ? m.name : 'No material chosen'}</span><span>{parseNum(x.qty) > 0 ? fmtQty(parseNum(x.qty), 'pcs') : '—'}</span></li>;
                              })}
                            </ul>
                          )}
                          {flagged && pkgIssues.map(msg => <span key={msg} className="mfg-tip-issue">{msg}</span>)}
                        </>
                      ) : null;
                      return (
                        <div key={pack.key} className="hr-line" style={{ gridTemplateColumns: PACK_GRID }}>
                          <div className="hr-line-cell">
                            <Picker id={`pk-${pack.key}-size`} ariaLabel={`Pack size, line ${pi + 1}`} value={pack.product_id} placeholder="Select pack size"
                              invalid={!!show(`pk-${pack.key}-size`)} options={packOptions(pack.product_id)}
                              onChange={v => { setRow('packs', pack.key, { product_id: v }); touch(`pk-${pack.key}-size`); }} />
                          </div>
                          <div className="hr-line-cell">
                            <NumberField id={`pk-${pack.key}-units`} ariaLabel={`Units, line ${pi + 1}`} value={pack.units} integer
                              invalid={!!show(`pk-${pack.key}-units`)} onBlur={() => touch(`pk-${pack.key}-units`)}
                              onChange={v => setPack(pack.key, p => ({
                                ...p, units: v,
                                packaging: p.packaging.map(x => (x.qtyTouched || !x.raw_material_id ? x : { ...x, qty: v })),
                              }))}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' || !isLast) return;
                                e.preventDefault();
                                addPack();
                              }} />
                          </div>
                          <div className="hr-line-cell mfg-cell is-num">{packed === null ? '—' : fmtQty(packed, unit)}</div>
                          <div className="hr-line-cell mfg-pkg-cell">
                            <Tip content={tip}>
                              <button type="button" id={cellId} className={`mfg-cell-btn${pkgLines.length ? '' : ' is-add'}`}
                                aria-invalid={flagged ? 'true' : undefined}
                                aria-label={pkgLines.length
                                  ? `Packaging, line ${pi + 1}: ${plural(pkgLines.length, 'material', 'materials')}. Edit`
                                  : `Add packaging, line ${pi + 1}`}
                                onClick={() => openPackaging(pack, prod)}>
                                {flagged && <span className="material-symbols-outlined mfg-pkg-warn" aria-hidden="true">warning</span>}
                                {pkgLines.length ? (
                                  <>{plural(pkgLines.length, 'material', 'materials')}<span className="material-symbols-outlined" aria-hidden="true">edit</span></>
                                ) : (
                                  <>{!flagged && <span className="material-symbols-outlined" aria-hidden="true">add</span>}Add packaging</>
                                )}
                              </button>
                            </Tip>
                          </div>
                          <div className="hr-line-cell mfg-cell is-num">{pkgCost > 0 ? fmtAmount(pkgCost) : '—'}</div>
                          <RemoveLine label={`Remove pack size ${pi + 1}`} disabled={form.packs.length === 1} onClick={() => removeRow('packs', pack.key)} />
                          <RowError message={packErr} />
                        </div>
                      );
                    })}
                    <div className="hr-lines-foot">
                      <AddButton disabled={form.packs.length >= group.packs.length}
                        title={form.packs.length >= group.packs.length ? 'Every pack size of this product is already listed' : 'Or press Enter in the last Units field'}
                        onClick={addPack}>
                        Add pack size
                      </AddButton>
                    </div>
                  </div>
                )}
                {(attempted || over) && byAnchor['packs-fill'] && (
                  <div className="hr-error mfg-pack-error"><span className="material-symbols-outlined" aria-hidden="true">error</span><span>{byAnchor['packs-fill']}</span></div>
                )}
              </Panel>
            </section>

            {/* d) By-products: one row each */}
            <section id="sec-byproducts" tabIndex={-1} className="mfg-sec">
              <Panel
                title={<>By-products<span className="mfg-title-sub">Optional</span></>}
                actions={view.byproducts.length
                  ? <span className="mfg-head-figure">By-product value<strong>{`PKR ${fmtAmount(view.byproduct_value)}`}</strong></span>
                  : undefined}
              >
                {sectionNotice('byproducts')}
                {form.byproducts.length === 0 ? (
                  <div className="mfg-empty-inline">
                    <span>No by-products added</span>
                    <AddButton disabled={refs.byProducts.length === 0}
                      title={refs.byProducts.length === 0 ? 'Add by-products on the Manufactured products screen first' : 'Their value is deducted from the cost shared by the packs'}
                      onClick={() => setForm(f => ({ ...f, byproducts: [newByRow()] }))}>
                      Add by-product
                    </AddButton>
                  </div>
                ) : (
                  <div className="hr-lines mfg-lines mfg-by-lines">
                    <div className="hr-lines-head">
                      <span>By-product</span><span className="mfg-lines-head-num">Qty</span><span>Batch no.</span><span>Expiry</span>
                      <span className="mfg-lines-head-num"><ByRateHead which="purchase" ctx={byCtx} /></span>
                      <span className="mfg-lines-head-num"><ByRateHead which="sale" ctx={byCtx} /></span>
                      <span />
                    </div>
                    {form.byproducts.map((b, i) => {
                      const prod = byById.get(String(b.product_id));
                      return (
                        <div key={b.key} className="hr-line">
                          <div className="hr-line-cell">
                            <Picker id={`bp-${b.key}-prod`} ariaLabel={`By-product, line ${i + 1}`} value={b.product_id} placeholder="Select"
                              searchPlaceholder="Search by-products" options={byOptions(b.product_id)} invalid={!!show(`bp-${b.key}-prod`)}
                              onChange={v => {
                                const p = byById.get(String(v));
                                // A newly chosen by-product brings its own rates; both stay editable.
                                setRow('byproducts', b.key, {
                                  product_id: v,
                                  purchase_rate: p?.purchase_rate == null ? '' : String(num(p.purchase_rate)),
                                  sale_rate: p?.sale_rate == null ? '' : String(num(p.sale_rate)),
                                });
                                touch(`bp-${b.key}-prod`);
                              }} />
                          </div>
                          <div className="hr-line-cell">
                            <NumberField id={`bp-${b.key}-qty`} ariaLabel={`Quantity${prod ? ` in ${prod.vol_uom_symbol || prod.pack_size}` : ''}, line ${i + 1}`} value={b.qty} integer
                              invalid={!!show(`bp-${b.key}-qty`)} onBlur={() => touch(`bp-${b.key}-qty`)}
                              onChange={v => setRow('byproducts', b.key, { qty: v })} />
                          </div>
                          <div className="hr-line-cell mfg-batchno">
                            <input id={`bp-${b.key}-no`} className={`form-control${show(`bp-${b.key}-no`) ? ' hr-invalid' : ''}`}
                              aria-label={`Batch number, line ${i + 1}`} maxLength={100}
                              title={b.followsCode ? 'The batch code with "-BP", final when the batch is created' : undefined}
                              value={b.followsCode ? byProductBatchNo(nextCode) : b.batch_no}
                              onChange={e => setRow('byproducts', b.key, { batch_no: e.target.value, followsCode: false })}
                              onBlur={() => touch(`bp-${b.key}-no`)} />
                            {!b.followsCode && (
                              <button type="button" className="mfg-icon-btn" title="Use the default batch number" aria-label="Use the default batch number"
                                onClick={() => setRow('byproducts', b.key, { batch_no: '', followsCode: true })}>
                                <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
                              </button>
                            )}
                          </div>
                          <div className="hr-line-cell">
                            <DateInput id={`bp-${b.key}-exp`} aria-label={`Expiry date, line ${i + 1}`} value={b.exp_date}
                              min={form.batch_date || undefined} invalid={!!show(`bp-${b.key}-exp`)}
                              onChange={e => { setRow('byproducts', b.key, { exp_date: e.target.value }); touch(`bp-${b.key}-exp`); }} />
                          </div>
                          <div className="hr-line-cell">
                            <NumberField id={`bp-${b.key}-prate`} ariaLabel={`Purchase rate, line ${i + 1}`}
                              value={b.purchase_rate ?? (prod ? String(num(prod.purchase_rate)) : '')}
                              invalid={!!show(`bp-${b.key}-prate`)} onBlur={() => touch(`bp-${b.key}-prate`)}
                              onChange={v => setRow('byproducts', b.key, { purchase_rate: v })} />
                          </div>
                          <div className="hr-line-cell">
                            <NumberField id={`bp-${b.key}-srate`} ariaLabel={`Sale rate, line ${i + 1}`}
                              value={b.sale_rate ?? (prod ? String(num(prod.sale_rate)) : '')}
                              invalid={!!show(`bp-${b.key}-srate`)} onBlur={() => touch(`bp-${b.key}-srate`)}
                              onChange={v => setRow('byproducts', b.key, { sale_rate: v })} />
                          </div>
                          <RemoveLine label={`Remove by-product ${i + 1}`} onClick={() => removeRow('byproducts', b.key)} />
                          <RowError message={rowError(`bp-${b.key}`)} />
                        </div>
                      );
                    })}
                    <div className="hr-lines-foot">
                      <AddButton disabled={form.byproducts.length >= refs.byProducts.length}
                        onClick={() => setForm(f => ({ ...f, byproducts: [...f.byproducts, newByRow()] }))}>
                        Add by-product
                      </AddButton>
                    </div>
                  </div>
                )}
              </Panel>
            </section>

            {/* e) Other costs */}
            <section id="sec-costs" tabIndex={-1} className="mfg-sec">
              <Panel title="Other costs">
                {sectionNotice('costs')}
                <div className="hr-form-grid">
                  <FormField label="Miscellaneous expense (PKR)" htmlFor="bf-misc" col={4} error={show('bf-misc')}>
                    <NumberField id="bf-misc" value={form.misc_expense} invalid={!!show('bf-misc')}
                      onChange={v => patch({ misc_expense: v })} onBlur={() => touch('bf-misc')} />
                  </FormField>
                  <FormField label="Note" htmlFor="bf-note" col={8}>
                    <input id="bf-note" className="form-control" placeholder="Optional" maxLength={200}
                      value={form.misc_note} onChange={e => patch({ misc_note: e.target.value })} />
                  </FormField>
                </div>
              </Panel>
            </section>
          </div>

          <div className="mfg-record-side">
            <CostSummary view={view} issues={allIssues} attempted={attempted}
              warnings={warnings} shortfalls={shortfalls} onJump={jump} />
          </div>
        </div>
      </div>
      {pkgEdit && (
        <PackagingDialog
          key={pkgEdit.packKey}
          edit={pkgEdit}
          materials={refs.materials}
          matById={matById}
          usedElsewhere={usedElsewhere}
          onCancel={() => setPkgEdit(null)}
          onDone={applyPackaging}
        />
      )}
      {guard.dialog}
    </Layout>
  );
}

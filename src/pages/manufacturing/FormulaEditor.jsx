import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { todayPKT } from '../../utils/dateUtils';
import { HrStyles, Panel, Notice, BusyButton, KebabMenu, TableSkeleton, fmtAmount, num } from '../hr/HrKit';
import {
  MfgStyles, MfgPageHead, Picker, NumberField, Info, AddButton, RemoveLine, WarnText, Rate, AverageRateInfo, EMPTY,
  fmtQty, parseNum, round2, plural, normKey, fmtClock, fmtStamp, mfgError, FormulaStatus,
} from './mfgKit';
import { useUnsavedGuard, packagingFromBatch } from './batchKit';

// ─── Product formula ───────────────────────────────────────────────────────
// /manufacturing/products/:productId/formula — any pack size of the product
// opens the formula of its whole group (same name + category):
//   Raw materials  quantities for a reference output ("for 100 L"); a new
//                  batch scales them to its total output
//   Packaging      per pack size, "quantity for every N units"; a new batch
//                  takes ceil(units × quantity ÷ N)
// The page has the batch record's layout: sticky head, sections on the left,
// a sticky "Cost per unit" estimate on the right. Nothing here moves stock,
// so the pickers list out-of-stock materials too.
// ?from_batch=<id> fills the page from a batch ("Use as formula" on the batch
// record); nothing is saved until Save formula.
// The save is refused (409) when the formula was saved elsewhere after this
// page loaded (another user, or this user in another window); the edits stay
// until the user reloads. After a save the page returns to where it was
// opened from: the batch record for ?from_batch, else Products.
// The head names the product (the breadcrumb says Formula); its category
// shows only when another manufactured product has the same name (the batch
// editor's label rule).

const PRODUCTS_URL = '/manufacturing/products?tab=products';
const LOAD_FAILED = 'Couldn’t load the formula. Check your connection and try again.';
const RETRY_DELAY_MS = 800;

const uid = () => Math.random().toString(36).slice(2, 10);
const newLine = () => ({ key: uid(), raw_material_id: '', qty: '' });
const newPkgLine = () => ({ key: uid(), raw_material_id: '', qty: '', per_units: '1', check: null });
const isBlank = (x) => !x.raw_material_id && x.qty === '';
const isBlankPkg = (x) => !x.raw_material_id && x.qty === '' && (x.per_units === '' || x.per_units === '1');
const decimalsOk = (n, places) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;
const transient = (err) => !err?.response || err.response.status >= 500;
const pkgLines = (form, productId) => form.packs[String(productId)] || [];
const NOT_SET = <span className="mfg-empty-val">Not set</span>;

/** The saved formula as an editable form. A pack size without packaging has
 *  no lines (its block shows the empty state). */
function toForm(data) {
  return {
    ref_qty: data.formula ? String(num(data.formula.ref_qty)) : '',
    ref_uom_id: data.formula ? String(data.formula.ref_uom_id) : '',
    materials: data.formula?.materials.length
      ? data.formula.materials.map(m => ({ key: uid(), raw_material_id: m.raw_material_id, qty: String(num(m.qty)) }))
      : [newLine()],
    packs: Object.fromEntries(data.packs.map(p => [String(p.product_id), p.packaging.map(x => ({
      key: uid(), raw_material_id: x.raw_material_id, qty: String(x.qty), per_units: String(x.per_units), check: null,
    }))])),
  };
}

/** The form filled from a batch: its output, raw materials, and the packaging
 *  of each pack size it made. Pack sizes not in the batch keep theirs. */
function fromBatch(data, batch) {
  const base = toForm(data);
  const packs = { ...base.packs };
  batch.packs.forEach(bp => {
    const key = String(bp.product_id);
    if (!(key in packs)) return;
    packs[key] = bp.packaging.map(x => ({ key: uid(), raw_material_id: x.raw_material_id, ...packagingFromBatch(x.qty, bp.units) }));
  });
  return {
    ref_qty: num(batch.total_volume) > 0 ? String(num(batch.total_volume)) : '',
    ref_uom_id: batch.volume_uom_id ? String(batch.volume_uom_id) : '',
    materials: batch.materials.length
      ? batch.materials.map(m => ({ key: uid(), raw_material_id: m.raw_material_id, qty: String(num(m.qty)) }))
      : [newLine()],
    packs,
  };
}

/** What a save would store: blank lines dropped, numbers as numbers. Two
 *  forms with the same signature need no save. */
function signature(form) {
  const n = (v) => (parseNum(v) >= 0 ? parseNum(v) : String(v ?? ''));
  return JSON.stringify({
    ref: [n(form.ref_qty), String(form.ref_uom_id || '')],
    materials: form.materials.filter(x => !isBlank(x)).map(x => [String(x.raw_material_id), n(x.qty)]),
    packs: Object.keys(form.packs).sort().map(k => [k, form.packs[k].filter(x => !isBlankPkg(x))
      .map(x => [String(x.raw_material_id), n(x.qty), n(x.per_units)])]),
  });
}

/** The same checks as the server, in page order (output, raw materials,
 *  then each pack size). Each issue names the field to scroll to. */
function validate(form, data, matById, uomById) {
  const issues = [];
  const add = (anchor, message) => issues.push({ anchor, message });
  const materials = form.materials.filter(x => !isBlank(x));
  if (materials.length) {
    const q = parseNum(form.ref_qty);
    const unit = uomById.get(String(form.ref_uom_id));
    if (!(q > 0)) add('f-ref-qty', 'Enter the output these quantities are for.');
    else if (!decimalsOk(q, 3)) add('f-ref-qty', 'Enter the output with at most 3 decimals.');
    else if (!unit) add('f-ref-unit', 'Choose the unit of the output.');
    else if (unit.base_type === 'count' && !Number.isInteger(q)) add('f-ref-qty', `Enter a whole number of ${unit.symbol} for the output.`);
  }
  materials.forEach(x => {
    const m = matById.get(String(x.raw_material_id));
    const q = parseNum(x.qty);
    if (!m) { add(`fm-${x.key}-mat`, 'Choose a raw material on every line.'); return; }
    if (!(q > 0)) { add(`fm-${x.key}-qty`, `Enter a quantity for ${m.name}.`); return; }
    if (m.base_type === 'count' && !Number.isInteger(q)) { add(`fm-${x.key}-qty`, `Enter a whole number of ${m.uom_symbol} for ${m.name}.`); return; }
    if (!decimalsOk(q, 3)) add(`fm-${x.key}-qty`, `Enter the quantity of ${m.name} with at most 3 decimals.`);
  });
  data.packs.forEach(p => {
    pkgLines(form, p.product_id).filter(x => !isBlankPkg(x)).forEach(x => {
      const m = matById.get(String(x.raw_material_id));
      const q = parseNum(x.qty);
      const per = parseNum(x.per_units);
      if (!m) { add(`fp-${x.key}-mat`, `Choose the packaging material for ${p.pack_size}.`); return; }
      if (!Number.isInteger(q) || q < 1) { add(`fp-${x.key}-qty`, `Enter a whole number of pcs of ${m.name} for ${p.pack_size}.`); return; }
      if (!Number.isInteger(per) || per < 1) add(`fp-${x.key}-per`, `Enter a whole number of units for ${m.name} on ${p.pack_size}.`);
    });
  });
  return issues;
}

/** "at 3:42 PM" today, else "on 13/10/2026 at 3:42 PM" (PKT stamp strings). */
function whenText(stamp) {
  if (!stamp) return '';
  return stamp.slice(0, 10) === todayPKT() ? `at ${fmtClock(stamp)}` : `on ${fmtStamp(stamp)}`;
}

/** Complete / Incomplete / Not set for the whole product, from what is
 *  saved: complete needs raw materials and packaging on every pack size. */
function formulaState(data) {
  const withPackaging = data.packs.filter(p => p.packaging.length).length;
  if (data.formula && withPackaging === data.packs.length) return 'complete';
  return data.formula || withPackaging ? 'partial' : 'none';
}

function RowError({ id, message }) {
  if (!message) return null;
  return (
    <div className="mfg-line-error" id={id}>
      <div className="hr-error" role="alert"><span className="material-symbols-outlined" aria-hidden="true">error</span><span>{message}</span></div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="mfg-record" aria-busy="true">
      <div className="mfg-record-main">
        <Panel title="Raw materials"><TableSkeleton columns={5} rows={3} /></Panel>
        <Panel title="Packaging"><TableSkeleton columns={5} rows={4} /></Panel>
      </div>
      <div className="mfg-record-side">
        <aside className="mfg-summary" aria-label="Cost per unit">
          <div className="mfg-summary-title">Cost per unit</div>
          <TableSkeleton columns={2} rows={4} />
        </aside>
      </div>
    </div>
  );
}

export default function FormulaEditor() {
  const { productId } = useParams();
  const [params] = useSearchParams();
  const fromBatchId = params.get('from_batch');
  const [data, setData] = useState(null);           // GET …/formula
  const [refs, setRefs] = useState(null);           // { materials, uoms }
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const [prefill, setPrefill] = useState(null);     // { batchCode, replaces }
  const [loadError, setLoadError] = useState(null); // { message, retry?, notFound? }
  const [reloadKey, setReloadKey] = useState(0);
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);   // { by, byId, at }
  const [namesake, setNamesake] = useState(false);  // another product group has this name
  const { user } = useAuth() || {};
  const focusAfter = useRef(null);

  // ── Load: one automatic retry, then "Try again" ──
  useEffect(() => {
    let live = true;
    const fetchAll = () => Promise.all([
      api.get(`/manufacturing/products/${productId}/formula`),
      api.get('/raw-materials'),
      api.get('/raw-materials/uom'),
      fromBatchId ? api.get(`/manufacturing/batches/${fromBatchId}`).catch(() => null) : Promise.resolve(null),
      // Only for the category in the head; the page works without it.
      api.get('/manufacturing/products').catch(() => null),
    ]);
    fetchAll()
      .catch(err => (transient(err)
        ? new Promise(done => setTimeout(done, RETRY_DELAY_MS)).then(() => (live ? fetchAll() : Promise.reject(err)))
        : Promise.reject(err)))
      .then(([f, m, u, b, prods]) => {
        if (!live) return;
        setNamesake((prods?.data || []).some(p => normKey(p.name) === normKey(f.data.product_name)
          && (p.category_id ?? null) !== (f.data.category_id ?? null)));
        const batch = b && ['ready', 'in_inventory'].includes(b.data.status) ? b.data : null;
        setData(f.data);
        setRefs({ materials: m.data, uoms: u.data });
        setForm(batch ? fromBatch(f.data, batch) : toForm(f.data));
        setSaved(signature(toForm(f.data)));
        setPrefill(batch ? {
          batchCode: batch.batch_code,
          replaces: !!f.data.formula || f.data.packs.some(p => p.packaging.length),
        } : fromBatchId ? { failed: true } : null);
      })
      .catch(err => {
        if (!live) return;
        if (err?.response?.status === 404) setLoadError({ message: 'This product no longer exists.', notFound: true });
        else if (transient(err)) setLoadError({ message: mfgError(err, LOAD_FAILED), retry: true });
        else setLoadError({ message: mfgError(err, 'This formula cannot be opened.') });
      });
    return () => { live = false; };
  }, [productId, fromBatchId, reloadKey]);

  const dirty = !!form && signature(form) !== saved;
  const guard = useUnsavedGuard(dirty && !saving);

  useEffect(() => {
    if (!focusAfter.current) return;
    const el = document.getElementById(focusAfter.current);
    focusAfter.current = null;
    if (el) el.focus();
  });

  const matById = useMemo(() => new Map((refs?.materials || []).map(m => [String(m.id), m])), [refs]);
  const uomById = useMemo(() => new Map((refs?.uoms || []).map(u => [String(u.id), u])), [refs]);
  const issues = useMemo(() => (form && data ? validate(form, data, matById, uomById) : []), [form, data, matById, uomById]);

  const backTo = fromBatchId ? `/manufacturing/batches/${fromBatchId}` : PRODUCTS_URL;
  const crumbs = [{ label: 'Manufactured products', to: PRODUCTS_URL }, { label: 'Formula' }];

  if (loadError) {
    return (
      <Layout title="Manufactured Products">
        <HrStyles /><MfgStyles />
        <div className="mfg-page">
          <MfgPageHead crumbs={crumbs} title="Formula" />
          <div className="card">
            <div className="hr-empty" role="alert">
              <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{loadError.retry ? 'cloud_off' : 'block'}</span></div>
              <div className="hr-empty-title">{loadError.message}</div>
              {loadError.retry
                ? <button type="button" className="btn btn-outline" onClick={() => { setLoadError(null); setReloadKey(k => k + 1); }}>Try again</button>
                : <Link className="mfg-link" to={PRODUCTS_URL}>Back to products</Link>}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const ready = !!(data && refs && form);
  const headActions = (
    <>
      <span role="status" className="mfg-page-status-wrap">
        {ready && attempted && issues.length > 0 && (
          <button type="button" className="mfg-page-status is-error is-link" onClick={() => jump(issues[0])}>
            {`${plural(issues.length, 'thing', 'things')} to fix`}
          </button>
        )}
      </span>
      <button type="button" className="btn btn-outline" disabled={saving} onClick={() => cancel()}>Cancel</button>
      <BusyButton busy={saving} busyLabel="Saving…" icon="check" onClick={() => save()}
        disabled={!ready || !dirty} title={ready && !dirty ? 'No changes to save' : undefined}>
        Save formula
      </BusyButton>
    </>
  );

  if (!ready) {
    return (
      <Layout title="Manufactured Products">
        <HrStyles /><MfgStyles />
        <div className="mfg-page">
          <MfgPageHead sticky crumbs={crumbs} actions={headActions}
            title={<span className="hr-skel hr-skel-title mfg-skel-title" aria-label="Loading" />} />
          <LoadingBody />
        </div>
      </Layout>
    );
  }

  // ── Derived ──
  const shown = (anchor) => (attempted || touched[anchor] ? issues.find(it => it.anchor === anchor)?.message : null);
  const lineError = (prefix) => issues.find(it => it.anchor.startsWith(prefix) && (attempted || touched[it.anchor]))?.message || null;
  const touch = (anchor) => setTouched(t => (t[anchor] ? t : { ...t, [anchor]: true }));
  const rawMaterials = refs.materials.filter(m => m.material_type === 'raw_material');
  const packagingMaterials = refs.materials.filter(m => m.material_type === 'packaging_material');
  const packTypes = new Set(data.packs.map(p => p.vol_uom_base_type));
  const unitOptions = refs.uoms.filter(u => packTypes.has(u.base_type)).map(u => ({ value: String(u.id), label: u.symbol }));
  const refUnit = uomById.get(String(form.ref_uom_id));
  const refQty = parseNum(form.ref_qty);

  const materialRows = form.materials.map(x => {
    const m = matById.get(String(x.raw_material_id));
    const q = parseNum(x.qty);
    return { x, m, amount: m && q > 0 ? round2(q * num(m.purchase_rate)) : null };
  });
  const rawTotal = round2(materialRows.reduce((s, r) => s + (r.amount || 0), 0));
  const rawValid = materialRows.some(r => r.amount !== null) && !materialRows.some(r => !isBlank(r.x) && r.amount === null);
  // Raw-material cost of one base unit of output (1 ml, 1 g, 1 pcs).
  const rawPerBase = rawValid && refQty > 0 && refUnit ? rawTotal / (refQty * num(refUnit.to_base_factor)) : null;

  const packView = data.packs.map(p => {
    const lines = pkgLines(form, p.product_id).map(x => {
      const m = matById.get(String(x.raw_material_id));
      const q = parseNum(x.qty);
      const per = parseNum(x.per_units);
      return { x, m, cost: m && q >= 1 && per >= 1 ? (q * num(m.purchase_rate)) / per : null };
    });
    const filled = lines.filter(l => !isBlankPkg(l.x));
    const packaging = filled.length && filled.every(l => l.cost !== null) ? filled.reduce((s, l) => s + l.cost, 0) : null;
    const contents = rawPerBase !== null && refUnit && refUnit.base_type === p.vol_uom_base_type
      ? rawPerBase * num(p.volume) * num(p.vol_uom_factor) : null;
    return { p, lines, filled, packaging, contents, total: contents !== null && packaging !== null ? contents + packaging : null };
  });
  const packsWithLines = packView.filter(v => v.filled.length).length;
  const noRawLines = form.materials.every(isBlank);

  // ── Edits ──
  const setRef = (patch) => setForm(f => ({ ...f, ...patch }));
  const setMaterial = (key, patch) => setForm(f => ({ ...f, materials: f.materials.map(x => (x.key === key ? { ...x, ...patch } : x)) }));
  const addMaterial = () => {
    const next = newLine();
    focusAfter.current = `fm-${next.key}-mat`;
    setForm(f => ({ ...f, materials: [...f.materials, next] }));
  };
  const removeMaterial = (i) => {
    const list = form.materials;
    const neighbour = list[i - 1] || list[i + 1];
    if (neighbour) focusAfter.current = `fm-${neighbour.key}-mat`;
    setForm(f => ({ ...f, materials: f.materials.filter((_, j) => j !== i) }));
  };
  const setPkg = (pid, fn) => setForm(f => ({ ...f, packs: { ...f.packs, [String(pid)]: fn(f.packs[String(pid)] || []) } }));
  const setPkgLine = (pid, key, patch) => setPkg(pid, rows => rows.map(x => (x.key === key ? { ...x, ...patch } : x)));
  const addPkgLine = (pid) => {
    const next = newPkgLine();
    focusAfter.current = `fp-${next.key}-mat`;
    setPkg(pid, rows => [...rows, next]);
  };
  const removePkgLine = (pid, i) => {
    const list = pkgLines(form, pid);
    const neighbour = list[i - 1] || list[i + 1];
    focusAfter.current = neighbour ? `fp-${neighbour.key}-mat` : `fpadd-${pid}`;
    setPkg(pid, rows => rows.filter((_, j) => j !== i));
  };
  const copyPackaging = (fromPid, toPid) => {
    const source = pkgLines(form, fromPid).filter(x => !isBlankPkg(x));
    setPkg(toPid, () => source.map(x => ({ ...x, key: uid(), check: null })));
    focusAfter.current = `fpadd-${toPid}`;
  };

  // ── Actions ──
  function jump(it) {
    setAttempted(true);
    const el = document.getElementById(it.anchor);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.focus?.({ preventScroll: true }), 250);
  }

  function cancel() {
    if (dirty) guard.confirmLeave(backTo); else guard.leave(backTo);
  }

  async function reload() {
    try {
      const [f, m] = await Promise.all([api.get(`/manufacturing/products/${productId}/formula`), api.get('/raw-materials')]);
      setData(f.data);
      setRefs(r => ({ ...r, materials: m.data }));
      const next = toForm(f.data);
      setForm(next);
      setSaved(signature(next));
      setConflict(null); setPrefill(null); setAttempted(false); setTouched({});
    } catch (err) {
      toast.error(mfgError(err, 'The formula could not be reloaded. Try again.'));
    }
  }

  async function save() {
    setAttempted(true);
    if (issues.length) { jump(issues[0]); return; }
    setSaving(true);
    try {
      await api.put(`/manufacturing/products/${productId}/formula`, {
        expected_updated_at: data.updated_at,
        formula: {
          ref_qty: form.ref_qty,
          ref_uom_id: form.ref_uom_id,
          materials: form.materials.filter(x => !isBlank(x)).map(x => ({ raw_material_id: x.raw_material_id, qty: x.qty })),
        },
        packs: data.packs.map(p => ({
          product_id: p.product_id,
          packaging: pkgLines(form, p.product_id).filter(x => !isBlankPkg(x))
            .map(x => ({ raw_material_id: x.raw_material_id, qty: x.qty, per_units: x.per_units })),
        })),
      });
      toast.success(`${data.product_name} formula saved.`);
      guard.leave(backTo);
    } catch (err) {
      const body = err?.response?.data;
      if (err?.response?.status === 409 && body?.code === 'FORMULA_CHANGED') {
        setConflict({ by: body.updated_by_name, byId: body.updated_by_id, at: body.updated_at });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.error(body?.message || 'The formula could not be saved. Try again.');
      }
      setSaving(false);
    }
  }

  // ── Render ──
  const refError = shown('f-ref-qty') || shown('f-ref-unit');
  const lastMaterial = form.materials.length - 1;

  return (
    <Layout title="Manufactured Products">
      <HrStyles />
      <MfgStyles />
      <div className="mfg-page">
        <MfgPageHead
          sticky
          crumbs={crumbs}
          title={data.product_name}
          meta={(
            <>
              {namesake && <span className="mfg-record-product">{data.category_name || 'No category'}</span>}
              <FormulaStatus state={formulaState(data)} />
            </>
          )}
          actions={headActions}
        />
        {conflict && (
          <Notice tone="danger">
            <span className="mfg-notice-line">
              <span>
                {user?.id && conflict.byId === user.id
                  ? `You saved this formula in another window ${whenText(conflict.at)}. Reload to see that version.`
                  : `${conflict.by || 'Another user'} changed this formula ${whenText(conflict.at)}. Reload to see their version.`}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={reload}>Reload</button>
            </span>
          </Notice>
        )}
        <div className="mfg-record">
          <div className="mfg-record-main">
            {prefill && (prefill.failed ? (
              <Notice tone="warning">The batch could not be loaded, so nothing was filled in. The saved formula is shown.</Notice>
            ) : (
              <Notice tone="info">
                {`Filled from batch ${prefill.batchCode}. Review the quantities, then save.${prefill.replaces ? ' Saving replaces the current formula.' : ''}`}
              </Notice>
            ))}

            {/* (1) Raw materials, for a reference output */}
            <section className="mfg-sec" aria-label="Raw materials">
              {/* No head figure: the table's foot shows the total. */}
              <Panel title="Raw materials">
                <div className="mfg-ref-row">
                  <label className="mfg-ref-label" htmlFor="f-ref-qty">Quantities for</label>
                  <div className="mfg-ref-qty">
                    <NumberField id="f-ref-qty" ariaLabel="Quantities for, output quantity" value={form.ref_qty}
                      integer={refUnit?.base_type === 'count'} invalid={!!shown('f-ref-qty')}
                      describedBy={refError ? 'f-ref-error' : undefined}
                      onChange={v => setRef({ ref_qty: v })} onBlur={() => touch('f-ref-qty')} />
                  </div>
                  <div className="mfg-ref-unit">
                    <Picker id="f-ref-unit" ariaLabel="Quantities for, output unit" value={form.ref_uom_id} placeholder="Unit"
                      options={unitOptions} invalid={!!shown('f-ref-unit')}
                      onChange={v => { setRef({ ref_uom_id: v }); touch('f-ref-unit'); }} />
                  </div>
                  <Info title="Scaling to a batch">
                    New batches scale these quantities to their total output. 250 L gets 2.5× the quantities for 100 L.
                  </Info>
                  {refError && (
                    <div className="hr-error" id="f-ref-error" role="alert">
                      <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{refError}</span>
                    </div>
                  )}
                </div>

                <div className="hr-lines mfg-lines mfg-formula-lines">
                  <div className="hr-lines-head">
                    <span>Material</span>
                    <span className="mfg-lines-head-num is-field">Quantity</span>
                    <span>Unit</span>
                    <span className="mfg-lines-head-num">Rate (PKR)<AverageRateInfo /></span>
                    <span className="mfg-lines-head-num">Amount (PKR)</span>
                    <span />
                  </div>
                  {materialRows.map(({ x, m, amount }, i) => {
                    const error = lineError(`fm-${x.key}`);
                    const errorId = `fm-${x.key}-error`;
                    const used = new Set(form.materials.filter(o => o.key !== x.key).map(o => String(o.raw_material_id)));
                    return (
                      <div key={x.key} className="hr-line">
                        <div className="hr-line-cell" title={m?.name}>
                          <Picker id={`fm-${x.key}-mat`} searchable ariaLabel={`Raw material, line ${i + 1}`} value={x.raw_material_id}
                            placeholder="Select raw material" searchPlaceholder="Search raw materials"
                            invalid={!!shown(`fm-${x.key}-mat`)}
                            options={rawMaterials.map(o => ({
                              value: o.id, label: o.name, hint: `${fmtQty(o.stock_qty, o.uom_symbol)} in stock`,
                              disabled: used.has(String(o.id)), disabledReason: 'Already in this list',
                            }))}
                            onChange={v => { setMaterial(x.key, { raw_material_id: v }); touch(`fm-${x.key}-mat`); }} />
                        </div>
                        <div className="hr-line-cell">
                          <NumberField id={`fm-${x.key}-qty`} ariaLabel={`Quantity, line ${i + 1}`} value={x.qty}
                            integer={m?.base_type === 'count'} invalid={!!shown(`fm-${x.key}-qty`)}
                            describedBy={error ? errorId : undefined}
                            onChange={v => setMaterial(x.key, { qty: v })} onBlur={() => touch(`fm-${x.key}-qty`)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && i === lastMaterial) { e.preventDefault(); addMaterial(); } }} />
                        </div>
                        <div className="hr-line-cell mfg-cell is-muted">{m ? m.uom_symbol : EMPTY}</div>
                        <div className="hr-line-cell mfg-cell is-num">{m ? <Rate value={m.purchase_rate} /> : EMPTY}</div>
                        <div className="hr-line-cell mfg-cell is-num">{amount !== null ? fmtAmount(amount) : EMPTY}</div>
                        <RemoveLine label={`Remove raw material, line ${i + 1}`} disabled={form.materials.length === 1} onClick={() => removeMaterial(i)} />
                        <RowError id={errorId} message={error} />
                      </div>
                    );
                  })}
                  <div className="hr-lines-foot">
                    <AddButton onClick={addMaterial} title="You can also press Enter in the last quantity.">Add raw material</AddButton>
                    <span className="mfg-lines-total">Total<strong>{rawTotal > 0 ? `PKR ${fmtAmount(rawTotal)}` : EMPTY}</strong></span>
                  </div>
                </div>
              </Panel>
            </section>

            {/* (2) Packaging, one block per pack size */}
            <section className="mfg-sec" aria-label="Packaging">
              <Panel title="Packaging" status={`Set for ${packsWithLines} of ${plural(data.packs.length, 'pack size', 'pack sizes')}`}>
                <div className="hr-lines mfg-lines mfg-formula-lines">
                  <div className="hr-lines-head">
                    <span>Material</span>
                    <span className="mfg-lines-head-num is-field">Quantity</span>
                    <span className="mfg-lines-head-num is-field">For every</span>
                    <span className="mfg-lines-head-num">Rate (PKR)<AverageRateInfo /></span>
                    <span className="mfg-lines-head-num">Cost per unit</span>
                    <span />
                  </div>
                  {packView.map(({ p, lines, packaging }) => {
                    const sources = packView.filter(o => o.p.product_id !== p.product_id && o.filled.length);
                    const last = lines.length - 1;
                    const copy = sources.length === 0 ? null : data.packs.length < 3 ? (
                      <button type="button" className="mfg-text-btn" onClick={() => copyPackaging(sources[0].p.product_id, p.product_id)}>
                        {`Copy from ${sources[0].p.pack_size}`}
                      </button>
                    ) : (
                      <KebabMenu
                        label={`Copy packaging to ${p.pack_size}`}
                        trigger={{ label: 'Copy from', className: 'mfg-text-btn' }}
                        items={sources.map(o => ({ label: o.p.pack_size, onClick: () => copyPackaging(o.p.product_id, p.product_id) }))}
                      />
                    );
                    return (
                      <div key={p.product_id} className="mfg-fpack" role="group" aria-label={`Packaging for ${p.pack_size}`}>
                        <div className="mfg-fpack-head">
                          <span className="mfg-fpack-size">{p.pack_size}</span>
                          {p.pack_type && <span className="mfg-fpack-type">{p.pack_type}</span>}
                          {packaging !== null && <span className="mfg-fpack-cost">PKR <Rate value={packaging} /> per unit</span>}
                        </div>
                        {lines.length === 0 ? (
                          <div className="mfg-fpack-empty">
                            <span>{`No packaging for ${p.pack_size} yet.`}</span>
                            <span className="mfg-fpack-actions">
                              {copy}
                              <AddButton id={`fpadd-${p.product_id}`} onClick={() => addPkgLine(p.product_id)}>Add packaging</AddButton>
                            </span>
                          </div>
                        ) : (
                          <>
                            {lines.map(({ x, m, cost }, i) => {
                              const error = lineError(`fp-${x.key}`);
                              const errorId = `fp-${x.key}-error`;
                              const used = new Set(lines.filter(o => o.x.key !== x.key).map(o => String(o.x.raw_material_id)));
                              const enterAdds = (e) => { if (e.key === 'Enter' && i === last) { e.preventDefault(); addPkgLine(p.product_id); } };
                              const label = `${p.pack_size}, line ${i + 1}`;
                              return (
                                <div key={x.key} className="hr-line">
                                  <div className="hr-line-cell" title={m?.name}>
                                    <Picker id={`fp-${x.key}-mat`} searchable ariaLabel={`Packaging material for ${label}`} value={x.raw_material_id}
                                      placeholder="Select packaging" searchPlaceholder="Search packaging"
                                      invalid={!!shown(`fp-${x.key}-mat`)}
                                      options={packagingMaterials.map(o => ({
                                        value: o.id, label: o.name, hint: `${fmtQty(o.stock_qty, 'pcs')} in stock`,
                                        disabled: used.has(String(o.id)), disabledReason: 'Already in this list',
                                      }))}
                                      onChange={v => { setPkgLine(p.product_id, x.key, { raw_material_id: v }); touch(`fp-${x.key}-mat`); }} />
                                  </div>
                                  <div className="hr-line-cell">
                                    <NumberField id={`fp-${x.key}-qty`} ariaLabel={`Quantity for ${label}`} value={x.qty} integer suffix="pcs"
                                      invalid={!!shown(`fp-${x.key}-qty`)} describedBy={error || x.check ? errorId : undefined}
                                      onChange={v => setPkgLine(p.product_id, x.key, { qty: v, check: null })}
                                      onBlur={() => touch(`fp-${x.key}-qty`)} onKeyDown={enterAdds} />
                                  </div>
                                  <div className="hr-line-cell">
                                    <NumberField id={`fp-${x.key}-per`} ariaLabel={`For every, units, ${label}`} value={x.per_units} integer
                                      suffix={parseNum(x.per_units) === 1 ? 'unit' : 'units'}
                                      invalid={!!shown(`fp-${x.key}-per`)} describedBy={error ? errorId : undefined}
                                      onChange={v => setPkgLine(p.product_id, x.key, { per_units: v, check: null })}
                                      onBlur={() => touch(`fp-${x.key}-per`)} onKeyDown={enterAdds} />
                                  </div>
                                  <div className="hr-line-cell mfg-cell is-num">{m ? <Rate value={m.purchase_rate} /> : EMPTY}</div>
                                  <div className="hr-line-cell mfg-cell is-num">{cost !== null ? <Rate value={cost} /> : EMPTY}</div>
                                  <RemoveLine label={`Remove packaging, ${label}`} onClick={() => removePkgLine(p.product_id, i)} />
                                  {error
                                    ? <RowError id={errorId} message={error} />
                                    : x.check && <div className="mfg-line-error" id={errorId}><WarnText>{x.check}</WarnText></div>}
                                </div>
                              );
                            })}
                            <div className="mfg-fpack-foot">
                              <AddButton id={`fpadd-${p.product_id}`} onClick={() => addPkgLine(p.product_id)} title="You can also press Enter in the last quantity.">Add packaging</AddButton>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </section>
          </div>

          {/* Side: estimated cost of one unit of each pack size */}
          <div className="mfg-record-side">
            <aside className="mfg-summary" aria-label="Cost per unit">
              <div className="mfg-summary-title">Cost per unit</div>
              {packView.map(({ p, filled, contents, packaging, total }) => (
                <div key={p.product_id} className="mfg-fcost">
                  <div className="mfg-fcost-pack">
                    <span>{p.pack_size}</span>
                    {p.pack_type && <span className="mfg-sub">{p.pack_type}</span>}
                  </div>
                  {/* A part with no lines reads "Not set" (why the total is missing);
                      "—" stays for lines still being filled in. */}
                  <div className="mfg-summary-line"><span>Contents</span>
                    <span>{contents !== null ? <Rate value={contents} pkr /> : noRawLines ? NOT_SET : EMPTY}</span></div>
                  <div className="mfg-summary-line"><span>Packaging</span>
                    <span>{packaging !== null ? <Rate value={packaging} pkr /> : filled.length === 0 ? NOT_SET : EMPTY}</span></div>
                  <div className="mfg-summary-line mfg-fcost-total"><span>Total</span><span>{total !== null ? <Rate value={total} pkr /> : EMPTY}</span></div>
                </div>
              ))}
              <div className="mfg-fcost-meta">
                {data.updated_at ? `Updated ${fmtStamp(data.updated_at)} by ${data.updated_by_name || 'an unknown user'}` : 'Not saved yet'}
              </div>
            </aside>
          </div>
        </div>
      </div>
      {guard.dialog}
    </Layout>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { todayPKT } from '../../utils/dateUtils';
import DateInput from '../../components/common/DateInput';
import {
  HrStyles, Tabs, Segmented, KebabMenu, FormField, Notice, BusyButton, FieldGrid, Field,
  useSort, sortRows, fmtAmount, fmtMoney, fmtDate, num,
} from '../hr/HrKit';
import {
  MfgStyles, MfgField, Picker, NumberField, RemoveLine, AddButton, NameWithTag, EMPTY, BatchStatus, UOM_CATEGORIES,
  parseNum, cleanText, fmtQty, fmtRate, Rate, landedRates, round2, plural, StockQty, SortHead,
  AverageRateInfo, AVERAGE_RATE_TITLE, averageRateText,
} from './mfgKit';

// ─── Raw & packaging materials ─────────────────────────────────────────────
// A material's rate (raw_materials.cost_per_unit, API name purchase_rate) is
// its WEIGHTED AVERAGE: each purchase line moves it by quantity,
//   (stock before × rate + qty × landed rate) ÷ (stock before + qty),
// counting other charges in the landed rate. Using stock in a batch does not
// change it; a batch freezes the rate when it takes the stock. The rate is
// typed by hand only until the material's first purchase; a new purchase line
// starts from the last purchase's invoice rate (before charges).
// Packaging is always counted in pcs. Count units (dozen = 12 pcs) take whole
// quantities only. Purchases are one document with many lines; other charges
// are shared over the lines by value and are not owed to the supplier.
// Server rules (authoritative): server/routes/rawMaterials.js.

const TYPE_LABEL = { raw_material: 'Raw material', packaging_material: 'Packaging' };
const TYPE_OPTIONS = [
  { value: 'raw_material', label: 'Raw material' },
  { value: 'packaging_material', label: 'Packaging material' },
];
const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const isCount = (m) => m?.base_type === 'count';
const stockValue = (m) => (num(m.stock_qty) > 0 ? num(m.stock_qty) * num(m.purchase_rate) : null);

// Sorting (blank values last, ties in the default order).
const MATERIAL_SORT = {
  name: { value: m => m.name, text: true },
  type: { value: m => TYPE_LABEL[m.material_type], text: true },
  unit: { value: m => m.uom_symbol, text: true },
  stock: { value: m => num(m.stock_qty) },
  rate: { value: m => num(m.purchase_rate) },
  value: { value: stockValue },
};
const materialOrder = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
const PURCHASE_SORT = {
  purchase_no: { value: p => p.purchase_no, text: true },
  date: { value: p => p.date },
  supplier: { value: p => p.supplier_name, text: true },
  invoice: { value: p => p.invoice_no, text: true },
  lines: { value: p => num(p.line_count) },
  items: { value: p => num(p.items_total) },
  charges: { value: p => (num(p.other_charges) > 0 ? num(p.other_charges) : null) },
  total: { value: p => num(p.items_total) + num(p.other_charges) },
};
const purchaseOrder = (a, b) => String(b.date).localeCompare(String(a.date))
  || String(b.purchase_no).localeCompare(String(a.purchase_no), undefined, { numeric: true });

export default function RawMaterials() {
  const [tab, setTab] = useState('materials');
  const [materials, setMaterials] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const materialSort = useSort('name');
  const purchaseSort = useSort('date', 'desc');

  const [materialDialog, setMaterialDialog] = useState(null);   // { record }
  const [detail, setDetail] = useState(null);
  const [uomOpen, setUomOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseView, setPurchaseView] = useState(null);
  const [deleteMaterial, setDeleteMaterial] = useState(null);
  const [deletePurchase, setDeletePurchase] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => Promise.all([
    api.get('/raw-materials'),
    api.get('/raw-materials/purchases'),
    api.get('/raw-materials/uom'),
    api.get('/suppliers', { params: { type: 'raw_material' } }),
  ]).then(([m, p, u, s]) => {
    setMaterials(m.data); setPurchases(p.data); setUoms(u.data); setSuppliers(s.data);
  }).catch(err => toast.error(err?.response?.data?.message || 'The materials could not be loaded. Refresh the page.'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    all: materials.length,
    raw_material: materials.filter(m => m.material_type === 'raw_material').length,
    packaging_material: materials.filter(m => m.material_type === 'packaging_material').length,
  }), [materials]);

  const q = search.trim().toLowerCase();
  const shownMaterials = sortRows(materials.filter(m => (typeFilter === 'all' || m.material_type === typeFilter)
    && (!q || m.name.toLowerCase().includes(q))), materialSort.sortConfig, MATERIAL_SORT, materialOrder);
  const shownPurchases = sortRows(purchases.filter(p => !q
    || p.purchase_no.toLowerCase().includes(q) || p.supplier_name.toLowerCase().includes(q)
    || (p.invoice_no || '').toLowerCase().includes(q) || p.lines.some(l => l.rm_name.toLowerCase().includes(q))),
  purchaseSort.sortConfig, PURCHASE_SORT, purchaseOrder);

  const removeMaterial = async () => {
    setDeleting(true);
    try {
      await api.delete(`/raw-materials/${deleteMaterial.id}`);
      toast.success(`${deleteMaterial.name} deleted.`);
      setDeleteMaterial(null); load();
    } catch (err) {
      setDeleteMaterial(null);
      toast.error(err?.response?.data?.message || 'The material could not be deleted. Try again.');
      load();
    } finally { setDeleting(false); }
  };

  const removePurchase = async () => {
    setDeleting(true);
    try {
      await api.delete(`/raw-materials/purchases/${deletePurchase.id}`);
      toast.success(`Purchase ${deletePurchase.purchase_no} deleted.`);
      setDeletePurchase(null); load();
    } catch (err) {
      setDeletePurchase(null);
      toast.error(err?.response?.data?.message || 'The purchase could not be deleted. Try again.');
    } finally { setDeleting(false); }
  };

  // One small icon and one sentence.
  const materialEmpty = q
    ? { icon: 'search_off', title: `No material matches "${search.trim()}".` }
    : { icon: 'science', title: 'No materials yet.' };
  const purchaseEmpty = q
    ? { icon: 'search_off', title: `No purchase matches "${search.trim()}".` }
    : { icon: 'receipt_long', title: 'No purchases recorded yet.' };

  return (
    <Layout title="Raw Materials">
      <HrStyles />
      <MfgStyles />
      <div className="card">
        <div className="mfg-card-head">
          <Tabs
            ariaLabel="Raw material lists"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'materials', label: `Materials (${materials.length})` },
              { value: 'purchases', label: `Purchases (${purchases.length})` },
            ]}
          />
          <div className="mfg-head-actions">
            {tab === 'materials' && (
              <Segmented
                ariaLabel="Filter by type"
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { val: 'all', label: 'All', count: counts.all },
                  { val: 'raw_material', label: 'Raw', count: counts.raw_material },
                  { val: 'packaging_material', label: 'Packaging', count: counts.packaging_material },
                ]}
              />
            )}
            <div className="search-bar">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                placeholder={tab === 'materials' ? 'Search materials' : 'Search purchases'}
                aria-label={tab === 'materials' ? 'Search materials' : 'Search purchases'}
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 180 }}
              />
            </div>
            {tab === 'materials' ? (
              <>
                <button type="button" className="btn btn-outline" onClick={() => setUomOpen(true)}>
                  <span className="material-symbols-outlined" aria-hidden="true">straighten</span>
                  Units of measure
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setMaterialDialog({ record: null })}>
                  <span className="material-symbols-outlined" aria-hidden="true">add</span>
                  Add material
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setPurchaseOpen(true)}>
                <span className="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span>
                Record purchase
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : tab === 'materials' ? (
          shownMaterials.length === 0 ? <EmptyList state={materialEmpty} /> : (
            <div className="hr-page-scroll">
              <table className="hr-table hr-page-table">
                <thead>
                  <tr>
                    <SortHead sort={materialSort} column="name" label="Material" />
                    <SortHead sort={materialSort} column="type" label="Type" style={{ width: '13%' }} />
                    <SortHead sort={materialSort} column="unit" label="Unit" style={{ width: '8%' }} />
                    <SortHead sort={materialSort} column="stock" label="In stock" num style={{ width: '13%' }} />
                    <SortHead sort={materialSort} column="rate" label="Rate (PKR)" num style={{ width: '15%' }} info={<AverageRateInfo />} />
                    <SortHead sort={materialSort} column="value" label="Stock value (PKR)" num style={{ width: '16%' }} />
                    <th style={{ width: 56 }}><span className="hr-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shownMaterials.map(m => (
                    <tr
                      key={m.id}
                      className="hr-row-click"
                      tabIndex={0}
                      onClick={() => setDetail(m)}
                      onKeyDown={e => { if (e.key === 'Enter') setDetail(m); }}
                    >
                      <td className="hr-cell-strong">{m.name}</td>
                      <td className="mfg-sub">{TYPE_LABEL[m.material_type]}</td>
                      <td>{m.uom_symbol || EMPTY}</td>
                      <td className="hr-num"><StockQty value={m.stock_qty} /></td>
                      <td className="hr-num"><Rate value={m.purchase_rate} /></td>
                      <td className="hr-num">{stockValue(m) !== null ? fmtAmount(stockValue(m)) : EMPTY}</td>
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu
                          label={`Actions for ${m.name}`}
                          items={[
                            { label: 'View details', icon: 'visibility', onClick: () => setDetail(m) },
                            { label: 'Edit', icon: 'edit', onClick: () => setMaterialDialog({ record: m }) },
                            { divider: true },
                            {
                              label: 'Delete', icon: 'delete', danger: true,
                              disabled: m.in_use, title: m.in_use ? m.usage : undefined,
                              onClick: () => setDeleteMaterial(m),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          shownPurchases.length === 0 ? <EmptyList state={purchaseEmpty} /> : (
            <div className="hr-page-scroll">
              <table className="hr-table hr-page-table">
                <thead>
                  <tr>
                    <SortHead sort={purchaseSort} column="purchase_no" label="Purchase no." style={{ width: '12%' }} />
                    <SortHead sort={purchaseSort} column="date" label="Date" date style={{ width: '10%' }} />
                    <SortHead sort={purchaseSort} column="supplier" label="Supplier" />
                    <SortHead sort={purchaseSort} column="invoice" label="Invoice no." style={{ width: '11%' }} />
                    <SortHead sort={purchaseSort} column="lines" label="Lines" num style={{ width: '7%' }} />
                    <SortHead sort={purchaseSort} column="items" label="Items (PKR)" num style={{ width: '11%' }} />
                    <SortHead sort={purchaseSort} column="charges" label="Charges (PKR)" title="Other charges (PKR)" num style={{ width: '12%' }} />
                    <SortHead sort={purchaseSort} column="total" label="Total (PKR)" title="Total cost (PKR)" num style={{ width: '11%' }} />
                    <th style={{ width: 56 }}><span className="hr-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shownPurchases.map(p => (
                    <tr
                      key={p.id}
                      className="hr-row-click"
                      tabIndex={0}
                      onClick={() => setPurchaseView(p)}
                      onKeyDown={e => { if (e.key === 'Enter') setPurchaseView(p); }}
                    >
                      <td className="mfg-code">{p.purchase_no}</td>
                      <td style={tabular}>{fmtDate(p.date)}</td>
                      <td className="hr-cell-strong">{p.supplier_name}</td>
                      <td style={tabular}>{p.invoice_no || EMPTY}</td>
                      <td className="hr-num">{p.line_count}</td>
                      <td className="hr-num">{fmtAmount(p.items_total)}</td>
                      <td className="hr-num">{num(p.other_charges) > 0 ? fmtAmount(p.other_charges) : EMPTY}</td>
                      <td className="hr-num hr-cell-total">{fmtAmount(num(p.items_total) + num(p.other_charges))}</td>
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu
                          label={`Actions for purchase ${p.purchase_no}`}
                          items={[
                            { label: 'View purchase', icon: 'visibility', onClick: () => setPurchaseView(p) },
                            { divider: true },
                            { label: 'Delete', icon: 'delete', danger: true, onClick: () => setDeletePurchase(p) },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <MaterialDialog
        state={materialDialog}
        uoms={uoms}
        materials={materials}
        onClose={() => setMaterialDialog(null)}
        onSaved={() => { setMaterialDialog(null); load(); }}
      />
      <MaterialDetail material={detail} onClose={() => setDetail(null)} />
      <UomDialog isOpen={uomOpen} onClose={() => setUomOpen(false)} uoms={uoms} onChanged={load} />
      <PurchaseDialog
        isOpen={purchaseOpen}
        materials={materials}
        suppliers={suppliers}
        onClose={() => setPurchaseOpen(false)}
        onSaved={() => { setPurchaseOpen(false); setTab('purchases'); load(); }}
      />
      <PurchaseView purchase={purchaseView} onClose={() => setPurchaseView(null)} />

      <ConfirmModal
        isOpen={!!deleteMaterial}
        onClose={() => setDeleteMaterial(null)}
        onConfirm={removeMaterial}
        loading={deleting}
        title={`Delete ${deleteMaterial?.name}?`}
        message="The material will be removed permanently."
      />
      <ConfirmModal
        isOpen={!!deletePurchase}
        onClose={() => setDeletePurchase(null)}
        onConfirm={removePurchase}
        loading={deleting}
        title={`Delete purchase ${deletePurchase?.purchase_no}?`}
        message={deletePurchase
          ? `Its quantities leave stock and ${fmtMoney(deletePurchase.items_total)} is removed from the balance of ${deletePurchase.supplier_name}.`
          : ''}
      />
    </Layout>
  );
}

function EmptyList({ state }) {
  return (
    <div className="hr-empty">
      <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{state.icon}</span></div>
      <div className="hr-empty-title">{state.title}</div>
    </div>
  );
}

// ── Add / edit material ────────────────────────────────────────────────────
const MATERIAL_FIELDS = ['name', 'material_type', 'uom_id', 'purchase_rate'];

function MaterialDialog({ state, uoms, materials, onClose, onSaved }) {
  const record = state?.record || null;
  const [form, setForm] = useState({ name: '', material_type: 'raw_material', uom_id: '', purchase_rate: '' });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    setForm(record
      ? { name: record.name, material_type: record.material_type, uom_id: record.uom_id ?? '', purchase_rate: String(num(record.purchase_rate)) }
      : { name: '', material_type: 'raw_material', uom_id: '', purchase_rate: '' });
    setTouched({}); setServerErrors({});
  }, [state, record]);

  const pcs = uoms.find(u => u.symbol === 'pcs');
  const isPackaging = form.material_type === 'packaging_material';
  const unit = isPackaging ? pcs : uoms.find(u => String(u.id) === String(form.uom_id));
  const locked = !!record?.in_use;
  // Once bought, the rate is the average of the purchases: shown, not typed.
  const rateLocked = num(record?.purchase_count) > 0;

  const errors = {};
  const name = cleanText(form.name);
  if (!name) errors.name = 'Enter the material name.';
  else {
    const dup = materials.find(m => m.id !== record?.id && m.name.toLowerCase() === name.toLowerCase());
    if (dup) errors.name = `${dup.name} already exists.`;
  }
  if (!isPackaging && !form.uom_id) errors.uom_id = 'Choose the unit.';
  if (!rateLocked && !(parseNum(form.purchase_rate) > 0)) errors.purchase_rate = 'Enter a purchase rate greater than 0.';
  const firstError = MATERIAL_FIELDS.map(k => errors[k]).find(Boolean);
  const isChanged = !record
    || name !== record.name || form.material_type !== record.material_type
    || (!isPackaging && String(form.uom_id) !== String(record.uom_id))
    || (!rateLocked && parseNum(form.purchase_rate) !== num(record.purchase_rate));
  const blockedReason = record && !isChanged ? 'No changes yet' : firstError || null;
  const errorFor = (k) => serverErrors[k] || (touched[k] ? errors[k] : null);
  const setField = (k, v) => { setForm(p => ({ ...p, [k]: v })); setServerErrors(p => ({ ...p, [k]: undefined })); };

  const save = async () => {
    setTouched(Object.fromEntries(MATERIAL_FIELDS.map(k => [k, true])));
    if (blockedReason) return;
    setSaving(true);
    const payload = { name, material_type: form.material_type, uom_id: isPackaging ? null : form.uom_id };
    if (!rateLocked) payload.purchase_rate = form.purchase_rate;
    try {
      if (record) await api.put(`/raw-materials/${record.id}`, payload);
      else await api.post('/raw-materials', payload);
      toast.success(record ? `${name} updated.` : `${name} added.`);
      onSaved();
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && MATERIAL_FIELDS.includes(body.field)) setServerErrors({ [body.field]: body.message });
      else toast.error(body?.message || 'The material could not be saved. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      isOpen={!!state}
      onClose={() => { if (!saving) onClose(); }}
      title={record ? 'Edit material' : 'Add material'}
      size="md"
      footer={
        <>
          {blockedReason && <span role="status" className="mfg-foot-status" style={{ marginRight: 'auto' }}>{blockedReason}</span>}
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <BusyButton busy={saving} busyLabel="Saving…" onClick={save} disabled={!!blockedReason}>
            {record ? 'Save changes' : 'Add material'}
          </BusyButton>
        </>
      }
    >
      {!!state && (
        <div className="hr-form-grid is-modal">
          <FormField label="Material name" htmlFor="rm-name" required col={12} error={errorFor('name')}>
            <input
              id="rm-name"
              className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
              placeholder="Enter the material name"
              value={form.name}
              maxLength={200}
              onChange={e => setField('name', e.target.value)}
              onBlur={() => setTouched(p => ({ ...p, name: true }))}
              autoFocus
            />
          </FormField>
          <FormField label="Type" htmlFor="rm-type" required col={6} error={errorFor('material_type')}
            help={locked ? 'Fixed once the material has purchases or batches.' : undefined}>
            <Picker id="rm-type" value={form.material_type} options={TYPE_OPTIONS} disabled={locked}
              onChange={v => setField('material_type', v)} />
          </FormField>
          <MfgField label="Unit" htmlFor="rm-uom" required className="hr-col-6" error={errorFor('uom_id')}
            info={isPackaging ? 'Packaging is always counted in pcs.' : undefined}
            help={!isPackaging && locked ? 'Fixed once the material has purchases or batches.' : undefined}>
            {isPackaging ? (
              <input id="rm-uom" className="form-control" value="pcs" disabled readOnly />
            ) : (
              <Picker
                id="rm-uom" value={form.uom_id} placeholder="Select unit" disabled={locked}
                invalid={!!errorFor('uom_id')}
                options={uoms.map(u => ({ value: u.id, label: u.symbol, hint: UOM_CATEGORIES.find(c => c.val === u.base_type)?.label }))}
                onChange={v => setField('uom_id', v)}
                onBlur={() => setTouched(p => ({ ...p, uom_id: true }))}
              />
            )}
          </MfgField>
          {rateLocked ? (
            <MfgField label="Purchase rate" className="hr-col-6" error={errorFor('purchase_rate')}
              info={averageRateText(record.uom_symbol)} infoTitle={AVERAGE_RATE_TITLE}>
              <div className="mfg-static-value">
                <span>{`PKR ${fmtRate(record.purchase_rate)} / ${record.uom_symbol}`}</span>
                <span className="mfg-sub">· average of purchases</span>
              </div>
            </MfgField>
          ) : (
            <MfgField
              label="Purchase rate (PKR)" htmlFor="rm-rate" required className="hr-col-6" error={errorFor('purchase_rate')}
              info="Used to cost batches until the first purchase."
            >
              <NumberField
                id="rm-rate" value={form.purchase_rate}
                suffix={unit ? `/ ${unit.symbol}` : undefined}
                invalid={!!errorFor('purchase_rate')}
                onChange={v => setField('purchase_rate', v)}
                onBlur={() => setTouched(p => ({ ...p, purchase_rate: true }))}
              />
            </MfgField>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Material detail ────────────────────────────────────────────────────────
function MaterialDetail({ material, onClose }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!material) { setData(null); return; }
    let live = true;
    Promise.all([
      api.get(`/raw-materials/${material.id}/purchases`),
      api.get(`/raw-materials/${material.id}/usage-history`),
    ]).then(([p, u]) => { if (live) setData({ purchases: p.data, usage: u.data }); })
      .catch(err => {
        if (live) {
          setData({ purchases: [], usage: [] });
          toast.error(err?.response?.data?.message || 'The history could not be loaded. Try again.');
        }
      });
    return () => { live = false; };
  }, [material]);

  const unit = material?.uom_symbol || '';
  return (
    <Modal isOpen={!!material} onClose={onClose} title={material?.name || ''} size="lg">
      {material && (
        <>
          <FieldGrid cols={4}>
            <Field label="Type" value={TYPE_LABEL[material.material_type]} />
            <Field label="In stock" value={<StockQty value={material.stock_qty} unit={unit} />} />
            <Field
              label={num(material.purchase_count) > 0 ? <>Average rate <AverageRateInfo unit={unit} /></> : 'Purchase rate'}
              value={<><Rate value={material.purchase_rate} pkr /> / {unit}</>}
            />
            <Field label="Stock value" value={stockValue(material) !== null ? fmtMoney(stockValue(material)) : EMPTY} />
          </FieldGrid>

          {!data ? <div className="loading-center" style={{ minHeight: 160 }}><div className="spinner" /></div> : (
            <>
              <div className="mfg-section">
                <div className="mfg-section-head">
                  <h3 className="mfg-section-title">Purchases</h3>
                  <span className="mfg-section-note">{plural(data.purchases.length, 'purchase', 'purchases')}</span>
                </div>
                {data.purchases.length === 0 ? <div className="hr-lines-empty">No purchases recorded</div> : (
                  <div className="mfg-doc-table">
                    <table className="hr-table is-dense">
                      <thead><tr>
                        <th style={{ width: '14%' }}>Date</th><th style={{ width: '16%' }}>Purchase no.</th><th>Supplier</th>
                        <th className="hr-th-num" style={{ width: '15%' }}>Quantity</th>
                        <th className="hr-th-num" style={{ width: '13%' }}>Rate</th>
                        <th className="hr-th-num" style={{ width: '14%' }}>Landed rate</th>
                      </tr></thead>
                      <tbody>
                        {data.purchases.map(p => (
                          <tr key={p.purchase_id}>
                            <td style={tabular}>{fmtDate(p.date)}</td>
                            <td className="mfg-code">{p.purchase_no}</td>
                            <td>{p.supplier_name}</td>
                            <td className="hr-num">{fmtQty(p.qty, unit)}</td>
                            <td className="hr-num">{<Rate value={p.rate} />}</td>
                            <td className="hr-num hr-cell-strong">{<Rate value={p.landed_rate} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mfg-section">
                <div className="mfg-section-head">
                  <h3 className="mfg-section-title">Used in batches</h3>
                  <span className="mfg-section-note">{plural(data.usage.length, 'use', 'uses')}</span>
                </div>
                {data.usage.length === 0 ? <div className="hr-lines-empty">Not used in any batch</div> : (
                  <div className="mfg-doc-table">
                    <table className="hr-table is-dense">
                      <thead><tr>
                        <th style={{ width: '16%' }}>Batch</th><th style={{ width: '14%' }}>Date</th><th>Product</th>
                        <th className="hr-th-num" style={{ width: '15%' }}>Quantity</th><th style={{ width: '20%' }}>Status</th>
                      </tr></thead>
                      <tbody>
                        {data.usage.map((u, i) => (
                          <tr key={`${u.batch_id}-${i}`}>
                            <td className="mfg-code">{u.batch_code}</td>
                            <td style={tabular}>{fmtDate(u.batch_date)}</td>
                            <td><NameWithTag name={u.product_name} tag={u.pack_size} /></td>
                            <td className="hr-num">{fmtQty(u.qty, unit)}</td>
                            <td><BatchStatus status={u.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// ── Units of measure ───────────────────────────────────────────────────────
// One category at a time (Weight / Volume / Count); new units go into the
// selected category. Base units (g, ml, pcs) are fixed; a count unit is a
// whole number of pcs (dozen = 12); a unit's conversion
// is fixed while anything uses it.
function UomDialog({ isOpen, onClose, uoms, onChanged }) {
  const [category, setCategory] = useState('weight');
  const [symbol, setSymbol] = useState('');
  const [factor, setFactor] = useState('');
  const [addError, setAddError] = useState(null);
  const [addField, setAddField] = useState(null);   // 'symbol' | 'factor': the field the error is about
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);          // { id, symbol, factor, error }
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [rowNotice, setRowNotice] = useState(null);
  const [flashId, setFlashId] = useState(null);

  useEffect(() => {
    if (!isOpen) { setSymbol(''); setFactor(''); setAddError(null); setEdit(null); setConfirmId(null); setRowNotice(null); }
  }, [isOpen]);
  useEffect(() => {
    if (!flashId) return undefined;
    const t = setTimeout(() => setFlashId(null), 1900);
    return () => clearTimeout(t);
  }, [flashId]);

  const cat = UOM_CATEGORIES.find(c => c.val === category);
  const list = uoms.filter(u => u.base_type === category);
  const counts = Object.fromEntries(UOM_CATEGORIES.map(c => [c.val, uoms.filter(u => u.base_type === c.val).length]));
  const symbolTaken = (s, exceptId) => uoms.find(u => u.id !== exceptId && u.symbol.toLowerCase() === s.toLowerCase());

  const checkUnit = (s, f, exceptId) => {
    if (!s) return 'Enter a symbol.';
    if (/\s/.test(s)) return 'The symbol cannot contain spaces.';
    const dup = symbolTaken(s, exceptId);
    if (dup) return `${dup.symbol} already exists.`;
    if (!(parseNum(f) > 0)) return `Enter how many ${cat.base} make one ${s}.`;
    if (category === 'count' && !Number.isInteger(parseNum(f))) return 'Enter a whole number of pcs.';
    if (category === 'count' && parseNum(f) < 2) return `One ${s} must be at least 2 pcs.`;
    return null;
  };

  const add = async () => {
    const s = symbol.trim();
    const error = checkUnit(s, factor);
    if (error) { setAddError(error); setAddField(checkUnit(s, '2') ? 'symbol' : 'factor'); return; }
    setAdding(true); setAddError(null);
    try {
      const r = await api.post('/raw-materials/uom', { symbol: s, base_type: category, to_base_factor: factor });
      await onChanged();
      setFlashId(r.data.id);
      setSymbol(''); setFactor('');
      toast.success(`Unit ${s} added.`);
    } catch (err) {
      setAddError(err?.response?.data?.message || 'The unit could not be added. Try again.');
      setAddField(err?.response?.data?.field === 'to_base_factor' ? 'factor' : 'symbol');
    } finally { setAdding(false); }
  };

  const saveEdit = async () => {
    const s = edit.symbol.trim();
    const error = checkUnit(s, edit.factor, edit.id);
    if (error) { setEdit(p => ({ ...p, error })); return; }
    setSavingEdit(true);
    try {
      await api.put(`/raw-materials/uom/${edit.id}`, { symbol: s, to_base_factor: edit.factor });
      await onChanged();
      setFlashId(edit.id);
      setEdit(null);
      toast.success(`Unit ${s} saved.`);
    } catch (err) {
      setEdit(p => ({ ...p, error: err?.response?.data?.message || 'The unit could not be saved. Try again.' }));
    } finally { setSavingEdit(false); }
  };

  const remove = async (u) => {
    setDeletingId(u.id);
    try {
      await api.delete(`/raw-materials/uom/${u.id}`);
      await onChanged();
      setConfirmId(null);
      toast.success(`Unit ${u.symbol} deleted.`);
    } catch (err) {
      setConfirmId(null);
      setRowNotice({ id: u.id, message: err?.response?.data?.message || 'The unit could not be deleted. Try again.' });
    } finally { setDeletingId(null); }
  };

  const editKeys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(null); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Units of measure" size="sm">
      <div style={{ marginBottom: 16 }}>
        <Segmented
          ariaLabel="Unit category"
          value={category}
          onChange={(v) => { setCategory(v); setEdit(null); setConfirmId(null); setRowNotice(null); setAddError(null); }}
          options={UOM_CATEGORIES.map(c => ({ val: c.val, label: c.label, count: counts[c.val] }))}
        />
      </div>

      <div className="mfg-uom-add">
        <div>
          <label className="form-label" htmlFor="uom-symbol">Symbol</label>
          <input
            id="uom-symbol"
            className={`form-control${addError && addField === 'symbol' ? ' hr-invalid' : ''}`}
            value={symbol}
            maxLength={10}
            disabled={adding}
            onChange={e => { setSymbol(e.target.value); setAddError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="uom-factor">{`Equals (${cat.base})`}</label>
          <NumberField id="uom-factor" value={factor} suffix={cat.base} disabled={adding} integer={category === 'count'}
            invalid={!!addError && addField === 'factor'}
            onChange={v => { setFactor(v); setAddError(null); }} />
        </div>
        <BusyButton busy={adding} busyLabel="Adding…" icon="add" onClick={add}>Add</BusyButton>
      </div>
      <div className="hr-field-msg" style={{ marginBottom: 8 }}>
        {addError && (
          <div className="hr-error" role="alert">
            <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{addError}</span>
          </div>
        )}
      </div>

      <ul className="mfg-cat-list" aria-label={`${cat.label} units`}>
        {list.map(u => {
          const isEditing = edit?.id === u.id;
          return (
            <li key={u.id} className={`mfg-cat-row${flashId === u.id ? ' mfg-flash' : ''}`}>
              {isEditing ? (
                <div style={{ width: '100%' }}>
                  <div className="mfg-uom-edit">
                    <input
                      className="form-control" aria-label="Symbol" value={edit.symbol} maxLength={10} autoFocus disabled={savingEdit}
                      onChange={e => setEdit(p => ({ ...p, symbol: e.target.value, error: null }))} onKeyDown={editKeys}
                    />
                    <div onKeyDown={editKeys}>
                      <NumberField ariaLabel={`Equals (${cat.base})`} value={edit.factor} suffix={cat.base} disabled={savingEdit || u.in_use}
                        integer={category === 'count'}
                        onChange={v => setEdit(p => ({ ...p, factor: v, error: null }))} />
                    </div>
                    <BusyButton className="btn btn-primary btn-sm" busy={savingEdit} busyLabel="Saving…" onClick={saveEdit}>Save</BusyButton>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(null)} disabled={savingEdit}>Cancel</button>
                  </div>
                  {(edit.error || u.in_use) && (
                    <div className={edit.error ? 'hr-error' : 'hr-help'} role={edit.error ? 'alert' : undefined} style={{ marginTop: 4 }}>
                      {edit.error || 'The conversion is fixed while the unit is in use.'}
                    </div>
                  )}
                </div>
              ) : confirmId === u.id ? (
                <div className="mfg-cat-edit">
                  <span className="mfg-cat-name">{`Delete ${u.symbol}?`}</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmId(null)} disabled={deletingId === u.id}>Cancel</button>
                  <BusyButton className="btn btn-danger btn-sm" busy={deletingId === u.id} busyLabel="Deleting…" onClick={() => remove(u)}>Delete</BusyButton>
                </div>
              ) : (
                <>
                  <span className="mfg-cat-name" style={{ flex: '0 0 72px' }}>{u.symbol}</span>
                  <span className="mfg-cat-count" style={{ flex: 1, ...tabular }}>
                    {u.is_base ? `Base unit for ${cat.label.toLowerCase()}` : `1 ${u.symbol} = ${fmtQty(u.to_base_factor)} ${cat.base}`}
                  </span>
                  {!u.is_base && (
                    <>
                      <span className="mfg-cat-count">{u.in_use ? 'In use' : 'Unused'}</span>
                      <button type="button" className="mfg-icon-btn" aria-label={`Edit ${u.symbol}`} title="Edit"
                        onClick={() => { setEdit({ id: u.id, symbol: u.symbol, factor: String(num(u.to_base_factor)), error: null }); setConfirmId(null); setRowNotice(null); }}>
                        <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                      </button>
                      <button
                        type="button" className="mfg-icon-btn is-danger" aria-label={`Delete ${u.symbol}`}
                        aria-disabled={u.in_use ? 'true' : undefined} title={u.in_use ? u.usage : 'Delete'}
                        onClick={() => (u.in_use ? setRowNotice({ id: u.id, message: u.usage }) : (setConfirmId(u.id), setEdit(null), setRowNotice(null)))}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                      </button>
                    </>
                  )}
                </>
              )}
              {rowNotice?.id === u.id && !isEditing && (
                <div className="mfg-cat-notice" role="status">
                  <span className="material-symbols-outlined" aria-hidden="true">block</span>{rowNotice.message}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

// ── Record purchase ────────────────────────────────────────────────────────
// Several materials per purchase (brief 7.1). Other charges are shared over
// the lines by value and shown as each line's landed rate before saving
// (7.3); they are not posted to the supplier's ledger (7.2).
const newLine = () => ({ key: Math.random().toString(36).slice(2), raw_material_id: '', qty: '', rate: '' });
const emptyPurchase = () => ({ supplier_id: '', date: todayPKT(), invoice_no: '', other_charges: '', charges_note: '', lines: [newLine()] });

function lineProblem(line, material) {
  if (!line.raw_material_id) return 'Choose a material.';
  const qty = parseNum(line.qty);
  if (!(qty > 0)) return `Enter a quantity greater than 0 for ${material?.name || 'this material'}.`;
  if (isCount(material) && !Number.isInteger(qty)) return `Enter a whole number of ${material.uom_symbol} for ${material.name}.`;
  if (!(parseNum(line.rate) > 0)) return `Enter a rate greater than 0 for ${material?.name || 'this material'}.`;
  return null;
}

function PurchaseDialog({ isOpen, materials, suppliers, onClose, onSaved }) {
  const [form, setForm] = useState(emptyPurchase);
  const [attempted, setAttempted] = useState(false);
  const [lineTouched, setLineTouched] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { setForm(emptyPurchase()); setAttempted(false); setLineTouched({}); setServerError(null); }
  }, [isOpen]);

  const byId = useMemo(() => new Map(materials.map(m => [String(m.id), m])), [materials]);
  const setHeader = (k, v) => { setForm(p => ({ ...p, [k]: v })); setServerError(null); };
  const setLine = (key, patch) => {
    setForm(p => ({ ...p, lines: p.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));
    setServerError(null);
  };
  const pickMaterial = (key, id) => {
    const m = byId.get(String(id));
    // The rate starts at the last purchase's invoice rate (before other
    // charges, which this purchase adds again), never at the average. Empty
    // for a material never bought. It stays editable.
    setLine(key, { raw_material_id: id, rate: m && m.last_purchase_rate != null ? String(num(m.last_purchase_rate)) : '' });
  };

  const charges = parseNum(form.other_charges);
  const chargesValue = Number.isFinite(charges) ? charges : 0;
  const filled = form.lines.map(l => ({ ...l, material: byId.get(String(l.raw_material_id)) }));
  const valid = filled.filter(l => !lineProblem(l, l.material));
  const costs = landedRates(valid.map(l => ({ qty: parseNum(l.qty), rate: parseNum(l.rate) })), chargesValue);
  const costByKey = new Map(valid.map((l, i) => [l.key, costs[i]]));
  const itemsTotal = round2(costs.reduce((s, c) => s + c.lineTotal, 0));
  const supplier = suppliers.find(s => String(s.id) === String(form.supplier_id));

  const headerErrors = {};
  if (!form.supplier_id) headerErrors.supplier_id = 'Choose the supplier.';
  if (!form.date) headerErrors.date = 'Enter the purchase date.';
  else if (form.date > todayPKT()) headerErrors.date = 'The purchase date cannot be in the future.';
  if (form.other_charges !== '' && !(charges >= 0)) headerErrors.other_charges = 'Enter other charges of 0 or more.';
  const lineErrors = Object.fromEntries(filled.map(l => [l.key, lineProblem(l, l.material)]));
  const firstLineError = filled.map(l => lineErrors[l.key]).find(Boolean);
  const blockedReason = headerErrors.supplier_id || headerErrors.date || firstLineError || headerErrors.other_charges || null;
  const showLineError = (key) => (attempted || lineTouched[key]) && lineErrors[key];

  const save = async () => {
    setAttempted(true);
    if (blockedReason) return;
    setSaving(true); setServerError(null);
    try {
      const r = await api.post('/raw-materials/purchases', {
        supplier_id: form.supplier_id, date: form.date, invoice_no: cleanText(form.invoice_no) || null,
        other_charges: chargesValue, charges_note: cleanText(form.charges_note) || null,
        lines: filled.map(l => ({ raw_material_id: l.raw_material_id, qty: l.qty, rate: l.rate })),
      });
      toast.success(`Purchase ${r.data.purchase_no} recorded. ${fmtMoney(r.data.items_total)} posted to ${supplier?.name || 'the supplier'}.`);
      onSaved();
    } catch (err) {
      setServerError(err?.response?.data?.message || 'The purchase could not be recorded. Try again.');
    } finally { setSaving(false); }
  };

  const taken = new Set(form.lines.map(l => String(l.raw_material_id)).filter(Boolean));
  const materialOptions = (current) => materials.map(m => ({
    value: m.id,
    label: m.name,
    hint: `${m.uom_symbol} · ${TYPE_LABEL[m.material_type]}`,
    disabled: taken.has(String(m.id)) && String(m.id) !== String(current),
    disabledReason: 'Already on this purchase',
  }));

  const GRID = 'minmax(0, 2.3fr) minmax(0, 1fr) 64px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 40px';

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!saving) onClose(); }}
      title="Record purchase"
      size="xl"
      footer={
        <>
          {attempted && blockedReason && <span role="status" className="mfg-foot-status is-error" style={{ marginRight: 'auto' }}>{blockedReason}</span>}
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <BusyButton busy={saving} busyLabel="Saving…" onClick={save}>Save purchase</BusyButton>
        </>
      }
    >
      {isOpen && (
        <>
          <div className="hr-form-grid is-modal">
            <FormField label="Supplier" htmlFor="rp-supplier" required col={5} error={attempted ? headerErrors.supplier_id : null}>
              <Picker
                id="rp-supplier" value={form.supplier_id} placeholder="Select supplier" searchPlaceholder="Search suppliers"
                invalid={attempted && !!headerErrors.supplier_id}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                onChange={v => setHeader('supplier_id', v)}
              />
            </FormField>
            <FormField label="Purchase date" htmlFor="rp-date" required col={3} error={attempted || form.date > todayPKT() ? headerErrors.date : null}>
              <DateInput id="rp-date" className={`form-control${headerErrors.date && attempted ? ' hr-invalid' : ''}`}
                value={form.date} max={todayPKT()} onChange={e => setHeader('date', e.target.value)} />
            </FormField>
            <FormField label="Supplier invoice no." htmlFor="rp-invoice" col={4}>
              <input id="rp-invoice" className="form-control" placeholder="Optional" maxLength={100}
                value={form.invoice_no} onChange={e => setHeader('invoice_no', e.target.value)} />
            </FormField>
          </div>

          <div className="hr-lines mfg-lines" style={{ marginTop: 4 }}>
            <div className="hr-lines-head" style={{ gridTemplateColumns: GRID }}>
              <span>Material</span>
              <span className="mfg-lines-head-num">Quantity</span>
              <span>Unit</span>
              <span className="mfg-lines-head-num">Rate (PKR)</span>
              <span className="mfg-lines-head-num">Line total</span>
              <span className="mfg-lines-head-num">Landed rate</span>
              <span />
            </div>
            {filled.map((l, i) => {
              const cost = costByKey.get(l.key);
              const error = showLineError(l.key);
              return (
                <div key={l.key} className="hr-line" style={{ gridTemplateColumns: GRID }}>
                  <div className="hr-line-cell">
                    <Picker
                      ariaLabel={`Material, line ${i + 1}`}
                      value={l.raw_material_id}
                      placeholder="Select material"
                      searchPlaceholder="Search materials"
                      options={materialOptions(l.raw_material_id)}
                      invalid={!!error && !l.raw_material_id}
                      onChange={v => pickMaterial(l.key, v)}
                    />
                  </div>
                  <div className="hr-line-cell">
                    <NumberField
                      ariaLabel={`Quantity, line ${i + 1}`} value={l.qty} integer={isCount(l.material)}
                      invalid={!!error && !(parseNum(l.qty) > 0)}
                      onChange={v => setLine(l.key, { qty: v })}
                      onBlur={() => setLineTouched(p => ({ ...p, [l.key]: true }))}
                    />
                  </div>
                  <div className="hr-line-cell mfg-cell is-muted">{l.material?.uom_symbol || '—'}</div>
                  <div className="hr-line-cell">
                    <NumberField
                      ariaLabel={`Rate, line ${i + 1}`} value={l.rate}
                      title={l.material?.last_purchase_rate != null
                        ? `Last bought at ${fmtRate(l.material.last_purchase_rate)} on ${fmtDate(l.material.last_purchase_date)}` : undefined}
                      invalid={!!error && !(parseNum(l.rate) > 0)}
                      onChange={v => setLine(l.key, { rate: v })}
                      onBlur={() => setLineTouched(p => ({ ...p, [l.key]: true }))}
                    />
                  </div>
                  <div className="hr-line-cell mfg-cell is-num">{cost ? fmtAmount(cost.lineTotal) : '—'}</div>
                  <div className={`hr-line-cell mfg-cell is-num${cost ? ' is-strong' : ''}`} title={cost && cost.chargesShare ? `Includes ${fmtMoney(cost.chargesShare)} of other charges` : undefined}>
                    {cost ? <Rate value={cost.landedRate} /> : '—'}
                  </div>
                  <RemoveLine
                    label={`Remove line ${i + 1}`}
                    disabled={form.lines.length === 1}
                    onClick={() => setForm(p => ({ ...p, lines: p.lines.filter(x => x.key !== l.key) }))}
                  />
                  {error && (
                    <div className="mfg-line-error">
                      <div className="hr-error"><span className="material-symbols-outlined" aria-hidden="true">error</span><span>{error}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="hr-lines-foot">
              <AddButton onClick={() => setForm(p => ({ ...p, lines: [...p.lines, newLine()] }))}
                disabled={form.lines.length >= materials.length}>
                Add line
              </AddButton>
              <span className="mfg-lines-total">Items total <strong>{fmtMoney(itemsTotal)}</strong></span>
            </div>
          </div>

          <div className="hr-form-grid is-modal" style={{ marginTop: 16 }}>
            <MfgField label="Other charges (PKR)" htmlFor="rp-charges" className="hr-col-4" error={headerErrors.other_charges}
              info="Freight, loading and similar costs. Shared over the lines by value; they raise the landed rates and are not owed to the supplier.">
              <NumberField id="rp-charges" value={form.other_charges}
                invalid={!!headerErrors.other_charges} onChange={v => setHeader('other_charges', v)} />
            </MfgField>
            <FormField label="Charges note" htmlFor="rp-note" col={8}>
              <input id="rp-note" className="form-control" placeholder="Optional" maxLength={150}
                value={form.charges_note} onChange={e => setHeader('charges_note', e.target.value)} />
            </FormField>
          </div>

          <div className="hr-totals" style={{ marginTop: 4 }}>
            <div className="hr-total-cell"><div className="hr-total-label">Items</div><div className="hr-total-value">{fmtMoney(itemsTotal)}</div></div>
            <div className="hr-total-cell"><div className="hr-total-label">Other charges</div><div className="hr-total-value">{fmtMoney(chargesValue)}</div></div>
            <div className="hr-total-cell is-net"><div className="hr-total-label">Total cost</div><div className="hr-total-value">{fmtMoney(itemsTotal + chargesValue)}</div></div>
          </div>

          <p className="mfg-note">
            {supplier && itemsTotal > 0
              ? `${fmtMoney(itemsTotal)} is posted to the ledger of ${supplier.name}.`
              : 'The items total is posted to the supplier’s ledger.'}
            {' '}Each material&apos;s average rate is updated with its landed rate.
          </p>
          {serverError && <Notice tone="danger" style={{ marginTop: 12 }}>{serverError}</Notice>}
        </>
      )}
    </Modal>
  );
}

// ── View purchase ──────────────────────────────────────────────────────────
function PurchaseView({ purchase, onClose }) {
  const p = purchase;
  return (
    <Modal isOpen={!!p} onClose={onClose} title={p ? `Purchase ${p.purchase_no}` : ''} size="lg">
      {p && (
        <>
          <FieldGrid cols={4}>
            <Field label="Supplier" value={p.supplier_name} />
            <Field label="Date" value={fmtDate(p.date)} />
            <Field label="Supplier invoice no." value={p.invoice_no} />
            <Field label="Recorded by" value={p.created_by_name} />
          </FieldGrid>
          <div className="mfg-section">
            <div className="mfg-doc-table">
              <table className="hr-table is-dense">
                <thead><tr>
                  <th>Material</th>
                  <th className="hr-th-num" style={{ width: '14%' }}>Quantity</th>
                  <th className="hr-th-num" style={{ width: '13%' }}>Rate</th>
                  <th className="hr-th-num" style={{ width: '15%' }}>Line total</th>
                  <th className="hr-th-num" style={{ width: '14%' }}>Charges</th>
                  <th className="hr-th-num" style={{ width: '14%' }}>Landed rate</th>
                </tr></thead>
                <tbody>
                  {p.lines.map(l => (
                    <tr key={l.id}>
                      <td className="hr-cell-strong">{l.rm_name}</td>
                      <td className="hr-num">{fmtQty(l.qty, l.uom_symbol)}</td>
                      <td className="hr-num">{<Rate value={l.rate} />}</td>
                      <td className="hr-num">{fmtAmount(l.line_total)}</td>
                      <td className="hr-num">{num(l.charges_share) > 0 ? fmtAmount(l.charges_share) : EMPTY}</td>
                      <td className="hr-num hr-cell-strong">{<Rate value={l.landed_rate} />}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="hr-num">{fmtAmount(p.items_total)}</td>
                    <td className="hr-num">{num(p.other_charges) > 0 ? fmtAmount(p.other_charges) : EMPTY}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {num(p.other_charges) > 0 && (
            <p className="mfg-note">
              Other charges {fmtMoney(p.other_charges)}{p.charges_note ? `: ${p.charges_note}` : ''}. Not owed to the supplier.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

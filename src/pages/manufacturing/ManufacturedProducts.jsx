import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import {
  HrStyles, Tabs, Segmented, KebabMenu, FormField, BusyButton, useSort, sortRows, fmtAmount, fmtMoney, num,
} from '../hr/HrKit';
import {
  MfgStyles, Picker, NumberField, MfgField, WarnText, NameWithTag, EMPTY, PackSizeField, Rate, Margin, SortHead,
  parseNum, normKey, cleanText, packLabel, plural, marginPct,
} from './mfgKit';
import { ByRateInfo, byRateInfo } from './batchKit';

// ─── Manufactured products and by-products ─────────────────────────────────
// Two tabs over one kind of record: both are rows in `products`, so Sale,
// Inventory and Reports treat them like any other product.
//   Manufactured product: pack size = number + unit (a weight or volume) plus
//     an optional pack type from the managed list (pack_type_id); the server
//     generates pack_size ("200 ml", "200 ml Pouch"). Unique by name + size in
//     base units + pack type (1 L = 1000 ml), case and extra spaces ignored.
//     Its purchase rate is the cost per unit of its latest batch.
//   By-product: its pack size IS its unit ("kg", "pcs"): no number, no pack
//     type. Unique by name, case and extra spaces ignored. The unit is fixed
//     once in use. Its purchase rate is entered here and values it in a batch.
// Categories and pack types are managed in one dialog (two tabs), or added
// from the product form with "+ New". A pack type in use cannot be renamed
// or deleted: its name is printed inside pack sizes on invoices.
// Rules mirror server/routes/manufacturing.js (authoritative).

const KINDS = {
  product: { path: '/manufacturing/products', noun: 'product', title: 'manufactured product' },
  by_product: { path: '/manufacturing/by-products', noun: 'by-product', title: 'by-product' },
};

const emptyForm = {
  name: '', pack_type_id: '', category_id: '', company_id: '', volume: '', volume_uom_id: '', uom_id: '',
  purchase_rate: '0', sale_rate: '', retail_price: '', tax_applicable: false, sale_tax_pct: '',
};

const FIELD_ORDER = ['name', 'volume', 'volume_uom_id', 'uom_id', 'pack_type_id', 'category_id', 'company_id',
  'purchase_rate', 'sale_rate', 'retail_price', 'sale_tax_pct'];

// The two managed lists: same rows, rules and messages.
const LISTS = {
  categories: {
    path: '/manufacturing/categories', noun: 'category', Noun: 'Category', maxLength: 60, placeholder: 'New category name',
    // A category can be renamed while in use; only delete is refused.
    lockedRename: () => null,
    lockedDelete: (c) => `Used by ${plural(c.product_count, 'product', 'products')}.`,
  },
  packTypes: {
    path: '/manufacturing/pack-types', noun: 'pack type', Noun: 'Pack type', maxLength: 40, placeholder: 'New pack type name',
    lockedRename: (t) => `${t.name} is used by ${plural(t.product_count, 'product', 'products')}, so it can't be renamed or deleted.`,
    lockedDelete: (t) => `${t.name} is used by ${plural(t.product_count, 'product', 'products')}, so it can't be renamed or deleted.`,
  },
};
const sortByName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const dupMessage = (list, name) => `A ${list.noun} named "${name}" already exists.`;

const toForm = (r, kind) => ({
  name: r.name || '',
  pack_type_id: r.pack_type_id ?? '',
  category_id: r.category_id ?? '',
  company_id: r.company_id ?? '',
  volume: kind === 'product' && r.volume != null ? String(num(r.volume)) : '',
  volume_uom_id: kind === 'product' ? r.volume_uom_id ?? '' : '',
  uom_id: kind === 'by_product' ? r.volume_uom_id ?? '' : '',
  purchase_rate: kind === 'by_product' && r.purchase_rate != null ? String(num(r.purchase_rate)) : '0',
  sale_rate: r.sale_rate != null ? String(num(r.sale_rate)) : '',
  retail_price: r.retail_price != null ? String(num(r.retail_price)) : '',
  tax_applicable: !!Number(r.tax_applicable),
  sale_tax_pct: Number(r.tax_applicable) ? String(num(r.sale_tax_pct)) : '',
});

function validate(form, kind, existing, editingId, uoms, packTypes) {
  const e = {};
  const name = cleanText(form.name);
  if (!name) e.name = kind === 'product' ? 'Enter the product name.' : 'Enter the by-product name.';
  if (kind === 'product') {
    const volume = parseNum(form.volume);
    const unit = uoms.find(u => String(u.id) === String(form.volume_uom_id));
    if (!(volume > 0)) e.volume = 'Enter the pack size.';
    else if (!form.volume_uom_id) e.volume_uom_id = 'Choose the pack size unit.';
    else if (unit?.base_type === 'count' && !Number.isInteger(volume)) e.volume = `Enter a whole number of ${unit.symbol} for the pack size.`;
    const typeName = packTypes.find(t => String(t.id) === String(form.pack_type_id))?.name || '';
    if (name && volume > 0 && unit) {
      // Same name, same size in base units (1 L = 1000 ml, 1 kg = 1000 g), same pack type.
      const base = volume * parseNum(unit.to_base_factor);
      const dup = existing.find(p => p.id !== editingId && normKey(p.name) === normKey(name)
        && p.vol_uom_base_type === unit.base_type
        && Math.abs(parseNum(p.volume) * parseNum(p.vol_uom_factor) - base) < 1e-6
        && normKey(p.pack_type || '') === normKey(typeName));
      if (dup) e.name = `${dup.name} — ${dup.pack_size} already exists.`;
    }
  } else {
    if (!form.uom_id) e.uom_id = 'Choose the unit.';
    const dup = name && existing.find(p => p.id !== editingId && normKey(p.name) === normKey(name));
    if (dup) e.name = `A by-product named ${dup.name} already exists.`;
    const rate = parseNum(form.purchase_rate);
    if (!(rate >= 0)) e.purchase_rate = 'Enter a purchase rate of 0 or more.';
  }
  if (!form.company_id) e.company_id = 'Choose the company.';
  if (!(parseNum(form.sale_rate) > 0)) e.sale_rate = 'Enter a sale rate greater than 0.';
  if (!(parseNum(form.retail_price) > 0)) e.retail_price = 'Enter a retail price greater than 0.';
  if (form.tax_applicable) {
    const pct = parseNum(form.sale_tax_pct);
    if (form.sale_tax_pct === '') e.sale_tax_pct = 'Enter the sale tax %.';
    else if (!(pct >= 0 && pct <= 100)) e.sale_tax_pct = 'Enter a sale tax % from 0 to 100.';
    else if (pct === 0) e.sale_tax_pct = 'Enter a sale tax % above 0, or clear Apply sale tax.';
  }
  return e;
}

function changed(form, record, kind) {
  const base = toForm(record, kind);
  const numEq = (a, b) => (parseNum(a) || 0) === (parseNum(b) || 0);
  return cleanText(form.name) !== cleanText(base.name)
    || String(form.pack_type_id) !== String(base.pack_type_id)
    || String(form.category_id) !== String(base.category_id)
    || String(form.company_id) !== String(base.company_id)
    || !numEq(form.volume, base.volume)
    || String(form.volume_uom_id) !== String(base.volume_uom_id)
    || String(form.uom_id) !== String(base.uom_id)
    || !numEq(form.purchase_rate, base.purchase_rate)
    || !numEq(form.sale_rate, base.sale_rate)
    || !numEq(form.retail_price, base.retail_price)
    || form.tax_applicable !== base.tax_applicable
    || (form.tax_applicable && !numEq(form.sale_tax_pct, base.sale_tax_pct));
}

// One small icon and one sentence.
function EmptyList({ state }) {
  return (
    <div className="hr-empty">
      <div className="hr-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{state.icon}</span></div>
      <div className="hr-empty-title">{state.title}</div>
    </div>
  );
}

// An untaxed product shows the muted "—" of any empty cell.
const taxCell = (p) => (Number(p.tax_applicable)
  ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${num(p.sale_tax_pct)}%`}</span>
  : EMPTY);

// Sorting (blank values last, ties in the default order). A product sorts by
// name, then by pack size in base units (100 ml < 200 ml < 1 L).
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
const packBase = (p) => num(p.volume) * (num(p.vol_uom_factor) || 1);
const productOrder = (a, b) => byName(a, b) || packBase(a) - packBase(b)
  || String(a.pack_type || '').localeCompare(String(b.pack_type || '')) || a.id - b.id;
const byProductOrder = (a, b) => byName(a, b) || a.id - b.id;
const COMMON_SORT = {
  company: { value: p => p.company_name, text: true },
  sale: { value: p => num(p.sale_rate) },
  retail: { value: p => num(p.retail_price) },
  tax: { value: p => (Number(p.tax_applicable) ? num(p.sale_tax_pct) : null) },
};
const PRODUCT_SORT = {
  ...COMMON_SORT,
  product: (a, b) => byName(a, b) || packBase(a) - packBase(b),
  category: { value: p => p.category_name, text: true },
  cost: { value: p => (num(p.purchase_rate) > 0 ? num(p.purchase_rate) : null) },
  margin: { value: p => marginPct(p.sale_rate, p.purchase_rate) },
};
const BY_PRODUCT_SORT = {
  ...COMMON_SORT,
  name: { value: p => p.name, text: true },
  purchase: { value: p => (p.purchase_rate === null ? null : num(p.purchase_rate)) },
};

// The (i) texts of the list: no particular by-product.
const LIST_RATE_CTX = { unit: 'unit', name: 'the by-product', master: true };

export default function ManufacturedProducts() {
  const [tab, setTab] = useState('product');
  const [products, setProducts] = useState([]);
  const [byProducts, setByProducts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [packTypes, setPackTypes] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const productSort = useSort('product');
  const bySort = useSort('name');

  const [dialog, setDialog] = useState(null);     // { kind, record }
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);   // { kind, record }
  const [deleting, setDeleting] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);

  const load = () => Promise.all([
    api.get('/manufacturing/products'),
    api.get('/manufacturing/by-products'),
    api.get('/companies'),
    api.get('/manufacturing/categories'),
    api.get('/manufacturing/pack-types'),
    api.get('/raw-materials/uom'),
  ]).then(([p, b, c, cat, pt, u]) => {
    setProducts(p.data); setByProducts(b.data); setCompanies(c.data);
    setCategories(cat.data); setPackTypes(pt.data); setUoms(u.data);
  }).catch(err => toast.error(err?.response?.data?.message || 'The products could not be loaded. Refresh the page.'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  // ── Dialog ──
  const kind = dialog?.kind || 'product';
  const editing = dialog?.record || null;
  const openDialog = (k, record) => {
    setDialog({ kind: k, record });
    setForm(record ? toForm(record, k) : emptyForm);
    setTouched({}); setServerErrors({});
  };
  const setField = (key, value) => {
    setForm(p => ({ ...p, [key]: value }));
    setServerErrors(p => (p[key] ? { ...p, [key]: undefined } : p));
  };
  const touch = (key) => setTouched(p => ({ ...p, [key]: true }));

  const list = kind === 'product' ? products : byProducts;
  const errors = dialog ? validate(form, kind, list, editing?.id, uoms, packTypes) : {};
  const firstError = FIELD_ORDER.map(k => errors[k]).find(Boolean);
  const isChanged = editing ? changed(form, editing, kind) : true;
  const blockedReason = editing && !isChanged ? 'No changes yet' : firstError || null;
  const errorFor = (key) => serverErrors[key] || (touched[key] ? errors[key] : null);
  const retailBelowSale = parseNum(form.retail_price) > 0 && parseNum(form.sale_rate) > 0
    && parseNum(form.retail_price) < parseNum(form.sale_rate);
  const packTypeName = packTypes.find(t => String(t.id) === String(form.pack_type_id))?.name || '';

  const save = async () => {
    setTouched(Object.fromEntries(FIELD_ORDER.map(k => [k, true])));
    if (blockedReason) return;
    setSaving(true); setServerErrors({});
    const payload = kind === 'product'
      ? {
        name: cleanText(form.name), pack_type_id: form.pack_type_id || null, category_id: form.category_id || null,
        company_id: form.company_id || null, volume: form.volume, volume_uom_id: form.volume_uom_id,
        sale_rate: form.sale_rate, retail_price: form.retail_price,
        tax_applicable: form.tax_applicable, sale_tax_pct: form.tax_applicable ? form.sale_tax_pct : 0,
      }
      : {
        name: cleanText(form.name), uom_id: form.uom_id, company_id: form.company_id || null,
        purchase_rate: form.purchase_rate === '' ? 0 : form.purchase_rate, sale_rate: form.sale_rate,
        retail_price: form.retail_price, tax_applicable: form.tax_applicable,
        sale_tax_pct: form.tax_applicable ? form.sale_tax_pct : 0,
      };
    const unit = uoms.find(u => String(u.id) === String(form.volume_uom_id));
    const label = kind === 'product' ? `${payload.name} — ${packLabel(form.volume, unit?.symbol, packTypeName)}` : payload.name;
    try {
      if (editing) await api.put(`${KINDS[kind].path}/${editing.id}`, payload);
      else await api.post(KINDS[kind].path, payload);
      toast.success(editing ? `${label} updated.` : `${label} added.`);
      setDialog(null);
      load();
    } catch (err) {
      const body = err?.response?.data;
      if (body?.field && FIELD_ORDER.includes(body.field)) setServerErrors({ [body.field]: body.message });
      else toast.error(body?.message || `The ${KINDS[kind].noun} could not be saved. Try again.`);
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    const { kind: k, record } = deleteTarget;
    setDeleting(true);
    try {
      await api.delete(`${KINDS[k].path}/${record.id}`);
      toast.success(`${k === 'product' ? `${record.name} — ${record.pack_size}` : record.name} deleted.`);
      setDeleteTarget(null); load();
    } catch (err) {
      setDeleteTarget(null);
      toast.error(err?.response?.data?.message || 'The record could not be deleted. Try again.');
      load();
    } finally { setDeleting(false); }
  };

  // ── Lists ──
  const q = search.trim().toLowerCase();
  const shownProducts = useMemo(() => sortRows(products.filter(p => !q
    || p.name.toLowerCase().includes(q) || (p.pack_size || '').toLowerCase().includes(q)
    || (p.category_name || '').toLowerCase().includes(q) || (p.company_name || '').toLowerCase().includes(q)),
  productSort.sortConfig, PRODUCT_SORT, productOrder), [products, q, productSort.sortConfig]);
  const shownBy = useMemo(() => sortRows(byProducts.filter(p => !q
    || p.name.toLowerCase().includes(q) || (p.pack_size || '').toLowerCase().includes(q)
    || (p.company_name || '').toLowerCase().includes(q)),
  bySort.sortConfig, BY_PRODUCT_SORT, byProductOrder), [byProducts, q, bySort.sortConfig]);
  const showCost = products.some(p => p.purchase_rate !== null);

  const allUnits = uoms.map(u => ({ value: u.id, label: u.symbol }));
  const categoryOptions = [{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))];
  const packTypeOptions = [{ value: '', label: 'No pack type' }, ...packTypes.map(t => ({ value: t.id, label: t.name }))];
  const companyOptions = companies.map(c => ({ value: c.id, label: c.name }));
  const formUnit = uoms.find(u => String(u.id) === String(form.volume_uom_id));
  const formSize = parseNum(form.volume) > 0 && formUnit ? packLabel(form.volume, formUnit.symbol, packTypeName) : null;
  // The (i) texts of the by-product form: its unit and name once entered.
  const byUnit = uoms.find(u => String(u.id) === String(form.uom_id))?.symbol;
  const byCtx = { unit: byUnit || 'unit', name: cleanText(form.name) || 'the by-product', master: true };

  const actions = (k, record) => [
    { label: 'Edit', icon: 'edit', onClick: () => openDialog(k, record) },
    { divider: true },
    {
      label: 'Delete', icon: 'delete', danger: true,
      disabled: record.in_use, title: record.in_use ? record.usage : undefined,
      onClick: () => setDeleteTarget({ kind: k, record }),
    },
  ];

  const emptyState = (k) => {
    if (q) return { icon: 'search_off', title: `Nothing matches "${search.trim()}".` };
    return k === 'product'
      ? { icon: 'category', title: 'No manufactured products yet. Add each pack size as a product.' }
      : { icon: 'recycling', title: 'No by-products yet.' };
  };

  return (
    <Layout title="Manufactured Products">
      <HrStyles />
      <MfgStyles />
      <div className="card">
        <div className="mfg-card-head">
          <Tabs
            ariaLabel="Product lists"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'product', label: `Manufactured products (${products.length})` },
              { value: 'by_product', label: `By-products (${byProducts.length})` },
            ]}
          />
          <div className="mfg-head-actions">
            <div className="search-bar">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                placeholder={tab === 'product' ? 'Search products' : 'Search by-products'}
                aria-label={tab === 'product' ? 'Search manufactured products' : 'Search by-products'}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {tab === 'product' && (
              <button type="button" className="btn btn-outline" onClick={() => setListsOpen(true)}>
                <span className="material-symbols-outlined" aria-hidden="true">sell</span>
                Categories &amp; pack types
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => openDialog(tab, null)}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
              {tab === 'product' ? 'Add product' : 'Add by-product'}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : tab === 'product' ? (
          shownProducts.length === 0 ? <EmptyList state={emptyState('product')} /> : (
            <div className="hr-page-scroll">
              <table className="hr-table hr-page-table">
                <thead>
                  <tr>
                    <SortHead sort={productSort} column="product" label="Product" />
                    <SortHead sort={productSort} column="category" label="Category" style={{ width: '12%' }} />
                    <SortHead sort={productSort} column="company" label="Company" style={{ width: '15%' }} />
                    <SortHead sort={productSort} column="sale" label="Sale rate" num style={{ width: '9%' }} />
                    <SortHead sort={productSort} column="retail" label="Retail" title="Retail price" num style={{ width: '10%' }} />
                    <SortHead sort={productSort} column="tax" label="Sale tax" num style={{ width: '8%' }} />
                    {showCost && <SortHead sort={productSort} column="cost" label="Latest cost" num style={{ width: '10%' }} />}
                    {showCost && <SortHead sort={productSort} column="margin" label="Margin" num style={{ width: '8%' }} />}
                    <th style={{ width: 56 }}><span className="hr-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shownProducts.map(p => (
                    <tr key={p.id}>
                      <td><NameWithTag name={p.name} tag={p.pack_size} /></td>
                      <td>{p.category_name || EMPTY}</td>
                      <td className="mfg-ellipsis" title={p.company_name || undefined}>{p.company_name || EMPTY}</td>
                      <td className="hr-num">{fmtAmount(p.sale_rate)}</td>
                      <td className="hr-num">{fmtAmount(p.retail_price)}</td>
                      <td className="hr-num">{taxCell(p)}</td>
                      {showCost && (
                        <td className="hr-num" title={num(p.purchase_rate) > 0 ? 'Cost per unit of the latest batch sent to inventory' : 'Not produced yet'}>
                          {num(p.purchase_rate) > 0 ? <Rate value={p.purchase_rate} /> : EMPTY}
                        </td>
                      )}
                      {showCost && (
                        <td className="hr-num" title="(Sale rate − latest cost) ÷ sale rate">
                          <Margin sale={p.sale_rate} cost={p.purchase_rate} />
                        </td>
                      )}
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu label={`Actions for ${p.name} ${p.pack_size}`} items={actions('product', p)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          shownBy.length === 0 ? <EmptyList state={emptyState('by_product')} /> : (
            <div className="hr-page-scroll">
              <table className="hr-table hr-page-table">
                <thead>
                  <tr>
                    <SortHead sort={bySort} column="name" label="By-product" />
                    <SortHead sort={bySort} column="company" label="Company" style={{ width: '18%' }} />
                    <SortHead sort={bySort} column="purchase" label="Purchase rate" num style={{ width: '14%' }}
                      info={<ByRateInfo which="purchase" ctx={LIST_RATE_CTX} />} />
                    <SortHead sort={bySort} column="sale" label="Sale rate" num style={{ width: '12%' }}
                      info={<ByRateInfo which="sale" ctx={LIST_RATE_CTX} />} />
                    <SortHead sort={bySort} column="retail" label="Retail" title="Retail price" num style={{ width: '11%' }} />
                    <SortHead sort={bySort} column="tax" label="Sale tax" num style={{ width: '9%' }} />
                    <th style={{ width: 56 }}><span className="hr-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shownBy.map(p => (
                    <tr key={p.id}>
                      <td><NameWithTag name={p.name} tag={p.pack_size} /></td>
                      <td className="mfg-ellipsis" title={p.company_name || undefined}>{p.company_name || EMPTY}</td>
                      <td className="hr-num">{p.purchase_rate === null ? EMPTY : <Rate value={p.purchase_rate} />}</td>
                      <td className="hr-num">{fmtAmount(p.sale_rate)}</td>
                      <td className="hr-num">{fmtAmount(p.retail_price)}</td>
                      <td className="hr-num">{taxCell(p)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu label={`Actions for ${p.name}`} items={actions('by_product', p)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ── Add / edit dialog ── */}
      <Modal
        isOpen={!!dialog}
        onClose={() => { if (!saving) setDialog(null); }}
        title={`${editing ? 'Edit' : 'Add'} ${KINDS[kind].title}`}
        size="md"
        footer={
          <>
            {blockedReason && (
              <span role="status" className="mfg-foot-status" style={{ marginRight: 'auto' }}>{blockedReason}</span>
            )}
            <button className="btn btn-outline" onClick={() => setDialog(null)} disabled={saving}>Cancel</button>
            <BusyButton busy={saving} busyLabel="Saving…" onClick={save} disabled={!!blockedReason}>
              {editing ? 'Save changes' : kind === 'product' ? 'Add product' : 'Add by-product'}
            </BusyButton>
          </>
        }
      >
        {!!dialog && (
          <div className="hr-form-grid is-modal">
            <div className="mfg-form-row is-name-pack">
              <MfgField label={kind === 'product' ? 'Product name' : 'By-product name'} htmlFor="mp-name" required error={errorFor('name')}>
                <input
                  id="mp-name"
                  className={`form-control${errorFor('name') ? ' hr-invalid' : ''}`}
                  placeholder={kind === 'product' ? 'Enter the product name' : 'Enter the by-product name'}
                  value={form.name}
                  maxLength={200}
                  onChange={e => setField('name', e.target.value)}
                  onBlur={() => touch('name')}
                  autoFocus
                />
              </MfgField>
              {kind === 'product' ? (
                <MfgField label="Pack size" htmlFor="mp-pack" required error={errorFor('volume') || errorFor('volume_uom_id')}>
                  <PackSizeField
                    id="mp-pack"
                    volume={form.volume}
                    uomId={form.volume_uom_id}
                    units={allUnits}
                    integer={formUnit?.base_type === 'count'}
                    invalid={!!(errorFor('volume') || errorFor('volume_uom_id'))}
                    onVolume={v => setField('volume', v)}
                    onUnit={v => { setField('volume_uom_id', v); touch('volume_uom_id'); }}
                    onBlur={() => touch('volume')}
                  />
                </MfgField>
              ) : (
                <MfgField label="Unit" htmlFor="mp-unit" required error={errorFor('uom_id')}
                  help={editing?.in_use ? 'Fixed once in use.' : undefined}>
                  <Picker id="mp-unit" ariaLabel="Unit" value={form.uom_id} options={allUnits} placeholder="Select unit"
                    searchPlaceholder="Search units" disabled={!!editing?.in_use} invalid={!!errorFor('uom_id')}
                    onChange={v => { setField('uom_id', v); touch('uom_id'); }} onBlur={() => touch('uom_id')} />
                </MfgField>
              )}
            </div>

            {kind === 'product' && (
              <>
                <MfgField label="Pack type" htmlFor="mp-type" className="hr-col-6" error={errorFor('pack_type_id')}
                  help={packTypeName && formSize ? `Shown as ${formSize}.` : undefined}
                  labelAction={(
                    <InlineNew list={LISTS.packTypes} items={packTypes} pickerId="mp-type"
                      onCreated={t => { setPackTypes(ts => sortByName([...ts, t])); setField('pack_type_id', t.id); }} />
                  )}>
                  <Picker id="mp-type" ariaLabel="Pack type" value={form.pack_type_id} options={packTypeOptions} placeholder="No pack type"
                    searchPlaceholder="Search pack types" invalid={!!errorFor('pack_type_id')}
                    onChange={v => setField('pack_type_id', v)} />
                </MfgField>
                <MfgField label="Category" htmlFor="mp-cat" className="hr-col-6" error={errorFor('category_id')}
                  labelAction={(
                    <InlineNew list={LISTS.categories} items={categories} pickerId="mp-cat"
                      onCreated={c => { setCategories(cs => sortByName([...cs, c])); setField('category_id', c.id); }} />
                  )}>
                  <Picker id="mp-cat" ariaLabel="Category" value={form.category_id} options={categoryOptions} placeholder="No category"
                    searchPlaceholder="Search categories" onChange={v => setField('category_id', v)} />
                </MfgField>
              </>
            )}
            <FormField label="Company" htmlFor="mp-company" required col={12} error={errorFor('company_id')}>
              <Picker id="mp-company" value={form.company_id} options={companyOptions} placeholder="Select company"
                searchPlaceholder="Search companies" invalid={!!errorFor('company_id')}
                onChange={v => { setField('company_id', v); touch('company_id'); }} onBlur={() => touch('company_id')} />
            </FormField>

            {kind === 'by_product' && (
              <MfgField label="Purchase rate (PKR)" htmlFor="mp-prate" className="hr-col-4" error={errorFor('purchase_rate')}
                info={byRateInfo.purchase(byCtx)}>
                <NumberField id="mp-prate" value={form.purchase_rate}
                  invalid={!!errorFor('purchase_rate')} onChange={v => setField('purchase_rate', v)} onBlur={() => touch('purchase_rate')} />
              </MfgField>
            )}
            <MfgField label="Sale rate (PKR)" htmlFor="mp-sale" required className={`hr-col-${kind === 'product' ? 6 : 4}`} error={errorFor('sale_rate')}
              info={kind === 'by_product' ? byRateInfo.sale(byCtx) : undefined}>
              <NumberField id="mp-sale" value={form.sale_rate}
                invalid={!!errorFor('sale_rate')} onChange={v => setField('sale_rate', v)} onBlur={() => touch('sale_rate')} />
            </MfgField>
            <FormField
              label="Retail price (PKR)" htmlFor="mp-retail" required col={kind === 'product' ? 6 : 4}
              error={errorFor('retail_price')}
              help={retailBelowSale ? <WarnText>Below the sale rate.</WarnText> : undefined}
            >
              <NumberField id="mp-retail" value={form.retail_price}
                invalid={!!errorFor('retail_price')} onChange={v => setField('retail_price', v)} onBlur={() => touch('retail_price')} />
            </FormField>

            <div className="hr-col-6" style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 24 }}>
              <label className="mfg-check" htmlFor="mp-taxable">
                <input
                  id="mp-taxable" type="checkbox" checked={form.tax_applicable}
                  onChange={e => { setField('tax_applicable', e.target.checked); if (!e.target.checked) setField('sale_tax_pct', ''); }}
                />
                Apply sale tax
              </label>
            </div>
            {form.tax_applicable ? (
              <FormField label="Sale tax %" htmlFor="mp-tax" required col={6} error={errorFor('sale_tax_pct')}>
                <NumberField id="mp-tax" value={form.sale_tax_pct} suffix="%" autoFocus
                  invalid={!!errorFor('sale_tax_pct')} onChange={v => setField('sale_tax_pct', v)} onBlur={() => touch('sale_tax_pct')} />
              </FormField>
            ) : <div className="hr-col-6" />}

            {kind === 'product' && editing && num(editing.purchase_rate) > 0 && (
              <p className="hr-col-12 mfg-note" style={{ marginTop: 0 }}>
                {`Latest cost per unit: ${fmtMoney(editing.purchase_rate)}, from the latest batch sent to inventory.`}
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={deleteTarget ? `Delete ${deleteTarget.kind === 'product' ? `${deleteTarget.record.name} — ${deleteTarget.record.pack_size}` : deleteTarget.record.name}?` : ''}
        message={`The ${deleteTarget ? KINDS[deleteTarget.kind].noun : 'product'} will be removed permanently.`}
      />

      <ListsDialog
        isOpen={listsOpen}
        onClose={() => setListsOpen(false)}
        lists={{ categories, packTypes }}
        onChanged={(key, next) => { if (key === 'categories') setCategories(next); else setPackTypes(next); load(); }}
      />
    </Layout>
  );
}

// ── "+ New" beside a picker's label ────────────────────────────────────────
// A small popover under the label with one name field and Cancel / Add, so a
// missing category or pack type is added without leaving the product form
// (never a dialog over the dialog). Enter = Add, Esc = Cancel (the product
// dialog stays open). On Add the item is created, selected in the picker, the
// popover closes and focus returns to the picker.
function InlineNew({ list, items, pickerId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const buttonRef = useRef(null);
  const inputId = `${pickerId}-new`;

  const close = (focusPicker) => {
    setOpen(false); setName(''); setError(null);
    setTimeout(() => (focusPicker ? document.getElementById(pickerId) : buttonRef.current)?.focus(), 0);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false); setName(''); setError(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = async () => {
    const clean = cleanText(name);
    if (!clean) { setError(`Enter a ${list.noun} name.`); return; }
    const dup = items.find(x => normKey(x.name) === normKey(clean));
    if (dup) { setError(dupMessage(list, dup.name)); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post(list.path, { name: clean });
      onCreated(r.data);
      close(true);
    } catch (err) {
      setError(err?.response?.data?.message || `The ${list.noun} could not be added. Try again.`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button ref={buttonRef} type="button" className="mfg-text-btn" aria-expanded={open}
        aria-label={`New ${list.noun}`} onClick={() => (open ? close(false) : setOpen(true))}>
        <span className="material-symbols-outlined" aria-hidden="true">add</span>New
      </button>
      {open && (
        <div ref={boxRef} className="mfg-new-pop" role="dialog" aria-label={`New ${list.noun}`}>
          <label className="hr-sr-only" htmlFor={inputId}>{list.placeholder}</label>
          <input
            id={inputId}
            className={`form-control${error ? ' hr-invalid' : ''}`}
            placeholder={list.placeholder}
            value={name}
            maxLength={list.maxLength}
            disabled={busy}
            autoFocus
            onChange={e => { setName(e.target.value); setError(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); add(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
            }}
          />
          {error && (
            <div className="hr-error" role="alert" style={{ marginTop: 6 }}>
              <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{error}</span>
            </div>
          )}
          <div className="mfg-new-pop-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => close(false)} disabled={busy}>Cancel</button>
            <BusyButton className="btn btn-primary btn-sm" busy={busy} busyLabel="Adding…" onClick={add}>Add</BusyButton>
          </div>
        </div>
      )}
    </>
  );
}

// ── Categories & pack types pop-up ─────────────────────────────────────────
// Two tabs over the same rows: add, rename in place and delete-when-unused.
// Add and Save show a busy state, then the new or renamed row is briefly
// highlighted. A pack type in use can be neither renamed nor deleted.
// Rules mirror the server (validateCategoryName / validatePackTypeName).
function ListsDialog({ isOpen, onClose, lists, onChanged }) {
  const [which, setWhich] = useState('categories');
  useEffect(() => { if (!isOpen) setWhich('categories'); }, [isOpen]);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Categories & pack types" size="sm">
      <div style={{ marginBottom: 14 }}>
        <Segmented
          ariaLabel="List"
          value={which}
          onChange={setWhich}
          options={[{ val: 'categories', label: 'Categories' }, { val: 'packTypes', label: 'Pack types' }]}
        />
      </div>
      {isOpen && (
        <ListEditor
          key={which}
          list={LISTS[which]}
          rows={lists[which]}
          onChanged={next => onChanged(which, next)}
        />
      )}
    </Modal>
  );
}

function ListEditor({ list, rows, onChanged }) {
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [rowNotice, setRowNotice] = useState(null);     // { id, message }
  const [flashId, setFlashId] = useState(null);
  const rowRefs = useRef({});

  useEffect(() => {
    if (!flashId) return undefined;
    rowRefs.current[flashId]?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFlashId(null), 1900);
    return () => clearTimeout(t);
  }, [flashId, rows]);

  const dupOf = (name, exceptId) => rows.find(c => c.id !== exceptId && normKey(c.name) === normKey(name));

  const add = async () => {
    const name = cleanText(newName);
    if (!name) { setAddError(`Enter a ${list.noun} name.`); return; }
    const dup = dupOf(name);
    if (dup) { setAddError(dupMessage(list, dup.name)); return; }
    setAdding(true); setAddError(null);
    try {
      const r = await api.post(list.path, { name });
      onChanged(sortByName([...rows, r.data]));
      setFlashId(r.data.id);
      setNewName('');
      toast.success(`${list.Noun} ${r.data.name} added.`);
    } catch (err) {
      setAddError(err?.response?.data?.message || `The ${list.noun} could not be added. Try again.`);
    } finally { setAdding(false); }
  };

  const startEdit = (c) => {
    const locked = list.lockedRename(c);
    if (c.product_count > 0 && locked) { setRowNotice({ id: c.id, message: locked }); return; }
    setEditId(c.id); setEditName(c.name); setEditError(null); setConfirmId(null); setRowNotice(null);
  };
  const cancelEdit = () => { setEditId(null); setEditError(null); };
  const saveEdit = async () => {
    const name = cleanText(editName);
    const current = rows.find(c => c.id === editId);
    if (!name) { setEditError(`Enter a ${list.noun} name.`); return; }
    if (current && name === current.name) { cancelEdit(); return; }
    const dup = dupOf(name, editId);
    if (dup) { setEditError(dupMessage(list, dup.name)); return; }
    setSavingEdit(true); setEditError(null);
    try {
      const r = await api.put(`${list.path}/${editId}`, { name });
      onChanged(sortByName(rows.map(c => (c.id === editId ? { ...c, ...r.data } : c))));
      setFlashId(editId);
      setEditId(null);
      toast.success(`${list.Noun} renamed to ${r.data.name}.`);
    } catch (err) {
      setEditError(err?.response?.data?.message || `The ${list.noun} could not be renamed. Try again.`);
    } finally { setSavingEdit(false); }
  };

  const remove = async (c) => {
    setDeletingId(c.id);
    try {
      await api.delete(`${list.path}/${c.id}`);
      onChanged(rows.filter(x => x.id !== c.id));
      setConfirmId(null);
      toast.success(`${list.Noun} ${c.name} deleted.`);
    } catch (err) {
      setConfirmId(null);
      setRowNotice({ id: c.id, message: err?.response?.data?.message || `The ${list.noun} could not be deleted. Try again.` });
    } finally { setDeletingId(null); }
  };

  // Escape inside an inline editor cancels the edit, not the dialog.
  const editKeys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  };

  const pluralNoun = list.noun === 'category' ? 'categories' : 'pack types';
  return (
    <>
      <div className="mfg-cat-add">
        <div style={{ flex: 1 }}>
          <label className="hr-sr-only" htmlFor="list-new">{list.placeholder}</label>
          <input
            id="list-new"
            className={`form-control${addError ? ' hr-invalid' : ''}`}
            placeholder={list.placeholder}
            value={newName}
            maxLength={list.maxLength}
            disabled={adding}
            onChange={e => { setNewName(e.target.value); setAddError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
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

      {rows.length === 0 ? (
        <div className="hr-lines-empty">{`No ${pluralNoun} added`}</div>
      ) : (
        <ul className="mfg-cat-list" aria-label={list.noun === 'category' ? 'Product categories' : 'Pack types'}>
          {rows.map(c => {
            const isEditing = editId === c.id;
            const used = c.product_count > 0;
            const renameLock = used ? list.lockedRename(c) : null;
            const deleteLock = used ? list.lockedDelete(c) : null;
            return (
              <li key={c.id} ref={el => { rowRefs.current[c.id] = el; }} className={`mfg-cat-row${flashId === c.id ? ' mfg-flash' : ''}`}>
                {isEditing ? (
                  <div className="mfg-cat-edit">
                    <div style={{ flex: 1 }}>
                      <label className="hr-sr-only" htmlFor={`list-edit-${c.id}`}>{`${list.Noun} name`}</label>
                      <input
                        id={`list-edit-${c.id}`}
                        className={`form-control${editError ? ' hr-invalid' : ''}`}
                        value={editName}
                        maxLength={list.maxLength}
                        disabled={savingEdit}
                        autoFocus
                        onChange={e => { setEditName(e.target.value); setEditError(null); }}
                        onKeyDown={editKeys}
                      />
                      {editError && (
                        <div className="hr-error" role="alert" style={{ marginTop: 4 }}>
                          <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{editError}</span>
                        </div>
                      )}
                    </div>
                    <BusyButton className="btn btn-primary btn-sm" busy={savingEdit} busyLabel="Saving…" onClick={saveEdit}>Save</BusyButton>
                    <button type="button" className="btn btn-outline btn-sm" onClick={cancelEdit} disabled={savingEdit}>Cancel</button>
                  </div>
                ) : confirmId === c.id ? (
                  <div className="mfg-cat-edit">
                    <span className="mfg-cat-name">{`Delete ${c.name}?`}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmId(null)} disabled={deletingId === c.id}>Cancel</button>
                    <BusyButton className="btn btn-danger btn-sm" busy={deletingId === c.id} busyLabel="Deleting…" onClick={() => remove(c)}>Delete</BusyButton>
                  </div>
                ) : (
                  <>
                    <span className="mfg-cat-name">{c.name}</span>
                    <span className="mfg-cat-count">{c.product_count ? plural(c.product_count, 'product', 'products') : 'Unused'}</span>
                    <button
                      type="button"
                      className="mfg-icon-btn"
                      aria-label={`Rename ${c.name}`}
                      aria-disabled={renameLock ? 'true' : undefined}
                      title={renameLock || 'Rename'}
                      onClick={() => startEdit(c)}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                    </button>
                    <button
                      type="button"
                      className="mfg-icon-btn is-danger"
                      aria-label={`Delete ${c.name}`}
                      aria-disabled={deleteLock ? 'true' : undefined}
                      title={deleteLock || 'Delete'}
                      onClick={() => (deleteLock ? setRowNotice({ id: c.id, message: deleteLock }) : (setConfirmId(c.id), setRowNotice(null), setEditId(null)))}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                    </button>
                  </>
                )}
                {rowNotice?.id === c.id && !isEditing && (
                  <div className="mfg-cat-notice" role="status">
                    <span className="material-symbols-outlined" aria-hidden="true">block</span>
                    {rowNotice.message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

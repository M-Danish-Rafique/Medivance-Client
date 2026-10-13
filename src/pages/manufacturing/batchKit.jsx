import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Modal from '../../components/common/Modal';
import { Panel, fmtAmount, fmtDate, num } from '../hr/HrKit';
import { todayPKT } from '../../utils/dateUtils';
import {
  EMPTY, NameWithTag, Info, Qty, Rate, Margin, allocate, round2, round4, normKey, parseNum, fmtQty, fmtPct, marginPct,
} from './mfgKit';

// ─── Batch kit ─────────────────────────────────────────────────────────────
// Shared by the batch editor (new / edit draft), the batch record and the
// printed batch sheet:
//   * computeBatchCosting  mirrors server/utils/manufacturing.js exactly
//   * buildBatchModel      the editor form -> the SAME shape GET /batches/:id
//                          returns, plus the "things to fix" list (shown
//                          once Create batch has been pressed)
//   * BatchSections        read-only section cards (record page)
//   * CostSummary          the sticky right-hand panel
//   * useUnsavedGuard      "Discard your changes?" on leaving a dirty form
// The server stays authoritative: Create batch re-checks everything.

export const SECTIONS = {
  batch: 'Batch',
  materials: 'Raw materials',
  packs: 'Packs',
  byproducts: 'By-products',
  costs: 'Other costs',
};

// ── Costing (mirror of the server) ─────────────────────────────────────────
export function computeBatchCosting({ materials, miscExpense, packs, byProducts }) {
  const materialLines = materials.map(m => ({ total: round2(m.qty * m.rate) }));
  const rawCost = round2(materialLines.reduce((s, m) => s + m.total, 0));
  const misc = round2(miscExpense || 0);
  const byLines = byProducts.map(b => ({ total: round2(b.qty * b.rate), costPerUnit: round4(b.rate) }));
  const byProductValue = round2(byLines.reduce((s, b) => s + b.total, 0));
  const sharedCost = round2(rawCost + misc - byProductValue);
  const shares = allocate(Math.max(sharedCost, 0), packs.map(p => p.packedBase));
  const packLines = packs.map((p, i) => {
    const packaging = p.packaging.map(x => ({ total: round2(x.qty * x.rate) }));
    const packagingCost = round2(packaging.reduce((s, x) => s + x.total, 0));
    const totalCost = round2(shares[i] + packagingCost);
    return { packaging, packagingCost, sharedCost: shares[i], totalCost, costPerUnit: p.units > 0 ? round4(totalCost / p.units) : 0 };
  });
  const packagingCost = round2(packLines.reduce((s, p) => s + p.packagingCost, 0));
  return {
    rawCost, packagingCost, miscExpense: misc, byProductValue, sharedCost,
    totalCost: round2(rawCost + packagingCost + misc), materials: materialLines, packs: packLines, byProducts: byLines,
  };
}

// ── Product groups: one entry per product NAME (+ category) ─────────────────
export function productGroups(products) {
  const groups = new Map();
  products.forEach(p => {
    const key = `${normKey(p.name)}|${p.category_id ?? ''}`;
    if (!groups.has(key)) groups.set(key, { key, name: p.name, category_id: p.category_id ?? null, category_name: p.category_name || null, packs: [] });
    groups.get(key).packs.push(p);
  });
  const list = [...groups.values()];
  const perName = new Map();
  list.forEach(g => perName.set(normKey(g.name), (perName.get(normKey(g.name)) || 0) + 1));
  list.forEach(g => {
    g.label = perName.get(normKey(g.name)) > 1 ? `${g.name} (${g.category_name || 'No category'})` : g.name;
    g.packs.sort((a, b) => num(a.volume) * num(a.vol_uom_factor) - num(b.volume) * num(b.vol_uom_factor));
  });
  return list.sort((a, b) => a.label.localeCompare(b.label));
}
export const groupKeyOf = (name, categoryId) => `${normKey(name)}|${categoryId ?? ''}`;

// ── The editor form ────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
export const newMaterialRow = () => ({ key: uid(), raw_material_id: '', qty: '' });
export const newPkgRow = () => ({ key: uid(), raw_material_id: '', qty: '', qtyTouched: false });
export const newPackRow = () => ({ key: uid(), product_id: '', units: '', packaging: [newPkgRow()] });
export const newByRow = () => ({ key: uid(), product_id: '', qty: '', batch_no: '', followsCode: true, exp_date: '', purchase_rate: '', sale_rate: '' });
/** A by-product's batch number when left to the system: the batch code plus
 *  "-BP" (server rule), so it never equals the batch code of the packs. */
export const byProductBatchNo = (batchCode) => (batchCode ? `${batchCode}-BP` : '');
/** A row's rates: what was typed, or the by-product's own rate when the row
 *  predates the rate fields (older drafts) or the purchase rate is hidden from
 *  this user (the server then applies the stored rate). */
const unset = (v) => v === undefined || v === null;
export const byRates = (row, prod) => ({
  purchase: unset(row.purchase_rate) || (row.purchase_rate === '' && unset(prod?.purchase_rate))
    ? num(prod?.purchase_rate) : parseNum(row.purchase_rate),
  sale: unset(row.sale_rate) ? num(prod?.sale_rate) : parseNum(row.sale_rate),
});
export const emptyForm = () => ({
  groupKey: '', output_qty: '', output_uom_id: '', batch_date: todayPKT(), expiry_date: '',
  materials: [newMaterialRow()], packs: [newPackRow()], byproducts: [], misc_expense: '', misc_note: '',
});

const blankMaterial = (m) => !m.raw_material_id && m.qty === '';
const blankPkg = (x) => !x.raw_material_id && x.qty === '';
const blankPack = (p) => !p.product_id && p.units === '' && p.packaging.every(blankPkg);

/**
 * The form -> { group, outUom, view, issues, warnings }.
 * `view` has the shape of GET /batches/:id so the record, the print sheet
 * and the cost summary all render it the same way. `issues` are blocking
 * (each with the section and the element id to scroll to); `warnings` are not.
 */
export function buildBatchModel(form, refs, batchCode) {
  const groups = productGroups(refs.products);
  const group = groups.find(g => g.key === form.groupKey) || null;
  const outUom = refs.uoms.find(u => String(u.id) === String(form.output_uom_id)) || null;
  const matById = new Map(refs.materials.map(m => [String(m.id), m]));
  const byById = new Map(refs.byProducts.map(b => [String(b.id), b]));
  const packById = new Map((group?.packs || []).map(p => [String(p.id), p]));
  const outFactor = num(outUom?.to_base_factor) || 1;
  const outputQty = parseNum(form.output_qty);
  const outputBase = outputQty > 0 && outUom ? outputQty * outFactor : 0;
  const issues = [];
  const warnings = [];
  const issue = (section, anchor, message) => issues.push({ section, anchor, message });

  // Batch
  if (!group) issue('batch', 'bf-product', 'Choose the product.');
  if (!(outputQty > 0)) issue('batch', 'bf-output', 'Enter the total output.');
  else if (!outUom) issue('batch', 'bf-output', 'Choose the unit of the total output.');
  else if (outUom.base_type === 'count' && !Number.isInteger(outputQty)) issue('batch', 'bf-output', `Enter a whole number of ${outUom.symbol} for the total output.`);
  if (!form.batch_date) issue('batch', 'bf-date', 'Enter the batch date.');
  else if (form.batch_date > todayPKT()) issue('batch', 'bf-date', 'The batch date cannot be in the future.');
  if (!form.expiry_date) issue('batch', 'bf-expiry', 'Enter the expiry date.');
  else if (form.batch_date && form.expiry_date <= form.batch_date) issue('batch', 'bf-expiry', 'The expiry date must be after the batch date.');

  // Raw materials (stock is checked over the whole batch, per material)
  const used = new Map();
  const take = (id, qty) => used.set(id, (used.get(id) || 0) + qty);
  const materials = [];
  const matRows = form.materials.filter(m => !blankMaterial(m));
  if (!matRows.length) issue('materials', `rm-${form.materials[0]?.key}-mat`, 'Add at least one raw material.');
  matRows.forEach(row => {
    const m = matById.get(String(row.raw_material_id));
    const qty = parseNum(row.qty);
    if (!m) { issue('materials', `rm-${row.key}-mat`, 'Choose a raw material on every line.'); return; }
    if (!(qty > 0)) { issue('materials', `rm-${row.key}-qty`, `Enter a quantity for ${m.name}.`); return; }
    if (m.base_type === 'count' && !Number.isInteger(qty)) { issue('materials', `rm-${row.key}-qty`, `Enter a whole number of ${m.uom_symbol} for ${m.name}.`); return; }
    take(m.id, qty);
    materials.push({ row, m, qty });
  });

  // Packs
  const packs = [];
  const packRows = form.packs.filter(p => !blankPack(p));
  if (!packRows.length) issue('packs', `pk-${form.packs[0]?.key}-size`, 'Add at least one pack size.');
  packRows.forEach(row => {
    const prod = packById.get(String(row.product_id));
    const units = parseNum(row.units);
    if (!prod) { issue('packs', `pk-${row.key}-size`, 'Choose a pack size on every row.'); return; }
    if (outUom && prod.vol_uom_base_type !== outUom.base_type) {
      issue('packs', `pk-${row.key}-size`, `${prod.pack_size} cannot be filled from an output measured in ${outUom.symbol}.`); return;
    }
    if (!Number.isInteger(units) || units <= 0) { issue('packs', `pk-${row.key}-units`, `Enter the number of units for ${prod.pack_size}.`); return; }
    const pkgRows = row.packaging.filter(x => !blankPkg(x));
    const pkgCell = `pk-${row.key}-pkg`;
    if (!pkgRows.length) { issue('packs', pkgCell, `Add the packaging for ${prod.pack_size}.`); return; }
    const packaging = [];
    let ok = true;
    pkgRows.forEach(x => {
      const m = matById.get(String(x.raw_material_id));
      const qty = parseNum(x.qty);
      if (!m) { issue('packs', pkgCell, `Choose the packaging material for ${prod.pack_size}.`); ok = false; return; }
      if (!Number.isInteger(qty) || qty <= 0) { issue('packs', pkgCell, `Enter a whole number of pcs of ${m.name} for ${prod.pack_size}.`); ok = false; return; }
      take(m.id, qty);
      packaging.push({ x, m, qty });
    });
    if (ok) packs.push({ row, prod, units, packaging, packedBase: units * num(prod.volume) * num(prod.vol_uom_factor) });
  });
  const packedBase = packs.reduce((s, p) => s + p.packedBase, 0);
  if (outputBase > 0 && packedBase > outputBase * (1 + 1e-9) + 1e-6) {
    issue('packs', 'packs-fill', `The packs hold ${fmtQty(packedBase / outFactor, outUom.symbol)}, more than the total output of ${fmtQty(outputQty, outUom.symbol)}.`);
  }

  // Stock shortfalls, per material, over raw materials and packaging together
  const shortfalls = [];
  used.forEach((qty, id) => {
    const m = matById.get(String(id));
    if (m && qty > num(m.stock_qty) + 1e-9) shortfalls.push({ m, qty, short: qty - num(m.stock_qty) });
  });
  shortfalls.forEach(({ m, short }) => {
    if (m.material_type === 'raw_material') {
      const row = matRows.find(r => String(r.raw_material_id) === String(m.id));
      issue('materials', row ? `rm-${row.key}-qty` : 'packs-fill', `${m.name} is short by ${fmtQty(short, m.uom_symbol)}.`);
      return;
    }
    // Packaging: every pack row that uses it shows the warning in its cell.
    const rows = packRows.filter(p => p.packaging.some(x => String(x.raw_material_id) === String(m.id)));
    if (!rows.length) { issue('packs', 'packs-fill', `${m.name} is short by ${fmtQty(short, m.uom_symbol)}.`); return; }
    rows.forEach(p => issue('packs', `pk-${p.key}-pkg`, `${m.name} is short by ${fmtQty(short, m.uom_symbol)}.`));
  });

  // By-products (optional, but a row that is there must be complete)
  const byproducts = [];
  form.byproducts.forEach(row => {
    const prod = byById.get(String(row.product_id));
    const qty = parseNum(row.qty);
    if (!prod) { issue('byproducts', `bp-${row.key}-prod`, 'Choose the by-product or remove the row.'); return; }
    if (!Number.isInteger(qty) || qty <= 0) { issue('byproducts', `bp-${row.key}-qty`, `Enter a whole-number quantity for ${prod.name}.`); return; }
    if (!row.followsCode && !row.batch_no.trim()) { issue('byproducts', `bp-${row.key}-no`, `Enter the batch number for ${prod.name}.`); return; }
    if (!row.followsCode && batchCode && normKey(row.batch_no) === normKey(batchCode)) {
      issue('byproducts', `bp-${row.key}-no`, `The batch number of ${prod.name} must differ from the batch code ${batchCode}.`); return;
    }
    if (!row.exp_date) { issue('byproducts', `bp-${row.key}-exp`, `Enter the expiry date for ${prod.name}.`); return; }
    if (form.batch_date && row.exp_date <= form.batch_date) { issue('byproducts', `bp-${row.key}-exp`, `The expiry date of ${prod.name} must be after the batch date.`); return; }
    const rates = byRates(row, prod);
    if (!(rates.purchase >= 0)) { issue('byproducts', `bp-${row.key}-prate`, `Enter the purchase rate of ${prod.name}.`); return; }
    if (!(rates.sale > 0)) { issue('byproducts', `bp-${row.key}-srate`, `Enter a sale rate greater than 0 for ${prod.name}.`); return; }
    byproducts.push({ row, prod, qty, rates });
  });

  // Other costs
  const misc = form.misc_expense === '' ? 0 : parseNum(form.misc_expense);
  if (!(misc >= 0)) issue('costs', 'bf-misc', 'Enter a miscellaneous expense of 0 or more.');

  const costing = computeBatchCosting({
    materials: materials.map(x => ({ qty: x.qty, rate: num(x.m.purchase_rate) })),
    miscExpense: misc >= 0 ? misc : 0,
    packs: packs.map(p => ({ units: p.units, packedBase: p.packedBase, packaging: p.packaging.map(x => ({ qty: x.qty, rate: num(x.m.purchase_rate) })) })),
    byProducts: byproducts.map(b => ({ qty: b.qty, rate: b.rates.purchase })),
  });
  if (costing.sharedCost < 0) {
    issue('byproducts', byproducts[0] ? `bp-${byproducts[0].row.key}-qty` : 'bf-misc',
      'The by-products are valued above the raw materials and expense. Lower a quantity or its purchase rate.');
  }

  const view = {
    batch_code: batchCode,
    product_name: group?.name || '',
    category_name: group?.category_name || null,
    batch_date: form.batch_date,
    expiry_date: form.expiry_date,
    total_volume: outputQty > 0 ? outputQty : null,
    vol_uom_symbol: outUom?.symbol || '',
    packed_volume: packedBase / outFactor,
    loss_volume: Math.max(0, (outputBase - packedBase) / outFactor),
    raw_material_cost: costing.rawCost,
    packaging_cost: costing.packagingCost,
    misc_expense: costing.miscExpense,
    misc_note: form.misc_note,
    byproduct_value: costing.byProductValue,
    shared_cost: costing.sharedCost,
    total_cost: costing.totalCost,
    materials: materials.map((x, i) => ({
      raw_material_id: x.m.id, rm_name: x.m.name, uom_symbol: x.m.uom_symbol, qty: x.qty,
      unit_cost: num(x.m.purchase_rate), total_cost: costing.materials[i].total,
    })),
    packs: packs.map((p, i) => ({
      product_id: p.prod.id, product_name: p.prod.name, pack_size: p.prod.pack_size, sale_rate: num(p.prod.sale_rate),
      units: p.units, packed_volume: p.packedBase / outFactor,
      shared_cost: costing.packs[i].sharedCost, packaging_cost: costing.packs[i].packagingCost,
      total_cost: costing.packs[i].totalCost, cost_per_unit: costing.packs[i].costPerUnit,
      packaging: p.packaging.map((x, j) => ({
        raw_material_id: x.m.id, rm_name: x.m.name, uom_symbol: x.m.uom_symbol, qty: x.qty,
        unit_cost: num(x.m.purchase_rate), total_cost: costing.packs[i].packaging[j].total,
      })),
    })),
    byproducts: byproducts.map((b, i) => ({
      product_id: b.prod.id, product_name: b.prod.name, pack_size: b.prod.pack_size,
      volume: num(b.prod.volume) || 1, uom_symbol: b.prod.vol_uom_symbol, qty: b.qty,
      unit_cost: costing.byProducts[i].costPerUnit, total_cost: costing.byProducts[i].total, sale_rate: b.rates.sale,
      batch_no: b.row.followsCode ? byProductBatchNo(batchCode) : b.row.batch_no.trim(), exp_date: b.row.exp_date,
    })),
  };

  view.packs.forEach(p => {
    if (p.sale_rate > 0 && p.cost_per_unit > p.sale_rate) {
      warnings.push(`${p.pack_size} costs more per unit than its sale rate.`);
    }
  });
  view.byproducts.forEach(b => {
    if (b.sale_rate > 0 && b.unit_cost > b.sale_rate) warnings.push(`${b.product_name} sells below its purchase rate.`);
  });

  return { groups, group, outUom, matById, byById, packById, view, issues, warnings, shortfalls, packedBase, outputBase, outFactor };
}

/** The editor form as saved in a draft (and restored from it). */
export function draftPayload(form, model) {
  return {
    product_name: model.group?.name || '',
    category_id: model.group?.category_id ?? null,
    output_qty: form.output_qty,
    output_uom_id: form.output_uom_id,
    batch_date: form.batch_date,
    expiry_date: form.expiry_date,
    misc_expense: form.misc_expense,
    misc_note: form.misc_note,
    packs: form.packs.map(p => ({ units: p.units })),
    form,
  };
}

/** The editor form as POST /batches expects it. */
export function createPayload(form, model, draftId) {
  return {
    draft_id: draftId || undefined,
    product_name: model.group?.name,
    category_id: model.group?.category_id ?? null,
    output_qty: form.output_qty,
    output_uom_id: form.output_uom_id,
    materials: form.materials.filter(m => !blankMaterial(m)).map(m => ({ raw_material_id: m.raw_material_id, qty: m.qty })),
    packs: form.packs.filter(p => !blankPack(p)).map(p => ({
      product_id: p.product_id, units: p.units,
      packaging: p.packaging.filter(x => !blankPkg(x)).map(x => ({ raw_material_id: x.raw_material_id, qty: x.qty })),
    })),
    // A rate left unset goes as null: the server uses the by-product's own rate.
    by_products: form.byproducts.filter(b => b.product_id).map(b => ({
      product_id: b.product_id, qty: b.qty, batch_no: b.followsCode ? null : b.batch_no.trim(), exp_date: b.exp_date,
      purchase_rate: unset(b.purchase_rate) || b.purchase_rate === '' ? null : b.purchase_rate,
      sale_rate: unset(b.sale_rate) || b.sale_rate === '' ? null : b.sale_rate,
    })),
    misc_expense: form.misc_expense === '' ? 0 : form.misc_expense,
    misc_note: form.misc_note || null,
    batch_date: form.batch_date,
    expiry_date: form.expiry_date,
  };
}

// ── Read-only section cards (record page) ──────────────────────────────────
const tabular = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

export function BatchFacts({ batch, codeLabel }) {
  const unit = batch.vol_uom_symbol;
  const units = batch.packs.reduce((s, p) => s + num(p.units), 0);
  const lossPct = num(batch.total_volume) > 0 ? (num(batch.loss_volume) / num(batch.total_volume)) * 100 : 0;
  return (
    <dl className="hr-kv hr-kv-4">
      <Fact label="Product" value={batch.category_name ? `${batch.product_name} (${batch.category_name})` : batch.product_name} />
      <Fact label="Batch code" value={codeLabel || batch.batch_code} />
      <Fact label="Batch date" value={batch.batch_date ? fmtDate(batch.batch_date) : null} />
      <Fact label="Expiry date" value={batch.expiry_date ? fmtDate(batch.expiry_date) : null} />
      <Fact label="Total output" value={num(batch.total_volume) > 0 ? fmtQty(batch.total_volume, unit) : null} />
      <Fact label="Packed" value={num(batch.total_volume) > 0 ? fmtQty(batch.packed_volume, unit) : null} />
      <Fact label="Loss" value={num(batch.total_volume) > 0 ? (num(batch.loss_volume) > 0 ? `${fmtQty(batch.loss_volume, unit)} (${fmtPct(lossPct)})` : 'None') : null} />
      <Fact label="Units" value={units > 0 ? fmtQty(units) : null} />
    </dl>
  );
}

function Fact({ label, value }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="hr-kv-row">
      <dt className="hr-kv-label">{label}</dt>
      <dd className={`hr-kv-value${empty ? ' is-empty' : ''}`}>{empty ? '—' : value}</dd>
    </div>
  );
}

export function MaterialsTable({ materials, total }) {
  if (!materials.length) return <div className="hr-lines-empty">No raw materials.</div>;
  return (
    <div className="mfg-doc-table">
      <table className="hr-table is-dense">
        <thead><tr>
          <th>Material</th>
          <th className="hr-th-num" style={{ width: '18%' }}>Quantity</th>
          <th className="hr-th-num" style={{ width: '16%' }}>Rate (PKR)</th>
          <th className="hr-th-num" style={{ width: '18%' }}>Amount (PKR)</th>
        </tr></thead>
        <tbody>
          {materials.map(m => (
            <tr key={m.raw_material_id}>
              <td>{m.rm_name}</td>
              <td className="hr-num"><Qty value={m.qty} unit={m.uom_symbol} /></td>
              <td className="hr-num"><Rate value={m.unit_cost} /></td>
              <td className="hr-num">{fmtAmount(m.total_cost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}>Total</td><td className="hr-num">{fmtAmount(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}

export function PacksTable({ packs, unit }) {
  if (!packs.length) return <div className="hr-lines-empty">No packs.</div>;
  return (
    <div className="mfg-doc-table is-wide">
      <table className="hr-table is-dense">
        <thead><tr>
          <th>Pack size</th>
          <th className="hr-th-num" style={{ width: '9%' }}>Units</th>
          <th className="hr-th-num" style={{ width: '11%' }}>Packed</th>
          <th className="hr-th-num" style={{ width: '14%' }}>Batch cost</th>
          <th className="hr-th-num" style={{ width: '12%' }}>Packaging</th>
          <th className="hr-th-num" style={{ width: '12%' }}>Total cost</th>
          <th className="hr-th-num" style={{ width: '12%' }}>Cost / unit</th>
          <th className="hr-th-num" style={{ width: '9%' }}>Margin</th>
        </tr></thead>
        <tbody>
          {packs.map(p => (
            <React.Fragment key={p.product_id}>
              <tr>
                <td className="hr-cell-strong">{p.pack_size}</td>
                <td className="hr-num">{fmtQty(p.units)}</td>
                <td className="hr-num">{p.packed_volume == null ? EMPTY : <Qty value={p.packed_volume} unit={unit} />}</td>
                <td className="hr-num">{fmtAmount(p.shared_cost)}</td>
                <td className="hr-num">{fmtAmount(p.packaging_cost)}</td>
                <td className="hr-num">{fmtAmount(p.total_cost)}</td>
                <td className="hr-num hr-cell-total"><Rate value={p.cost_per_unit} /></td>
                <td className="hr-num"><Margin sale={p.sale_rate} cost={p.cost_per_unit} /></td>
              </tr>
              {p.packaging.length > 0 && (
                <tr className="mfg-subrow">
                  <td colSpan={8} style={{ paddingLeft: 24 }}>
                    {p.packaging.map(x => `${x.rm_name} ${fmtQty(x.qty, x.uom_symbol)} at ${fmtAmount(x.unit_cost)}`).join(' · ')}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A by-product quantity in its unit ("60 kg"). A by-product the unit-only
 *  migration could not convert ("25 kg Bag") counts packs: "4 × 25 kg Bag". */
export function byQtyLabel(b) {
  const unit = b.uom_symbol || b.pack_size;
  return !b.pack_size || b.pack_size === unit ? fmtQty(b.qty, unit) : `${fmtQty(b.qty)} × ${b.pack_size}`;
}

/**
 * What a by-product's two rates mean (the (i) beside each). `unit` is the
 * by-product's unit when every row uses the same one, else "unit"; `name` its
 * name when there is one row, else "the by-product". `master` = the
 * By-products list and form, where the rate is the starting point of each
 * batch.
 */
export const byRateInfo = {
  purchase: ({ unit, name, master }) => [
    `The value of 1 ${unit} of ${name} produced in ${master ? 'a' : 'this'} batch.`,
    'The by-product value (quantity × purchase rate) is subtracted from the batch cost, so the manufactured packs carry a lower cost.',
    "This value also becomes the by-product's cost in inventory, used to work out its profit when it is sold.",
    'Example: a batch costs PKR 50,000 and gives 100 kg at PKR 40. The by-product value is PKR 4,000, so the packs carry PKR 46,000.',
    master ? 'Each batch starts from this rate and can change it for its own stock.' : 'Leave it at 0 to keep the full batch cost on the packs.',
  ],
  sale: ({ unit, name, master }) => [
    `The price of 1 ${unit} of ${name} when it is sold to a customer.`,
    'It fills in the rate on the sale invoice, where it can still be changed.',
    'It does not affect the batch cost.',
    master ? 'Each batch starts from this rate and can change it for its own stock.' : "Starts from the by-product's sale rate; a change here applies only to this batch.",
  ],
};
/** { unit, name } for the texts from by-product rows ({ name, unit }). */
export function byInfoContext(rows) {
  const units = [...new Set(rows.map(r => r.unit).filter(Boolean))];
  return {
    unit: units.length === 1 && rows.every(r => r.unit) ? units[0] : 'unit',
    name: rows.length === 1 && rows[0].name ? rows[0].name : 'the by-product',
  };
}
/** The two column headers: "Purchase rate (i)" and "Sale rate (i)". */
export function ByRateInfo({ which, ctx }) {
  return <Info title={which === 'purchase' ? 'Purchase rate' : 'Sale rate'}>{byRateInfo[which](ctx)}</Info>;
}
export function ByRateHead({ which, ctx }) {
  return <>{which === 'purchase' ? 'Purchase rate' : 'Sale rate'}<ByRateInfo which={which} ctx={ctx} /></>;
}

export function ByproductsTable({ byproducts }) {
  if (!byproducts.length) return <div className="hr-lines-empty">No by-products.</div>;
  const ctx = byInfoContext(byproducts.map(b => ({ name: b.product_name, unit: b.uom_symbol || b.pack_size })));
  return (
    <div className="mfg-doc-table is-wide is-nowrap-head">
      <table className="hr-table is-dense">
        <thead><tr>
          <th>By-product</th>
          <th className="hr-th-num">Qty</th>
          <th>Batch no.</th>
          <th>Expiry</th>
          <th className="hr-th-num"><ByRateHead which="purchase" ctx={ctx} /></th>
          <th className="hr-th-num"><ByRateHead which="sale" ctx={ctx} /></th>
        </tr></thead>
        <tbody>
          {byproducts.map(b => (
            <tr key={b.product_id}>
              <td className="hr-cell-strong"><NameWithTag name={b.product_name} tag={b.pack_size} /></td>
              <td className="hr-num" style={tabular}>{byQtyLabel(b)}</td>
              <td style={tabular}>{b.batch_no || EMPTY}</td>
              <td style={tabular}>{b.exp_date ? fmtDate(b.exp_date) : EMPTY}</td>
              <td className="hr-num"><Rate value={b.unit_cost} /></td>
              <td className="hr-num">{num(b.sale_rate) > 0 ? fmtAmount(b.sale_rate) : EMPTY}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BatchSections({ batch, codeLabel }) {
  return (
    <>
      <Panel title="Batch"><BatchFacts batch={batch} codeLabel={codeLabel} /></Panel>
      <Panel title="Raw materials" status={num(batch.raw_material_cost) > 0 ? `PKR ${fmtAmount(batch.raw_material_cost)}` : undefined}>
        <MaterialsTable materials={batch.materials} total={batch.raw_material_cost} />
      </Panel>
      <Panel title="Packs" status={batch.packs.length ? `${fmtQty(batch.packs.reduce((s, p) => s + num(p.units), 0))} units` : undefined}>
        <PacksTable packs={batch.packs} unit={batch.vol_uom_symbol} />
      </Panel>
      <Panel title="By-products"
        actions={batch.byproducts.length ? <span className="mfg-head-figure">By-product value<strong>{`PKR ${fmtAmount(batch.byproduct_value)}`}</strong></span> : undefined}>
        <ByproductsTable byproducts={batch.byproducts} />
      </Panel>
      <Panel title="Other costs">
        <dl className="hr-kv hr-kv-2">
          <Fact label="Miscellaneous expense" value={`PKR ${fmtAmount(batch.misc_expense)}`} />
          <Fact label="Note" value={batch.misc_note} />
        </dl>
      </Panel>
    </>
  );
}

// ── Cost summary (sticky right panel) ──────────────────────────────────────
// Only the costs until Create batch has been pressed (`attempted`); then also
// the red "N things to fix" list, each line a link to its field.
export function CostSummary({ view, issues, attempted, warnings, shortfalls, onJump, title = 'Cost summary' }) {
  const rows = [
    ['Raw materials', view.raw_material_cost],
    ['Packaging', view.packaging_cost],
    ['Miscellaneous', view.misc_expense],
  ];
  return (
    <aside className="mfg-summary" aria-label={title}>
      <div className="mfg-summary-title">{title}</div>
      <div className="mfg-summary-lines">
        {rows.map(([label, value]) => (
          <div key={label} className="mfg-summary-line"><span>{label}</span><span>{fmtAmount(value)}</span></div>
        ))}
        <div className="mfg-summary-line"><span>Less by-product value</span><span>{num(view.byproduct_value) > 0 ? `(${fmtAmount(view.byproduct_value)})` : fmtAmount(0)}</span></div>
        <div className="mfg-summary-line is-total">
          <span>Total</span>
          <span>PKR {fmtAmount(num(view.total_cost) - num(view.byproduct_value))}</span>
        </div>
      </div>

      {view.packs.length > 0 && (
        <div className="mfg-summary-block">
          <div className="mfg-summary-sub">Per pack size</div>
          <table className="mfg-summary-packs">
            <thead><tr><th>Pack</th><th>Cost / unit</th><th>Sale rate</th><th>Margin</th></tr></thead>
            <tbody>
              {view.packs.map(p => {
                const m = marginPct(p.sale_rate, p.cost_per_unit);
                return (
                  <tr key={p.product_id}>
                    {/* "100 ml" never splits; a pack type may wrap below it. */}
                    <td>{String(p.pack_size).replace(/^(\S+) (\S+)/, '$1 $2')}</td>
                    <td><Rate value={p.cost_per_unit} /></td>
                    <td>{fmtAmount(p.sale_rate)}</td>
                    <td className={m !== null && m < 0 ? 'mfg-neg' : undefined}>{m === null ? '—' : fmtPct(m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(warnings?.length > 0 || shortfalls?.length > 0) && (
        <div className="mfg-summary-block">
          {warnings.map(w => (
            <div key={w} className="mfg-summary-warn"><span className="material-symbols-outlined" aria-hidden="true">warning</span>{w}</div>
          ))}
          {shortfalls.map(({ m, short }) => (
            <div key={m.id} className="mfg-summary-warn"><span className="material-symbols-outlined" aria-hidden="true">inventory</span>{`${m.name}: short by ${fmtQty(short, m.uom_symbol)}`}</div>
          ))}
        </div>
      )}

      {attempted && issues?.length > 0 && (
        <div className="mfg-summary-block" id="summary-issues" tabIndex={-1} style={{ outline: 'none' }}>
          <div className="mfg-summary-fix" role="status">{issues.length === 1 ? '1 thing to fix' : `${issues.length} things to fix`}</div>
          <ul className="mfg-summary-issues">
            {issues.map((it, i) => (
              <li key={`${it.anchor}-${i}`}>
                <button type="button" onClick={() => onJump(it)}>
                  <span className="mfg-summary-sec">{SECTIONS[it.section]}</span>{it.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

// ── Send to inventory: confirmation listing every item ─────────────────────
// `batch` is a full GET /batches/:id. Packs go in under the batch code and the
// batch expiry; by-products under their own batch number and expiry.
export function SendToInventoryDialog({ batch, busy, error, onCancel, onConfirm }) {
  const rows = batch ? [
    ...batch.packs.map(p => ({ key: `p${p.product_id}`, name: p.product_name, tag: p.pack_size, qty: fmtQty(p.units, 'units'), batchNo: batch.batch_code, exp: batch.expiry_date })),
    ...batch.byproducts.map(b => ({ key: `b${b.product_id}`, name: b.product_name, tag: b.pack_size, qty: byQtyLabel(b), batchNo: b.batch_no, exp: b.exp_date, by: true })),
  ] : [];
  return (
    <Modal
      isOpen={!!batch}
      onClose={() => { if (!busy) onCancel(); }}
      title={batch ? `Send batch ${batch.batch_code} to inventory?` : ''}
      size="lg"
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Sending…' : 'Send to inventory'}
          </button>
        </>
      }
    >
      {batch && (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.55 }}>
            These items are added to inventory and can then be sold on invoices. The batch becomes read-only.
          </p>
          <div className="mfg-doc-table">
            <table className="hr-table is-dense">
              <thead><tr>
                <th>Item</th>
                <th className="hr-th-num" style={{ width: '16%' }}>Quantity</th>
                <th style={{ width: '20%' }}>Batch no.</th>
                <th style={{ width: '16%' }}>Expiry</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td>
                      <NameWithTag name={r.name} tag={r.tag} />
                      {r.by && <span className="mfg-sub" style={{ marginLeft: 8 }}>By-product</span>}
                    </td>
                    <td className="hr-num">{r.qty}</td>
                    <td style={tabular}>{r.batchNo}</td>
                    <td style={tabular}>{fmtDate(r.exp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div className="hr-notice is-danger" role="alert" style={{ marginTop: 12 }}><span className="material-symbols-outlined hr-notice-icon" aria-hidden="true">error</span><div className="hr-notice-body">{error}</div></div>}
        </>
      )}
    </Modal>
  );
}

/** Open the printable batch sheet in a new tab. */
export const openBatchSheet = (id) => window.open(`/manufacturing/batches/${id}/print`, '_blank', 'noopener');

// ── Unsaved changes guard ──────────────────────────────────────────────────
// The app uses <BrowserRouter>, which has no navigation blocker, so the guard
// covers the three ways out of a dirty form by hand: in-app links (capture
// phase, before React Router sees the click), Back (a guard entry on the
// history stack) and reload / close tab (beforeunload).
export function useUnsavedGuard(dirty) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(null);      // { href } | { back: true }
  const armed = useRef(false);
  const off = useRef(false);
  const ignorePop = useRef(false);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { if (!off.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onClick = (e) => {
      if (off.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
      const href = a.pathname + a.search + a.hash;
      if (href === location.pathname + location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ href });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, location.pathname, location.search]);

  // Back button: keep one extra entry for this page while the form is dirty.
  useEffect(() => {
    if (dirty && !armed.current) {
      window.history.pushState({ ...window.history.state, mfgGuard: true }, '');
      armed.current = true;
    } else if (!dirty && armed.current) {
      armed.current = false;
      ignorePop.current = true;
      window.history.back();
    }
  }, [dirty]);
  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      if (off.current || !armed.current) return;
      window.history.pushState({ ...window.history.state, mfgGuard: true }, '');
      setPending({ back: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Leave without asking (after a save, or after Discard). */
  const leave = useCallback((to, opts) => {
    off.current = true;
    if (armed.current) {
      armed.current = false;
      navigate(to, { ...opts, replace: true });
    } else {
      navigate(to, opts);
    }
  }, [navigate]);

  const confirmLeave = useCallback((to) => setPending({ href: to }), []);

  const dialog = (
    <Modal
      isOpen={!!pending}
      onClose={() => setPending(null)}
      title="Discard your changes?"
      size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => setPending(null)}>Keep editing</button>
          <button
            className="btn btn-danger"
            onClick={() => {
              const p = pending;
              setPending(null);
              off.current = true;
              if (p.back) { armed.current = false; window.history.go(-2); }
              else leave(p.href);
            }}
          >
            Discard changes
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.55 }}>
        Changes made since the last save are not kept.
      </p>
    </Modal>
  );

  return { leave, confirmLeave, dialog };
}

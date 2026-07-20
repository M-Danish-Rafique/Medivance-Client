import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import { formatCurrency, formatDecimal } from '../../utils/formatters';
import { formatDatePKT } from '../../utils/dateUtils';
import toast from 'react-hot-toast';

const emptyYieldItem = {
  product_id: '', units_manufactured: '', pack_volume: '', pack_volume_uom_id: '',
  packaging_material_ids: [],
  _product: null,
  _batch_cost_per_unit: 0, _pkg_cost_per_unit: 0, _total_unit_cost: 0, _unit_cost_with_tax: 0,
  _volume_base: 0, _profit_pct: null, _sale_rate: 0,
};

const fmtPKR = formatCurrency;
const fmtPKR2 = formatCurrency;

export default function Yields() {
  const [yields, setYields] = useState([]);
  const [batches, setBatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [packagingMaterials, setPackagingMaterials] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [profitAlerts, setProfitAlerts] = useState([]);
  const [alertModal, setAlertModal] = useState(false);

  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [yieldItems, setYieldItems] = useState([{ ...emptyYieldItem }]);
  const [pkgMenuIndex, setPkgMenuIndex] = useState(null);
  const [pkgTempSelection, setPkgTempSelection] = useState([]);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/manufacturing/yields'),
      api.get('/manufacturing/batches'),
      api.get('/products'),
      api.get('/raw-materials?type=packaging_material'),
      api.get('/raw-materials/uom'),
    ]).then(([y, b, p, pkg, uom]) => {
      setYields(y.data);
      setBatches(b.data.filter(b => b.status === 'open'));
      setProducts(p.data.filter(p => p.is_manufactured));
      setPackagingMaterials(pkg.data);
      setUoms(uom.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  /* ─── When batch is selected, load its full detail ─── */
  const handleBatchSelect = async (batchId) => {
    setSelectedBatchId(batchId);
    setYieldItems([{ ...emptyYieldItem }]);
    if (!batchId) { setSelectedBatch(null); return; }
    try {
      const r = await api.get(`/manufacturing/batches/${batchId}`);
      setSelectedBatch(r.data);
    } catch { toast.error('Error loading batch'); }
  };

  /* ─── Compute per-item costs live ─── */
  const computeItem = (item, batch) => {
    if (!batch || !item.product_id || !item.pack_volume || !item.pack_volume_uom_id) return item;
    const uom = uoms.find(u => u.id === parseInt(item.pack_volume_uom_id));
    const packFactor = parseFloat(uom?.to_base_factor || 1);
    const packVolumeBase = parseFloat(item.pack_volume) * packFactor;

    const batchCostPerUnit = parseFloat(batch.cost_per_base_unit || 0) * packVolumeBase;

    let pkgCostPerUnit = 0;
    if (Array.isArray(item.packaging_material_ids) && item.packaging_material_ids.length > 0) {
      pkgCostPerUnit = item.packaging_material_ids.reduce((sum, id) => {
        const pkgMat = packagingMaterials.find(p => p.id === parseInt(id));
        return sum + parseFloat(pkgMat?.cost_per_unit || 0);
      }, 0);
    }

    const totalUnitCost = batchCostPerUnit + pkgCostPerUnit;
    const prod = products.find(p => p.id === parseInt(item.product_id));
    const taxRate = prod?.tax_applicable ? parseFloat(prod.sale_tax_pct || 0) : 0;
    const unitCostWithTax = totalUnitCost * (1 + taxRate / 100);
    const saleRate = parseFloat(prod?.sale_rate || 0);
    const profitPct = saleRate > 0 ? ((saleRate - unitCostWithTax) / saleRate * 100) : null;
    const volumeBase = packVolumeBase * parseInt(item.units_manufactured || 0);

    return { ...item, _pack_volume_base: packVolumeBase, _batch_cost_per_unit: batchCostPerUnit, _pkg_cost_per_unit: pkgCostPerUnit, _total_unit_cost: totalUnitCost, _unit_cost_with_tax: unitCostWithTax, _sale_rate: saleRate, _profit_pct: profitPct, _volume_base: volumeBase, _product: prod, _tax_rate: taxRate };
  };

  const updateItem = (idx, field, value) => {
    setYieldItems(prev => {
      const updated = [...prev];
      let item = { ...updated[idx], [field]: value };
      // Auto-fill pack volume and UOM from product definition when product is selected
      if (field === 'product_id' && value) {
        const prod = products.find(p => p.id === parseInt(value));
        if (prod) {
          if (prod.volume) item.pack_volume = prod.volume;
          if (prod.volume_uom_id) item.pack_volume_uom_id = String(prod.volume_uom_id);
        }
      }
      updated[idx] = computeItem(item, selectedBatch);
      return updated;
    });
  };

  /* ─── Total volume check ─── */
  const totalPackagedBase = useMemo(() =>
    yieldItems.reduce((s, i) => s + (parseFloat(i._volume_base) || 0), 0),
    [yieldItems]
  );

  const batchVolumeBase = useMemo(() => {
    if (!selectedBatch) return 0;
    const uom = uoms.find(u => u.id === parseInt(selectedBatch.volume_uom_id));
    return parseFloat(selectedBatch.total_volume) * parseFloat(uom?.to_base_factor || 1);
  }, [selectedBatch, uoms]);

  const volumeDiff = Math.abs(totalPackagedBase - batchVolumeBase);
  const volumeOk = batchVolumeBase > 0 && volumeDiff <= batchVolumeBase * 0.01 + 1;

  /* ─── Save ─── */
  const handleSave = async () => {
    if (!selectedBatchId) return toast.error('Select a batch');
    const validItems = yieldItems.filter(i => i.product_id && i.units_manufactured && i.pack_volume && i.pack_volume_uom_id);
    if (!validItems.length) return toast.error('Add at least one yield item');
    if (!volumeOk) return toast.error(`Volume mismatch: batch has ${formatDecimal(batchVolumeBase)} base units, yield uses ${formatDecimal(totalPackagedBase)}`);

    // Check if any sale rate < cost
    for (const item of validItems) {
      if (item._sale_rate > 0 && item._unit_cost_with_tax > item._sale_rate) {
        return toast.error(`Product "${item._product?.name}": purchase cost (${fmtPKR2(item._unit_cost_with_tax)}) exceeds sale rate (${fmtPKR2(item._sale_rate)}). Adjust sale rate first.`);
      }
    }

    setSaving(true);
    try {
      const res = await api.post('/manufacturing/yields', { batch_id: selectedBatchId, items: validItems });
      if (res.data.profit_alerts?.length) {
        setProfitAlerts(res.data.profit_alerts);
        setAlertModal(true);
      } else {
        toast.success(`Yield ${res.data.yield_code} created! Products added to inventory.`);
      }
      setModal(false);
      setSelectedBatchId(''); setSelectedBatch(null); setYieldItems([{ ...emptyYieldItem }]);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error creating yield');
    } finally { setSaving(false); }
  };

  const openView = async (y) => {
    try {
      const r = await api.get(`/manufacturing/yields/${y.id}`);
      setViewData(r.data); setViewModal(true);
    } catch { toast.error('Error loading yield'); }
  };

  const volUom = uoms.find(u => u.id === parseInt(selectedBatch?.volume_uom_id));

  return (
    <Layout title="Manufacturing — Yield (End Products)">
      {/* Profit alert modal */}
      {alertModal && (
        <div className="modal-backdrop">
          <div className="modal modal-sm">
            <div className="modal-header">
              <div className="modal-title"><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>warning</span>Low Profit Warning</div>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                The following products have profit margin below 15%. Consider adjusting their sale rate.
              </div>
              {profitAlerts.map((a, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>Product ID: {a.product_id}</div>
                  <div>Cost: {fmtPKR2(a.cost)} | Sale Rate: {fmtPKR2(a.sale_rate)} | Profit: <strong style={{ color: 'var(--red)' }}>{formatDecimal(a.profit_pct, 1)}%</strong></div>
                </div>
              ))}
              <p style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 10 }}>Yield has been saved. Update sale rates from the Products module.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { setAlertModal(false); setProfitAlerts([]); toast.success('Yield created! Products added to inventory.'); }}>Understood</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Yield — End Products</div>
            <div className="text-sm text-muted mt-1">{yields.length} yield records</div>
          </div>
          <button className="btn btn-primary" onClick={() => { setSelectedBatchId(''); setSelectedBatch(null); setYieldItems([{ ...emptyYieldItem }]); setModal(true); }}>+ Add Yield</button>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading-center"><div className="spinner" /></div>
          : yields.length === 0
            ? <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory_2</span></div><div className="empty-state-title">No yields yet</div><div className="empty-state-desc">Create a yield from an open batch</div></div>
            : <table>
                <thead>
                  <tr><th>Batch Code</th><th>Batch Date</th><th>Expiry</th><th>Items</th><th>Total Cost</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {yields.map(y => (
                    <tr key={y.id}>
                      <td className="mono" style={{ color: 'var(--gray-700)' }}>{y.batch_code}</td>
                      <td>{formatDatePKT(y.batch_date)}</td>
                      <td>{formatDatePKT(y.expiry_date)}</td>
                      <td>{y.item_count} SKUs</td>
                      <td style={{ fontWeight: 700 }}>{fmtPKR2(y.total_cost)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-outline btn-sm btn-icon" title="View yield" onClick={() => openView(y)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
        </div>
      </div>

      {/* Yield Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Create Yield — End Products from Batch" size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div style={{ display: 'flex', gap: 16, fontSize: 13, alignItems: 'center' }}>
              {selectedBatch && (
                <>
                  <span>Batch Volume: <strong>{formatDecimal(selectedBatch.total_volume)} {volUom?.symbol}</strong> ({formatDecimal(batchVolumeBase)})</span>
                  <span>Packaged: <strong style={{ color: volumeOk ? 'var(--green)' : 'var(--red)' }}>{formatDecimal(totalPackagedBase)} base</strong></span>
                  {!volumeOk && batchVolumeBase > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}>Volume mismatch: {formatDecimal(volumeDiff)} units off</span>}
                  {volumeOk && batchVolumeBase > 0 && <span style={{ color: 'var(--green)', fontWeight: 700 }}>Volume matched</span>}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving || !volumeOk}>
                {saving ? 'Creating...' : 'Create Yield & Add to Inventory'}
              </button>
            </div>
          </div>
        }>

        {/* Batch selection */}
        <div className="form-group" style={{ marginBottom: 20 }}>
          <label className="form-label">Select Open Batch *</label>
          <select className="form-control" style={{ maxWidth: 400 }} value={selectedBatchId} onChange={e => handleBatchSelect(e.target.value)}>
            <option value="">— Select a batch —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.batch_code} — {b.category_name || 'No Category'} — {formatDecimal(b.total_volume)} {b.vol_uom_symbol} — {fmtPKR2(b.total_cost)}</option>)}
          </select>
        </div>

        {selectedBatch && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 18, padding: '10px 14px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 10, fontSize: 12 }}>
            <div><span style={{ color: 'var(--gray-500)' }}>Batch:</span> <strong>{selectedBatch.batch_code}</strong></div>
            <div><span style={{ color: 'var(--gray-500)' }}>Expiry:</span> <strong>{formatDatePKT(selectedBatch.expiry_date)}</strong></div>
            <div><span style={{ color: 'var(--gray-500)' }}>Total Cost:</span> <strong>{fmtPKR2(selectedBatch.total_cost)}</strong></div>
            <div><span style={{ color: 'var(--gray-500)' }}>Cost/base unit:</span> <strong>{fmtPKR(selectedBatch.cost_per_base_unit)}</strong></div>
          </div>
        )}

        <div className="divider" />
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gray-700)', marginBottom: 10 }}>
          Yield Items — Define packaged SKUs
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.7fr 1fr 1fr 1fr 36px', gap: 5, padding: '5px 8px', background: 'var(--gray-50)', borderRadius: 6, marginBottom: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase' }}>
          <span>Product</span><span>Units</span><span>Pack Vol</span><span>Vol UOM</span><span>Packaging Mat.</span><span>Batch Cost/u</span><span>Pkg Cost/u</span><span>Total Cost/u</span><span></span>
        </div>

        {yieldItems.map((item, idx) => {
          const profitColor = item._profit_pct === null ? 'var(--gray-400)'
            : item._unit_cost_with_tax > item._sale_rate ? 'var(--red)'
            : item._profit_pct < 15 ? 'var(--amber)' : 'var(--green)';

          return (
            <div key={idx} style={{ marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.7fr 1fr 1fr 1fr 36px', gap: 5, alignItems: 'center', padding: '7px 8px', background: 'white', border: `1.5px solid ${item._profit_pct !== null && item._unit_cost_with_tax > item._sale_rate ? 'var(--red)' : item._profit_pct !== null && item._profit_pct < 15 ? '#fde68a' : 'var(--gray-200)'}`, borderRadius: 8 }}>
                <select className="form-control" style={{ fontSize: 12, padding: '5px 7px' }}
                  value={item.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)}>
                  <option value="">— Product —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.pack_size || '—'})</option>)}
                </select>
                <input className="form-control" type="number" style={{ fontSize: 12, padding: '5px 7px' }} placeholder="Units"
                  value={item.units_manufactured} onChange={e => updateItem(idx, 'units_manufactured', e.target.value)} />
                <input className="form-control" type="number" step="0.01" style={{ fontSize: 12, padding: '5px 7px' }} placeholder="Vol"
                  value={item.pack_volume} onChange={e => updateItem(idx, 'pack_volume', e.target.value)} />
                <select className="form-control" style={{ fontSize: 12, padding: '5px 7px' }}
                  value={item.pack_volume_uom_id} onChange={e => updateItem(idx, 'pack_volume_uom_id', e.target.value)}>
                  <option value="">— UOM —</option>
                  {uoms.filter(u => u.base_type !== 'count').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => {
                    setPkgMenuIndex(idx);
                    // normalize temp selection to strings for checkbox matching
                    setPkgTempSelection(Array.isArray(item.packaging_material_ids) ? item.packaging_material_ids.map(String) : []);
                  }}>{(item.packaging_material_ids?.length) ? `+Add (${item.packaging_material_ids.length})` : '+Add'}</button>
                  {pkgMenuIndex === idx && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 60, background: 'white', border: '1px solid var(--gray-200)', boxShadow: '0 6px 18px rgba(0,0,0,0.08)', padding: 12, borderRadius: 8, marginTop: 6, minWidth: 260 }}>
                      <div style={{ maxHeight: 220, overflow: 'auto' }}>
                        {packagingMaterials.map(p => (
                          <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 4px' }}>
                            <input type="checkbox" checked={pkgTempSelection.includes(String(p.id)) || pkgTempSelection.includes(p.id)} onChange={e => {
                              const val = String(p.id);
                              setPkgTempSelection(prev => e.target.checked ? Array.from(new Set([...prev, val])) : prev.filter(x => x !== val));
                            }} />
                            <span style={{ fontSize: 13 }}>{p.name}{p.volume ? ` (${p.volume}${p.vol_uom_symbol || ''})` : ''}</span>
                          </label>
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => { setPkgMenuIndex(null); setPkgTempSelection([]); }}>Cancel</button>
                        <button className="btn btn-primary btn-sm" onClick={() => { updateItem(idx, 'packaging_material_ids', pkgTempSelection.map(x => parseInt(x))); setPkgMenuIndex(null); setPkgTempSelection([]); }}>Continue</button>
                      </div>
                    </div>
                  )}
                </div>
              {/* Selected packaging materials count shown on button; chips removed to keep row height consistent */}
              <div style={{ fontSize: 11, textAlign: 'right', color: 'var(--gray-600)', padding: '0 4px' }}>
                {item._batch_cost_per_unit > 0 ? fmtPKR(item._batch_cost_per_unit) : '—'}
              </div>
                <div style={{ fontSize: 11, textAlign: 'right', color: 'var(--gray-600)', padding: '0 4px' }}>
                  {item._pkg_cost_per_unit > 0 ? fmtPKR(item._pkg_cost_per_unit) : '—'}
                </div>
                <div style={{ fontSize: 11, textAlign: 'right', fontWeight: 700, color: 'var(--navy)', padding: '0 4px' }}>
                  {item._unit_cost_with_tax > 0 ? fmtPKR2(item._unit_cost_with_tax) : '—'}
                </div>
                <button className="btn btn-danger btn-icon btn-sm" onClick={() => setYieldItems(p => p.filter((_, i) => i !== idx))}
                  disabled={yieldItems.length === 1} aria-label="Remove row"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, borderRadius: 4, lineHeight: 1, boxSizing: 'border-box' }}>
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
                    <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {/* Per-row info strip */}
              {item._product && item._unit_cost_with_tax > 0 && (
                <div style={{ display: 'flex', gap: 16, padding: '5px 10px', background: 'var(--gray-50)', borderRadius: '0 0 8px 8px', fontSize: 11, borderTop: 'none' }}>
                  <span style={{ color: 'var(--gray-500)' }}>Sale Rate: <strong>{fmtPKR2(item._sale_rate)}</strong></span>
                  {item._tax_rate > 0 && <span style={{ color: 'var(--gray-500)' }}>Tax: <strong>{item._tax_rate}%</strong></span>}
                  <span style={{ color: 'var(--gray-500)' }}>Volume used: <strong>{formatDecimal(item._volume_base)} base units</strong></span>
                  <span style={{ fontWeight: 700, color: profitColor }}>
                    Profit: {item._profit_pct !== null ? `${formatDecimal(item._profit_pct, 1)}%` : '—'}
                    {item._unit_cost_with_tax > item._sale_rate && ' ⛔ Cost exceeds sale rate!'}
                    {item._profit_pct !== null && item._profit_pct >= 0 && item._profit_pct < 15 && item._unit_cost_with_tax <= item._sale_rate && ' ⚠ Below 15%'}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <button className="btn btn-outline btn-sm mt-2" onClick={() => setYieldItems(p => [...p, { ...emptyYieldItem }])}>+ Add Product Row</button>
      </Modal>

      {/* View Yield Modal */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title={`Yield: ${viewData?.yield_code}`} size="lg">
        {viewData && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Yield Code', val: viewData.yield_code },
                { label: 'Batch Code', val: viewData.batch_code },
                { label: 'Batch Date', val: formatDatePKT(viewData.batch_date) },
                { label: 'Expiry', val: formatDatePKT(viewData.expiry_date) },
                { label: 'Total Batch Cost', val: fmtPKR2(viewData.total_cost) },
              ].map((s, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8, minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontWeight: 700 }}>{s.val}</div>
                </div>
              ))}
            </div>
            <table>
              <thead>
                <tr><th>Product</th><th>Units</th><th>Pack Vol</th><th>Packaging Materials</th><th>Batch Cost/u</th><th>Pkg Cost/u</th><th>Total Cost/u</th><th>Added to Inv.</th></tr>
              </thead>
              <tbody>
                {(viewData.items || []).map((item, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                    <td>{item.units_manufactured}</td>
                    <td>{formatDecimal(item.pack_volume)} {item.pack_uom_symbol || ''}</td>
                    <td>{item.pkg_material_names || '—'}</td>
                    <td className="mono">{fmtPKR(item.batch_cost_per_unit)}</td>
                    <td className="mono">{fmtPKR(item.packaging_cost_per_unit)}</td>
                    <td style={{ fontWeight: 700 }}>{fmtPKR2(item.unit_cost_with_tax)}</td>
                    <td>{item.added_to_inventory ? <span className="badge badge-green">Yes</span> : <span className="badge badge-gray">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

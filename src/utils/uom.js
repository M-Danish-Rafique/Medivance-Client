/**
 * Units of measurement. Every UOM stores `to_base_factor` = how many base units one of it
 * holds (e.g. 1 L = 1000 ml). Manufacturing volume checks and costs are done in base units,
 * so a wrong factor silently mis-costs yields — keep the UI explicit about it.
 */
export const BASE_UNIT = { weight: 'g', volume: 'ml', count: 'pcs' };

// Standard units, matched by symbol (case-insensitive), used to prefill and sanity-check the UOM form
const STANDARD_UNITS = {
  ml: ['volume', 1], l: ['volume', 1000], ltr: ['volume', 1000], litre: ['volume', 1000], liter: ['volume', 1000],
  g: ['weight', 1], gm: ['weight', 1], gram: ['weight', 1], kg: ['weight', 1000], mg: ['weight', 0.001],
  pcs: ['count', 1], pc: ['count', 1], unit: ['count', 1], dozen: ['count', 12],
};

export function standardUnit(symbol) {
  const hit = STANDARD_UNITS[String(symbol || '').trim().toLowerCase()];
  return hit ? { base_type: hit[0], to_base_factor: hit[1] } : null;
}

/** Warning text when a UOM with a well-known symbol has the wrong type or factor, else null. */
export function uomMisconfiguration(uom) {
  const std = standardUnit(uom?.symbol);
  if (!std) return null;
  if (uom.base_type !== std.base_type || parseFloat(uom.to_base_factor) !== std.to_base_factor) {
    return `expected ${std.base_type}, 1 ${uom.symbol} = ${std.to_base_factor} ${BASE_UNIT[std.base_type]}`;
  }
  return null;
}

export function toBase(qty, uom) {
  return parseFloat(qty || 0) * parseFloat(uom?.to_base_factor || 0);
}

export function fromBase(baseQty, uom) {
  const factor = parseFloat(uom?.to_base_factor || 0);
  return factor > 0 ? baseQty / factor : 0;
}

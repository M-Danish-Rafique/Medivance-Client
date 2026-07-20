/**
 * Sale invoice row calculations for Warranty, Warranty+10% Disc, and Non-Warranty prints.
 */

function parseNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function computeInvoiceRows(items, type) {
  const isWarranty = type === 'warranty' || type === 'warranty10';
  const is10Disc = type === 'warranty10';

  const rows = items.map((item) => {
    const qty = parseInt(item.qty || 0, 10) || 0;
    const bonus = parseInt(item.bonus || 0, 10) || 0;
    const saleRate = parseNum(item.sale_rate);
    const retailPriceRaw = parseNum(item.retail_price);
    const retailPrice = retailPriceRaw > 0 ? retailPriceRaw : saleRate;
    const discPct = parseNum(item.discount_pct);
    const taxPct = parseNum(item.tax_pct || item.sale_tax_pct);
    const lineTotal = parseNum(item.total);

    let prdId, rate, amount, effDiscPct, invAmount, taxAmount;

    if (isWarranty) {
      effDiscPct = discPct + (is10Disc ? 10 : 0);
      rate = retailPrice > 0 ? retailPrice * 0.85 : saleRate * 0.85;
      amount = rate * qty;
      const discAmt = amount * effDiscPct / 100;
      invAmount = amount - discAmt;
      taxAmount = 0;

      if (is10Disc) {
        const afterDisc = amount * (1 - effDiscPct / 100);
        const withTax = afterDisc * (1 + taxPct / 100);
        prdId = qty > 0 ? Math.round(withTax / qty) : Math.round(withTax);
      } else {
        prdId = qty > 0 ? Math.round(lineTotal / qty) : Math.round(lineTotal);
      }
    } else {
      // Non-warranty: sale rate, then discount, then tax% on post-discount amount
      effDiscPct = discPct;
      prdId = parseInt(item.product_id, 10) || item.product_id;
      rate = saleRate > 0 ? saleRate : retailPrice;
      amount = rate * qty;
      const afterDisc = amount * (1 - effDiscPct / 100);
      taxAmount = afterDisc * (taxPct / 100);
      invAmount = afterDisc + taxAmount;
    }

    return {
      prd_id: prdId,
      qty,
      bonus,
      product_name: item.product_name,
      pack_size: item.pack_size || item.product_pack_size,
      batch_no: item.batch_no,
      exp_date: item.exp_date,
      rate,
      amount,
      disc_pct: effDiscPct,
      inv_amount: invAmount,
      tax_pct: taxPct,
      tax_amount: taxAmount,
    };
  });

  const grossAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalTaxAmount = rows.reduce((s, r) => s + (r.tax_amount || 0), 0);
  const totalDiscAmount = rows.reduce((s, r) => s + r.amount * (r.disc_pct / 100), 0);
  const netAmount = rows.reduce((s, r) => s + r.inv_amount, 0);
  const referenceNo = isWarranty
    ? rows.reduce((s, r) => s + (parseInt(r.prd_id, 10) || 0) * r.qty, 0)
    : null;

  return { rows, grossAmount, netAmount, totalDiscAmount, totalTaxAmount, referenceNo };
}

export { computeInvoiceRows };

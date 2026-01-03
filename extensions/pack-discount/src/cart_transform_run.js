// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  console.log('[CartTransform] START');

  if (!input?.cart?.lines) {
    console.log('[CartTransform] No cart lines');
    return NO_CHANGES;
  }

  console.log('[CartTransform] Total lines:', input.cart.lines.length);

  const UNIT_DISCOUNT_PERCENT = 10;
  const ops = [];

  // New logic: apply a 10% discount on a single product line when
  // - the product has the `enable_pack` metafield set (truthy)
  // - AND the quantity on the line is >= 2
  for (const line of input.cart.lines) {
    try {
      /** @type {any} */
      const l = line;

      const quantity = Number(l.quantity || 0);
      if (quantity < 2) continue; 

      // Only consider ProductVariant merchandise
      if (l.merchandise?.__typename !== 'ProductVariant') continue;

      const product = l.merchandise.product;
      if (!product) continue;

      // The GraphQL query exposes the metafield as `enablePack { value }`
      const mf = product.enablePack;
      const mfValue = mf && mf.value;
      const enabled =
        mfValue === true || mfValue === 'true' || mfValue === '1' || mfValue === 1;
      if (!enabled) continue; // metafield not enabled

      const compareAt = l.cost?.compareAtAmountPerQuantity?.amount;
      const current = l.cost?.amountPerQuantity?.amount;
      const basePriceStr = compareAt ?? current;
      if (!basePriceStr) continue;

  // Use compareAt (original price) as the basis for discount when available; otherwise fallback to current price
  const basePriceForDiscountStr = l.cost?.compareAtAmountPerQuantity?.amount ?? l.cost?.amountPerQuantity?.amount;
  if (!basePriceForDiscountStr) continue;
  const basePriceForDiscount = Number(basePriceForDiscountStr);
  if (Number.isNaN(basePriceForDiscount)) continue;

  const calculatedPercent = Math.min(quantity * 10, 100);
  if (calculatedPercent <= 0) continue;

  const discountedUnit = basePriceForDiscount * (1 - calculatedPercent / 100);
  const discountedUnitStr = discountedUnit.toFixed(2);

      ops.push();
    } catch (e) {
      // skip line on error
      continue;
    }
  }

  console.log('[CartTransform] Operations count:', ops.length);

  if (!ops.length) {
    console.log('[CartTransform] NO CHANGES');
    return NO_CHANGES;
  }

  console.log('[CartTransform] APPLYING CHANGES');
  return { operations: ops };
}

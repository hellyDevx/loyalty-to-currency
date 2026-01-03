import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';


/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {
  // Basic checks
  if (!input.cart.lines || !input.cart.lines.length) {
    console.info('[LoyaltyFunc] no cart lines — skipping');
    return {operations: []};
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );
  if (!hasProductDiscountClass) {
    console.info('[LoyaltyFunc] discount does not include Product class — skipping');
    return {operations: []};
  }
  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  // Ensure customer is logged in and has a customer object
  const buyer = input.cart.buyerIdentity;
  if (!buyer || !buyer.isAuthenticated || !buyer.customer) {
    console.info('[LoyaltyFunc] buyer not authenticated or missing customer object — skipping');
    return {operations: []};
  }

  // Check cart attribute set by the cart drawer checkbox (e.g. key: "apply_loyalty").
  // Only apply the loyalty discount when the storefront explicitly enables it.
  try {
    const attrA = input.cart.attributeApplyLoyalty;
    const attrB = input.cart.attributeLoyaltyApply;
    const val = (attrA && attrA.value) || (attrB && attrB.value) || '';
    const applyValue = String(val).toLowerCase();
    const applyLoyalty = /^(true|1|yes)$/i.test(applyValue);
    if (!applyLoyalty) return {operations: []};
  } catch (e) {
    return {operations: []};
  }

  // Read customer points from metafield (value is stored as a string)
  const mf = buyer.customer.metafield;
  const customerPoints = mf && mf.value ? Math.floor(Number(mf.value)) : 0;
  if (!Number.isFinite(customerPoints) || customerPoints < 100) {
    console.info('[LoyaltyFunc] insufficient or invalid customer points:', customerPoints);
    return {operations: []};
  }

  // Build list of eligible lines (exclude gift cards)
  const eligibleLines = input.cart.lines.filter((line) => {
    try {
      const merch = line.merchandise;
      return merch && merch.product && merch.product.isGiftCard === false;
    } catch (e) {
      return false;
    }
  });

  if (!eligibleLines.length) {
    console.info('[LoyaltyFunc] no eligible (non-gift-card) lines — skipping');
    return {operations: []};
  }

  // Helper: parse decimal string amount to integer cents
  const toCents = (amountStr) => {
    const n = Number(amountStr);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };

  const eligibleSubtotalCents = eligibleLines.reduce((sum, line) => {
    const sub = toCents(line.cost && line.cost.subtotalAmount && line.cost.subtotalAmount.amount ? line.cost.subtotalAmount.amount : '0');
    return sum + sub;
  }, 0);

  console.info('[LoyaltyFunc] eligible subtotal (cents):', eligibleSubtotalCents, 'eligibleLines:', eligibleLines.length);

  // Eligibility: subtotal (excluding gift cards) >= 1000
  if (eligibleSubtotalCents < 1000 * 100) {
    console.info('[LoyaltyFunc] eligible subtotal less than required threshold — skipping');
    return {operations: []};
  }

  // Maximum redeemable: min(customer_points, 30% of eligible subtotal)
  const thirtyPercentCents = Math.floor((eligibleSubtotalCents * 30) / 100);
  const maxRedeemableCents = Math.min(customerPoints * 100, thirtyPercentCents);

  console.info('[LoyaltyFunc] customerPoints (cents):', customerPoints * 100, '30% of subtotal (cents):', thirtyPercentCents, 'maxRedeemableCents:', maxRedeemableCents);

  // Round down to nearest block of 50 (points -> currency is 1:1)
  const blockCents = 50 * 100;
  const redeemableBlocks = Math.floor(maxRedeemableCents / blockCents);
  if (redeemableBlocks <= 0) {
    console.info('[LoyaltyFunc] redeemableBlocks <= 0 — no redeemable amount after rounding');
    return {operations: []};
  }
  const redeemableCents = redeemableBlocks * blockCents;

  console.info('[LoyaltyFunc] redeemableCents:', redeemableCents, 'redeemableBlocks:', redeemableBlocks);

  // Distribute redeemableCents proportionally across eligible lines (largest remainder)
  const exactAllocations = eligibleLines.map((line) => {
    const lineSubtotal = toCents(line.cost.subtotalAmount.amount);
    const exact = (redeemableCents * lineSubtotal) / eligibleSubtotalCents;
    return {line, lineSubtotal, exact};
  });

  // Floor allocations and compute fractional remainders
  let allocations = exactAllocations.map((a) => ({
    id: a.line.id,
    lineSubtotal: a.lineSubtotal,
    assigned: Math.floor(a.exact),
    fraction: a.exact - Math.floor(a.exact),
  }));

  let assignedSum = allocations.reduce((s, a) => s + a.assigned, 0);
  let remainder = redeemableCents - assignedSum;

  // Distribute remainder by largest fractional parts, ensuring assigned <= lineSubtotal - 1 cent
  allocations.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < allocations.length && remainder > 0; i++) {
    const capacity = allocations[i].lineSubtotal - 1 - allocations[i].assigned;
    if (capacity <= 0) continue;
    const give = Math.min(capacity, 1);
    allocations[i].assigned += give;
    remainder -= give;
  }

  // If remainder remains, try another pass giving to any line with capacity
  if (remainder > 0) {
    for (let i = 0; i < allocations.length && remainder > 0; i++) {
      const capacity = allocations[i].lineSubtotal - 1 - allocations[i].assigned;
      if (capacity <= 0) continue;
      const give = Math.min(capacity, remainder);
      allocations[i].assigned += give;
      remainder -= give;
    }
  }

  // As a last resort, if remainder still > 0 (shouldn't happen), reduce total redeemable
  const finalAssignedSum = allocations.reduce((s, a) => s + a.assigned, 0);

  console.info('[LoyaltyFunc] finalAssignedSum (cents):', finalAssignedSum, 'expected redeemableCents:', redeemableCents, 'remainder (should be 0):', redeemableCents - finalAssignedSum);

  // log allocations summary
  allocations.forEach((a) => {
    console.debug('[LoyaltyFunc] allocation lineId:', a.id, 'assigned(cents):', a.assigned, 'lineSubtotal(cents):', a.lineSubtotal);
  });

  // Build productDiscountsAdd candidates per eligible line
  const candidates = allocations.map((a) => ({
    message: 'LOYALTY REDEMPTION',
    targets: [
      {
        cartLine: {
          id: a.id,
        },
      },
    ],
    value: {
      fixedAmount: {
        amount: (a.assigned / 100).toFixed(2),
      },
    },
  }));

  console.info('[LoyaltyFunc] candidates count:', candidates.length);

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
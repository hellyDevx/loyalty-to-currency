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
    return {operations: []};
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  // Ensure customer is logged in and has a customer object
  const buyer = input.cart.buyerIdentity;
  if (!buyer || !buyer.isAuthenticated || !buyer.customer) {
    return {operations: []};
  }

  // Read customer points from metafield (value is stored as a string)
  const mf = buyer.customer.metafield;
  const customerPoints = mf && mf.value ? Math.floor(Number(mf.value)) : 0;
  if (!Number.isFinite(customerPoints) || customerPoints < 100) {
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

  // Eligibility: subtotal (excluding gift cards) >= 1000
  if (eligibleSubtotalCents < 1000 * 100) {
    return {operations: []};
  }

  // Maximum redeemable: min(customer_points, 30% of eligible subtotal)
  const thirtyPercentCents = Math.floor((eligibleSubtotalCents * 30) / 100);
  const maxRedeemableCents = Math.min(customerPoints * 100, thirtyPercentCents);

  // Round down to nearest block of 50 (points -> currency is 1:1)
  const blockCents = 50 * 100;
  const redeemableBlocks = Math.floor(maxRedeemableCents / blockCents);
  if (redeemableBlocks <= 0) {
    return {operations: []};
  }
  const redeemableCents = redeemableBlocks * blockCents;

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
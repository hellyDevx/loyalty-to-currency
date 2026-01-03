import {
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
  const cart = input.cart;

  /* ------------------------------------------------------------
   * 1. Basic cart safety
   * ---------------------------------------------------------- */
  if (!cart || !cart.lines || cart.lines.length === 0) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 2. Buyer / customer safety
   * ---------------------------------------------------------- */
  const buyer = cart.buyerIdentity;
  if (!buyer || !buyer.customer) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 3. Apply-loyalty cart attribute (checkbox)
   * ---------------------------------------------------------- */
  const attr =
    cart.attributeApplyLoyalty?.value ||
    cart.attributeLoyaltyApply?.value ||
    '';

  const applyLoyalty = /^(true|1|yes)$/i.test(String(attr));
  if (!applyLoyalty) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 4. Customer loyalty points metafield
   * ---------------------------------------------------------- */
  const mf = buyer.customer.metafield;
  const customerPoints = mf && mf.value ? Math.floor(Number(mf.value)) : 0;

  if (!Number.isFinite(customerPoints) || customerPoints < 100) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 5. Eligible lines (exclude gift cards)
   * ---------------------------------------------------------- */
  const eligibleLines = cart.lines.filter((line) => {
    const merch = line.merchandise;
    return merch?.product?.isGiftCard === false;
  });

  if (eligibleLines.length === 0) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 6. Helpers
   * ---------------------------------------------------------- */
  const toCents = (amountStr) => {
    const n = Number(amountStr);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  /* ------------------------------------------------------------
   * 7. Eligible subtotal (cents)
   * ---------------------------------------------------------- */
  const eligibleSubtotalCents = eligibleLines.reduce((sum, line) => {
    return (
      sum +
      toCents(line.cost?.subtotalAmount?.amount ?? '0')
    );
  }, 0);

  // Require subtotal ≥ 1000
  if (eligibleSubtotalCents < 1000 * 100) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 8. Redeemable calculation
   * ---------------------------------------------------------- */
  const maxByPoints = customerPoints * 100;
  const maxBySubtotal = Math.floor((eligibleSubtotalCents * 30) / 100);
  const maxRedeemableCents = Math.min(maxByPoints, maxBySubtotal);

  // Round down to nearest 50
  const blockCents = 50 * 100;
  const redeemableCents =
    Math.floor(maxRedeemableCents / blockCents) * blockCents;

  if (redeemableCents <= 0) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 9. Proportional allocation (largest remainder)
   * ---------------------------------------------------------- */
  const exact = eligibleLines.map((line) => {
    const lineSubtotal = toCents(line.cost.subtotalAmount.amount);
    return {
      id: line.id,
      lineSubtotal,
      exact: (redeemableCents * lineSubtotal) / eligibleSubtotalCents,
    };
  });

  let allocations = exact.map((e) => ({
    id: e.id,
    lineSubtotal: e.lineSubtotal,
    assigned: Math.floor(e.exact),
    fraction: e.exact - Math.floor(e.exact),
  }));

  let assignedSum = allocations.reduce((s, a) => s + a.assigned, 0);
  let remainder = redeemableCents - assignedSum;

  allocations.sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < allocations.length && remainder > 0; i++) {
    const capacity = allocations[i].lineSubtotal - 1 - allocations[i].assigned;
    if (capacity > 0) {
      allocations[i].assigned += 1;
      remainder -= 1;
    }
  }

  /* ------------------------------------------------------------
   * 10. Build candidates (NEVER zero value)
   * ---------------------------------------------------------- */
  const candidates = allocations
    .filter((a) => a.assigned > 0)
    .map((a) => ({
      message: 'LOYALTY REDEMPTION',
      targets: [{ cartLine: { id: a.id } }],
      value: {
        fixedAmount: {
          amount: (a.assigned / 100).toFixed(2),
          appliesToEachItem: false,
        },
      },
    }));

  if (candidates.length === 0) {
    return { operations: [] };
  }

  /* ------------------------------------------------------------
   * 11. Final operation
   * ---------------------------------------------------------- */
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

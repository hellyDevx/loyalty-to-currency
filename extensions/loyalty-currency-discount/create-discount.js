#!/usr/bin/env node
// Usage: set env SHOP, ADMIN_TOKEN, APP_GID, FUNCTION_GID then run: node create-discount.js
// Example: export SHOP=my-shop.myshopify.com; export ADMIN_TOKEN=shpat_xxx; export APP_GID=gid://shopify/App/123; export FUNCTION_GID=gid://shopify/AppFunction/456

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const SHOP = process.env.SHOP;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const APP_GID = process.env.APP_GID; // e.g. gid://shopify/App/123
const FUNCTION_GID = process.env.FUNCTION_GID; // e.g. gid://shopify/AppFunction/456

if (!SHOP || !ADMIN_TOKEN || !APP_GID || !FUNCTION_GID) {
  console.error('Missing env vars. Required: SHOP, ADMIN_TOKEN, APP_GID, FUNCTION_GID');
  process.exit(1);
}

// Configure these values as needed
const TITLE = process.env.TITLE || 'Preview Loyalty Redemption (auto)';
const AMOUNT = process.env.AMOUNT || '50.00';
const CURRENCY = process.env.CURRENCY || 'USD';

const mutation = `mutation discountAutomaticAppCreate($automaticDiscount: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticDiscount: $automaticDiscount) {
    userErrors { field message }
    discountAutomaticApp { id title status }
  }
}`;

const variables = {
  automaticDiscount: {
    title: TITLE,
    status: 'ACTIVE',
    // No start/end means immediate
    value: {
      fixedAmount: {
        amount: AMOUNT,
        currencyCode: CURRENCY
      }
    },
    // Scope the discount broadly: apply to all products. Adjust "appliesTo" to limit.
    appliesOncePerCustomer: false,
    usageLimit: null,
    // Link to your app and function that implements the logic
    appId: APP_GID,
    functionId: FUNCTION_GID
  }
};

(async () => {
  const url = `https://${SHOP}/admin/api/2025-04/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN
    },
    body: JSON.stringify({ query: mutation, variables })
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
})();

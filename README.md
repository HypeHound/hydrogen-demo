# Downpay deposits on Hydrogen

This repository is a working Hydrogen storefront that adds a **"Pay a deposit"** button to the cart, powered by [Downpay](https://apps.shopify.com/downpay). It's the reference implementation — the code and the instructions live together here so they can't drift. (External write-ups, e.g. on Crisp, should link to this README rather than repeat the steps.)

On a headless store there's no theme, so there's no Downpay app block. Instead the deposit is a Shopify **selling plan** that this storefront reads from the **Storefront API** and applies to the cart with a `sellingPlanId`. Order creation and payment terms still run on Downpay's backend; only the storefront UI is custom.

## What this repo implements

| Feature | Where it lives |
| --- | --- |
| Reads the deposit plan on each cart line | [`app/lib/fragments.js`](app/lib/fragments.js) — `sellingPlanAllocations` in `fragment CartLine` (line ~55) and `fragment CartLineComponent` (line ~129) |
| "Pay a deposit" button (applies the plan → checkout) | [`app/components/CartSummary.jsx`](app/components/CartSummary.jsx) — `DepositCheckoutButton` (line ~102), rendered next to checkout in `CartCheckoutActions` (line ~72) |
| "Due later" totals row | [`app/components/CartSummary.jsx`](app/components/CartSummary.jsx) — `dueLater` calc (line ~17), rendered under Subtotal (line ~48) |

Built on the current Hydrogen skeleton (React Router 7 + Vite). It's all standard Storefront API, so the same approach copies into any Hydrogen cart — each step below shows both what this repo does and how to replicate it.

## Run this repo

**Requirements:** Node.js 22.x or 24.x, and a Shopify store with the **Headless** channel and **Downpay** installed (with a deposit plan on at least one product).

```bash
npm install
npx shopify hydrogen link       # link to your Hydrogen storefront
npx shopify hydrogen env pull    # pull Storefront API tokens into .env
npm run dev                      # http://localhost:3000
```

Add a product that has a Downpay plan to the cart, and the deposit button + "Due later" row appear.

## How it works

### Step 1 — Read the deposit info on each cart line

**In this repo:** `app/lib/fragments.js` adds `sellingPlanAllocations` to the cart-line query. **To replicate:** inside `CART_QUERY_FRAGMENT` → `fragment CartLine` → `merchandise { ... on ProductVariant { ... } }`, add:

```graphql
sellingPlanAllocations(first: 1) {
  nodes {
    sellingPlan {
      id
      name
      checkoutCharge {
        value {
          __typename
          ... on MoneyV2 { ...Money }
          ... on SellingPlanCheckoutChargePercentageValue { percentage }
        }
      }
    }
  }
}
```

This tells the storefront, for each item, whether it has a deposit plan and how big the deposit is (a percentage or a fixed amount). Items with no plan return an empty list. Works for simple products too — Shopify's default variant carries the plan. This repo also adds it to `fragment CartLineComponent` so bundles are covered.

### Step 2 — Regenerate types

```bash
npm run codegen
```

Run this after any GraphQL change, or the build fails on stale types.

### Step 3 — The deposit button

**In this repo:** `app/components/CartSummary.jsx` defines `DepositCheckoutButton` and renders it beside "Continue to Checkout." It's self-contained — drop it into any cart component and pass the cart:

```jsx
import {CartForm} from '@shopify/hydrogen';
import {useState} from 'react';

export function DepositCheckoutButton({cart}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const checkoutUrl = cart?.checkoutUrl;
  const lines = cart?.lines?.nodes ?? [];

  // Items that have a deposit plan available.
  const depositLines = lines
    .map((line) => {
      const plan =
        line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan;
      return plan ? {id: line.id, sellingPlanId: plan.id} : null;
    })
    .filter(Boolean);

  const charge = lines
    .map(
      (line) =>
        line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan
          ?.checkoutCharge?.value,
    )
    .find(Boolean);

  // No deposit items in the cart -> show nothing.
  if (!checkoutUrl || depositLines.length === 0 || !charge) return null;

  const label =
    charge.__typename === 'SellingPlanCheckoutChargePercentageValue'
      ? `Pay ${charge.percentage}% deposit →`
      : `Pay deposit →`;

  async function applyDepositAndCheckout() {
    setBusy(true);
    setFailed(false);
    const body = new FormData();
    body.append(
      'cartFormInput',
      JSON.stringify({
        action: CartForm.ACTIONS.LinesUpdate,
        inputs: {lines: depositLines},
      }),
    );
    try {
      const res = await fetch('/cart', {method: 'POST', body});
      if (!res.ok) throw new Error('Failed to apply deposit');
      window.location.href = checkoutUrl; // only navigate once the deposit is applied
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <span>
      <button type="button" onClick={applyDepositAndCheckout} disabled={busy}>
        {busy ? 'Applying deposit…' : label}
      </button>
      {failed && (
        <span role="alert"> Couldn’t apply the deposit. Please try again.</span>
      )}
    </span>
  );
}
```

Render it next to your checkout button, passing the cart:

```jsx
<DepositCheckoutButton cart={cart} />
```

The button renders nothing when the cart has no deposit item, so it's safe to drop in anywhere. On click it applies the deposit plan to every eligible item, then — **only if that succeeded** — sends the buyer to checkout. If applying the deposit fails, it shows an error and stays on the cart (so no one reaches checkout at full price by accident).

> **Why `fetch` + `window.location` instead of Hydrogen's `CartForm`?** `CartForm` submits with a React Router fetcher, and fetchers don't follow a redirect to a **cross-origin** URL — and Shopify checkout is a different domain. So this applies the plan with a plain `fetch` to the cart action, checks it succeeded, then navigates.

### Step 4 — "Due later" totals row

**In this repo:** `CartSummary` computes `dueLater` and renders it under the subtotal. **To replicate:**

```jsx
const currencyCode = cart?.cost?.subtotalAmount?.currencyCode;
const dueLater = (cart?.lines?.nodes ?? []).reduce((sum, line) => {
  const value =
    line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan
      ?.checkoutCharge?.value;
  if (!value) return sum;
  const lineTotal = Number(line?.cost?.totalAmount?.amount ?? 0);
  if (value.__typename === 'SellingPlanCheckoutChargePercentageValue') {
    return sum + (lineTotal * (100 - Number(value.percentage))) / 100;
  }
  return sum + Math.max(0, lineTotal - Number(value.amount ?? 0));
}, 0);
```

```jsx
{dueLater > 0 && currencyCode && (
  <dl>
    <dt>Due later</dt>
    <dd><Money data={{amount: dueLater.toFixed(2), currencyCode}} /></dd>
  </dl>
)}
```

For a 50% plan on a $950 item, this shows **Due later: $475**. (`Money` is imported from `@shopify/hydrogen`.)

## Verify

- The deposit button shows only when a line has a Downpay plan.
- Clicking it applies the deposit and lands on checkout.
- Checkout shows the split — e.g. a 50% plan on a $950 item reads **Due today $475 / Due on fulfillment $475**.

## Good to know

- **One-way action.** The button applies the deposit and sends the buyer to checkout — it's not an in-cart "pay in full" toggle. To let shoppers switch a line back to full price in the cart, also query `sellingPlanAllocation` (the *applied* plan on a line) and add a toggle that updates the line with `sellingPlanId: null`.
- **Percentage vs fixed.** Percentage deposits (the common Downpay case) are exact. If you use a **fixed-amount** plan, double-check the "Due later" math for carts with quantity > 1, and note the button label just reads "Pay deposit →".

## Notes

- The plan is configured in the Downpay app; the Storefront API just exposes it as `sellingPlanAllocations`.

## Standard Hydrogen

Scaffolded from Shopify's Hydrogen skeleton (React Router, Hydrogen, Oxygen, Vite, Shopify CLI, ESLint, Prettier, GraphQL generator).

```bash
npm run dev      # local development
npm run build    # production build
npm run preview  # preview the production build locally
```

- [Hydrogen docs](https://shopify.dev/custom-storefronts/hydrogen) · [React Router docs](https://reactrouter.com/start/framework/routing)
- **Customer Account API** (`/account`): follow steps 1–2 of the [Hydrogen customer account setup](https://shopify.dev/docs/custom-storefronts/building-with-the-customer-account-api/hydrogen#step-1-set-up-a-public-domain-for-local-development).

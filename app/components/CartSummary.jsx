import { CartForm, Money } from "@shopify/hydrogen";
import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

/**
 * @param {CartSummaryProps}
 */
export function CartSummary({ cart, layout }) {
  const className = layout === "page" ? "cart-summary-page" : "cart-summary-aside";
  const summaryId = useId();
  const discountsHeadingId = useId();
  const discountCodeInputId = useId();
  const giftCardHeadingId = useId();
  const giftCardInputId = useId();

  const currencyCode = cart?.cost?.subtotalAmount?.currencyCode;
  const dueLater = (cart?.lines?.nodes ?? []).reduce((sum, line) => {
    const value =
      line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan?.checkoutCharge?.value;
    if (!value) return sum;
    const lineTotal = Number(line?.cost?.totalAmount?.amount ?? 0);
    if (value.__typename === "SellingPlanCheckoutChargePercentageValue") {
      return sum + (lineTotal * (100 - Number(value.percentage))) / 100;
    }
    return sum + Math.max(0, lineTotal - Number(value.amount ?? 0));
  }, 0);

  return (
    <div
      aria-labelledby={summaryId}
      className={className}
    >
      <h4 id={summaryId}>Totals</h4>
      <dl
        role="group"
        className="cart-subtotal"
      >
        <dt>Subtotal</dt>
        <dd>
          {cart?.cost?.subtotalAmount?.amount ? <Money data={cart?.cost?.subtotalAmount} /> : "-"}
        </dd>
      </dl>
      {dueLater > 0 && currencyCode && (
        <dl
          role="group"
          className="cart-subtotal cart-due-later"
        >
          <dt>Due later</dt>
          <dd>
            <Money data={{ amount: dueLater.toFixed(2), currencyCode }} />
          </dd>
        </dl>
      )}
      <CartDiscounts
        discountCodes={cart?.discountCodes}
        discountsHeadingId={discountsHeadingId}
        discountCodeInputId={discountCodeInputId}
      />
      <CartGiftCard
        giftCardCodes={cart?.appliedGiftCards}
        giftCardHeadingId={giftCardHeadingId}
        giftCardInputId={giftCardInputId}
      />
      <CartCheckoutActions cart={cart} />
    </div>
  );
}

/**
 * @param {{cart: OptimisticCart<CartApiQueryFragment | null>}}
 */
function CartCheckoutActions({ cart }) {
  const checkoutUrl = cart?.checkoutUrl;
  if (!checkoutUrl) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <a
          href={checkoutUrl}
          target="_self"
        >
          Continue to Checkout &rarr;
        </a>
        <DepositCheckoutButton cart={cart} />
      </div>
      <br />
    </div>
  );
}

/**
 * @param {{cart: OptimisticCart<CartApiQueryFragment | null>}}
 */
function DepositCheckoutButton({ cart }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const checkoutUrl = cart?.checkoutUrl;
  const lines = cart?.lines?.nodes ?? [];

  const depositLines = lines
    .map((line) => {
      const plan = line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan;
      return plan ? { id: line.id, sellingPlanId: plan.id } : null;
    })
    .filter(Boolean);

  const charge = lines
    .map(
      (line) =>
        line?.merchandise?.sellingPlanAllocations?.nodes?.[0]?.sellingPlan?.checkoutCharge?.value,
    )
    .find(Boolean);

  if (!checkoutUrl || depositLines.length === 0 || !charge) return null;

  const label =
    charge.__typename === "SellingPlanCheckoutChargePercentageValue"
      ? `Pay ${charge.percentage}% deposit →`
      : `Pay deposit →`;

  async function applyDepositAndCheckout() {
    setBusy(true);
    setFailed(false);
    const body = new FormData();
    body.append(
      "cartFormInput",
      JSON.stringify({
        action: CartForm.ACTIONS.LinesUpdate,
        inputs: { lines: depositLines },
      }),
    );
    try {
      const res = await fetch("/cart", { method: "POST", body });
      if (!res.ok) throw new Error("Failed to apply deposit");
      window.location.href = checkoutUrl;
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <span>
      <button type="button" onClick={applyDepositAndCheckout} disabled={busy}>
        {busy ? "Applying deposit…" : label}
      </button>
      {failed && (
        <span role="alert" style={{ color: "crimson", marginLeft: "0.5rem" }}>
          Couldn’t apply the deposit. Please try again.
        </span>
      )}
    </span>
  );
}

/**
 * @param {{
 *   discountCodes?: CartApiQueryFragment['discountCodes'];
 *   discountsHeadingId: string;
 *   discountCodeInputId: string;
 * }}
 */
function CartDiscounts({ discountCodes, discountsHeadingId, discountCodeInputId }) {
  const codes =
    discountCodes?.filter((discount) => discount.applicable)?.map(({ code }) => code) || [];

  return (
    <section aria-label="Discounts">
      {/* Have existing discount, display it with a remove option */}
      <dl hidden={!codes.length}>
        <div>
          <dt id={discountsHeadingId}>Discounts</dt>
          <UpdateDiscountForm>
            <div
              className="cart-discount"
              role="group"
              aria-labelledby={discountsHeadingId}
            >
              <code>{codes?.join(", ")}</code>
              &nbsp;
              <button
                type="submit"
                aria-label="Remove discount"
              >
                Remove
              </button>
            </div>
          </UpdateDiscountForm>
        </div>
      </dl>

      {/* Show an input to apply a discount */}
      <UpdateDiscountForm discountCodes={codes}>
        <div>
          <label
            htmlFor={discountCodeInputId}
            className="sr-only"
          >
            Discount code
          </label>
          <input
            id={discountCodeInputId}
            type="text"
            name="discountCode"
            placeholder="Discount code"
          />
          &nbsp;
          <button
            type="submit"
            aria-label="Apply discount code"
          >
            Apply
          </button>
        </div>
      </UpdateDiscountForm>
    </section>
  );
}

/**
 * @param {{
 *   discountCodes?: string[];
 *   children: React.ReactNode;
 * }}
 */
function UpdateDiscountForm({ discountCodes, children }) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.DiscountCodesUpdate}
      inputs={{
        discountCodes: discountCodes || [],
      }}
    >
      {children}
    </CartForm>
  );
}

/**
 * @param {{
 *   giftCardCodes: CartApiQueryFragment['appliedGiftCards'] | undefined;
 *   giftCardHeadingId: string;
 *   giftCardInputId: string;
 * }}
 */
function CartGiftCard({ giftCardCodes, giftCardHeadingId, giftCardInputId }) {
  const giftCardCodeInput = useRef(null);
  const removeButtonRefs = useRef(new Map());
  const previousCardIdsRef = useRef([]);
  const giftCardAddFetcher = useFetcher({ key: "gift-card-add" });
  const [removedCardIndex, setRemovedCardIndex] = useState(null);

  useEffect(() => {
    if (giftCardAddFetcher.data) {
      if (giftCardCodeInput.current !== null) {
        giftCardCodeInput.current.value = "";
      }
    }
  }, [giftCardAddFetcher.data]);

  useEffect(() => {
    const currentCardIds = giftCardCodes?.map((card) => card.id) || [];

    if (removedCardIndex !== null && giftCardCodes) {
      const focusTargetIndex = Math.min(removedCardIndex, giftCardCodes.length - 1);
      const focusTargetCard = giftCardCodes[focusTargetIndex];
      const focusButton = focusTargetCard ? removeButtonRefs.current.get(focusTargetCard.id) : null;

      if (focusButton) {
        focusButton.focus();
      } else if (giftCardCodeInput.current) {
        giftCardCodeInput.current.focus();
      }

      setRemovedCardIndex(null);
    }

    previousCardIdsRef.current = currentCardIds;
  }, [giftCardCodes, removedCardIndex]);

  const handleRemoveClick = (cardId) => {
    const index = previousCardIdsRef.current.indexOf(cardId);
    if (index !== -1) {
      setRemovedCardIndex(index);
    }
  };

  return (
    <section aria-label="Gift cards">
      {giftCardCodes && giftCardCodes.length > 0 && (
        <dl>
          <dt id={giftCardHeadingId}>Applied Gift Card(s)</dt>
          {giftCardCodes.map((giftCard) => (
            <dd
              key={giftCard.id}
              className="cart-discount"
            >
              <RemoveGiftCardForm
                giftCardId={giftCard.id}
                lastCharacters={giftCard.lastCharacters}
                onRemoveClick={() => handleRemoveClick(giftCard.id)}
                buttonRef={(el) => {
                  if (el) {
                    removeButtonRefs.current.set(giftCard.id, el);
                  } else {
                    removeButtonRefs.current.delete(giftCard.id);
                  }
                }}
              >
                <code>***{giftCard.lastCharacters}</code>
                &nbsp;
                <Money data={giftCard.amountUsed} />
              </RemoveGiftCardForm>
            </dd>
          ))}
        </dl>
      )}

      <AddGiftCardForm fetcherKey="gift-card-add">
        <div>
          <label
            htmlFor={giftCardInputId}
            className="sr-only"
          >
            Gift card code
          </label>
          <input
            id={giftCardInputId}
            type="text"
            name="giftCardCode"
            placeholder="Gift card code"
            ref={giftCardCodeInput}
          />
          &nbsp;
          <button
            type="submit"
            disabled={giftCardAddFetcher.state !== "idle"}
            aria-label="Apply gift card code"
          >
            Apply
          </button>
        </div>
      </AddGiftCardForm>
    </section>
  );
}

/**
 * @param {{
 *   fetcherKey?: string;
 *   children: React.ReactNode;
 * }}
 */
function AddGiftCardForm({ fetcherKey, children }) {
  return (
    <CartForm
      fetcherKey={fetcherKey}
      route="/cart"
      action={CartForm.ACTIONS.GiftCardCodesAdd}
    >
      {children}
    </CartForm>
  );
}

/**
 * @param {{
 *   giftCardId: string;
 *   lastCharacters: string;
 *   children: React.ReactNode;
 *   onRemoveClick?: () => void;
 *   buttonRef?: (el: HTMLButtonElement | null) => void;
 * }}
 */
function RemoveGiftCardForm({ giftCardId, lastCharacters, children, onRemoveClick, buttonRef }) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.GiftCardCodesRemove}
      inputs={{
        giftCardCodes: [giftCardId],
      }}
    >
      {children}
      &nbsp;
      <button
        type="submit"
        aria-label={`Remove gift card ending in ${lastCharacters}`}
        onClick={onRemoveClick}
        ref={buttonRef}
      >
        Remove
      </button>
    </CartForm>
  );
}

/**
 * @typedef {{
 *   cart: OptimisticCart<CartApiQueryFragment | null>;
 *   layout: CartLayout;
 * }} CartSummaryProps
 */

/** @typedef {import('storefrontapi.generated').CartApiQueryFragment} CartApiQueryFragment */
/** @typedef {import('~/components/CartMain').CartLayout} CartLayout */
/** @typedef {import('@shopify/hydrogen').OptimisticCart} OptimisticCart */

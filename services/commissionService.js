/**
 * @file commissionService.js
 * @description Canonical commission calculation for the WigoMarket platform.
 *
 * SINGLE SOURCE OF TRUTH — do not copy this logic elsewhere.
 *
 * How it works:
 *   - Vendor price  = what the store receives per unit
 *   - Listed price  = what the customer pays per unit
 *   - Platform fee  = (listedPrice − price) × quantity  (the spread per item)
 *   - Dispatch fee  = order.deliveryFee  (goes entirely to the delivery agent)
 *
 * Prices come from the order line itself (`products[].price` /
 * `products[].listedPrice`, snapshotted when the order is placed) so a seller
 * editing a product later cannot change what an existing order earned. Orders
 * placed before the snapshot existed fall back to the populated product.
 *
 * platformRate is reported as platform earnings / total order value (%).
 *
 * All arithmetic goes through utils/money (integer kobo).
 */

const money = require("../utils/money");

const idOf = (ref) => (ref && ref._id ? ref._id : ref) ?? null;

/** Vendor price per unit for an order line. */
const unitPrice = (item) => item.price ?? item.product?.price ?? 0;

/** Customer price per unit for an order line. */
const unitListedPrice = (item) =>
  item.listedPrice ?? item.product?.listedPrice ?? unitPrice(item);

/** The store a line belongs to: the line's own ref, else the product's. */
const lineStore = (item) => idOf(item.store) ?? idOf(item.product?.store);

/**
 * Calculate commission breakdown for an order.
 *
 * @param {Object} order - Order document. `products.product` should be
 *   populated (price/listedPrice/store) for orders without price snapshots.
 * @returns {{
 *   platformRate: number,
 *   platformAmount: number,
 *   vendorAmount: number,
 *   dispatchAmount: number,
 *   totalAmount: number
 * }}
 */
function calculateCommissionBreakdown(order) {
  const lines = order.products || [];

  const vendorAmount = money.sum(lines, (item) =>
    money.multiply(unitPrice(item), item.count ?? 1),
  );
  const platformAmount = money.sum(lines, (item) =>
    money.multiply(
      money.subtract(unitListedPrice(item), unitPrice(item)),
      item.count ?? 1,
    ),
  );

  const dispatchAmount =
    order.deliveryAgent && order.deliveryFee ? money.round(order.deliveryFee) : 0;

  const total = order.paymentIntent?.amount ?? 0;
  const platformRate =
    total > 0 ? Math.round((platformAmount / total) * 10000) / 100 : 0;

  return {
    platformRate,
    platformAmount,
    vendorAmount,
    dispatchAmount,
    totalAmount: total,
  };
}

/**
 * Each store's share of an order at vendor price, one entry per store in
 * first-appearance order. Multi-store orders are split here so each seller is
 * paid for their own line items only.
 *
 * @returns {{ storeId: Object, amount: number }[]}
 */
function vendorShares(order) {
  const byStore = new Map();
  for (const item of order.products || []) {
    const storeId = lineStore(item);
    if (!storeId) {
      throw new Error(
        `Order ${order._id} has a line item with no store (product ${idOf(item.product)})`,
      );
    }
    const key = String(storeId);
    const lineAmount = money.multiply(unitPrice(item), item.count ?? 1);
    const entry = byStore.get(key);
    if (entry) entry.amount = money.add(entry.amount, lineAmount);
    else byStore.set(key, { storeId, amount: lineAmount });
  }
  return [...byStore.values()];
}

module.exports = {
  calculateCommissionBreakdown,
  vendorShares,
  unitPrice,
  unitListedPrice,
};

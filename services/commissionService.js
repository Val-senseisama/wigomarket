/**
 * @file commissionService.js
 * @description Canonical commission calculation for the WigoMarket platform.
 *
 * SINGLE SOURCE OF TRUTH — do not copy this logic elsewhere.
 *
 * How it works:
 *   - Vendor price  = item.product.price  (what the store receives per unit)
 *   - Listed price  = item.product.listedPrice  (what the customer pays per unit)
 *   - Platform fee  = (listedPrice − price) × quantity  (the spread per item)
 *   - Dispatch fee  = order.deliveryFee  (goes entirely to the delivery agent)
 *
 * platformRate is reported as platform earnings / total order value (%).
 */

/**
 * Calculate commission breakdown for a populated order.
 *
 * @param {Object} order - Mongoose Order document.
 *   Must have populated `products.product` with `listedPrice` and `price`,
 *   plus `deliveryAgent`, `deliveryFee`, and `paymentIntent.amount`.
 * @returns {{
 *   platformRate: number,
 *   platformAmount: number,
 *   vendorAmount: number,
 *   dispatchAmount: number,
 *   totalAmount: number
 * }}
 */
function calculateCommissionBreakdown(order) {
  let platformAmount = 0;
  let vendorAmount = 0;

  for (const item of order.products) {
    const listed = item.product?.listedPrice ?? 0;
    const price = item.product?.price ?? 0;
    const qty = item.count ?? 1;
    vendorAmount += price * qty;
    platformAmount += (listed - price) * qty;
  }

  const dispatchAmount =
    order.deliveryAgent && order.deliveryFee ? order.deliveryFee : 0;

  const total = order.paymentIntent?.amount ?? 0;
  const platformRate = total > 0 ? (platformAmount / total) * 100 : 0;

  return {
    platformRate: round2(platformRate),
    platformAmount: round2(platformAmount),
    vendorAmount: round2(vendorAmount),
    dispatchAmount: round2(dispatchAmount),
    totalAmount: total,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { calculateCommissionBreakdown };

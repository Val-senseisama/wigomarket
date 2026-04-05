const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const Product = require("../../models/productModel");
const Transaction = require("../../models/transactionModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { MakeID } = require("../../Helpers/Helpers");
const { OrderStatus, PaymentStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");

/**
 * @function updateOrderStatus
 * @description Updates the status of a specific order.
 *   - Wrapped in a MongoDB transaction so the status update, stock restoration,
 *     and audit record are atomic.
 *   - Restores product stock (quantity + sold) atomically when cancelling an
 *     order that was not already cancelled.
 *   - Creates an order_cancellation Transaction record for every status change
 *     as an audit trail.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.status - New OrderStatus value
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  validateMongodbId(id);

  if (!Object.values(OrderStatus).includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid order status value" });
  }

  const session = await mongoose.startSession();

  try {
    let updatedOrder;
    let isCancelling = false;
    let previousStatus;

    await session.withTransaction(async () => {
      const order = await Order.findById(id)
        .populate("products.product", "_id quantity sold")
        .session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      if (order.orderStatus === status) {
        throw new Error(`Order is already in '${status}' status`);
      }

      previousStatus = order.orderStatus;
      isCancelling =
        status === OrderStatus.CANCELLED &&
        order.orderStatus !== OrderStatus.CANCELLED;

      // Atomically restore product stock when cancelling.
      // Guard sold >= item.count so a double-cancellation can never push sold below 0.
      if (isCancelling) {
        const productUpdates = order.products
          .filter((item) => item.product)
          .map((item) => ({
            updateOne: {
              filter: { _id: item.product._id, sold: { $gte: item.count } },
              update: { $inc: { quantity: item.count, sold: -item.count } },
            },
          }));

        if (productUpdates.length > 0) {
          await Product.bulkWrite(productUpdates, { session });
        }
      }

      const orderUpdate = { orderStatus: status };
      if (isCancelling) {
        // Mark as refunded if already paid, otherwise failed
        orderUpdate.paymentStatus =
          order.paymentStatus === PaymentStatus.PAID
            ? PaymentStatus.REFUNDED
            : PaymentStatus.FAILED;
      }

      updatedOrder = await Order.findByIdAndUpdate(id, orderUpdate, {
        new: true,
        session,
      });

      // Audit trail — record every status transition as a zero-value transaction
      await Transaction.createTransaction(
        {
          transactionId: `STS_${Date.now()}_${MakeID(16)}`,
          reference: `OrderStatus-${id}-${status}`,
          type: "order_cancellation",
          totalAmount: 0,
          entries: [
            {
              account: "accounts_receivable",
              userId: order.orderedBy,
              debit: 0,
              credit: 0,
              description: `Order status: '${order.orderStatus}' → '${status}'`,
            },
            {
              account: "cash_account",
              userId: order.orderedBy,
              debit: 0,
              credit: 0,
              description: `Audit entry for order ${id}`,
            },
          ],
          relatedEntity: { type: "order", id },
          status: "completed",
          metadata: {
            notes: `Status changed from '${order.orderStatus}' to '${status}'. Stock restored: ${isCancelling}`,
          },
        },
        session,
      );
    });

    audit.log({
      action: "order.status_updated",
      actor: audit.actor(req),
      resource: { type: "order", id },
      changes: {
        before: { orderStatus: previousStatus },
        after: { orderStatus: status, stockRestored: isCancelling },
      },
    });

    res.json({ success: true, data: updatedOrder });
  } catch (error) {
    throw new Error(error.message || "Order status update failed");
  } finally {
    await session.endSession();
  }
});

module.exports = updateOrderStatus;

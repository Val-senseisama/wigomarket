const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Transaction = require("../../models/transactionModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { MakeID } = require("../../Helpers/Helpers");
const { normalizeStatus } = require("../../utils/orderStatus");
const {
  transitionOrder,
  OrderTransitionError,
  ROLE,
} = require("../../services/orderTransitionService");

/**
 * @function updateOrderStatus
 * @description Admin order status override. Admins may perform any valid
 *   transition in the state machine (validated by orderTransitionService).
 *   Cancellation side-effects (stock restoration + payment reconciliation) are
 *   handled inside the service. A zero-value Transaction row is written as an
 *   immutable audit trail, atomically with the status change.
 * @access Admin only
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.status - Target canonical status
 * @param {string} [req.body.reason] - Optional reason (recorded in audit log)
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const { id } = req.params;

  validateMongodbId(id);

  if (!status) {
    return res
      .status(400)
      .json({ success: false, message: "status is required" });
  }

  const session = await mongoose.startSession();
  try {
    let updatedOrder;
    let previousStatus;

    await session.withTransaction(async () => {
      const Order = require("../../models/orderModel");
      const existing = await Order.findById(id).select("orderStatus orderedBy").session(session);
      previousStatus = existing ? normalizeStatus(existing.orderStatus) : undefined;

      updatedOrder = await transitionOrder({
        orderId: id,
        toStatus: status,
        role: ROLE.ADMIN,
        req,
        reason,
        session,
      });

      await Transaction.createTransaction(
        {
          transactionId: `STS_${Date.now()}_${MakeID(16)}`,
          reference: `OrderStatus-${id}-${status}`,
          type: "order_cancellation",
          totalAmount: 0,
          entries: [
            {
              account: "accounts_receivable",
              userId: updatedOrder.orderedBy,
              debit: 0,
              credit: 0,
              description: `Order status: '${previousStatus}' → '${status}'`,
            },
            {
              account: "cash_account",
              userId: updatedOrder.orderedBy,
              debit: 0,
              credit: 0,
              description: `Audit entry for order ${id}`,
            },
          ],
          relatedEntity: { type: "order", id },
          status: "completed",
          metadata: {
            notes: `Status changed from '${previousStatus}' to '${status}' by admin.`,
          },
        },
        session,
      );
    });

    res.json({ success: true, data: updatedOrder });
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    throw new Error(error.message || "Order status update failed");
  } finally {
    await session.endSession();
  }
});

module.exports = updateOrderStatus;

const Product = require("../../models/productModel");
const Order = require("../../models/orderModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { OrderStatus, PaymentStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");

/**
 * @function deleteProduct
 * @description Delete a product.
 *   - Guards against deletion when the product has active (paid, in-progress) orders.
 *   - Returns 404 if the product does not exist.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Product ID (required)
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.body;

  validateMongodbId(id);

  // Prevent deletion if there are active paid orders for this product
  const activeOrder = await Order.findOne({
    "products.product": id,
    paymentStatus: PaymentStatus.PAID,
    orderStatus: {
      $in: [OrderStatus.NOT_PROCESSED, OrderStatus.PROCESSING, OrderStatus.PENDING],
    },
  });

  if (activeOrder) {
    return res.status(400).json({
      success: false,
      message: "Cannot delete a product that has active orders",
    });
  }

  try {
    const deleted = await Product.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    audit.log({
      action: "product.deleted",
      actor: audit.actor(req),
      resource: { type: "product", id: deleted._id, displayName: deleted.title },
      changes: { before: { title: deleted.title, price: deleted.price, quantity: deleted.quantity } },
    });

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = deleteProduct;

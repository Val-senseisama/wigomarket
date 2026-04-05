const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const uniqid = require("uniqid");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const User = require("../models/userModel");
const { validateMongodbId } = require("../utils/validateMongodbId");
const {
  PaymentStatus,
  OrderStatus,
  DeliveryStatus,
  PaymentMethod,
  DeliveryMethod,
} = require("../utils/constants");
const appConfig = require("../config/appConfig");
const deliveryFeeService = require("../services/deliveryFeeService");

/**
 * @function createOrder
 * @description Creates a new order for the user with transaction support
 * @param {Object} req - Express request object containing order details
 * @param {Object} res - Express response object
 * @param {string} req.body.paymentMethod - Payment method (cash, card, bank)
 * @param {string} req.body.deliveryMethod - Delivery method (self_delivery, delivery_agent)
 * @param {Object} req.body.deliveryAddress - Delivery address details
 * @param {string} req.body.deliveryNotes - Optional delivery notes
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Created order details
 */
const createOrder = asyncHandler(async (req, res) => {
  const { paymentMethod, deliveryMethod, deliveryAddress, deliveryNotes } =
    req.body;
  const { _id } = req.user;

  // Validate input
  if (!paymentMethod || !deliveryMethod || !deliveryAddress) {
    return res.status(400).json({
      success: false,
      message:
        "Payment method, delivery method, and delivery address are required",
    });
  }

  // Validate Enums using Constants
  if (!Object.values(DeliveryMethod).includes(deliveryMethod)) {
    return res.status(400).json({
      success: false,
      message: "Invalid delivery method",
    });
  }

  if (!Object.values(PaymentMethod).includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment method",
    });
  }

  validateMongodbId(_id);

  const session = await mongoose.startSession();

  try {
    let populatedOrder;
    let totalAmount;
    let deliveryFee = 0;

    await session.withTransaction(async () => {
      // Get user's cart
      const userCart = await Cart.findOne({ owner: _id })
        .populate("products.product")
        .session(session);

      if (!userCart || userCart.products.length === 0) {
        throw new Error("Cart is empty");
      }

      // Check stock availability
      for (const item of userCart.products) {
        if (!item.product) {
          throw new Error(`Product not found in cart (maybe deleted)`);
        }
        if (item.product.quantity < item.count) {
          throw new Error(
            `Insufficient stock for ${item.product.title}. Available: ${item.product.quantity}, Requested: ${item.count}`,
          );
        }
      }

      // Calculate delivery fee based on distance
      let deliveryMetadata = null;
      if (deliveryMethod === DeliveryMethod.DELIVERY_AGENT) {
        try {
          // Get store address from first product (we'll enhance for multi-store later)
          const firstProduct = await Product.findById(
            userCart.products[0].product._id,
          )
            .populate("store", "address")
            .session(session);

          if (!firstProduct || !firstProduct.store) {
            throw new Error("Store information not found");
          }

          const storeAddress = firstProduct.store.address;

          // Calculate fee using HERE Maps
          const feeData = await deliveryFeeService.calculateDeliveryFee(
            storeAddress,
            deliveryAddress,
          );

          deliveryFee = feeData.fee;
          deliveryMetadata = {
            distance: feeData.distance,
            estimatedTime: feeData.estimatedTime,
            calculatedAt: new Date(),
            storeAddress: storeAddress,
            fallback: feeData.fallback || false,
          };

          console.log(
            `📍 Delivery fee calculated: ${deliveryFee} NGN for ${feeData.distance}km`,
          );
        } catch (error) {
          console.error("Delivery fee calculation error:", error.message);

          // If distance exceeds maximum, reject the order
          if (error.message.includes("exceeds maximum")) {
            throw error;
          }

          // Otherwise use fallback
          deliveryFee = appConfig.delivery.baseFee;
          deliveryMetadata = {
            distance: 0,
            estimatedTime: 0,
            calculatedAt: new Date(),
            fallback: true,
            error: error.message,
          };
          console.warn(`⚠️ Using fallback delivery fee: ${deliveryFee} NGN`);
        }
      }

      totalAmount = userCart.cartTotal + deliveryFee;

      // Create order
      const order = new Order({
        products: userCart.products,
        paymentIntent: {
          id: uniqid(),
          method: paymentMethod,
          amount: totalAmount,
          status: PaymentStatus.UNPAID,
          created: Date.now(),
          currency: "NGN",
        },
        deliveryMethod: deliveryMethod,
        deliveryAddress: deliveryAddress,
        deliveryNotes: deliveryNotes || "",
        deliveryFee: deliveryFee,
        deliveryMetadata: deliveryMetadata,
        deliveryStatus:
          deliveryMethod === DeliveryMethod.DELIVERY_AGENT
            ? DeliveryStatus.PENDING_ASSIGNMENT
            : DeliveryStatus.ASSIGNED,
        orderedBy: _id,
        orderStatus: OrderStatus.NOT_PROCESSED,
        paymentStatus: PaymentStatus.UNPAID,
        paymentMethod: paymentMethod,
      });

      const newOrder = await order.save({ session });

      // Update product quantities and sold counts
      const productUpdates = userCart.products.map((item) => ({
        updateOne: {
          filter: { _id: item.product._id },
          update: {
            $inc: {
              quantity: -item.count,
              sold: +item.count,
            },
          },
        },
      }));

      await Product.bulkWrite(productUpdates, { session });

      // Clear user's cart
      await Cart.findOneAndDelete({ owner: _id }).session(session);

      // Populate order details for response
      populatedOrder = await Order.findById(newOrder._id)
        .populate("products.product", "title listedPrice images brand")
        .populate("products.store", "name address mobile")
        .populate("orderedBy", "fullName email mobile")
        .session(session);
    });

    // Send notifications (Outside transaction to prevent rollback on notification failure)
    try {
      // We require inside function to avoid circular dependency issues if any, or just lazy load
      const {
        sendNotificationToUser,
        sendDeliveryAgentNotification,
      } = require("./notificationController");

      // Notify customer
      await sendNotificationToUser(
        _id,
        "Order Created Successfully",
        `Your order #${populatedOrder.paymentIntent.id} has been created. ${
          deliveryMethod === DeliveryMethod.DELIVERY_AGENT
            ? "Waiting for delivery agent assignment."
            : "Ready for pickup."
        }`,
        {
          orderId: populatedOrder._id.toString(),
          orderNumber: populatedOrder.paymentIntent.id,
          totalAmount: totalAmount.toString(),
          deliveryMethod: deliveryMethod,
        },
        "orderUpdates",
      );

      // Notify delivery agents
      if (deliveryMethod === DeliveryMethod.DELIVERY_AGENT) {
        await sendDeliveryAgentNotification(
          "new_order_available",
          `New delivery order available: Order #${populatedOrder.paymentIntent.id}`,
          {
            orderId: populatedOrder._id.toString(),
            orderNumber: populatedOrder.paymentIntent.id,
            deliveryAddress: deliveryAddress,
            totalAmount: totalAmount.toString(),
          },
        );
      }
    } catch (notificationError) {
      console.log("Notification error:", notificationError);
    }

    res.json({
      success: true,
      message: "Order created successfully",
      data: {
        order: populatedOrder,
        totalAmount: totalAmount,
        deliveryFee: deliveryFee,
        deliveryMethod: deliveryMethod,
        nextStep:
          deliveryMethod === DeliveryMethod.DELIVERY_AGENT
            ? "Waiting for delivery agent assignment"
            : "Ready for pickup",
      },
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Order creation failed",
    });
  } finally {
    await session.endSession();
  }
});

/**
 * @function getOrders
 * @description Retrieves user's order history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getOrders = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);

  try {
    const userOrders = await Order.find({ orderedBy: _id })
      .populate({
        path: "products.product",
        select: "store title listedPrice images",
        model: "Product",
        populate: {
          path: "store",
          select: "name address mobile",
          model: "Store",
        },
      })
      .sort({ createdAt: -1 })
      .exec();

    res.json(userOrders);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getOrderById
 * @description Retrieve a single order by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  try {
    const order = await Order.findById(id)
      .populate("products.product")
      .populate("orderedBy", "fullName email mobile")
      .populate("deliveryAgent");

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function updateOrderStatus
 * @description Updates the status of a specific order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params; // Expecting ID in params, usually RESTful

  validateMongodbId(id);

  // Optional: Validate status against OrderStatus enum
  if (!Object.values(OrderStatus).includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid order status value" });
  }

  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
        "paymentIntent.status":
          status === OrderStatus.CANCELLED ? PaymentStatus.FAILED : undefined, // Example logic
      },
      { new: true },
    );

    if (!updatedOrder) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    res.json(updatedOrder);
  } catch (error) {
    throw new Error(error);
  }
});

const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
} = require("./order");

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
};

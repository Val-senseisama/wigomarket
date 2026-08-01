const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const uniqid = require("uniqid");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { generateOrderNumber } = require("../../utils/generateOrderNumber");
const appConfig = require("../../config/appConfig");
const deliveryFeeService = require("../../services/deliveryFeeService");
const mapboxService = require("../../services/mapboxService");
const audit = require("../../services/auditService");
const {
  PaymentStatus,
  OrderStatus,
  DeliveryStatus,
  DeliveryMethod,
  PaymentMethod,
} = require("../../utils/constants");

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
  const {
    paymentMethod,
    deliveryMethod,
    deliveryAddress,
    deliveryNotes,
    deliveryLocation, // optional: { placeId, lat, lng, formattedAddress } from Places
    clientSideId, // optional: unique ID from client for idempotency
  } = req.body;
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
    // Check for existing order with the same clientSideId (Idempotency)
    if (clientSideId) {
      const existingOrder = await Order.findOne({ clientSideId })
        .populate("products.product", "title listedPrice images brand")
        .populate("products.store", "name address mobile")
        .populate("orderedBy", "fullName email mobile");

      if (existingOrder) {
        return res.json({
          success: true,
          message: "Order already exists (Idempotent response)",
          data: {
            order: existingOrder,
            totalAmount: existingOrder.paymentIntent.amount,
            deliveryFee: existingOrder.deliveryFee,
            deliveryMethod: existingOrder.deliveryMethod,
            nextStep:
              existingOrder.deliveryMethod === DeliveryMethod.DELIVERY_AGENT
                ? "Waiting for delivery agent assignment"
                : "Ready for pickup",
          },
        });
      }
    }

    let populatedOrder;
    let totalAmount;
    let deliveryFee = 0;
    let deliveryMetadata = null;
    let resolvedDeliveryLocation;

    // ── Delivery pricing & geocoding — deliberately OUTSIDE the transaction ──
    // session.withTransaction() re-runs its callback whenever MongoDB reports a
    // transient error, so a billed third-party call placed inside it is paid for
    // again on every retry. These lookups are read-only, so they run exactly
    // once here and the transaction below only consumes the results.
    {
      const cartForPricing = await Cart.findOne({ owner: _id }).populate(
        "products.product",
      );

      if (!cartForPricing || cartForPricing.products.length === 0) {
        throw new Error("Cart is empty");
      }

      // Holds a resolved Place Details lookup so it is only paid for once,
      // shared between the fee calculation and the GeoJSON build further down.
      let placeDetails = null;

      if (deliveryMethod === DeliveryMethod.DELIVERY_AGENT) {
        try {
          // Get store with both address string and GeoJSON location
          const firstProduct = await Product.findById(
            cartForPricing.products[0].product._id,
          ).populate("store", "address location");

          if (!firstProduct || !firstProduct.store) {
            throw new Error("Store information not found");
          }

          const store = firstProduct.store;

          // Prefer GeoJSON coords for accuracy; fall back to address string
          const storeLocation =
            store.location?.coordinates?.length === 2
              ? {
                  lat: store.location.coordinates[1],
                  lng: store.location.coordinates[0],
                }
              : store.address;

          // Resolve user delivery location to coords (prefer pre-resolved placeId / lat+lng)
          let userLocation = deliveryAddress; // string fallback
          if (deliveryLocation?.lat && deliveryLocation?.lng) {
            userLocation = {
              lat: deliveryLocation.lat,
              lng: deliveryLocation.lng,
            };
          } else if (deliveryLocation?.placeId) {
            // Cached on `placeDetails` so the GeoJSON build below can reuse it
            // instead of paying for a second Place Details lookup.
            placeDetails = await mapboxService.getPlaceDetails(
              deliveryLocation.placeId,
            );
            if (placeDetails) {
              userLocation = { lat: placeDetails.lat, lng: placeDetails.lng };
            }
          }

          // Calculate fee using the Mapbox Matrix API
          const feeData = await deliveryFeeService.calculateDeliveryFee(
            storeLocation,
            userLocation,
          );

          deliveryFee = feeData.fee;
          deliveryMetadata = {
            distance: feeData.distance,
            estimatedTime: feeData.estimatedTime,
            calculatedAt: new Date(),
            storeAddress: store.address,
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

      // Build GeoJSON deliveryLocation from whatever the buyer provided
      if (deliveryLocation?.lat && deliveryLocation?.lng) {
        resolvedDeliveryLocation = {
          type: "Point",
          coordinates: [deliveryLocation.lng, deliveryLocation.lat],
          formattedAddress:
            deliveryLocation.formattedAddress || deliveryAddress,
        };
      } else if (deliveryLocation?.placeId) {
        // Reuse the lookup from the fee calculation when there was one;
        // only pay for a fresh call if the fee path never ran (e.g. pickup).
        const details =
          placeDetails ||
          (await mapboxService.getPlaceDetails(deliveryLocation.placeId));
        if (details) {
          resolvedDeliveryLocation = {
            type: "Point",
            coordinates: [details.lng, details.lat],
            formattedAddress: details.formattedAddress,
          };
        }
      }
    }

    await session.withTransaction(async () => {
      // Re-read the cart inside the transaction: this is the authoritative copy
      // the order is built from and stock is decremented against.
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

      totalAmount = userCart.cartTotal + deliveryFee;

      // Generate the human-friendly sequential order number (e.g. WM1201).
      // Uses the session so the counter rolls back if the transaction aborts.
      const orderNumber = await generateOrderNumber(session);

      // Create order
      const order = new Order({
        orderNumber,
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
        ...(resolvedDeliveryLocation && {
          deliveryLocation: resolvedDeliveryLocation,
        }),
        deliveryNotes: deliveryNotes || "",
        deliveryFee: deliveryFee,
        deliveryMetadata: deliveryMetadata,
        deliveryStatus:
          deliveryMethod === DeliveryMethod.DELIVERY_AGENT
            ? DeliveryStatus.PENDING_ASSIGNMENT
            : DeliveryStatus.ASSIGNED,
        orderedBy: _id,
        orderStatus: OrderStatus.PENDING,
        statusHistory: [
          { status: OrderStatus.PENDING, at: new Date(), role: "system" },
        ],
        paymentStatus: PaymentStatus.UNPAID,
        paymentMethod: paymentMethod,
        clientSideId: clientSideId,
      });

      const newOrder = await order.save({ session });

      // Atomically decrement stock with a quantity guard.
      // Equivalent to: UPDATE products SET quantity = quantity - n, sold = sold + n
      //                WHERE _id = ? AND quantity >= n
      // If any product no longer has enough stock (race condition), modifiedCount
      // will be less than expected and we throw to roll back the whole transaction.
      const productUpdates = userCart.products.map((item) => ({
        updateOne: {
          filter: { _id: item.product._id, quantity: { $gte: item.count } },
          update: {
            $inc: {
              quantity: -item.count,
              sold: item.count,
            },
          },
        },
      }));

      const stockResult = await Product.bulkWrite(productUpdates, { session });

      if (stockResult.modifiedCount !== userCart.products.length) {
        // Find which products failed so we can give a useful error
        const updatedIds = new Set();
        // Re-query affected products to find the culprit
        const freshProducts = await Product.find({
          _id: { $in: userCart.products.map((i) => i.product._id) },
        })
          .select("_id title quantity")
          .session(session);

        const insufficient = userCart.products.filter((item) => {
          const fresh = freshProducts.find(
            (p) => p._id.toString() === item.product._id.toString(),
          );
          // If still enough stock it was already decremented; otherwise it's the culprit
          return fresh && fresh.quantity < item.count;
        });

        const names = insufficient.map((i) => i.product.title).join(", ");
        throw new Error(
          `Insufficient stock for: ${names || "one or more products"}. Please update your cart.`,
        );
      }

      // Clear user's cart
      await Cart.findOneAndDelete({ owner: _id }).session(session);

      // Populate order details for response
      populatedOrder = await Order.findById(newOrder._id)
        .populate("products.product", "title listedPrice images brand")
        .populate("products.store", "name address mobile")
        .populate("orderedBy", "fullName email mobile")
        .session(session);
    });

    audit.log({
      action: "order.created",
      actor: audit.actor(req),
      resource: {
        type: "order",
        id: populatedOrder._id,
        displayName: `#${populatedOrder.orderNumber}`,
      },
      changes: {
        after: {
          paymentMethod,
          deliveryMethod,
          totalAmount,
          deliveryFee,
          paymentStatus: "Unpaid",
          orderStatus: OrderStatus.PENDING,
        },
      },
    });

    // Send notifications (outside transaction — notification failure must not roll back the order)
    try {
      const {
        sendOrderNotification,
        sendDeliveryAgentNotification,
      } = require("../notification");

      // Notify customer
      await sendOrderNotification(
        _id,
        "Order Created Successfully",
        `Your order #${populatedOrder.orderNumber} has been created. ${
          deliveryMethod === DeliveryMethod.DELIVERY_AGENT
            ? "Waiting for delivery agent assignment."
            : "Ready for pickup."
        }`,
        {
          orderId: populatedOrder._id.toString(),
          orderNumber: populatedOrder.orderNumber,
          totalAmount: totalAmount.toString(),
          deliveryMethod: deliveryMethod,
        },
        populatedOrder._id,
      );

      // Notify dispatch agents
      if (deliveryMethod === DeliveryMethod.DELIVERY_AGENT) {
        await sendDeliveryAgentNotification(
          "new_order_available",
          `New delivery order available: Order #${populatedOrder.orderNumber}`,
          {
            orderId: populatedOrder._id.toString(),
            orderNumber: populatedOrder.orderNumber,
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

module.exports = createOrder;

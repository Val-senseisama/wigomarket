// swagger.js
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Wigomarket backend api docs",
      version: "1.0.0",
      description: [
        "API documentation for WigoMarket e-commerce platform with real-time location tracking.",
        "",
        "**Client integration guides** live alongside this reference at [`/docs`](/docs) —",
        "long-form notes that a per-endpoint reference cannot carry, such as the",
        "[maps, delivery-fee and live-tracking guide](/docs/maps-integration) written for the",
        "Flutter client (address picker session tokens, the fee tariff, GeoJSON coordinate",
        "order, and the `/ws/location` WebSocket protocol).",
      ].join("\n"),
    },
    servers: [
      {
        url: process.env.API_URL || "http://localhost:5001",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: [
            "JWT issued by POST /api/user/login. Send as `Authorization: Bearer <token>`.",
            "",
            "Every endpoint marked with this scheme can fail in two ways before its",
            "own handler runs, regardless of what that endpoint documents:",
            "",
            "- **401** — missing, malformed, or expired token, or the account no",
            "  longer exists. The client should send the user back to login.",
            "- **403** — the token is valid but the account is blocked, not yet",
            "  active, or deleted (DELETE /api/user/me). Re-authenticating will NOT",
            "  help, so the client must not bounce to login; surface the message instead.",
            "",
            "Role guards (seller, dispatch, admin) also return **403**.",
          ].join("\n"),
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Error message",
            },
          },
        },
        StoreOpeningHours: {
          type: "object",
          nullable: true,
          description: "Weekly hours, display only. null until the seller saves hours.",
          properties: {
            timezone: { type: "string", example: "Africa/Lagos" },
            days: {
              type: "array",
              description: "Calendar order. A day not listed is closed. close < open runs past midnight.",
              items: {
                type: "object",
                properties: {
                  day: {
                    type: "string",
                    enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
                  },
                  isOpen: { type: "boolean" },
                  open: { type: "string", example: "09:00" },
                  close: { type: "string", example: "18:00" },
                },
              },
            },
          },
        },
        StoreSettings: {
          type: "object",
          properties: {
            isVisible: {
              type: "boolean",
              description: "false = shop and its products hidden from buyers; checkout refused",
            },
            openingHours: { $ref: "#/components/schemas/StoreOpeningHours" },
            isOpenNow: {
              type: "boolean",
              nullable: true,
              description: "Open right now by its own hours (display only); null when no hours are set",
            },
            fulfilmentOptions: {
              type: "array",
              description: "Enforced at checkout. delivery = deliveryMethod delivery_agent, pickup = self_delivery",
              items: { type: "string", enum: ["delivery", "pickup"] },
            },
          },
        },
        StoreSettingsResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { $ref: "#/components/schemas/StoreSettings" },
          },
        },
        Success: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "Success message",
            },
          },
        },
      },
    },
    tags: [
      {
        name: "Users",
        description: "User management and profile operations",
      },
      {
        name: "Products",
        description: "Product management and suggestions",
      },
      {
        name: "Store",
        description: "Store management for sellers",
      },
      {
        name: "Delivery Agent",
        description: "Delivery agent operations and management",
      },
      {
        name: "Payment",
        description: "Card / transfer checkout through the active payment provider (Monnify or Flutterwave)",
      },
      {
        name: "Location Tracking",
        description: "Real-time location tracking for delivery agents",
      },
      {
        name: "Notifications",
        description: "Push notifications and preferences",
      },
      {
        name: "Rating",
        description: "Rating and review system",
      },
      {
        name: "Banks",
        description: "Bank list and account-name lookup through the active payment provider",
      },
      {
        name: "WebSocket",
        description: "Real-time WebSocket connections",
      },
      {
        name: "Receipts",
        description: "PDF receipt and document generation",
      },
      {
        name: "Orders",
        description: "Order placement, tracking, and delivery confirmation",
      },
      {
        name: "Wishlist",
        description: "User wishlist and saved products management",
      },
      {
        name: "Seller Discovery",
        description: "Popular sellers and location-based seller discovery",
      },
      {
        name: "Search",
        description:
          "Global fuzzy search, autocomplete, recent & trending queries",
      },
      {
        name: "Upload",
        description:
          "Cloudinary signed-upload signatures — get a signature here, upload directly to Cloudinary, then pass the resulting URL to the relevant endpoint",
      },
      {
        name: "Home",
        description: "Home-screen feed endpoints — top shops, categories, nearby shops, popular vendors, and personalised product suggestions",
      },
    ],
  },
  apis: [
    "./routes/homeRouter.js",
    "./routes/uploadRouter.js",
    "./routes/authRouter.js",
    "./routes/productRouter.js",
    "./routes/storeRouter.js",
    "./routes/orderRouter.js",
    "./routes/deliveryAgentRouter.js",
    "./routes/paymentRouter.js",
    "./routes/locationTrackingRouter.js",
    "./routes/notificationRouter.js",
    "./routes/ratingRouter.js",
    "./routes/bankRouter.js",
    "./routes/walletRouter.js",
    "./routes/websocketRouter.js",
    "./routes/wishlistRouter.js",
    "./routes/sellerDiscoveryRouter.js",
    "./routes/mapsRouter.js",
    "./routes/billPaymentRouter.js",
    "./routes/searchRouter.js",
    "./routes/adminRouter.js",
    "./routes/supportRouter.js",
  ],
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};

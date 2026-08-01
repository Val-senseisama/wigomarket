// swagger.js
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Wigomarket backend api docs",
      version: "1.0.0",
      description:
        "API documentation for WigoMarket e-commerce platform with real-time location tracking",
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
            "- **403** — the token is valid but the account is blocked or not yet",
            "  active. Re-authenticating will NOT help, so the client must not",
            "  bounce to login; surface the message instead.",
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
        description: "Payment processing with Flutterwave",
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
        name: "Flutterwave",
        description: "Flutterwave integration utilities",
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
    "./routes/flutterwaveRouter.js",
    "./routes/walletRouter.js",
    "./routes/websocketRouter.js",
    "./routes/wishlistRouter.js",
    "./routes/sellerDiscoveryRouter.js",
    "./routes/mapsRouter.js",
    "./routes/billPaymentRouter.js",
    "./routes/searchRouter.js",
    "./routes/adminRouter.js",
  ],
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};

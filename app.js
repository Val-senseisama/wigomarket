require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const { dbConnect, dbDisconnect } = require("./config/dbConnect");
const authRouter = require("./routes/authRouter");
const productRouter = require("./routes/productRouter");
const storeRouter = require("./routes/storeRouter");
const deliveryAgentRouter = require("./routes/deliveryAgentRouter");
const paymentRouter = require("./routes/paymentRouter");
const orderRouter = require("./routes/orderRouter");
const locationTrackingRouter = require("./routes/locationTrackingRouter");
const ratingRouter = require("./routes/ratingRouter");
const notificationRouter = require("./routes/notificationRouter");
const flutterwaveRouter = require("./routes/flutterwaveRouter");
const walletRouter = require("./routes/walletRouter");
const wishlistRouter = require("./routes/wishlistRouter");
const sellerDiscoveryRouter = require("./routes/sellerDiscoveryRouter");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { swaggerUi, specs } = require("./swagger");
const LocationWebSocketServer = require("./websocket/locationWebSocket");

const app = express();

// CORS configuration - allowing all origins for development
app.use(
  cors({
    origin: true, // Allow all origins in development
    credentials: true, // Allow cookies and authorization headers
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

app.get("/", (req, res) => {
  res.send(`<a href="/api-docs">API Docs</a>`);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(morgan("dev"));
app.use(cookieParser());

app.use("/api/user", authRouter);
app.use("/api/product", productRouter);
app.use("/api/store", storeRouter);
app.use("/api/delivery-agent", deliveryAgentRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/order", orderRouter);
app.use("/api/location", locationTrackingRouter);
app.use("/api/rating", ratingRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/flutterwave", flutterwaveRouter);
app.use("/api", walletRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/sellers", sellerDiscoveryRouter);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
let server;
let locationWebSocket;

// Start server with database connection
const startServer = async () => {
  try {
    // Connect to database with retry logic
    await dbConnect();

    // Start HTTP server
    server = app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT}, http://localhost:${PORT}`);
      console.log(`📚 API docs: http://localhost:${PORT}/api-docs`);
    });

    // Initialize WebSocket server for real-time location tracking
    locationWebSocket = new LocationWebSocketServer(server);
    console.log("📡 Location WebSocket server initialized");
  } catch (error) {
    console.error("💥 Failed to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    // Close WebSocket connections
    if (locationWebSocket) {
      locationWebSocket.close();
      console.log("✅ WebSocket server closed");
    }

    // Close HTTP server (stop accepting new connections)
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log("✅ HTTP server closed");
          resolve();
        });
      });
    }

    // Close database connection
    await dbDisconnect();

    console.log("👋 Process terminated gracefully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT")); // Ctrl+C

// Start the server
startServer();

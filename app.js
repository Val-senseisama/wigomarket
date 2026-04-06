require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const logger = require("./services/logger");
const requestId = require("./middleware/requestId");
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
const mapsRouter = require("./routes/mapsRouter");
const billPaymentRouter = require("./routes/billPaymentRouter");
const adminRouter = require("./routes/adminRouter");
const searchRouter = require("./routes/searchRouter");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { swaggerUi, specs } = require("./swagger");
const LocationWebSocketServer = require("./websocket/locationWebSocket");
const { startCron } = require("./services/pendingPaymentCron");
const paymentQueue = require("./services/paymentQueue");
const taskQueue = require("./services/taskQueue");

// ── Attach global uncaughtException / unhandledRejection handlers ─────────────
// Must be called before any async work starts so nothing slips through.
logger.setupGlobalHandlers();

const app = express();

// CORS configuration - allowing all origins for development
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Attach a unique x-request-id to every request (used in error handler + audit logs)
app.use(requestId);

app.get("/", (req, res) => {
  res.send(`<a href="/api-docs">API Docs</a>`);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// HTTP request logging — pipe morgan through Winston so it goes to all transports
app.use(
  morgan("combined", {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
    // Skip health-check pings from cluttering logs
    skip: (req) => req.originalUrl === "/",
  }),
);

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
app.use("/api/maps", mapsRouter);
app.use("/api/bills", billPaymentRouter);
app.use("/api/admin", adminRouter);
app.use("/api/search", searchRouter);

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

    // Enable persistent log transports now that the DB is connected
    logger.enableMongoTransport(); // stores info+ in app_logs collection
    logger.enableAxiomTransport(); // optional: free external viewer (set AXIOM_TOKEN + AXIOM_DATASET)

    // Start HTTP server
    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`API docs: http://localhost:${PORT}/api-docs`);
    });

    // Initialize WebSocket server for real-time location tracking
    locationWebSocket = new LocationWebSocketServer(server);
    logger.info("Location WebSocket server initialized");

    // Start pending-payment recovery cron (after DB is ready)
    startCron();

    // Initialise payment queue (BullMQ + Redis, with in-process fallback)
    await paymentQueue.init();

    // Initialise secondary task queue (Email, Push, Bill API)
    await taskQueue.init();
  } catch (error) {
    logger.error("Failed to start server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);

  try {
    if (locationWebSocket) {
      locationWebSocket.close();
      logger.info("WebSocket server closed");
    }

    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          logger.info("HTTP server closed");
          resolve();
        });
      });
    }

    await paymentQueue.close();
    logger.info("Payment queue closed");

    await taskQueue.close();
    logger.info("Task queue closed");

    await dbDisconnect();
    logger.info("Database disconnected — process exiting cleanly");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", { error: error.message });
    process.exit(1);
  }
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT")); // Ctrl+C

// Start the server only when run directly (not during tests)
if (require.main === module) {
  startServer();
}

module.exports = app;

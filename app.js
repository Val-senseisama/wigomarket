require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authRouter");
const productRouter = require("./routes/productRouter");
const storeRouter = require("./routes/storeRouter");
const deliveryAgentRouter = require("./routes/deliveryAgentRouter");
const paymentRouter = require("./routes/paymentRouter");
const locationTrackingRouter = require("./routes/locationTrackingRouter");
const ratingRouter = require("./routes/ratingRouter");
const notificationRouter = require("./routes/notificationRouter");
const flutterwaveRouter = require("./routes/flutterwaveRouter");
const walletRouter = require("./routes/walletRouter");
const wishlistRouter = require("./routes/wishlistRouter");
const sellerDiscoveryRouter = require("./routes/sellerDiscoveryRouter");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { swaggerUi, specs } = require('./swagger');
const LocationWebSocketServer = require('./websocket/locationWebSocket');

const app = express();

// CORS configuration - allowing all origins for development
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true, // Allow cookies and authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.get("/", (req, res) => {
  res.send(`<a href="/api-docs">API Docs</a>`);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(morgan("dev"));
app.use(cookieParser());
dbConnect();

app.use("/api/user", authRouter);
app.use("/api/product", productRouter);
app.use("/api/store", storeRouter);
app.use("/api/delivery-agent", deliveryAgentRouter);
app.use("/api/payment", paymentRouter);
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
const server = app.listen(PORT, () => {
  console.log(`app is running on ${PORT}, http://localhost:${PORT}`);
  console.log(`api-docs: http://localhost:${PORT}/api-docs`);
});

// Initialize WebSocket server for real-time location tracking
const locationWebSocket = new LocationWebSocketServer(server);
console.log('Location WebSocket server initialized');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  locationWebSocket.close();
  server.close(() => {
    console.log('Process terminated');
  });
});

const mongoose = require("mongoose");

/**
 * Database connection with exponential backoff retry
 * @param {number} retries - Number of retries attempted
 * @returns {Promise<void>}
 */
const dbConnect = async (retries = 0) => {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 1000; // Start with 1 second

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log("✅ Database connected successfully");

    // Connection event listeners
    mongoose.connection.on("connected", () => {
      console.log("📊 Mongoose connected to MongoDB");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ Mongoose connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  Mongoose disconnected from MongoDB");
    });

    // Reconnection logic
    mongoose.connection.on("reconnected", () => {
      console.log("🔄 Mongoose reconnected to MongoDB");
    });
  } catch (error) {
    console.error(
      `❌ Database connection error (attempt ${retries + 1}/${MAX_RETRIES}):`,
      error.message,
    );

    if (retries < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retries); // Exponential backoff
      console.log(`⏳ Retrying in ${delay}ms...`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      return dbConnect(retries + 1);
    } else {
      console.error("💥 Max database connection retries reached. Exiting...");
      process.exit(1);
    }
  }
};

/**
 * Gracefully close database connection
 * @returns {Promise<void>}
 */
const dbDisconnect = async () => {
  try {
    await mongoose.connection.close();
    console.log("✅ Database connection closed gracefully");
  } catch (error) {
    console.error("❌ Error closing database connection:", error);
  }
};

module.exports = { dbConnect, dbDisconnect };

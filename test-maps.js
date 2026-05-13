require("dotenv").config();
const deliveryFeeService = require("./services/deliveryFeeService");

async function runTest() {
  console.log("🚀 Testing Google Maps Delivery Fee Calculation...\n");

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error("❌ GOOGLE_MAPS_API_KEY is missing from your .env file!");
    process.exit(1);
  }

  // Two common locations in Lagos, Nigeria
  const storeAddress = "Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos";
  const userAddress = "Lekki Phase 1, Lagos, Nigeria";

  console.log(`🏬 Store Address: ${storeAddress}`);
  console.log(`🏠 Customer Address: ${userAddress}\n`);
  console.log("⏳ Calculating distance and fee...");

  try {
    const result = await deliveryFeeService.calculateDeliveryFee(
      storeAddress,
      userAddress,
    );

    if (result.fallback) {
      console.log("\n⚠️ Warning: Used fallback base fee.");
      console.log(
        `Reason: Could not calculate actual distance. Check if Geocoding and Distance Matrix APIs are enabled.`,
      );
    } else {
      console.log("\n✅ Calculation Successful!");
    }

    console.log("-----------------------------------------");
    console.log(
      `🛣️  Road Distance: ${result.distance} km (${result.distanceText || "N/A"})`,
    );
    console.log(
      `⏱️  Estimated Time: ${result.estimatedTime} mins (${result.durationText || "N/A"})`,
    );
    console.log(`💰 Delivery Fee: ₦${result.fee}`);
    console.log("-----------------------------------------");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error calculation failed:", error.message);
    process.exit(1);
  }
}

runTest();

// Runs in each worker process before test files load.
// Sets env vars BEFORE app.js runs dotenv.config() (dotenv won't override already-set vars).
const fs = require("fs");
const path = require("path");

const uriFile = path.join(__dirname, ".mongouri");
process.env.MONGODB_URI = fs.readFileSync(uriFile, "utf8").trim();
process.env.JWT_SECRET = "test-jwt-secret-key";
process.env.MAIL_API = "test-resend-key";
process.env.GOOGLE_MAPS_API_KEY = "test-maps-key";

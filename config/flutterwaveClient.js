const Flutterwave = require("flutterwave-node-v3");
const appConfig = require("./appConfig");

let flw = null;

/**
 * Returns a lazily-initialised Flutterwave client.
 * Throws if credentials are not configured.
 */
function getFlutterwaveInstance() {
  if (!flw) {
    const cfg = appConfig.payment.flutterwave;
    if (!cfg.publicKey || !cfg.secretKey) {
      throw new Error("Flutterwave credentials not configured");
    }
    flw = new Flutterwave(cfg.publicKey, cfg.secretKey);
  }
  return flw;
}

module.exports = { getFlutterwaveInstance };

/**
 * @file services/payments/index.js
 * @description The only entry point to payment service providers. See
 * README.md in this folder for the adapter interface.
 *
 * `getProvider()` returns the active provider (PAYMENT_PROVIDER) for new
 * checkouts, payouts and bank lookups. Anything tied to an existing charge —
 * verifying it, refunding it — must ask for the provider that took it, by the
 * name stored on the order / ledger, so switching providers never strands
 * money taken by the old one.
 */

const appConfig = require("../../config/appConfig");
const { PaymentProviderError } = require("./errors");

const providers = {
  monnify: require("./monnifyProvider"),
  flutterwave: require("./flutterwaveProvider"),
};

function activeProviderName() {
  return appConfig.payment.provider;
}

function getProvider(name = activeProviderName()) {
  const provider = providers[String(name).toLowerCase()];
  if (!provider) {
    throw new PaymentProviderError(`Unknown payment provider "${name}". Expected one of: ${Object.keys(providers).join(", ")}`);
  }
  return provider;
}

const isProvider = (name) => Object.prototype.hasOwnProperty.call(providers, String(name).toLowerCase());

module.exports = { getProvider, activeProviderName, isProvider, PaymentProviderError };

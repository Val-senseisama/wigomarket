/**
 * Thrown by a payment provider adapter for configuration problems and for
 * transport failures (timeout, 5xx, unparseable response). A caller that moved
 * money must treat it as "outcome unknown", never as "declined".
 */
class PaymentProviderError extends Error {
  constructor(message, { provider, status, body } = {}) {
    super(message);
    this.name = "PaymentProviderError";
    this.provider = provider;
    this.status = status ?? null; // HTTP status, when there was a response
    this.body = body ?? null;
  }
}

module.exports = { PaymentProviderError };

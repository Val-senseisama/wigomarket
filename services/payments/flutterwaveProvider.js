/**
 * @file flutterwaveProvider.js
 * @description Flutterwave (v3 REST) adapter. See services/payments/README.md
 * for the interface every adapter implements.
 *
 * Uses the REST API directly: flutterwave-node-v3 has no Standard-checkout
 * method, which is why checkout initialisation never worked through the SDK.
 */

const axios = require("axios");
const crypto = require("crypto");
const appConfig = require("../../config/appConfig");
const { PaymentProviderError } = require("./errors");

const NAME = "flutterwave";
const BASE_URL = "https://api.flutterwave.com/v3";
const TIMEOUT_MS = 30_000;

function config() {
  return appConfig.payment.flutterwave;
}

async function send({ method, url, data }) {
  const secretKey = config().secretKey;
  if (!secretKey) {
    throw new PaymentProviderError("Flutterwave is not configured (missing FLW_SECRET_KEY)", { provider: NAME });
  }
  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${url}`,
      data,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    throw new PaymentProviderError(`Flutterwave ${method.toUpperCase()} ${url} failed: ${err.response?.data?.message || err.message}`, {
      provider: NAME,
      status: err.response?.status,
      body: err.response?.data,
    });
  }
}

// A 4xx with Flutterwave's `{ status: "error" }` body is a refusal, not a
// transport failure. 401/403 are our credentials and stay errors.
const isDefiniteRejection = (err) =>
  err instanceof PaymentProviderError &&
  err.status >= 400 &&
  err.status < 500 &&
  ![401, 403].includes(err.status) &&
  err.body?.status === "error";

// ── Collections ──────────────────────────────────────────────────────────────

async function initializeCheckout({ reference, amount, currency = "NGN", customer, description, redirectUrl, metadata }) {
  const body = await send({
    method: "post",
    url: "/payments",
    data: {
      tx_ref: reference,
      amount,
      currency,
      redirect_url: redirectUrl,
      customer: { email: customer.email, phonenumber: customer.phone, name: customer.name },
      customizations: { title: "WigoMarket Payment", description, logo: process.env.LOGO_URL },
      meta: metadata,
    },
  });
  if (body?.status !== "success" || !body.data?.link) {
    throw new PaymentProviderError(body?.message || "Flutterwave did not return a checkout link", { provider: NAME, body });
  }
  return { checkoutUrl: body.data.link, providerReference: null };
}

const CHARGE_STATUS = { successful: "succeeded", failed: "failed", pending: "pending" };

async function verifyCharge({ reference }) {
  let body;
  try {
    body = await send({ method: "get", url: `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}` });
  } catch (err) {
    // No transaction under this reference yet: the buyer never reached checkout.
    if (isDefiniteRejection(err)) {
      return { status: "pending", reference, providerTransactionId: null, amount: null, currency: null, providerStatus: null };
    }
    throw err;
  }
  const data = body?.data ?? {};
  return {
    status: CHARGE_STATUS[data.status] ?? "pending",
    reference: data.tx_ref,
    providerTransactionId: data.id != null ? String(data.id) : null,
    amount: data.amount != null ? Number(data.amount) : null,
    currency: data.currency ?? null, // missing → refused by settlement, never assumed
    providerStatus: data.status ?? null,
  };
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Flutterwave sends the dashboard's secret hash verbatim in `verif-hash`;
 * newer integrations also send `flutterwave-signature`, a base64 HMAC-SHA256
 * of the raw body keyed with that hash. Either one is accepted.
 */
function verifyWebhookSignature({ headers, rawBody }) {
  const secretHash = config().webhookSecretHash;
  if (!secretHash) return false;
  if (headers["verif-hash"]) return safeEqual(headers["verif-hash"], secretHash);
  if (headers["flutterwave-signature"] && rawBody) {
    const expected = crypto.createHmac("sha256", secretHash).update(rawBody).digest("base64");
    return safeEqual(headers["flutterwave-signature"], expected);
  }
  return false;
}

function parseWebhook(body) {
  const data = body?.data ?? {};
  if (body?.event === "charge.completed" && data.status === "successful" && data.tx_ref) {
    return {
      type: "charge.succeeded",
      reference: data.tx_ref,
      providerTransactionId: data.id != null ? String(data.id) : null,
    };
  }
  if (body?.event === "transfer.completed" && data.reference) {
    return {
      type: "transfer.updated",
      reference: data.reference,
      providerTransferId: data.id != null ? String(data.id) : null,
      providerStatus: data.status ?? null,
    };
  }
  return null;
}

// ── Refunds ──────────────────────────────────────────────────────────────────

/**
 * Only an explicit success with a refund id counts as success; only an
 * explicit error counts as rejected; anything else is unknown (fail closed).
 * Flutterwave refunds take no idempotency key and cannot be looked up by a
 * reference of ours, so an unknown outcome needs a human.
 */
function refundResult(body) {
  const dataStatus = String(body?.data?.status ?? "").toLowerCase();
  if (body?.status === "success" && body.data?.id != null && dataStatus !== "failed") {
    return { outcome: "succeeded", providerRefundId: String(body.data.id), providerStatus: dataStatus || null, message: null };
  }
  if (body?.status === "error" || (body?.status === "success" && dataStatus === "failed")) {
    return { outcome: "rejected", providerRefundId: null, providerStatus: dataStatus || null, message: body?.message || "Flutterwave rejected the refund" };
  }
  return {
    outcome: "unknown",
    providerRefundId: null,
    providerStatus: null,
    message: `Unrecognised Flutterwave response: ${JSON.stringify(body)?.slice(0, 500)}`,
  };
}

async function refund({ providerTransactionId, amount }) {
  try {
    const body = await send({ method: "post", url: `/transactions/${encodeURIComponent(providerTransactionId)}/refund`, data: { amount } });
    return refundResult(body);
  } catch (err) {
    if (isDefiniteRejection(err)) return refundResult(err.body);
    return { outcome: "unknown", providerRefundId: null, providerStatus: null, message: `Flutterwave call failed: ${err.message}` };
  }
}

// Not queryable by our reference; see refund(). supportsRefundStatus is false.
async function getRefundStatus() {
  return null;
}

// ── Payouts ──────────────────────────────────────────────────────────────────

const TRANSFER_OUTCOME = { SUCCESSFUL: "succeeded", NEW: "pending", PENDING: "pending", FAILED: "failed" };

async function transfer({ amount, reference, narration, bankCode, accountNumber }) {
  let body;
  try {
    body = await send({
      method: "post",
      url: "/transfers",
      data: {
        account_bank: bankCode,
        account_number: accountNumber,
        amount,
        narration,
        currency: "NGN",
        reference,
        debit_currency: "NGN",
      },
    });
  } catch (err) {
    if (isDefiniteRejection(err)) {
      return { outcome: "failed", reference, providerTransferId: null, providerStatus: null, message: err.body?.message || err.message };
    }
    throw err;
  }
  if (body?.status !== "success") {
    return { outcome: "failed", reference, providerTransferId: null, providerStatus: null, message: body?.message || "Transfer initiation failed" };
  }
  return transferResult(body.data, reference);
}

function transferResult(data, reference) {
  const providerStatus = data?.status ?? null;
  return {
    outcome: TRANSFER_OUTCOME[providerStatus] ?? "pending",
    reference: data?.reference ?? reference,
    providerTransferId: data?.id != null ? String(data.id) : null,
    providerStatus,
    message: providerStatus === "FAILED" ? data?.complete_message || "Flutterwave transfer failed" : null,
  };
}

/**
 * Flutterwave looks transfers up by its own id, which transfer() returns and
 * transfer webhooks carry. Without one there is nothing to ask: null.
 */
async function getTransferStatus({ reference, providerTransferId }) {
  if (!providerTransferId) return null;
  let body;
  try {
    body = await send({ method: "get", url: `/transfers/${encodeURIComponent(providerTransferId)}` });
  } catch (err) {
    // Only a 404 means "no such transfer"; see monnifyProvider.getTransferStatus.
    if (isDefiniteRejection(err) && err.status === 404) {
      return { outcome: "not_found", reference, providerTransferId, providerStatus: null, message: err.body?.message || err.message };
    }
    throw err;
  }
  return transferResult(body?.data, reference);
}

// ── Banks ────────────────────────────────────────────────────────────────────

async function listBanks() {
  const body = await send({ method: "get", url: "/banks/NG" });
  return (body?.data ?? []).map((b) => ({ code: b.code, name: b.name }));
}

async function resolveAccount({ accountNumber, bankCode }) {
  const body = await send({ method: "post", url: "/accounts/resolve", data: { account_number: accountNumber, account_bank: bankCode } });
  return { accountNumber: body.data.account_number, accountName: body.data.account_name, bankCode };
}

module.exports = {
  name: NAME,
  // Can getRefundStatus() tell us how a refund under our reference ended?
  supportsRefundStatus: false,
  initializeCheckout,
  verifyCharge,
  verifyWebhookSignature,
  parseWebhook,
  refund,
  getRefundStatus,
  transfer,
  getTransferStatus,
  listBanks,
  resolveAccount,
};

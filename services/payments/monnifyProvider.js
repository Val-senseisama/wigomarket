/**
 * @file monnifyProvider.js
 * @description Monnify adapter. See services/payments/README.md for the
 * interface every adapter implements.
 *
 * Monnify wraps every response as
 *   { requestSuccessful, responseMessage, responseCode, responseBody }
 * and authenticates with a short-lived bearer token from /api/v1/auth/login
 * (Basic apiKey:secretKey). Webhooks carry `monnify-signature`: the hex
 * HMAC-SHA512 of the raw body keyed with the secret key. Sandbox webhooks are
 * not signed, which is safe here only because every webhook is re-verified
 * against the API before money is booked.
 */

const axios = require("axios");
const crypto = require("crypto");
const appConfig = require("../../config/appConfig");
const { PaymentProviderError } = require("./errors");

const NAME = "monnify";
const TIMEOUT_MS = 30_000;
// Refresh the token this long before Monnify says it expires.
const TOKEN_SKEW_MS = 60_000;

let token = null;
let tokenExpiresAt = 0;

function config() {
  return appConfig.payment.monnify;
}

function requireConfig(...keys) {
  const cfg = config();
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new PaymentProviderError(`Monnify is not configured (missing ${missing.join(", ")})`, { provider: NAME });
  }
  return cfg;
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - TOKEN_SKEW_MS) return token;
  const cfg = requireConfig("apiKey", "secretKey");
  const basic = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString("base64");
  const body = await send({
    method: "post",
    url: "/api/v1/auth/login",
    headers: { Authorization: `Basic ${basic}` },
  });
  token = body.accessToken;
  tokenExpiresAt = Date.now() + Number(body.expiresIn) * 1000;
  return token;
}

/**
 * One HTTP call. Resolves with `responseBody` on success; throws
 * PaymentProviderError otherwise. A 4xx with a Monnify envelope is a definite
 * answer, so it is thrown with `status` set and the caller can decide.
 */
async function send({ method, url, data, headers }) {
  let res;
  try {
    res = await axios({
      method,
      url: `${config().baseUrl}${url}`,
      data,
      headers: { "Content-Type": "application/json", ...headers },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    throw new PaymentProviderError(`Monnify ${method.toUpperCase()} ${url} failed: ${body?.responseMessage || err.message}`, {
      provider: NAME,
      status,
      body,
    });
  }
  if (!res.data?.requestSuccessful) {
    throw new PaymentProviderError(`Monnify ${url}: ${res.data?.responseMessage || "request not successful"}`, {
      provider: NAME,
      status: res.status,
      body: res.data,
    });
  }
  return res.data.responseBody;
}

async function authed(opts) {
  return send({ ...opts, headers: { Authorization: `Bearer ${await getToken()}` } });
}

// A 4xx carrying Monnify's envelope is Monnify's answer, not a transport
// failure: the request was received and refused. 401/403 are our credentials,
// not an answer about this request, so they stay errors.
const isDefiniteRejection = (err) =>
  err instanceof PaymentProviderError &&
  err.status >= 400 &&
  err.status < 500 &&
  ![401, 403].includes(err.status) &&
  err.body?.requestSuccessful === false;

// ── Collections ──────────────────────────────────────────────────────────────

async function initializeCheckout({ reference, amount, currency = "NGN", customer, description, redirectUrl, metadata }) {
  const cfg = requireConfig("apiKey", "secretKey", "contractCode");
  const body = await authed({
    method: "post",
    url: "/api/v1/merchant/transactions/init-transaction",
    data: {
      amount,
      customerName: customer.name,
      customerEmail: customer.email,
      paymentReference: reference,
      paymentDescription: description,
      currencyCode: currency,
      contractCode: cfg.contractCode,
      redirectUrl,
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
      metaData: metadata,
    },
  });
  return { checkoutUrl: body.checkoutUrl, providerReference: body.transactionReference };
}

const CHARGE_STATUS = {
  PAID: "succeeded",
  OVERPAID: "succeeded", // settled only if the amount guard accepts it
  PENDING: "pending",
  PARTIALLY_PAID: "pending",
  FAILED: "failed",
  EXPIRED: "failed",
  ABANDONED: "failed",
  CANCELLED: "failed",
  REVERSED: "failed",
};

async function verifyCharge({ reference }) {
  let body;
  try {
    body = await authed({
      method: "get",
      url: `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`,
    });
  } catch (err) {
    // No transaction under this reference yet: the buyer never reached checkout.
    if (isDefiniteRejection(err)) {
      return { status: "pending", reference, providerTransactionId: null, amount: null, currency: null, providerStatus: null };
    }
    throw err;
  }
  return {
    status: CHARGE_STATUS[body.paymentStatus] ?? "pending",
    reference: body.paymentReference,
    providerTransactionId: body.transactionReference,
    amount: body.amountPaid != null ? Number(body.amountPaid) : null,
    currency: body.currency ?? body.currencyCode ?? "NGN",
    providerStatus: body.paymentStatus,
  };
}

function verifyWebhookSignature({ headers, rawBody }) {
  const signature = headers["monnify-signature"];
  if (!signature) {
    // Monnify does not sign sandbox webhooks.
    return config().environment === "SANDBOX";
  }
  const secret = config().secretKey;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DISBURSEMENT_EVENTS = ["SUCCESSFUL_DISBURSEMENT", "FAILED_DISBURSEMENT", "REVERSED_DISBURSEMENT"];

function parseWebhook(body) {
  const data = body?.eventData ?? {};
  if (body?.eventType === "SUCCESSFUL_TRANSACTION" && data.paymentReference) {
    return {
      type: "charge.succeeded",
      reference: data.paymentReference,
      providerTransactionId: data.transactionReference ?? null,
    };
  }
  if (DISBURSEMENT_EVENTS.includes(body?.eventType) && data.reference) {
    return {
      type: "transfer.updated",
      reference: data.reference,
      providerTransferId: null,
      providerStatus: data.status ?? body.eventType,
    };
  }
  return null;
}

// ── Refunds ──────────────────────────────────────────────────────────────────

const REFUND_OUTCOME = { COMPLETED: "succeeded", IN_PROGRESS: "pending", FAILED: "rejected" };

function refundResult(body) {
  const providerStatus = body?.refundStatus ?? null;
  const outcome = REFUND_OUTCOME[providerStatus] ?? "unknown";
  return {
    outcome,
    providerRefundId: body?.refundReference ?? null,
    providerStatus,
    message:
      outcome === "rejected"
        ? body?.comment || "Monnify rejected the refund"
        : outcome === "unknown"
          ? `Unrecognised Monnify refund status: ${providerStatus}`
          : null,
  };
}

/**
 * `refundReference` is ours and Monnify refuses a second refund under it, so
 * an unknown outcome can be settled by asking getRefundStatus instead of
 * guessing.
 */
async function refund({ providerTransactionId, amount, refundReference, reason }) {
  try {
    const body = await authed({
      method: "post",
      url: "/api/v1/refunds/initiate-refund",
      data: {
        transactionReference: providerTransactionId,
        refundReference,
        refundAmount: amount,
        refundReason: String(reason || "Refund").slice(0, 64),
        customerNote: "WigoMarket order", // Monnify caps this at 16 chars
      },
    });
    return refundResult(body);
  } catch (err) {
    if (isDefiniteRejection(err)) {
      return { outcome: "rejected", providerRefundId: null, providerStatus: null, message: err.body.responseMessage || err.message };
    }
    return { outcome: "unknown", providerRefundId: null, providerStatus: null, message: err.message };
  }
}

async function getRefundStatus({ refundReference }) {
  try {
    const body = await authed({ method: "get", url: `/api/v1/refunds/${encodeURIComponent(refundReference)}` });
    return refundResult(body);
  } catch (err) {
    return { outcome: "unknown", providerRefundId: null, providerStatus: null, message: err.message };
  }
}

// ── Payouts ──────────────────────────────────────────────────────────────────

const TRANSFER_OUTCOME = {
  SUCCESS: "succeeded",
  PENDING: "pending",
  IN_PROGRESS: "pending",
  // Two-factor auth is on for the wallet: nothing moves until someone enters
  // an OTP, but the transfer exists and can still be authorised, so it is not
  // a failure. Payouts need 2FA for API disbursements switched off in Monnify.
  PENDING_AUTHORIZATION: "pending",
  OTP_EMAIL_DISPATCH_FAILED: "pending",
  FAILED: "failed",
  REVERSED: "failed",
  EXPIRED: "failed",
};

function transferResult(body, reference) {
  const providerStatus = body?.status ?? null;
  const outcome = TRANSFER_OUTCOME[providerStatus] ?? "pending";
  return {
    outcome,
    reference: body?.reference ?? reference,
    providerTransferId: null, // Monnify identifies a disbursement by our reference
    providerStatus,
    message: ["PENDING_AUTHORIZATION", "OTP_EMAIL_DISPATCH_FAILED"].includes(providerStatus)
      ? "Monnify is holding the transfer for OTP authorisation; disable 2FA for API disbursements"
      : outcome === "failed"
        ? body?.transactionDescription || `Monnify transfer ${providerStatus}`
        : null,
  };
}

async function transfer({ amount, reference, narration, bankCode, accountNumber, accountName }) {
  const cfg = requireConfig("apiKey", "secretKey", "walletAccountNumber");
  try {
    const body = await authed({
      method: "post",
      url: "/api/v2/disbursements/single",
      data: {
        amount,
        reference,
        narration,
        destinationBankCode: bankCode,
        destinationAccountNumber: accountNumber,
        destinationAccountName: accountName,
        currencyCode: "NGN",
        sourceAccountNumber: cfg.walletAccountNumber,
      },
    });
    return transferResult(body, reference);
  } catch (err) {
    if (isDefiniteRejection(err)) {
      return { outcome: "failed", reference, providerTransferId: null, providerStatus: null, message: err.body.responseMessage || err.message };
    }
    throw err;
  }
}

/**
 * Where a payout under our reference stands. `outcome` is `not_found` when
 * Monnify has no disbursement under it (the initiating call never arrived).
 * Throws PaymentProviderError when Monnify cannot be asked.
 */
async function getTransferStatus({ reference }) {
  try {
    const body = await authed({
      method: "get",
      url: `/api/v2/disbursements/single/summary?reference=${encodeURIComponent(reference)}`,
    });
    return transferResult(body, reference);
  } catch (err) {
    if (isDefiniteRejection(err)) {
      return { outcome: "not_found", reference, providerTransferId: null, providerStatus: null, message: err.body.responseMessage || err.message };
    }
    throw err;
  }
}

// ── Banks ────────────────────────────────────────────────────────────────────

async function listBanks() {
  const body = await authed({ method: "get", url: "/api/v1/banks" });
  return (body ?? []).map((b) => ({ code: b.code, name: b.name }));
}

async function resolveAccount({ accountNumber, bankCode }) {
  const params = new URLSearchParams({ accountNumber, bankCode });
  const body = await authed({ method: "get", url: `/api/v1/disbursements/account/validate?${params}` });
  return { accountNumber: body.accountNumber, accountName: body.accountName, bankCode: body.bankCode ?? bankCode };
}

// Test hook: drop the cached token.
function resetToken() {
  token = null;
  tokenExpiresAt = 0;
}

module.exports = {
  name: NAME,
  // Can getRefundStatus() tell us how a refund under our reference ended?
  supportsRefundStatus: true,
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
  resetToken,
};

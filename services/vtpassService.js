/**
 * @file vtpassService.js
 * @description Central helper for all VTpass API interactions.
 *
 * AUTH RULES (from VTpass docs):
 *   - POST /pay    → api-key + secret-key
 *   - POST /requery → api-key + public-key
 *   - GET  /service-variations → api-key + public-key
 *   - POST /merchant-verify   → api-key + public-key
 */

const appConfig = require("../config/appConfig");

const BASE_URL = process.env.VTU_API_URL || "https://sandbox.vtpass.com/api";
const API_KEY = process.env.VTU_API_KEY;
const PUB_KEY = process.env.VTU_PUBLIC_KEY;
const SEC_KEY = process.env.VTU_SECRET_KEY;

function getHeaders(useSecretKey = false) {
  return {
    "Content-Type": "application/json",
    "api-key": API_KEY,
    ...(useSecretKey ? { "secret-key": SEC_KEY } : { "public-key": PUB_KEY }),
  };
}

/**
 * Generic POST helper.
 * @param {string} endpoint - e.g. "/pay"
 * @param {object} payload
 * @param {boolean} useSecretKey - true for /pay, false for /requery /merchant-verify
 */
async function makeVTpassRequest(endpoint, payload, useSecretKey = false) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: getHeaders(useSecretKey),
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`VTpass ${endpoint} error: ${response.status} — ${text}`);
  }
  return JSON.parse(text);
}

/**
 * GET service variations (data plans, cable TV packages, etc.)
 * @param {string} serviceID - e.g. "mtn-data", "dstv"
 */
async function getServiceVariations(serviceID) {
  const url = `${BASE_URL}/service-variations?serviceID=${serviceID}`;
  const response = await fetch(url, {
    method: "GET",
    headers: getHeaders(false), // public-key
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`VTpass variations error: ${response.status} — ${text}`);
  }
  return JSON.parse(text);
}

/**
 * Verify a meter number (electricity) or smart card (cable TV).
 * @param {string} serviceID
 * @param {string} billersCode  - meter number or smartcard number
 * @param {string} type         - "prepaid" | "postpaid" | variation_code
 */
async function verifyMerchant(serviceID, billersCode, type) {
  return makeVTpassRequest(
    "/merchant-verify",
    { serviceID, billersCode, type },
    false, // public-key
  );
}

/**
 * Requery a pending VTpass transaction.
 * @param {string} request_id
 */
async function requeryTransaction(request_id) {
  return makeVTpassRequest("/requery", { request_id }, false); // public-key
}

/**
 * Execute a purchase via VTpass.
 * @param {object} payload - { request_id, serviceID, amount, phone, ... }
 * @param {string} callbackUrl
 */
async function pay(payload, callbackUrl) {
  return makeVTpassRequest(
    "/pay",
    { ...payload, callback_url: callbackUrl },
    true, // secret-key
  );
}

// ── Supported service IDs ────────────────────────────────────────────────────

const NETWORKS = {
  mtn: "mtn",
  glo: "glo",
  airtel: "airtel",
  etisalat: "etisalat",
};

const DATA_NETWORKS = {
  mtn: "mtn-data",
  airtel: "airtel-data",
  glo: "glo-data",
  "glo-sme": "glo-sme-data",
  etisalat: "etisalat-data",
  "smile-direct": "smile-direct",
  spectranet: "spectranet",
};

const ELECTRICITY_PROVIDERS = {
  "ikeja-electric": "ikeja-electric",
  "eko-electric": "eko-electric",
  "kano-electric": "kano-electric",
  "port-harcourt-electric": "port-harcourt-electric",
  "jos-electric": "jos-electric",
  "ibadan-electric": "ibadan-electric",
  "kaduna-electric": "kaduna-electric",
  "abuja-electric": "abuja-electric",
  "enugu-electric": "enugu-electric",
  "benin-electric": "benin-electric",
  "aba-electric": "aba-electric",
  "yola-electric": "yola-electric",
};

const CABLE_TV_PROVIDERS = {
  dstv: "dstv",
  gotv: "gotv",
  startimes: "startimes",
  showmax: "showmax",
};

module.exports = {
  makeVTpassRequest,
  getServiceVariations,
  verifyMerchant,
  requeryTransaction,
  pay,
  NETWORKS,
  DATA_NETWORKS,
  ELECTRICITY_PROVIDERS,
  CABLE_TV_PROVIDERS,
  BASE_URL,
};

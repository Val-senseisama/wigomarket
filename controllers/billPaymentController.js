/**
 * @file billPaymentController.js
 * @description VTpass bill payment handlers: airtime, data, electricity, cable TV.
 *
 * SAFETY MODEL (every handler):
 *   1. Validate inputs
 *   2. Check wallet balance
 *   3. START MongoDB session
 *      a. Debit wallet
 *      b. Write Transaction ledger (debit side)
 *      c. Create BillPayment record (pending)
 *      d. Call VTpass /pay
 *      e. Update BillPayment status
 *         → failed: refund wallet + write reversal ledger entry
 *         → pending/completed: leave — cron handles cleanup
 *   4. Return result
 *
 * IDEMPOTENCY:
 *   requestId is generated from timestamp + random. BillPayment.requestId has a
 *   unique index — if a second identical request slips through, Mongo rejects it.
 */

const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const BillPayment = require("../models/billPaymentModel");
const vtpass = require("../services/vtpassService");
const { MakeID } = require("../Helpers/Helpers");
const audit = require("../services/auditService");

const CALLBACK_URL = `${process.env.BACKEND_URL || "https://api.wigomarket.com"}/api/bills/webhook/vtpass`;

// ── Shared helpers ─────────────────────────────────────────────────────────

function generateRequestId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    MakeID(16),
  ].join("");
}

/**
 * Debit wallet + write pending ledger + create BillPayment record — all in session.
 * Returns { wallet, billRecord, txRef } for the caller to use.
 */
async function initiatePurchase(
  session,
  { userId, amount, serviceType, serviceProvider, recipient, serviceMetadata },
) {
  // Debit wallet ─────────────────────────────────────────────────────────────
  const wallet = await Wallet.findOne({ user: userId }).session(session);
  if (!wallet)
    throw new Error("Wallet not found. Please create a wallet first.");
  if (wallet.status !== "active")
    throw new Error(`Wallet is ${wallet.status}. Cannot process payment.`);
  if (wallet.balance < amount)
    throw new Error(
      `Insufficient wallet balance. Available: ₦${wallet.balance}, Required: ₦${amount}`,
    );

  await wallet.deductFunds(amount, "bill_payment", session);

  // Transaction ledger — debit side (session-bound) ─────────────────────────
  const txId = `BILL_${Date.now()}_${MakeID(16)}`;
  const txRef = `BillPayment-${txId}`;

  await Transaction.createTransaction(
    {
      transactionId: txId,
      reference: txRef,
      type: "wallet_withdrawal",
      totalAmount: amount,
      entries: [
        {
          account: "wallet_vendor",
          userId: userId,
          debit: amount,
          credit: 0,
          description: `${serviceType} purchase — ${serviceProvider} for ${recipient}`,
        },
        {
          account: "operating_expenses",
          userId: null,
          debit: 0,
          credit: amount,
          description: `VTpass ${serviceType} service payment`,
        },
      ],
      relatedEntity: { type: "payment" },
      status: "pending",
      metadata: {
        paymentMethod: "wallet",
        notes: `Bill payment: ${serviceType} via VTpass`,
      },
    },
    session,
  );

  const requestId = generateRequestId();

  // BillPayment record ───────────────────────────────────────────────────────
  const [billRecord] = await BillPayment.create(
    [
      {
        user: userId,
        requestId,
        transactionRef: txRef,
        serviceType,
        serviceProvider,
        amount,
        recipient,
        serviceMetadata,
        status: "pending",
      },
    ],
    { session },
  );

  return { wallet, billRecord, txRef, txId };
}

/**
 * After VTpass responds, update the bill record + ledger + optionally refund.
 */
async function finalisePurchase(
  session,
  {
    billRecord,
    vtpassResponse,
    txId,
    userId,
    amount,
    wallet,
    extractExtras, // fn(vtpassResponse) → { deliveryToken, units, pin, ... }
  },
) {
  const code = vtpassResponse?.code;
  const deliveredStatus = vtpassResponse?.content?.transactions?.status;

  let finalStatus = "pending";
  if (code === "000" && deliveredStatus === "delivered")
    finalStatus = "completed";
  else if (code === "000") finalStatus = "pending";
  else if (code === "016") finalStatus = "failed";

  const extras = extractExtras ? extractExtras(vtpassResponse) : {};

  // Update BillPayment
  billRecord.status = finalStatus;
  billRecord.vtpassResponse = vtpassResponse;
  if (finalStatus === "completed") billRecord.completedAt = new Date();
  if (finalStatus === "failed") billRecord.failedAt = new Date();
  Object.assign(billRecord, extras);
  await billRecord.save({ session });

  // On failure — atomically refund wallet + write reversal ledger
  if (finalStatus === "failed") {
    // [STABLE] Pass isEarning = false to ensure refunds don't inflate earnings metadata
    await wallet.creditEarning(amount, session, false);

    const reversalTransactionId = `REV_${Date.now()}_${MakeID(16)}`;
    const refundTxRef = `BillRefund-${txId}`;

    await Transaction.createTransaction(
      {
        transactionId: reversalTransactionId,
        reference: refundTxRef,
        type: "system_adjustment",
        totalAmount: amount,
        entries: [
          {
            account: "operating_expenses",
            userId: null,
            debit: amount,
            credit: 0,
            description: `VTpass refund — purchase failed`,
          },
          {
            account: "wallet_vendor",
            userId: userId,
            debit: 0,
            credit: amount,
            description: `Wallet refund after failed bill payment`,
          },
        ],
        relatedEntity: { type: "payment" },
        status: "completed",
        metadata: {
          paymentMethod: "wallet_refund",
          notes: `Automatic refund — VTpass code: ${code}`,
        },
      },
      session,
    );

    billRecord.refundTransactionRef = refundTxRef;
    billRecord.refundedAt = new Date();
    billRecord.status = "refunded";
    await billRecord.save({ session });

    // Log the failure to audit
    audit.error({
      action: "bill.payment_failed",
      actor: { userId: userId, role: "vendor" }, // Defaulting to vendor role for bill payments
      resource: { type: "bill_payment", id: billRecord.requestId },
      metadata: { code, description: vtpassResponse?.response_description },
    });
  } else {
    // Mark ledger as completed (or leave as pending for cron to update)
    await Transaction.updateOne(
      { transactionId: txId },
      {
        $set: { status: finalStatus === "completed" ? "completed" : "pending" },
      },
      { session },
    );
  }

  return finalStatus;
}

// ── Route handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/bills/plans/data?network=mtn
 */
const getDataPlans = asyncHandler(async (req, res) => {
  const { network } = req.query;
  if (!network)
    return res
      .status(400)
      .json({ success: false, message: "network is required" });

  const serviceID = vtpass.DATA_NETWORKS[network.toLowerCase()];
  if (!serviceID) {
    return res.status(400).json({
      success: false,
      message: `Unsupported network. Supported: ${Object.keys(vtpass.DATA_NETWORKS).join(", ")}`,
    });
  }

  const vtRes = await vtpass.getServiceVariations(serviceID);
  const variations = vtRes.content?.variations || vtRes.content || [];

  res.json({
    success: true,
    data: {
      network: network.toLowerCase(),
      service_id: serviceID,
      service_name:
        vtRes.content?.ServiceName || `${network.toUpperCase()} Data`,
      plans: variations.map((p) => ({
        variation_code: p.variation_code,
        name: p.name,
        amount: parseFloat(p.variation_amount),
        is_fixed_price: p.fixedPrice === "Yes",
      })),
    },
  });
});

/**
 * GET /api/bills/plans/:serviceId — generic variations (cable TV, etc.)
 */
const getServiceVariations = asyncHandler(async (req, res) => {
  const { serviceId } = req.params;
  const vtRes = await vtpass.getServiceVariations(serviceId);
  res.json({ success: true, data: vtRes.content });
});

/**
 * GET /api/bills/verify/meter?provider=ikeja-electric&meter_number=...&meter_type=prepaid
 */
const verifyMeter = asyncHandler(async (req, res) => {
  const { provider, meter_number, meter_type = "prepaid" } = req.query;
  const providerKey = (provider || "").replace(/_/g, "-").toLowerCase();

  if (!vtpass.ELECTRICITY_PROVIDERS[providerKey]) {
    return res
      .status(400)
      .json({ success: false, message: "Unsupported electricity provider" });
  }
  if (!meter_number || !/^\d{10,13}$/.test(meter_number)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid meter number (10–13 digits)" });
  }

  const vtRes = await vtpass.verifyMerchant(
    vtpass.ELECTRICITY_PROVIDERS[providerKey],
    meter_number,
    meter_type,
  );

  if (vtRes.code === "000" || vtRes.response_description === "000") {
    return res.json({
      success: true,
      data: {
        customer_name: vtRes.content?.Customer_Name || "N/A",
        customer_address: vtRes.content?.Address || "N/A",
        account_type: vtRes.content?.Account_Type || "N/A",
        minimum_amount: vtRes.content?.Minimum_Amount || null,
        meter_number,
        provider: providerKey,
        meter_type,
      },
    });
  }

  res
    .status(400)
    .json({ success: false, message: "Meter verification failed" });
});

/**
 * GET /api/bills/verify/decoder?provider=dstv&smartcard_number=...
 */
const verifyDecoder = asyncHandler(async (req, res) => {
  const { provider, smartcard_number } = req.query;
  const providerKey = (provider || "").toLowerCase();

  if (!vtpass.CABLE_TV_PROVIDERS[providerKey]) {
    return res
      .status(400)
      .json({ success: false, message: "Unsupported cable TV provider" });
  }
  if (!smartcard_number) {
    return res
      .status(400)
      .json({ success: false, message: "smartcard_number is required" });
  }

  const vtRes = await vtpass.verifyMerchant(
    vtpass.CABLE_TV_PROVIDERS[providerKey],
    smartcard_number,
    providerKey,
  );

  if (vtRes.code === "000" || vtRes.response_description === "000") {
    return res.json({
      success: true,
      data: {
        customer_name: vtRes.content?.Customer_Name || "N/A",
        current_bouquet: vtRes.content?.Current_Bouquet || "N/A",
        renewal_amount: vtRes.content?.Renewal_Amount || null,
        smartcard_number,
        provider: providerKey,
      },
    });
  }

  res
    .status(400)
    .json({ success: false, message: "Decoder verification failed" });
});

// ── Purchase handlers ───────────────────────────────────────────────────────

/**
 * POST /api/bills/airtime
 * Body: { network, phone, amount }
 */
const purchaseAirtime = asyncHandler(async (req, res) => {
  const { network, phone, amount } = req.body;
  const userId = req.user._id;

  // Validate
  if (!network || !vtpass.NETWORKS[network.toLowerCase()]) {
    return res.status(400).json({
      success: false,
      message: `Invalid network. Supported: ${Object.keys(vtpass.NETWORKS).join(", ")}`,
    });
  }
  if (!phone || !/^0[789][01]\d{8}$/.test(phone)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Nigerian phone number" });
  }
  const amt = Number(amount);
  if (!amt || amt < 50) {
    return res
      .status(400)
      .json({ success: false, message: "Minimum airtime amount is ₦50" });
  }

  const serviceID = vtpass.NETWORKS[network.toLowerCase()];
  const session = await mongoose.startSession();

  try {
    let finalStatus, billRecord, requestId;

    // 1. Initial State: Create records and debit wallet (Atomic Transaction)
    await session.withTransaction(async () => {
      const init = await initiatePurchase(session, {
        userId,
        amount: amt,
        serviceType: "airtime",
        serviceProvider: network.toLowerCase(),
        recipient: phone,
        serviceMetadata: { network: network.toLowerCase() },
      });

      billRecord = init.billRecord;
      requestId = init.billRecord.requestId;
      txId = init.txId;
      wallet = init.wallet;
    });

    // 2. External Action: Call VTpass (Outside DB Transaction)
    // This prevents connection starvation if the API is slow.
    let vtpassResponse;
    try {
      vtpassResponse = await vtpass.pay(
        { request_id: requestId, serviceID, amount: amt, phone },
        CALLBACK_URL,
      );
    } catch (apiError) {
      console.error("VTpass API error during airtime purchase:", apiError);
      // Log API error
      audit.error({
        action: "bill.api_error",
        actor: audit.actor(req),
        resource: { type: "bill_payment", id: requestId },
        metadata: { error: apiError.message, service: "airtime" },
      });
      // Treat as pending for cron to resolve later, or handle retry
      vtpassResponse = { code: "999", response_description: "API_TIMEOUT" };
    }

    // 3. Final State: Resolve record and ledger (Atomic Transaction)
    await session.withTransaction(async () => {
      const freshBillRecord = await BillPayment.findOne({ requestId }).session(
        session,
      );
      const freshWallet = await Wallet.findOne({ user: userId }).session(
        session,
      );

      finalStatus = await finalisePurchase(session, {
        billRecord: freshBillRecord,
        vtpassResponse,
        txId,
        userId,
        amount: amt,
        wallet: freshWallet,
      });
    });

    audit.log({
      action: "bill.airtime_purchase",
      actor: audit.actor(req),
      resource: { type: "bill_payment", id: requestId },
      changes: { after: { network, phone, amount: amt, status: finalStatus } },
    });
    res.json({
      success: finalStatus !== "failed",
      message:
        finalStatus === "completed"
          ? "Airtime purchased successfully"
          : finalStatus === "failed"
            ? "Airtime purchase failed. Your wallet has been refunded."
            : "Airtime purchase is processing",
      data: {
        request_id: requestId,
        status: finalStatus,
        network,
        phone,
        amount: amt,
      },
    });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/bills/data
 * Body: { network, phone, variation_code }
 */
const purchaseData = asyncHandler(async (req, res) => {
  const { network, phone, variation_code } = req.body;
  const userId = req.user._id;

  if (!network || !vtpass.DATA_NETWORKS[network.toLowerCase()]) {
    return res.status(400).json({ success: false, message: "Invalid network" });
  }
  if (!phone || !/^0[789][01]\d{8}$/.test(phone)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Nigerian phone number" });
  }
  if (!variation_code) {
    return res
      .status(400)
      .json({ success: false, message: "variation_code is required" });
  }

  const serviceID = vtpass.DATA_NETWORKS[network.toLowerCase()];
  const variationsRes = await vtpass.getServiceVariations(serviceID);
  const variations =
    variationsRes.content?.variations || variationsRes.content || [];
  const bundle = variations.find((v) => v.variation_code === variation_code);

  if (!bundle) {
    return res.status(400).json({
      success: false,
      message: "Invalid variation_code for selected network",
    });
  }

  const amt = parseFloat(bundle.variation_amount);
  const session = await mongoose.startSession();

  try {
    let finalStatus, requestId;

    // 1. Initial State: Create records and debit wallet (Atomic Transaction)
    await session.withTransaction(async () => {
      const init = await initiatePurchase(session, {
        userId,
        amount: amt,
        serviceType: "data",
        serviceProvider: network.toLowerCase(),
        recipient: phone,
        serviceMetadata: {
          network: network.toLowerCase(),
          variation_code,
          bundle_name: bundle.name,
        },
      });

      requestId = init.billRecord.requestId;
      txId = init.txId;
      wallet = init.wallet;
    });

    // 2. External Action: Call VTpass (Outside DB Transaction)
    let vtpassResponse;
    try {
      vtpassResponse = await vtpass.pay(
        {
          request_id: requestId,
          serviceID,
          billersCode: phone,
          variation_code,
          phone,
        },
        CALLBACK_URL,
      );
    } catch (apiError) {
      console.error("VTpass API error during data purchase:", apiError);
      vtpassResponse = { code: "999", response_description: "API_TIMEOUT" };
    }

    // 3. Final State: Resolve (Atomic Transaction)
    await session.withTransaction(async () => {
      const freshBillRecord = await BillPayment.findOne({ requestId }).session(
        session,
      );
      const freshWallet = await Wallet.findOne({ user: userId }).session(
        session,
      );

      finalStatus = await finalisePurchase(session, {
        billRecord: freshBillRecord,
        vtpassResponse,
        txId,
        userId,
        amount: amt,
        wallet: freshWallet,
      });
    });

    audit.log({
      action: "bill.data_purchase",
      actor: audit.actor(req),
      resource: { type: "bill_payment", id: requestId },
      changes: {
        after: {
          network,
          phone,
          variation_code,
          amount: amt,
          status: finalStatus,
        },
      },
    });
    res.json({
      success: finalStatus !== "failed",
      message:
        finalStatus === "completed"
          ? `${bundle.name} data purchased successfully`
          : finalStatus === "failed"
            ? "Data purchase failed. Your wallet has been refunded."
            : "Data purchase is processing",
      data: {
        request_id: requestId,
        status: finalStatus,
        network,
        phone,
        bundle: bundle.name,
        amount: amt,
      },
    });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/bills/electricity
 * Body: { provider, meter_number, meter_type, amount, phone }
 */
const payElectricity = asyncHandler(async (req, res) => {
  const {
    provider,
    meter_number,
    meter_type = "prepaid",
    amount,
    phone,
  } = req.body;
  const userId = req.user._id;
  const providerKey = (provider || "").replace(/_/g, "-").toLowerCase();

  if (!vtpass.ELECTRICITY_PROVIDERS[providerKey]) {
    return res
      .status(400)
      .json({ success: false, message: "Unsupported electricity provider" });
  }
  if (!meter_number || !/^\d{10,13}$/.test(meter_number)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid meter number (10–13 digits)" });
  }
  if (!["prepaid", "postpaid"].includes(meter_type)) {
    return res.status(400).json({
      success: false,
      message: "meter_type must be 'prepaid' or 'postpaid'",
    });
  }
  const amt = Number(amount);
  if (!amt || amt < 100) {
    return res
      .status(400)
      .json({ success: false, message: "Minimum electricity amount is ₦100" });
  }
  if (!phone || !/^0[789][01]\d{8}$/.test(phone)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Nigerian phone number" });
  }

  // Verify meter first (before touching wallet)
  const verifyRes = await vtpass.verifyMerchant(
    vtpass.ELECTRICITY_PROVIDERS[providerKey],
    meter_number,
    meter_type,
  );
  if (verifyRes.code !== "000" && verifyRes.response_description !== "000") {
    return res
      .status(400)
      .json({ success: false, message: "Meter verification failed" });
  }

  const serviceID = vtpass.ELECTRICITY_PROVIDERS[providerKey];
  const session = await mongoose.startSession();

  try {
    let finalStatus, requestId, deliveryToken, units;

    // 1. Initial State: Create records and debit wallet (Atomic Transaction)
    await session.withTransaction(async () => {
      const init = await initiatePurchase(session, {
        userId,
        amount: amt,
        serviceType: "electricity",
        serviceProvider: providerKey,
        recipient: meter_number,
        serviceMetadata: {
          meter_type,
          phone,
          customer_name: verifyRes.content?.Customer_Name || null,
          customer_address: verifyRes.content?.Address || null,
        },
      });

      requestId = init.billRecord.requestId;
      txId = init.txId;
      wallet = init.wallet;
    });

    // 2. External Action: Call VTpass (Outside DB Transaction)
    let vtpassResponse;
    try {
      vtpassResponse = await vtpass.pay(
        {
          request_id: requestId,
          serviceID,
          billersCode: meter_number,
          variation_code: meter_type,
          amount: amt,
          phone,
        },
        CALLBACK_URL,
      );
    } catch (apiError) {
      console.error("VTpass API error during electricity payment:", apiError);
      vtpassResponse = { code: "999", response_description: "API_TIMEOUT" };
    }

    deliveryToken =
      vtpassResponse.content?.transactions?.token ||
      vtpassResponse.purchased_code ||
      null;
    units = vtpassResponse.content?.transactions?.units || null;

    // 3. Final State: Resolve (Atomic Transaction)
    await session.withTransaction(async () => {
      const freshBillRecord = await BillPayment.findOne({ requestId }).session(
        session,
      );
      const freshWallet = await Wallet.findOne({ user: userId }).session(
        session,
      );

      finalStatus = await finalisePurchase(session, {
        billRecord: freshBillRecord,
        vtpassResponse,
        txId,
        userId,
        amount: amt,
        wallet: freshWallet,
        extractExtras: () => ({ deliveryToken, units }),
      });
    });

    audit.log({
      action: "bill.electricity_payment",
      actor: audit.actor(req),
      resource: { type: "bill_payment", id: requestId },
      changes: {
        after: {
          provider: providerKey,
          meter_number,
          amount: amt,
          status: finalStatus,
        },
      },
    });
    res.json({
      success: finalStatus !== "failed",
      message:
        finalStatus === "completed"
          ? "Electricity payment successful"
          : finalStatus === "failed"
            ? "Electricity payment failed. Your wallet has been refunded."
            : "Electricity payment is processing",
      data: {
        request_id: requestId,
        status: finalStatus,
        provider: providerKey,
        meter_number,
        amount: amt,
        token: deliveryToken,
        units,
      },
    });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/bills/cable-tv
 * Body: { provider, smartcard_number, variation_code, phone }
 */
const payCableTv = asyncHandler(async (req, res) => {
  const { provider, smartcard_number, variation_code, phone } = req.body;
  const userId = req.user._id;
  const providerKey = (provider || "").toLowerCase();

  if (!vtpass.CABLE_TV_PROVIDERS[providerKey]) {
    return res
      .status(400)
      .json({ success: false, message: "Unsupported cable TV provider" });
  }
  if (!smartcard_number) {
    return res
      .status(400)
      .json({ success: false, message: "smartcard_number is required" });
  }
  if (!variation_code) {
    return res.status(400).json({
      success: false,
      message: "variation_code (subscription plan) is required",
    });
  }
  if (!phone || !/^0[789][01]\d{8}$/.test(phone)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Nigerian phone number" });
  }

  // Get plan price from VTpass
  const variationsRes = await vtpass.getServiceVariations(
    vtpass.CABLE_TV_PROVIDERS[providerKey],
  );
  const variations =
    variationsRes.content?.variations || variationsRes.content || [];
  const plan = variations.find((v) => v.variation_code === variation_code);
  if (!plan) {
    return res.status(400).json({
      success: false,
      message: "Invalid variation_code for this provider",
    });
  }

  const amt = parseFloat(plan.variation_amount);
  const session = await mongoose.startSession();

  try {
    let finalStatus, requestId;

    // 1. Initial State: Create records and debit wallet (Atomic Transaction)
    await session.withTransaction(async () => {
      const init = await initiatePurchase(session, {
        userId,
        amount: amt,
        serviceType: "cable_tv",
        serviceProvider: providerKey,
        recipient: smartcard_number,
        serviceMetadata: { variation_code, plan_name: plan.name, phone },
      });

      requestId = init.billRecord.requestId;
      txId = init.txId;
      wallet = init.wallet;
    });

    // 2. External Action: Call VTpass (Outside DB Transaction)
    let vtpassResponse;
    try {
      vtpassResponse = await vtpass.pay(
        {
          request_id: requestId,
          serviceID: vtpass.CABLE_TV_PROVIDERS[providerKey],
          billersCode: smartcard_number,
          variation_code,
          phone,
          subscription_type: "change",
        },
        CALLBACK_URL,
      );
    } catch (apiError) {
      console.error("VTpass API error during cable TV payment:", apiError);
      vtpassResponse = { code: "999", response_description: "API_TIMEOUT" };
    }

    // 3. Final State: Resolve (Atomic Transaction)
    await session.withTransaction(async () => {
      const freshBillRecord = await BillPayment.findOne({ requestId }).session(
        session,
      );
      const freshWallet = await Wallet.findOne({ user: userId }).session(
        session,
      );

      finalStatus = await finalisePurchase(session, {
        billRecord: freshBillRecord,
        vtpassResponse,
        txId,
        userId,
        amount: amt,
        wallet: freshWallet,
      });
    });

    audit.log({
      action: "bill.cable_tv_payment",
      actor: audit.actor(req),
      resource: { type: "bill_payment", id: requestId },
      changes: {
        after: {
          provider: providerKey,
          smartcard_number,
          variation_code,
          amount: amt,
          status: finalStatus,
        },
      },
    });
    res.json({
      success: finalStatus !== "failed",
      message:
        finalStatus === "completed"
          ? `${provider.toUpperCase()} subscription successful`
          : finalStatus === "failed"
            ? "Cable TV payment failed. Your wallet has been refunded."
            : "Cable TV payment is processing",
      data: {
        request_id: requestId,
        status: finalStatus,
        provider: providerKey,
        smartcard_number,
        plan: plan.name,
        amount: amt,
      },
    });
  } finally {
    await session.endSession();
  }
});

// ── History & requery ───────────────────────────────────────────────────────

/**
 * GET /api/bills/history?serviceType=airtime&page=1&limit=20
 */
const getMyBillPayments = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { serviceType, page = 1, limit = 20 } = req.query;

  const filter = { user: userId };
  if (serviceType) filter.serviceType = serviceType;

  const [total, payments] = await Promise.all([
    BillPayment.countDocuments(filter),
    BillPayment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("-vtpassResponse"), // hide raw VTpass dump from clients
  ]);

  res.json({
    success: true,
    data: {
      payments,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        hasMore: total > page * limit,
      },
    },
  });
});

/**
 * GET /api/bills/requery/:requestId — manual status check for a pending tx
 */
const requeryBillPayment = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user._id;

  const billRecord = await BillPayment.findOne({ requestId, user: userId });
  if (!billRecord)
    return res
      .status(404)
      .json({ success: false, message: "Bill payment not found" });

  if (billRecord.status !== "pending") {
    return res.json({
      success: true,
      data: { status: billRecord.status, request_id: requestId },
    });
  }

  const vtRes = await vtpass.requeryTransaction(requestId);
  const code = vtRes?.code;
  const deliveredStatus = vtRes?.content?.transactions?.status;

  let newStatus = "pending";
  if (code === "000" && deliveredStatus === "delivered")
    newStatus = "completed";
  else if (code === "016") newStatus = "failed";

  if (newStatus !== "pending") {
    billRecord.status = newStatus;
    billRecord.vtpassResponse = vtRes;
    if (newStatus === "completed") {
      billRecord.completedAt = new Date();
      billRecord.deliveryToken = vtRes.content?.transactions?.token || null;
      billRecord.units = vtRes.content?.transactions?.units || null;
    } else {
      billRecord.failedAt = new Date();
      // Atomically refund wallet on failure — session-bound so record + credit are atomic
      const refundSession = await mongoose.startSession();
      try {
        await refundSession.withTransaction(async () => {
          const wallet = await Wallet.findOne({ user: userId }).session(
            refundSession,
          );
          if (wallet) {
            await wallet.creditEarning(billRecord.amount, refundSession);
            billRecord.refundedAt = new Date();
            billRecord.status = "refunded";
            await billRecord.save({ session: refundSession });
          }
        });
      } finally {
        await refundSession.endSession();
      }
      // billRecord already saved inside the transaction; skip the save below
      return res.json({
        success: true,
        data: {
          status: billRecord.status,
          request_id: requestId,
          token: billRecord.deliveryToken || null,
          units: billRecord.units || null,
          vtpass_code: code,
        },
      });
    }
    await billRecord.save();
  }

  res.json({
    success: true,
    data: {
      status: billRecord.status,
      request_id: requestId,
      token: billRecord.deliveryToken || null,
      units: billRecord.units || null,
      vtpass_code: code,
    },
  });
});

module.exports = {
  getDataPlans,
  getServiceVariations,
  verifyMeter,
  verifyDecoder,
  purchaseAirtime,
  purchaseData,
  payElectricity,
  payCableTv,
  getMyBillPayments,
  requeryBillPayment,
};

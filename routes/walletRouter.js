const express = require("express");
const router = express.Router();
const {
  createWallet,
  getWallet,
  addBankAccount,
  setDefaultBankAccount,
  deleteBankAccount,
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletStats,
  getEarningsOverview,
  createWithdrawalPin,
  changeWithdrawalPin,
} = require("../controllers/wallet");
const {
  getTransactionHistory,
  getVATSummary,
  reverseTransaction
} = require("../controllers/transactionController");
// Admin withdrawal endpoints (pending / process / stats) live in routes/adminRouter.js
const receiptService = require("../services/receiptService");
const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Wallet:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Wallet ID
 *         user:
 *           type: string
 *           description: User ID
 *         balance:
 *           type: number
 *           description: Current wallet balance
 *         currency:
 *           type: string
 *           enum: [NGN, USD, EUR]
 *           description: Wallet currency
 *         status:
 *           type: string
 *           enum: [active, suspended, frozen, closed]
 *           description: Wallet status
 *         bankAccounts:
 *           type: array
 *           maxItems: 3
 *           description: Up to 3 saved bank accounts; one is marked as default
 *           items:
 *             type: object
 *             properties:
 *               _id:
 *                 type: string
 *               accountName:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               bankName:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *               isVerified:
 *                 type: boolean
 *         limits:
 *           type: object
 *           properties:
 *             dailyWithdrawal:
 *               type: number
 *             monthlyWithdrawal:
 *               type: number
 *             minimumBalance:
 *               type: number
 *         withdrawalStats:
 *           type: object
 *           properties:
 *             dailyWithdrawn:
 *               type: object
 *               properties:
 *                 amount:
 *                   type: number
 *                 date:
 *                   type: string
 *                   format: date
 *             monthlyWithdrawn:
 *               type: object
 *               properties:
 *                 amount:
 *                   type: number
 *                 month:
 *                   type: string
 *         metadata:
 *           type: object
 *           properties:
 *             lastTransactionAt:
 *               type: string
 *               format: date
 *             totalEarnings:
 *               type: number
 *             totalWithdrawals:
 *               type: number
 *             totalCommissions:
 *               type: number
 *             totalVATCollected:
 *               type: number
 *         createdAt:
 *           type: string
 *           format: date
 *         updatedAt:
 *           type: string
 *           format: date
 *     
 *     Transaction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Transaction ID
 *         transactionId:
 *           type: string
 *           description: Unique transaction identifier
 *         reference:
 *           type: string
 *           description: Transaction reference
 *         type:
 *           type: string
 *           enum: [order_payment, order_refund, platform_commission, vendor_commission, dispatch_commission, vat_collection, vat_remittance, wallet_deposit, wallet_withdrawal, wallet_transfer, payment_processing_fee, bank_transfer_fee, system_adjustment, reconciliation]
 *           description: Transaction type
 *         entries:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               account:
 *                 type: string
 *                 enum: [cash_account, bank_account, wallet_vendor, wallet_dispatch, wallet_platform, accounts_receivable, accounts_payable, vat_payable, commission_payable, platform_revenue, commission_revenue, vat_revenue, payment_processing_fees, bank_transfer_fees, operating_expenses]
 *               userId:
 *                 type: string
 *               debit:
 *                 type: number
 *               credit:
 *                 type: number
 *               description:
 *                 type: string
 *         totalAmount:
 *           type: number
 *           description: Total transaction amount
 *         currency:
 *           type: string
 *           enum: [NGN, USD, EUR]
 *         vat:
 *           type: object
 *           properties:
 *             rate:
 *               type: number
 *             amount:
 *               type: number
 *             responsibility:
 *               type: string
 *               enum: [platform, vendor]
 *             collected:
 *               type: boolean
 *             remitted:
 *               type: boolean
 *         commission:
 *           type: object
 *           properties:
 *             platformRate:
 *               type: number
 *             platformAmount:
 *               type: number
 *             vendorAmount:
 *               type: number
 *             dispatchAmount:
 *               type: number
 *         status:
 *           type: string
 *           enum: [pending, completed, failed, cancelled, reversed]
 *         createdAt:
 *           type: string
 *           format: date
 *         updatedAt:
 *           type: string
 *           format: date
 *     
 *     BankAccount:
 *       type: object
 *       required:
 *         - accountName
 *         - accountNumber
 *         - bankName
 *         - phoneNumber
 *       properties:
 *         accountName:
 *           type: string
 *           description: Account holder name
 *         accountNumber:
 *           type: string
 *           description: Bank account number
 *         bankName:
 *           type: string
 *           description: Bank name
 *         phoneNumber:
 *           type: string
 *           description: Phone number linked to the bank account
 *
 *     WalletCreateRequest:
 *       type: object
 *       required:
 *         - accountName
 *         - accountNumber
 *         - bankName
 *         - phoneNumber
 *       properties:
 *         accountName:
 *           type: string
 *           description: Account holder name
 *         accountNumber:
 *           type: string
 *           description: Bank account number
 *         bankName:
 *           type: string
 *           description: Bank name
 *         phoneNumber:
 *           type: string
 *           description: Phone number linked to the bank account
 *
 *     WithdrawalPin:
 *       type: object
 *       required:
 *         - pin
 *       properties:
 *         pin:
 *           type: string
 *           pattern: '^\d{4,6}$'
 *           description: 4 to 6 digit numeric withdrawal PIN
 *     
 *     WithdrawalRequest:
 *       type: object
 *       required:
 *         - amount
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 1
 *           description: Withdrawal amount
 *     
 *     WalletStats:
 *       type: object
 *       properties:
 *         currentBalance:
 *           type: number
 *         totalEarnings:
 *           type: number
 *         totalWithdrawals:
 *           type: number
 *         totalCommissions:
 *           type: number
 *         totalVATCollected:
 *           type: number
 *         withdrawalLimits:
 *           type: object
 *           properties:
 *             daily:
 *               type: number
 *             monthly:
 *               type: number
 *             dailyUsed:
 *               type: number
 *             monthlyUsed:
 *               type: number
 *         transactionCount:
 *           type: number
 *         lastTransactionAt:
 *           type: string
 *           format: date
 *         canWithdraw:
 *           type: boolean
 *     
 *     VATSummary:
 *       type: object
 *       properties:
 *         period:
 *           type: object
 *           properties:
 *             startDate:
 *               type: string
 *               format: date
 *             endDate:
 *               type: string
 *               format: date
 *         summary:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               _id:
 *                 type: string
 *                 enum: [platform, vendor]
 *               totalVATCollected:
 *                 type: number
 *               totalTransactions:
 *                 type: number
 *               totalAmount:
 *                 type: number
 *         totalVATCollected:
 *           type: number
 *         totalTransactions:
 *           type: number
 */

/**
 * @swagger
 * tags:
 *   - name: Wallet
 *     description: Wallet management operations
 *   - name: Transactions
 *     description: Transaction ledger and audit operations
 */

// Wallet Routes

/**
 * @swagger
 * /api/wallet/create:
 *   post:
 *     tags: [Wallet]
 *     summary: Create a new wallet with an initial bank account (wallet section flow)
 *     description: >
 *       Creates a wallet for the authenticated user and stores the provided bank
 *       account as the default. This endpoint is used when the user manually sets
 *       up a wallet from the wallet section. During registration, wallets are
 *       created automatically without bank details.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WalletCreateRequest'
 *     responses:
 *       201:
 *         description: Wallet created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Wallet'
 *       400:
 *         description: User already has a wallet or missing fields
 *       401:
 *         description: Unauthorized
 */
router.post("/wallet/create", authMiddleware, createWallet);

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     tags: [Wallet]
 *     summary: Get user's wallet information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Wallet'
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 */
router.get("/wallet", authMiddleware, getWallet);

/**
 * @swagger
 * /api/wallet/bank-account:
 *   post:
 *     tags: [Wallet]
 *     summary: Add a bank account to the wallet (max 3)
 *     description: >
 *       Adds a new bank account to the user's wallet. A wallet can hold up to 3
 *       bank accounts. The first account added is automatically set as the default.
 *       Use PUT /api/wallet/bank-account/{accountId}/default to change which account
 *       is the default at any time.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BankAccount'
 *     responses:
 *       200:
 *         description: Bank account added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     bankAccounts:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/BankAccount'
 *       400:
 *         description: Max 3 accounts reached, duplicate account number, or missing fields
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 */
router.post("/wallet/bank-account", authMiddleware, addBankAccount);

/**
 * @swagger
 * /api/wallet/bank-account/{accountId}/default:
 *   put:
 *     tags: [Wallet]
 *     summary: Set a bank account as the default for withdrawals
 *     description: >
 *       Marks the specified bank account as the default. All withdrawals are
 *       processed to the default account. Any previously set default is unset.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: The _id of the bank account subdocument
 *     responses:
 *       200:
 *         description: Default bank account updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     bankAccounts:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/BankAccount'
 *       404:
 *         description: Wallet or bank account not found
 *       401:
 *         description: Unauthorized
 */
router.put("/wallet/bank-account/:accountId/default", authMiddleware, setDefaultBankAccount);

/**
 * @swagger
 * /api/wallet/bank-account/{accountId}:
 *   delete:
 *     tags: [Wallet]
 *     summary: Remove a bank account from the wallet
 *     description: >
 *       Removes a bank account. The default account cannot be deleted while other
 *       accounts exist — set another as default first. The last remaining account
 *       cannot be deleted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: The _id of the bank account subdocument
 *     responses:
 *       200:
 *         description: Bank account removed successfully
 *       400:
 *         description: Cannot remove default account or only remaining account
 *       404:
 *         description: Wallet or bank account not found
 *       401:
 *         description: Unauthorized
 */
router.delete("/wallet/bank-account/:accountId", authMiddleware, deleteBankAccount);

/**
 * @swagger
 * /api/wallet/pin:
 *   post:
 *     tags: [Wallet]
 *     summary: Create a withdrawal PIN
 *     description: >
 *       Sets a 4–6 digit numeric PIN required to authorise withdrawals.
 *       Can only be called once — use PUT /api/wallet/pin to change an existing PIN.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawalPin'
 *     responses:
 *       201:
 *         description: Withdrawal PIN created successfully
 *       400:
 *         description: PIN already exists or invalid format
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [Wallet]
 *     summary: Change withdrawal PIN
 *     description: Changes an existing withdrawal PIN. Requires the current PIN for verification.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPin
 *               - newPin
 *             properties:
 *               currentPin:
 *                 type: string
 *                 description: Current 4–6 digit PIN
 *               newPin:
 *                 type: string
 *                 description: New 4–6 digit PIN
 *     responses:
 *       200:
 *         description: PIN changed successfully
 *       400:
 *         description: No PIN set, invalid format, or new PIN same as current
 *       401:
 *         description: Incorrect current PIN or unauthorized
 *       429:
 *         description: Too many failed attempts — account locked temporarily
 */
router.post("/wallet/pin", authMiddleware, createWithdrawalPin);
router.put("/wallet/pin", authMiddleware, changeWithdrawalPin);

/**
 * @swagger
 * /api/wallet/withdraw:
 *   post:
 *     tags: [Wallet]
 *     summary: Request withdrawal from wallet to default bank account
 *     description: >
 *       Initiates a withdrawal to the default bank account. Requires a valid
 *       withdrawal PIN. A 1% fee (min ₦100) is applied.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - pin
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 1
 *                 description: Withdrawal amount in NGN
 *               pin:
 *                 type: string
 *                 description: 4–6 digit withdrawal PIN
 *     responses:
 *       200:
 *         description: Withdrawal request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     fee:
 *                       type: number
 *                     totalDeduction:
 *                       type: number
 *                     remainingBalance:
 *                       type: number
 *                     estimatedProcessingTime:
 *                       type: string
 *       400:
 *         description: Invalid withdrawal request
 *       401:
 *         description: Unauthorized
 */
router.post("/wallet/withdraw", authMiddleware, requestWithdrawal);

/**
 * @swagger
 * /api/wallet/withdrawals:
 *   get:
 *     tags: [Wallet]
 *     summary: Get user's withdrawal history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     withdrawals:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                         totalTransactions:
 *                           type: integer
 *                         hasMore:
 *                           type: boolean
 *       401:
 *         description: Unauthorized
 */
router.get("/wallet/withdrawals", authMiddleware, getWithdrawalHistory);

/**
 * @swagger
 * /api/wallet/stats:
 *   get:
 *     tags: [Wallet]
 *     summary: Get wallet statistics and analytics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/WalletStats'
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 */
router.get("/wallet/stats", authMiddleware, getWalletStats);

/**
 * @swagger
 * /api/wallet/earnings-overview:
 *   get:
 *     tags: [Wallet]
 *     summary: Get user earnings overview (today, week, total, pending)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Earnings overview retrieved successfully
 */
router.get("/wallet/earnings-overview", authMiddleware, getEarningsOverview);

// Transaction Routes

/**
 * @swagger
 * /api/transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: Get transaction history for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [order_payment, order_refund, platform_commission, vendor_commission, dispatch_commission, vat_collection, vat_remittance, wallet_deposit, wallet_withdrawal, wallet_transfer, payment_processing_fee, bank_transfer_fee, system_adjustment, reconciliation]
 *         description: Filter by transaction type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                         totalTransactions:
 *                           type: integer
 *                         hasMore:
 *                           type: boolean
 *       401:
 *         description: Unauthorized
 */
router.get("/transactions", authMiddleware, getTransactionHistory);

/**
 * @swagger
 * /api/transactions/vat-summary:
 *   get:
 *     tags: [Transactions]
 *     summary: Get VAT summary for admin users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for VAT summary
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for VAT summary
 *     responses:
 *       200:
 *         description: VAT summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/VATSummary'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/transactions/vat-summary", authMiddleware, isAdmin, getVATSummary);

/**
 * @swagger
 * /api/transactions/{transactionId}/reverse:
 *   post:
 *     tags: [Transactions]
 *     summary: Reverse a transaction (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID to reverse
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for reversal
 *     responses:
 *       200:
 *         description: Transaction reversed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Transaction cannot be reversed
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post("/transactions/:transactionId/reverse", authMiddleware, isAdmin, reverseTransaction);

// Admin Withdrawal Management Routes

/**
 * @swagger
 * /api/admin/withdrawals/pending:
 *   get:
 *     tags: [Transactions]
 *     summary: Get all pending withdrawal requests (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Pending withdrawals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     withdrawals:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           transactionId:
 *                             type: string
 *                           reference:
 *                             type: string
 *                           user:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               fullName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               mobile:
 *                                 type: string
 *                           amount:
 *                             type: number
 *                           fee:
 *                             type: number
 *                           totalDeduction:
 *                             type: number
 *                           createdAt:
 *                             type: string
 *                             format: date
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                         totalWithdrawals:
 *                           type: integer
 *                         hasMore:
 *                           type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
// Moved to routes/adminRouter.js → GET /api/admin/withdrawals/pending

/**
 * @swagger
 * /api/admin/withdrawals/{transactionId}/process:
 *   post:
 *     tags: [Transactions]
 *     summary: Process withdrawal request (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID to process
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *                 description: Action to take on the withdrawal
 *               reason:
 *                 type: string
 *                 description: Reason for the action (required for reject)
 *     responses:
 *       200:
 *         description: Withdrawal processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     status:
 *                       type: string
 *                     flwReference:
 *                       type: string
 *                       description: Flutterwave transfer reference (for approved withdrawals)
 *                     refundAmount:
 *                       type: number
 *                       description: Refund amount (for rejected withdrawals)
 *                     reversalTransactionId:
 *                       type: string
 *                       description: Reversal transaction ID (for rejected withdrawals)
 *       400:
 *         description: Invalid action or withdrawal already processed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Withdrawal transaction not found
 */
// Moved to routes/adminRouter.js → POST /api/admin/withdrawals/:transactionId/process

/**
 * @swagger
 * /api/admin/withdrawals/stats:
 *   get:
 *     tags: [Transactions]
 *     summary: Get withdrawal statistics (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for statistics
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for statistics
 *     responses:
 *       200:
 *         description: Withdrawal statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     period:
 *                       type: object
 *                       properties:
 *                         startDate:
 *                           type: string
 *                           format: date
 *                         endDate:
 *                           type: string
 *                           format: date
 *                     statusBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             enum: [pending, completed, cancelled, failed]
 *                           count:
 *                             type: number
 *                           totalAmount:
 *                             type: number
 *                     totals:
 *                       type: object
 *                       properties:
 *                         totalCount:
 *                           type: number
 *                         totalAmount:
 *                           type: number
 *                         totalFees:
 *                           type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
// Moved to routes/adminRouter.js → GET /api/admin/withdrawals/stats

// Wallet Receipt Routes

/**
 * @swagger
 * /api/wallet/withdrawal-receipt/{transactionId}:
 *   get:
 *     summary: Generate withdrawal receipt PDF
 *     description: Generate and download PDF receipt for a completed withdrawal
 *     tags: [Wallet, Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID for which to generate receipt
 *     responses:
 *       200:
 *         description: PDF withdrawal receipt generated and downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *             example: "PDF file content"
 *       400:
 *         description: Withdrawal not completed or invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Receipt can only be generated for completed withdrawals"
 *       403:
 *         description: Access denied - withdrawal doesn't belong to user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Access denied. This withdrawal doesn't belong to you."
 *       404:
 *         description: Withdrawal transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Withdrawal transaction not found"
 *       500:
 *         description: Failed to generate or download receipt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to download withdrawal receipt"
 */
router.get("/wallet/withdrawal-receipt/:transactionId", authMiddleware, async (req, res) => {
  const { transactionId } = req.params;
  const { _id } = req.user;
  
  try {
    // Get withdrawal transaction
    const transaction = await Transaction.findOne({
      transactionId,
      type: 'wallet_withdrawal',
      "entries.userId": _id
    });
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal transaction not found"
      });
    }
    
    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: "Receipt can only be generated for completed withdrawals"
      });
    }
    
    // Get user and wallet data
    const user = await User.findById(_id);
    const wallet = await Wallet.findOne({ user: _id });
    
    if (!user || !wallet) {
      return res.status(404).json({
        success: false,
        message: "User or wallet not found"
      });
    }
    
    // Generate withdrawal receipt data
    const receiptData = {
      receiptNumber: transaction.transactionId,
      date: transaction.createdAt.toLocaleDateString('en-NG'),
      time: transaction.createdAt.toLocaleTimeString('en-NG'),
      
      // User information
      user: {
        name: user.fullName || 'User',
        email: user.email,
        phone: user.mobile || 'N/A'
      },
      
      // Withdrawal details
      withdrawal: {
        amount: transaction.totalAmount,
        fee: transaction.entries.find(e => e.account === 'bank_transfer_fees')?.debit || 0,
        totalDeduction: transaction.totalAmount + (transaction.entries.find(e => e.account === 'bank_transfer_fees')?.debit || 0),
        bankAccount: wallet.defaultBankAccount,
        status: transaction.status,
        processedAt: transaction.audit.approvedAt || transaction.createdAt
      },
      
      // Company information
      company: {
        name: 'WigoMarket',
        address: 'Lagos, Nigeria',
        phone: '+234 XXX XXX XXXX',
        email: 'support@wigomarket.com',
        website: 'www.wigomarket.com'
      }
    };
    
    // Generate PDF receipt
    const pdfPath = await receiptService.generateWithdrawalReceipt(receiptData);
    
    // Send PDF file
    res.download(pdfPath, `withdrawal_receipt_${transactionId}.pdf`, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        res.status(500).json({
          success: false,
          message: "Failed to download withdrawal receipt"
        });
      }
    });
    
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to generate withdrawal receipt"
    });
  }
});

module.exports = router;

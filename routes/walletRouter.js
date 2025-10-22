const express = require("express");
const router = express.Router();
const {
  createWallet,
  getWallet,
  updateBankAccount,
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletStats
} = require("../controllers/walletController");
const {
  getTransactionHistory,
  getVATSummary,
  reverseTransaction
} = require("../controllers/transactionController");
const {
  processWithdrawal,
  getPendingWithdrawals,
  getWithdrawalStats
} = require("../controllers/withdrawalController");
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
 *         bankAccount:
 *           type: object
 *           properties:
 *             accountName:
 *               type: string
 *             accountNumber:
 *               type: string
 *             bankCode:
 *               type: string
 *             bankName:
 *               type: string
 *             isVerified:
 *               type: boolean
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
 *         - bankCode
 *         - bankName
 *       properties:
 *         accountName:
 *           type: string
 *           description: Account holder name
 *         accountNumber:
 *           type: string
 *           description: Bank account number
 *         bankCode:
 *           type: string
 *           description: Bank code
 *         bankName:
 *           type: string
 *           description: Bank name
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
 *     summary: Create a new wallet for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
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
 *         description: User already has a wallet
 *       401:
 *         description: Unauthorized
 */
router.post("/create", authMiddleware, createWallet);

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
router.get("/", authMiddleware, getWallet);

/**
 * @swagger
 * /api/wallet/bank-account:
 *   put:
 *     tags: [Wallet]
 *     summary: Update bank account information for withdrawals
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
 *         description: Bank account updated successfully
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
 *         description: Invalid bank account data
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 */
router.put("/bank-account", authMiddleware, updateBankAccount);

/**
 * @swagger
 * /api/wallet/withdraw:
 *   post:
 *     tags: [Wallet]
 *     summary: Request withdrawal from wallet to bank account
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawalRequest'
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
router.post("/withdraw", authMiddleware, requestWithdrawal);

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
router.get("/withdrawals", authMiddleware, getWithdrawalHistory);

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
router.get("/stats", authMiddleware, getWalletStats);

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
router.get("/admin/withdrawals/pending", authMiddleware, isAdmin, getPendingWithdrawals);

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
router.post("/admin/withdrawals/:transactionId/process", authMiddleware, isAdmin, processWithdrawal);

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
router.get("/admin/withdrawals/stats", authMiddleware, isAdmin, getWithdrawalStats);

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
router.get("/withdrawal-receipt/:transactionId", authMiddleware, async (req, res) => {
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
        bankAccount: wallet.bankAccount,
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

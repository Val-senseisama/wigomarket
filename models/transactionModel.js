const mongoose = require("mongoose");

// Transaction ledger schema for double-entry accounting
const transactionSchema = new mongoose.Schema({
  // Transaction identification
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  reference: {
    type: String,
    required: true,
    index: true
  },
  
  // Transaction details
  type: {
    type: String,
    enum: [
      // Order related
      "order_payment",
      "order_refund",
      "order_cancellation",
      
      // Commission related
      "platform_commission",
      "vendor_commission",
      "dispatch_commission",
      
      // VAT related
      "vat_collection",
      "vat_remittance",
      
      // Wallet operations
      "wallet_deposit",
      "wallet_withdrawal",
      "wallet_transfer",
      
      // Payment processing
      "payment_processing_fee",
      "bank_transfer_fee",
      
      // System operations
      "system_adjustment",
      "reconciliation"
    ],
    required: true,
    index: true
  },
  
  // Double-entry accounting
  entries: [{
    account: {
      type: String,
      enum: [
        // Asset accounts
        "cash_account",
        "bank_account",
        "wallet_vendor",
        "wallet_dispatch",
        "wallet_platform",
        "accounts_receivable",
        
        // Liability accounts
        "accounts_payable",
        "vat_payable",
        "commission_payable",
        
        // Revenue accounts
        "platform_revenue",
        "commission_revenue",
        "vat_revenue",
        
        // Expense accounts
        "payment_processing_fees",
        "bank_transfer_fees",
        "operating_expenses"
      ],
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },
    debit: {
      type: Number,
      default: 0,
      min: 0
    },
    credit: {
      type: Number,
      default: 0,
      min: 0
    },
    description: String
  }],
  
  // Transaction amounts
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: "NGN",
    enum: ["NGN", "USD", "EUR"]
  },
  
  // VAT information
  vat: {
    rate: {
      type: Number,
      default: 7.5 // Nigerian VAT rate
    },
    amount: {
      type: Number,
      default: 0
    },
    responsibility: {
      type: String,
      enum: ["platform", "vendor"],
      default: "platform"
    },
    collected: {
      type: Boolean,
      default: false
    },
    remitted: {
      type: Boolean,
      default: false
    },
    remittanceDate: Date
  },
  
  // Commission information
  commission: {
    platformRate: {
      type: Number,
      default: 0
    },
    platformAmount: {
      type: Number,
      default: 0
    },
    vendorAmount: {
      type: Number,
      default: 0
    },
    dispatchAmount: {
      type: Number,
      default: 0
    }
  },
  
  // Related entities
  relatedEntity: {
    type: {
      type: String,
      enum: ["order", "withdrawal", "payment", "adjustment"]
    },
    id: {
      type: mongoose.Schema.Types.ObjectId
    }
  },
  
  // Transaction status
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "cancelled", "reversed"],
    default: "pending",
    index: true
  },
  
  // Audit information
  audit: {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    approvedAt: Date,
    reversalReason: String,
    reversedAt: Date,
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  
  // Additional metadata
  metadata: {
    paymentMethod: String,
    bankReference: String,
    externalTransactionId: String,
    notes: String,
    tags: [String]
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ reference: 1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ "entries.userId": 1 });
transactionSchema.index({ "entries.account": 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ "relatedEntity.type": 1, "relatedEntity.id": 1 });
transactionSchema.index({ "vat.remitted": 1, "vat.remittanceDate": 1 });

// Pre-save middleware to validate double-entry
transactionSchema.pre('save', function(next) {
  // Validate that total debits equal total credits
  const totalDebits = this.entries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredits = this.entries.reduce((sum, entry) => sum + entry.credit, 0);
  
  if (Math.abs(totalDebits - totalCredits) > 0.01) { // Allow for small rounding differences
    return next(new Error('Transaction is not balanced: debits must equal credits'));
  }
  
  // Validate that total amount matches transaction total
  if (Math.abs(totalDebits - this.totalAmount) > 0.01) {
    return next(new Error('Transaction total does not match entry totals'));
  }
  
  next();
});

// Virtual for transaction balance validation
transactionSchema.virtual('isBalanced').get(function() {
  const totalDebits = this.entries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredits = this.entries.reduce((sum, entry) => sum + entry.credit, 0);
  return Math.abs(totalDebits - totalCredits) < 0.01;
});

// Method to add entry to transaction
transactionSchema.methods.addEntry = function(account, userId, debit = 0, credit = 0, description = '') {
  this.entries.push({
    account,
    userId,
    debit,
    credit,
    description
  });
  return this;
};

// Method to reverse transaction
transactionSchema.methods.reverse = function(reason, reversedBy) {
  if (this.status !== 'completed') {
    throw new Error('Only completed transactions can be reversed');
  }
  
  this.status = 'reversed';
  this.audit.reversalReason = reason;
  this.audit.reversedAt = new Date();
  this.audit.reversedBy = reversedBy;
  
  // Reverse all entries
  this.entries.forEach(entry => {
    const tempDebit = entry.debit;
    entry.debit = entry.credit;
    entry.credit = tempDebit;
  });
  
  return this.save();
};

// Static method to create transaction
transactionSchema.statics.createTransaction = function(transactionData) {
  const transaction = new this(transactionData);
  
  // Generate unique transaction ID
  if (!transaction.transactionId) {
    transaction.transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  return transaction.save();
};

// Static method to get transactions by user
transactionSchema.statics.getTransactionsByUser = function(userId, limit = 50) {
  return this.find({
    "entries.userId": userId
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .populate('audit.createdBy', 'fullName email')
  .populate('audit.approvedBy', 'fullName email');
};

// Static method to get VAT summary
transactionSchema.statics.getVATSummary = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        "vat.collected": true
      }
    },
    {
      $group: {
        _id: "$vat.responsibility",
        totalVATCollected: { $sum: "$vat.amount" },
        totalTransactions: { $sum: 1 },
        totalAmount: { $sum: "$totalAmount" }
      }
    }
  ]);
};

module.exports = mongoose.model("Transaction", transactionSchema);

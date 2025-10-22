const mongoose = require("mongoose");

// Wallet schema for users (sellers, dispatch riders)
const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: "NGN",
    enum: ["NGN", "USD", "EUR"]
  },
  status: {
    type: String,
    enum: ["active", "suspended", "frozen", "closed"],
    default: "active"
  },
  // Wallet limits and settings
  limits: {
    dailyWithdrawal: {
      type: Number,
      default: 1000000 // 1M NGN default daily limit
    },
    monthlyWithdrawal: {
      type: Number,
      default: 10000000 // 10M NGN default monthly limit
    },
    minimumBalance: {
      type: Number,
      default: 0
    }
  },
  // Withdrawal tracking
  withdrawalStats: {
    dailyWithdrawn: {
      amount: {
        type: Number,
        default: 0
      },
      date: {
        type: Date,
        default: Date.now
      }
    },
    monthlyWithdrawn: {
      amount: {
        type: Number,
        default: 0
      },
      month: {
        type: String,
        default: () => new Date().toISOString().slice(0, 7) // YYYY-MM format
      }
    }
  },
  // Bank account for withdrawals
  bankAccount: {
    accountName: String,
    accountNumber: String,
    bankCode: String,
    bankName: String,
    isVerified: {
      type: Boolean,
      default: false
    },
    verifiedAt: Date
  },
  // Wallet metadata
  metadata: {
    lastTransactionAt: Date,
    totalEarnings: {
      type: Number,
      default: 0
    },
    totalWithdrawals: {
      type: Number,
      default: 0
    },
    totalCommissions: {
      type: Number,
      default: 0
    },
    totalVATCollected: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
walletSchema.index({ user: 1, status: 1 });
walletSchema.index({ balance: -1 });
walletSchema.index({ "withdrawalStats.dailyWithdrawn.date": 1 });
walletSchema.index({ "withdrawalStats.monthlyWithdrawn.month": 1 });

// Virtual for checking if withdrawal is allowed
walletSchema.virtual('canWithdraw').get(function() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);
  
  // Check if wallet is active
  if (this.status !== 'active') return false;
  
  // Check daily limit
  const dailyReset = this.withdrawalStats.dailyWithdrawn.date.toISOString().slice(0, 10);
  if (dailyReset !== today) {
    this.withdrawalStats.dailyWithdrawn = { amount: 0, date: now };
  }
  
  // Check monthly limit
  const monthlyReset = this.withdrawalStats.monthlyWithdrawn.month;
  if (monthlyReset !== currentMonth) {
    this.withdrawalStats.monthlyWithdrawn = { amount: 0, month: currentMonth };
  }
  
  return (
    this.withdrawalStats.dailyWithdrawn.amount < this.limits.dailyWithdrawal &&
    this.withdrawalStats.monthlyWithdrawn.amount < this.limits.monthlyWithdrawal
  );
});

// Method to update withdrawal stats
walletSchema.methods.updateWithdrawalStats = function(amount) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);
  
  // Reset daily if new day
  if (this.withdrawalStats.dailyWithdrawn.date.toISOString().slice(0, 10) !== today) {
    this.withdrawalStats.dailyWithdrawn = { amount: 0, date: now };
  }
  
  // Reset monthly if new month
  if (this.withdrawalStats.monthlyWithdrawn.month !== currentMonth) {
    this.withdrawalStats.monthlyWithdrawn = { amount: 0, month: currentMonth };
  }
  
  // Update amounts
  this.withdrawalStats.dailyWithdrawn.amount += amount;
  this.withdrawalStats.monthlyWithdrawn.amount += amount;
  this.metadata.totalWithdrawals += amount;
  
  return this.save();
};

// Method to add funds to wallet
walletSchema.methods.addFunds = function(amount, transactionType = 'earning') {
  this.balance += amount;
  this.metadata.lastTransactionAt = new Date();
  
  if (transactionType === 'earning') {
    this.metadata.totalEarnings += amount;
  }
  
  return this.save();
};

// Method to deduct funds from wallet
walletSchema.methods.deductFunds = function(amount, transactionType = 'withdrawal') {
  if (this.balance < amount) {
    throw new Error('Insufficient wallet balance');
  }
  
  this.balance -= amount;
  this.metadata.lastTransactionAt = new Date();
  
  if (transactionType === 'withdrawal') {
    return this.updateWithdrawalStats(amount);
  }
  
  return this.save();
};

// Static method to get wallet by user
walletSchema.statics.getWalletByUser = function(userId) {
  return this.findOne({ user: userId }).populate('user', 'fullName email role');
};

// Static method to create wallet for user
walletSchema.statics.createWallet = function(userId, initialBalance = 0) {
  return this.create({
    user: userId,
    balance: initialBalance
  });
};

module.exports = mongoose.model("Wallet", walletSchema);

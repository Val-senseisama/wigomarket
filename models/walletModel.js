const mongoose = require("mongoose");

// Wallet schema for users (sellers, dispatch riders)
const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "NGN",
      enum: ["NGN", "USD", "EUR"],
    },
    status: {
      type: String,
      enum: ["active", "suspended", "frozen", "closed"],
      default: "active",
    },
    // Wallet limits and settings
    limits: {
      dailyWithdrawal: {
        type: Number,
        default: 1000000, // 1M NGN default daily limit
      },
      monthlyWithdrawal: {
        type: Number,
        default: 10000000, // 10M NGN default monthly limit
      },
      minimumBalance: {
        type: Number,
        default: 0,
      },
    },
    // Withdrawal tracking
    withdrawalStats: {
      dailyWithdrawn: {
        amount: {
          type: Number,
          default: 0,
        },
        date: {
          type: Date,
          default: Date.now,
        },
      },
      monthlyWithdrawn: {
        amount: {
          type: Number,
          default: 0,
        },
        month: {
          type: String,
          default: () => new Date().toISOString().slice(0, 7), // YYYY-MM format
        },
      },
    },
    // Bank account for withdrawals
    bankAccount: {
      accountName: String,
      accountNumber: String,
      bankCode: String,
      bankName: String,
      isVerified: {
        type: Boolean,
        default: false,
      },
      verifiedAt: Date,
    },
    // Wallet metadata
    metadata: {
      lastTransactionAt: Date,
      totalEarnings: {
        type: Number,
        default: 0,
      },
      totalWithdrawals: {
        type: Number,
        default: 0,
      },
      totalCommissions: {
        type: Number,
        default: 0,
      },
      totalVATCollected: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
walletSchema.index({ user: 1, status: 1 });
walletSchema.index({ balance: -1 });
walletSchema.index({ "withdrawalStats.dailyWithdrawn.date": 1 });
walletSchema.index({ "withdrawalStats.monthlyWithdrawn.month": 1 });

// ── Schema-level validation ──────────────────────────────────────────────────

/**
 * Prevents any save() that would push balance below minimumBalance.
 * This is a last line of defence — deductFunds() also checks, but this
 * catches any direct field manipulation that bypasses the method.
 */
walletSchema.pre("save", function (next) {
  if (this.balance < this.limits.minimumBalance) {
    return next(
      new Error(
        `Wallet balance (${this.balance}) cannot fall below minimum (${this.limits.minimumBalance})`,
      ),
    );
  }
  if (this.balance < 0) {
    return next(new Error("Wallet balance cannot be negative"));
  }
  next();
});

/**
 * Validates that the wallet status allows operations.
 */
walletSchema.pre("save", function (next) {
  if (this.isModified("balance") && this.status !== "active") {
    return next(new Error(`Cannot modify balance on a ${this.status} wallet`));
  }
  next();
});

// Virtual for checking if withdrawal is allowed
// [STABLE] Pure getter, no side effects. Limits are enforced atomically in deductFunds.
walletSchema.virtual("canWithdraw").get(function () {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);

  if (this.status !== "active") return false;

  const dailyReset = this.withdrawalStats.dailyWithdrawn.date
    ? this.withdrawalStats.dailyWithdrawn.date.toISOString().slice(0, 10)
    : null;
  const currentDailyAmount =
    dailyReset === today ? this.withdrawalStats.dailyWithdrawn.amount : 0;

  const monthlyReset = this.withdrawalStats.monthlyWithdrawn.month;
  const currentMonthlyAmount =
    monthlyReset === currentMonth
      ? this.withdrawalStats.monthlyWithdrawn.amount
      : 0;

  return (
    currentDailyAmount < this.limits.dailyWithdrawal &&
    currentMonthlyAmount < this.limits.monthlyWithdrawal
  );
});

/**
 * Atomically credit funds to the wallet using $inc.
 * Safe for concurrent requests and inside mongoose sessions.
 * @param {number} amount
 * @param {mongoose.ClientSession} [session]
 * @param {boolean} [isEarning=true] - If false, does NOT increment totalEarnings (e.g. for refunds/deposits)
 * @returns {number} new balance
 */
walletSchema.methods.creditEarning = async function (
  amount,
  session,
  isEarning = true,
) {
  if (amount <= 0) throw new Error("Credit amount must be positive");
  if (!session) {
    console.warn(
      "⚠️ creditEarning called without a session. This may break atomicity.",
    );
  }
  const opts = session ? { session } : {};

  const increments = { balance: amount };
  if (isEarning) {
    increments["metadata.totalEarnings"] = amount;
  }

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id, status: "active" },
    {
      $inc: increments,
      $set: { "metadata.lastTransactionAt": new Date() },
    },
    { new: true, ...opts },
  );
  if (!updated) throw new Error("Wallet not found or is not active");

  // Audit the credit action
  require("../services/auditService").log({
    action: "wallet.credit",
    resource: { type: "wallet", id: this._id },
    metadata: { amount, isEarning, balance: updated.balance },
  });

  this.balance = updated.balance;
  return updated.balance;
};

// Legacy alias — delegates to the atomic creditEarning
walletSchema.methods.addFunds = function (
  amount,
  transactionType = "earning",
  session = null,
) {
  // Only increment earnings metadata if the type is explicitly 'earning'
  const isEarning = transactionType === "earning";
  return this.creditEarning(amount, session, isEarning);
};

/**
 * Atomically deduct funds from the wallet with a balance guard.
 * For withdrawals, daily/monthly stats are reset and incremented atomically
 * via an aggregation pipeline update.
 * @param {number} amount
 * @param {"withdrawal"|"refund"|string} [transactionType]
 * @param {mongoose.ClientSession} [session]
 */
walletSchema.methods.deductFunds = async function (
  amount,
  transactionType = "withdrawal",
  session,
) {
  if (amount <= 0) throw new Error("Deduction amount must be positive");
  const minBalance = this.limits?.minimumBalance ?? 0;
  const opts = session ? { session } : {};
  const now = new Date();

  let update;
  if (transactionType === "withdrawal") {
    const today = now.toISOString().slice(0, 10);
    const currentMonth = now.toISOString().slice(0, 7);
    // Aggregation pipeline handles conditional daily/monthly resets atomically
    update = [
      {
        $set: {
          balance: { $subtract: ["$balance", amount] },
          "metadata.lastTransactionAt": now,
          "metadata.totalWithdrawals": {
            $add: ["$metadata.totalWithdrawals", amount],
          },
          "withdrawalStats.dailyWithdrawn": {
            $cond: {
              if: {
                $ne: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$withdrawalStats.dailyWithdrawn.date",
                    },
                  },
                  today,
                ],
              },
              then: { amount, date: now },
              else: {
                amount: {
                  $add: ["$withdrawalStats.dailyWithdrawn.amount", amount],
                },
                date: "$withdrawalStats.dailyWithdrawn.date",
              },
            },
          },
          "withdrawalStats.monthlyWithdrawn": {
            $cond: {
              if: {
                $ne: ["$withdrawalStats.monthlyWithdrawn.month", currentMonth],
              },
              then: { amount, month: currentMonth },
              else: {
                amount: {
                  $add: ["$withdrawalStats.monthlyWithdrawn.amount", amount],
                },
                month: "$withdrawalStats.monthlyWithdrawn.month",
              },
            },
          },
        },
      },
    ];
  } else {
    update = {
      $inc: { balance: -amount },
      $set: { "metadata.lastTransactionAt": now },
    };
  }

  const withdrawalFilter = {
    $and: [
      {
        $lte: [
          {
            $cond: {
              if: {
                $eq: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$withdrawalStats.dailyWithdrawn.date",
                    },
                  },
                  today,
                ],
              },
              then: {
                $add: ["$withdrawalStats.dailyWithdrawn.amount", amount],
              },
              else: amount,
            },
          },
          "$limits.dailyWithdrawal",
        ],
      },
      {
        $lte: [
          {
            $cond: {
              if: {
                $eq: ["$withdrawalStats.monthlyWithdrawn.month", currentMonth],
              },
              then: {
                $add: ["$withdrawalStats.monthlyWithdrawn.amount", amount],
              },
              else: amount,
            },
          },
          "$limits.monthlyWithdrawal",
        ],
      },
    ],
  };

  const updated = await this.constructor.findOneAndUpdate(
    {
      _id: this._id,
      status: "active",
      $and: [
        { balance: { $gte: amount + minBalance } },
        {
          $expr: {
            $or: [{ $ne: [transactionType, "withdrawal"] }, withdrawalFilter],
          },
        },
      ],
    },
    update,
    { new: true, ...opts },
  );

  if (!updated) {
    const errorMsg =
      "Insufficient balance, withdrawal limit exceeded, or wallet inactive";
    require("../services/auditService").error({
      action: "wallet.deduction_failed",
      resource: { type: "wallet", id: this._id },
      metadata: { amount, type: transactionType, error: errorMsg },
    });
    throw new Error(errorMsg);
  }

  // Audit the deduction
  require("../services/auditService").log({
    action: "wallet.deduct",
    resource: { type: "wallet", id: this._id },
    metadata: { amount, type: transactionType, balance: updated.balance },
  });

  this.balance = updated.balance;
  return updated;
};

// Static method to get wallet by user
walletSchema.statics.getWalletByUser = function (userId) {
  return this.findOne({ user: userId }).populate("user", "fullName email role");
};

// Static method to create wallet for user
walletSchema.statics.createWallet = function (userId, initialBalance = 0) {
  return this.create({
    user: userId,
    balance: initialBalance,
  });
};

module.exports = mongoose.model("Wallet", walletSchema);

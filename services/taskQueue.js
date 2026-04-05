/**
 * @file taskQueue.js
 * @description Centralized background task queue (BullMQ + Redis).
 *              Handles Email, Push Notifications, and Bill Payment API calls.
 */

const { Queue, Worker } = require("bullmq");
const logger = require("./logger");

let taskQueue = null;
let taskWorker = null;
let isAvailable = false;

const QUEUE_NAME = "task-queue";

/** Connection config with TLS support for Render. */
function getConnectionConfig() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  try {
    const parsed = new URL(url);
    const options = {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 6379,
      ...(parsed.username && parsed.username !== "default"
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
    if (parsed.protocol === "rediss:") options.tls = {};
    return options;
  } catch {
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }
}

async function init() {
  if (process.env.TASK_QUEUE_ENABLED === "false") {
    logger.info("[TaskQueue] Disabled via TASK_QUEUE_ENABLED=false");
    return;
  }

  try {
    const connection = getConnectionConfig();
    taskQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    taskWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { name, data } = job;

        switch (name) {
          case "email": {
            const sendEmail = require("../controllers/emailController");
            await sendEmail(data); // data = { to, subject, htm, text }
            break;
          }
          case "push_notification": {
            const {
              sendNotificationToUser,
            } = require("./firebaseNotificationService");
            // Pass skipQueue: true to avoid infinite recursion
            await sendNotificationToUser(
              data.userId,
              data.title,
              data.body,
              data.data,
              data.type,
              true,
            );
            break;
          }
          case "bill_payment_api": {
            // This handles the Step 2 & 3 of bill payment
            const vtpass = require("./vtpassService");
            const BillPayment = require("../models/billPaymentModel");
            const Wallet = require("../models/walletModel");
            const mongoose = require("mongoose");

            // Logic moved from controller to allow background retry
            const {
              requestId,
              serviceID,
              amount,
              phone,
              billersCode,
              variation_code,
              userId,
              txId,
            } = data;

            // 1. Call VTpass
            let vtRes;
            try {
              vtRes = await vtpass.pay(
                {
                  request_id: requestId,
                  serviceID,
                  amount,
                  phone,
                  billersCode,
                  variation_code,
                },
                `${process.env.BACKEND_URL || "https://api.wigomarket.com"}/api/bills/webhook/vtpass`,
              );
            } catch (err) {
              logger.error(
                `[TaskQueue] Bill API failed for req ${requestId}: ${err.message}`,
              );
              throw err; // triggers BullMQ retry
            }

            // 2. Resolve final state (wallet refund if failed)
            // Note: In worker, we can't easily access 'req' but we have all needed IDs
            const session = await mongoose.startSession();
            try {
              await session.withTransaction(async () => {
                const billRecord = await BillPayment.findOne({
                  requestId,
                }).session(session);
                const wallet = await Wallet.findOne({ user: userId }).session(
                  session,
                );

                // Helper logic from controller (finalisePurchase)
                const code = vtRes?.code;
                const deliveredStatus = vtRes?.content?.transactions?.status;
                let finalStatus = "pending";
                if (code === "000" && deliveredStatus === "delivered")
                  finalStatus = "completed";
                else if (code === "000") finalStatus = "pending";
                else if (code === "016") finalStatus = "failed";

                billRecord.status = finalStatus;
                billRecord.vtpassResponse = vtRes;
                if (finalStatus === "completed")
                  billRecord.completedAt = new Date();
                if (finalStatus === "failed") billRecord.failedAt = new Date();

                // Extract extras (token/units)
                if (
                  vtRes.content?.transactions?.token ||
                  vtRes.purchased_code
                ) {
                  billRecord.deliveryToken =
                    vtRes.content?.transactions?.token || vtRes.purchased_code;
                }
                if (vtRes.content?.transactions?.units) {
                  billRecord.units = vtRes.content?.transactions?.units;
                }

                await billRecord.save({ session });

                if (finalStatus === "failed") {
                  await wallet.creditEarning(amount, session, false);
                  billRecord.status = "refunded";
                  billRecord.refundedAt = new Date();
                  await billRecord.save({ session });

                  // Transaction ledger logic would go here too if we want full recovery
                  // For now keeping it simple as the controller already created the pending entries
                }
              });
            } finally {
              await session.endSession();
            }
            break;
          }
          default:
            logger.warn(`[TaskQueue] Unknown job name: ${name}`);
        }
      },
      { connection: getConnectionConfig() },
    );

    taskWorker.on("failed", (job, err) => {
      logger.error(
        `[TaskQueue] Job ${job.id} (${job.name}) failed: ${err.message}`,
      );
    });

    await taskQueue.waitUntilReady();
    isAvailable = true;
    logger.info("[TaskQueue] Ready (BullMQ + Redis)");
  } catch (err) {
    logger.warn(`[TaskQueue] Init failed, using fallback: ${err.message}`);
    isAvailable = false;
  }
}

/** Enqueue a job with automatic fallback to setImmediate. */
async function enqueue(name, data) {
  if (isAvailable && taskQueue) {
    try {
      await taskQueue.add(name, data);
      return true;
    } catch (err) {
      logger.error(`[TaskQueue] Enqueue failed: ${err.message}`);
    }
  }

  // Fallback: run in next tick
  setImmediate(async () => {
    logger.debug(`[TaskQueue] Running ${name} in-process fallback`);
    try {
      // Re-trigger the same logic based on name
      // (Minimal duplication of worker logic here)
      if (name === "email") {
        require("../controllers/emailController")(data);
      } else if (name === "push_notification") {
        require("./firebaseNotificationService").sendNotificationToUser(
          data.userId,
          data.title,
          data.body,
          data.data,
          data.type,
          true,
        );
      }
      // Bill payment is harder to fallback in-process during a crash,
      // but the worker logic can be extracted if needed.
    } catch (err) {
      logger.error(`[TaskQueue] Fallback for ${name} failed: ${err.message}`);
    }
  });
  return false;
}

async function close() {
  if (taskWorker) await taskWorker.close();
  if (taskQueue) await taskQueue.close();
  isAvailable = false;
}

module.exports = { init, enqueue, close, isAvailable: () => isAvailable };

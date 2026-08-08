/**
 * Regression tests for the buffered audit logger.
 *
 * The bug these exist for: flush() used Model.insertMany(), and mongoose 7.2's
 * insertMany reads `error.writeErrors.length` on any driver rejection. A
 * connection error has no such property, so mongoose threw a TypeError from
 * inside its own error handler, before calling the callback that settles the
 * promise it returned. The result was that flush() hung forever, its catch
 * never ran, and the batch — already cleared from the buffer — was lost
 * silently. Audit entries for money movements were the ones at stake.
 */

const mongoose = require("mongoose");
const audit = require("../services/auditService");
const AuditLog = require("../models/auditLogModel");

/** Pretend the connection is down without disturbing the shared test one. */
const setReadyState = (value) => {
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => value,
    configurable: true,
  });
};
const restoreReadyState = () => {
  delete mongoose.connection.readyState;
};

/** Fail loudly on a hang instead of waiting out the whole jest timeout. */
const withinTimeout = async (promise, ms = 3000) => {
  let timer;
  const verdict = await Promise.race([
    promise.then(() => "settled"),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("HUNG"), ms);
    }),
  ]);
  clearTimeout(timer);
  return verdict;
};

const entry = (action = "order.created", overrides = {}) => ({
  action,
  actor: { userId: null, role: "system", ip: "test" },
  resource: { type: "order", id: new mongoose.Types.ObjectId() },
  ...overrides,
});

describe("auditService.flush", () => {
  let errorSpy;

  beforeEach(async () => {
    restoreReadyState();
    // Drain anything a previous test left buffered so counts start clean.
    await audit.flush();
    await AuditLog.deleteMany({});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    restoreReadyState();
  });

  it("writes buffered entries", async () => {
    audit.log(entry("order.created"));
    audit.log(entry("product.updated"));
    await audit.flush();

    const written = await AuditLog.find({}).sort({ action: 1 }).lean();
    expect(written.map((d) => d.action)).toEqual([
      "order.created",
      "product.updated",
    ]);
    expect(written[0].createdAt).toBeInstanceOf(Date);
  });

  it("keeps the retention rule: financial entries never expire", async () => {
    audit.log(entry("wallet.debited"));
    audit.log(entry("order.created"));
    await audit.flush();

    const wallet = await AuditLog.findOne({ action: "wallet.debited" }).lean();
    const order = await AuditLog.findOne({ action: "order.created" }).lean();

    expect(wallet.expiresAt).toBeNull();
    expect(order.expiresAt).toBeInstanceOf(Date);
  });

  it("does not hang when the driver rejects without writeErrors", async () => {
    // Exactly the shape that broke Model.insertMany: a rejection carrying no
    // `writeErrors` array.
    const spy = jest
      .spyOn(AuditLog.collection, "insertMany")
      .mockRejectedValue(new Error("Client must be connected before running operations"));

    audit.log(entry("wallet.credited"));
    const verdict = await withinTimeout(audit.flush());
    spy.mockRestore();

    expect(verdict).toBe("settled");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Audit] insert failed"),
      "Client must be connected before running operations",
    );
  });

  it("holds entries for the next flush while the database is unreachable", async () => {
    setReadyState(0);
    audit.log(entry("wallet.debited"));
    audit.log(entry("wallet.credited"));

    expect(await withinTimeout(audit.flush())).toBe("settled");
    restoreReadyState();
    expect(await AuditLog.countDocuments()).toBe(0);

    // Reconnected — the held entries are written, not lost.
    await audit.flush();
    const actions = (await AuditLog.find({}).lean()).map((d) => d.action).sort();
    expect(actions).toEqual(["wallet.credited", "wallet.debited"]);
  });

  it("drops an entry the schema rejects but still writes the rest", async () => {
    audit.log(entry("order.created"));
    audit.log(entry("order.updated", { resource: { type: "not-a-resource" } }));
    await audit.flush();

    const written = await AuditLog.find({}).lean();
    expect(written).toHaveLength(1);
    expect(written[0].action).toBe("order.created");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropping invalid entry"),
      expect.any(String),
    );
  });

  it("caps the buffer during a long outage instead of growing without bound", async () => {
    setReadyState(0);
    // 1200 entries against a BUFFER_LIMIT of 1000. log() self-flushes every 10,
    // and each of those flushes requeues, so this exercises the real path.
    for (let i = 0; i < 1200; i++) audit.log(entry(`order.created`));
    restoreReadyState();

    await audit.flush();
    expect(await AuditLog.countDocuments()).toBe(1000);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped"),
    );
  });
});

describe("auditService shutdown handling", () => {
  it("registers no signal handlers of its own", () => {
    // It used to take SIGINT/SIGTERM and call process.exit(0) from a handler
    // registered at require time — ahead of app.js's gracefulShutdown, which
    // therefore never got to close the server, queues and database cleanly.
    const before = {
      SIGTERM: process.listeners("SIGTERM").length,
      SIGINT: process.listeners("SIGINT").length,
    };

    jest.resetModules();
    require("../services/auditService");

    expect(process.listeners("SIGTERM").length).toBe(before.SIGTERM);
    expect(process.listeners("SIGINT").length).toBe(before.SIGINT);
  });
});

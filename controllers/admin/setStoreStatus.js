const asyncHandler = require("express-async-handler");
const Store = require("../../models/storeModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

const VALID_STATUSES = ["pending", "active", "suspended"];

/**
 * @function setStoreStatus
 * @description Approve (active), put back to pending, or suspend a store.
 * @access Admin only
 *
 * Body: { status: "active", reason?: "..." }
 */
const setStoreStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  validateMongodbId(id);

  if (!VALID_STATUSES.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const store = await Store.findById(id);
  if (!store) {
    res.status(404);
    throw new Error("Store not found");
  }

  const before = { status: store.status };
  store.status = status;
  await store.save();

  audit.log({
    action: "admin.store.status_changed",
    actor: audit.actor(req),
    resource: { type: "store", id: store._id, displayName: store.name },
    changes: { before, after: { status: store.status } },
    metadata: { reason },
  });

  res.json({
    success: true,
    message: `Store status set to ${status}`,
    data: { _id: store._id, name: store.name, status: store.status },
  });
});

module.exports = setStoreStatus;

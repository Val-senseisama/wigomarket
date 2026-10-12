const User = require("../models/userModel");

// How often open sockets are re-checked against the account.
const REVALIDATE_MS = 30_000;

const CLOSE_REASON = "Session ended, please login again";

/**
 * A WebSocket is authenticated once, at connect. Without a re-check, a socket
 * opened before a password change (or before the account was blocked or
 * deleted) would keep receiving events for as long as it stays open.
 *
 * Each socket carries the `userId` and token `iat` it connected with
 * (ws.session). This closes every socket whose account is gone, unusable, or
 * whose token predates the last password change. One query per run, however
 * many sockets are open.
 *
 * @param {Iterable<WebSocket>} sockets
 * @returns {Promise<number>} how many sockets were closed
 */
async function closeRevokedSockets(sockets) {
  const open = [...sockets].filter((ws) => ws.session && ws.readyState === ws.OPEN);
  if (!open.length) return 0;

  const ids = [...new Set(open.map((ws) => String(ws.session.userId)))];
  const users = await User.find({ _id: { $in: ids } }).select("isBlocked status passwordChangedAt");
  const byId = new Map(users.map((u) => [String(u._id), u]));

  let closed = 0;
  for (const ws of open) {
    const user = byId.get(String(ws.session.userId));
    const revoked =
      !user ||
      user.isBlocked ||
      user.status !== "active" ||
      user.issuedBeforePasswordChange(ws.session.iat);
    if (revoked) {
      ws.close(1008, CLOSE_REASON);
      closed += 1;
    }
  }
  return closed;
}

/**
 * Run closeRevokedSockets on a timer. Errors are logged, never thrown — a
 * failed check must not take the socket server down.
 *
 * @param {() => Iterable<WebSocket>} getSockets
 * @returns {NodeJS.Timeout} pass to clearInterval on close
 */
function startRevalidation(getSockets) {
  const timer = setInterval(() => {
    closeRevokedSockets(getSockets()).catch((err) =>
      console.log("WebSocket session re-check failed:", err.message),
    );
  }, REVALIDATE_MS);
  timer.unref?.();
  return timer;
}

module.exports = { closeRevokedSockets, startRevalidation };

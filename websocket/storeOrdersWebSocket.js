const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Store = require("../models/storeModel");
const { createRedisConnection } = require("../config/redisClient");
const { CHANNEL, onLocalEvent } = require("../services/storeOrderEvents");

const HEARTBEAT_MS = 30_000;

/**
 * Live order feed for sellers: /ws/orders.
 *
 * Connect with the same JWT as the REST API, as `?token=<jwt>` or an
 * `Authorization: Bearer <jwt>` header. The connection is bound to the
 * seller's own store; it then receives every order.created / order.updated
 * event for that store (see services/storeOrderEvents for the payload), and
 * nothing for any other store.
 *
 * Runs in noServer mode: app.js routes HTTP upgrades by path, because a ws
 * server attached with `server` rejects (400) every upgrade whose path it does
 * not own, which would break /ws/location alongside it.
 *
 * Dead connections are dropped by a ping/pong heartbeat.
 */
class StoreOrdersWebSocketServer {
  constructor() {
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Map(); // storeId → Set<ws>
    this.setupWebSocket();
    this.setupSubscriptions();
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /** Called by the server's upgrade router for /ws/orders. */
  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
  }

  setupWebSocket() {
    this.wss.on("connection", async (ws, req) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      try {
        const token = this.extractToken(req);
        if (!token) return ws.close(1008, "Authentication required");

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select("_id role fullName");
        if (!user) return ws.close(1008, "User not found");
        if (!(user.role || []).includes("seller")) return ws.close(1008, "Sellers only");

        const store = await Store.findOne({ owner: user._id }).select("_id").lean();
        if (!store) return ws.close(1008, "No store found for this account");

        const storeId = String(store._id);
        if (!this.clients.has(storeId)) this.clients.set(storeId, new Set());
        this.clients.get(storeId).add(ws);
        ws.storeId = storeId;

        ws.on("close", () => this.remove(ws));
        ws.on("error", () => this.remove(ws));

        ws.send(
          JSON.stringify({
            type: "connection",
            message: "Connected to store order updates",
            storeId,
            timestamp: new Date(),
          }),
        );
      } catch (err) {
        ws.close(1008, "Authentication failed");
      }
    });
  }

  setupSubscriptions() {
    // Cross-instance events via Redis (a subscriber needs its own connection).
    this.redis = createRedisConnection();
    this.redis.subscribe(CHANNEL, (err) => {
      if (err) console.log("Redis subscription error (store orders):", err.message);
    });
    this.redis.on("message", (channel, message) => {
      if (channel !== CHANNEL) return;
      try {
        this.dispatch(JSON.parse(message));
      } catch (err) {
        console.log("Bad store order event:", err.message);
      }
    });

    // Events published while Redis is down are delivered in-process.
    this.unsubscribeLocal = onLocalEvent((event) => this.dispatch(event));
  }

  /** Send an event to every socket of its store. */
  dispatch(event) {
    const sockets = this.clients.get(String(event.storeId));
    if (!sockets) return 0;
    const payload = JSON.stringify(event);
    let sent = 0;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent += 1;
      }
    }
    return sent;
  }

  remove(ws) {
    const sockets = this.clients.get(ws.storeId);
    if (!sockets) return;
    sockets.delete(ws);
    if (!sockets.size) this.clients.delete(ws.storeId);
  }

  checkHeartbeats() {
    for (const ws of this.wss.clients) {
      if (!ws.isAlive) {
        this.remove(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  extractToken(req) {
    const url = new URL(req.url, "http://localhost");
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery;
    const header = req.headers.authorization;
    return header && header.startsWith("Bearer ") ? header.slice(7) : null;
  }

  close() {
    clearInterval(this.heartbeat);
    this.unsubscribeLocal?.();
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.redis?.disconnect();
  }
}

module.exports = StoreOrdersWebSocketServer;

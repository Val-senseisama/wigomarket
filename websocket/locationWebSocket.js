const WebSocket = require('ws');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// Redis client for subscribing to location updates
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

class LocationWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/location'
    });
    
    this.clients = new Map(); // Store connected clients
    this.setupWebSocket();
    this.setupRedisSubscription();
  }

  setupWebSocket() {
    this.wss.on('connection', async (ws, req) => {
      try {
        // Authenticate WebSocket connection
        const token = this.extractTokenFromRequest(req);
        if (!token) {
          ws.close(1008, 'Authentication required');
          return;
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id role fullName');
        
        if (!user) {
          ws.close(1008, 'User not found');
          return;
        }

        // Store client with user info
        this.clients.set(ws, {
          userId: user._id,
          userRole: user.role,
          fullName: user.fullName,
          connectedAt: new Date()
        });

        console.log(`User ${user.fullName} connected to location WebSocket`);

        // Send welcome message
        ws.send(JSON.stringify({
          type: 'connection',
          message: 'Connected to location tracking',
          userId: user._id,
          timestamp: new Date()
        }));

        // Handle incoming messages
        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message);
            this.handleMessage(ws, data);
          } catch (error) {
            console.log('Invalid message format:', error.message);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid message format'
            }));
          }
        });

        // Handle disconnection
        ws.on('close', () => {
          const clientInfo = this.clients.get(ws);
          if (clientInfo) {
            console.log(`User ${clientInfo.fullName} disconnected from location WebSocket`);
            this.clients.delete(ws);
          }
        });

        // Handle errors
        ws.on('error', (error) => {
          console.log('WebSocket error:', error.message);
          this.clients.delete(ws);
        });

      } catch (error) {
        console.log('WebSocket authentication error:', error.message);
        ws.close(1008, 'Authentication failed');
      }
    });
  }

  setupRedisSubscription() {
    // Subscribe to location updates from Redis
    redisClient.subscribe('location_updates', (err) => {
      if (err) {
        console.log('Redis subscription error:', err.message);
      } else {
        console.log('Subscribed to location updates');
      }
    });

    // Handle incoming location updates
    redisClient.on('message', (channel, message) => {
      if (channel === 'location_updates') {
        try {
          const locationData = JSON.parse(message);
          this.broadcastLocationUpdate(locationData);
        } catch (error) {
          console.log('Error parsing location update:', error.message);
        }
      }
    });
  }

  extractTokenFromRequest(req) {
    // Extract token from query parameter or Authorization header
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tokenFromQuery = url.searchParams.get('token');
    
    if (tokenFromQuery) {
      return tokenFromQuery;
    }

    // Try Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  handleMessage(ws, data) {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    switch (data.type) {
      case 'subscribe_order':
        // Subscribe to location updates for a specific order
        this.subscribeToOrder(ws, data.orderId);
        break;
      
      case 'unsubscribe_order':
        // Unsubscribe from location updates for a specific order
        this.unsubscribeFromOrder(ws, data.orderId);
        break;
      
      case 'ping':
        // Respond to ping with pong
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date()
        }));
        break;
      
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown message type'
        }));
    }
  }

  subscribeToOrder(ws, orderId) {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    // Store subscription
    if (!clientInfo.subscriptions) {
      clientInfo.subscriptions = new Set();
    }
    clientInfo.subscriptions.add(orderId);

    ws.send(JSON.stringify({
      type: 'subscribed',
      orderId: orderId,
      message: `Subscribed to location updates for order ${orderId}`
    }));
  }

  unsubscribeFromOrder(ws, orderId) {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo || !clientInfo.subscriptions) return;

    clientInfo.subscriptions.delete(orderId);

    ws.send(JSON.stringify({
      type: 'unsubscribed',
      orderId: orderId,
      message: `Unsubscribed from location updates for order ${orderId}`
    }));
  }

  broadcastLocationUpdate(locationData) {
    const { deliveryAgentId, orderId, location, timestamp } = locationData;

    // Find clients subscribed to this order
    const subscribedClients = Array.from(this.clients.entries())
      .filter(([ws, clientInfo]) => {
        return clientInfo.subscriptions && clientInfo.subscriptions.has(orderId);
      });

    if (subscribedClients.length === 0) return;

    const updateMessage = JSON.stringify({
      type: 'location_update',
      deliveryAgentId,
      orderId,
      location,
      timestamp
    });

    // Send to all subscribed clients
    subscribedClients.forEach(([ws, clientInfo]) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(updateMessage);
      }
    });
  }

  // Send message to specific user
  sendToUser(userId, message) {
    const client = Array.from(this.clients.entries())
      .find(([ws, clientInfo]) => clientInfo.userId.toString() === userId.toString());

    if (client && client[0].readyState === WebSocket.OPEN) {
      client[0].send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Broadcast to all connected clients
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach((clientInfo, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // Get connected clients info
  getConnectedClients() {
    return Array.from(this.clients.entries()).map(([ws, clientInfo]) => ({
      userId: clientInfo.userId,
      userRole: clientInfo.userRole,
      fullName: clientInfo.fullName,
      connectedAt: clientInfo.connectedAt,
      subscriptions: clientInfo.subscriptions ? Array.from(clientInfo.subscriptions) : []
    }));
  }

  // Close WebSocket server
  close() {
    this.wss.close();
    redisClient.disconnect();
  }
}

module.exports = LocationWebSocketServer;

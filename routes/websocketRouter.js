/**
 * @swagger
 * /ws/location:
 *   get:
 *     summary: WebSocket connection for real-time location tracking
 *     description: |
 *       Establishes a WebSocket connection for real-time location tracking of delivery agents.
 *       This connection allows for bidirectional communication between the server and delivery agents.
 *       
 *       ## Authentication
 *       The WebSocket connection requires JWT authentication via query parameter or header.
 *       
 *       ## Connection URL
 *       ```
 *       ws://localhost:3000/ws/location?token=YOUR_JWT_TOKEN
 *       ```
 *       
 *       ## Message Types
 *       
 *       ### Client to Server Messages
 *       
 *       #### 1. Location Update
 *       ```json
 *       {
 *         "type": "location_update",
 *         "data": {
 *           "latitude": 6.5244,
 *           "longitude": 3.3792,
 *           "accuracy": 10,
 *           "speed": 25.5,
 *           "heading": 180,
 *           "orderId": "order_id_here",
 *           "timestamp": "2024-01-15T10:30:00Z"
 *         }
 *       }
 *       ```
 *       
 *       #### 2. Status Update
 *       ```json
 *       {
 *         "type": "status_update",
 *         "data": {
 *           "orderId": "order_id_here",
 *           "status": "en_route",
 *           "notes": "On my way to pickup location"
 *         }
 *       }
 *       ```
 *       
 *       #### 3. Heartbeat
 *       ```json
 *       {
 *         "type": "heartbeat",
 *         "data": {
 *           "timestamp": "2024-01-15T10:30:00Z"
 *         }
 *       }
 *       ```
 *       
 *       ### Server to Client Messages
 *       
 *       #### 1. Location Acknowledgment
 *       ```json
 *       {
 *         "type": "location_ack",
 *         "data": {
 *           "orderId": "order_id_here",
 *           "status": "received",
 *           "timestamp": "2024-01-15T10:30:01Z"
 *         }
 *       }
 *       ```
 *       
 *       #### 2. New Order Assignment
 *       ```json
 *       {
 *         "type": "order_assigned",
 *         "data": {
 *           "orderId": "order_id_here",
 *           "order": {
 *             "id": "order_id_here",
 *             "products": [...],
 *             "deliveryAddress": "123 Main St, Lagos",
 *             "deliveryFee": 500,
 *             "estimatedDeliveryTime": "2024-01-15T12:00:00Z"
 *           }
 *         }
 *       }
 *       ```
 *       
 *       #### 3. Order Status Update
 *       ```json
 *       {
 *         "type": "order_status_update",
 *         "data": {
 *           "orderId": "order_id_here",
 *           "status": "picked_up",
 *           "timestamp": "2024-01-15T10:45:00Z"
 *         }
 *       }
 *       ```
 *       
 *       #### 4. Error Message
 *       ```json
 *       {
 *         "type": "error",
 *         "data": {
 *           "message": "Invalid location data",
 *           "code": "INVALID_LOCATION"
 *         }
 *       }
 *       ```
 *       
 *       #### 5. System Message
 *       ```json
 *       {
 *         "type": "system_message",
 *         "data": {
 *           "message": "Server maintenance in 5 minutes",
 *           "level": "warning"
 *         }
 *       }
 *       ```
 *       
 *       ## Connection States
 *       
 *       - **Connecting**: Initial connection attempt
 *       - **Connected**: Successfully authenticated and ready
 *       - **Disconnected**: Connection lost or closed
 *       - **Error**: Authentication failed or invalid data
 *       
 *       ## Error Codes
 *       
 *       - `AUTH_REQUIRED`: Authentication token missing
 *       - `AUTH_INVALID`: Invalid or expired token
 *       - `USER_NOT_FOUND`: User not found
 *       - `INVALID_LOCATION`: Invalid location data
 *       - `ORDER_NOT_FOUND`: Order not found
 *       - `PERMISSION_DENIED`: Insufficient permissions
 *       
 *       ## Rate Limiting
 *       
 *       - Location updates: Maximum 1 per second per connection
 *       - Status updates: Maximum 10 per minute per connection
 *       - Heartbeat: Maximum 1 per 30 seconds per connection
 *       
 *       ## Connection Management
 *       
 *       - Connections are automatically closed after 30 minutes of inactivity
 *       - Reconnection is supported with exponential backoff
 *       - Maximum 5 concurrent connections per user
 *       
 *     tags:
 *       - WebSocket
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT authentication token
 *     responses:
 *       101:
 *         description: WebSocket connection established successfully
 *       400:
 *         description: Invalid request or missing authentication
 *       401:
 *         description: Authentication failed
 *       403:
 *         description: Access denied - delivery agent only
 *     x-websocket-protocols:
 *       - location-tracking
 *       - delivery-updates
 *     x-websocket-extensions:
 *       - permessage-deflate
 *       - client_max_window_bits
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     WebSocketMessage:
 *       type: object
 *       required:
 *         - type
 *         - data
 *       properties:
 *         type:
 *           type: string
 *           description: Message type
 *           enum: [location_update, status_update, heartbeat, location_ack, order_assigned, order_status_update, error, system_message]
 *         data:
 *           type: object
 *           description: Message payload
 *     
 *     LocationUpdate:
 *       type: object
 *       required:
 *         - latitude
 *         - longitude
 *         - orderId
 *       properties:
 *         latitude:
 *           type: number
 *           format: double
 *           description: Latitude coordinate
 *           example: 6.5244
 *         longitude:
 *           type: number
 *           format: double
 *           description: Longitude coordinate
 *           example: 3.3792
 *         accuracy:
 *           type: number
 *           description: Location accuracy in meters
 *           example: 10
 *         speed:
 *           type: number
 *           description: Current speed in km/h
 *           example: 25.5
 *         heading:
 *           type: number
 *           description: Current heading in degrees
 *           example: 180
 *         orderId:
 *           type: string
 *           description: Order ID being delivered
 *           example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Timestamp of location update
 *           example: "2024-01-15T10:30:00Z"
 *     
 *     StatusUpdate:
 *       type: object
 *       required:
 *         - orderId
 *         - status
 *       properties:
 *         orderId:
 *           type: string
 *           description: Order ID
 *           example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *         status:
 *           type: string
 *           enum: [assigned, en_route, arrived, picked_up, in_transit, delivered, cancelled]
 *           description: Delivery status
 *           example: "en_route"
 *         notes:
 *           type: string
 *           description: Optional status notes
 *           example: "On my way to pickup location"
 *     
 *     WebSocketError:
 *       type: object
 *       required:
 *         - message
 *         - code
 *       properties:
 *         message:
 *           type: string
 *           description: Error message
 *           example: "Invalid location data"
 *         code:
 *           type: string
 *           description: Error code
 *           example: "INVALID_LOCATION"
 *     
 *     OrderAssignment:
 *       type: object
 *       required:
 *         - orderId
 *         - order
 *       properties:
 *         orderId:
 *           type: string
 *           description: Order ID
 *           example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *         order:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             products:
 *               type: array
 *               items:
 *                 type: object
 *             deliveryAddress:
 *               type: string
 *               example: "123 Main St, Lagos"
 *             deliveryFee:
 *               type: number
 *               example: 500
 *             estimatedDeliveryTime:
 *               type: string
 *               format: date-time
 *               example: "2024-01-15T12:00:00Z"
 */

// This file is for Swagger documentation only
// The actual WebSocket implementation is in websocket/locationWebSocket.js
module.exports = {};

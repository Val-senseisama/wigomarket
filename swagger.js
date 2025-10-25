// swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Wigomarket backend api docs',
      version: '1.0.0',
      description: 'API documentation for WigoMarket e-commerce platform with real-time location tracking',
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:5001',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'Error message',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
              example: 'Success message',
            },
          },
        },
      },
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization',
      },
      {
        name: 'Users',
        description: 'User management and profile operations',
      },
      {
        name: 'Products',
        description: 'Product management and suggestions',
      },
      {
        name: 'Store',
        description: 'Store management for sellers',
      },
      {
        name: 'Delivery Agent',
        description: 'Delivery agent operations and management',
      },
      {
        name: 'Payment',
        description: 'Payment processing with Flutterwave',
      },
      {
        name: 'Location Tracking',
        description: 'Real-time location tracking for delivery agents',
      },
      {
        name: 'Notifications',
        description: 'Push notifications and preferences',
      },
      {
        name: 'Rating',
        description: 'Rating and review system',
      },
      {
        name: 'Flutterwave',
        description: 'Flutterwave integration utilities',
      },
      {
        name: 'WebSocket',
        description: 'Real-time WebSocket connections',
      },
      {
        name: 'Receipts',
        description: 'PDF receipt and document generation',
      },
    ],
  },
  apis: [
    './routes/authRouter.js', 
    './routes/productRouter.js', 
    './routes/storeRouter.js',
    './routes/deliveryAgentRouter.js',
    './routes/paymentRouter.js',
    './routes/locationTrackingRouter.js',
    './routes/notificationRouter.js',
    './routes/ratingRouter.js',
    './routes/flutterwaveRouter.js',
    './routes/walletRouter.js',
    './routes/websocketRouter.js'
  ], // Path to your API route files
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};

// swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Wigomarket backend api docs',
      version: '1.0.0',
      description: 'API documentation',
    },
  },
  apis: ['./routes/authRouter.js', './routes/productRouter.js', './routes/storeRouter.js'], // Path to your API route files
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};

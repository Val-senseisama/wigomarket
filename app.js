require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authRouter");
const productRouter = require("./routes/productRouter");
const storeRouter = require("./routes/storeRouter");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { swaggerUi, specs } = require('./swagger');

const app = express();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(morgan("dev"));
app.use(cookieParser());
dbConnect();

app.use("/api/user", authRouter);
app.use("/api/product", productRouter);
app.use("/api/store", storeRouter);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`app is running on ${PORT}`);
});

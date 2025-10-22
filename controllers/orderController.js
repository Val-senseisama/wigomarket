const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");

const checkOutOrder = asyncHandler(async (req, res) => {
    const {id} = req.user;
    const orderId = req.body;

    try {
        const order = await Order.findById(orderId);
       
    } catch (error) {
        throw new Error(error);
    }
})
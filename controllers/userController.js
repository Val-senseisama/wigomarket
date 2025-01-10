const User = require("../models/userModel");
const Token = require("../models/tokensModel");
const asyncHandler = require("express-async-handler");
const { generateToken } = require("../config/jwt");
const validateMongodbId = require("../utils/validateMongodbId");
const { generateRefreshToken } = require("../config/refreshToken");
const jwt = require("jsonwebtoken");
const sendEmail = require("../controllers/emailController");
const crypto = require("crypto");
const Cart = require("../models/cartModel");
const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const uniqid = require("uniqid");
const { welcome } = require("../templates/Emails");
const { Validate } = require("../Helpers/Validate");
const { ThrowError, MakeID } = require("../Helpers/Helpers");
// omo
// Create User
const createUser = asyncHandler(async (req, res) => {
  const email = req.body.email;
  const firstname = req.body.firstname;
  let number = req.body.mobile
  const lastname = req.body.lastname
  const password = req.body.password
  const role = req.body.role

  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  if (!Validate.string(number)) {
    ThrowError("Invalid Mobile Number");
  }

  if (!Validate.string(lastname)) {
    ThrowError("Invalid Lastname");
  }

  if (!Validate.string(password)) {
    ThrowError("Invalid Password");
  }
  const roles = ["seller", "buyer", "dispatch", "admin"]
  if (!Validate.string(role) || !roles.includes(role)) {
    ThrowError("Invalid Role");
  }
  number = Validate.formatPhone(number)
  const findUser = await User.findOne({ email: email });
  const mobileUser = await User.findOne({ mobile: number });
  const welcome = welcome;

  if (!findUser && !mobileUser) {

    const newUser = {
      email,
      firstname,
      lastname,
      mobile: number,
      password,
      role
    }
    const code = MakeID(6);
    const token = {
      email,
      code
    }
    try{
      // Create new user
    const createUser = await User.create(newUser);
    const createCode = await Token.create(token);
    const data1 = {
      to: email,
      text: `Hey + + ${firstname} ${lastname}`,
      subject: "Welcome to WigoMarket - Let's Shop!",
      htm: welcome,
    };
    const data2 = {
      to: email,
      text: ``,
      subject: "Account Verification - WigoMarket",
      htm: verificationCodeTemplate(firstname, code),
    };
   sendEmail(data1);
   sendEmail(data2);
     res.json(newUser);
    }catch(error){
      throw new Error(error);
    };
    
  } else {
    res.json({
      msg: "User already exists",
      success: false,
    });
    throw new Error("User already exists");
  }
});



// Login User

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  //   Check if user exists
  const findUser = await User.findOne({ email });
  console.log("User:", findUser)
  if (findUser && (await findUser.isPasswordMatched(password))) {
    const refreshToken = await generateRefreshToken(findUser?._id);
    const updateUser = await User.findByIdAndUpdate(
      findUser.id,
      { refreshToken: refreshToken },
      { new: true }
    );
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000,
    });
    console.log(updateUser)
    res.json({
      _id: findUser?._id,
      firstname: findUser?.firstname,
      lastname: findUser?.lastname,
      email: findUser?.email,
      mobile: findUser?.mobile,
      token: generateToken(findUser?._id),
    });
  } else {
    throw new Error("Invalid Credentials");
  }
});

// Handle Refresh Token
const handleRefreshToken = asyncHandler(async (req, res) => {
  const cookie = req.cookies;
  if (!cookie?.refreshToken) throw new Error("No refresh token in cookies");
  const refreshToken = cookie.refreshToken;
  const user = await User.findOne({ refreshToken: refreshToken });
  if (!user) throw new Error("No refresh token present in db or not matched");
  jwt.verify(refreshToken, process.env.JWT_SECRET, (err, decoded) => {
    if (err || user.id !== decoded.id) {
      throw new Error("There is something wrong with the refresh token");
    } else {
      const accessToken = generateToken(user?._id);
      res.json({ accessToken });
    }
  });
});

// Logout User
const logoutUser = asyncHandler(async (req, res) => {
  const cookie = req.cookies;
  if (!cookie?.refreshToken) throw new Error("No refresh token in cookies");
  const refreshToken = cookie.refreshToken;
  const user = await User.findOne(refreshToken);
  if (!user) {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
    });
    res.sendStatus(204); // forbidden
  }
  await User.findOneAndUpdate(refreshToken, {
    refreshToken: "",
  });
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
  });
  res.sendStatus(204); // forbidden
});

// Update a User

const updateAUser = asyncHandler(async (req, res) => {
  const { id } = req.user;
  validateMongodbId(id);
  try {
    const updatedUser = await User.findByIdAndUpdate(
      id,
      {
        firstname: req?.body?.firstname,
        lastname: req?.body?.lastname,
        email: req?.body?.email,
        mobile: req?.body?.mobile,
        address: req?.body?.addresss,
        image: req?.body?.image,
        nickname: req?.body?.nickname,
      },
      { new: true }
    );
    res.json(updatedUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Get All Users

const getAllUsers = asyncHandler(async (req, res) => {
  try {
    const getUsers = await User.find();
    res.json(getUsers);
  } catch (error) {
    throw new Error(error);
  }
});

// Get a Single User

const getAUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const getUser = await User.findById(id);
    res.json(getUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Delete a  User

const deleteAUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const deleteUser = await User.findByIdAndDelete(id);
    res.json(deleteUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Block User

const blockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const block = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: true,
      },
      {
        new: true,
      }
    );
    res.json(block);
  } catch (error) {
    throw new Error(error);
  }
});

// Unblock User
const unblockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const unblock = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: false,
      },
      {
        new: true,
      }
    );
    res.json(unblock);
  } catch (error) {
    throw new Error(error);
  }
});

const updatePassword = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { password } = req.body;
  validateMongodbId(_id);
  const user = await User.findById(_id);
  if (password) {
    user.password = password;
    const updatedPassword = await user.save();
    res.json(updatedPassword);
  } else {
    res.json(user);
  }
});

const forgotPasswordToken = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!email) throw new Error("User not found with this email");

  try {
    const token = await user.createPasswordResetToken();
    await user.save();
    const resetURL = `Hi, Please click on this link to reset your password. Be quick though because this link will expire in 10 minutes. <a href="http://localhost:5000/api/user/reset-password/${token}">Click Here</a>`;

    const data = {
      to: email,
      text: "Hey User",
      subject: "Password Reset Link",
      htm: resetURL,
    };
    sendEmail(data);
    res.json(token);
  } catch (error) {
    throw new Error(error);
  }
});

const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const { token } = req.params;
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) throw new Error("Token expired please try again later");
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  res.json(user);
});

const addToCart2 = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { product } = req.body;
  const user = await User.findById(_id);
  const cartExists = await Cart.findOne({ owner: user._id });
  try {
    const user = await User.findById(_id);
    if (cartExists) {
      let object = {};
      object.product = product._id;
      object.count = product.count;
      object.store = product.store._id;
      object.color = product.color;
      object.shopPrice = product.price;
      let getPrice = product.listedPrice;
      object.price = getPrice * object.count;
      let newBalance = object.price + cartExists.cartTotal;
      const cartUpdate1 = await Cart.updateOne(
        { owner: user._id },
        {
          $push: { products: object },
          $set: { cartTotal: newBalance },
        }
      );

      const newCartTotal = await Cart.findOne({ owner: _id }).populate(
        "products.product"
      );

      let cost = newCartTotal.products.map((item) => {
        let f = item.product.listedPrice * item.count;
        return f;
      });

      let totalCost = 0;
      cost.forEach((num) => {
        totalCost += num;
      });
      const cartUpdate = await Cart.updateOne(
        { owner: _id },
        {
          $set: { cartTotal: totalCost },
        }
      );

      res.json(cartUpdate);
    } else {
      let products = [];
      let object = {};
      object.product = product._id;
      object.count = product.count;
      object.store = product.store._id;
      object.shopPrice = product.price;
      object.color = product.color;
      let getPrice = product.listedPrice;
      object.price = getPrice * object.count;
      products.push(object);
      let cartTotal = object.price;
      let newCart = await new Cart({
        products,
        cartTotal,
        owner: user?._id,
      }).save();
      res.json(newCart);
    }
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

const removeFromCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { product } = req.body;
  validateMongodbId(_id);
  const user = await User.findById(_id);
  const cart = await Cart.findOne({ owner: user._id });
  let cartBalance = cart.cartTotal;
  let object = {};
  object.product = product._id;
  object.count = product.count;
  object.color = product.color;
  object.store = product.store;
  let getPrice = product.price;
  object.price = getPrice * object.count;
  let newBalance = cartBalance - object.price;
  const cartUpdate = await Cart.updateOne(
    { owner: user._id },
    {
      $pop: { products: object },
      $set: { cartTotal: newBalance },
    }
  );
  //const newCart =
});

const updateCart = asyncHandler(async (req, res) => {
  const { id } = req.user;
  const { count, newCount, _id, product } = req.body;
  const newPrice = product.listedPrice * newCount;

  const updatedCart = await Cart.findOneAndUpdate(
    { owner: id },
    {
      $set: { "products.$[el].count": newCount },
      $set: { "products.$[el].price": newPrice },
    },
    {
      arrayFilters: [{ "el._id": _id }],
      new: true,
    }
  );
  const newCartTotal = await Cart.findOne({ owner: id }).populate(
    "products.product"
  );

  let cost = newCartTotal.products.map((item) => {
    let f = item.product.listedPrice * item.count;
    return f;
  });
  let totalCost = 0;
  cost.forEach((num) => {
    totalCost += num;
  });
  const cartUpdate = await Cart.findOneAndUpdate(
    { owner: id },
    {
      $set: { cartTotal: totalCost },
    }
  );

  res.json(cartUpdate);
});

const getUserCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);
  try {
    const newCartTotal = await Cart.findOne({ owner: _id }).populate(
      "products.product"
    );

    let cost = newCartTotal.products.map((item) => {
      let f = item.product.listedPrice * item.count;
      return f;
    });
    console.log(cost);
    let totalCost = 0;
    cost.forEach((num) => {
      totalCost += num;
    });
    const cartUpdate = await Cart.updateOne(
      { owner: _id },
      {
        $set: { cartTotal: totalCost },
      }
    );
    const cart = await Cart.findOne({ owner: _id }).populate(
      "products.product",
      "_id title listedPrice store"
    );
    res.json(cart);
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

const emptyCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);
  try {
    const user = await User.findOne({ _id });
    const cart = await Cart.findOneAndRemove({ owner: user._id });
    res.json(cart);
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

const createOrder = asyncHandler(async (req, res) => {
  const { paymentIntent, deliveryMethod, deliveryAddress } = req.body;
  const { _id } = req.user;
  validateMongodbId(_id);
  try {
    if (!paymentIntent) throw new Error("Create order failed");
    const user = await User.findById(_id);
    let userCart = await Cart.findOne({ owner: user._id }).populate(
      "products.product"
    );
    const stores = userCart.products.map((product) => {
      return product.store;
    });
    let finalAmount = 0;
    finalAmount = userCart.cartTotal;
    let newOrder = await new Order({
      products: userCart.products,
      paymentIntent: {
        id: uniqid(),
        method: paymentIntent,
        amount: finalAmount,
        status: "unpaid",
        created: Date.now(),
        currency: "NGN",
      },
      deliveryMethod: deliveryMethod,
      deliveryAddress: deliveryAddress ? deliveryAddress : req.user.address,
      orderedBy: user._id,
      orderStatus: "Not yet processed",
    }).save();
    let update = userCart.products.map((item) => {
      return {
        updateOne: {
          filter: { _id: item.product._id },
          update: { $inc: { quantity: -item.count, sold: +item.count } },
        },
      };
    });
    let orderFor = await User.findById(_id).populate("firstname lastname");
    let historyUpdate = userCart.products.map((item) => {
      return {
        updateOne: {
          filter: { _id: item.product.store },
          update: {
            $push: {
              history: {
                product: item.product._id,
                count: item.count,
                profit: item.count * item.product.listedPrice,
                created: new Date.now(),
                customer: orderFor.firstname + "" + orderFor.lastname,
              },
            },
          },
          options: { safe: true, upsert: true, new: true },
        },
      };
    });
    const updated = await Product.bulkWrite(update, {});
    const updatedStores = await Store.bulkWrite(historyUpdate, {});
    res.json({ message: "success" });
  } catch (error) {
    throw new Error(error);
  }
});

const getOrders = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongoDbId(_id);
  try {
    const userOrders = await Order.find({ orderedBy: _id })
      .populate({
        path: "products.product",
        select: "store",
        model: "Product",
        populate: {
          path: "store",
          select: "bankDetails, address, owner",
          model: "Store",
          populate: {
            path: "owner",
            select: "mobile, email",
            model: "User",
          },
        },
      })
      .exec();
    res.json(userOrders);
  } catch (error) {
    throw new Error(error);
  }
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  validateMongoDbId(id);
  try {
    const updatedOrderStatus = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
        paymentIntent: {
          status: status,
        },
      },
      { new: true }
    );
    res.json(updatedOrderStatus);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = {
  createUser,
  loginUser,
  getAllUsers,
  getAUser,
  deleteAUser,
  updateAUser,
  blockUser,
  unblockUser,
  handleRefreshToken,
  logoutUser,
  forgotPasswordToken,
  updatePassword,
  resetPassword,
  addToCart2,
  getUserCart,
  emptyCart,
  removeFromCart,
  // verifyOtp,
  updateCart,
  createOrder,
  updateOrderStatus,
  getOrders,
};

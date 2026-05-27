const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Validate = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const { forgotPasswordTemplate } = require("../../templates/Emails");
const sendEmail = require("../../controllers/emailController");
const audit = require("../../services/auditService");

/**
 * @function forgotPasswordToken
 * @description Step 1 of 3 — generates a 6-digit numeric OTP, hashes it, stores it
 *              (upsert, 15-min TTL), and emails it to the user.
 *              Does NOT return the OTP in the response.
 * @param {string} req.body.email - Registered email address
 */
const forgotPasswordToken = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!Validate.email(email)) {
    return res.status(400).json({ success: false, message: "Invalid email" });
  }

  const user = await User.findOne({ email }, { fullName: 1, email: 1, _id: 1 });
  if (!user) {
    // Return 200 with a generic message — don't reveal whether the email exists
    return res.status(200).json({
      success: true,
      message: "If an account with that email exists, a reset code has been sent.",
    });
  }

  // Generate a 6-digit numeric OTP using the OS CSPRNG (crypto.randomInt is
  // uniformly distributed and not predictable like Math.random)
  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

  // Upsert the token record (replaces any previous pending reset for this email)
  await Token.findOneAndUpdate(
    { email },
    { code: hashedOtp, verified: false, createdAt: new Date() },
    { new: true, upsert: true },
  );

  sendEmail(
    {
      to: email,
      text: `Your WigoMarket password reset code is: ${otp}. It expires in 15 minutes.`,
      subject: "Password Reset Code - WigoMarket",
      htm: forgotPasswordTemplate(user.fullName || "User", otp),
    },
    true,
  );

  audit.log({
    action: "user.password_reset_requested",
    actor: { email },
    resource: { type: "user", id: user._id },
  });

  // NOTE: never include the OTP in the response — even in development use logs
  res.status(200).json({
    success: true,
    message: "If an account with that email exists, a reset code has been sent.",
    expiresIn: "15 minutes",
  });
});

module.exports = forgotPasswordToken;

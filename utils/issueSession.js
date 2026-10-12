const User = require("../models/userModel");
const { generateToken } = require("../config/jwt");
const { generateRefreshToken } = require("../config/refreshToken");

// Access token lifetime in milliseconds — must stay in sync with jwt.js expiresIn
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Issue a new access + refresh token pair, store the refresh token and set it
 * as the HTTP-only cookie for web clients.
 *
 * Used after a password change: passwordChangedAt retires every token issued
 * before it, including the caller's own, so the caller needs a new pair to
 * stay signed in. Call it only after the password save, so the tokens are not
 * older than passwordChangedAt.
 *
 * @returns {Promise<{token: string, refreshToken: string, tokenExpiresAt: string}>}
 */
const issueSession = async (res, userId) => {
  const token = generateToken(userId);
  const refreshToken = generateRefreshToken(userId);
  const tokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

  await User.updateOne({ _id: userId }, { refreshToken });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    sameSite: "Strict",
    secure: process.env.NODE_ENV === "production",
  });

  return { token, refreshToken, tokenExpiresAt };
};

module.exports = issueSession;

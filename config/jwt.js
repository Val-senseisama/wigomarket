const jwt = require("jsonwebtoken");

/**
 * @param {*} id - user id
 * @param {number} [iat] - issued-at (seconds) to sign with instead of now; used
 *   right after a password change so the token is not older than
 *   passwordChangedAt (see utils/issueSession)
 */
const generateToken = (id, iat) => {
  return jwt.sign({ id, ...(iat && { iat }) }, process.env.JWT_SECRET, { expiresIn: "1d" });
};

module.exports = { generateToken };

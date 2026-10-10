/**
 * @function deleteRiderAccount
 * @description DELETE /api/delivery-agent/account. A rider deleting their account
 * goes through the same flow as every other user (DELETE /api/user/me): password
 * or Google re-confirmation, refused while deliveries, orders, refunds or wallet
 * funds are outstanding, then the account is anonymised — not removed — so the
 * orders the rider delivered still resolve. The rider profile is suspended and
 * the wallet closed. See services/accountDeletionService.
 *
 * It used to hard-delete the user and dispatch profile with no
 * re-authentication, leaving delivered orders pointing at a missing user.
 */
module.exports = require("../user/deleteMyAccount");

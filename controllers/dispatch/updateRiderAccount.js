const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");

/**
 * @function updateRiderAccount
 * @description Self-service edit for a delivery agent's personal account — the
 *              fields behind the rider "Edit profile" screen. Every field is
 *              optional; only the keys present in the body are touched. A profile
 *              photo can be uploaded here, and the password can be changed in the
 *              same request (current password required when doing so).
 *
 *   Vehicle / document / payout details live on the dispatch profile and are
 *   edited via PUT /api/delivery-agent/profile instead.
 *
 *   NOTE: the User model's pre-save hook re-hashes the password on every
 *   `.save()`, so profile-only edits go through `findByIdAndUpdate` (which skips
 *   that hook) and a `.save()` is only used when the password actually changes.
 *
 * @body {string} [fullName]
 * @body {string} [firstname]
 * @body {string} [lastname]
 * @body {string} [mobile]
 * @body {string} [image]            - Cloudinary URL of the profile photo
 * @body {string} [residentialAddress]
 * @body {string} [state]
 * @body {string} [city]
 * @body {Object} [nextOfKin]        - { name, mobile }
 * @body {string} [password]         - New password
 * @body {string} [currentPassword]  - Required when `password` is supplied
 */
const updateRiderAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const {
    fullName,
    firstname,
    lastname,
    mobile,
    image,
    residentialAddress,
    state,
    city,
    nextOfKin,
    password,
    currentPassword,
  } = req.body;

  // ── Validate the fields that were supplied ────────────────────────────────
  if (image !== undefined && !Validate.cloudinaryUrl(image)) {
    return res.status(400).json({
      success: false,
      message:
        "image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: profiles).",
    });
  }

  // Build the set of profile fields to update (excluding password)
  const updates = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (firstname !== undefined) updates.firstname = firstname;
  if (lastname !== undefined) updates.lastname = lastname;
  if (image !== undefined) updates.image = image;
  if (residentialAddress !== undefined) updates.residentialAddress = residentialAddress;
  if (state !== undefined) updates.state = state;
  if (city !== undefined) updates.city = city;
  if (nextOfKin !== undefined) {
    if (nextOfKin?.name !== undefined) updates["nextOfKin.name"] = nextOfKin.name;
    if (nextOfKin?.mobile !== undefined) updates["nextOfKin.mobile"] = nextOfKin.mobile;
  }

  if (mobile !== undefined) {
    if (!Validate.string(mobile)) {
      return res.status(400).json({ success: false, message: "Invalid mobile number" });
    }
    const formatted = Validate.formatPhone(mobile);
    const clash = await User.findOne(
      { mobile: formatted, _id: { $ne: _id } },
      { _id: 1 },
    );
    if (clash) {
      return res.status(400).json({ success: false, message: "Mobile number already in use" });
    }
    updates.mobile = formatted;
  }

  // ── Password change (verify current, then a real .save() to hash it) ──────
  if (password !== undefined) {
    if (!Validate.string(password) || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }
    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        message: "currentPassword is required to change your password",
      });
    }

    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const matches = await user.isPasswordMatched(currentPassword);
    if (!matches) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Apply profile fields onto the doc and set the new (plaintext) password.
    // The pre-save hook hashes `password` exactly once here.
    Object.entries(updates).forEach(([key, value]) => user.set(key, value));
    user.password = password;
    await user.save();

    audit.log({
      action: "user.updated",
      actor: audit.actor(req),
      resource: { type: "user", id: _id, displayName: user.email },
      changes: { after: { passwordChanged: true } },
    });

    return res.json({
      success: true,
      message: "Profile and password updated successfully.",
      data: serialize(user),
    });
  }

  // ── Profile-only edit (skips the password-hashing pre-save hook) ──────────
  const updated = await User.findByIdAndUpdate(_id, updates, { new: true });
  if (!updated) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  audit.log({
    action: "user.updated",
    actor: audit.actor(req),
    resource: { type: "user", id: _id, displayName: updated.email },
    changes: { after: { passwordChanged: false } },
  });

  res.json({
    success: true,
    message: "Profile updated successfully.",
    data: serialize(updated),
  });
});

function serialize(user) {
  return {
    _id: user._id,
    email: user.email,
    mobile: user.mobile,
    fullName: user.fullName,
    firstname: user.firstname,
    lastname: user.lastname,
    image: user.image,
    residentialAddress: user.residentialAddress,
    state: user.state,
    city: user.city,
    nextOfKin: user.nextOfKin,
    role: user.role,
    activeRole: user.activeRole,
  };
}

module.exports = updateRiderAccount;

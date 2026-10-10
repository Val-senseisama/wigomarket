const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const SupportRequest = require("../../models/supportRequestModel");
const sendEmail = require("../emailController");
const Validate = require("../../Helpers/Validate");

const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || "support@wigo1market.com";
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const NAME_MAX = 50;

// No 0/O/1/I so a reference read out over the phone is unambiguous.
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generateReference() {
  const bytes = crypto.randomBytes(8);
  let ref = "";
  for (const b of bytes) ref += REF_ALPHABET[b % REF_ALPHABET.length];
  return `SR-${ref}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate and normalize the form body.
 * @returns {{ data: Object } | { error: string }}
 */
function parseSupportRequest(body = {}) {
  const { firstName, lastName, email, phone, message } = body;

  if (!Validate.string(firstName)) return { error: "First name is required" };
  if (firstName.trim().length > NAME_MAX) {
    return { error: `First name must be at most ${NAME_MAX} characters` };
  }
  if (!Validate.string(lastName)) return { error: "Last name is required" };
  if (lastName.trim().length > NAME_MAX) {
    return { error: `Last name must be at most ${NAME_MAX} characters` };
  }
  if (!Validate.string(email) || !Validate.email(email.trim())) {
    return { error: "A valid email address is required" };
  }
  if (!Validate.string(phone)) return { error: "Phone number is required" };
  // Same 234XXXXXXXXXX storage form as user mobiles; other country codes are
  // accepted as plain international digits.
  const formattedPhone = Validate.formatPhone(phone.trim());
  const validPhone = formattedPhone.startsWith("234")
    ? /^234\d{10}$/.test(formattedPhone)
    : /^\d{8,15}$/.test(formattedPhone);
  if (!validPhone) return { error: "A valid phone number is required" };
  if (!Validate.string(message)) return { error: "Message is required" };
  const trimmedMessage = message.trim();
  if (trimmedMessage.length < MESSAGE_MIN) {
    return { error: `Message must be at least ${MESSAGE_MIN} characters` };
  }
  if (trimmedMessage.length > MESSAGE_MAX) {
    return { error: `Message must be at most ${MESSAGE_MAX} characters` };
  }

  return {
    data: {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: formattedPhone,
      message: trimmedMessage,
    },
  };
}

/**
 * @function createSupportRequest
 * @description "Contact support" form. Open to guests and signed-in users (the
 *              account is linked when a valid token is sent). The request is
 *              stored first, then the support inbox and the sender are emailed
 *              in the background — an email failure never loses a request.
 *
 * @body {string} firstName
 * @body {string} lastName
 * @body {string} email
 * @body {string} phone
 * @body {string} message  - 10–2000 characters
 */
const createSupportRequest = asyncHandler(async (req, res) => {
  const parsed = parseSupportRequest(req.body);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }
  const data = parsed.data;

  const request = await SupportRequest.create({
    ...data,
    reference: generateReference(),
    user: req.user?._id || null,
  });

  const fullName = `${data.firstName} ${data.lastName}`;
  const safe = {
    name: escapeHtml(fullName),
    email: escapeHtml(data.email),
    phone: escapeHtml(data.phone),
    message: escapeHtml(data.message).replace(/\n/g, "<br>"),
  };

  // Fire-and-forget: queued when the task queue is up, sent inline otherwise.
  Promise.allSettled([
    sendEmail(
      {
        to: SUPPORT_INBOX,
        subject: `[Support ${request.reference}] ${fullName}`,
        htm: `
          <h2>New support request ${request.reference}</h2>
          <p><strong>Name:</strong> ${safe.name}</p>
          <p><strong>Email:</strong> ${safe.email}</p>
          <p><strong>Phone:</strong> ${safe.phone}</p>
          <p><strong>Account:</strong> ${request.user ? escapeHtml(String(request.user)) : "Guest"}</p>
          <p><strong>Message:</strong></p>
          <p>${safe.message}</p>
        `,
      },
      true,
    ),
    sendEmail(
      {
        to: data.email,
        subject: `We've received your request (${request.reference})`,
        // Fixed content only — no name or message echoed back. The recipient
        // is whatever address a guest typed, so echoing their text would let
        // anyone send arbitrary content to anyone from our support domain.
        htm: `
          <p>Hello,</p>
          <p>Thanks for contacting WigoMarket support. Your request reference is
          <strong>${request.reference}</strong>. We'll get back to you within 24 hours.</p>
          <p>If you didn't contact us, you can safely ignore this email.</p>
        `,
      },
      true,
    ),
  ]).then((results) => {
    results
      .filter((r) => r.status === "rejected")
      .forEach((r) =>
        console.error(`[Support] email for ${request.reference} failed:`, r.reason),
      );
  });

  res.status(201).json({
    success: true,
    message: "Your support request has been received. We'll respond within 24 hours.",
    data: {
      reference: request.reference,
      status: request.status,
      createdAt: request.createdAt,
    },
  });
});

module.exports = createSupportRequest;
module.exports.parseSupportRequest = parseSupportRequest;

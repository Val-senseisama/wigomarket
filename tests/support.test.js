jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const sendEmail = require("../controllers/emailController");
const SupportRequest = require("../models/supportRequestModel");
const { parseSupportRequest } = require("../controllers/support/createSupportRequest");
const { createTestUser } = require("./helpers");

const validBody = (overrides = {}) => ({
  firstName: "Ada",
  lastName: "Obi",
  email: "Ada@Example.com",
  phone: "+234 801 234 5678",
  message: "I was charged twice for my last order.",
  ...overrides,
});

describe("parseSupportRequest", () => {
  it("normalizes a valid body", () => {
    expect(parseSupportRequest(validBody({ firstName: "  Ada " }))).toEqual({
      data: {
        firstName: "Ada",
        lastName: "Obi",
        email: "ada@example.com",
        phone: "2348012345678",
        message: "I was charged twice for my last order.",
      },
    });
  });

  it("accepts a local Nigerian number", () => {
    expect(parseSupportRequest(validBody({ phone: "08012345678" })).data.phone).toBe(
      "2348012345678",
    );
  });

  it.each([
    [{ firstName: "" }, /First name/],
    [{ lastName: "   " }, /Last name/],
    [{ firstName: "x".repeat(51) }, /at most 50/],
    [{ email: "not-an-email" }, /email/],
    [{ email: undefined }, /email/],
    [{ phone: "+234 801 234" }, /phone/],
    [{ phone: "abc" }, /phone/],
    [{ message: "help" }, /at least 10/],
    [{ message: "x".repeat(2001) }, /at most 2000/],
    [{ message: 42 }, /Message is required/],
  ])("rejects %p", (overrides, pattern) => {
    expect(parseSupportRequest(validBody(overrides)).error).toMatch(pattern);
  });
});

describe("POST /api/support/requests", () => {
  beforeEach(() => sendEmail.mockClear());

  it("stores a guest request and emails support and the sender", async () => {
    const res = await request(app).post("/api/support/requests").send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reference).toMatch(/^SR-[2-9A-HJ-NP-Z]{8}$/);
    expect(res.body.data.status).toBe("open");

    const saved = await SupportRequest.findOne({ reference: res.body.data.reference });
    expect(saved.email).toBe("ada@example.com");
    expect(saved.phone).toBe("2348012345678");
    expect(saved.user).toBeNull();

    const recipients = sendEmail.mock.calls.map(([data]) => data.to);
    expect(recipients).toContain("ada@example.com");
    expect(recipients).toHaveLength(2);
  });

  it("links the request to the signed-in user", async () => {
    const { user, token } = await createTestUser();
    const res = await request(app)
      .post("/api/support/requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody({ email: "linked@example.com" }));

    expect(res.status).toBe(201);
    const saved = await SupportRequest.findOne({ reference: res.body.data.reference });
    expect(String(saved.user)).toBe(String(user._id));
  });

  it("escapes HTML from the form in the support email", async () => {
    await request(app)
      .post("/api/support/requests")
      .send(validBody({ email: "xss@example.com", message: "<script>alert(1)</script> hi there" }));

    const html = sendEmail.mock.calls.map(([data]) => data.htm).join("");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never echoes sender-supplied text in the acknowledgement email", async () => {
    await request(app)
      .post("/api/support/requests")
      .send(validBody({ email: "victim@example.com", firstName: "Visit", message: "Reset your password at evil.example now" }));

    const ack = sendEmail.mock.calls.find(([data]) => data.to === "victim@example.com")[0];
    expect(ack.htm).not.toContain("evil.example");
    expect(ack.htm).not.toContain("Visit");
    expect(ack.subject).not.toContain("Visit");
  });

  it("returns 400 and stores nothing on invalid input", async () => {
    const res = await request(app)
      .post("/api/support/requests")
      .send(validBody({ email: "bad" }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await SupportRequest.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

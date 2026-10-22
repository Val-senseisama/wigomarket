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

describe("GET /api/support/requests", () => {
  beforeEach(() => sendEmail.mockClear());

  const submit = (token, overrides) =>
    request(app)
      .post("/api/support/requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody(overrides));

  it("lists only the caller's requests, newest first, without contact details", async () => {
    const { token } = await createTestUser();
    const { token: otherToken } = await createTestUser();
    const first = await submit(token, { email: "me1@example.com" });
    const second = await submit(token, { email: "me2@example.com" });
    await submit(otherToken, { email: "other@example.com" });

    const res = await request(app).get("/api/support/requests").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const refs = res.body.data.requests.map((r) => r.reference);
    expect(refs).toHaveLength(2);
    expect(refs).toEqual(expect.arrayContaining([first.body.data.reference, second.body.data.reference]));
    expect(res.body.data.pagination.total).toBe(2);
    const [row] = res.body.data.requests;
    expect(row.response).toBeNull();
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("phone");
    expect(row).not.toHaveProperty("_id");
  });

  it("requires sign-in and rejects an unknown status", async () => {
    expect((await request(app).get("/api/support/requests")).status).toBe(401);
    const { token } = await createTestUser();
    const res = await request(app)
      .get("/api/support/requests?status=closed")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("gets one by reference, case-insensitively, and hides other users' requests", async () => {
    const { token } = await createTestUser();
    const { token: otherToken } = await createTestUser();
    const { reference } = (await submit(token, { email: "mine@example.com" })).body.data;

    const mine = await request(app)
      .get(`/api/support/requests/${reference.toLowerCase()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.reference).toBe(reference);
    expect(mine.body.data.status).toBe("open");

    const theirs = await request(app)
      .get(`/api/support/requests/${reference}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(theirs.status).toBe(404);
  });
});

describe("Admin support requests", () => {
  beforeEach(() => sendEmail.mockClear());

  const adminAuth = async () => {
    const { token } = await createTestUser({ role: ["admin"], activeRole: "admin" });
    return { Authorization: `Bearer ${token}` };
  };

  it("is admin-only", async () => {
    const { token } = await createTestUser();
    const res = await request(app).get("/api/admin/support-requests").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("lists and filters by status and search", async () => {
    const auth = await adminAuth();
    await request(app).post("/api/support/requests").send(validBody({ email: "findme@example.com" }));
    await request(app).post("/api/support/requests").send(validBody({ email: "other@example.com" }));

    const all = await request(app).get("/api/admin/support-requests").set(auth);
    expect(all.status).toBe(200);
    expect(all.body.data.pagination.total).toBe(2);
    expect(all.body.data.counts).toEqual({ open: 2, inProgress: 0 });

    const found = await request(app).get("/api/admin/support-requests?search=findme").set(auth);
    expect(found.body.data.requests).toHaveLength(1);
    expect(found.body.data.requests[0].email).toBe("findme@example.com");

    const bad = await request(app).get("/api/admin/support-requests?status=nope").set(auth);
    expect(bad.status).toBe(400);
  });

  it("stores a reply, moves an open request to in_progress, emails the sender, and the user sees it", async () => {
    const auth = await adminAuth();
    const { token } = await createTestUser();
    const { reference } = (
      await request(app)
        .post("/api/support/requests")
        .set("Authorization", `Bearer ${token}`)
        .send(validBody({ email: "reply@example.com" }))
    ).body.data;
    sendEmail.mockClear();

    const res = await request(app)
      .put(`/api/admin/support-requests/${reference}`)
      .set(auth)
      .send({ response: "We've refunded the <b>duplicate</b> charge." });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in_progress");

    const [[mail]] = sendEmail.mock.calls;
    expect(mail.to).toBe("reply@example.com");
    expect(mail.subject).toContain(reference);
    expect(mail.htm).toContain("&lt;b&gt;duplicate&lt;/b&gt;");

    const mine = await request(app)
      .get(`/api/support/requests/${reference}`)
      .set("Authorization", `Bearer ${token}`);
    expect(mine.body.data.response).toBe("We've refunded the <b>duplicate</b> charge.");
    expect(mine.body.data.respondedAt).toBeTruthy();
    expect(mine.body.data.status).toBe("in_progress");
  });

  it("resolves without emailing when only the status changes, and clears resolvedAt on reopen", async () => {
    const auth = await adminAuth();
    const { reference } = (await request(app).post("/api/support/requests").send(validBody({ email: "s@example.com" }))).body.data;
    sendEmail.mockClear();

    const resolved = await request(app).put(`/api/admin/support-requests/${reference}`).set(auth).send({ status: "resolved" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resolvedAt).toBeTruthy();
    expect(sendEmail).not.toHaveBeenCalled();

    const reopened = await request(app).put(`/api/admin/support-requests/${reference}`).set(auth).send({ status: "open" });
    expect(reopened.body.data.resolvedAt).toBeNull();
  });

  it("validates the body and 404s an unknown reference", async () => {
    const auth = await adminAuth();
    const { reference } = (await request(app).post("/api/support/requests").send(validBody({ email: "v@example.com" }))).body.data;
    const put = (body, ref = reference) => request(app).put(`/api/admin/support-requests/${ref}`).set(auth).send(body);

    expect((await put({})).status).toBe(400);
    expect((await put({ status: "closed" })).status).toBe(400);
    expect((await put({ response: "   " })).status).toBe(400);
    expect((await put({ response: "x".repeat(2001) })).status).toBe(400);
    expect((await put({ status: "resolved" }, "SR-NOTREAL1")).status).toBe(404);
  });
});

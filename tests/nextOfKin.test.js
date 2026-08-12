const { serializeNextOfKin } = require("../utils/nextOfKin");

describe("serializeNextOfKin", () => {
  it("always emits both keys so the edit form has a shape to bind to", () => {
    // Mongoose minimizes an all-empty nested object away entirely
    expect(serializeNextOfKin(undefined)).toEqual({ name: null, mobile: null });
    expect(serializeNextOfKin(null)).toEqual({ name: null, mobile: null });
    expect(serializeNextOfKin({})).toEqual({ name: null, mobile: null });
  });

  it("reports a blank stored value as null, not an empty string", () => {
    // The bug this exists to prevent: `?? null` leaves "" intact, and the
    // client cannot tell a filled-in-but-empty contact from an unsaved one.
    expect(serializeNextOfKin({ name: "", mobile: "" })).toEqual({
      name: null,
      mobile: null,
    });
    expect(serializeNextOfKin({ name: "   ", mobile: "\t\n" })).toEqual({
      name: null,
      mobile: null,
    });
  });

  it("normalizes each field independently", () => {
    expect(serializeNextOfKin({ name: "Ada Obi", mobile: "" })).toEqual({
      name: "Ada Obi",
      mobile: null,
    });
    expect(serializeNextOfKin({ name: "", mobile: "2348012345678" })).toEqual({
      name: null,
      mobile: "2348012345678",
    });
  });

  it("trims real values and ignores non-string junk", () => {
    expect(serializeNextOfKin({ name: "  Ada Obi  " }).name).toBe("Ada Obi");
    expect(serializeNextOfKin({ name: 42, mobile: {} })).toEqual({
      name: null,
      mobile: null,
    });
  });
});

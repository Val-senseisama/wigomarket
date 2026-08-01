const money = require("../utils/money");

describe("money — exactness", () => {
  it("adds values that float addition gets wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004 with raw arithmetic
    expect(money.add(0.1, 0.2)).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // guard: the bug this exists to prevent
  });

  it("subtracts without residue", () => {
    expect(money.subtract(1.0, 0.9)).toBe(0.1);
    expect(1.0 - 0.9).not.toBe(0.1);
  });

  it("keeps long chains exact", () => {
    // Naive accumulation of 0.01 a thousand times drifts off 10
    let naive = 0;
    let exact = 0;
    for (let i = 0; i < 1000; i++) {
      naive += 0.01;
      exact = money.add(exact, 0.01);
    }
    expect(exact).toBe(10);
    expect(naive).not.toBe(10);
  });

  it("sums an array exactly", () => {
    const rows = Array.from({ length: 300 }, () => ({ amount: 0.07 }));
    expect(money.sum(rows, (r) => r.amount)).toBe(21);
  });
});

describe("money — conversion", () => {
  it("round-trips through kobo", () => {
    for (const n of [0, 1, 0.01, 1234.56, 99999.99]) {
      expect(money.fromKobo(money.toKobo(n))).toBe(n);
    }
  });

  it("absorbs representation error when converting", () => {
    // 0.1 * 3 is 0.30000000000000004; that must still be 30 kobo
    expect(money.toKobo(0.1 * 3)).toBe(30);
    expect(money.toKobo(1.005 * 2)).toBe(201);
  });

  it("normalises stray precision with round()", () => {
    expect(money.round(0.1 + 0.2)).toBe(0.3);
    expect(money.round(1234.5678)).toBe(1234.57);
  });

  it("rejects non-finite and unsafe values", () => {
    expect(() => money.toKobo(NaN)).toThrow(TypeError);
    expect(() => money.toKobo(Infinity)).toThrow(TypeError);
    expect(() => money.toKobo(1e17)).toThrow(RangeError);
    expect(() => money.fromKobo(1.5)).toThrow(TypeError);
  });

  it("handles negative amounts symmetrically", () => {
    expect(money.toKobo(-1.5)).toBe(-150);
    expect(money.add(-0.1, -0.2)).toBe(-0.3);
    expect(money.subtract(-1.0, 0.9)).toBe(-1.9);
  });
});

describe("money — percentage and multiply", () => {
  it("computes the withdrawal fee exactly", () => {
    // 1% of 1234.56 is 12.3456 → 12.35
    expect(money.percentage(1234.56, 1)).toBe(12.35);
    expect(money.max(money.percentage(1234.56, 1), 100)).toBe(100);
    expect(money.max(money.percentage(50000, 1), 100)).toBe(500);
  });

  it("computes the 2% product commission exactly", () => {
    expect(money.percentage(999.99, 2)).toBe(20);
    expect(money.add(999.99, money.percentage(999.99, 2))).toBe(1019.99);
  });

  it("multiplies by a non-money factor", () => {
    // delivery: base 1200 + 100/km * 7.3km beyond base
    expect(money.multiply(100, 7.3)).toBe(730);
    expect(money.add(1200, money.multiply(100, 7.3))).toBe(1930);
  });
});

describe("money — comparison", () => {
  it("compares at kobo precision", () => {
    expect(money.equals(0.1 + 0.2, 0.3)).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false); // guard
    expect(money.gte(100, 100)).toBe(true);
    expect(money.lt(99.99, 100)).toBe(true);
    expect(money.gt(100.01, 100)).toBe(true);
  });
});

describe("money — allocate", () => {
  it("splits without creating or destroying kobo", () => {
    const parts = money.allocate(100, 3);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(money.sum(parts)).toBe(100);
  });

  it("splits evenly when it divides cleanly", () => {
    expect(money.allocate(90, 3)).toEqual([30, 30, 30]);
  });

  it("handles a single part and negative amounts", () => {
    expect(money.allocate(0.05, 1)).toEqual([0.05]);
    expect(money.sum(money.allocate(-100, 3))).toBe(-100);
  });

  it("rejects invalid part counts", () => {
    expect(() => money.allocate(100, 0)).toThrow(TypeError);
    expect(() => money.allocate(100, 2.5)).toThrow(TypeError);
  });
});

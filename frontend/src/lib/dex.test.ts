import { describe, expect, it } from "vitest";
import { amount, display, liquidityAmounts, spotPrice, type Pool } from "./dex";

const tokenA = { address: "0x1", symbol: "USDC", name: "USDC", decimals: 6 };
const tokenB = { address: "0x2", symbol: "WETH", name: "WETH", decimals: 18 };
const pool: Pool = {
  id: 1,
  tokenA,
  tokenB,
  reserveA: 2000n * 10n ** 6n,
  reserveB: 10n ** 18n,
  totalShares: 100n,
  createdAt: 1,
};
describe("amount handling", () => {
  it("preserves exact precision beyond JavaScript safe integers", () => {
    expect(amount("9007199254740993.123456", 6)).toBe(9007199254740993123456n);
    expect(display(9007199254740993123456n, 6, 6)).toBe(
      "9,007,199,254,740,993.123456",
    );
  });
  it("rejects invalid, zero, negative and overprecise amounts", () => {
    for (const value of ["0", "-1", "NaN", "1e6", "", "1.0000001"])
      expect(() => amount(value, 6)).toThrow();
  });
  it("normalizes spot prices for different ERC20 decimals", () => {
    expect(spotPrice(pool)).toBe("0.0005");
  });
  it("previews proportional deposits while leaving the extra asset in the wallet", () => {
    expect(liquidityAmounts(pool, 4000n * 10n ** 6n, 10n ** 18n)).toEqual([
      2000n * 10n ** 6n,
      10n ** 18n,
    ]);
    expect(liquidityAmounts(pool, 1000n * 10n ** 6n, 10n ** 18n)).toEqual([
      1000n * 10n ** 6n,
      5n * 10n ** 17n,
    ]);
  });
});

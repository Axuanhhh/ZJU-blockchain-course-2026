import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const E = ethers.parseEther;
const FOREVER = ethers.MaxUint256;

async function fixture() {
  const [owner, alice, bob] = await ethers.getSigners();
  const x = await ethers.deployContract("TestToken", ["Token A", "TKA"]);
  const y = await ethers.deployContract("TestToken", ["Token B", "TKB"]);
  const dex = await ethers.deployContract("MiniDEX");
  const dexAddress = await dex.getAddress();
  for (const user of [owner, alice, bob]) {
    for (const token of [x, y]) {
      await token.connect(user).faucet();
      await token.connect(user).approve(dexAddress, FOREVER);
    }
  }
  await dex.createPool(await x.getAddress(), await y.getAddress());
  const pool = await dex.pools(1);
  const a = pool.tokenA === await x.getAddress() ? x : y;
  const b = a === x ? y : x;
  return { dex, x, y, a, b, owner, alice, bob, dexAddress };
}
async function seededFixture() {
  const c = await fixture();
  await c.dex.addLiquidity(1, E("1000"), E("1000"), 0, 0, FOREVER);
  return c;
}

describe("MiniDEX assignment", function () {
  it("faucets fund independent addresses and enforce the one-hour cooldown", async function () {
    const { x, owner, alice } = await networkHelpers.loadFixture(fixture);
    expect(await x.balanceOf(owner.address)).to.equal(E("10000"));
    expect(await x.balanceOf(alice.address)).to.equal(E("10000"));
    await expect(x.faucet()).to.be.revertedWith("Faucet cooldown");
    await networkHelpers.time.increase(3600);
    await x.faucet();
    expect(await x.balanceOf(owner.address)).to.equal(E("20000"));
  });
  it("canonicalizes token order and rejects reversed duplicate pools", async function () {
    const { dex, x, y } = await networkHelpers.loadFixture(fixture);
    expect(await dex.getPoolId(await y.getAddress(), await x.getAddress())).to.equal(1);
    await expect(dex.createPool(await y.getAddress(), await x.getAddress())).to.be.revertedWith("Pool exists");
  });
  it("rejects invalid token pairs and unknown pools", async function () {
    const { dex, x, alice } = await networkHelpers.loadFixture(fixture);
    await expect(dex.createPool(ethers.ZeroAddress, await x.getAddress())).to.be.revertedWith("Invalid pair");
    await expect(dex.createPool(await x.getAddress(), await x.getAddress())).to.be.revertedWith("Invalid pair");
    await expect(dex.createPool(alice.address, await x.getAddress())).to.be.revertedWith("Not token contracts");
    await expect(dex.getAmountOut(99, await x.getAddress(), 1)).to.be.revertedWith("Unknown pool");
  });
  it("mints an enumerable ERC721 with shares, time and on-chain JSON metadata", async function () {
    const { dex, owner } = await networkHelpers.loadFixture(seededFixture);
    expect(await dex.ownerOf(1)).to.equal(owner.address);
    expect(await dex.tokenOfOwnerByIndex(owner.address, 0)).to.equal(1);
    const pos = await dex.positions(1);
    expect(pos.shares).to.equal(E("1000") - 1000n);
    expect(pos.createdAt).to.be.greaterThan(0);
    expect((await dex.pools(1)).totalShares).to.equal(E("1000"));
    const uri = await dex.tokenURI(1);
    const metadata = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(metadata.poolId).to.equal("1");
    expect(metadata.shares).to.equal(pos.shares.toString());
    expect(metadata.provider.toLowerCase()).to.equal(owner.address.toLowerCase());
  });
  it("only takes proportional deposits and leaves unused tokens in the wallet", async function () {
    const { dex, a, b, alice } = await networkHelpers.loadFixture(seededFixture);
    const beforeA = await a.balanceOf(alice.address);
    const beforeB = await b.balanceOf(alice.address);
    await dex.connect(alice).addLiquidity(1, E("300"), E("100"), E("100"), E("100"), FOREVER);
    expect(beforeA - await a.balanceOf(alice.address)).to.equal(E("100"));
    expect(beforeB - await b.balanceOf(alice.address)).to.equal(E("100"));
    expect((await dex.positions(2)).shares).to.equal(E("100"));
  });
  it("handles the other side of the proportional deposit calculation", async function () {
    const { dex, alice } = await networkHelpers.loadFixture(seededFixture);
    await dex.connect(alice).addLiquidity(1, E("100"), E("300"), 0, 0, FOREVER);
    const p = await dex.pools(1);
    expect(p.reserveA).to.equal(E("1100"));
    expect(p.reserveB).to.equal(E("1100"));
  });
  it("matches the fee-adjusted formula and does not decrease k", async function () {
    const { dex, a, b, alice } = await networkHelpers.loadFixture(seededFixture);
    const before = await dex.pools(1);
    const input = E("10");
    const expected = input * 997n * before.reserveB / (before.reserveA * 1000n + input * 997n);
    expect(await dex.getAmountOut(1, await a.getAddress(), input)).to.equal(expected);
    const wallet = await b.balanceOf(alice.address);
    await expect(dex.connect(alice).swap(1, await a.getAddress(), input, expected, FOREVER)).to.emit(dex, "Swap");
    expect(await b.balanceOf(alice.address) - wallet).to.equal(expected);
    const after = await dex.pools(1);
    expect(after.reserveA).to.equal(before.reserveA + input);
    expect(after.reserveB).to.equal(before.reserveB - expected);
    expect(after.reserveA * after.reserveB).to.be.greaterThan(before.reserveA * before.reserveB);
  });
  it("swaps in the reverse direction", async function () {
    const { dex, a, b, alice } = await networkHelpers.loadFixture(seededFixture);
    const quote = await dex.getAmountOut(1, await b.getAddress(), E("5"));
    const before = await a.balanceOf(alice.address);
    await dex.connect(alice).swap(1, await b.getAddress(), E("5"), quote, FOREVER);
    expect(await a.balanceOf(alice.address) - before).to.equal(quote);
  });
  it("reverts an impossible swap minimum without changing balances or reserves", async function () {
    const { dex, a, alice } = await networkHelpers.loadFixture(seededFixture);
    const before = await dex.pools(1);
    const wallet = await a.balanceOf(alice.address);
    const quote = await dex.getAmountOut(1, await a.getAddress(), E("10"));
    await expect(dex.connect(alice).swap(1, await a.getAddress(), E("10"), quote + 1n, FOREVER)).to.be.revertedWith("Swap slippage");
    expect((await dex.pools(1)).reserveA).to.equal(before.reserveA);
    expect(await a.balanceOf(alice.address)).to.equal(wallet);
  });
  it("rejects expired swaps, deposits and withdrawals", async function () {
    const { dex, a } = await networkHelpers.loadFixture(seededFixture);
    await expect(dex.swap(1, await a.getAddress(), E("1"), 0, 1)).to.be.revertedWith("Expired");
    await expect(dex.addLiquidity(1, E("1"), E("1"), 0, 0, 1)).to.be.revertedWith("Expired");
    await expect(dex.removeLiquidity(1, 0, 0, 1)).to.be.revertedWith("Expired");
  });
  it("rejects zero amounts, missing reserves and invalid swap tokens", async function () {
    const { dex, a, alice } = await networkHelpers.loadFixture(fixture);
    await expect(dex.getAmountOut(1, await a.getAddress(), 1)).to.be.revertedWith("Empty pool");
    await expect(dex.addLiquidity(1, 0, E("1"), 0, 0, FOREVER)).to.be.revertedWith("Zero amount");
    await expect(dex.addLiquidity(1, 1000, 1000, 0, 0, FOREVER)).to.be.revertedWith("Initial liquidity too small");
    await expect(dex.getAmountOut(1, alice.address, 1)).to.be.revertedWith("Invalid token");
    await expect(dex.getAmountOut(1, await a.getAddress(), 0)).to.be.revertedWith("Zero input");
  });
  it("rejects missing approval and insufficient wallet balances atomically", async function () {
    const { dex, a, alice } = await networkHelpers.loadFixture(seededFixture);
    await a.connect(alice).approve(await dex.getAddress(), 0);
    await expect(dex.connect(alice).swap(1, await a.getAddress(), E("1"), 0, FOREVER)).to.be.revertedWithCustomError(a, "ERC20InsufficientAllowance");
    await a.connect(alice).approve(await dex.getAddress(), FOREVER);
    await expect(dex.connect(alice).swap(1, await a.getAddress(), E("10001"), 0, FOREVER)).to.be.revertedWithCustomError(a, "ERC20InsufficientBalance");
  });
  it("rejects deposit and withdrawal slippage", async function () {
    const { dex, alice } = await networkHelpers.loadFixture(seededFixture);
    await expect(dex.connect(alice).addLiquidity(1, E("300"), E("100"), E("200"), 0, FOREVER)).to.be.revertedWith("Liquidity slippage");
    const [a, b] = await dex.previewRemove(1);
    await expect(dex.removeLiquidity(1, a + 1n, b, FOREVER)).to.be.revertedWith("Withdrawal slippage");
    expect(await dex.totalSupply()).to.equal(1);
  });
  it("returns proportional reserves including accrued fees and burns the NFT", async function () {
    const { dex, a, b, owner, alice } = await networkHelpers.loadFixture(seededFixture);
    const beforeEntitlement = await dex.previewRemove(1);
    await dex.connect(alice).swap(1, await a.getAddress(), E("100"), 0, FOREVER);
    const [outA, outB] = await dex.previewRemove(1);
    expect(outA * outB).to.be.greaterThan(beforeEntitlement[0] * beforeEntitlement[1]);
    const walletA = await a.balanceOf(owner.address);
    const walletB = await b.balanceOf(owner.address);
    await dex.removeLiquidity(1, outA, outB, FOREVER);
    expect(await a.balanceOf(owner.address) - walletA).to.equal(outA);
    expect(await b.balanceOf(owner.address) - walletB).to.equal(outB);
    expect(await dex.totalSupply()).to.equal(0);
    expect((await dex.pools(1)).totalShares).to.equal(1000);
    expect((await dex.positions(1)).shares).to.equal(0);
    await expect(dex.ownerOf(1)).to.be.revertedWithCustomError(dex, "ERC721NonexistentToken");
    await expect(dex.removeLiquidity(1, 0, 0, FOREVER)).to.be.revertedWithCustomError(dex, "ERC721NonexistentToken");
  });
  it("allows only the current NFT owner to redeem, including after transfer", async function () {
    const { dex, owner, alice } = await networkHelpers.loadFixture(seededFixture);
    await expect(dex.connect(alice).removeLiquidity(1, 0, 0, FOREVER)).to.be.revertedWith("Not position owner");
    await dex.transferFrom(owner.address, alice.address, 1);
    await expect(dex.removeLiquidity(1, 0, 0, FOREVER)).to.be.revertedWith("Not position owner");
    await dex.connect(alice).removeLiquidity(1, 0, 0, FOREVER);
    expect(await dex.balanceOf(alice.address)).to.equal(0);
  });
  it("isolates reserves for multiple pools sharing a token", async function () {
    const { dex, a, b, owner, dexAddress } = await networkHelpers.loadFixture(seededFixture);
    const c = await ethers.deployContract("TestToken", ["Token C", "TKC"]);
    await c.faucet(); await c.approve(dexAddress, FOREVER);
    await dex.createPool(await a.getAddress(), await c.getAddress());
    await dex.addLiquidity(2, E("200"), E("200"), 0, 0, FOREVER);
    const before = await dex.pools(2);
    await dex.swap(1, await a.getAddress(), E("20"), 0, FOREVER);
    const after = await dex.pools(2);
    expect(after.reserveA).to.equal(before.reserveA);
    expect(after.reserveB).to.equal(before.reserveB);
    await dex.removeLiquidity(2, 0, 0, FOREVER);
    for (const token of [a, b, c]) expect(await token.balanceOf(dexAddress)).to.equal(await dex.accountedBalances(await token.getAddress()));
    expect(await dex.ownerOf(1)).to.equal(owner.address);
  });
  it("retains liquidity-source history while removing burned active positions", async function () {
    const { dex, alice } = await networkHelpers.loadFixture(seededFixture);
    await dex.connect(alice).addLiquidity(1, E("50"), E("50"), 0, 0, FOREVER);
    await dex.connect(alice).removeLiquidity(2, 0, 0, FOREVER);
    expect(await dex.getPoolPositionIds(1)).to.deep.equal([1n, 2n]);
    expect(await dex.tokenByIndex(0)).to.equal(1);
    expect(await dex.totalSupply()).to.equal(1);
  });
  it("rejects fee-on-transfer input tokens and rolls back both deposits", async function () {
    const { dex, a, owner } = await networkHelpers.loadFixture(fixture);
    const fee = await ethers.deployContract("FeeOnTransferToken");
    await fee.approve(await dex.getAddress(), FOREVER);
    await dex.createPool(await a.getAddress(), await fee.getAddress());
    const before = await a.balanceOf(owner.address);
    await expect(dex.addLiquidity(2, E("100"), E("100"), 0, 0, FOREVER)).to.be.revertedWith("Unsupported token behavior");
    expect(await a.balanceOf(owner.address)).to.equal(before);
    expect((await dex.pools(2)).totalShares).to.equal(0);
  });
  it("blocks reentrancy from the ERC721 safe-mint receiver callback", async function () {
    const { dex, a, b } = await networkHelpers.loadFixture(fixture);
    const receiver = await ethers.deployContract("ReentrantLP");
    await receiver.provide(await dex.getAddress(), await a.getAddress(), await b.getAddress(), 1);
    expect(await receiver.blocked()).to.equal(true);
    expect(await dex.ownerOf(1)).to.equal(await receiver.getAddress());
    expect((await dex.pools(1)).reserveA).to.equal(E("100"));
  });
});

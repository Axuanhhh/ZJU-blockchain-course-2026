import hre from "hardhat";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(await readFile(`${root}/deployments/localhost.json`, "utf8"));
const { ethers } = await hre.network.create();
const users = (await ethers.getSigners()).slice(0, 20);
assert(users.length >= 20, "Need at least 20 unlocked accounts");
assert.equal(Number((await ethers.provider.getNetwork()).chainId), config.chainId, "Wrong chain");
assert.notEqual(await ethers.provider.getCode(config.dexAddress), "0x", "Redeploy after restarting the node");
const dex = await ethers.getContractAt("MiniDEX", config.dexAddress);
const poolId = await dex.getPoolId(config.tokens[0].address, config.tokens[1].address);
assert(poolId > 0n, "Deploy the initial pool first");
const initial = await dex.pools(poolId);
const tokenA = await ethers.getContractAt("TestToken", initial.tokenA);
const tokenB = await ethers.getContractAt("TestToken", initial.tokenB);
const dexAddress = await dex.getAddress();
const requestedSteps = Number(process.env.SIM_STEPS ?? 300);
assert(Number.isInteger(requestedSteps) && requestedSteps >= 20 && requestedSteps <= 10_000, "SIM_STEPS must be an integer from 20 to 10000");
const seed = Number(process.env.SIM_SEED ?? 20261103);
assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "SIM_SEED must be a uint32");
const intervalMs = Number(process.env.SIM_INTERVAL_MS ?? 250);
assert(Number.isInteger(intervalMs) && intervalMs >= 0 && intervalMs <= 60_000, "SIM_INTERVAL_MS must be from 0 to 60000");
let state = seed >>> 0;
const random = (max: number) => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return Math.floor((state / 0x100000000) * max);
};
const startedAt = new Date().toISOString();
const started = Date.now();
const startBlock = await ethers.provider.getBlockNumber();
const counts = { swap: 0, add: 0, remove: 0 };
const participation = Object.fromEntries(users.map((u) => [u.address, { swap: 0, add: 0, remove: 0 }]));
const operations: Record<string, unknown>[] = [];
let totalFeesA = 0n;
let totalFeesB = 0n;
let gasUsed = 0n;
let invariantChecks = 0;
const deadline = async () => (await ethers.provider.getBlock("latest"))!.timestamp + 600;

async function assertInvariants() {
  const pool = await dex.pools(poolId);
  const [balanceA, balanceB] = await Promise.all([tokenA.balanceOf(dexAddress), tokenB.balanceOf(dexAddress)]);
  assert.equal(balanceA, await dex.accountedBalances(initial.tokenA), "A liability mismatch");
  assert.equal(balanceB, await dex.accountedBalances(initial.tokenB), "B liability mismatch");
  let shares = await dex.MINIMUM_LIQUIDITY();
  const count = Number(await dex.totalSupply());
  for (let i = 0; i < count; i++) {
    const id = await dex.tokenByIndex(i);
    const pos = await dex.positions(id);
    if (pos.poolId === poolId) shares += pos.shares;
  }
  assert.equal(shares, pool.totalShares, "NFT share sum mismatch");
  let reserveA = 0n;
  let reserveB = 0n;
  const poolCount = Number(await dex.poolCount());
  for (let i = 1; i <= poolCount; i++) {
    const p = await dex.pools(i);
    if (p.tokenA === initial.tokenA) reserveA += p.reserveA;
    if (p.tokenB === initial.tokenA) reserveA += p.reserveB;
    if (p.tokenA === initial.tokenB) reserveB += p.reserveA;
    if (p.tokenB === initial.tokenB) reserveB += p.reserveB;
  }
  assert.equal(reserveA, balanceA, "A reserves mismatch");
  assert.equal(reserveB, balanceB, "B reserves mismatch");
  invariantChecks++;
}

for (const user of users) {
  for (const token of [tokenA, tokenB]) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    if (await token.nextClaimAt(user.address) <= BigInt(now)) await (await token.connect(user).faucet()).wait();
    await (await token.connect(user).approve(dexAddress, ethers.MaxUint256)).wait();
  }
}
console.log(`Prepared ${users.length} users; seed=${seed}; steps=${requestedSteps}`);
// Each address first receives an NFT, so withdrawals can be exercised immediately.
for (const user of users) {
  const pool = await dex.pools(poolId);
  const a = ethers.parseEther("10");
  const b = (a * pool.reserveB + pool.reserveA - 1n) / pool.reserveA;
  await (await dex.connect(user).addLiquidity(poolId, a, b, 0, 0, await deadline())).wait();
}
await assertInvariants();

for (let i = 0; i < requestedSteps; i++) {
  const user = users[i < 20 ? i : random(users.length)];
  let operation: keyof typeof counts = random(100) < 55 ? "swap" : random(100) < 55 ? "add" : "remove";
  if (operation === "remove" && await dex.balanceOf(user.address) === 0n) operation = "swap";
  const before = await dex.pools(poolId);
  let tx;
  const details: Record<string, string> = {};
  if (operation === "swap") {
    const token = random(2) === 0 ? tokenA : tokenB;
    let amount = ethers.parseEther(String(1 + random(20)));
    const available = await token.balanceOf(user.address);
    if (amount > available) amount = available / 2n;
    assert(amount > 0n, "User exhausted swap funds");
    const quote = await dex.getAmountOut(poolId, await token.getAddress(), amount);
    tx = await dex.connect(user).swap(poolId, await token.getAddress(), amount, quote * 995n / 1000n, await deadline());
    const fee = amount * 30n / 10_000n;
    if (await token.getAddress() === initial.tokenA) totalFeesA += fee;
    else totalFeesB += fee;
    Object.assign(details, { tokenIn: await token.getAddress(), amountIn: amount.toString(), amountOut: quote.toString(), fee: fee.toString() });
  } else if (operation === "add") {
    let a = ethers.parseEther(String(1 + random(10)));
    const balanceA = await tokenA.balanceOf(user.address);
    const balanceB = await tokenB.balanceOf(user.address);
    if (a > balanceA) a = balanceA / 2n;
    let b = (a * before.reserveB + before.reserveA - 1n) / before.reserveA;
    if (b > balanceB) { b = balanceB / 2n; a = b * before.reserveA / before.reserveB; }
    assert(a > 0n && b > 0n, "User exhausted liquidity funds");
    tx = await dex.connect(user).addLiquidity(poolId, a, b, a * 99n / 100n, b * 99n / 100n, await deadline());
    Object.assign(details, { desiredA: a.toString(), desiredB: b.toString() });
  } else {
    const id = await dex.tokenOfOwnerByIndex(user.address, 0);
    const [a, b] = await dex.previewRemove(id);
    tx = await dex.connect(user).removeLiquidity(id, a * 995n / 1000n, b * 995n / 1000n, await deadline());
    Object.assign(details, { tokenId: id.toString(), amountA: a.toString(), amountB: b.toString() });
  }
  const receipt = await tx.wait();
  assert(receipt && receipt.status === 1, "Transaction failed");
  gasUsed += receipt.gasUsed;
  counts[operation]++;
  participation[user.address][operation]++;
  const after = await dex.pools(poolId);
  if (operation === "swap") assert(after.reserveA * after.reserveB >= before.reserveA * before.reserveB, "Swap decreased k");
  operations.push({ step: i + 1, user: user.address, operation, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), ...details });
  if ((i + 1) % 25 === 0) { await assertInvariants(); console.log(`Completed ${i + 1}/${requestedSteps}: ${JSON.stringify(counts)}`); }
  if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await assertInvariants();
for (const count of Object.values(participation)) assert(count.swap + count.add + count.remove > 0, "An account did not participate");
const final = await dex.pools(poolId);
const report = {
  startedAt, completedAt: new Date().toISOString(), durationSeconds: (Date.now() - started) / 1000,
  chainId: config.chainId, dexAddress, seed, intervalMs, users: users.length, steps: requestedSteps,
  startBlock, endBlock: await ethers.provider.getBlockNumber(), counts, failures: 0,
  invariantChecks, invariantStatus: "passed", gasUsed: gasUsed.toString(),
  fees: { tokenA: initial.tokenA, tokenB: initial.tokenB, amountA: totalFeesA.toString(), amountB: totalFeesB.toString() },
  finalPool: { poolId: poolId.toString(), tokenA: final.tokenA, tokenB: final.tokenB, reserveA: final.reserveA.toString(), reserveB: final.reserveB.toString(), totalShares: final.totalShares.toString() },
  activeNFTs: Number(await dex.totalSupply()), participation, operations,
};
await mkdir(`${root}/reports`, { recursive: true });
const serialized = JSON.stringify(report, null, 2) + "\n";
await Promise.all([writeFile(`${root}/reports/simulation.json`, serialized), writeFile(`${root}/frontend/public/simulation-report.json`, serialized)]);
console.log(JSON.stringify({ users: report.users, steps: report.steps, counts, failures: 0, invariantChecks, durationSeconds: report.durationSeconds, activeNFTs: report.activeNFTs }, null, 2));

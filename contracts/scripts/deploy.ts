import hre from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function main() {
  const { ethers } = await hre.network.create();
  const [deployer] = await ethers.getSigners();
  const tokenA = await ethers.deployContract("TestToken", ["Token A", "TKA"]);
  const tokenB = await ethers.deployContract("TestToken", ["Token B", "TKB"]);
  const miniDEX = await ethers.deployContract("MiniDEX");
  await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment(), miniDEX.waitForDeployment()]);
  const tokens = await Promise.all([tokenA, tokenB].map(async (token) => ({
    address: await token.getAddress(), symbol: await token.symbol(), name: await token.name(), decimals: Number(await token.decimals()),
  })));
  // Seed only the deployer. Other accounts independently call the faucet in the UI/simulation.
  await (await tokenA.faucet()).wait();
  await (await tokenB.faucet()).wait();
  await (await miniDEX.createPool(tokens[0].address, tokens[1].address)).wait();
  const amount = ethers.parseEther("1000");
  await (await tokenA.approve(await miniDEX.getAddress(), amount)).wait();
  await (await tokenB.approve(await miniDEX.getAddress(), amount)).wait();
  const block = await ethers.provider.getBlock("latest");
  await (await miniDEX.addLiquidity(1, amount, amount, amount, amount, block!.timestamp + 600)).wait();
  const network = await ethers.provider.getNetwork();
  const config = {
    chainId: Number(network.chainId), rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    dexAddress: await miniDEX.getAddress(), deployer: deployer.address, tokens,
    deployedAt: new Date().toISOString(),
    abis: { dex: (await hre.artifacts.readArtifact("MiniDEX")).abi, erc20: (await hre.artifacts.readArtifact("TestToken")).abi },
  };
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const outputDirs = [`${root}/deployments`, `${root}/frontend/src/generated`];
  await Promise.all(outputDirs.map((dir) => mkdir(dir, { recursive: true })));
  await Promise.all([
    writeFile(`${root}/deployments/localhost.json`, JSON.stringify(config, null, 2) + "\n"),
    writeFile(`${root}/frontend/src/generated/deployment.json`, JSON.stringify(config, null, 2) + "\n"),
  ]);
  console.log(JSON.stringify({ dex: config.dexAddress, tokens, initialPool: 1, initialLiquidity: "1000 / 1000", chainId: config.chainId }, null, 2));
  console.log("ABI and addresses exported to frontend/src/generated/deployment.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

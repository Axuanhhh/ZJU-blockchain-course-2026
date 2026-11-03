import { test, expect } from "@playwright/test";
import { ContractFactory, JsonRpcProvider } from "ethers";
import { readFile } from "node:fs/promises";

test("real chain: faucet → pool → NFT → swap → redeem → receipt", async ({
  page,
}) => {
  const rpc = new JsonRpcProvider("http://127.0.0.1:8545", undefined, {
    cacheTimeout: -1,
  });
  const config = JSON.parse(
    await readFile(
      new URL("../src/generated/deployment.json", import.meta.url),
      "utf8",
    ),
  );
  const artifact = JSON.parse(
    await readFile(
      new URL(
        "../../contracts/artifacts/contracts/TestToken.sol/TestToken.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const deployer = await rpc.getSigner(0);
  const third = await new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer,
  ).deploy("Token C", "TKC");
  await third.waitForDeployment();
  // Allow repeat runs; advance time rather than bypassing the contract's faucet rules.
  await rpc.send("evm_increaseTime", [3601]);
  await rpc.send("evm_mine", []);
  await page.goto("/");
  await expect(page.getByText(/区块 #/)).toBeVisible();
  await page.getByRole("button", { name: "连接所选账户 ↗" }).click();
  await expect(page.getByRole("button", { name: /断开/ })).toBeVisible();
  const faucets = page.getByRole("button", { name: "领取", exact: true });
  await faucets.nth(0).click();
  await expect(page.locator(".notice.success")).toContainText("领取 TKA成功");
  await faucets.nth(1).click();
  await expect(page.locator(".notice.success")).toContainText("领取 TKB成功");
  await expect(page.getByTestId("swap-output")).not.toHaveText("—");
  await page.getByRole("button", { name: /交易池/ }).click();
  await page.getByLabel("代币地址 A").fill(config.tokens[0].address);
  await page.getByLabel("代币地址 B").fill(await third.getAddress());
  await page.getByRole("button", { name: "创建交易池 →" }).click();
  await expect(page.locator(".notice.success")).toContainText("创建交易池成功");
  await expect(
    page.getByRole("cell", { name: /TKA \/ TKC|TKC \/ TKA/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /流动性与 NFT/ }).click();
  await page.getByLabel("TKA 最大投入").fill("25");
  await page.getByLabel("TKB 最大投入").fill("25");
  await page.getByRole("button", { name: "添加流动性并铸造 NFT →" }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "添加流动性 / 铸造 NFT成功",
  );
  const redeemButton = page
    .getByRole("button", { name: /^赎回并销毁 #/ })
    .last();
  await expect(redeemButton).toBeVisible();
  const positionLabel = await redeemButton.innerText();
  await page.screenshot({
    path: "../docs/screenshots/02-nft-position.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /代币兑换/ }).click();
  await page.getByLabel("支付").fill("5");
  await expect(page.getByTestId("swap-output")).not.toHaveText("—");
  await page.getByRole("button", { name: "授权并兑换 →" }).click();
  await expect(page.locator(".notice.success")).toContainText("兑换成功");
  await page.getByRole("button", { name: "查看交易 ↗" }).click();
  await expect(page.getByRole("dialog")).toContainText("成功确认");
  await page.screenshot({
    path: "../docs/screenshots/03-transaction-receipt.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭交易详情" }).click();
  await page.screenshot({
    path: "../docs/screenshots/01-exchange.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /流动性与 NFT/ }).click();
  await page.getByRole("button", { name: positionLabel, exact: true }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "赎回并销毁 NFT成功",
  );
  await expect(
    page.getByRole("button", { name: positionLabel, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /交易池/ }).click();
  await page.getByLabel("代币地址 A").fill(config.tokens[1].address);
  await page.getByLabel("代币地址 B").fill(config.tokens[0].address);
  await page.getByRole("button", { name: "创建交易池 →" }).click();
  await expect(page.getByRole("alert")).toContainText("这个交易对已经存在");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await rpc.destroy();
});

test("mobile layout has no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "让资产流动起来。" }),
  ).toBeVisible();
  await expect(page.getByText(/区块 #/)).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/04-mobile.png",
    fullPage: true,
  });
});

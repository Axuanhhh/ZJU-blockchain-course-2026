import { expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { loadSnapshot } from "./lib/dex";

vi.mock("./lib/dex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/dex")>();
  return {
    ...actual,
    loadSnapshot: vi.fn(),
    readDex: vi.fn(() => ({
      getAmountOut: vi.fn().mockResolvedValue(9n * 10n ** 18n),
    })),
  };
});
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  vi.mocked(loadSnapshot).mockResolvedValue({
    block: 100,
    pools: [],
    positions: [],
    tokens: [],
    balances: {},
    eth: 0n,
    activities: [],
    accounts: [],
  });
});
test("shows the exchange workspace and does not allow writes before connecting", async () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: "让资产流动起来。" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "请先连接账户" })).toBeDisabled();
  await screen.findByText("区块 #100");
});
test("shows a useful RPC failure instead of invented balances or activity", async () => {
  vi.mocked(loadSnapshot).mockRejectedValue(
    new Error("当前链上没有已配置的合约。节点重启后请重新部署。"),
  );
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "节点重启后请重新部署",
  );
  expect(
    screen.getByRole("button", { name: "连接所选账户 ↗" }),
  ).toBeDisabled();
});
test("provides a clear fallback when MetaMask is unavailable", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "连接 MetaMask ↗" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("未检测到 MetaMask"),
  );
});
test("exposes pool creation and NFT views through navigation", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /交易池/ }));
  expect(
    screen.getByRole("heading", { name: "创建新的交易池" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("代币地址 A")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /流动性与 NFT/ }));
  expect(screen.getByText("连接账户以查看自己的 NFT。")).toBeInTheDocument();
});

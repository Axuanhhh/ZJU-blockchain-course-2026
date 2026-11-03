import {
  Contract,
  JsonRpcProvider,
  formatUnits,
  parseUnits,
  type InterfaceAbi,
  type Signer,
} from "ethers";
import rawDeployment from "../generated/deployment.json";

export type Token = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};
export type Deployment = {
  chainId: number;
  rpcUrl: string;
  dexAddress: string;
  deployer: string;
  tokens: Token[];
  deployedAt: string;
  abis: { dex: InterfaceAbi; erc20: InterfaceAbi };
};
export const deployment = rawDeployment as Deployment;
export const rpcUrl = import.meta.env.VITE_RPC_URL || deployment.rpcUrl;
export const provider = new JsonRpcProvider(rpcUrl, undefined, {
  cacheTimeout: -1,
});
export const erc20Abi = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
  "function nextClaimAt(address) view returns (uint256)",
];
export type Pool = {
  id: number;
  tokenA: Token;
  tokenB: Token;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  createdAt: number;
};
export type Position = {
  id: bigint;
  poolId: number;
  shares: bigint;
  depositedA: bigint;
  depositedB: bigint;
  createdAt: number;
  originalProvider: string;
  owner: string;
  amountA: bigint;
  amountB: bigint;
};
export type Activity = {
  name: string;
  hash: string;
  blockNumber: number;
  index: number;
  account: string;
  poolId: number;
};
export type Snapshot = {
  block: number;
  pools: Pool[];
  positions: Position[];
  tokens: Token[];
  balances: Record<string, bigint>;
  eth: bigint;
  activities: Activity[];
  accounts: string[];
};
export type SimulationReport = {
  dexAddress: string;
  users: number;
  steps: number;
  counts: { swap: number; add: number; remove: number };
  failures: number;
  invariantStatus: string;
  invariantChecks: number;
  completedAt: string;
  durationSeconds: number;
  operations: { hash: string }[];
};
export const short = (address: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
export const same = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export const amount = (value: string, decimals: number) => {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))
    throw new Error("请输入有效的正数金额");
  const result = parseUnits(value.trim(), decimals);
  if (result <= 0n) throw new Error("金额必须大于 0");
  return result;
};
export function display(value: bigint, decimals = 18, places = 4): string {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const tail = fraction.slice(0, places).replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${tail ? `.${tail}` : ""}`;
}
export function spotPrice(pool: Pool): string {
  if (pool.reserveA === 0n) return "—";
  const scaled =
    (pool.reserveB * 10n ** BigInt(pool.tokenA.decimals) * 1_000_000n) /
    (pool.reserveA * 10n ** BigInt(pool.tokenB.decimals));
  return display(scaled, 6, 6);
}
export function errorText(error: unknown): string {
  const e = error as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    info?: { error?: { message?: string } };
  };
  const text =
    e.reason ||
    e.info?.error?.message ||
    e.shortMessage ||
    e.message ||
    String(error);
  const translations: Record<string, string> = {
    "Faucet cooldown": "该地址尚在水龙头冷却期，请切换账户或等待一小时。",
    "Pool exists": "这个交易对已经存在，可以直接选择已有池子。",
    "Swap slippage": "价格已变化，超过滑点限制；请刷新报价后重试。",
    "Liquidity slippage": "池子比例已变化，超过滑点限制；请重试。",
    "Withdrawal slippage": "赎回报价已变化，超过滑点限制；请刷新后重试。",
    "Not position owner": "只有该 NFT 的当前持有人可以赎回。",
    Expired: "交易已过期，请重新发起。",
    "user rejected": "你取消了钱包中的请求。",
  };
  for (const [key, value] of Object.entries(translations))
    if (text.includes(key)) return value;
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}
export const readDex = () =>
  new Contract(deployment.dexAddress, deployment.abis.dex, provider);
export const writeDex = (signer: Signer) =>
  new Contract(deployment.dexAddress, deployment.abis.dex, signer);
export const tokenContract = (token: Token, signer?: Signer) =>
  new Contract(token.address, erc20Abi, signer || provider);
export const isLocalRpc = () =>
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(rpcUrl).hostname);

export async function loadSnapshot(account: string): Promise<Snapshot> {
  if (!deployment.dexAddress)
    throw new Error("尚未部署合约。请先在 contracts 目录运行 npm run deploy。");
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== deployment.chainId)
    throw new Error("RPC 网络与部署配置不一致，请检查节点。");
  if ((await provider.getCode(deployment.dexAddress)) === "0x")
    throw new Error("当前链上没有已配置的合约。节点重启后请重新部署。");
  const dex = readDex();
  // Read one block consistently: NFTs may be minted/burned while the simulator runs.
  const block = await provider.getBlockNumber();
  const atBlock = { blockTag: block };
  const [count, supply, accounts] = await Promise.all([
    dex.poolCount(atBlock),
    dex.totalSupply(atBlock),
    isLocalRpc() ? provider.listAccounts() : Promise.resolve([]),
  ]);
  const rawPools = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) => dex.pools(i + 1, atBlock)),
  );
  const tokenMap = new Map(
    deployment.tokens.map((t) => [t.address.toLowerCase(), t]),
  );
  const missing = [
    ...new Set(rawPools.flatMap((p) => [p.tokenA, p.tokenB] as string[])),
  ].filter((a) => !tokenMap.has(a.toLowerCase()));
  await Promise.all(
    missing.map(async (address) => {
      const token = new Contract(address, erc20Abi, provider);
      const [name, symbol, decimals] = await Promise.all([
        token.name(atBlock),
        token.symbol(atBlock),
        token.decimals(atBlock),
      ]);
      tokenMap.set(address.toLowerCase(), {
        address,
        name,
        symbol,
        decimals: Number(decimals),
      });
    }),
  );
  const pools: Pool[] = rawPools.map((p, i) => ({
    id: i + 1,
    tokenA: tokenMap.get(p.tokenA.toLowerCase())!,
    tokenB: tokenMap.get(p.tokenB.toLowerCase())!,
    reserveA: p.reserveA,
    reserveB: p.reserveB,
    totalShares: p.totalShares,
    createdAt: Number(p.createdAt),
  }));
  const positions: Position[] = await Promise.all(
    Array.from({ length: Number(supply) }, async (_, i) => {
      const id = await dex.tokenByIndex(i, atBlock);
      const [p, owner, values] = await Promise.all([
        dex.positions(id, atBlock),
        dex.ownerOf(id, atBlock),
        dex.previewRemove(id, atBlock),
      ]);
      return {
        id,
        poolId: Number(p.poolId),
        shares: p.shares,
        depositedA: p.depositedA,
        depositedB: p.depositedB,
        createdAt: Number(p.createdAt),
        originalProvider: p.provider,
        owner,
        amountA: values[0],
        amountB: values[1],
      };
    }),
  );
  const tokens = [...tokenMap.values()];
  const balances = Object.fromEntries(
    await Promise.all(
      tokens.map(async (t) => [
        t.address.toLowerCase(),
        account ? ((await tokenContract(t).balanceOf(account, atBlock)) as bigint) : 0n,
      ]),
    ),
  );
  const logs = await provider.getLogs({
    address: deployment.dexAddress,
    fromBlock: 0,
    toBlock: block,
  });
  const activities: Activity[] = logs
    .flatMap((log) => {
      const event = dex.interface.parseLog(log);
      if (
        !event ||
        !["PoolCreated", "Swap", "LiquidityAdded", "LiquidityRemoved"].includes(
          event.name,
        )
      )
        return [];
      return [
        {
          name: event.name,
          hash: log.transactionHash,
          blockNumber: log.blockNumber,
          index: log.index,
          poolId: Number(event.args.poolId),
          account:
            event.args.trader || event.args.provider || event.args.owner || "",
        },
      ];
    })
    .sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index)
    .slice(0, 16);
  return {
    block,
    pools,
    positions,
    tokens,
    balances,
    eth: account ? await provider.getBalance(account, block) : 0n,
    activities,
    accounts: accounts.map((a) => a.address),
  };
}

export function liquidityAmounts(
  pool: Pool,
  desiredA: bigint,
  desiredB: bigint,
): [bigint, bigint] {
  if (!pool.totalShares) return [desiredA, desiredB];
  const optimalB = (desiredA * pool.reserveB) / pool.reserveA;
  return optimalB <= desiredB
    ? [desiredA, optimalB]
    : [(desiredB * pool.reserveA) / pool.reserveB, desiredB];
}

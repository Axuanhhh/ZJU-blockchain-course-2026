import { useEffect, useState } from "react";
import {
  BrowserProvider,
  isAddress,
  type Eip1193Provider,
  type Signer,
  type ContractTransactionResponse,
} from "ethers";
import {
  amount,
  deployment,
  display,
  errorText,
  isLocalRpc,
  liquidityAmounts,
  loadSnapshot,
  provider,
  readDex,
  same,
  short,
  spotPrice,
  tokenContract,
  writeDex,
  type Activity,
  type Pool,
  type SimulationReport,
  type Snapshot,
  type Token,
} from "./lib/dex";
import "./Dashboard.css";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (
        event: string,
        listener: (...args: unknown[]) => void,
      ) => void;
    };
  }
}
const labels: Record<string, string> = {
  PoolCreated: "创建交易池",
  Swap: "代币兑换",
  LiquidityAdded: "添加流动性",
  LiquidityRemoved: "赎回流动性",
};
const time = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [issue, setIssue] = useState("");
  const [account, setAccount] = useState("");
  const [signer, setSigner] = useState<Signer | null>(null);
  const [mode, setMode] = useState("");
  const [demoAddress, setDemoAddress] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
    hash?: string;
  } | null>(null);
  const [selected, setSelected] = useState(1);
  const [direction, setDirection] = useState(false);
  const [input, setInput] = useState("10");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoteIssue, setQuoteIssue] = useState("");
  const [slippage, setSlippage] = useState("50");
  const [depositA, setDepositA] = useState("10");
  const [depositB, setDepositB] = useState("10");
  const [newA, setNewA] = useState("");
  const [newB, setNewB] = useState("");
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [detail, setDetail] = useState<{
    hash: string;
    block: number;
    gas: string;
    status: number | null;
  } | null>(null);
  const [tab, setTab] = useState("exchange");
  const pool = snapshot?.pools.find((p) => p.id === selected);
  const tokenIn = pool ? (direction ? pool.tokenB : pool.tokenA) : undefined;
  const tokenOut = pool ? (direction ? pool.tokenA : pool.tokenB) : undefined;
  const myPositions =
    snapshot?.positions.filter((p) => same(p.owner, account)) || [];
  const busy = !!pending;
  const refresh = () => setRevision((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    loadSnapshot(account)
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        setIssue("");
        setDemoAddress(
          (current) => current || s.accounts[1] || s.accounts[0] || "",
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setIssue(errorText(e));
          setSnapshot(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account, revision]);
  useEffect(() => {
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const wallet = window.ethereum;
    const reset = () => {
      if (mode === "MetaMask") {
        setSigner(null);
        setAccount("");
        setMode("");
        setNotice({
          type: "error",
          text: "钱包账户或网络已变化，请重新连接。",
        });
      }
    };
    wallet?.on?.("accountsChanged", reset);
    wallet?.on?.("chainChanged", reset);
    return () => {
      wallet?.removeListener?.("accountsChanged", reset);
      wallet?.removeListener?.("chainChanged", reset);
    };
  }, [mode]);
  useEffect(() => {
    let cancelled = false;
    fetch("/simulation-report.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!cancelled)
          setReport(
            r &&
              same(r.dexAddress, deployment.dexAddress) &&
              r.completedAt >= deployment.deployedAt
              ? r
              : null,
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteIssue("");
    if (!pool || !tokenIn || !input) return;
    const timeout = setTimeout(() => {
      try {
        const value = amount(input, tokenIn.decimals);
        readDex()
          .getAmountOut(pool.id, tokenIn.address, value)
          .then((result: bigint) => {
            if (!cancelled) setQuote(result);
          })
          .catch((e: unknown) => {
            if (!cancelled) setQuoteIssue(errorText(e));
          });
      } catch (e) {
        if (!cancelled) setQuoteIssue(errorText(e));
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [pool, tokenIn, input, direction]);

  const run = async (label: string, action: () => Promise<void>) => {
    setPending(label);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice({ type: "error", text: errorText(e) });
    } finally {
      setPending("");
      refresh();
    }
  };
  const connected = () => {
    if (!signer || !account)
      throw new Error("请先连接 MetaMask 或本地测试账户。");
    return signer;
  };
  const deadline = async () =>
    (await provider.getBlock("latest"))!.timestamp + 600;
  const confirmed = async (tx: ContractTransactionResponse, label: string) => {
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error("交易未成功确认");
    setNotice({
      type: "success",
      text: `${label}成功，已写入区块 #${receipt.blockNumber}`,
      hash: receipt.hash,
    });
  };
  const approve = async (token: Token, value: bigint, activeSigner: Signer) => {
    const contract = tokenContract(token, activeSigner);
    if ((await contract.allowance(account, deployment.dexAddress)) < value) {
      setPending(`授权 ${token.symbol}，请确认交易…`);
      await (await contract.approve(deployment.dexAddress, value)).wait();
    }
  };
  const connectMetaMask = () =>
    run("连接钱包…", async () => {
      if (!window.ethereum)
        throw new Error("未检测到 MetaMask。可以先使用左侧的本地演示账户。");
      const wallet = new BrowserProvider(window.ethereum);
      await wallet.send("eth_requestAccounts", []);
      if (Number((await wallet.getNetwork()).chainId) !== deployment.chainId) {
        throw new Error(
          `请在 MetaMask 添加并切换到本地网络：Chain ID ${deployment.chainId}，RPC ${deployment.rpcUrl}。`,
        );
      }
      const s = await wallet.getSigner();
      const address = await s.getAddress();
      const data = await loadSnapshot(address);
      setSnapshot(data);
      setSigner(s);
      setAccount(address);
      setMode("MetaMask");
    });
  const connectDemo = () =>
    run("连接本地账户…", async () => {
      if (!isLocalRpc())
        throw new Error("本地演示模式仅适用于 localhost RPC。");
      if (!demoAddress)
        throw new Error("尚未读取到本地账户，请检查 Hardhat 节点。");
      const s = await provider.getSigner(demoAddress);
      const address = await s.getAddress();
      const data = await loadSnapshot(address);
      setSnapshot(data);
      setSigner(s);
      setAccount(address);
      setMode("本地演示");
    });
  const swap = () =>
    run("准备兑换…", async () => {
      const s = connected();
      if (!pool || !tokenIn || !quote || !tokenOut)
        throw new Error("请先获得有效报价。");
      const value = amount(input, tokenIn.decimals);
      await approve(tokenIn, value, s);
      setPending("确认兑换…");
      await confirmed(
        await writeDex(s).swap(
          pool.id,
          tokenIn.address,
          value,
          (quote * (10_000n - BigInt(slippage))) / 10_000n,
          await deadline(),
        ),
        "兑换",
      );
    });
  const add = () =>
    run("准备添加流动性…", async () => {
      const s = connected();
      if (!pool) throw new Error("请选择交易池。");
      const a = amount(depositA, pool.tokenA.decimals);
      const b = amount(depositB, pool.tokenB.decimals);
      const [actualA, actualB] = liquidityAmounts(pool, a, b);
      if (!actualA || !actualB) throw new Error("提供的数量过小。");
      await approve(pool.tokenA, actualA, s);
      await approve(pool.tokenB, actualB, s);
      setPending("确认添加流动性并铸造 NFT…");
      const factor = 10_000n - BigInt(slippage);
      await confirmed(
        await writeDex(s).addLiquidity(
          pool.id,
          a,
          b,
          (actualA * factor) / 10_000n,
          (actualB * factor) / 10_000n,
          await deadline(),
        ),
        "添加流动性 / 铸造 NFT",
      );
    });
  const showTransaction = async (hash: string) => {
    try {
      const r = await provider.getTransactionReceipt(hash);
      if (r)
        setDetail({
          hash,
          block: r.blockNumber,
          gas: r.gasUsed.toString(),
          status: r.status,
        });
    } catch (e) {
      setNotice({ type: "error", text: errorText(e) });
    }
  };
  let depositPreview = "";
  if (pool) {
    try {
      const [a, b] = liquidityAmounts(
        pool,
        amount(depositA, pool.tokenA.decimals),
        amount(depositB, pool.tokenB.decimals),
      );
      depositPreview = `${display(a, pool.tokenA.decimals)} ${pool.tokenA.symbol} + ${display(b, pool.tokenB.decimals)} ${pool.tokenB.symbol}`;
    } catch {
      depositPreview = "输入两种代币的最大投入数量";
    }
  }
  const choosePool = (p: Pool) => {
    setSelected(p.id);
    setDirection(false);
  };
  const activityRow = (a: Activity) => (
    <tr key={`${a.hash}-${a.index}`}>
      <td>
        <span className={`event-dot ${a.name}`} />
        {labels[a.name]}
      </td>
      <td>Pool #{a.poolId}</td>
      <td title={a.account}>{short(a.account)}</td>
      <td>#{a.blockNumber}</td>
      <td>
        <button
          className="text-button mono"
          onClick={() => showTransaction(a.hash)}
        >
          {short(a.hash)} ↗
        </button>
      </td>
    </tr>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-mark">
            m<span>↗</span>
          </span>
          <span>
            mini<span className="brand-light">dex</span>
            <small>AMM EXCHANGE LAB</small>
          </span>
        </a>
        <div className="network-pill">
          <span
            className={`status-dot ${issue || !snapshot ? "offline" : ""}`}
          />
          Hardhat Local<span>31337</span>
        </div>
        <div className="nav-label">工作台</div>
        <nav>
          {[
            ["exchange", "⇄", "代币兑换"],
            ["liquidity", "◈", "流动性与 NFT"],
            ["pools", "▦", "交易池"],
            ["activity", "↗", "链上活动"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <span>{icon}</span>
              {label}
              {id === "liquidity" && !!myPositions.length && (
                <b>{myPositions.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-label">LOCAL DEMO</div>
          <p>
            20 个测试账户
            <br />
            每一次操作，都真实上链。
          </p>
          <label htmlFor="demo-account">选择本地账户</label>
          <select
            id="demo-account"
            value={demoAddress}
            onChange={(e) => setDemoAddress(e.target.value)}
            disabled={busy}
          >
            {snapshot?.accounts.map((a, i) => (
              <option key={a} value={a}>
                账户 {i + 1} · {short(a)}
              </option>
            ))}
          </select>
          <button
            className="demo-connect"
            onClick={connectDemo}
            disabled={busy || !snapshot}
          >
            连接所选账户 ↗
          </button>
          <small>本地账户已由 Hardhat 预置测试 ETH。</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">工作台</span>
            <span className="slash">/</span>
            {tab === "exchange"
              ? "代币兑换"
              : tab === "liquidity"
                ? "流动性与 NFT"
                : tab === "pools"
                  ? "交易池"
                  : "链上活动"}
          </div>
          <div className="top-actions">
            <span className="block-label">
              {snapshot ? `区块 #${snapshot.block}` : "等待连接"}
            </span>
            {account ? (
              <button
                className="wallet connected"
                title={account}
                disabled={busy}
                onClick={() => {
                  setAccount("");
                  setSigner(null);
                  setMode("");
                }}
              >
                <span className="avatar" />
                {short(account)}
                <small>{mode} · 断开</small>
              </button>
            ) : (
              <button
                className="wallet"
                disabled={busy}
                onClick={connectMetaMask}
              >
                连接 MetaMask ↗
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="mobile-demo">
            <select
              aria-label="手机端本地账户"
              value={demoAddress}
              onChange={(e) => setDemoAddress(e.target.value)}
              disabled={busy}
            >
              {snapshot?.accounts.map((a, i) => (
                <option key={a} value={a}>
                  账户 {i + 1} · {short(a)}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              onClick={connectDemo}
              disabled={busy || !snapshot}
            >
              连接本地演示
            </button>
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">BUILD · SWAP · PROVIDE</div>
              <h1>
                {tab === "exchange"
                  ? "让资产流动起来。"
                  : tab === "liquidity"
                    ? "你的流动性，链上有凭证。"
                    : tab === "pools"
                      ? "从一个交易对开始。"
                      : "每一步，都可验证。"}
              </h1>
              <p>恒定乘积 AMM · 0.3% 交易费 · ERC721 流动性仓位</p>
            </div>
            <button
              className="refresh-button"
              disabled={busy}
              onClick={refresh}
            >
              ↻ 刷新链上数据
            </button>
          </div>
          {issue && (
            <div className="notice error" role="alert">
              <b>连接提示</b>
              <span>{issue}</span>
            </div>
          )}
          {pending && (
            <div className="notice pending" role="status">
              <span className="spinner" />
              {pending}
            </div>
          )}
          {notice && (
            <div
              className={`notice ${notice.type}`}
              role={notice.type === "error" ? "alert" : "status"}
            >
              <span>{notice.text}</span>
              {notice.hash && (
                <button onClick={() => showTransaction(notice.hash!)}>
                  查看交易 ↗
                </button>
              )}
              <button
                className="dismiss"
                aria-label="关闭提示"
                onClick={() => setNotice(null)}
              >
                ×
              </button>
            </div>
          )}
          <div className="stats-grid">
            <div className="stat">
              <span>运行中的交易池</span>
              <strong>
                {snapshot?.pools.length ?? "—"}
                <small>个池子</small>
              </strong>
              <div>
                <span className="tiny-dot" />
                链上独立储备
              </div>
            </div>
            <div className="stat">
              <span>我的测试资产</span>
              <strong>
                {account ? display(snapshot?.eth || 0n, 18, 3) : "—"}
                <small>ETH</small>
              </strong>
              <div>{account ? "仅用于本地测试 Gas" : "连接账户后查看余额"}</div>
            </div>
            <div className="stat">
              <span>我的流动性凭证</span>
              <strong>
                {account ? myPositions.length : "—"}
                <small>ERC721 NFT</small>
              </strong>
              <div>持有凭证即可赎回对应份额</div>
            </div>
            <div className="stat accent-stat">
              <span>20 用户模拟</span>
              <strong>
                {report ? report.steps : "—"}
                <small>次操作</small>
              </strong>
              <div>
                {report
                  ? `${report.users} 个地址 · ${report.failures} 次失败 · ${report.invariantStatus === "passed" ? "不变量校验通过" : "请检查报告"}`
                  : "运行模拟脚本后查看结果"}
              </div>
            </div>
          </div>

          {(tab === "exchange" || tab === "liquidity") && (
            <div className="trading-grid">
              <section className="card trade-card">
                <div className="card-heading">
                  <h2>{tab === "exchange" ? "兑换代币" : "添加流动性"}</h2>
                  <span className="tag">
                    {tab === "exchange" ? "SWAP" : "PROVIDE"}
                  </span>
                </div>
                <label className="field-label" htmlFor="pool-select">
                  选择交易池
                </label>
                <select
                  id="pool-select"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(Number(e.target.value));
                    setDirection(false);
                  }}
                >
                  {snapshot?.pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      Pool #{p.id} · {p.tokenA.symbol} / {p.tokenB.symbol}
                    </option>
                  ))}
                </select>
                {tab === "exchange" ? (
                  <>
                    <div className="amount-panel">
                      <div>
                        <label htmlFor="swap-amount">支付</label>
                        <span>
                          余额{" "}
                          {tokenIn
                            ? display(
                                snapshot?.balances[
                                  tokenIn.address.toLowerCase()
                                ] || 0n,
                                tokenIn.decimals,
                              )
                            : "—"}
                        </span>
                      </div>
                      <div className="amount-line">
                        <input
                          id="swap-amount"
                          inputMode="decimal"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          disabled={busy}
                        />
                        <span className="token-chip">
                          <i>{tokenIn?.symbol.slice(-1) || "?"}</i>
                          {tokenIn?.symbol || "TOKEN"}
                        </span>
                      </div>
                    </div>
                    <button
                      className="direction-button"
                      aria-label="反转兑换方向"
                      disabled={busy}
                      onClick={() => setDirection(!direction)}
                    >
                      ↓
                    </button>
                    <div className="amount-panel receive">
                      <div>
                        <span>预计收到</span>
                        <span>已计入 0.3% 手续费</span>
                      </div>
                      <div className="amount-line">
                        <output data-testid="swap-output">
                          {quote !== null && tokenOut
                            ? display(quote, tokenOut.decimals, 6)
                            : "—"}
                        </output>
                        <span className="token-chip">
                          <i>{tokenOut?.symbol.slice(-1) || "?"}</i>
                          {tokenOut?.symbol || "TOKEN"}
                        </span>
                      </div>
                    </div>
                    {quoteIssue && <p className="field-error">{quoteIssue}</p>}
                    <div className="quote-detail">
                      <span>最低收到</span>
                      <b>
                        {quote !== null && tokenOut
                          ? `${display((quote * (10_000n - BigInt(slippage))) / 10_000n, tokenOut.decimals, 6)} ${tokenOut.symbol}`
                          : "—"}
                      </b>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="deposit-fields">
                      <label htmlFor="deposit-a">
                        {pool?.tokenA.symbol || "Token A"} 最大投入
                        <input
                          id="deposit-a"
                          inputMode="decimal"
                          value={depositA}
                          onChange={(e) => setDepositA(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <span>+</span>
                      <label htmlFor="deposit-b">
                        {pool?.tokenB.symbol || "Token B"} 最大投入
                        <input
                          id="deposit-b"
                          inputMode="decimal"
                          value={depositB}
                          onChange={(e) => setDepositB(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                    </div>
                    <div className="deposit-preview">
                      <span>按池子比例预计接受</span>
                      <strong>{depositPreview}</strong>
                      <small>
                        未使用的代币留在你的钱包；首次注入决定初始价格。
                      </small>
                    </div>
                  </>
                )}
                <div className="quote-detail">
                  <label htmlFor="slippage">滑点容忍度</label>
                  <select
                    id="slippage"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    disabled={busy}
                  >
                    <option value="10">0.1%</option>
                    <option value="50">0.5%</option>
                    <option value="100">1.0%</option>
                  </select>
                </div>
                <button
                  className="primary-button"
                  onClick={tab === "exchange" ? swap : add}
                  disabled={
                    busy ||
                    !account ||
                    !pool ||
                    !!issue ||
                    (tab === "exchange" && (!quote || !!quoteIssue))
                  }
                >
                  {!account
                    ? "请先连接账户"
                    : tab === "exchange"
                      ? "授权并兑换 →"
                      : "添加流动性并铸造 NFT →"}
                </button>
                <p className="card-footnote">
                  {tab === "exchange"
                    ? "授权和兑换分别确认；交易有效期为 10 分钟。"
                    : "每笔注入生成独立 NFT，赎回时整份销毁。"}
                </p>
              </section>
              <div className="right-column">
                <section className="card balances-card">
                  <div className="card-heading">
                    <h2>测试币水龙头</h2>
                    <span className="tag">FAUCET</span>
                  </div>
                  <p className="muted">
                    每个地址每小时可领取 10,000 个测试代币。
                  </p>
                  <div className="token-balances">
                    {deployment.tokens.map((t, i) => (
                      <div key={t.address}>
                        <span className={`token-icon token-${i}`}>
                          {t.symbol.slice(-1)}
                        </span>
                        <div>
                          <b>{t.symbol}</b>
                          <small>{t.name}</small>
                        </div>
                        <strong>
                          {display(
                            snapshot?.balances[t.address.toLowerCase()] || 0n,
                            t.decimals,
                          )}
                        </strong>
                        <button
                          className="secondary-button"
                          disabled={busy || !account || !!issue}
                          onClick={() =>
                            run(`领取 ${t.symbol}…`, async () => {
                              await confirmed(
                                await tokenContract(t, connected()).faucet(),
                                `领取 ${t.symbol}`,
                              );
                            })
                          }
                        >
                          领取
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="card pool-summary">
                  <div className="card-heading">
                    <h2>池子概览</h2>
                    <span className="live-label">
                      <span className="tiny-dot" />
                      LIVE
                    </span>
                  </div>
                  {pool ? (
                    <>
                      <div className="pair-name">
                        <span className="pair-icons">
                          <i>{pool.tokenA.symbol.slice(-1)}</i>
                          <i>{pool.tokenB.symbol.slice(-1)}</i>
                        </span>
                        <strong>
                          {pool.tokenA.symbol} / {pool.tokenB.symbol}
                        </strong>
                        <span>#{pool.id}</span>
                      </div>
                      <div className="reserve-grid">
                        <div>
                          <span>{pool.tokenA.symbol} 储备</span>
                          <strong>
                            {display(pool.reserveA, pool.tokenA.decimals)}
                          </strong>
                        </div>
                        <div>
                          <span>{pool.tokenB.symbol} 储备</span>
                          <strong>
                            {display(pool.reserveB, pool.tokenB.decimals)}
                          </strong>
                        </div>
                      </div>
                      <div className="pool-price">
                        1 {pool.tokenA.symbol}
                        <span>
                          = {spotPrice(pool)} {pool.tokenB.symbol}
                        </span>
                      </div>
                      <p className="muted">
                        手续费留在储备中，按持有份额随赎回结算。
                      </p>
                    </>
                  ) : (
                    <p className="empty-state">连接节点后查看池子数据。</p>
                  )}
                </section>
              </div>
            </div>
          )}

          {tab === "liquidity" && (
            <section className="card positions-card">
              <div className="card-heading">
                <h2>
                  我的 NFT 仓位{" "}
                  <span className="count-badge">{myPositions.length}</span>
                </h2>
                <span className="tag">ERC721</span>
              </div>
              {!myPositions.length ? (
                <div className="empty-state">
                  {account
                    ? "添加流动性后，你的 NFT 会出现在这里。"
                    : "连接账户以查看自己的 NFT。"}
                </div>
              ) : (
                <div className="position-grid">
                  {myPositions.map((pos) => {
                    const p = snapshot!.pools.find((v) => v.id === pos.poolId)!;
                    return (
                      <article
                        className="position-tile"
                        key={pos.id.toString()}
                      >
                        <div className="position-art">
                          <span>MINIDEX / LP</span>
                          <strong>#{pos.id.toString()}</strong>
                          <small>
                            {p.tokenA.symbol} ↔ {p.tokenB.symbol}
                          </small>
                        </div>
                        <div className="position-content">
                          <h3>Pool #{p.id} · 流动性凭证</h3>
                          <p>当前可赎回（含手续费）</p>
                          <b>
                            {display(pos.amountA, p.tokenA.decimals, 6)}{" "}
                            {p.tokenA.symbol}
                          </b>
                          <b>
                            + {display(pos.amountB, p.tokenB.decimals, 6)}{" "}
                            {p.tokenB.symbol}
                          </b>
                          <small title={pos.shares.toString()}>
                            份额占比{" "}
                            {display(
                              (pos.shares * 1_000_000n) / p.totalShares,
                              4,
                              4,
                            )}
                            %
                          </small>
                          <small>{time(pos.createdAt)}</small>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              run("赎回流动性…", async () => {
                                const factor = 10_000n - BigInt(slippage);
                                await confirmed(
                                  await writeDex(connected()).removeLiquidity(
                                    pos.id,
                                    (pos.amountA * factor) / 10_000n,
                                    (pos.amountB * factor) / 10_000n,
                                    await deadline(),
                                  ),
                                  "赎回并销毁 NFT",
                                );
                              })
                            }
                          >
                            赎回并销毁 #{pos.id.toString()}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {tab === "pools" && (
            <>
              <section className="card">
                <div className="card-heading">
                  <h2>创建新的交易池</h2>
                  <span className="tag">PERMISSIONLESS</span>
                </div>
                <p className="muted">
                  输入两个已部署的标准 ERC20
                  地址。相同交易对只创建一次；池内顺序按地址排序。
                </p>
                <div className="create-pool-form">
                  <label htmlFor="new-token-a">
                    代币地址 A
                    <input
                      id="new-token-a"
                      placeholder={deployment.tokens[0]?.address || "0x…"}
                      value={newA}
                      onChange={(e) => setNewA(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label htmlFor="new-token-b">
                    代币地址 B
                    <input
                      id="new-token-b"
                      placeholder={deployment.tokens[1]?.address || "0x…"}
                      value={newB}
                      onChange={(e) => setNewB(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || !account || !!issue}
                    onClick={() =>
                      run("创建交易池…", async () => {
                        const s = connected();
                        if (
                          !isAddress(newA) ||
                          !isAddress(newB) ||
                          same(newA, newB)
                        )
                          throw new Error("请输入两个不同的有效 ERC20 地址。");
                        for (const address of [newA, newB]) {
                          const t = tokenContract({
                            address,
                            name: "",
                            symbol: "",
                            decimals: 18,
                          });
                          await Promise.all([t.symbol(), t.decimals()]);
                        }
                        await confirmed(
                          await writeDex(s).createPool(newA, newB),
                          "创建交易池",
                        );
                      })
                    }
                  >
                    创建交易池 →
                  </button>
                </div>
              </section>
              <section className="card">
                <div className="card-heading">
                  <h2>全部交易池</h2>
                  <span className="tag">POOLS</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>交易对</th>
                        <th>储备</th>
                        <th>现货价格</th>
                        <th>活跃 NFT</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot?.pools.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <b>
                              {p.tokenA.symbol} / {p.tokenB.symbol}
                            </b>
                            <small className="block">Pool #{p.id}</small>
                          </td>
                          <td>
                            {display(p.reserveA, p.tokenA.decimals)} /{" "}
                            {display(p.reserveB, p.tokenB.decimals)}
                          </td>
                          <td>
                            1 {p.tokenA.symbol} = {spotPrice(p)}{" "}
                            {p.tokenB.symbol}
                          </td>
                          <td>
                            {
                              snapshot.positions.filter(
                                (pos) => pos.poolId === p.id,
                              ).length
                            }
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                choosePool(p);
                                setTab("liquidity");
                              }}
                            >
                              提供流动性 →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {(tab === "pools" || tab === "liquidity") && (
            <section className="card">
              <div className="card-heading">
                <h2>流动性来源</h2>
                <span className="tag">ON-CHAIN POSITIONS</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>NFT / 池子</th>
                      <th>初始提供者</th>
                      <th>当前所有者</th>
                      <th>份额原始值</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot?.positions
                      .filter((p) => tab === "pools" || p.poolId === selected)
                      .map((p) => (
                        <tr key={p.id.toString()}>
                          <td>
                            #{p.id.toString()} / Pool #{p.poolId}
                          </td>
                          <td className="mono" title={p.originalProvider}>
                            {short(p.originalProvider)}
                          </td>
                          <td className="mono" title={p.owner}>
                            {short(p.owner)}
                            {same(p.owner, account) && (
                              <span className="you-tag">我</span>
                            )}
                          </td>
                          <td className="mono shares-cell">
                            {p.shares.toString()}
                          </td>
                          <td>{time(p.createdAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(tab === "exchange" || tab === "activity") && (
            <section className="card activity-card">
              <div className="card-heading">
                <h2>最近链上活动</h2>
                <span className="tag">VERIFIABLE</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>操作</th>
                      <th>交易池</th>
                      <th>操作地址</th>
                      <th>区块</th>
                      <th>交易哈希</th>
                    </tr>
                  </thead>
                  <tbody>{snapshot?.activities.map(activityRow)}</tbody>
                </table>
                {!snapshot?.activities.length && (
                  <div className="empty-state">暂无交易记录。</div>
                )}
              </div>
            </section>
          )}
          {tab === "activity" && (
            <section className="card">
              <div className="card-heading">
                <h2>20 用户模拟验收</h2>
                <span className="tag">SIMULATION</span>
              </div>
              {report ? (
                <>
                  <div className="simulation-summary">
                    <b>
                      {report.users}
                      <small>参与地址</small>
                    </b>
                    <b>
                      {report.counts.swap}
                      <small>兑换</small>
                    </b>
                    <b>
                      {report.counts.add}
                      <small>添加流动性</small>
                    </b>
                    <b>
                      {report.counts.remove}
                      <small>移除流动性</small>
                    </b>
                    <b>
                      {report.invariantChecks}
                      <small>不变量校验</small>
                    </b>
                  </div>
                  <p className="muted">
                    完成于{" "}
                    {new Date(report.completedAt).toLocaleString("zh-CN")} ·
                    持续 {report.durationSeconds.toFixed(1)} 秒 ·{" "}
                    {report.failures} 次失败
                  </p>
                  <a
                    className="text-button"
                    href="/simulation-report.json"
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看完整地址、交易及校验报告 ↗
                  </a>
                </>
              ) : (
                <p className="empty-state">
                  在 contracts 目录运行 npm run
                  simulate，完成后点击刷新即可查看真实报告。
                </p>
              )}
            </section>
          )}
          <footer>
            <span>MINIDEX · 浙江大学区块链课程 / 作业 2</span>
            <span title={deployment.dexAddress}>
              DEX {short(deployment.dexAddress)} · 测试资产无实际价值
            </span>
          </footer>
        </main>
      </div>
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <section
            className="transaction-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tx-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="关闭交易详情"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <div className="eyebrow">TRANSACTION RECEIPT</div>
            <h2 id="tx-title">链上交易回执</h2>
            <dl>
              <dt>状态</dt>
              <dd>{detail.status === 1 ? "成功确认" : "失败"}</dd>
              <dt>区块</dt>
              <dd>#{detail.block}</dd>
              <dt>Gas Used</dt>
              <dd>{detail.gas}</dd>
              <dt>交易哈希</dt>
              <dd className="mono hash-wrap">{detail.hash}</dd>
            </dl>
            <p>数据直接读取自当前本地链的交易回执。</p>
          </section>
        </div>
      )}
    </div>
  );
}

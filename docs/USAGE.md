# MiniDEX 使用说明

## 启动与停止

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

访问 http://127.0.0.1:3000。启动脚本安装缺失依赖、启动本地链、按需部署合约并启动前端。后台服务日志位于 `.runtime/`，该目录不纳入版本管理。

启动并运行 20 用户模拟：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1 -Simulate
```

修改合约后重新部署：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1 -Redeploy
```

停止由启动脚本创建的服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\stop.ps1
```

## 账户与网络

支持两种连接方式：

- 本地账户：在左侧选择账户，点击“连接所选账户”；窄屏布局使用页面上方的“连接本地演示”。通过 Hardhat 已解锁账户发送本地链交易。
- MetaMask：配置 RPC `http://127.0.0.1:8545`、Chain ID `31337`、货币符号 `ETH`，导入一个本地测试账户后点击“连接 MetaMask”。交易授权和确认在钱包中完成。

Hardhat 为测试账户预置 ETH。账户列表由节点输出，一键启动时对应日志为 `.runtime/chain.log`。这些账户仅用于本地测试。

切换本地账户后重新点击连接；MetaMask 账户或网络变化后重新连接页面。节点重启会清空内存链，启动脚本检测到合约不存在时会重新部署。

## 代币领取

在“测试币水龙头”区域分别领取 TKA、TKB。每个地址每小时可领取一次，每次 10,000 个。已有余额可直接用于交易和流动性操作。

## 创建交易池

1. 进入“交易池”，输入两个不同的、已部署的标准 ERC20 地址。
2. 点击“创建交易池”，完成交易确认。
3. 新池按代币地址排序并去重；A/B 与 B/A 对应同一个池子。
4. 新池首次注入流动性后即可兑换，首次注入的数量比例决定初始价格。

部署脚本已初始化 TKA/TKB 池，并由部署账户注入 1,000 TKA 和 1,000 TKB。

## 添加流动性与 NFT

1. 进入“流动性与 NFT”，选择交易池，填写两种代币的最大投入。
2. 页面显示按当前储备比例预计接受的实际数量，未使用的代币保留在账户中。
3. 点击“添加流动性并铸造 NFT”，依次完成所需代币授权和添加交易。
4. “我的 NFT 仓位”显示凭证编号、所属池子、份额占比、创建时间和当前可赎回数量。
5. “流动性来源”显示池内各仓位的原始提供者、当前所有者和份额。

## 代币兑换

选择交易池和兑换方向，输入支付数量。页面展示预计输出、最低收到数量和滑点容忍度。点击“授权并兑换”，完成代币授权及兑换交易。手续费为输入数量的 0.3%，交易有效期为 10 分钟。

交易确认后更新余额、池子储备和价格。“查看交易”提供交易哈希、区块、状态和 Gas Used 等回执信息。

## 赎回流动性

在当前账户的 NFT 卡片中点击“赎回并销毁”，合约按当前储备和仓位份额返还两种代币，同时销毁凭证。返还数量包含保留在池子中的手续费权益。赎回权属于 NFT 当前持有人，每个 NFT 采用整份赎回。

## 测试与模拟

本地链和合约部署完成后，在合约目录运行：

```powershell
cd contracts
npm run typecheck
npm test
npm run simulate
```

模拟使用 20 个地址，默认执行 300 次随机操作。报告写入 `reports/simulation.json` 并同步到前端。“链上活动”页展示各类操作统计、失败次数和不变量检查结果。

在前端目录运行：

```powershell
cd frontend
npm test
npm run build
npm run test:e2e
```

浏览器测试需要本地链和前端已启动，默认使用已安装的 Chrome，可通过 `PLAYWRIGHT_CHANNEL` 选择 `chromium` 或 `msedge`。测试部署额外的 TKC 代币、创建新池并执行完整操作流程；为重复检验水龙头，会推进本地链时间。

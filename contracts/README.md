# MiniDEX 合约工程

完整设计、运行方式和验收结果见项目根目录 [README.md](../README.md)。

使用 Node.js 24、Hardhat 3、ethers 6、OpenZeppelin 5.4 和项目内固定的 Solidity 0.8.20 编译器。

```powershell
npm ci
npm run typecheck
npm test
```

启动本地链（终端保持运行）：

```powershell
npm run node
```

在另一个终端部署、初始化并导出前端 ABI：

```powershell
npm run deploy
```

运行 20 用户、300 次操作的持续模拟：

```powershell
npm run simulate
```

RPC `http://127.0.0.1:8545`，Chain ID `31337`。模拟报告在 `../reports/simulation.json`。节点重启后请重新部署，再重新运行模拟。

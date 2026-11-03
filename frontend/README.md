# MiniDEX 前端

React + TypeScript + Vite + ethers 6，连接真实 Hardhat 测试链。完整操作见 [演示指南](../docs/DEMO.md)。

```powershell
npm ci
npm start
```

打开 http://127.0.0.1:3000。合约需要提前部署，部署脚本会自动更新 `src/generated/deployment.json`。

支持 MetaMask 与 Hardhat 本地演示账户。后者不需要浏览器钱包插件，但仍会发送真实本地链交易。

```powershell
npm test
npm run build
npm run test:e2e
```

浏览器验收需要前端、本地链及合约均已准备好，默认使用本机 Chrome。生产构建输出到 `build/`。根目录的 `start.ps1` 可自动完成本地启动流程。

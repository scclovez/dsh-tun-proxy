# 复核请求（#1464）

您好，已针对 #1464 完成 0.3.1 的修复，请求重新复核。

- 新固定 Commit：标签 `v0.3.1` 指向的提交（完整 SHA 在 Issue 回复中给出）。该提交包含代码、测试、复核文档与全部证据文件，没有仅改文档的后续提交。
- 复核材料：<https://github.com/scclovez/dsh-tun-proxy/blob/v0.3.1/docs/AUDIT-EVIDENCE.md>
- 下载与执行完整性：管理内核/Wintun 的固定资产摘要（mihomo v1.19.32 的 ZIP+EXE，Wintun 0.14.1 的 ZIP+amd64 DLL），缺失校验材料即拒绝安装，镜像只传字节，解压前/替换前/执行前后逐字节验证，失败保留并回滚旧版本；反例测试与真实下载证据见 `docs/AUDIT-EVIDENCE.md`、`docs/evidence/downloads.json`。
- yaml：`package-lock.json` 回到官方 npm URL 与 SHA-512 SRI，2.9.1 tarball 的实测 SHA-256、源码 gitHead 与空运行时传递依赖见 `docs/evidence/supply-chain.json`（`npm run verify:supply-chain` 可复现）。
- Windows：真实 loopback 多跳运行、坏配置/端口占用回滚、进程归属、系统代理备份与恢复适配器、PowerShell profile 安装/卸载见 `docs/evidence/local-runtime.json`；实际宿主装载/释放见 `docs/evidence/host.json`（DSH 0.2.1-rc.1）。
- GUI：`npm run verify:gui` 在隔离 DSH 0.2.1-rc.1 宿主 + 真实 Chromium 中装载真实插件，渲染面板页，经面板同源接口完成设置保存、安装 v1.19.32（摘要校验）、启动（controller ready）、停止、卸载（purge）；真实系统代理注册表 before/after 未变化。证据：`docs/evidence/gui.json`、`docs/evidence/gui-panel.png`、`docs/evidence/gui-panel-running.png`。
- 功能边界：代理、TUN、管理员命令与网络设置属于本插件用途，不通过删除功能换取低风险标签。不自动提权；敏感订阅与凭据按设置/状态接口脱敏。
- 尚未执行、不请求计入通过的验收：真实 TUN 起停与路由差异、真实系统代理注册表 before/after 与强杀恢复、桌面侧栏内嵌面板的视觉确认。这些仍记录在 `docs/AUDIT-EVIDENCE.md` 末尾，未写成通过。
- 关于静态扫描：`lib/tools.js`、`lib/core/net.js` 的 `import(...)` 与 `lib/client.js` 的 `require('react')`（构建产物）是宿主/加载器需要或历史代码风格，不构成动态代码执行；如商城仍将其列为风险，请指出具体判定规则，再决定是否调整。

复现命令：`npm test`（83 项，82 通过、1 项真实内核测试默认跳过）、`npm run verify:downloads`、`npm run verify:supply-chain`、`npm run verify:local-runtime`、`npm run verify:host -- "<DeepSeek Harness.exe>"`、`npm run verify:gui -- "<DeepSeek Harness.exe>"`。

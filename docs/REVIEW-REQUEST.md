# 复核请求草稿

您好，已针对 #1464 补充 0.3.1 的修复与证据。待提交后请在此填写新的固定 Commit 与公开证据链接；这些本地改动尚不能以旧 Commit 请求复核。

- 新固定 Commit：待填写。
- 下载校验：管理内核/Wintun 的固定资产摘要、缺失校验拒绝安装、所有镜像逐字节验证、替换前后检查与失败回滚；反例测试及真实下载证据见 `docs/AUDIT-EVIDENCE.md`、`docs/evidence/downloads.json`。
- yaml：2.9.1 官方 npm tarball 的 SRI、实测 SHA-256、源码 gitHead、空运行时传递依赖证明见 `docs/evidence/supply-chain.json`。
- Windows：真实 loopback 多跳运行、配置回滚、进程归属、代理恢复适配器与 profile 脚本测试，见 `docs/evidence/local-runtime.json` 及测试文件。
- 请注意：真实 TUN/系统代理强杀恢复与完整 GUI 兼容验收仍按证据文档补充。完成前不请求将未执行项目视为通过。

本草稿尚未发布到 Issue。补齐手工验收和固定提交后，可附公开链接明确请求商城重新审核。

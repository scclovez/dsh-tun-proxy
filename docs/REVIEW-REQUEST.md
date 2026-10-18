# 复核请求（#1464）

您好，已针对 #1464 的 AUTH001 与 COMPAT001 完成修复，请求重新复核。

- 新固定 Commit：本次修复提交（完整 SHA 在 Issue 回复中给出），基于 `f064bf7`。该提交同时包含代码、测试、复核文档与全部证据，没有仅改文档的后续提交。
- 复核材料：<https://github.com/scclovez/dsh-tun-proxy/blob/main/docs/AUDIT-EVIDENCE.md>（§4 请求授权、§5 精确兼容声明）。

## AUTH001：`lib/routes.js`、`lib/index.js`

- `/tun-proxy/state` 与 `/tun-proxy/action` 现在在**读状态、解析正文、dispatch 之前**先过两道闸门：严格回环 Host + 单一 Host/Origin/Sec-Fetch-Site + Origin 必须等于本监听器 authority；随后复用官方 `connection.requestRejection(request)`（`@deepseek-ai/dsh-client-connection`）校验启动令牌换取的浏览器会话 Cookie / API 凭据。
- `connection` 服务缺失、抛错或返回拒绝时一律失败关闭（401/403）；缺 Host 的 HTTP/1.0、重复 Host、`Origin: null`、`sec-fetch-site: same-site` 均拒绝。
- 静态面板资源不含敏感数据，保持可读，浏览器取到页面后再鉴权；因此「授权面板仍正常」。
- 保留 POST + `application/json` 要求与 8 MiB 有界正文（超限改回 413，不再走 503）。
- 反例测试：`test/routes.test.mjs`（未授权 POST 用非法 JSON 仍返回 401 而非 400，证明未解析正文、未 dispatch）。
- 真实宿主（DSH 0.2.1-rc.2，`docs/evidence/gui.json`）：无凭证 `/state`、`/action` 均 401；无 Host 的 HTTP/1.0 得 `403 Forbidden`；跨源 403；`GET /?token=…` 303 下发 `dsh-auth-*`；带 Cookie 后面板完成设置保存、内核安装、启动、停止、卸载，真实系统代理注册表未变。

## COMPAT001：`package.json` 的 `dsh.compatibility`

| 声明 | 值 |
| --- | --- |
| `dshReleases["0.2.1-rc.2"]` | `compatible` |
| `dshReleases["0.2.1-rc.1"]` / `["0.2.1-alpha.5"]` | `unknown` |
| `dshOperations["0.2.1-rc.2"]` | install / start / uninstall `passed`，rollback `unknown` |
| `node` / `systems` / `profiles` | `>=22.19.0` / `win32-x64` / `web` |

- 只有当前窗口内真正跑过安装/启动/卸载的精确版本才标 `compatible`；历史版本、peer 宽范围和无关字段不用于推定，未验证项保持 `unknown`。
- 证据 `docs/evidence/compatibility.json`（`npm run verify:compatibility -- "<DeepSeek Harness.exe>"`）：脚本先断言宿主版本等于声明为 `compatible` 的精确版本；`npm pack` 记录 tarball SHA-256；隔离 `DSH_HOME` 中 `dsh plugin --profile compat add <tgz>` 安装并写入 `dsh.profile.bundles`；真实宿主启动后 `/tun-proxy/panel` 200、无凭证 `/state` 401、令牌 Cookie 后 `/state` 200 返回真实状态；`dsh plugin --profile compat remove` 后依赖/bundles/`node_modules` 均消失。
- 静态契约测试：`test/compatibility.test.mjs` 校验逐版键、状态枚举、操作记录完整性、`compatible` 与 `passed` 不自相矛盾、`node`/`dsh` 与 `engines`/peer 一致。
- 仍未验证、保持 `unknown`：从旧版本升级/回滚、桌面侧栏内嵌渲染、非 Windows 系统、其它 DSH 版本。

## 其余既有材料（未变）

- 下载与执行完整性：mihomo v1.19.32 与 Wintun 0.14.1 的固定 ZIP/EXE/DLL 摘要与长度校验、缺摘要拒绝、失败回滚，见 `docs/AUDIT-EVIDENCE.md` §1、`docs/evidence/downloads.json`。
- yaml 2.9.1：官方 npm 元数据、SHA-512 SRI、空运行时依赖，见 §2、`docs/evidence/supply-chain.json`。
- Windows 权限与恢复：真实 loopback 多跳、坏配置/端口占用回滚、进程归属、系统代理备份恢复，见 §3、`docs/evidence/local-runtime.json`；宿主装载/释放见 `docs/evidence/host.json`。
- 功能边界：代理、TUN、管理员命令与网络设置属于插件用途，不通过删除功能换取低风险标签；不自动提权；订阅与凭据按接口脱敏。
- 尚未执行、不请求计入通过：真实 TUN 起停与路由差异、真实系统代理注册表 before/after 与强杀恢复、桌面侧栏内嵌面板的视觉确认（见 `docs/AUDIT-EVIDENCE.md` §6）。
- 关于静态扫描：`lib/tools.js`、`lib/core/net.js` 的 `import(...)` 与 `lib/client.js` 的 `require('react')`（构建产物）是宿主/加载器需要或历史代码风格，不构成动态代码执行；如仍被列为风险，请指出判定规则，再决定是否调整。

复现命令：`npm test`（99 项，98 通过、1 项真实内核测试默认跳过）、`npm run verify:downloads`、`npm run verify:supply-chain`、`npm run verify:local-runtime`、`npm run verify:host -- "<DeepSeek Harness.exe>"`、`npm run verify:gui -- "<DeepSeek Harness.exe>"`、`npm run verify:compatibility -- "<DeepSeek Harness.exe>"`。

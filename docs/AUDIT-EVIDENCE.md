# DSH STORE #1464 复核材料

对应审查：<https://github.com/AI-Scarlett/DSH-Store/issues/1464>。修复目标为 0.3.1。复核基线是 `v0.3.1` 标签指向的提交，完整 SHA 与公开证据链接见 `REVIEW-REQUEST.md`；不能沿用被审阅的 0.3.0 SHA（`ec6ae9d`）。

## 1. 下载与执行完整性

信任根位于 `lib/core/artifacts.js`，固定 mihomo v1.19.32 的具体 Windows amd64 compatible ZIP 及其 EXE、Wintun 0.14.1 ZIP 及 amd64 DLL 的 SHA-256 和长度。

- mihomo 摘要来自 GitHub 官方资产页面/API：<https://github.com/MetaCubeX/mihomo/releases/expanded_assets/v1.19.32>。
- Wintun ZIP 的公开摘要来自 <https://www.wintun.net/>；DLL 摘要由该已验证 ZIP 中的 amd64 文件计算。
- 镜像仅传送字节，不提供信任根。错误摘要立即中止，不继续尝试其他镜像掩盖错误。
- 缺少摘要时不开始下载；下载后及解压前验证 ZIP，替换前验证已解压/暂存文件，执行前后验证安装文件。旧管理内核不再先运行 `-v`。
- 同版本跳过下载仍需检查当前 EXE，不能只信 state.json 中的“已安装”标记。启动、配置测试、状态版本探测也要先检查管理内核。
- 更新过程保存 `.previous`，失败回滚；发现上次中断留下的 `.previous` 时拒绝丢弃它。
- 非固定版本必须使用官方 GitHub asset digest 或用户显式提供的可信 ZIP 摘要。ZIP 经过验证后，其解压文件的实测摘要记录到安装状态。
- 用户显式指定的本地 `kernelPath`、`wintunPath` 是独立的本地信任选择；不会把未知 DLL 谎报成已验证官方版本。

真实下载证据：`evidence/downloads.json`。2026-10-17 复跑时 GitHub Releases API 返回 200，直接核对官方 `assets[].digest` 与 `size`；脚本仍保留 API 不可用（例如 403）时改读官方 expanded_assets HTML 的回退路径。实际 ZIP 来自报告所列镜像，摘要吻合。执行版本探测前，ZIP 和 EXE 均通过校验；Wintun ZIP 与 DLL 也均通过。

复现：`npm run verify:downloads`。目录由 Node `mkdtempSync` 新建；保留测试产物供检查，不接受用户目录作为清理目标，不修改系统代理/TUN。

自动化反例：`test/artifacts.test.mjs`、`test/kernel-install.test.mjs` 覆盖正确摘要、缺失摘要、错误摘要、镜像篡改、下载后替换 ZIP、执行前替换 EXE、同长度篡改、不可执行回滚、中断备份保留、Wintun 错误架构与旧文件保留。

边界：摘要检查不是针对具有相同用户权限的持续恶意进程的完整隔离机制；同用户进程仍可能在最后检查与系统加载之间竞争写文件。不要把这些检查描述成内核级防篡改或签名沙箱。

## 2. yaml 供应链

`package-lock.json` 使用官方 npm URL 与 SHA-512 SRI，固定 yaml 2.9.1。`scripts/verify-supply-chain.mjs` 下载官方 registry 的版本元数据及 tarball，比较锁文件 SRI、实际字节、运行时依赖列表与源码 gitHead。

实际证据：`evidence/supply-chain.json`。yaml 的运行时传递依赖为空。DSH 和 Typert 是宿主提供的可选 peer，不宣称本插件锁定了整套宿主依赖。源码与 tarball 的发布对应关系来自 npm 官方版本元数据；不是声称从源码可逐字节重建 tarball。

复现：`npm ci --omit=dev --ignore-scripts --legacy-peer-deps`，随后 `npm run verify:supply-chain`。安装不会运行第三方生命周期脚本。项目许可仍为 MIT，第三方声明不为匹配扫描器而变更。

## 3. Windows 权限、凭据、卸载和恢复

- TUN 启动前检查 Windows 管理员身份；插件不自动弹 UAC 或提升权限。界面中的启动/系统代理/TUN 设置属于用户显式操作；模型工具还受 DSH 自己的权限策略约束。自动启动、系统代理与停机行为分别由设置决定，不能把“管理员运行”当作任意网络变更的授权。
- 工具与普通设置响应隐藏订阅 URL 路径/查询、节点密码；订阅内容和备份导出为敏感数据，仅在专门读取/导出操作中返回。状态目录中的配置、订阅、日志仍是敏感明文，应依赖用户目录 ACL，并避免提交/分享；不宣称加密存储。
- 启用系统代理前持久化原有 enable/server/bypass/PAC；停用时只恢复仍由本插件占用的值，尊重其他应用后续修改。恢复写失败时保留备份，供后续重试。
- 正常停止、卸载、内核退出以及 `stopOnExit` 的同步回退均尝试恢复。重新加载插件时，在没有归属内核的情况下尝试恢复遗留代理。
- 进程归属要求可执行文件完整路径与本插件配置路径同时匹配；不再因只有一个同名进程而杀掉它。Windows 实进程测试验证了同可执行文件、不同配置的进程不会被识别为本插件内核。
- `stopOnExit=false` 时脱离宿主的内核继续运行；强制终止 DSH 无法运行 JS 退出钩子。若宿主与内核一起被强杀，系统代理可能在下一次恢复/启动前残留，不能声称强杀瞬间必然恢复。TUN 路由由 Windows/Wintun 在内核退出后回收，需要下面的真实路由验收。
- 卸载只处理插件文件；purge 在删除前拒绝用户根目录、DSH 根目录、源码目录及祖先，拒绝借用其他 DSH 数据目录。PowerShell 卸载脚本也预检这些目标。

已有可复现证据：

| 检查 | 方式与结果 |
| --- | --- |
| 摘要正确/错误/替换与回滚 | 自动测试，使用新建临时目录及注入下载器 |
| Windows 进程归属 | 真实创建两个 Node 子进程并以 WMI 查询路径及配置参数；通过 |
| 系统代理/PAC/异步失败重试/同步退出 | 内存注册表适配器测试；通过，未修改真实注册表 |
| 真实 mihomo 多跳代理、坏配置与端口占用回滚 | 仅 loopback 的两层 SOCKS + HTTP 目标；通过，报告 `evidence/local-runtime.json` |
| PowerShell 5.1 profile 安装/卸载 | 临时 manifest，验证 BOM、保留其他 bundle 与依赖；自动测试 |
| 实际 DSH peer 与装载/释放 | DSH 0.2.1-rc.2（最新复跑）、0.2.1-rc.1（早前复跑）与 0.2.0-rc.2（原审查）：真实 peer 导入、临时 profile 组合、插件 apply 与 dispose 均通过，见 `evidence/host.json`；没有修改实际桌面 profile |
| 隔离宿主 + 真实 Chromium 的 GUI 验收 | DSH 0.2.1-rc.2 临时宿主装载真实插件：面板页与静态资源 200，Chromium 渲染概览/设置面板；经面板同源接口保存设置、安装 v1.19.32（ZIP/EXE/wintun 均校验）、启动（controller ready）、停止、卸载（purge）；真实系统代理注册表 before/after 一致。见 `evidence/gui.json`、`evidence/gui-panel.png`、`evidence/gui-panel-running.png` |
| 本地路由请求授权（AUTH001） | 单元反例覆盖缺 Host 的 HTTP/1.0、重复 Host、错 Origin/opaque Origin、`sec-fetch-site: same-site`、授权服务缺失/抛错/401/403；真实宿主上无凭证 401、无 Host 403、跨源 403、令牌登录 303、凭据访问 200 |
| 精确兼容声明与安装/启动/卸载（COMPAT001） | `package.json` 的 `dsh.compatibility` 逐版声明；真实 DSH 0.2.1-rc.2 上经 `dsh plugin add` 安装、宿主启动并挂载插件、`dsh plugin remove` 卸载，见 `evidence/compatibility.json` |
| 干净依赖安装与打包 | 新建临时目录的 `npm ci --omit=dev --ignore-scripts --legacy-peer-deps` 成功，仅安装 yaml；`npm run build` 和 `npm pack --dry-run` 成功，包内无 EXE/DLL |

2026-10-18 复跑：完整 `npm test` 为 99 项（98 通过、1 项真实内核测试因未设置环境变量默认跳过）；`npm run verify:host` 与 `npm run verify:gui` 在 **DSH 0.2.1-rc.2** 上重新生成 `evidence/host.json`、`evidence/gui.json` 并通过；`npm run verify:compatibility` 在隔离 `DSH_HOME` 中完成安装/启动/卸载并生成 `evidence/compatibility.json`。宿主验收命令形如 `npm run verify:host -- "D:\apply\DeepSeek Harness\DeepSeek Harness.exe"`（换成本机安装路径）。全部脚本使用隔离的 DSH_HOME 和状态目录，不启用 TUN 或系统代理。

## 4. 本地路由的请求授权（AUTH001）

`/tun-proxy/state` 与 `/tun-proxy/action` 在**读状态、解析正文、dispatch** 之前依次通过两道闸门，任何一道不通过都只返回 401/403，不产生下载、文件、进程或注册表副作用：

1. 严格的来源栅栏：`Host` 必须是 `localhost` / `127.0.0.1` / `[::1]`（可带端口）；`Host`、`Origin`、`Sec-Fetch-Site` 任一重复出现即拒绝；`Sec-Fetch-Site` 只接受 `same-origin`、`none` 或缺省；`Origin` 出现时必须等于本监听器自身 authority（协议、主机、端口一致），`null`、空串、带路径、跨端口一律拒绝。HTTP/1.0 无 `Host` 直接拒绝。
2. 官方 Host Connection 授权：调用宿主的 `connection.requestRejection(request)`（`@deepseek-ai/dsh-client-connection`），由它校验启动令牌换取的浏览器会话 Cookie / API 凭据并执行自身的 Host/Origin 栅栏。该服务缺失、抛错或返回非 `undefined` 时一律视为拒绝。

静态面板资源（HTML/JS）不含敏感数据，保持可读，浏览器先取得页面再完成鉴权；否则面板无法加载。面板与脚本改用同源 Cookie 调用 `/action`。

反例证据（`test/routes.test.mjs`）：

| 场景 | 期望 |
| --- | --- |
| 缺 Host（HTTP/1.0）、`evil.example`、非回环 IP、零填充、越界端口、`userinfo@host` | 403，且 `service.status()` 调用数为 0 |
| 重复 `Host` 字段；`Origin: null`/空/带路径/跨端口/非 http；`Sec-Fetch-Site: cross-site`/`same-site` | 403 |
| `connection` 服务缺失、缺 `requestRejection`、同步抛错、异步返回 403 | 403（授权上下文不可用即失败关闭） |
| 官方闸门返回 401 | 401，且响应体只有 `code: authorization` |
| 未授权的 POST + 非法 JSON / 错误 Content-Type | 401（不是 400/415/503，证明未解析正文、未 dispatch） |
| 8 MiB 以上正文 | 413，dispatch 未执行 |

真实宿主证据（DSH 0.2.1-rc.2，`evidence/gui.json` 的 `authBeforeLogin`、`login`）：无凭证 `/state` 与 `/action` 均 401；`GET /tun-proxy/state HTTP/1.0` 无 Host 返回 `HTTP/1.1 403 Forbidden`；带有效会话 Cookie 但 `Origin: http://evil.example` 返回 403；`GET /?token=…` 返回 303 并下发 `dsh-auth-*` Cookie；带 Cookie 的同源面板随后完成设置保存、内核安装、启动、停止与卸载，真实系统代理注册表未变。

复现：`npm test`；`npm run verify:gui -- "<DeepSeek Harness.exe>"`。

边界：本修复复用宿主授权，不新增插件自有的身份体系；同一用户权限下的进程仍可直接读取插件状态目录，这类本地同权攻击不在本项覆盖范围内。

## 5. 精确兼容声明与安装证据（COMPAT001）

`package.json` 的 `dsh.compatibility` 按 Store 目录结构逐版声明：

| 字段 | 值 |
| --- | --- |
| `dshReleases["0.2.1-rc.2"]` | `compatible` |
| `dshReleases["0.2.1-rc.1"]` | `unknown` |
| `dshReleases["0.2.1-alpha.5"]` | `unknown` |
| `dshOperations["0.2.1-rc.2"]` | install / start / uninstall = `passed`，rollback = `unknown` |
| `node` / `systems` / `profiles` | `>=22.19.0` / `win32-x64` / `web` |

历史版本（0.2.0-rc.2、0.2.1-rc.1 的早前装载记录）与 peer 宽范围 `>=0.2.0-rc.2` **不**被用来推定 0.2.1-rc.2 的结论；只有当前窗口内实际跑过安装/启动/卸载的版本才标 `compatible`，其余保持 `unknown`。

证据 `evidence/compatibility.json`（`npm run verify:compatibility -- "<DeepSeek Harness.exe>"`）：

- 断言宿主 `--version` 等于声明为 `compatible` 的精确版本，否则脚本失败，不产生「兼容」声明；
- `npm pack` 生成 tarball 并记录 SHA-256，绑定本次源码；
- 隔离 `DSH_HOME` 中 `dsh plugin --profile compat add <tgz>`：包被写入 profile 依赖，插件管理器同时把它加入 `dsh.profile.bundles`；
- 真实宿主以该 profile 启动：`/tun-proxy/panel` 返回 200（插件确实挂载）、无凭证 `/tun-proxy/state` 返回 401、用启动令牌换 Cookie 后返回 200 与真实状态；
- `dsh plugin --profile compat remove dsh-tun-proxy`：profile 依赖、bundles 与 `node_modules/dsh-tun-proxy` 均消失。

未覆盖（保持 unknown）：从旧版本升级/回滚、桌面侧栏内嵌渲染、非 Windows 系统、其它 DSH 版本。全程使用临时 `DSH_HOME` 与临时插件状态目录，未启用 TUN，未修改真实 Profile。

## 6. 仍需在空闲/隔离 Windows 中补充的验收

1. 管理员与非管理员两种身份下的 TUN 启动和用户确认记录。
2. 开启 TUN 前后、正常停止后、内核崩溃后、宿主强杀后的适配器与 IPv4/IPv6 路由差异。已有 `scripts/acceptance-tun.mjs`，会拒绝在已有活动 TUN 时运行；不能在正在依赖代理工作的系统上直接执行。
3. 真实 Windows 系统代理注册表的 before/after（含 PAC/其他应用接管）及强杀恢复。GUI 验收只证明隔离运行没有改动真实注册表，代理恢复仍需真实注册表证据。
4. 桌面侧栏（DSH 内嵌 UI）中面板的视觉确认：`npm run verify:gui` 已覆盖独立面板页的 Chromium 渲染与全部面板操作，但没有覆盖桌面侧栏内的内嵌渲染。

已补齐：完整 GUI 面板加载、设置保存、安装/启动/卸载结果与确切 DSH 版本，见「已有可复现证据」表中的 GUI 行与 `evidence/gui.json`。

早前检查时本机已有 FlClash / Meta Tunnel 处于 Up 状态；本次复跑时已无活动 TUN，但为避免中断正在使用的网络，仍未执行真实 TUN/系统代理切换与强杀测试。这项限制与代码测试通过分别记录。

不删除代理/TUN 功能，也不把上述未执行项目写成“通过”。源码和自动测试准备完成不等于商城已准入。

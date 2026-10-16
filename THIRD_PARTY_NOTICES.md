# 第三方声明 / Third-Party Notices

本仓库**自身代码**使用 [MIT](LICENSE) 协议，版权归 `scclovez` 所有（见 [LICENSE](LICENSE)）。

**本包不分发任何第三方二进制。** 内核与 TUN 驱动 DLL 由插件在用户机器上运行时下载到用户自己的状态目录
（默认 `%USERPROFILE%\.dsh\tun-proxy`），因此不进入本仓库，也不进入 npm tarball（`package.json` 的
`files` 白名单同样排除了它们）。

以下按依赖类型列明各自的协议与义务。

---

## 1. `yaml` 2.9.1 — ISC

- 用途：解析/生成 Clash 配置（唯一运行期 npm 依赖）。
- 获取方式：npm 依赖，由用户的包管理器安装，**不随本包分发**。
- 协议：ISC，Copyright (c) 2018 Eemeli Aro <eemeli@gmail.com>
- 上游：https://www.npmjs.com/package/yaml · https://github.com/eemeli/yaml

ISC 协议全文：

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

## 2. mihomo（内核） — GPL-3.0

- 用途：真正干活的代理内核，插件以 TUN 模式拉起它。
- 获取方式：`tun_proxy_install` 从 GitHub Releases（可用镜像）下载 `mihomo-windows-amd64-*.zip`
  到 `<DSH_HOME>\tun-proxy\bin\mihomo.exe`。**本仓库/本 npm 包不包含该二进制。**
- 协议：**GPL-3.0**（copyleft）。
- 上游：https://github.com/MetaCubeX/mihomo

⚠️ **维护者注意**：GPL-3.0 是强 copyleft。只要本包**不捆绑**内核、只让用户在本地下载，本包的 MIT
就是干净的。一旦把 `mihomo.exe`（或含它的 zip）加进 git 或 npm `files`，本包整体就必须改为 GPL-3.0，
并随附对应源码与许可全文。

---

## 3. `wintun.dll` 0.14.1 — WireGuard LLC「Prebuilt Binaries License」

- 用途：Windows 上创建 TUN 虚拟网卡所必需的驱动 DLL。
- 获取方式（插件只做这两件事）：
  1. 从 https://www.wintun.net/builds/wintun-0.14.1.zip 下载并解出 `bin/amd64/wintun.dll`；
  2. 或用户指定/系统已有该 DLL 时就地复制（`wintunPath` 设置）。
  下载目标同样是用户自己的状态目录，**本包不分发它**。
- 版权：Copyright © 2018-2021 WireGuard LLC. All Rights Reserved.
- 协议要点（该 ZIP 内附的 `LICENSE.txt`，即 **Prebuilt Binaries License**；注意它与源码仓库的
  `COPYING`=GPL-2.0 **不是**同一份）：
  - 允许为合法用途使用；
  - **不得**反向工程、反编译、修改或制作衍生作品（仅允许使用 `wintun.h` 公开 API）；
  - 不得移除其中的版权/专有声明；
  - 未经 WireGuard LLC 书面同意不得单独转售/再分发，**但允许随「仅通过其公开 API 使用它的软件」一起分发**——
    本插件传递 DLL 给 mihomo，正是这种「API 使用方」场景。
- 上游：https://www.wintun.net/ · https://git.zx2c4.com/wintun/

> 说明：早前文档里把 wintun 写成「MIT-style」是不准确的，此处已按 ZIP 内的实际许可更正。
> （可选改进：下载 zip 时顺带把其中的 `LICENSE.txt` 一并解到 `bin/`，便于使用者就地看到声明。）

---

## 4. FlClash — GPL-3.0（仅功能参考，未包含其代码）

- 用途：本项目在**功能组织**上参考了 FlClash 的公开行为（README 中注明参考提交 `03f9553`）。
- 协议：**GPL-3.0**。
- 上游：https://github.com/chen08209/FlClash

⚠️ **维护者注意**：本仓库当前不包含 FlClash 的代码或资源。若今后从该项目复制任何代码、样式表、
图标或文案片段，本包必须整体转为 GPL-3.0 并保留其版权声明。

---

## 5. 发布前检查清单（维护者）

```powershell
# 1. 确认没有任何二进制/内核/驱动进了工作区
git status --short
git ls-files | Select-String -Pattern '\.(exe|dll|zip|gz|tgz)$'

# 2. 确认 npm 包内容符合预期（不含内核与 DLL）
npm pack --dry-run
```

- `package.json` 的 `files` 只放源码、脚本、文档、`cordis.patch.yml`、`web/`；
- 状态目录 `%DSH_HOME%\tun-proxy`（`bin/mihomo.exe`、`bin/wintun.dll`、`settings.json` 等）
  已在 `.gitignore` 中排除，不要在别处 `git add` 它们；
- 一旦引入任何 GPL 组件，先改本文件与 [LICENSE](LICENSE)，再发布。

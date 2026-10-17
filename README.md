# DSH 代理中心

DSH 内的独立 mihomo 客户端。

0.3.1 的下载校验、依赖来源及 Windows 验证范围见 [审查证据](docs/AUDIT-EVIDENCE.md)。商城复核尚待固定新提交和补齐文档中的验收项。

[English](README.en.md) · Windows x64 · DSH ≥ 0.2.0-rc.2 · Node.js ≥ 22.19

[![npm](https://img.shields.io/npm/v/dsh-tun-proxy?label=npm)](https://www.npmjs.com/package/dsh-tun-proxy)
[![downloads](https://img.shields.io/npm/dm/dsh-tun-proxy)](https://www.npmjs.com/package/dsh-tun-proxy)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-2ea44f)](https://github.com/topics/dsh-plugin)
[![platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)](#安装)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933)](package.json)

- 多订阅：导入、切换、更新、流量配额、定时更新、编辑。
- 代理：策略组、节点选择、搜索、排序、批量测速。
- 连接：实时速率、流量趋势、连接列表、单独/全部断开。
- 规则：运行规则、自定义前置规则。
- 链式：2–8 跳 TCP 代理。
- 系统：TUN、Windows 系统代理、DNS、IPv6、自动启动、关 DSH 时自动停代理（可选）。
- 维护：日志、内核更新、本地备份与恢复。
- 检测：一键查询当前出口 IP、地区与所属节点（经本机混合端口发出，反映真实出口）。
- 界面：继承 DSH 主题及玻璃配色。

## 安装

~~~powershell
git clone https://github.com/scclovez/dsh-tun-proxy.git
cd dsh-tun-proxy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
~~~

重启 DSH，在左侧打开“代理中心”。TUN 需要管理员权限。

面板“概览 → 连接”里的 **“关 DSH 时关代理”** 开关（设置项 `stopOnExit`，默认关闭）：打开后，正常退出 DSH 或停用本插件时会停止内核并尝试恢复系统代理。强杀 DSH 无法触发退出钩子，内核可能继续在后台运行；可用面板或 `node scripts/cli.mjs stop` 停止本插件所属内核。

## 测试

~~~powershell
$env:DSH_TEST_KERNEL = 'C:\path\to\mihomo.exe'
node --test
node scripts/acceptance-tun.mjs
~~~

默认混合端口 17890。状态保存在 %USERPROFILE%\.dsh\tun-proxy。

参考 [FlClash](https://github.com/chen08209/FlClash) 的功能组织（03f9553，GPL-3.0，仅功能参考，未包含其代码），插件代码独立实现。

## 许可证

本项目**自身代码**使用 [MIT](LICENSE) 协议，版权归 [scclovez](https://github.com/scclovez) 所有。

本包**不分发任何第三方二进制**：mihomo 内核（GPL-3.0）与 Wintun `wintun.dll`（WireGuard LLC
预编译二进制许可）都由 `tun_proxy_install` 在运行时下载到用户自己的 `%DSH_HOME%\tun-proxy`。
各自协议、义务与维护者注意事项见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

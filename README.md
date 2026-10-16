# DSH 代理中心

DSH 内的独立 mihomo 客户端。

[English](README.en.md) · Windows x64 · DSH ≥ 0.2.0-rc.2 · Node.js ≥ 22.19

- 多订阅：导入、切换、更新、流量配额、定时更新、编辑。
- 代理：策略组、节点选择、搜索、排序、批量测速。
- 连接：实时速率、流量趋势、连接列表、单独/全部断开。
- 规则：运行规则、自定义前置规则。
- 链式：2–8 跳 TCP 代理。
- 系统：TUN、Windows 系统代理、DNS、IPv6、自动启动。
- 维护：日志、内核更新、本地备份与恢复。
- 界面：继承 DSH 主题及玻璃配色。

## 安装

~~~powershell
git clone https://github.com/scclovez/dsh-tun-proxy.git
cd dsh-tun-proxy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
~~~

重启 DSH，在左侧打开“代理中心”。TUN 需要管理员权限。

## 测试

~~~powershell
$env:DSH_TEST_KERNEL = 'C:\path\to\mihomo.exe'
node --test
node scripts/acceptance-tun.mjs
~~~

默认混合端口 17890。状态保存在 %USERPROFILE%\.dsh\tun-proxy。

参考 [FlClash](https://github.com/chen08209/FlClash) 的功能组织（03f9553），插件代码独立实现。

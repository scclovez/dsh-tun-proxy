# DSH Proxy Center

Independent mihomo desktop controls inside DSH: subscriptions, proxies, live connections, rules, TCP chains, TUN, Windows system proxy, logs and local backup. Inherits the host theme.

Windows x64 · DSH ≥ 0.2.0-rc.2 · Node.js ≥ 22.19

## Install

```powershell
git clone https://github.com/scclovez/dsh-tun-proxy.git
cd dsh-tun-proxy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
```

Restart DSH and open Proxy Center in the sidebar. TUN requires administrator rights.

See [中文](README.md) for features and tests.

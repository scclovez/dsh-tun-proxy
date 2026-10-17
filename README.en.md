# DSH Proxy Center

Independent mihomo desktop controls inside DSH: subscriptions, proxies, live connections, rules, TCP chains, TUN, Windows system proxy, logs and local backup. Inherits the host theme.

Windows x64 · DSH ≥ 0.2.0-rc.2 · Node.js ≥ 22.19

See [audit evidence](docs/AUDIT-EVIDENCE.md) for 0.3.1 download verification, dependency provenance, tested host versions, and remaining Windows acceptance checks.

[![npm](https://img.shields.io/npm/v/dsh-tun-proxy?label=npm)](https://www.npmjs.com/package/dsh-tun-proxy)
[![downloads](https://img.shields.io/npm/dm/dsh-tun-proxy)](https://www.npmjs.com/package/dsh-tun-proxy)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-2ea44f)](https://github.com/topics/dsh-plugin)
[![platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)](#install)

## Install

```powershell
git clone https://github.com/scclovez/dsh-tun-proxy.git
cd dsh-tun-proxy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
```

Restart DSH and open Proxy Center in the sidebar. TUN requires administrator rights.

See [中文](README.md) for features and tests.

## License

This project's own source is [MIT](LICENSE) licensed, © 2026 [scclovez](https://github.com/scclovez).

No third-party binary is bundled: the mihomo kernel (GPL-3.0) and the Wintun `wintun.dll`
(WireGuard LLC prebuilt-binaries license) are downloaded at run time into the user's own
`%DSH_HOME%\tun-proxy`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details and
maintainer notes.

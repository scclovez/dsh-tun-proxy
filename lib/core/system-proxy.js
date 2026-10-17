import { runPs, runPsSync } from './ps.js'

const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`

const readScript = `$p=Get-ItemProperty -LiteralPath ${quote(key)}; [pscustomobject]@{enable=$p.ProxyEnable;server=$p.ProxyServer;bypass=$p.ProxyOverride;pac=$p.AutoConfigURL}|ConvertTo-Json -Compress`
export async function readWindowsProxy() { return JSON.parse(await runPs(readScript)) }
export function readWindowsProxySync() { return JSON.parse(runPsSync(readScript)) }
function writeScript(value) {
  const entries = [['ProxyEnable', value.enable, 'DWord'], ['ProxyServer', value.server, 'String'], ['ProxyOverride', value.bypass, 'String'], ['AutoConfigURL', value.pac, 'String']]
  const statements = entries.map(([name, data, type]) => data === null || data === undefined
    ? `Remove-ItemProperty -LiteralPath ${quote(key)} -Name ${quote(name)} -ErrorAction SilentlyContinue`
    : `New-ItemProperty -LiteralPath ${quote(key)} -Name ${quote(name)} -PropertyType ${type} -Value ${type === 'DWord' ? Number(data) : quote(data)} -Force | Out-Null`)
  statements.push(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshProxyNotify { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l); }'; [DshProxyNotify]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null; [DshProxyNotify]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null`)
  return statements.join('; ')
}
export async function writeWindowsProxy(value) { await runPs(writeScript(value)) }
export function writeWindowsProxySync(value) { runPsSync(writeScript(value)) }

export function createSystemProxy({ read = readWindowsProxy, write = writeWindowsProxy, readSync = readWindowsProxySync, writeSync = writeWindowsProxySync, load, save }) {
  return {
    async enable(port) {
      const current = await read(), owned = `http=127.0.0.1:${port};https=127.0.0.1:${port}`
      const state = load()
      if (!state?.owned || current.server !== state.owned || Number(current.enable) !== 1 || current.pac) save({ backup: structuredClone(current), owned })
      else save({ ...state, owned })
      await write({ enable: 1, server: owned, bypass: '<local>;localhost;127.*;[::1]', pac: null })
      return { enabled: true }
    },
    async restore() {
      const state = load()
      if (!state?.owned) return { restored: false }
      const current = await read()
      // Respect changes made by another app after this plugin took ownership.
      const ownsCurrent = current.server === state.owned && Number(current.enable) === 1 && !current.pac
      if (ownsCurrent) await write(state.backup)
      save(null)
      return { restored: ownsCurrent }
    },
    restoreSync() {
      const state = load()
      if (!state?.owned) return { restored: false }
      const current = readSync()
      const ownsCurrent = current.server === state.owned && Number(current.enable) === 1 && !current.pac
      if (ownsCurrent) writeSync(state.backup)
      save(null)
      return { restored: ownsCurrent }
    },
  }
}

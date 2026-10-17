/**
 * Filesystem layout of the plugin's state directory.
 *
 * Everything the plugin owns lives in one directory so that "uninstall" is a
 * single directory removal plus the profile dependency:
 *
 *   <DSH_HOME>/tun-proxy/
 *     bin/mihomo.exe          managed kernel (downloaded by tun_proxy_install)
 *     bin/wintun.dll          Windows TUN driver DLL required by mihomo TUN
 *     data/config.yaml        generated mihomo config (managed block + user rules)
 *     data/mihomo.pid         pid of the kernel this plugin started
 *     data/cache.db, *.mmdb   mihomo's own runtime files
 *     profiles/…              subscription / imported profile copies
 *     logs/mihomo.log         kernel stdout+stderr
 *     settings.json           user settings
 *     state.json              runtime state (secret, pid, kernel version)
 *     cache/                  download scratch space
 */
import { homedir } from 'node:os'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

function canonical(path) {
  let parent = resolve(path)
  const tail = []
  while (!existsSync(parent) && dirname(parent) !== parent) { tail.unshift(basename(parent)); parent = dirname(parent) }
  return resolve(realpathSync(parent), ...tail)
}
const within = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) }

/** Refuse state roots that could erase a profile, repository or DSH's unrelated data. */
export function assertSafeStateHome(directory, env = process.env) {
  const candidate = canonical(directory), user = canonical(homedir()), dsh = canonical(dshHome(env))
  if ([user, canonical(process.cwd()), dsh].some(root => within(candidate, root))) throw new Error('Unsafe plugin state directory: user/DSH/workspace root or ancestor')
  if (within(dsh, candidate) && !within(canonical(join(dsh, 'tun-proxy')), candidate)) throw new Error('Unsafe plugin state directory: unrelated DSH data')
  return directory
}

/** Reset the DSH home directory the same way DSH resolves it. */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  return configured ? resolve(configured) : join(homedir(), '.dsh')
}

/** State directory, overridable with DSH_TUN_PROXY_HOME (used by tests). */
export function pluginHome(env = process.env) {
  const configured = env.DSH_TUN_PROXY_HOME?.trim()
  return configured ? resolve(configured) : join(dshHome(env), 'tun-proxy')
}

export function layout(home = pluginHome()) {
  const bin = join(home, 'bin')
  const data = join(home, 'data')
  const logs = join(home, 'logs')
  return {
    home,
    bin,
    data,
    logs,
    cache: join(home, 'cache'),
    profiles: join(home, 'profiles'),
    kernel: join(bin, 'mihomo.exe'),
    wintun: join(bin, 'wintun.dll'),
    configFile: join(data, 'config.yaml'),
    pidFile: join(data, 'mihomo.pid'),
    logFile: join(logs, 'mihomo.log'),
    settingsFile: join(home, 'settings.json'),
    stateFile: join(home, 'state.json'),
    subscriptionFile: join(home, 'profiles', 'subscription.yaml'),
    importFile: join(home, 'profiles', 'imported.yaml'),
  }
}

/** Known Windows locations of Clash-family profile stores, for import detection. */
export function candidateProfileRoots(env = process.env) {
  const roaming = env.APPDATA
  const local = env.LOCALAPPDATA
  const home = env.USERPROFILE
  const out = []
  if (roaming) {
    out.push(join(roaming, 'io.github.clash-verge-rev.clash-verge-rev', 'profiles'))
    out.push(join(roaming, 'io.github.clash-verge-rev.clash-verge-rev'))
    out.push(join(roaming, 'clash-verge', 'profiles'))
    out.push(join(roaming, 'FlClash', 'profiles'))
    out.push(join(roaming, 'FlClash'))
  }
  if (local) {
    out.push(join(local, 'FlClash', 'profiles'))
    out.push(join(local, 'FlClash'))
  }
  if (home) {
    out.push(join(home, '.config', 'clash', 'profiles'))
    out.push(join(home, '.config', 'mihomo', 'profiles'))
  }
  return out
}

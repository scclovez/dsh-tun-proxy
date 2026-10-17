/**
 * Command line entry point for the same service the plugin's tools use.
 * Useful before/without a DSH restart, and for scripting.
 *
 *   node scripts/cli.mjs status [--verbose]
 *   node scripts/cli.mjs install [--force] [--version v1.19.32] [--sha256 <hex>]
 *   node scripts/cli.mjs start [--subscription <url>] [--profile <file>] [--dns-mode redir-host]
 *   node scripts/cli.mjs stop
 *   node scripts/cli.mjs config get|set [key=value ...]
 *   node scripts/cli.mjs detect
 *   node scripts/cli.mjs nodes [list|select <group> <node>|delay <node>]
 *   node scripts/cli.mjs logs [--lines 120]
 *   node scripts/cli.mjs uninstall [--purge]
 */
import { createService } from '../lib/core/service.js'
import { publicSettings } from '../lib/core/settings.js'
import { maskUrl } from '../lib/core/settings.js'
import { dispatch } from '../lib/actions.js'

const argv = process.argv.slice(2)
const command = argv[0] ?? 'status'
const flag = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const has = (name) => argv.includes(name)

const service = createService()

function print(value) {
  console.log(JSON.stringify(value, null, 2))
}

function parseAssignments(args, start) {
  const patch = {}
  for (const item of args.slice(start)) {
    const index = item.indexOf('=')
    if (index < 0) continue
    const key = item.slice(0, index)
    const raw = item.slice(index + 1)
    if (raw === 'true' || raw === 'false') patch[key] = raw === 'true'
    else if (/^-?\d+$/u.test(raw)) patch[key] = Number(raw)
    else if (raw.includes(',')) patch[key] = raw.split(',').map((part) => part.trim()).filter(Boolean)
    else patch[key] = raw
  }
  return patch
}

try {
  switch (command) {
    case 'status':
      print(await service.status({ verbose: has('--verbose') }))
      break

    case 'install': {
      const result = await service.install({
        force: has('--force'),
        version: flag('--version') ?? '',
        sha256: flag('--sha256') ?? '',
        onProgress: (message) => console.error(`  ${message}`),
      })
      print({ kernel: result.kernel, wintun: result.wintun, geodata: result.geodata })
      break
    }

    case 'start': {
      const patch = {}
      const subscription = flag('--subscription')
      const profile = flag('--profile')
      const dnsMode = flag('--dns-mode')
      if (subscription) patch.subscriptionUrl = subscription
      if (profile) patch.profilePath = profile
      if (dnsMode) patch.dnsMode = dnsMode
      if (Object.keys(patch).length > 0) service.updateSettings(patch)
      const result = await service.start({ onProgress: (message) => console.error(`  ${message}`) })
      print(result)
      break
    }

    case 'stop':
      print(await service.stop())
      break

    case 'restart': print(await service.restart()); break
    case 'validate': print(await dispatch(service, 'validate')); break
    case 'catalog': print(await service.catalog()); break
    case 'chain': {
      const names = argv.slice(1).filter((arg) => arg !== '--off')
      print(publicSettings(service.updateSettings({ chainEnabled: !has('--off'), ...(names.length ? { chain: names } : {}) })))
      break
    }

    case 'config': {
      const action = argv[1] ?? 'get'
      if (action === 'set') {
        print({ changedKeys: Object.keys(parseAssignments(argv, 2)), settings: publicSettings(service.updateSettings(parseAssignments(argv, 2))) })
      }
      else {
        print({ settings: publicSettings(service.readSettings()), home: service.paths.home, subscription: maskUrl(service.readSettings().subscriptionUrl) })
      }
      break
    }

    case 'import':
      print(await service.importSource({ source: argv.slice(1).join('\n') }))
      break

    case 'nodes': {
      const action = argv[1] ?? 'list'
      if (action === 'select') print(await service.selectNode({ group: argv[2], node: argv[3] ?? '' }))
      else if (action === 'delay') print(await service.delay({ node: argv[2] }))
      else print(await service.nodes())
      break
    }

    case 'logs':
      print(await service.logs({ lines: Number(flag('--lines') ?? 120) }))
      break

    case 'uninstall':
      print(await service.uninstall({ purge: has('--purge') }))
      break

    default:
      console.error(`未知命令：${command}`)
      process.exitCode = 2
  }
}
catch (error) {
  console.error(`错误：${error?.message ?? error}`)
  process.exitCode = 1
}

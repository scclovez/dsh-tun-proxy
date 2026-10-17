import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { ownedKernelQuery, runPs } from '../lib/core/ps.js'

test('Windows process ownership requires executable and config, including a reused/foreign PID', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh ownership-'))
  const script = join(dir, 'idle.mjs'), config = join(dir, 'ours.yaml')
  writeFileSync(script, 'setInterval(() => {}, 1000)\n')
  const own = spawn(process.execPath, [script, '-f', config], { windowsHide: true, stdio: 'ignore' })
  const foreign = spawn(process.execPath, [script, '-f', config + '.foreign'], { windowsHide: true, stdio: 'ignore' })
  try {
    await Promise.all([once(own, 'spawn'), once(foreign, 'spawn')])
    assert.equal(Number(await runPs(ownedKernelQuery([process.execPath], config, own.pid))), own.pid)
    assert.equal(await runPs(ownedKernelQuery([process.execPath], config, foreign.pid)), '')
    assert.equal(await runPs(ownedKernelQuery([join(dir, 'different.exe')], config, own.pid)), '')
  } finally { own.kill(); foreign.kill() }
  // Keep this isolated fixture for inspection; no user directory cleanup.
})

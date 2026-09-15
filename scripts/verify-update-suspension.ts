import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearBackgroundAgentSuspension,
  readBackgroundAgentSuspension,
  renewBackgroundAgentSuspension,
  suspendBackgroundAgent
} from '../src/main/orbitBackgroundServiceSuspension.ts'

// AppUpdateService renews the suspension for its own transaction right before it
// launches the installer or the Xbox Mode package helper. Background mode must
// create that marker in prepareForAppUpdate, or every in-app update aborts.
const userData = await mkdtemp(join(tmpdir(), 'mt3k-update-suspension-'))
try {
  assert.equal(await renewBackgroundAgentSuspension(userData, 'update-1', 60_000), false, 'no marker: renewal fails (the 0.1.4-mt3k.8 bug)')

  // A marker left by the installer's shutdown helper belongs to another transaction.
  await suspendBackgroundAgent(userData, { transactionId: 'installer-shutdown', recoverAgent: false })
  assert.equal(await renewBackgroundAgentSuspension(userData, 'update-1', 60_000), false, 'foreign transaction: renewal fails')

  // What prepareForAppUpdate now does.
  await suspendBackgroundAgent(userData, { transactionId: 'update-1', recoverAgent: false })
  const before = await readBackgroundAgentSuspension(userData)
  assert.equal(before?.transactionId, 'update-1')
  assert.equal(await renewBackgroundAgentSuspension(userData, 'update-1', 15 * 60_000), true, 'own transaction: renewal succeeds')
  const renewed = await readBackgroundAgentSuspension(userData)
  assert.ok(renewed && renewed.expiresAt > Date.now() + 14 * 60_000, 'renewal extends the ownership window')

  // What recoverFromFailedAppUpdate does for its own transaction.
  await clearBackgroundAgentSuspension(userData)
  assert.equal(await readBackgroundAgentSuspension(userData), undefined)
} finally {
  await rm(userData, { recursive: true, force: true })
}
console.log('Update suspension contract checks passed')

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ONBOARDING_SYNC_GATE_TIMEOUT_MS,
  runOnboardingLibrarySync
} from '../src/renderer/src/views/Onboarding/onboardingLibrarySync.ts'

async function verifyFirstRunWithoutAccount(): Promise<void> {
  const calls: string[] = []
  let startedAt: number | undefined
  await runOnboardingLibrarySync({
    baselineStartedAt: undefined,
    initLibrary: async () => {
      calls.push('init')
    },
    refreshLibrary: async () => {
      calls.push('refresh')
      startedAt = 100
    },
    getSyncStartedAt: () => startedAt
  })
  assert.deepEqual(calls, ['init', 'refresh'])
}

async function verifyJoinedSessionGetsFreshPass(): Promise<void> {
  const calls: string[] = []
  let startedAt = 100
  let refreshes = 0
  await runOnboardingLibrarySync({
    baselineStartedAt: 100,
    initLibrary: async () => {
      calls.push('init')
    },
    refreshLibrary: async () => {
      calls.push('refresh')
      refreshes++
      if (refreshes === 2) startedAt = 200
    },
    getSyncStartedAt: () => startedAt
  })
  assert.deepEqual(calls, ['init', 'refresh', 'refresh'])
}

async function verifyNewSessionIsNotRepeated(): Promise<void> {
  let refreshes = 0
  let startedAt = 100
  await runOnboardingLibrarySync({
    baselineStartedAt: 100,
    initLibrary: async () => undefined,
    refreshLibrary: async () => {
      refreshes++
      startedAt = 200
    },
    getSyncStartedAt: () => startedAt
  })
  assert.equal(refreshes, 1)
}

await verifyFirstRunWithoutAccount()
await verifyJoinedSessionGetsFreshPass()
await verifyNewSessionIsNotRepeated()
assert.equal(ONBOARDING_SYNC_GATE_TIMEOUT_MS, 30_000)

const [onboardingFlow, onboardingSuccess] = await Promise.all([
  readFile(new URL('../src/renderer/src/views/Onboarding/OnboardingFlow.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/views/Onboarding/OnboardingSuccess.tsx', import.meta.url), 'utf8')
])
assert.match(onboardingFlow, /runOnboardingLibrarySync\(\{/u)
assert.match(onboardingSuccess, /ONBOARDING_SYNC_GATE_TIMEOUT_MS/u)
assert.match(onboardingSuccess, /setEntryUnlockedInBackground\(true\)/u)

console.log('PASS: onboarding starts anonymous syncs, replaces joined sessions and cannot block forever')

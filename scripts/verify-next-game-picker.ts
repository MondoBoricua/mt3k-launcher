import assert from 'node:assert/strict'
import type { LibraryGame } from '../src/shared/ipc.ts'
import {
  buildNextGameSpinSequence,
  chooseNextGame,
  gameCommitment,
  nextGameCandidates,
  nextGameReason
} from '../src/renderer/src/lib/nextGamePicker.ts'

const NOW = 1_788_700_000_000

function game(
  id: string,
  options: {
    installed?: boolean
    comingSoon?: boolean
    playtimeMinutes?: number
    lastPlayedTimestamp?: number
  } = {}
): LibraryGame {
  return {
    id: `steam:${id}`,
    provider: 'steam',
    providerGameId: id,
    appId: Number(id),
    name: `Game ${id}`,
    metadata: {
      genres: ['Action'],
      comingSoon: options.comingSoon
    },
    metadataRevision: 1,
    playtimeMinutes: options.playtimeMinutes,
    lastPlayedTimestamp: options.lastPlayedTimestamp,
    installed: options.installed ?? false,
    addedAt: NOW - 1_000,
    updatedAt: NOW
  }
}

const installed = game('1', { installed: true })
const anotherInstalled = game('2', { installed: true, playtimeMinutes: 600 })
const backlog = game('3')
const unreleased = game('4', { installed: true, comingSoon: true })
const installedDuplicate: LibraryGame = {
  ...backlog,
  id: 'gog:3-copy',
  provider: 'gog',
  providerGameId: '3-copy',
  name: `${backlog.name}™`,
  installed: true
}

assert.deepEqual(nextGameCandidates([backlog, unreleased, installed, installed]), [backlog, installed])
assert.deepEqual(nextGameCandidates([backlog, unreleased], false), [])
assert.deepEqual(nextGameCandidates([backlog, installed]), [backlog, installed])
assert.deepEqual(nextGameCandidates([backlog, installedDuplicate]), [installedDuplicate])
assert.equal(chooseNextGame([installed, anotherInstalled], installed.id, () => 0)?.id, anotherInstalled.id)
assert.equal(chooseNextGame([unreleased], undefined, () => 0), null)
assert.equal(chooseNextGame([backlog], undefined, () => 0)?.id, backlog.id)
assert.equal(chooseNextGame([backlog], undefined, () => 0, false), null)

const sequence = buildNextGameSpinSequence(
  [installed, anotherInstalled],
  anotherInstalled,
  () => 0,
  10
)
assert.equal(sequence.entries[sequence.winnerIndex]?.game.id, anotherInstalled.id)
assert.equal(sequence.winnerIndex, sequence.entries.length - 3)
assert.ok(sequence.entries.every((entry, index) => entry.key === `spin-${index}`))

const variedGames = ['10', '11', '12', '13', '14', '15'].map((id) =>
  game(id, { installed: true })
)
const variedSequence = buildNextGameSpinSequence(
  variedGames,
  variedGames[5] as LibraryGame,
  () => 0,
  10
)
const settledTitles = variedSequence.entries
  .slice(variedSequence.winnerIndex - 2, variedSequence.winnerIndex + 3)
  .map((entry) => entry.game.name)
assert.equal(new Set(settledTitles).size, 5)

assert.equal(nextGameReason(installed, NOW).kind, 'fresh')
assert.equal(nextGameReason(anotherInstalled, NOW).kind, 'familiar')
assert.equal(
  nextGameReason(game('5', { playtimeMinutes: 30, lastPlayedTimestamp: NOW - 60 * 86_400_000 }), NOW)
    .kind,
  'comeback'
)
assert.equal(
  gameCommitment({ state: 'available', provider: 'howlongtobeat', mainStoryMinutes: 600, fetchedAt: NOW }),
  'compact'
)
assert.equal(
  gameCommitment({ state: 'available', provider: 'howlongtobeat', mainStoryMinutes: 1_200, fetchedAt: NOW }),
  'balanced'
)
assert.equal(
  gameCommitment({ state: 'available', provider: 'howlongtobeat', mainStoryMinutes: 3_000, fetchedAt: NOW }),
  'long'
)

console.log('Next-game picker policy checks passed')

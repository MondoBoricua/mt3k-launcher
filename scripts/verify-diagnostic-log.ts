import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatLogLine, redactSecrets, LOG_MAX_BYTES } from '../src/shared/diagnosticLogPolicy'
import { createDiagnosticWriter } from '../src/main/diagnosticLog'

assert.equal(formatLogLine('warn', '[app-update] failed\nagain', new Date('2026-01-01Z')),
  '2026-01-01T00:00:00.000Z WARN [app-update] failed\\nagain\n')
assert.match(formatLogLine('error', 'failure'), / ERROR \[main\] failure\n$/)
for (const secret of ['a'.repeat(32), 'Ab9_'.repeat(20), 'mfa.' + 'a'.repeat(60)]) {
  assert.ok(!redactSecrets(`secret ${secret}`).includes(secret))
}
for (const input of ['token=short-secret', 'Bearer short.secret', 'key=private-key',
  '"access_token": "short secret"', "steamLoginSecure=123%7C%7Csecret", 'discord_token: abc.def.ghi', 'Authorization: Bearer short-secret']) {
  assert.ok(redactSecrets(input).includes('[REDACTED]'), input)
  assert.ok(!redactSecrets(input).includes('short'), input)
}
assert.equal(redactSecrets('MT3K Launcher 0.1.4 error 123 Windows 10.0.26100'),
  'MT3K Launcher 0.1.4 error 123 Windows 10.0.26100')
const directory = await mkdtemp(join(tmpdir(), 'mt3k-log-'))
try {
  const writer = createDiagnosticWriter(directory)
  await Promise.all(Array.from({ length: 30 }, (_, i) => writer.write('info', `[test] item ${i}`)))
  const lines = (await readFile(writer.path, 'utf8')).trim().split('\n')
  assert.equal(lines.length, 30)
  lines.forEach((line, i) => assert.ok(line.endsWith(`item ${i}`)))
  await writeFile(writer.path, 'x'.repeat(LOG_MAX_BYTES))
  await writer.write('error', '[test] rotated')
  assert.equal((await readFile(writer.path + '.1')).length, LOG_MAX_BYTES)
  assert.match(await readFile(writer.path, 'utf8'), /rotated/)
  await writeFile(writer.path, 'y'.repeat(LOG_MAX_BYTES))
  await writer.write('warn', 'second rotation')
  assert.equal((await readFile(writer.path + '.1', 'utf8'))[0], 'y')
  assert.deepEqual((await readdir(directory)).sort(), ['mt3k-launcher.log', 'mt3k-launcher.log.1'])
  await writer.write('error', 'ü'.repeat(LOG_MAX_BYTES))
  assert.ok((await readFile(writer.path)).length <= LOG_MAX_BYTES)
  let attempts = 0
  const denied = createDiagnosticWriter(directory, {
    appendFile: async () => { attempts++; throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
  })
  await assert.doesNotReject(denied.write('error', 'denied'))
  await assert.doesNotReject(denied.write('error', 'still denied'))
  assert.equal(attempts, 2)
  const badDirectory = createDiagnosticWriter(writer.path)
  await assert.doesNotReject(badDirectory.write('warn', 'not a directory'))
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Diagnostic log: formatting, redaction, serialization, rotation, size bound and EACCES passed')

import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import {
  encodeRetroArchCommand,
  isRetroArchCommand,
  isRetroArchPauseSession,
  parseStatus,
  pauseMenuActions,
  resumeShouldUnpause,
  openShouldPause,
  selectRetroArchConfigPath,
  upsertRetroArchNetworkCommands
} from '../src/shared/retroArchCommands.ts'
import { sendRetroArchUdp } from '../src/main/retro/retroArchCommandClient.ts'

// Lista blanca: un string cualquiera no se codifica ni se manda.
assert.equal(isRetroArchCommand('SAVE_STATE'), true)
assert.equal(isRetroArchCommand('GET_STATUS'), true)
assert.equal(isRetroArchCommand('QUIT'), true)
assert.equal(isRetroArchCommand('SHOW_MSG hola'), false)
assert.equal(isRetroArchCommand('PAUSE_TOGGLE;127.0.0.1;55355'), false)
assert.equal(isRetroArchCommand('save_state'), false)
assert.equal(isRetroArchCommand(''), false)
assert.equal(isRetroArchCommand(55355), false)
assert.equal(isRetroArchCommand(null), false)
assert.throws(() => encodeRetroArchCommand('DROP TABLE' as 'QUIT'), /rejected/)
assert.equal(encodeRetroArchCommand('GET_STATUS').toString('utf8'), 'GET_STATUS')
assert.equal(encodeRetroArchCommand('PAUSE_TOGGLE').includes(10), false)

const rejected = await sendRetroArchUdp('nope' as 'QUIT')
assert.equal(rejected.ok, false)
assert.equal(rejected.error, 'rejected')

// GET_STATUS: jugando, pausado, sin contenido, y basura.
const playing = parseStatus('GET_STATUS PLAYING snes,super-mario,crc32=DEADBEEF')
assert.equal(playing.playback, 'PLAYING')
assert.equal(playing.systemId, 'snes')
assert.equal(playing.game, 'super-mario')
assert.equal(playing.crc32, 'DEADBEEF')
assert.equal(openShouldPause(playing), true)
assert.equal(resumeShouldUnpause(playing), false)

const paused = parseStatus('GET_STATUS PAUSED nes,mario,crc32=aabbccdd\n')
assert.equal(paused.playback, 'PAUSED')
assert.equal(paused.game, 'mario')
assert.equal(openShouldPause(paused), false)
assert.equal(resumeShouldUnpause(paused), true)
assert.equal(pauseMenuActions(paused).find((action) => action.id === 'saveState')?.enabled, true)

const empty = parseStatus('GET_STATUS CONTENTLESS')
assert.equal(empty.playback, 'CONTENTLESS')
assert.equal(pauseMenuActions(empty).find((action) => action.id === 'loadState')?.enabled, false)
assert.equal(pauseMenuActions(empty).find((action) => action.id === 'quit')?.enabled, true)
assert.equal(pauseMenuActions(empty).find((action) => action.id === 'resume')?.enabled, true)

for (const garbage of ['', 'hello', 'GET_STATUS', 'GET_STATUS MAYBE', 'PLAYING']) {
  const parsed = parseStatus(garbage)
  assert.equal(parsed.playback, 'UNKNOWN', garbage)
  assert.equal(pauseMenuActions(parsed).find((action) => action.id === 'screenshot')?.enabled, false)
  assert.equal(pauseMenuActions(parsed).find((action) => action.id === 'quit')?.enabled, false)
}

// Solo RetroArch en fase running. Un emulador suelto no abre el menú.
assert.equal(
  isRetroArchPauseSession({ phase: 'running', provider: 'retro', emulatorId: 'retroarch' }),
  true
)
assert.equal(
  isRetroArchPauseSession({ phase: 'running', provider: 'retro', emulatorId: 'snes9x' }),
  false
)
assert.equal(
  isRetroArchPauseSession({ phase: 'launching', provider: 'retro', emulatorId: 'retroarch' }),
  false
)
assert.equal(
  isRetroArchPauseSession({ phase: 'running', provider: 'steam', emulatorId: 'retroarch' }),
  false
)

// El cfg se edita en sitio: claves nuevas, reemplazo, el resto y CRLF intactos.
const sample =
  'video_fullscreen = "true"\r\n' +
  '# network_cmd_enable = "false"\r\n' +
  'network_cmd_enable = "false"\r\n' +
  'audio_latency = "64"\r\n'
const edited = upsertRetroArchNetworkCommands(sample)
assert.equal(
  edited,
  'video_fullscreen = "true"\r\n' +
    '# network_cmd_enable = "false"\r\n' +
    'network_cmd_enable = "true"\r\n' +
    'audio_latency = "64"\r\n' +
    'network_cmd_port = "55355"\r\n'
)
assert.equal(edited.includes('audio_latency = "64"'), true)
assert.equal(edited.includes('\n') && edited.includes('\r\n'), true)
assert.equal(edited.includes('\nvideo'), false)

const replaced = upsertRetroArchNetworkCommands(
  'network_cmd_enable = "false"\r\nnetwork_cmd_port = "1"\r\nvideo_driver = "gl"\r\n'
)
assert.equal(
  replaced,
  'network_cmd_enable = "true"\r\nnetwork_cmd_port = "55355"\r\nvideo_driver = "gl"\r\n'
)

const duplicate = upsertRetroArchNetworkCommands(
  'network_cmd_enable = "true"\nnetwork_cmd_enable = "false"\n'
)
assert.equal(
  duplicate,
  'network_cmd_enable = "true"\nnetwork_cmd_enable = "true"\nnetwork_cmd_port = "55355"\n'
)

const created = upsertRetroArchNetworkCommands('')
assert.equal(created, 'network_cmd_enable = "true"\nnetwork_cmd_port = "55355"\n')

// No crear un cfg portable si el usuario ya tiene el de AppData.
assert.deepEqual(
  selectRetroArchConfigPath({
    besideConfigPath: 'C:\\RetroArch\\retroarch.cfg',
    besideConfigExists: false,
    appDataConfigPath: 'C:\\Users\\me\\AppData\\Roaming\\RetroArch\\retroarch.cfg',
    appDataConfigExists: true,
    portableLayout: true
  }),
  {
    path: 'C:\\Users\\me\\AppData\\Roaming\\RetroArch\\retroarch.cfg',
    create: false
  }
)
assert.deepEqual(
  selectRetroArchConfigPath({
    besideConfigPath: 'C:\\RetroArch\\retroarch.cfg',
    besideConfigExists: true,
    appDataConfigPath: 'C:\\Users\\me\\AppData\\Roaming\\RetroArch\\retroarch.cfg',
    appDataConfigExists: true,
    portableLayout: false
  })?.path,
  'C:\\RetroArch\\retroarch.cfg'
)

// Eco UDP local: GET_STATUS tiene que volver con la respuesta del servidor.
const server = createSocket('udp4')
const port = await new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.on('message', (message, remote) => {
    const text = message.toString('utf8')
    if (text === 'GET_STATUS') {
      server.send('GET_STATUS PAUSED nes,mario,crc32=AABBCCDD', remote.port, remote.address)
    }
  })
  server.bind(0, '127.0.0.1', () => {
    const address = server.address()
    resolve(typeof address === 'string' ? 0 : address.port)
  })
})

try {
  const status = await sendRetroArchUdp('GET_STATUS', { port, timeoutMs: 1000 })
  assert.equal(status.ok, true, status.error)
  assert.equal(status.reply, 'GET_STATUS PAUSED nes,mario,crc32=AABBCCDD')
  assert.equal(parseStatus(status.reply ?? '').playback, 'PAUSED')

  const silent = await sendRetroArchUdp('SAVE_STATE', { port, timeoutMs: 200 })
  assert.equal(silent.ok, true)
  assert.equal(silent.reply, null)

  const quiet = createSocket('udp4')
  const quietPort = await new Promise<number>((resolve, reject) => {
    quiet.once('error', reject)
    quiet.bind(0, '127.0.0.1', () => {
      const address = quiet.address()
      resolve(typeof address === 'string' ? 0 : address.port)
    })
  })
  try {
    const timedOut = await sendRetroArchUdp('GET_STATUS', { port: quietPort, timeoutMs: 200 })
    assert.equal(timedOut.ok, false)
    assert.equal(timedOut.error, 'timeout')
  } finally {
    quiet.close()
  }
} finally {
  server.close()
}

console.log('retro pause menu checks passed')

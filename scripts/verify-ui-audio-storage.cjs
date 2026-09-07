const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { app } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'ui-audio-storage')
const profile = path.join(output, 'profile')
const audioDirectory = path.join(profile, 'ui-audio')
const bundle = path.join(output, 'service.mjs')
const storedName = 'navigate-0123456789abcdef.wav'

function waveBuffer() {
  const wave = Buffer.alloc(64)
  wave.write('RIFF', 0)
  wave.writeUInt32LE(56, 4)
  wave.write('WAVE', 8)
  return wave
}

async function main() {
  await fs.rm(profile, { recursive: true, force: true })
  await fs.mkdir(audioDirectory, { recursive: true })
  app.setPath('userData', profile)
  await app.whenReady()
  await build({
    entryPoints: [path.join(output, 'entry.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['electron'],
    tsconfig: path.join(root, 'tsconfig.node.json'),
    logLevel: 'warning'
  })

  const storedPath = path.join(audioDirectory, storedName)
  await fs.writeFile(storedPath, waveBuffer())
  await fs.writeFile(path.join(audioDirectory, 'confirm.wav'), Buffer.from('RIFF-invalid'))
  await fs.writeFile(path.join(audioDirectory, 'open.wav'), waveBuffer())
  await fs.writeFile(
    path.join(audioDirectory, 'manifest.json'),
    JSON.stringify({
      navigate: { fileName: storedName, displayName: 'Navigation.wav' },
      confirm: { fileName: 'confirm.wav', displayName: 'Broken.wav' },
      open: { fileName: 'open.wav', displayName: 'Legacy open.wav' }
    })
  )

  const { customUiAudioService, orbitPlusService } = await import(
    `${pathToFileURL(bundle).href}?run=${Date.now()}`
  )
  orbitPlusService.hasFeature = () => true
  const resolved = await customUiAudioService.resolveAll()
  assert.equal(resolved.navigate?.name, 'Navigation.wav')
  assert.match(resolved.navigate?.url ?? '', /^orbit-media:\/\/ui-audio\/navigate\/navigate-[a-f0-9]{16}\.wav\?version=/u)
  assert.equal(resolved.confirm, undefined, 'A stored file with an invalid signature must be ignored')
  assert.equal(resolved.open?.name, 'Legacy open.wav', 'Legacy cue filenames must remain compatible')
  assert.equal(
    await customUiAudioService.resolveRequestPath(resolved.navigate.url),
    await fs.realpath(storedPath)
  )
  assert.equal(
    await customUiAudioService.resolveRequestPath(`orbit-media://ui-audio/confirm/${storedName}`),
    null,
    'The URL cue must match the manifest cue'
  )
  assert.equal(
    await customUiAudioService.resolveRequestPath('orbit-media://ui-audio/navigate/%2e%2e%2foutside.wav'),
    null,
    'Encoded traversal must not resolve'
  )

  let symlinkChecked = false
  const outsidePath = path.join(profile, 'outside.wav')
  const symlinkPath = path.join(audioDirectory, 'back.wav')
  await fs.writeFile(outsidePath, waveBuffer())
  try {
    await fs.symlink(outsidePath, symlinkPath, 'file')
    await fs.writeFile(
      path.join(audioDirectory, 'manifest.json'),
      JSON.stringify({ back: { fileName: 'back.wav', displayName: 'Outside.wav' } })
    )
    assert.deepEqual(await customUiAudioService.resolveAll(), {})
    symlinkChecked = true
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error
  }

  orbitPlusService.hasFeature = () => false
  assert.equal(
    await customUiAudioService.resolveRequestPath(resolved.navigate.url),
    null,
    'The media protocol must close immediately when ORBIT Plus access is absent'
  )
  console.log(`Custom UI audio storage checks passed: signatures, legacy manifests, manifest binding, traversal, premium gate${symlinkChecked ? ', symlinks' : ''}.`)
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

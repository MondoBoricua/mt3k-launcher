// Stamps an MT3K Launcher release version (vX.Y.Z-mt3k.N) into the files the
// build reads: package.json, the MT3K release manifest and the MT3K builder config.
import { readFileSync, writeFileSync } from 'node:fs'

const input = (process.argv[2] ?? '').trim().replace(/^refs\/tags\//, '').replace(/^v/, '')
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-mt3k\.(0|[1-9]\d*)$/.exec(input)
if (!match) {
  console.error(`Invalid MT3K version "${process.argv[2] ?? ''}". Expected vX.Y.Z-mt3k.N.`)
  process.exit(1)
}
const [, major, minor, patch, revision] = match
const version = input
const windowsVersion = `${major}.${minor}.${patch}.${revision}`

const writeJson = (file, update) => {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  update(data)
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

writeJson('package.json', (data) => {
  data.version = version
})
writeJson('resources/release-manifest.mt3k.json', (data) => {
  data.displayVersion = version
  data.packageVersion = version
  data.windowsFileVersion = windowsVersion
})

const builderFile = 'electron-builder.mt3k.yml'
const builder = readFileSync(builderFile, 'utf8')
const stamped = builder
  .replace(/^buildVersion: .*$/m, `buildVersion: ${windowsVersion}`)
  .replace(/^  uninstallDisplayName: .*$/m, `  uninstallDisplayName: MT3K Launcher ${version}`)
if (!/^buildVersion: /m.test(stamped)) throw new Error('buildVersion missing from electron-builder.mt3k.yml')
writeFileSync(builderFile, stamped)

console.log(`Stamped MT3K version ${version} (Windows ${windowsVersion})`)

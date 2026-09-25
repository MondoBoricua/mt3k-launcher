import assert from 'node:assert/strict'
import {
  communityUpdateAssetName,
  communityAutoDownloadEnabled,
  communityPackageHelperCommandLine,
  legacyCommunityUpdateAssetName,
  wmiCreateProcessScript,
  compareCommunityVersions,
  parseCommunityAppUpdateRelease,
  parseGitHubAppUpdateRelease
} from '../src/shared/appUpdatePolicy.ts'

// Version ordering: a plain build is revision 0; the core version wins first
assert.equal(compareCommunityVersions('0.1.4-mt3k.4', '0.1.4-mt3k.3') > 0, true)
assert.equal(compareCommunityVersions('0.1.4-mt3k.10', '0.1.4-mt3k.9') > 0, true)
assert.equal(compareCommunityVersions('0.1.4-mt3k.1', '0.1.4') > 0, true)
assert.equal(compareCommunityVersions('0.1.5-mt3k.1', '0.1.4-mt3k.99') > 0, true)
assert.equal(compareCommunityVersions('0.1.4-mt3k.3', '0.1.4-mt3k.3'), 0)
assert.equal(compareCommunityVersions('0.1.4-beta.1', '0.1.4'), null)
assert.equal(compareCommunityVersions('0.1.4-mt3k.01', '0.1.4'), null)
assert.equal(compareCommunityVersions('v0.1.4-mt3k.1', '0.1.4'), null)

assert.equal(communityUpdateAssetName('0.1.4-mt3k.5', 'package'), 'MT3K-Launcher-App-0.1.4-mt3k.5-x64.zip')
assert.equal(communityUpdateAssetName('0.1.4-mt3k.5', 'installer'), 'MT3K-Launcher-Setup-0.1.4-mt3k.5-x64.exe')

const digest = (character: string): string => `sha256:${character.repeat(64)}`
function asset(id: number, name: string, digestValue: string, size = 120_000_000): Record<string, unknown> {
  return {
    id,
    name,
    size,
    state: 'uploaded',
    digest: digestValue,
    browser_download_url: `https://github.com/MondoBoricua/mt3k-launcher/releases/download/v0.1.4-mt3k.5/${name}`
  }
}
function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.1.4-mt3k.5',
    name: 'MT3K Launcher v0.1.4-mt3k.5',
    body: 'In-app updates.',
    html_url: 'https://github.com/MondoBoricua/mt3k-launcher/releases/tag/v0.1.4-mt3k.5',
    published_at: '2026-09-12T22:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      asset(1, 'MT3K-Launcher-Setup-0.1.4-mt3k.5-x64.exe', digest('a')),
      asset(2, 'MT3K-Launcher-App-0.1.4-mt3k.5-x64.zip', digest('b')),
      asset(3, 'SHA256SUMS.txt', digest('c'), 200)
    ],
    ...overrides
  }
}

const packageRelease = parseCommunityAppUpdateRelease(release(), 'package')
assert.ok(packageRelease)
assert.equal(packageRelease.version, '0.1.4-mt3k.5')
assert.equal(packageRelease.asset.name, 'MT3K-Launcher-App-0.1.4-mt3k.5-x64.zip')
assert.equal(packageRelease.asset.digest, 'b'.repeat(64))

const installerRelease = parseCommunityAppUpdateRelease(release(), 'installer')
assert.ok(installerRelease)
assert.equal(installerRelease.asset.name, 'MT3K-Launcher-Setup-0.1.4-mt3k.5-x64.exe')
assert.equal(installerRelease.asset.digest, 'a'.repeat(64))

// Rejections
assert.equal(parseCommunityAppUpdateRelease(release({ prerelease: true }), 'package'), null)
assert.equal(parseCommunityAppUpdateRelease(release({ draft: true }), 'package'), null)
assert.equal(parseCommunityAppUpdateRelease(release({ tag_name: 'v0.1.5' }), 'package'), null, 'upstream-style tags are ignored')
assert.equal(parseCommunityAppUpdateRelease(release({ tag_name: 'v0.1.4-beta.2' }), 'package'), null)
assert.equal(
  parseCommunityAppUpdateRelease(release({ assets: [asset(2, 'MT3K-Launcher-App-0.1.4-mt3k.5-x64.zip', 'md5:abc')] }), 'package'),
  null,
  'a release asset without a SHA-256 digest is rejected'
)
assert.equal(
  parseCommunityAppUpdateRelease(release({ assets: [asset(2, 'MT3K-Launcher-App-0.1.4-mt3k.4-x64.zip', digest('b'))] }), 'package'),
  null,
  'an asset for another version is rejected'
)
assert.equal(
  parseCommunityAppUpdateRelease(
    release({
      assets: [{ ...asset(2, 'MT3K-Launcher-App-0.1.4-mt3k.5-x64.zip', digest('b')), browser_download_url: 'https://evil.example.com/a.zip' }]
    }),
    'package'
  ),
  null,
  'downloads must come from github.com'
)
assert.equal(
  parseCommunityAppUpdateRelease(release({ html_url: 'https://evil.example.com/release' }), 'package'),
  null
)

// The upstream stable parser keeps ignoring community tags and assets
assert.equal(parseGitHubAppUpdateRelease(release(), 'stable'), null)


// Rename compatibility: releases before MT3K Launcher only carry ORBIT-MT3K names,
// newer releases carry both and the MT3K-Launcher asset wins.
assert.equal(legacyCommunityUpdateAssetName('0.1.4-mt3k.5', 'package'), 'ORBIT-MT3K-App-0.1.4-mt3k.5-x64.zip')
assert.equal(legacyCommunityUpdateAssetName('0.1.4-mt3k.5', 'installer'), 'ORBIT-MT3K-Setup-0.1.4-mt3k.5-x64.exe')
const legacyOnly = parseCommunityAppUpdateRelease(release({ assets: [asset(3, 'ORBIT-MT3K-App-0.1.4-mt3k.5-x64.zip', digest('c'))] }), 'package')
assert.equal(legacyOnly?.asset.name, 'ORBIT-MT3K-App-0.1.4-mt3k.5-x64.zip', 'legacy-only release still resolves')
const bothNames = parseCommunityAppUpdateRelease(
  release({ assets: [asset(3, 'ORBIT-MT3K-Setup-0.1.4-mt3k.5-x64.exe', digest('c')), asset(4, 'MT3K-Launcher-Setup-0.1.4-mt3k.5-x64.exe', digest('d'))] }),
  'installer'
)
assert.equal(bothNames?.asset.name, 'MT3K-Launcher-Setup-0.1.4-mt3k.5-x64.exe', 'new asset name is preferred')
assert.equal(bothNames?.asset.digest, 'd'.repeat(64))


// Xbox Mode helper launch through WMI: exact quoting, no injection through paths.
const commandLine = communityPackageHelperCommandLine({
  powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  helperPath: 'C:\\Users\\Pana Gamer\\AppData\\Roaming\\ORBIT\\app-updates\\orbit-mt3k-package-update-x.ps1',
  processId: 4242,
  zipPath: 'C:\\Users\\Pana Gamer\\AppData\\Roaming\\ORBIT\\app-updates\\MT3K-Launcher-App-0.1.4-mt3k.13-x64.zip',
  appDirectory: 'C:\\Users\\Pana Gamer\\AppData\\Local\\ORBIT-MT3K-XboxMode\\app',
  packageRoot: 'C:\\Users\\Pana Gamer\\AppData\\Local\\ORBIT-MT3K-XboxMode',
  logPath: 'C:\\Users\\Pana Gamer\\AppData\\Roaming\\ORBIT\\app-updates\\orbit-mt3k-package-update.log'
})
assert.match(commandLine, /^"C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\\Users\\Pana Gamer\\/u)
assert.match(commandLine, / -ProcessId 4242 -ZipPath "[^"]+\.zip" -AppDir "[^"]+\\app" -PackageRoot "[^"]+XboxMode" -LogPath "[^"]+\.log"$/u)
assert.throws(() => communityPackageHelperCommandLine({ powershellPath: 'p', helperPath: 'x" & calc', processId: 1, zipPath: 'z', appDirectory: 'a', packageRoot: 'r', logPath: 'l' }), /Unsafe path/u)
assert.throws(() => communityPackageHelperCommandLine({ powershellPath: 'p', helperPath: 'h', processId: -1, zipPath: 'z', appDirectory: 'a', packageRoot: 'r', logPath: 'l' }), /Invalid process id/u)
const script = wmiCreateProcessScript(`"C:\\O'Neil\\powershell.exe" -File "h"`)
assert.ok(script.includes("CommandLine = '\"C:\\O''Neil\\powershell.exe\" -File \"h\"'"), 'single quotes are doubled inside the PowerShell literal')
assert.ok(script.startsWith('$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create'))
assert.ok(script.includes('[Console]::Out.Write([string]$r.ProcessId)'))


// Community auto-download: manifest default until the user decides.
assert.equal(communityAutoDownloadEnabled(undefined, false), false)
assert.equal(communityAutoDownloadEnabled(undefined, true), true)
assert.equal(communityAutoDownloadEnabled(true, false), true)
assert.equal(communityAutoDownloadEnabled(false, true), false)

console.log('MT3K community update policy checks passed')

import { app } from 'electron'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, renameSync, rmdirSync } from 'node:fs'
import { canMigrateProfile, migrateUserData, recoverVirtualizedUserData } from './renameMigrationPolicy'

// Snapshot before refresh: changing the manifest on disk does not change this
// process's identity/virtualization. Only the next activation may migrate.
const packageIdentity = process.platform === 'win32' && process.windowsStore === true
let manifest: string | undefined
if (packageIdentity) {
  try { manifest = readFileSync(join(dirname(dirname(process.execPath)), 'AppxManifest.xml'), 'utf8') }
  catch { /* Missing/unreadable manifests must defer both migrations. */ }
}
export const profileMigrationAllowed = canMigrateProfile(packageIdentity, manifest)
const oldPath = join(app.getPath('appData'), app.isPackaged ? 'ORBIT' : 'orbit')
const newPath = join(app.getPath('appData'), app.isPackaged ? 'MT3K Launcher' : 'mt3k-launcher')
// The family is fixed by MT3K's publisher and identity, not the version/stage.
const privatePath = process.platform === 'win32' && app.isPackaged && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Packages', 'MT3K.OrbitGamingHome_zf1xqhjm405p0', 'LocalCache', 'Roaming', 'MT3K Launcher')
  : undefined

// First import in index.ts, before any consumer opens Chromium/store data.
export const userDataMigration = (privatePath
  ? recoverVirtualizedUserData(privatePath, newPath, profileMigrationAllowed, { existsSync, renameSync })
  : undefined) ?? migrateUserData(oldPath, newPath, { existsSync, renameSync, rmdirSync }, profileMigrationAllowed)
app.setPath('userData', userDataMigration.path)

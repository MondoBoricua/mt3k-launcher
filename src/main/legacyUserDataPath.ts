import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, renameSync, rmdirSync } from 'node:fs'
import { migrateUserData } from './renameMigrationPolicy'

// First import in index.ts: move Chromium storage and every store together before
// any consumer resolves userData. Never copy/delete; a failed move retries next run.
export const userDataMigration = migrateUserData(
  join(app.getPath('appData'), app.isPackaged ? 'ORBIT' : 'orbit'),
  join(app.getPath('appData'), app.isPackaged ? 'MT3K Launcher' : 'mt3k-launcher'),
  { existsSync, renameSync, rmdirSync }
)
app.setPath('userData', userDataMigration.path)

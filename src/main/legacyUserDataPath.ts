import { app } from 'electron'
import { join } from 'path'

/**
 * MT3K Launcher keeps the data folder ORBIT created before the rename
 * (%APPDATA%\ORBIT when packaged, "orbit" in development), so libraries,
 * settings, caches and browser storage survive the update. index.ts imports
 * this module first because several services resolve userData at import time.
 */
const LEGACY_USER_DATA_NAME = app.isPackaged ? 'ORBIT' : 'orbit'

app.setPath('userData', join(app.getPath('appData'), LEGACY_USER_DATA_NAME))

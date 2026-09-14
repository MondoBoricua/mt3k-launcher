import assert from 'node:assert/strict'
import { isOrbitXboxStartupSelected, orbitStartsThroughXboxMode } from '../src/main/xboxModeStartup.ts'

const orbit = { startupToGamingHome: 1, gamingHomeApp: 'ORBIT.GamingHome_123456789abcd!ORBIT' }
assert.equal(isOrbitXboxStartupSelected(orbit), true)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: 'MT3K.OrbitGamingHome_zf1xqhjm405p0!ORBIT' }), true, 'MT3K Launcher Developer Mode package')
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: 'MT3K.OrbitGamingHome_zf1xqhjm405p0!Other' }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, startupToGamingHome: 0 }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, startupToGamingHome: undefined }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, disabledByPolicy: 1 }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: 'Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App' }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: 'GCM.ToolsForSteam.XboxHost_kpg9gzy2ksp2j!App' }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: 'ORBIT.GamingHome_123456789abcd!Other' }), false)
assert.equal(isOrbitXboxStartupSelected({ ...orbit, gamingHomeApp: '' }), false)
assert.equal(isOrbitXboxStartupSelected({}), false)
console.log('PASS: startup visibility for ORBIT, other launchers, disabled startup, policy and missing settings')
console.log('Current Windows configuration hides startup:', orbitStartsThroughXboxMode())

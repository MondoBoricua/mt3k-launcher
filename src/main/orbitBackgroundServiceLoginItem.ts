import { win32 } from 'node:path'
import { windowsLoginItemLookupPath } from './windowsStartupLoginItem'
import type { App } from 'electron'
import type { OrbitBackgroundServiceStatus } from '@shared/ipc'
import { ORBIT_AGENT_ARGUMENT } from './orbitServiceProtocol'
import { classifyWindowsLoginItem } from './orbitBackgroundServicePolicy'

export const ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME = 'ORBIT Background Service'

export function orbitBackgroundServiceLoginItemArguments(
  developmentAppPath?: string
): string[] {
  return developmentAppPath
    ? [developmentAppPath, ORBIT_AGENT_ARGUMENT]
    : [ORBIT_AGENT_ARGUMENT]
}

function quoteWindowsCommandArgument(value: string, always = false): string {
  if (!always && value.length > 0 && !/[\s"]/u.test(value)) return value
  return `"${value
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\+)$/u, '$1$1')}"`
}

/** Canonical command persisted by Electron's Windows login-item integration.
 * The executable is always quoted, matching Chromium's CommandLine serializer
 * and the command installed by ORBIT's NSIS cleanup contract. */
export function orbitBackgroundServiceLoginItemCommand(
  executablePath: string,
  developmentAppPath?: string
): string {
  return [
    quoteWindowsCommandArgument(executablePath, true),
    ...orbitBackgroundServiceLoginItemArguments(developmentAppPath).map((argument) =>
      quoteWindowsCommandArgument(argument)
    )
  ].join(' ')
}

export function getOrbitBackgroundServiceLoginItemInstallation(
  electronApp: Pick<App, 'getLoginItemSettings'>,
  executablePath: string,
  developmentAppPath?: string
): Pick<OrbitBackgroundServiceStatus, 'installation' | 'reason'> {
  const args = orbitBackgroundServiceLoginItemArguments(developmentAppPath)
  const settings = electronApp.getLoginItemSettings({ path: windowsLoginItemLookupPath(executablePath), args })
  const legacyPath = win32.join(win32.dirname(executablePath), 'ORBIT.exe')
  const legacyItems = legacyPath.toLowerCase() === executablePath.toLowerCase() ? [] :
    electronApp.getLoginItemSettings({ path: windowsLoginItemLookupPath(legacyPath), args }).launchItems
  const launchItems = [...settings.launchItems, ...legacyItems]
    .filter(item => item.name.toLowerCase() === ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME.toLowerCase())
  return classifyWindowsLoginItem(
    {
      openAtLogin: settings.openAtLogin,
      executableWillLaunchAtLogin: settings.executableWillLaunchAtLogin,
      launchItems: launchItems.map((item) => ({
        name: item.name,
        path: item.path,
        args: [...item.args],
        enabled: item.enabled,
        scope: item.scope
      }))
    },
    {
      name: ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME,
      path: executablePath,
      args
    }
  )
}

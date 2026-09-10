import { shell } from 'electron'
import type {
  LauncherDownloadActivity,
  LauncherDownloadControlAction,
  LauncherDownloadControlResult
} from '../../shared/ipc'
import { launcherDownloadControlActions } from '../../shared/launcherDownloads'
import { controlXboxProductInstall } from '../xbox/xboxInstallRequest'

function providerManagerUrl(activity: LauncherDownloadActivity): string {
  if (activity.provider === 'steam') return 'steam://open/downloads'
  if (activity.provider === 'epic') return 'com.epicgames.launcher://store/'
  return /^[A-Z0-9]{12}$/iu.test(activity.providerGameId)
    ? `msxbox://game/?productId=${activity.providerGameId.toUpperCase()}`
    : 'msxbox://'
}

export async function controlLauncherDownload(
  activity: LauncherDownloadActivity,
  action: LauncherDownloadControlAction
): Promise<LauncherDownloadControlResult> {
  if (!launcherDownloadControlActions(activity).includes(action)) {
    return { state: 'unsupported' }
  }

  if (activity.provider === 'xbox' && action !== 'open-provider') {
    const accepted = await controlXboxProductInstall(activity.providerGameId, action)
    if (accepted) return { state: 'accepted' }
  }

  if (activity.provider === 'steam' && action === 'cancel') {
    const appId = Number(activity.providerGameId)
    if (Number.isSafeInteger(appId) && appId > 0) {
      await shell.openExternal(`steam://uninstall/${appId}`)
      return { state: 'provider-opened' }
    }
  }

  await shell.openExternal(providerManagerUrl(activity))
  return { state: 'provider-opened' }
}

import koffi, { type KoffiFunc } from 'koffi'

interface XboxStartupConfiguration {
  startupToGamingHome?: number
  gamingHomeApp?: string
  disabledByPolicy?: number
}

export function isOrbitXboxStartupSelected(configuration: XboxStartupConfiguration): boolean {
  return configuration.startupToGamingHome === 1 &&
    !configuration.disabledByPolicy &&
    /^ORBIT\.GamingHome_[a-z0-9]{13}!ORBIT$/i.test(configuration.gamingHomeApp?.trim() ?? '')
}

const configurationKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\GamingConfiguration'
const policyKey = 'SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Games'
type RegGetValueFunction = KoffiFunc<(
  root: number,
  key: string,
  name: string,
  flags: number,
  reserved: null,
  data: Buffer,
  size: number[]
) => number>

let regGetValue: RegGetValueFunction | undefined
let expiresAt = 0
let selected = false

function readValue(root: number, key: string, name: string, stringValue = false): string | number | undefined {
  regGetValue ??= koffi.load('advapi32.dll').func(
    'int32_t __stdcall RegGetValueW(intptr_t, str16, str16, uint32_t, void *, void *, _Inout_ uint32_t *)'
  ) as RegGetValueFunction
  const data = Buffer.alloc(stringValue ? 2048 : 4)
  const size = [data.length]
  const result = regGetValue(root, key, name, stringValue ? 2 : 16, null, data, size)
  if (result === 2) return undefined // Absent settings/policies are normal.
  if (result !== 0) throw new Error(`Xbox configuration read failed (${result})`)
  return stringValue ? data.subarray(0, size[0]).toString('utf16le').replace(/\0+$/u, '') : data.readUInt32LE(0)
}

/** Read-only and cached: controller status events must not repeatedly query Windows.
 * Unknown/unreadable configuration keeps the ordinary startup option visible. */
export function orbitStartsThroughXboxMode(): boolean {
  if (process.platform !== 'win32') return false
  if (Date.now() < expiresAt) return selected
  expiresAt = Date.now() + 2000
  try {
    selected = isOrbitXboxStartupSelected({
      startupToGamingHome: readValue(-2147483647, configurationKey, 'StartupToGamingHome') as number | undefined,
      gamingHomeApp: readValue(-2147483647, configurationKey, 'GamingHomeApp', true) as string | undefined,
      disabledByPolicy: readValue(-2147483646, policyKey, 'DisableGamingFullScreenExperience') as number | undefined
    })
  } catch {
    selected = false
  }
  return selected
}

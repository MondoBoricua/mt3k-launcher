/**
 * Readback helpers for ORBIT's "Start with Windows" login item.
 *
 * Electron's Windows readback (verified on Electron 43 / Windows 11) has two quirks:
 * - `getLoginItemSettings({ path })` parses `path` as a command line, so an
 *   unquoted executable path containing spaces never matches its own entry;
 * - the reported `args` come from Chromium's CommandLine, which drops switches
 *   such as `--orbit-background` and keeps only positional arguments.
 */
export interface StartupLaunchItem {
  name: string
  path: string
  args: readonly string[]
  enabled: boolean
}

export interface StartupLoginItemExpectation {
  name: string
  path: string
  args: readonly string[]
}

/** Quote the executable so paths such as C:\Program Files\ORBIT\ORBIT.exe resolve as one program. */
export function windowsLoginItemLookupPath(executablePath: string): string {
  return `"${executablePath.replace(/"/gu, '')}"`
}

const WINDOWS_SWITCH_PREFIX = /^[-/]/u

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function startupLoginItemIsActive(
  items: readonly StartupLaunchItem[],
  expected: StartupLoginItemExpectation
): boolean {
  const positional = expected.args.filter((argument) => !WINDOWS_SWITCH_PREFIX.test(argument))
  return items.some(
    (item) =>
      item.enabled &&
      item.name.toLowerCase() === expected.name.toLowerCase() &&
      item.path.toLowerCase() === expected.path.toLowerCase() &&
      (sameArguments(item.args, expected.args) || sameArguments(item.args, positional))
  )
}

/** Explicitly owned registry names only. Preserve disabled state during rename. */
export function startupLoginItemsNeedingMigration(
  items: readonly StartupLaunchItem[], expected: StartupLoginItemExpectation
): StartupLaunchItem[] {
  return items.filter(item =>
    ['orbit', expected.name.toLowerCase()].includes(item.name.toLowerCase()) &&
    (item.name.toLowerCase() !== expected.name.toLowerCase() || item.path.toLowerCase() !== expected.path.toLowerCase())
  )
}

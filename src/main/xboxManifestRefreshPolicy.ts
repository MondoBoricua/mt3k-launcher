/** Never terminate the launcher unless Windows confirmed a detached helper PID. */
export async function launchXboxManifestRefresh(
  launch: () => Promise<{ stdout: string }>, quit: () => void
): Promise<void> {
  const result = await launch()
  if (!/^[1-9]\d*$/.test(result.stdout.trim())) throw new Error('WMI returned no refresh process ID')
  quit()
}

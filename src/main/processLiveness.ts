/**
 * Uses the operating system's PID table as the final lifetime check. Signal 0
 * never terminates the process; EPERM means the process exists but is protected.
 */
export function processIdStillExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function livingProcessRecords<T extends { ProcessId?: number }>(
  records: readonly T[]
): T[] {
  return records.filter(
    (record) =>
      Number.isInteger(record.ProcessId) &&
      processIdStillExists(record.ProcessId as number)
  )
}

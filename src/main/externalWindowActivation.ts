import { execFile } from 'node:child_process'
import { win32 as path } from 'node:path'

const WINDOWS_POWERSHELL_PATH = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Waits for the visible top-level window of a Windows process (or one of its
 * descendants) and hands it the foreground focus. Chromium frequently moves
 * an app-mode window into a child process after the initial spawn.
 */
export function activateExternalProcessWindow(
  rootProcessId: number,
  timeoutMs = 7_500
): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(rootProcessId) || rootProcessId <= 0) {
    return Promise.resolve(false)
  }

  const safeTimeoutMs = Math.min(Math.max(Math.trunc(timeoutMs), 500), 15_000)
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$rootProcessId = ${rootProcessId}
$deadline = [DateTime]::UtcNow.AddMilliseconds(${safeTimeoutMs})

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OrbitExternalWindowActivation {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint source, uint target, bool attach);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

  public static bool Activate(IntPtr window) {
    if (window == IntPtr.Zero) return false;

    IntPtr foreground = GetForegroundWindow();
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint targetThread = GetWindowThreadProcessId(window, IntPtr.Zero);
    bool foregroundAttached = foregroundThread != 0 && foregroundThread != currentThread &&
      AttachThreadInput(currentThread, foregroundThread, true);
    bool targetAttached = targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread &&
      AttachThreadInput(currentThread, targetThread, true);

    try {
      AllowSetForegroundWindow(-1);
      ShowWindowAsync(window, 9);
      BringWindowToTop(window);
      SetForegroundWindow(window);
      SetActiveWindow(window);
      SetFocus(window);
      return GetForegroundWindow() == window;
    } finally {
      if (targetAttached) AttachThreadInput(currentThread, targetThread, false);
      if (foregroundAttached) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
}
'@

function Find-OrbitExternalWindow([int]$rootId) {
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  $null = $ids.Add($rootId)
  $rows = @(Get-CimInstance Win32_Process)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($row in $rows) {
      if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) {
        $changed = $true
      }
    }
  }

  foreach ($processId in $ids) {
    $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -ne $candidate) {
      $candidate.Refresh()
      if ($candidate.MainWindowHandle -ne 0) { return $candidate.MainWindowHandle }
    }
  }
  return [IntPtr]::Zero
}

while ([DateTime]::UtcNow -lt $deadline) {
  $window = Find-OrbitExternalWindow $rootProcessId
  if ($window -ne [IntPtr]::Zero -and [OrbitExternalWindowActivation]::Activate($window)) {
    [Console]::Out.Write('ORBIT_FOCUSED')
    exit 0
  }
  Start-Sleep -Milliseconds 125
}
exit 1
`

  return new Promise((resolve) => {
    execFile(
      WINDOWS_POWERSHELL_PATH,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: safeTimeoutMs + 2_000,
        maxBuffer: 1_024
      },
      (error, stdout) => resolve(!error && stdout.includes('ORBIT_FOCUSED'))
    )
  })
}

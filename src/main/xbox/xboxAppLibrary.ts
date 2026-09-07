import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameMetadata, GameSubscription } from '@shared/ipc'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'
import { normalizeXboxTitleId } from './xboxTitleIdentity'

const XBOX_APP_PACKAGE_FAMILY = 'Microsoft.GamingApp_8wekyb3d8bbwe'
const XBOX_APP_CACHE_TIMEOUT_MS = 45_000
const MAX_CACHE_OUTPUT_BYTES = 16 * 1024 * 1024
const XBOX_APP_LIBRARY_CACHE_VERSION = 3
const XBOX_APP_LIBRARY_CACHE_FILE = 'orbit-xbox-app-library-scan-v1.json'
const MAX_XBOX_APP_LIBRARY_CACHE_BYTES = MAX_CACHE_OUTPUT_BYTES + 64 * 1024
const MAX_XBOX_APP_LIBRARY_GAMES = 10_000

interface FileFingerprint {
  size: number
  mtimeMs: number
}

export interface XboxAppCacheFingerprint {
  database: FileFingerprint
  wal?: FileFingerprint
}

interface PersistedXboxAppLibraryScan {
  version: number
  fingerprint: XboxAppCacheFingerprint
  payload: XboxAppCachePayload
}

export interface XboxAppLibraryScanOptions {
  /** ORBIT user-data directory. Without it the scan remains deliberately uncached. */
  cacheDirectory?: string
}

interface XboxAppCacheRecord {
  productId?: string
  title?: string
  description?: string
  developer?: string
  publisher?: string
  categories?: unknown
  releaseDate?: string
  packageFamilyName?: string
  titleId?: string
  verticalUrls?: unknown
  horizontalUrls?: unknown
  iconUrls?: unknown
  logoUrls?: unknown
}

interface XboxAppCachePayload {
  available?: boolean
  activeSubscription?: boolean
  subscriptions?: unknown
  complete?: boolean
  eligibleProductCount?: number
  resolvedProductCount?: number
  unresolvedProductCount?: number
  unresolvedProductIds?: unknown
  games?: XboxAppCacheRecord[]
}

export interface XboxAppGame {
  providerGameId: string
  name: string
  packageFamilyName?: string
  metadata: GameMetadata
}

export interface XboxAppLibrarySnapshot {
  available: boolean
  activeSubscription: boolean
  subscriptions: GameSubscription[]
  complete: boolean
  reusedScanCache: boolean
  eligibleProductCount: number
  resolvedProductCount: number
  unresolvedProductCount: number
  unresolvedProductIds: string[]
  games: Map<string, XboxAppGame>
  byPackageFamilyName: Map<string, XboxAppGame>
}

// The Xbox app keeps catalog/product data in this SQLite cache. The query is
// deliberately scoped to collections and product summaries; identity, WebView
// storage, cookies and tokens are never opened. `immutable=1` gives us a safe
// read-only snapshot even while the Xbox app is running.
const XBOX_APP_CACHE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$databasePath = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.GamingApp_8wekyb3d8bbwe\LocalState\AsyncCache.db'
if (-not (Test-Path -LiteralPath $databasePath)) {
  [pscustomobject]@{ available = $false; activeSubscription = $false; subscriptions = @(); complete = $false; eligibleProductCount = 0; resolvedProductCount = 0; unresolvedProductCount = 0; unresolvedProductIds = @(); games = @() } |
    ConvertTo-Json -Compress
  exit 0
}

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class OrbitXboxSqliteReader
{
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sqlite3_open_v2(string file, out IntPtr database, int flags, IntPtr vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sqlite3_prepare_v2(IntPtr database, string sql, int bytes, out IntPtr statement, IntPtr tail);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_step(IntPtr statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_finalize(IntPtr statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(IntPtr database);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr sqlite3_column_text(IntPtr statement, int column);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_column_bytes(IntPtr statement, int column);

    private static string ReadText(IntPtr statement, int column)
    {
        var pointer = sqlite3_column_text(statement, column);
        var length = sqlite3_column_bytes(statement, column);
        if (pointer == IntPtr.Zero || length <= 0) return string.Empty;
        var bytes = new byte[length];
        Marshal.Copy(pointer, bytes, 0, length);
        return Encoding.UTF8.GetString(bytes);
    }

    public static string[][] ReadScope(string path, string scope)
    {
        IntPtr database;
        var uri = "file:///" + path.Replace('\\', '/') + "?mode=ro&immutable=1";
        if (sqlite3_open_v2(uri, out database, 65, IntPtr.Zero) != 0)
            throw new InvalidOperationException("Xbox cache could not be opened read-only.");
        var rows = new List<string[]>();
        IntPtr statement = IntPtr.Zero;
        try
        {
            var escaped = scope.Replace("'", "''");
            var sql = "select key, value from AsyncCache where scope='" + escaped + "'";
            if (sqlite3_prepare_v2(database, sql, -1, out statement, IntPtr.Zero) != 0)
                throw new InvalidOperationException("Xbox cache query could not be prepared.");
            while (sqlite3_step(statement) == 100)
                rows.Add(new[] { ReadText(statement, 0), ReadText(statement, 1) });
            return rows.ToArray();
        }
        finally
        {
            if (statement != IntPtr.Zero) sqlite3_finalize(statement);
            sqlite3_close(database);
        }
    }
}
'@

function Get-Urls([object[]]$artwork, [string[]]$purposes) {
  $result = @()
  foreach ($purpose in $purposes) {
    $result += @($artwork |
      Where-Object { $_.purpose -eq $purpose -and ([string]$_.uri).StartsWith('https://') } |
      Sort-Object { ([long]$_.width) * ([long]$_.height) } -Descending |
      ForEach-Object { [string]$_.uri })
  }
  return @($result | Select-Object -Unique)
}

$subscriptionRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'game_subscriptions_info')
$subscriptionRow = $subscriptionRows | Where-Object { $_[0] -eq '' } | Select-Object -First 1
$subscriptionData = if ($subscriptionRow) { ($subscriptionRow[1] | ConvertFrom-Json).products.data } else { $null }

$userRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'user_subscriptions')
$userRow = $userRows | Where-Object { $_[0] -eq 'subscriptions' } | Select-Object -First 1
$activeProductIds = @()
if ($userRow) {
  $accounts = $userRow[1] | ConvertFrom-Json
  foreach ($account in $accounts.PSObject.Properties.Value) {
    $activeProductIds += @($account.PSObject.Properties.Value |
      Where-Object { $_.isActive -eq $true -and $_.passStatus -eq 'Active' } |
      ForEach-Object { [string]$_.productId })
  }
}

$productRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'product_summary')
$products = @{}
foreach ($row in $productRows) {
  try {
    $data = ($row[1] | ConvertFrom-Json).data
    if ($data -and $data.StoreId) { $products[[string]$data.StoreId] = $data }
  } catch {}
}

# Newer Xbox app builds keep the Store-ID-to-package-family relation in a
# dedicated cache scope even when product_summary omits alternateIds.
$packageFamilyByStoreId = @{}
$packageFamilyRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'product_altid_pfn')
foreach ($row in $packageFamilyRows) {
  try {
    $packageFamilyName = ([string]$row[0]).Trim()
    $storeId = ([string](($row[1] | ConvertFrom-Json).data)).Trim().ToUpperInvariant()
    if ($packageFamilyName -match '^[A-Za-z0-9.-]+_[A-Za-z0-9]+$' -and $storeId -match '^[A-Z0-9]{12}$') {
      $packageFamilyByStoreId[$storeId] = $packageFamilyName
    }
  } catch {}
}

# Current Xbox app builds no longer retain subscription products in the
# product_summary scope. The signed-in subscription records themselves remain
# authoritative and already expose active/pass status. Restrict the imported
# catalog to PC entitlements; console-only relations must not appear in ORBIT.
$hasActiveSubscription = $activeProductIds.Count -gt 0
$allowedPlans = @('GPPC', 'NAKUTOMIPC')

$eligibleProductIds = @()
$gamesByProductId = @{}
$unresolvedProductCount = 0
$unresolvedProductIds = @()
if ($hasActiveSubscription -and $subscriptionData) {
  foreach ($relationProperty in $subscriptionData.PSObject.Properties) {
    $storeId = ([string]$relationProperty.Name).Trim().ToUpperInvariant()
    if ($storeId -notmatch '^[A-Z0-9]{12}$') { continue }
    $included = $false
    foreach ($plan in $allowedPlans) {
      $planProperty = $relationProperty.Value.subscriptions.PSObject.Properties[$plan]
      if ($planProperty -and $planProperty.Value.included -eq $true) { $included = $true; break }
    }
    if (-not $included) { continue }
    $eligibleProductIds += $storeId
    $data = $products[$storeId]
    if (-not $data) { $unresolvedProductCount++; $unresolvedProductIds += $storeId; continue }
    if ($data.productKind -ne 'GAME' -or -not (@($data.availablePlatforms) -contains 'PC')) { continue }
    $title = ([string]$data.title).Trim()
    if (-not $title) { $unresolvedProductCount++; $unresolvedProductIds += $storeId; continue }

    $packageFamilyName = @($data.alternateIds |
      Where-Object { $_.idType -eq 'PACKAGEFAMILYNAME' } |
      ForEach-Object { [string]$_.id } |
      Select-Object -First 1)[0]
    if (-not $packageFamilyName) { $packageFamilyName = $packageFamilyByStoreId[$storeId] }
    $titleId = @($data.alternateIds |
      Where-Object { $_.idType -in @('XBOXTITLEID', 'TITLEID') } |
      ForEach-Object { [string]$_.id } |
      Select-Object -First 1)[0]
    $verticalUrls = Get-Urls @($data.artwork) @('POSTER', 'BRANDEDKEYART')
    $horizontalUrls = Get-Urls @($data.artwork) @('SUPERHEROART', 'TITLEDHEROART')
    $iconUrls = Get-Urls @($data.artwork) @('BOXART', 'SQUARE', 'ICON')
    $logoUrls = Get-Urls @($data.artwork) @('LOGO')
    $gamesByProductId[$storeId] = [pscustomobject]@{
      productId = $storeId
      title = $title
      description = [string]$data.shortDescription
      developer = [string]$data.developer
      publisher = [string]$data.publisher
      categories = @($data.categories | ForEach-Object { [string]$_ })
      releaseDate = [string]$data.releaseDate
      packageFamilyName = $packageFamilyName
      titleId = $titleId
      verticalUrls = $verticalUrls
      horizontalUrls = $horizontalUrls
      iconUrls = $iconUrls
      logoUrls = $logoUrls
    }
  }
}

[pscustomobject]@{
  available = $true
  activeSubscription = $hasActiveSubscription
  subscriptions = if ($hasActiveSubscription) { @('xbox-game-pass') } else { @() }
  complete = $hasActiveSubscription -and $subscriptionData -and $unresolvedProductCount -eq 0
  eligibleProductCount = @($eligibleProductIds | Select-Object -Unique).Count
  resolvedProductCount = $gamesByProductId.Count
  unresolvedProductCount = $unresolvedProductCount
  unresolvedProductIds = @($unresolvedProductIds | Select-Object -Unique)
  games = @($gamesByProductId.Values)
} | ConvertTo-Json -Depth 7 -Compress
`

function cachePath(): string {
  return join(
    process.env.LOCALAPPDATA ?? '',
    'Packages',
    XBOX_APP_PACKAGE_FAMILY,
    'LocalState',
    'AsyncCache.db'
  )
}

function persistedScanPath(cacheDirectory: string): string {
  return join(cacheDirectory, XBOX_APP_LIBRARY_CACHE_FILE)
}

async function fileFingerprint(path: string): Promise<FileFingerprint | undefined> {
  try {
    const details = await stat(path)
    return details.isFile() ? { size: details.size, mtimeMs: details.mtimeMs } : undefined
  } catch {
    return undefined
  }
}

async function xboxAppCacheFingerprint(path: string): Promise<XboxAppCacheFingerprint | undefined> {
  const database = await fileFingerprint(path)
  if (!database) return undefined
  const wal = await fileFingerprint(`${path}-wal`)
  return wal ? { database, wal } : { database }
}

function sameFileFingerprint(
  left: FileFingerprint | undefined,
  right: FileFingerprint | undefined
): boolean {
  return left?.size === right?.size && left?.mtimeMs === right?.mtimeMs
}

export function sameXboxAppCacheFingerprint(
  left: XboxAppCacheFingerprint | undefined,
  right: XboxAppCacheFingerprint | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      sameFileFingerprint(left.database, right.database) &&
      sameFileFingerprint(left.wal, right.wal)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isXboxAppCachePayload(value: unknown): value is XboxAppCachePayload {
  return (
    isObject(value) &&
    typeof value.available === 'boolean' &&
    typeof value.activeSubscription === 'boolean' &&
    typeof value.complete === 'boolean' &&
    Array.isArray(value.games) &&
    value.games.length <= MAX_XBOX_APP_LIBRARY_GAMES
  )
}

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return (
    isObject(value) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mtimeMs === 'number' &&
    Number.isFinite(value.mtimeMs) &&
    value.mtimeMs >= 0
  )
}

function isXboxAppCacheFingerprint(value: unknown): value is XboxAppCacheFingerprint {
  return (
    isObject(value) &&
    isFileFingerprint(value.database) &&
    (value.wal === undefined || isFileFingerprint(value.wal))
  )
}

async function readPersistedScan(
  cacheDirectory: string,
  fingerprint: XboxAppCacheFingerprint
): Promise<XboxAppCachePayload | undefined> {
  const path = persistedScanPath(cacheDirectory)
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > MAX_XBOX_APP_LIBRARY_CACHE_BYTES) return undefined
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (
      !isObject(value) ||
      value.version !== XBOX_APP_LIBRARY_CACHE_VERSION ||
      !isXboxAppCacheFingerprint(value.fingerprint) ||
      !sameXboxAppCacheFingerprint(value.fingerprint, fingerprint) ||
      !isXboxAppCachePayload(value.payload)
    ) {
      return undefined
    }
    return value.payload
  } catch {
    return undefined
  }
}

async function persistScan(
  cacheDirectory: string,
  fingerprint: XboxAppCacheFingerprint,
  payload: XboxAppCachePayload
): Promise<void> {
  try {
    await mkdir(cacheDirectory, { recursive: true })
    const value: PersistedXboxAppLibraryScan = {
      version: XBOX_APP_LIBRARY_CACHE_VERSION,
      fingerprint,
      payload
    }
    const serialized = JSON.stringify(value)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_XBOX_APP_LIBRARY_CACHE_BYTES) return
    await writeFile(persistedScanPath(cacheDirectory), serialized, 'utf8')
  } catch {
    // A cache write must never turn library discovery into a startup failure.
  }
}

function runXboxAppCacheScan(): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_APP_CACHE_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: XBOX_APP_CACHE_TIMEOUT_MS,
        maxBuffer: MAX_CACHE_OUTPUT_BYTES
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolveOutput(stdout.trim())
      }
    )
  })
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function textArray(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const values = [...new Set(source.map(text).filter((item): item is string => Boolean(item)))]
  return values.length > 0 ? values : undefined
}

function httpsUrls(value: unknown): string[] | undefined {
  const values = textArray(value)?.filter((url) => url.startsWith('https://'))
  return values && values.length > 0 ? values : undefined
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function gameSubscriptions(value: unknown): GameSubscription[] {
  const subscriptions = Array.isArray(value) ? value : [value]
  return subscriptions.includes('xbox-game-pass') ? ['xbox-game-pass'] : []
}

function snapshotFromPayload(
  payload: XboxAppCachePayload,
  reusedScanCache: boolean
): XboxAppLibrarySnapshot {
  const games = new Map<string, XboxAppGame>()
  const byPackageFamilyName = new Map<string, XboxAppGame>()
  const unresolvedProductIds = [
    ...new Set(
      (Array.isArray(payload.unresolvedProductIds) ? payload.unresolvedProductIds : [])
        .map(text)
        .filter((id): id is string => Boolean(id && /^[A-Z0-9]{12}$/i.test(id)))
        .map((id) => id.toUpperCase())
    )
  ]

  const records = Array.isArray(payload.games)
    ? payload.games.slice(0, MAX_XBOX_APP_LIBRARY_GAMES)
    : []
  for (const candidate of records) {
    if (!isObject(candidate)) continue
    const record = candidate as XboxAppCacheRecord
    const productId = text(record.productId)?.toUpperCase()
    const name = text(record.title)
    if (!productId || !/^[A-Z0-9]{12}$/.test(productId) || !name) continue
    const vertical = httpsUrls(record.verticalUrls)
    const horizontal = httpsUrls(record.horizontalUrls)
    const icon = httpsUrls(record.iconUrls)
    const logo = httpsUrls(record.logoUrls)
    const packageFamilyName = normalizeXboxPackageFamilyName(record.packageFamilyName)
    const titleId =
      normalizeXboxTitleId(record.titleId) ?? normalizeXboxTitleId(record.titleId, true)
    const description = text(record.description)
    const developer = text(record.developer)
    const publisher = text(record.publisher)
    const game: XboxAppGame = {
      providerGameId: productId,
      name,
      packageFamilyName,
      metadata: {
        summary: description,
        description,
        genres: textArray(record.categories),
        developers: developer ? [developer] : undefined,
        publishers: publisher ? [publisher] : undefined,
        releaseDateText: text(record.releaseDate),
        platforms: ['windows'],
        providerStoreId: productId,
        providerTitleId: titleId,
        providerPackageFamilyName: packageFamilyName,
        entitlement: {
          kind: 'subscription',
          subscription: 'xbox-game-pass',
          evidence: 'local-cache'
        },
        storeUrl: `msxbox://game/?productId=${productId}`,
        backgroundUrl: horizontal?.[0],
        storeHeaderUrl: horizontal?.[0],
        iconUrl: icon?.[0],
        artwork: { vertical, horizontal, icon, logo }
      }
    }
    games.set(productId, game)
    if (packageFamilyName) byPackageFamilyName.set(packageFamilyName.toLowerCase(), game)
  }

  return {
    available: payload.available === true,
    activeSubscription: payload.activeSubscription === true,
    subscriptions: gameSubscriptions(payload.subscriptions),
    complete:
      payload.complete === true &&
      games.size === nonNegativeNumber(payload.resolvedProductCount),
    reusedScanCache,
    eligibleProductCount: nonNegativeNumber(payload.eligibleProductCount),
    resolvedProductCount: games.size,
    unresolvedProductCount: nonNegativeNumber(payload.unresolvedProductCount),
    unresolvedProductIds,
    games,
    byPackageFamilyName
  }
}

/** Reads the playable PC Game Pass collection already cached by the Xbox app. */
export async function scanXboxAppLibrary(
  options: XboxAppLibraryScanOptions = {}
): Promise<XboxAppLibrarySnapshot> {
  const sourcePath = cachePath()
  if (process.platform !== 'win32' || !existsSync(sourcePath)) {
    return {
      available: false,
      activeSubscription: false,
      subscriptions: [],
      complete: false,
      reusedScanCache: false,
      eligibleProductCount: 0,
      resolvedProductCount: 0,
      unresolvedProductCount: 0,
      unresolvedProductIds: [],
      games: new Map(),
      byPackageFamilyName: new Map()
    }
  }

  const fingerprintBeforeScan = await xboxAppCacheFingerprint(sourcePath)
  if (options.cacheDirectory && fingerprintBeforeScan) {
    const cachedPayload = await readPersistedScan(options.cacheDirectory, fingerprintBeforeScan)
    if (cachedPayload) return snapshotFromPayload(cachedPayload, true)
  }

  const output = await runXboxAppCacheScan()
  const parsed = JSON.parse(output) as unknown
  if (!isXboxAppCachePayload(parsed)) {
    throw new Error('Xbox app library cache returned an invalid payload')
  }
  const snapshot = snapshotFromPayload(parsed, false)

  if (options.cacheDirectory && fingerprintBeforeScan) {
    const fingerprintAfterScan = await xboxAppCacheFingerprint(sourcePath)
    if (sameXboxAppCacheFingerprint(fingerprintBeforeScan, fingerprintAfterScan)) {
      await persistScan(options.cacheDirectory, fingerprintBeforeScan, parsed)
    }
  }
  return snapshot
}

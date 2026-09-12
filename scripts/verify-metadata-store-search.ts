import assert from 'node:assert/strict'
import {
  MAX_METADATA_SEARCH_OPTIONS,
  isSteamAppId,
  normalizeMetadataSearchQuery,
  parseMetadataSearchItems,
  steamStoreImageUrl,
  storeListToEditorText
} from '../src/shared/gameMetadataSearch.ts'
import {
  isPublicSteamArtworkUrl,
  parseSteamStoreBrowseAssets,
  publicSteamArtworkUrls
} from '../src/main/publicArtworkSearchPolicy.ts'

const NUL = String.fromCharCode(0)
const BELL = String.fromCharCode(7)

// Query normalization
assert.equal(
  normalizeMetadataSearchQuery('  MARVEL   Tōkon \n Fighting Souls '),
  'MARVEL Tōkon Fighting Souls'
)
assert.equal(normalizeMetadataSearchQuery('x'), undefined)
assert.equal(normalizeMetadataSearchQuery('a'.repeat(121)), undefined)
assert.equal(normalizeMetadataSearchQuery(`bad${NUL}query`), undefined)
assert.equal(normalizeMetadataSearchQuery(42), undefined)

// Store list values must survive the editor's comma-separated text round trip
assert.equal(
  storeListToEditorText(['ARC SYSTEM WORKS CO., LTD', 'PlayStation Publishing LLC']),
  'ARC SYSTEM WORKS CO. LTD, PlayStation Publishing LLC'
)
assert.equal(storeListToEditorText(['Warner Bros. Games ,  Inc.', 'Warner Bros. Games Inc.']), 'Warner Bros. Games Inc.')
assert.equal(storeListToEditorText([' , ', '']), undefined)
assert.equal(storeListToEditorText(undefined), undefined)
const roundTrip = storeListToEditorText(['ARC SYSTEM WORKS CO., LTD', 'Marvel Games'])!
  .split(/[,\n]/u)
  .map((item) => item.trim())
  .filter(Boolean)
assert.deepEqual(roundTrip, ['ARC SYSTEM WORKS CO. LTD', 'Marvel Games'], 'one store entry stays one editor entry')

// App IDs arrive from the renderer and must be real positive integers
assert.equal(isSteamAppId(3787240), true)
for (const invalid of [0, -1, 1.5, '3787240', Number.NaN, 2 ** 40, null]) {
  assert.equal(isSteamAppId(invalid), false, String(invalid))
}

// Search result parsing keeps apps only, dedupes and validates thumbnails
const tiny =
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3787240/59af95e2175fe017802e3fe79588197a52bef6c0/capsule_231x87.jpg?t=1788520309'
const options = parseMetadataSearchItems({
  total: 5,
  items: [
    { type: 'app', id: 3787240, name: 'MARVEL Tōkon: Fighting Souls', tiny_image: tiny },
    { type: 'app', id: 3787240, name: 'Duplicate', tiny_image: tiny },
    { type: 'bundle', id: 1, name: 'Bundle' },
    { type: 'app', id: 4848500, name: `  DLC${BELL} pass `, tiny_image: 'https://evil.example.com/a.jpg' },
    { type: 'app', id: '5', name: 'String id' }
  ]
})
assert.deepEqual(options, [
  { appId: 3787240, name: 'MARVEL Tōkon: Fighting Souls', imageUrl: tiny, source: 'steam-store' },
  { appId: 4848500, name: 'DLC pass', imageUrl: undefined, source: 'steam-store' }
])
assert.equal(parseMetadataSearchItems(null).length, 0)
assert.equal(
  parseMetadataSearchItems({
    items: Array.from({ length: 40 }, (_, index) => ({ type: 'app', id: index + 1, name: `Game ${index}` }))
  }).length,
  MAX_METADATA_SEARCH_OPTIONS
)
assert.equal(
  steamStoreImageUrl('http://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/a.jpg'),
  undefined
)
assert.equal(steamStoreImageUrl(tiny), tiny)
for (const invalidImage of [
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/59af95e2175fe017802e3fe79588197a52bef6c0/',
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/page.html',
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/capsule.svg'
]) {
  assert.equal(steamStoreImageUrl(invalidImage), undefined, invalidImage)
}

// Hashed library assets from the store browse API
const capsule = '1afd2601e56e4714995a4f08743ac8e4fe39334b/library_capsule.jpg'
const assets = parseSteamStoreBrowseAssets({
  response: {
    store_items: [
      {
        appid: 3787240,
        assets: {
          asset_url_format: 'steam/apps/3787240/${FILENAME}?t=1788520309',
          header: '943fda32c11b3e3f451458ffa95a4adca1f316a4/header.jpg',
          library_capsule: capsule,
          library_capsule_2x: '1afd2601e56e4714995a4f08743ac8e4fe39334b/library_capsule_2x.jpg',
          library_hero: '36b861fdce2c3b8db492a5a093e67614eeba2ea4/library_hero.jpg',
          community_icon: 'dc6b905ad88c209939b17eb2f2f36f428518e18b'
        }
      },
      { appid: 7, assets: { asset_url_format: 'steam/apps/8/${FILENAME}', library_capsule: capsule } },
      { appid: 9, assets: { asset_url_format: 'steam/apps/9/../../evil/${FILENAME}', library_capsule: capsule } },
      { appid: 10, assets: { asset_url_format: 'steam/apps/10/${FILENAME}', library_capsule: '../library_capsule.jpg' } }
    ]
  }
})
const tokon = assets.get(3787240)
assert.ok(tokon)
assert.equal(
  tokon.vertical[0],
  'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3787240/1afd2601e56e4714995a4f08743ac8e4fe39334b/library_capsule_2x.jpg?t=1788520309'
)
assert.equal(tokon.vertical.length, 2)
assert.equal(tokon.horizontal.length, 1)
assert.equal(tokon.header.length, 1)
assert.equal(tokon.logo.length, 0)
assert.equal(assets.has(7), false, 'an asset format for another app is rejected')
assert.equal(assets.has(9), false, 'path traversal in the format is rejected')
assert.deepEqual(assets.get(10)?.vertical, [], 'unhashed or traversal file names are rejected')
assert.equal(parseSteamStoreBrowseAssets({ response: {} }).size, 0)

// Hashed URLs are accepted and tried first; classic paths stay as the fallback
for (const url of [...tokon.vertical, ...tokon.horizontal, ...tokon.header]) {
  assert.equal(isPublicSteamArtworkUrl(url), true, url)
}
assert.equal(isPublicSteamArtworkUrl(tokon.vertical[0].replace('shared.fastly', 'shared.akamai')), true)
assert.equal(publicSteamArtworkUrls(3787240, 'vertical', tokon)[0][0], tokon.vertical[0])
assert.match(publicSteamArtworkUrls(3787240, 'vertical')[0][0], /\/library_600x900_2x\.jpg$/)
assert.equal(publicSteamArtworkUrls(3787240, 'horizontal', tokon)[0][0], tokon.horizontal[0])
assert.equal(publicSteamArtworkUrls(3787240, 'horizontal', tokon)[2][0], tokon.header[0])
assert.equal(
  isPublicSteamArtworkUrl(
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3787240/nothex/library_capsule.jpg'
  ),
  false
)
assert.equal(
  isPublicSteamArtworkUrl(
    'https://cdn.cloudflare.steamstatic.com/steam/apps/3787240/1afd2601e56e4714995a4f08743ac8e4fe39334b/library_capsule.jpg'
  ),
  false,
  'the legacy CDN never serves hashed folders'
)
assert.equal(
  isPublicSteamArtworkUrl(
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3787240/1afd2601e56e4714995a4f08743ac8e4fe39334b/other.jpg'
  ),
  false
)

console.log('Metadata store search and hashed Steam artwork checks passed')

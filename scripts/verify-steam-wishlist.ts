import assert from 'node:assert/strict'
import {
  createSteamWishlistProduct,
  parseSteamDynamicStoreWishlist,
  parseSteamWishlistCount,
  parseSteamWishlistPayload,
  reconcileSteamWishlist
} from '../src/shared/steamWishlistPolicy.ts'
import { isStoreWishlistProductVisible } from '../src/shared/storeVisibility.ts'

const rawItems = Array.from({ length: 21 }, (_, index) => ({
  appid: 1_000 + index,
  priority: index,
  date_added: 1_700_000_000 + index
}))
const count = parseSteamWishlistCount({ response: { count: 21 } })
assert.equal(count, 21)

const wishlist = parseSteamWishlistPayload({ response: { items: rawItems } }, count)
assert.equal(wishlist.length, 21)
assert.equal(wishlist[0]?.appId, 1_000)
assert.equal(wishlist[0]?.addedAt, 1_700_000_000_000)
const materialized = wishlist.map((item) => createSteamWishlistProduct(item.appId, undefined, 1))
assert.equal(materialized.length, 21)
assert.equal(
  materialized.filter(isStoreWishlistProductVisible).length,
  21,
  'all synced identities become visible products before optional detail hydration'
)
assert.ok(materialized.every((product) => product.artworkStatus === 'pending'))

assert.throws(
  () => parseSteamWishlistPayload({ response: { items: rawItems.slice(0, 8) } }, count),
  /incomplete \(8 of 21 identities\)/,
  'a partial Steam response must never become an authoritative wishlist'
)
assert.deepEqual(parseSteamWishlistPayload({ response: {} }, 0), [])
assert.deepEqual(parseSteamDynamicStoreWishlist({ rgWishlist: [1002, 1001, 1002] }), [1002, 1001])
assert.deepEqual(parseSteamDynamicStoreWishlist({ rgWishlist: [] }), [])
assert.throws(
  () => parseSteamDynamicStoreWishlist({ rgWishlist: [1001, '1002'] }),
  /invalid wishlist identity/
)
assert.throws(
  () => parseSteamWishlistPayload({ response: { items: [{ appid: '1000' }] } }),
  /invalid app identity/
)

const current = { 'steam:1000': 10, 'steam:9999': 20 }
assert.deepEqual(
  reconcileSteamWishlist(current, [{ productId: 'steam:1001', addedAt: 30 }], false, 40),
  { 'steam:1000': 10, 'steam:9999': 20, 'steam:1001': 30 },
  'a failed or partial refresh preserves the last known wishlist'
)
assert.deepEqual(
  reconcileSteamWishlist(current, [{ productId: 'steam:1001' }], true, 40),
  { 'steam:1001': 40 },
  'only a complete refresh may prune removed entries'
)

console.log('Steam wishlist verification passed.')

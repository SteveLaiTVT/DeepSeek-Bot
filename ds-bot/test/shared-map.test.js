import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBotBrowsers } from '../src/client/bot-browsers.js'
import { setEntry, sharedMap } from '../src/client/shared-map.js'
import { STORAGE } from '../src/client/storage.js'

// One browser storage that two windows (tabs of DSH Web, or Desktop windows) share.
function sharedStorage() {
  const items = new Map()
  return {
    items,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, String(value)) },
    removeItem: (key) => { items.delete(key) },
  }
}

test('an entry is set, replaced, and dropped, and a missing one is left alone', () => {
  const empty = {}
  assert.deepEqual(setEntry(empty, 'writer', ['a']), { writer: ['a'] })
  assert.equal(setEntry(empty, 'writer', undefined), empty)
  const filled = { writer: ['a'], coder: ['b'] }
  assert.deepEqual(setEntry(filled, 'writer', ['c']), { writer: ['c'], coder: ['b'] })
  assert.deepEqual(setEntry(filled, 'writer', undefined), { coder: ['b'] })
})

test('storage that cannot be read leaves the window its own copy', () => {
  const storage = sharedStorage()
  const store = sharedMap(STORAGE.browsers, { ...storage, getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  assert.deepEqual(store.update(tabs => setEntry(tabs, 'writer', { tabs: [], active: null }), { coder: { tabs: [], active: null } }), { coder: { tabs: [], active: null }, writer: { tabs: [], active: null } })
  assert.deepEqual(sharedMap(STORAGE.browsers, undefined).read({ writer: {} }), { writer: {} })
  storage.setItem(STORAGE.browsers, 'not json')
  assert.deepEqual(sharedMap(STORAGE.browsers, storage).read({ kept: true }), { kept: true })

  let writes = 0
  const counted = sharedMap(STORAGE.browsers, { ...storage, getItem: () => '{"umber":{}}', setItem: () => { writes += 1 } })
  counted.update(tabs => tabs)
  assert.equal(writes, 0)
})

test('Bot browser tabs saved by two windows are both kept', () => {
  const storage = sharedStorage()
  const createSource = (initial) => {
    let value = initial
    return { getSnapshot: () => value, set: (next) => { value = typeof next === 'function' ? next(value) : next }, subscribe: () => () => {} }
  }
  const open = () => createBotBrowsers({ bridge: {}, createSource, storage, document: { body: { append() {} }, createElement: () => ({ style: {}, append() {}, remove() {} }) } })
  const first = open()
  const second = open()
  first.openTab('writer')
  second.openTab('coder')
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(STORAGE.browsers))).sort(), ['coder', 'writer'])
})

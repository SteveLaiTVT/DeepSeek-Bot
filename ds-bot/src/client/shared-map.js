// A JSON object in browser storage that every open window of DSH edits, one entry at a
// time. Each change applies to what is stored at that moment, never to the window's own
// copy, so a window does not undo what another window saved after it loaded. Other
// windows learn of a change from the `storage` event and read the object again.

export function sharedMap(key, storage = globalThis.localStorage) {
  // `fallback` stands in when storage cannot be read, so the window keeps its own copy.
  const read = (fallback = {}) => {
    if (!storage) return fallback
    try {
      const value = JSON.parse(storage.getItem(key) ?? '{}')
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch {
      return fallback
    }
  }
  // A change that returns what it was given changes nothing, and nothing is written.
  const update = (change, fallback = {}) => {
    const base = read(fallback)
    const next = change(base)
    if (next === base) return next
    try { storage?.setItem(key, JSON.stringify(next)) } catch { /* storage unavailable */ }
    return next
  }
  return { key, read, update }
}

// Sets one entry, or drops it for `undefined`; an entry already so leaves the map as it is.
export function setEntry(map, id, value) {
  if (value === undefined) {
    if (!Object.hasOwn(map, id)) return map
    const { [id]: _, ...rest } = map
    return rest
  }
  return { ...map, [id]: value }
}

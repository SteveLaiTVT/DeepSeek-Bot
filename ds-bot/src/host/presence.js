// Reads and reactions: what the user has seen and how they marked a message. They live
// in state.json so every client on every device shows the same, and the browser's old
// localStorage copies are imported once (see client/index.js).
const ID_MAX = 200
const KEY_MAX = 300
const EMOJI_MAX = 16
const AHEAD_MS = 60_000

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const own = (map, key) => (map != null && Object.hasOwn(map, key) ? map[key] : undefined)

function cleanId(raw) {
  const id = String(raw ?? '').trim()
  if (id === '' || id.length > ID_MAX) throw invalid('A conversation id is needed')
  return id
}

// `seen` only moves forward, and never past the host's clock by more than a minute: a
// client whose clock runs ahead must not hide messages that arrive after its answer.
function cleanSeen(raw, now) {
  const seen = Number(raw)
  if (!Number.isFinite(seen) || seen <= 0) throw invalid('A read time must be a positive number')
  return Math.min(seen, now + AHEAD_MS)
}

// A reaction is one emoji, or a short emoji sequence: no spaces, no control characters.
const hasSpaceOrControl = value => [...value].some((char) => {
  const code = char.codePointAt(0)
  return code <= 0x20 || code === 0x7f
})

function cleanEmoji(raw) {
  const emoji = String(raw ?? '')
  if (emoji === '' || emoji.length > EMOJI_MAX || hasSpaceOrControl(emoji)) throw invalid('Choose an emoji')
  return emoji
}

export function install(rt) {
  const { state } = rt

  const reads = () => (state.reads ??= {})
  const reactions = () => (state.reactions ??= {})

  function markOne(id, patch, now) {
    const table = reads()
    const before = own(table, id) ?? {}
    const seen = patch.seen === undefined ? before.seen : Math.max(Number(before.seen) || 0, cleanSeen(patch.seen, now))
    const unread = patch.unread === undefined ? before.unread === true : patch.unread === true
    const next = { ...(before.seen !== undefined || seen !== undefined ? { seen } : {}), ...(unread ? { unread: true } : {}) }
    if (next.seen === undefined && next.unread === undefined) delete table[id]
    else table[id] = next
  }

  // `{ id, seen?, unread? }` sets one conversation. `{ entries: { id: { seen?, unread? } } }`
  // merges a client's old localStorage copy: it only adds, never clears a flag or moves a
  // time back, so a retry is safe and an old copy cannot undo what another device did.
  async function markRead(body = {}) {
    await rt.load()
    if (rt.readOnly() !== undefined) throw new Error(rt.readOnly())
    const now = Date.now()
    if (body.entries !== undefined) {
      if (body.entries === null || typeof body.entries !== 'object' || Array.isArray(body.entries)) throw invalid('entries must be an object')
      for (const [rawId, patch] of Object.entries(body.entries)) {
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) continue
        markOne(cleanId(rawId), { seen: patch.seen, unread: patch.unread === true ? true : undefined }, now)
      }
      state.localImported = true
    } else {
      markOne(cleanId(body.id), { seen: body.seen, unread: body.unread }, now)
    }
    await rt.save()
    return reads()
  }

  function toggleReaction(key, index, emoji) {
    const table = reactions()
    const entry = { ...own(table, key) }
    const list = Array.isArray(entry[index]) ? entry[index] : []
    entry[index] = list.includes(emoji) ? list.filter(item => item !== emoji) : [...list, emoji]
    if (entry[index].length === 0) delete entry[index]
    if (Object.keys(entry).length === 0) delete table[key]
    else table[key] = entry
  }

  function mergeReaction(key, index, emoji) {
    const table = reactions()
    const entry = { ...own(table, key) }
    const list = Array.isArray(entry[index]) ? entry[index] : []
    if (!list.includes(emoji)) entry[index] = [...list, emoji]
    table[key] = entry
  }

  // `{ key, index, emoji }` toggles one reaction; `{ entries }` imports a browser's map.
  async function react(body = {}) {
    await rt.load()
    if (rt.readOnly() !== undefined) throw new Error(rt.readOnly())
    if (body.entries !== undefined) {
      if (body.entries === null || typeof body.entries !== 'object' || Array.isArray(body.entries)) throw invalid('entries must be an object')
      for (const [rawKey, bubbles] of Object.entries(body.entries)) {
        const key = String(rawKey ?? '').trim()
        if (key === '' || key.length > KEY_MAX || bubbles === null || typeof bubbles !== 'object' || Array.isArray(bubbles)) continue
        for (const [rawIndex, list] of Object.entries(bubbles)) {
          const index = Number(rawIndex)
          if (!Number.isInteger(index) || index < 0 || index > 100 || !Array.isArray(list)) continue
          for (const emoji of list.slice(0, 8)) mergeReaction(key, index, cleanEmoji(emoji))
        }
      }
      state.localImported = true
    } else {
      const key = String(body.key ?? '').trim()
      if (key === '' || key.length > KEY_MAX) throw invalid('A message key is needed')
      const index = Number(body.index)
      if (!Number.isInteger(index) || index < 0 || index > 100) throw invalid('A bubble number is needed')
      toggleReaction(key, index, cleanEmoji(body.emoji))
    }
    await rt.save()
    return reactions()
  }

  Object.assign(rt, { markRead, react })
}

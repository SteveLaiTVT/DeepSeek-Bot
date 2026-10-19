import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/cells.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, Intl, Date,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
      'react-dom': {},
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { ChatRows, replyClockMarks } = module.exports

const roster = { byId: { b: { id: 'b', name: 'Writer' } }, roomsById: {} }
const MINUTE = 60_000
const shape = rows => [...rows].map(row => (row.props.className === 'bt-time-sep' ? 'clock' : row.type.name === 'Bubbles' ? `bot:${row.props.texts.join('+')}` : row.type.name))

test('a Bot\'s messages in a row are one block', () => {
  const items = [
    { kind: 'user', text: 'hi', time: MINUTE },
    { kind: 'bot', text: 'one', time: 2 * MINUTE },
    { kind: 'bot', text: 'two', time: 2 * MINUTE },
    { kind: 'user', text: 'and?', time: 3 * MINUTE },
    { kind: 'bot', text: 'three', time: 4 * MINUTE },
  ]
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster, actions: {} })), ['EarlierUser', 'bot:one+two', 'EarlierUser', 'bot:three'])
})

test('with the clock, a time separator sits above the first entry and after each pause of two minutes', () => {
  const items = [
    { kind: 'divider', time: 0 },
    { kind: 'user', text: 'hi', time: MINUTE },
    { kind: 'bot', text: 'one', time: 2 * MINUTE },
    { kind: 'bot', text: 'two', time: 40 * MINUTE },
    { kind: 'user', text: 'back', time: 42 * MINUTE },
  ]
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster, actions: {}, clock: true })), ['PartLine', 'clock', 'EarlierUser', 'bot:one+two', 'clock', 'EarlierUser'])
})

test('the team sets how long a pause must be for a separator', () => {
  const items = [
    { kind: 'user', text: 'hi', time: MINUTE },
    { kind: 'user', text: 'ten minutes later', time: 11 * MINUTE },
  ]
  // Two minutes is the default, so ten are a pause; at exactly ten it still is.
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster, actions: {}, clock: true })), ['clock', 'EarlierUser', 'clock', 'EarlierUser'])
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster: { ...roster, prefs: { timeGapMinutes: 10 } }, actions: {}, clock: true })), ['clock', 'EarlierUser', 'clock', 'EarlierUser'])
  // Half an hour is longer than the pause, so the two stand together.
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster: { ...roster, prefs: { timeGapMinutes: 30 } }, actions: {}, clock: true })), ['clock', 'EarlierUser', 'EarlierUser'])
})

test('a group chat puts its separators where the host logged the pause', () => {
  // Two members speaking in one round: the times are the ones the host wrote in the log.
  const replies = [
    { botId: 'a', name: 'A', text: 'starting', time: MINUTE },
    { botId: 'a', name: 'A', text: 'still going', time: 2 * MINUTE },
    { botId: 'b', name: 'B', text: 'done', time: 9 * MINUTE },
  ]
  const items = replyClockMarks(
    [{ reply: replies[0], index: 0, texts: ['starting', 'still going'] }, { reply: replies[2], index: 2, texts: ['done'] }],
    replies, 2 * MINUTE,
  )
  // The pause counts from A's last line, so B's answer is nine minutes after it started.
  assert.deepEqual(Object.fromEntries([...items].map(([key, value]) => [String(key), value])), { 2: 9 * MINUTE })
  // Under two minutes there is no separator, and a reply without a logged time has none.
  assert.equal(replyClockMarks([{ reply: { time: MINUTE }, index: 0 }, { reply: { time: MINUTE + 30_000 }, index: 1 }], [], 2 * MINUTE).size, 0)
  assert.equal(replyClockMarks([{ reply: {}, index: 0 }, { reply: { time: MINUTE }, index: 1 }], [], 2 * MINUTE).size, 0)
})

// The service contract: what the host promises a client — the interface version, the
// endpoints, what a host can do, the defaults a client may not decide for itself, read
// marks and reactions kept with the team, the profile card, and where a key may be set.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { BOT_INTRO_MAX, TIME_GAP_MINUTES } from '../src/host/constants.js'
import { ENDPOINTS } from '../src/host/interface.js'
import { fakeContext } from './fake-ctx.js'

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  botCapabilities: [],
  bots: {
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
    b2: { id: 'b2', sessionId: 'b2', name: 'Writer', role: '写作', instructions: 'Write plainly.', createdAt: 2 },
    b3: { id: 'b3', sessionId: 'b3', name: 'Coder', role: '代码', instructions: '', createdAt: 3 },
    nb: { id: 'nb', sessionId: 'nb', name: 'New Bot', role: '', instructions: '', createdAt: 4 },
  },
  rooms: {
    r1: { id: 'r1', name: 'Launch', named: true, members: ['b2', 'b3'], admin: 'b3', mode: 'everyone', notice: '', sessions: { b3: 'g3' }, seq: 1, log: [{ who: 'User', text: 'Ship it', seq: 1 }] },
    r2: { id: 'r2', name: 'Other', named: true, members: ['b2', 'b3'], admin: 'b2', mode: 'everyone', notice: '', sessions: { b2: 'g2' }, seq: 0, log: [] },
  },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

function start({ services = {}, config = {}, saved = TEAM } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-service-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(saved))
  const ctx = fakeContext({ services })
  let sessions = 0
  const workspaces = new Map()
  Object.assign(ctx, {
    // The team folder is made once; later Sessions find it by id, as DSH does.
    workspaceRegistry: {
      get: id => workspaces.get(id),
      list: () => [...workspaces.values()],
      resolveByPath: async () => undefined,
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: { create: async () => ({ sessionId: `s${++sessions}` }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId, seq: 2 } } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home, ...config })
  const call = async (endpoint, payload, url = 'http://localhost/api/bot') => {
    const response = await route.fetch(new Request(url, { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const state = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  const tool = (name, args, agentId) => ctx.registeredTools.get(name).execute(args, { agent: { id: agentId } })
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, home, call, state, tool, stop }
}

test('hello names the interface, the plugin, every endpoint, and what this host can do', async (t) => {
  const { call, stop } = start()
  t.after(stop)
  const hello = (await call('hello')).value
  const plugin = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(hello.interfaceVersion, 1)
  assert.equal(hello.pluginVersion, plugin.version)
  // The list is the contract: every endpoint it names is served, and nothing else is.
  assert.deepEqual(hello.endpoints.map(entry => entry.name), ENDPOINTS)
  const read = Object.fromEntries(hello.endpoints.map(entry => [entry.name, entry.read]))
  for (const name of ['hello', 'state', 'memory-view', 'diagnostics-clear']) assert.equal(read[name], true, name)
  for (const name of ['create-bot', 'update-profile', 'mark-read', 'react', 'secret-create']) assert.equal(read[name], false, name)
  assert.equal(hello.features.memory, true)
  assert.equal(hello.features.browser, false)
  assert.equal(hello.features.readOnly, null)
  // The DSH services are reported as this host has them: the fake context serves none.
  assert.deepEqual(hello.features.dsh, {
    credentials: false, settings: false, deepseekAccount: false, pluginManager: false, agentDefaultModel: false,
    permissionPresets: false, agentPresets: false, profileContext: false, launchEnvironment: false, sessionProjections: false,
  })
})

test('state says what a new Bot starts on, and the lengths the host measures', async (t) => {
  const { call, stop } = start()
  t.after(stop)
  const view = (await call('state', {})).value
  // "New Bot" is taken, so the host offers the next free name; no client counts for it.
  assert.equal(view.defaults.name, 'New Bot 2')
  assert.equal(view.defaults.model, null)
  assert.deepEqual(view.limits, { intro: BOT_INTRO_MAX })
  assert.deepEqual([view.reads, view.reactions], [{}, {}])
})

test('a new Bot starts on the model DSH defaults to, when one is served', async (t) => {
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'v4' }) },
    llm: {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async () => [{ id: 'v4' }, { id: 'v4-flash' }],
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }] } }),
    },
  }
  const { call, stop } = start({ services })
  t.after(stop)
  const view = (await call('state', {})).value
  assert.equal(view.defaults.model, 'deepseek/v4')
})

test('read marks and reactions are the team\'s, and move only forward', async (t) => {
  const { call, stop, state } = start()
  t.after(stop)
  const now = Date.now()
  assert.deepEqual((await call('mark-read', { id: 'b2', seen: now })).value, { b2: { seen: now } })
  // A device whose clock is behind never makes seen messages new again.
  assert.equal((await call('mark-read', { id: 'b2', seen: now - 60_000 })).value.b2.seen, now)
  // One whose clock runs ahead is cut to a minute past the host's.
  assert.ok((await call('mark-read', { id: 'b2', seen: now + 3_600_000 })).value.b2.seen <= Date.now() + 60_000)
  // Unread is a flag of its own, and an unread and read conversation drops its row.
  assert.equal((await call('mark-read', { id: 'r1', unread: true })).value.r1.unread, true)
  assert.equal((await call('mark-read', { id: 'r1', unread: false })).value.r1, undefined)
  // Reactions toggle here, so two devices agree without either holding the map.
  assert.deepEqual((await call('react', { key: 'b2:1', index: 0, emoji: '👍' })).value, { 'b2:1': { 0: ['👍'] } })
  assert.deepEqual((await call('react', { key: 'b2:1', index: 0, emoji: '❤️' })).value, { 'b2:1': { 0: ['👍', '❤️'] } })
  assert.deepEqual((await call('react', { key: 'b2:1', index: 0, emoji: '👍' })).value, { 'b2:1': { 0: ['❤️'] } })
  assert.deepEqual((await call('react', { key: 'b2:1', index: 0, emoji: '❤️' })).value, {})
  // Both live in state.json, so every window is a reader of the same record.
  assert.equal(state().reads.b2.seen > 0, true)
  assert.deepEqual(state().reactions, {})
  // Bad input changes nothing.
  const before = JSON.stringify([state().reads, state().reactions])
  for (const bad of [
    { endpoint: 'mark-read', payload: { id: 'b2', seen: -1 } },
    { endpoint: 'mark-read', payload: { id: '' } },
    { endpoint: 'react', payload: { key: 'b2:1', index: 0, emoji: 'two words' } },
    { endpoint: 'react', payload: { key: 'b2:1', index: -1, emoji: '👍' } },
  ]) {
    assert.equal((await call(bad.endpoint, bad.payload)).error.code, 'bot/invalid', JSON.stringify(bad.payload))
  }
  assert.equal(JSON.stringify([state().reads, state().reactions]), before)
})

test('a browser\'s old copy of marks and reactions is imported once, merging into the team', async (t) => {
  const { call, stop, state } = start()
  t.after(stop)
  await call('mark-read', { entries: { b2: { seen: 5_000, unread: true }, b3: { unread: true } } })
  const imported = (await call('react', { entries: { 'b2:1': { 0: ['👍'] }, 'b2:2': { 1: ['❤️'] } } })).value
  assert.deepEqual(imported, { 'b2:1': { 0: ['👍'] }, 'b2:2': { 1: ['❤️'] } })
  // Importing again saves nothing twice, and never moves a time back.
  await call('mark-read', { entries: { b2: { seen: 1_000 } } })
  const again = (await call('react', { entries: { 'b2:1': { 0: ['👍'] } } })).value
  assert.deepEqual(again, imported)
  assert.equal(state().reads.b2.seen, 5_000)
  assert.equal(state().localImported, true)
  // A cleared flag keeps the conversation, minus the flag.
  assert.deepEqual((await call('mark-read', { id: 'b3', unread: false })).value, { b2: { seen: 5_000, unread: true } })
  assert.equal((await call('mark-read', { entries: [] })).error.code, 'bot/invalid')
  assert.equal((await call('react', { entries: 'x' })).error.code, 'bot/invalid')
})

test('a profile is written whole: label, introduction, and instructions together', async (t) => {
  const { call, stop, state, ctx, tool } = start()
  t.after(stop)
  const saved = await call('update-profile', { id: 'b2', role: 'Docs', intro: ' Writes the docs. ', instructions: 'Keep them current.' })
  assert.equal(saved.ok, true, JSON.stringify(saved.error))
  assert.deepEqual([state().bots.b2.role, state().bots.b2.intro, state().bots.b2.instructions], ['Docs', 'Writes the docs.', 'Keep them current.'])
  // The identity prompt says who it is; the roster tool shows it before the instructions.
  assert.match(ctx.sections.get('bot-identity').text({ agent: { id: 'b2' } }), /You are Writer, a Bot on the user's team in DS Bot\. Your role: Docs\.\n\nWrites the docs\.\n\nKeep them current\./)
  assert.match(await tool('list_bots', {}, 'm1'), /- Writer \(Docs\) — Writes the docs\./)
  // Too long is refused whole: no field changes.
  const before = JSON.stringify(state().bots.b2)
  const long = await call('update-profile', { id: 'b2', role: 'Keeper', intro: 'x'.repeat(BOT_INTRO_MAX + 1), instructions: 'New' })
  assert.equal(long.ok, false)
  assert.match(long.error.message, /at most 300 characters/)
  assert.equal(JSON.stringify(state().bots.b2), before)
  // A capability the library does not hold is refused the same way.
  const bad = await call('update-profile', { id: 'b2', role: 'Docs', intro: '', instructions: '', capabilities: ['nope'] })
  assert.match(bad.error.message, /No capability named nope/)
  assert.equal(JSON.stringify(state().bots.b2), before)
  // A profile that leaves a field out is refused, so no request wipes what it omits.
  assert.match((await call('update-profile', { id: 'b2', role: 'Docs' })).error.message, /intro, instructions/)
  assert.equal(JSON.stringify(state().bots.b2), before)
  assert.match((await call('update-profile', { id: 'nobody', role: '', intro: '', instructions: '' })).error.message, /Unknown Bot/)
})

test('a copied Bot keeps its introduction, and a Bot made with one keeps it', async (t) => {
  const { call, stop, state } = start()
  t.after(stop)
  await call('update-profile', { id: 'b2', role: 'Docs', intro: 'Writes the docs.', instructions: '' })
  const copy = (await call('duplicate-bot', { id: 'b2' })).value
  assert.equal(copy.intro, 'Writes the docs.')
  // A copy says what it is, and the next copy takes the next free name.
  assert.equal(copy.name, 'Writer copy')
  const twice = await call('duplicate-bot', { id: 'b2' })
  assert.equal(twice.ok, true, JSON.stringify(twice.error))
  assert.equal(twice.value.name, 'Writer copy 2')
  const made = (await call('create-bot', { name: 'Dana', intro: 'Reads the logs.', role: 'Ops' })).value
  assert.equal(made.intro, 'Reads the logs.')
  assert.equal(state().bots[made.id].intro, 'Reads the logs.')
  assert.match((await call('create-bot', { name: 'Eve', intro: 'y'.repeat(BOT_INTRO_MAX + 1) })).error.message, /at most 300/)
})

test('a group chat keeps a project memory its members write and read only there', async (t) => {
  const { call, stop, home, tool } = start()
  t.after(stop)
  // Coder speaks in Launch and writes its project memory from there.
  assert.match(await tool('remember', { text: 'The launch is Friday' }, 'g3'), /^Saved to the project memory of "Launch"/)
  assert.match(readFileSync(join(home, 'memory', 'rooms', 'r1', 'MEMORY.md'), 'utf8'), /- The launch is Friday \[source: group "Launch"/)
  // Its own chat reads only its own and the team's: the project is not there.
  assert.match(await tool('recall', { query: 'friday' }, 'b3'), /^Nothing in your memory and the team memory mentions "friday"/)
  // Another group does not read it either, and keeps its own.
  assert.match(await tool('recall', { query: 'friday' }, 'g2'), /^Nothing in your memory and the project memory of "Other" mentions "friday"/)
  assert.match(await tool('remember', { text: 'The other one is Saturday' }, 'g2'), /^Saved to the project memory of "Other"/)
  assert.equal(existsSync(join(home, 'memory', 'rooms', 'r2', 'MEMORY.md')), true)
  // The team memory is not there to write from a group, whoever administers it.
  assert.match(await tool('remember', { text: 'y', scope: 'team' }, 'g2'), /^This group chat reads and writes its project memory, not the team memory/)
  // The panel answers for the group by its id.
  const view = (await call('memory-view', { roomId: 'r1' })).value
  assert.deepEqual([view.roomId, view.entries.map(entry => entry.scope)], ['r1', ['project']])
  assert.equal((await call('memory-view', { roomId: 'gone' })).error.message, 'Unknown group chat')
  // Deleting the group archives its project memory whole.
  assert.equal((await call('delete-room', { id: 'r1' })).ok, true)
  assert.equal(existsSync(join(home, 'memory', 'rooms', 'r1')), false)
})

test('the time between separators is one setting for the whole team', async (t) => {
  const { call, stop, state } = start()
  t.after(stop)
  assert.equal((await call('state', {})).value.prefs.timeGapMinutes, undefined)
  assert.equal((await call('set-prefs', { timeGapMinutes: 15 })).value.timeGapMinutes, 15)
  assert.equal(state().prefs.timeGapMinutes, 15)
  // The default is stored as no setting at all.
  assert.equal((await call('set-prefs', { timeGapMinutes: TIME_GAP_MINUTES })).value.timeGapMinutes, undefined)
  assert.equal(state().prefs.timeGapMinutes, undefined)
  for (const bad of [0, 61, 2.5, 'ten']) {
    const result = await call('set-prefs', { timeGapMinutes: bad })
    assert.equal(result.error.code, 'bot/invalid', String(bad))
  }
})

test('a key is created in Settings, its value goes in and never comes back out', async (t) => {
  const { call, stop, home } = start()
  t.after(stop)
  const value = 'sk-live-abcdefghijklmnop'
  const made = await call('secret-create', { name: 'github token', value, purpose: 'Reading issues' })
  assert.equal(made.ok, true, JSON.stringify(made.error))
  assert.deepEqual(Object.keys(made.value).sort(), ['createdAt', 'name', 'purpose', 'requestedBy', 'scope', 'updatedAt'])
  assert.deepEqual([made.value.name, made.value.scope, made.value.purpose, made.value.requestedBy], ['GITHUB_TOKEN', 'all', 'Reading issues', null])
  // The name is taken now, so a second key of that name is refused rather than replaced.
  assert.match((await call('secret-create', { name: 'GITHUB_TOKEN', value })).error.message, /already exists/)
  assert.match((await call('secret-create', { name: 'x', value: 'abc' })).error.message, /at least 4/)
  // Nothing the browser can ask for holds the value.
  assert.ok(!JSON.stringify((await call('state', {})).value).includes(value))
  assert.ok(!readFileSync(join(home, 'state.json'), 'utf8').includes(value))
})

test('a key is refused from a plain http address on another machine', async (t) => {
  const { call, stop } = start()
  t.after(stop)
  const elsewhere = 'http://10.0.0.5/api/bot'
  const refused = await call('secret-create', { name: 'TOKEN', value: 'sk-live-abcdefghijklmnop' }, elsewhere)
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'bot/insecure')
  assert.match(refused.error.message, /this computer or over https/)
  // Everything that does not carry a value answers the same there.
  assert.equal((await call('state', {}, elsewhere)).ok, true)
  assert.equal((await call('mark-read', { id: 'b2', seen: Date.now() }, elsewhere)).ok, true)
  assert.equal((await call('react', { key: 'b2:1', index: 0, emoji: '👍' }, elsewhere)).ok, true)
})

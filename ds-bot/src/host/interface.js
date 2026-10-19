// The client contract: the interface version, every endpoint `/api/bot` answers, and
// which of them a host that only reads the team may call (see channel.js).
//
// Adding an endpoint means adding it here as well: the list is what `hello` reports and
// what the tests walk, so a name the switch forgot shows up as bot/not-found.
import { readFileSync } from 'node:fs'

// Only an incompatible change bumps this: a removed endpoint, a changed parameter
// meaning, or a different return shape. New endpoints and new optional fields do not.
export const INTERFACE_VERSION = 1

export const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

export const ENDPOINTS = [
  'hello',
  'state', 'models', 'efforts', 'providers', 'provider-key', 'provider-add', 'provider-models', 'provider-remove',
  'duplicate-bot', 'set-prefs', 'exchange', 'exchange-text', 'file-text', 'earlier', 'chat', 'run-stats', 'usage',
  'room-progress', 'create-bot', 'update-bot', 'update-profile', 'delete-bot', 'set-main', 'mark-read', 'react',
  'create-room', 'update-room', 'delete-room', 'folders', 'folder-pick', 'folder-list',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent', 'set-flags',
  'approval-answer', 'stop-member-work', 'dismiss-question',
  'secret-set', 'secret-create', 'secret-allow', 'secret-cancel', 'secret-update', 'secret-delete',
  'connector-connect', 'connector-disconnect', 'connector-retry',
  'capability-save', 'capability-delete', 'capability-approve', 'bot-capability',
  'schedules', 'schedule-create', 'schedule-delete',
  'memory-view', 'memory-ask', 'memory-forget', 'answer-question', 'send',
  'update-check', 'update-install', 'dsh-update-install', 'repo-stars',
  'browser-wait', 'browser-result', 'diagnostics', 'diagnostics-log', 'diagnostics-clear',
]

// A host that only reads the team (`state.lock` held elsewhere) answers these and
// refuses the rest with bot/read-only.
export const READ_ENDPOINTS = new Set([
  'hello', 'state', 'models', 'efforts', 'providers', 'provider-models', 'exchange', 'exchange-text', 'file-text',
  'earlier', 'chat', 'run-stats', 'usage', 'room-progress', 'folders', 'folder-pick', 'folder-list',
  'approval-answer', 'schedules', 'memory-view', 'update-check', 'update-install', 'dsh-update-install',
  'repo-stars', 'browser-wait', 'browser-result', 'diagnostics', 'diagnostics-log', 'diagnostics-clear',
])

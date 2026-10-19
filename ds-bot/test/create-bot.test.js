import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPayload } from '../src/client/bot-draft.js'

test('the payload carries the look, the chosen model, the brief, and the profile', () => {
  const look = { shape: 'star', color: 'blue' }
  assert.deepEqual(createPayload({ name: 'A', look, model: 'cloud/qwen-max' }), { name: 'A', color: 'blue', avatar: { shape: 'star' }, model: 'cloud/qwen-max' })
  assert.deepEqual(createPayload({ name: 'A', look, model: '', brief: 'hi', image: 'data:image/png;base64,AA' }),
    { name: 'A', color: 'blue', avatar: { shape: 'star', image: 'data:image/png;base64,AA' }, brief: 'hi' })
  // The introduction and the capabilities go with the first save, as the host takes them.
  assert.deepEqual(createPayload({ name: 'A', look, model: '', intro: ' Writes the docs ', capabilities: ['read_browser', 'web_search'] }),
    { name: 'A', color: 'blue', avatar: { shape: 'star' }, intro: 'Writes the docs', capabilities: ['read_browser', 'web_search'] })
})

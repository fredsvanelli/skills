import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMAND_NAMES, DEFAULT_MODELS, MODEL_VALUES, modelRowsDiff, parseKey, resolveModel } from './lib/models.mjs'

const r = (...argv) => resolveModel(DEFAULT_MODELS, argv)
test('resolveModel picks the most specific row', () => {
  assert.deepEqual(r('run', 'billing.x', '--mode', 'test'), { model: 'haiku', row: 'run --mode test', forced: false })
  assert.deepEqual(r('run', 'billing.x', '--mode', 'headless'), { model: 'sonnet', row: 'run', forced: false })
  assert.deepEqual(r('run', '--import', 'reply.md'), { model: 'haiku', row: 'run --import', forced: false })
  assert.deepEqual(r('audit', '--all', '--fix'), { model: 'opus', row: 'audit --fix', forced: false })
  assert.deepEqual(r('roles:create'), { model: 'inline', row: 'roles:create', forced: false })
  assert.deepEqual(r('nope'), { model: 'inline', row: null, forced: false })
})
test('help needs a question to leave the main session', () => {
  assert.equal(r('help').model, 'inline')
  assert.equal(r('help', '--about', 'roles').model, 'inline')
  assert.deepEqual(r('help', '--about', 'roles', 'who can edit?'), { model: 'sonnet', row: 'help <question>', forced: false })
})
test('--model forces and rejects bad values', () => {
  assert.deepEqual(r('list', '--model', 'haiku'), { model: 'haiku', row: null, forced: true })
  assert.deepEqual(r('run', 'x', '--mode', 'test', '--model', 'inline'), { model: 'inline', row: null, forced: true })
  assert.throws(() => r('run', '--model', 'gpt'), /--model must be one of inline, haiku, sonnet, opus, fable/)
  assert.throws(() => r('run', 'x', '--model', '--mode', 'test'), /--model must be one of/)
  assert.throws(() => r('run', '--model'), /--model must be one of/)
})
test('a tie goes to the more capable model', () => {
  const rows = { run: 'sonnet', 'run --record': 'haiku', 'run --mode headless': 'opus' }
  assert.equal(resolveModel(rows, ['run', '--record', '--mode', 'headless']).model, 'opus')
})
test('parseKey', () => {
  assert.deepEqual(parseKey('run --mode test'), { command: 'run', options: { mode: 'test' }, positional: false })
  assert.deepEqual(parseKey('audit --fix'), { command: 'audit', options: { fix: true }, positional: false })
  assert.deepEqual(parseKey('help <question>'), { command: 'help', options: {}, positional: true })
  assert.throws(() => parseKey('run mode test'), /run mode test/)
})
test('the default table', () => {
  assert.deepEqual(COMMAND_NAMES.filter((name) => !(name in DEFAULT_MODELS)), [])
  assert.ok(Object.values(DEFAULT_MODELS).every((m) => MODEL_VALUES.includes(m) && m !== 'fable'))
})
test('modelRowsDiff', () => {
  const diff = modelRowsDiff({ audit: 'haiku', 'run --mode tests': 'opus' })
  assert.deepEqual(diff.differing, [{ key: 'audit', value: 'haiku', default: 'sonnet' }])
  assert.equal(diff.missing.length, Object.keys(DEFAULT_MODELS).length - 1)
  assert.ok(!diff.missing.includes('audit'))
})

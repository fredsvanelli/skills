import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
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

function modelsProject(models) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-models-'))
  fs.mkdirSync(path.join(root, 'docs/runbooks'), { recursive: true })
  const config = { version: 1, stack: 'frontend' }
  if (models !== undefined) config.models = models
  fs.writeFileSync(path.join(root, 'docs/runbooks/runbooks.config.json'), JSON.stringify(config))
  return root
}
const loadModels = (models) => loadConfig(modelsProject(models))

test('a missing or null models block gives the defaults', () => {
  for (const models of [undefined, null]) {
    const config = loadModels(models)
    assert.deepEqual(config.models, DEFAULT_MODELS)
    assert.deepEqual(config.ownModels, {})
  }
})
test('project rows override the defaults', () => {
  const config = loadModels({ audit: 'haiku' })
  assert.equal(config.models.audit, 'haiku')
  assert.equal(config.models.create, 'opus')
  assert.deepEqual(config.ownModels, { audit: 'haiku' })
})
test('a model outside the five values is a config error', () => {
  assert.throws(() => loadModels({ audit: 'gpt' }), /models\["audit"\] must be one of inline, haiku, sonnet, opus, fable/)
})
test('a row with an unparseable key is ignored with a warning', () => {
  const config = loadModels({ 'run mode test': 'haiku' })
  assert.match(config.warnings.join('\n'), /models\["run mode test"\].*ignored/)
  assert.equal('run mode test' in config.models, false)
})
test('a row with an empty key is ignored with a warning', () => {
  const config = loadModels({ ' ': 'haiku' })
  assert.match(config.warnings.join('\n'), /models\[" "\].*ignored/)
  assert.equal(' ' in config.models, false)
})
test('a row for an unknown command is ignored with a warning', () => {
  const config = loadModels({ 'deploy --fast': 'haiku' })
  assert.match(config.warnings.join('\n'), /unknown command "deploy"/)
  assert.equal('deploy --fast' in config.models, false)
})
test('models must be an object', () => {
  assert.throws(() => loadModels([]), /models must be an object/)
})

// A Codex project must not inherit Claude aliases or overwrite Claude choices.
import { run } from './runbooks.mjs'
function codexProject(codex, models = { create: 'haiku' }) {
  const root = modelsProject(models)
  const file = path.join(root, 'docs/runbooks/runbooks.config.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.codex = codex
  fs.writeFileSync(file, JSON.stringify(raw))
  return root
}
test('Codex CLI defaults select inheritance independently of Claude defaults', () => {
  const result = run(['models', '--runtime', 'codex', '--defaults', '--json', '--root', '/nonexistent'])
  assert.equal(result.code, 0)
  const rows = JSON.parse(result.stdout)
  assert.equal(rows.create, 'inherit')
  assert.equal(rows.list, 'inline')
  assert.equal(rows['run --mode guided'], 'inline')
})
test('Codex config and CLI resolve overrides without changing Claude rows', (t) => {
  const root = codexProject({ models: { create: 'test-model-v2', 'run --mode test': 'inline' } })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const invoke = (args) => run([...args, '--root', root, '--json'])
  assert.equal(JSON.parse(invoke(['model', 'create']).stdout).model, 'haiku')
  assert.deepEqual(JSON.parse(invoke(['model', 'create', '--runtime', 'codex']).stdout), { model: 'test-model-v2', row: 'create', forced: false })
  assert.equal(JSON.parse(invoke(['model', 'run', '--mode', 'test', '--runtime', 'codex']).stdout).model, 'inline')
  assert.deepEqual(JSON.parse(invoke(['model', 'create', '--runtime', 'codex', '--model', 'inherit']).stdout), { model: 'inherit', row: null, forced: true })
  const diff = JSON.parse(invoke(['models', '--runtime', 'codex', '--diff']).stdout)
  assert.deepEqual(diff.differing, [{ key: 'create', value: 'test-model-v2', default: 'inherit' }, { key: 'run --mode test', value: 'inline', default: 'inherit' }])
  assert.ok(!diff.missing.includes('create'))
})
test('Codex accepts structural model IDs but rejects Claude aliases and malformed overrides', () => {
  for (const model of ['inline', 'inherit', 'test-model-v2', 'vendor/model:latest']) {
    assert.equal(resolveModel({}, ['run', '--model', model], 'codex').model, model)
  }
  for (const model of ['haiku', 'sonnet', 'opus', 'fable', '', 'bad model', '-bad', '../escape', 'x;echo']) {
    assert.throws(() => resolveModel({}, ['run', '--model', model], 'codex'), /--model/)
  }
  assert.throws(() => resolveModel({}, ['run', '--model'], 'codex'), /--model/)
})
test('Codex ties use first matching row, not a model-name capability ranking', () => {
  const rows = { 'run --record': 'z-model', 'run --mode headless': 'a-model' }
  assert.equal(resolveModel(rows, ['run', '--record', '--mode', 'headless'], 'codex').model, 'z-model')
})
test('Codex config rejects invalid shapes and Claude model aliases', (t) => {
  for (const codex of [[], 'bad', { models: [] }, { models: { create: 'opus' } }, { models: { create: 'bad model' } }]) {
    const root = codexProject(codex)
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    assert.throws(() => loadConfig(root), /codex/)
  }
})
test('legacy project gains Codex defaults without rewriting its config', (t) => {
  const root = modelsProject({ create: 'opus' })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const before = fs.readFileSync(path.join(root, 'docs/runbooks/runbooks.config.json'), 'utf8')
  const result = run(['model', 'create', '--runtime', 'codex', '--root', root])
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'inherit')
  assert.equal(fs.readFileSync(path.join(root, 'docs/runbooks/runbooks.config.json'), 'utf8'), before)
})
test('unknown or valueless runtimes fail even when requesting defaults', () => {
  for (const args of [['--runtime', 'other'], ['--runtime']]) {
    const result = run(['models', '--defaults', '--json', ...args])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /runtime/)
  }
})

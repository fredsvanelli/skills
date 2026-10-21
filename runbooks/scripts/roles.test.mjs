import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import {
  RolesError,
  parseRoles,
  loadRoles,
  keyMatches,
  effectivePermissions,
  allowedActions,
  heirsOf,
  noAccountRoles,
  matrixWarnings,
} from './lib/roles.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-project-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

test('parseRoles adds anonymous and the base actions', () => {
  const registry = parseRoles({ version: 1, roles: { editor: { permissions: {} } } })
  assert.deepEqual(registry.names, ['editor', 'anonymous'])
  assert.deepEqual(registry.actions, ['view', 'create', 'edit', 'delete'])
})

test('effectivePermissions resolves inheritance and overrides', () => {
  const registry = loadRoles(FIXTURE, loadConfig(FIXTURE))
  const manager = effectivePermissions(registry, 'manager')
  assert.deepEqual(manager['billing/invoices'], { actions: ['view', 'create', 'edit', 'approve'], source: 'overridden', from: ['editor'] })
  assert.deepEqual(manager['billing/*'], { actions: ['view'], source: 'inherited', from: ['editor'] })
  assert.deepEqual(allowedActions(registry, 'manager', 'billing', 'invoices'), ['view', 'create', 'edit', 'approve'])
  assert.deepEqual(allowedActions(registry, 'manager', 'billing', 'clients'), ['view'])
  assert.deepEqual(allowedActions(registry, 'viewer', 'deliveries', null), [])
  assert.deepEqual(heirsOf(registry, 'editor'), ['admin', 'manager'])
})

test('keyMatches takes free-text features', () => {
  assert.equal(keyMatches('billing/Open invoices', 'billing', 'Open invoices'), true)
  assert.equal(keyMatches('billing/*', 'billing', null), true)
  assert.equal(keyMatches('billing/invoices', 'billing', null), false)
})

test('parseRoles explains a broken registry', () => {
  assert.throws(() => parseRoles({ version: 1, roles: { manager: { inherits: ['ghost'] } } }), /manager inherits "ghost", which is not a registered role/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { inherits: ['b'] }, b: { inherits: ['a'] } } }), /inheritance cycle: a -> b -> a/)
  assert.throws(() => parseRoles({ version: 1, roles: { anonymous: { inherits: ['a'] }, a: {} } }), /anonymous inherits nothing/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { permissions: { 'billing/invoices': ['fly'] } } } }), /a "billing\/invoices": action "fly" is not in actions/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { permissions: { invoices: ['view'] } } } }), /a: key "invoices" must be <capability>\/<feature> or <capability>\/\*/)
  assert.throws(() => parseRoles({ version: 1, roles: { Editor: {} } }), /role "Editor" must be kebab-case/)
  assert.throws(() => parseRoles({ version: 1, roles: {} }, { accounts: { ghost: {} } }), /accounts\.ghost is not a registered role/)
  assert.throws(() => parseRoles({ version: 1, roles: {} }, { accounts: { anonymous: {} } }), /accounts\.anonymous is not allowed/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { permissions: { 'billing/*': ['view'] }, origins: { 'billing/x': 'guess' } } } }), /a: origins key "billing\/x" is not in permissions/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { permissions: { 'billing/*': ['view'] }, origins: { 'billing/*': 'hunch' } } } }), /a: origin "hunch" for "billing\/\*" must be one of code, contract, guess/)
  assert.throws(() => parseRoles({ version: 2, roles: {} }), /unsupported version 2, expected 1/)
})

test('loadRoles is null when tracking is off and names the file on errors', () => {
  assert.equal(loadRoles(FIXTURE, { ...loadConfig(FIXTURE), roles: { enabled: false } }), null)
  const dir = tmpProject({ 'docs/runbooks/runbooks.config.json': '{ "version": 1, "roles": { "enabled": true } }' })
  assert.throws(() => loadRoles(dir, loadConfig(dir)), (err) => err instanceof RolesError && /docs\/runbooks\/roles\.json not found/.test(err.message))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/roles.json'), '{ nope')
  assert.throws(() => loadRoles(dir, loadConfig(dir)), (err) => err instanceof RolesError && /docs\/runbooks\/roles\.json is not valid JSON/.test(err.message))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/roles.json'), '{ "version": 1, "roles": { "Bad": {} } }')
  assert.throws(() => loadRoles(dir, loadConfig(dir)), (err) => err instanceof RolesError && /docs\/runbooks\/roles\.json: role "Bad" must be kebab-case/.test(err.message))
})

test('noAccountRoles skips anonymous and api runbooks', () => {
  const config = loadConfig(FIXTURE)
  assert.deepEqual(noAccountRoles(config, { surface: 'ui', roles: ['admin', 'viewer', 'anonymous'] }), ['viewer'])
  assert.deepEqual(noAccountRoles(config, { surface: 'api', roles: ['viewer'] }), [])
})

test('matrixWarnings flags keys that match no runbook or slice', () => {
  const registry = parseRoles({
    version: 1,
    roles: { editor: { permissions: { 'billing/invocies': ['view'], 'billing/invoices': ['view'], 'reports/*': ['view'] } } },
  })
  const runbooks = [
    { capability: 'billing', feature: 'invoices' },
    { capability: 'billing', feature: 'invoices' },
  ]
  assert.deepEqual(matrixWarnings(registry, runbooks, { reports: ['src/reports/**'] }), [
    'roles.json: editor "billing/invocies" matches no runbook or slice',
  ])
})

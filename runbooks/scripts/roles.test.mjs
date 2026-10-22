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
  contextOfKey,
  contextOfRunbook,
  actionsByCase,
} from './lib/roles.mjs'

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
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
  assert.throws(() => parseRoles({ version: 3, roles: {} }), /unsupported version 3, expected 1 or 2/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { inherits: ['constructor'] } } }), /a inherits "constructor", which is not a registered role/)
  assert.throws(() => parseRoles({ version: 1, roles: {} }, { accounts: { constructor: {} } }), /accounts\.constructor is not a registered role/)
  assert.throws(() => parseRoles({ version: 1, roles: { a: { permissions: {}, origins: { toString: 'guess' } } } }), /a: origins key "toString" is not in permissions/)
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
  assert.deepEqual(noAccountRoles(config, { surface: 'ui', roles: ['constructor'] }), ['constructor'])
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

test('parseRoles reads contexts and resolves the matrix per case', () => {
  const registry = loadRoles(CONTEXTS, loadConfig(CONTEXTS))
  assert.equal(registry.version, 2)
  assert.deepEqual(registry.caseNames, ['vip-team', 'vip-outside', 'regular'])
  assert.equal(contextOfKey(registry, 'clients/edit'), 'client-access')
  assert.equal(contextOfKey(registry, 'billing/*'), null)
  assert.equal(contextOfRunbook(registry, 'clients', null), 'client-access')
  const admin = effectivePermissions(registry, 'admin')['clients/*']
  assert.deepEqual(admin.cases, { 'vip-team': ['view', 'create', 'edit', 'delete'], 'vip-outside': ['view', 'create', 'edit', 'delete'], regular: ['view', 'create', 'edit', 'delete'] })
  assert.equal(admin.source, 'overridden')
  assert.deepEqual(allowedActions(registry, 'manager', 'clients', 'edit', 'vip-outside'), ['view'])
  assert.throws(() => allowedActions(registry, 'manager', 'clients', 'edit'), /"clients\/\*" depends on context client-access; pass a case/)
  assert.deepEqual(actionsByCase(registry, 'viewer', 'clients', 'edit'), { 'vip-team': ['view'], 'vip-outside': ['view'], regular: ['view'] })
  assert.deepEqual(actionsByCase(registry, 'anonymous', 'clients', 'edit'), { 'vip-team': [], 'vip-outside': [], regular: [] })
  assert.equal(actionsByCase(registry, 'viewer', 'billing', 'invoices'), null)
})

test('a child map replaces the inherited key for every case', () => {
  const registry = parseRoles({ version: 2, contexts: { c: { keys: ['x/*'], cases: { a: '', b: '' } } },
    roles: { p: { permissions: { 'x/*': ['view'] } }, k: { inherits: ['p'], permissions: { 'x/*': { a: ['view', 'edit'] } } } } })
  assert.deepEqual(effectivePermissions(registry, 'k')['x/*'].cases, { a: ['view', 'edit'], b: [] })
})

test('an inherited list counts in every case and parents join per case', () => {
  const registry = parseRoles({ version: 2, contexts: { c: { keys: ['x/*'], cases: { a: '', b: '' } } },
    roles: { p: { permissions: { 'x/*': ['view'] } }, q: { permissions: { 'x/*': { a: ['edit'] } } }, k: { inherits: ['p', 'q'] } } })
  assert.deepEqual(effectivePermissions(registry, 'k')['x/*'].cases, { a: ['view', 'edit'], b: ['view'] })
})

test('origins stays one value per key on a key with a map of cases', () => {
  const registry = parseRoles({ version: 2, contexts: { c: { keys: ['x/*'], cases: { a: '', b: '' } } },
    roles: { r: { permissions: { 'x/*': { a: ['view'] } }, origins: { 'x/*': 'guess' } } } })
  assert.deepEqual(registry.roles.r.origins, { 'x/*': 'guess' })
  assert.throws(() => parseRoles({ version: 2, contexts: { c: { keys: ['x/*'], cases: { a: '' } } },
    roles: { r: { permissions: { 'x/*': { a: ['view'] } }, origins: { 'x/*': { a: 'guess' } } } } }), /for "x\/\*" must be one of code, contract, guess/)
})

test('parseRoles explains a broken context', () => {
  const ctx = (contexts, roles = {}) => () => parseRoles({ version: 2, contexts, roles })
  assert.throws(() => parseRoles({ version: 1, contexts: {}, roles: {} }), /contexts need version 2/)
  assert.throws(() => parseRoles({ version: 3, roles: {} }), /unsupported version 3, expected 1 or 2/)
  assert.throws(ctx({ Bad: { keys: ['x/*'], cases: { a: '' } } }), /context "Bad" must be kebab-case/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { A: '' } } }), /case "A" must be kebab-case/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { a: '' } }, d: { keys: ['y/*'], cases: { a: '' } } }), /case "a" appears in contexts c and d/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { a: '' } }, d: { keys: ['x/edit'], cases: { b: '' } } }), /key "x\/edit" belongs to contexts c and d/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { a: '' } } }, { r: { permissions: { 'y/*': { a: ['view'] } } } }), /r "y\/\*": a map of cases needs a key that belongs to a context/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { a: '' } } }, { r: { permissions: { 'x/*': { constructor: ['view'] } } } }), /r "x\/\*": case "constructor" is not a case of c/)
  assert.throws(ctx({ c: { keys: 'x/*', cases: { a: '' } } }), /context "c": keys must be a list of matrix keys/)
  assert.throws(ctx({ c: { keys: ['x'], cases: { a: '' } } }), /context "c": key "x" must be <capability>\/<feature> or <capability>\/\*/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: ['a'] } }), /context "c": cases must map each case to a description/)
  assert.throws(ctx({ c: { keys: ['x/*'], cases: { a: '' } } }, { r: { permissions: { 'x/*': { a: ['fly'] } } } }), /r "x\/\*" in a: action "fly" is not in actions/)
})

test('matrixWarnings flags a context key that matches nothing and a context with one case', () => {
  const registry = parseRoles({ version: 2, contexts: { c: { keys: ['x/*'], cases: { a: '' } } }, roles: {} })
  assert.deepEqual(matrixWarnings(registry, [], {}), ['roles.json: context c key "x/*" matches no runbook or slice', 'roles.json: context c has fewer than two cases'])
})

test('a key of no context gets no cases even when a context is named null', () => {
  const registry = parseRoles({ version: 2, contexts: { null: { keys: ['x/*'], cases: { a: '', b: '' } } },
    roles: { r: { permissions: { 'y/*': ['view'], 'x/*': { a: ['view'] } } } } })
  const matrix = effectivePermissions(registry, 'r')
  assert.deepEqual(matrix['y/*'], { actions: ['view'], source: 'own', from: [] })
  assert.deepEqual(matrix['x/*'].cases, { a: ['view'], b: [] })
})

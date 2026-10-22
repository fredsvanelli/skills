import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRoles } from './lib/roles.mjs'
import { planMerge } from './lib/roles-merge.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
const PROJECT = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const ROLES_FILE = 'docs/runbooks/roles.json'

// A copy of a fixture, so a write never touches the fixture.
function copy(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-merge-'))
  fs.cpSync(fixture, dir, { recursive: true })
  return dir
}

const plan = (dir, proposal, options) => planMerge(dir, loadConfig(dir), JSON.stringify(proposal), options)
const readRoles = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8'))

test('an empty proposal changes nothing', () => {
  const dir = copy(FIXTURE)
  const before = fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8')
  const result = plan(dir, {}, { write: true })
  assert.deepEqual([result.changes, result.rolesAdded, result.written], [[], [], false])
  assert.equal(fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8'), before)
})

test('a key the proposal gives replaces the own entry and the keys it leaves out stay', () => {
  const dir = copy(FIXTURE)
  const result = plan(dir, {
    actions: ['export', 'approve'],
    roles: { editor: { permissions: { 'billing/invoices': ['edit', 'view', 'export'], 'billing/reports': ['view'] }, origins: { 'billing/reports': 'guess' } } },
  }, { write: true })
  assert.deepEqual(result.actionsAdded, ['export'])
  assert.deepEqual(result.changes, [
    { role: 'editor', key: 'billing/invoices', before: ['view', 'create', 'edit', 'delete'], after: ['view', 'edit', 'export'], guess: false },
    { role: 'editor', key: 'billing/reports', before: null, after: ['view'], guess: true },
  ])
  const roles = readRoles(dir)
  assert.deepEqual(roles.actions, ['approve', 'export'])
  assert.deepEqual(Object.keys(roles.roles.editor.permissions), ['billing/invoices', 'billing/*', 'billing/reports'])
  assert.deepEqual(roles.roles.editor.origins, { 'billing/reports': 'guess' })
  assert.deepEqual(roles.roles.viewer, readRoles(FIXTURE).roles.viewer)
})

test('an unchanged key keeps its origin and a changed key takes the proposal origin', () => {
  const dir = copy(FIXTURE)
  plan(dir, { roles: { viewer: { permissions: { 'billing/*': ['view'] } } } }, { write: true })
  assert.deepEqual(readRoles(dir).roles.viewer.origins, { 'billing/*': 'guess' })
  plan(dir, { roles: { viewer: { permissions: { 'billing/*': ['view', 'edit'] } } } }, { write: true })
  assert.equal(readRoles(dir).roles.viewer.origins, undefined)
})

test('remove drops an own key and its origin', () => {
  const dir = copy(FIXTURE)
  const result = plan(dir, { remove: [{ role: 'viewer', key: 'billing/*' }] }, { write: true })
  assert.deepEqual(result.changes, [{ role: 'viewer', key: 'billing/*', before: ['view'], after: null }])
  const viewer = readRoles(dir).roles.viewer
  assert.deepEqual([viewer.permissions, viewer.origins], [{}, undefined])
  assert.throws(() => plan(dir, { remove: [{ role: 'viewer', key: 'billing/*' }] }), /remove: viewer has no own key "billing\/\*"/)
  assert.throws(() => plan(dir, {
    roles: { editor: { permissions: { 'billing/*': [] } } },
    remove: [{ role: 'editor', key: 'billing/*' }],
  }), /editor "billing\/\*" is both in permissions and in remove/)
})

test('a new role gets its description, parents, found and matrix', () => {
  const dir = copy(FIXTURE)
  const result = plan(dir, {
    roles: {
      auditor: {
        description: 'Reads every invoice',
        inherits: ['viewer'],
        found: ['docs/access.pdf'],
        permissions: { 'billing/invoices': ['view', 'approve'] },
        origins: { 'billing/invoices': 'guess' },
      },
      clerk: { description: 'Types invoices' },
    },
  }, { write: true })
  assert.deepEqual(result.rolesAdded, [
    { name: 'auditor', description: 'Reads every invoice', inherits: ['viewer'], found: ['docs/access.pdf'], permissions: { 'billing/invoices': ['view', 'approve'] }, guesses: ['billing/invoices'] },
    { name: 'clerk', description: 'Types invoices', inherits: [], found: ['user'], permissions: {}, guesses: [] },
  ])
  assert.deepEqual(result.changes, [])
  const roles = readRoles(dir).roles
  assert.deepEqual(roles.auditor, {
    description: 'Reads every invoice',
    inherits: ['viewer'],
    found: ['docs/access.pdf'],
    permissions: { 'billing/invoices': ['view', 'approve'] },
    origins: { 'billing/invoices': 'guess' },
  })
  assert.deepEqual(roles.clerk, { description: 'Types invoices', found: ['user'], permissions: {} })
})

test('a registered role keeps its parents and found', () => {
  const dir = copy(FIXTURE)
  assert.throws(() => plan(dir, { roles: { manager: { inherits: ['viewer'] } } }), /manager" is registered, so its parents change with \/runbooks:roles:update/)
  assert.throws(() => plan(dir, { roles: { manager: { found: ['x.pdf'] } } }), /found applies to a new role only/)
  assert.deepEqual(plan(dir, { roles: { manager: { inherits: ['editor'] } } }).changes, [])
  const result = plan(dir, { roles: { manager: { description: 'Runs billing' } } }, { write: true })
  assert.deepEqual(result.rolesChanged, [{ name: 'manager', before: 'Billing manager', after: 'Runs billing' }])
  assert.equal(readRoles(dir).roles.manager.description, 'Runs billing')
})

test('a new context lands after actions, bumps the version and takes maps', () => {
  const dir = copy(FIXTURE)
  const result = plan(dir, {
    contexts: { 'invoice-size': { description: 'How big the invoice is', keys: ['billing/invoices'], cases: { small: 'under 1000', large: '1000 or more' } } },
    roles: { editor: { permissions: { 'billing/invoices': { large: ['view'], small: ['edit', 'view'] } } } },
  }, { write: true })
  assert.deepEqual(result.contextsAdded, [{ name: 'invoice-size', keys: ['billing/invoices'], cases: ['small', 'large'] }])
  assert.deepEqual(result.changes[0].after, { small: ['view', 'edit'], large: ['view'] })
  const roles = readRoles(dir)
  assert.deepEqual(Object.keys(roles), ['version', 'actions', 'contexts', 'roles'])
  assert.equal(roles.version, 2)
  assert.deepEqual(loadRoles(dir, loadConfig(dir)).contexts['invoice-size'].cases, ['small', 'large'])
})

test('a list equal to the map in every case is no change', () => {
  const dir = copy(CONTEXTS)
  assert.deepEqual(plan(dir, { roles: { viewer: { permissions: { 'clients/*': { 'vip-team': ['view'], 'vip-outside': ['view'], regular: ['view'] } } } } }).changes, [])
})

test('a case added to a context is reported for the maps that leave it out', () => {
  const dir = copy(CONTEXTS)
  const result = plan(dir, {
    contexts: { 'client-access': { cases: { prospect: 'client with no contract yet', regular: 'client that is not VIP' } } },
    roles: { viewer: { permissions: { 'clients/*': { 'vip-team': ['view'] } } } },
  }, { write: true })
  assert.deepEqual(result.contextsChanged, [{ name: 'client-access', keysAdded: [], casesAdded: ['prospect'], described: [] }])
  assert.deepEqual(result.missingCases, [
    { role: 'viewer', key: 'clients/*', cases: ['vip-outside', 'regular', 'prospect'] },
    { role: 'manager', key: 'clients/*', cases: ['prospect'] },
  ])
  assert.deepEqual(Object.keys(readRoles(dir).contexts['client-access'].cases), ['vip-team', 'vip-outside', 'regular', 'prospect'])
})

test('the proposal shape and the merged registry are checked before any write', () => {
  const dir = copy(CONTEXTS)
  const before = fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8')
  const fails = (proposal, pattern) => assert.throws(() => plan(dir, proposal, { write: true }), pattern)
  fails({ users: {} }, /the proposal: unknown field users/)
  fails({ actions: ['Approve'] }, /action "Approve" must be lowercase English/)
  fails({ roles: { auditor: { permissions: {} } } }, /role "auditor" is new, so it needs a description/)
  fails({ roles: { viewer: { origins: { 'clients/*': 'code' } } } }, /origin "code" for "clients\/\*" must be guess/)
  fails({ roles: { viewer: { permissions: { clients: ['view'] } } } }, /key "clients" must be <capability>\/<feature>/)
  fails({ contexts: { tier: { keys: ['billing/*'] } } }, /context "tier" is new, so it needs keys and cases/)
  fails({ roles: { viewer: { permissions: { 'billing/*': ['approve'] } } } }, /the merged registry does not load: viewer "billing\/\*": action "approve" is not in actions/)
  fails({ roles: { viewer: { permissions: { 'clients/*': { gold: ['view'] } } } } }, /case "gold" is not a case of client-access/)
  fails({ roles: { auditor: { description: 'x', inherits: ['ghost'] } } }, /auditor inherits "ghost", which is not a registered role/)
  assert.throws(() => planMerge(dir, loadConfig(dir), '{ nope'), /the proposal is not valid JSON/)
  assert.equal(fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8'), before)
})

test('merge-roles runs from the CLI and needs tracking on', () => {
  const dir = copy(FIXTURE)
  fs.writeFileSync(path.join(dir, 'proposal.json'), JSON.stringify({ roles: { viewer: { permissions: { 'billing/*': ['view', 'edit'] } } } }))
  const dry = run(['merge-roles', '--file', 'proposal.json', '--root', dir])
  assert.equal(dry.code, 0)
  assert.match(dry.stdout, /\| viewer \| billing\/\* \| view \| view, edit \|/)
  assert.match(dry.stdout, /Dry run: nothing written/)
  const written = JSON.parse(run(['merge-roles', '--file', 'proposal.json', '--write', '--json', '--root', dir]).stdout)
  assert.equal(written.written, true)
  assert.equal(written.proposal, 'proposal.json')
  assert.match(run(['merge-roles', '--file', 'proposal.json', '--root', dir]).stdout, /Nothing to change\./)
  assert.match(run(['merge-roles', '--root', dir]).stderr, /merge-roles needs --file <json>/)
  assert.match(run(['merge-roles', '--file', 'nope.json', '--root', dir]).stderr, /nope\.json not found/)
  const off = run(['merge-roles', '--file', 'proposal.json', '--root', PROJECT])
  assert.equal(off.code, 2)
})

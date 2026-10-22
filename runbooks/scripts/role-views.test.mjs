import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { loadRoles, parseRoles } from './lib/roles.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { roleResult, roleRows, roleDetail, affectedByChange, citingRole } from './lib/role-views.mjs'

const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
const config = loadConfig(ROLES)
const registry = loadRoles(ROLES, config)
const runbooks = loadRunbooks(ROLES, config)

test('roleResult reads only the rows of the role', () => {
  const steps = [
    { step: 'S01', state: 'passed', role: 'a' },
    { step: 'S02', state: 'failed', role: 'b' },
    { step: 'S03', state: 'not-applicable', role: 'a' },
    { step: 'S01', state: 'no-account', role: 'c' },
    { step: 'S02', state: 'blocked-by-parent', role: 'd' },
    { step: 'S03', state: 'blocked', role: 'e' },
    { step: 'S03', state: 'failed', role: 'e' },
    { step: 'S04', state: 'waived', role: 'f' },
  ]
  assert.equal(roleResult(steps, 'a'), 'passed')
  assert.equal(roleResult(steps, 'b'), 'failed')
  assert.equal(roleResult(steps, 'c'), 'no-account')
  assert.equal(roleResult(steps, 'd'), 'blocked')
  assert.equal(roleResult(steps, 'e'), 'failed')
  assert.equal(roleResult(steps, 'f'), 'passed')
  assert.equal(roleResult(steps, 'z'), null)
})

test('affectedByChange reaches heirs and matching features', () => {
  assert.deepEqual(affectedByChange(registry, runbooks, 'editor', 'billing/invoices'), [
    { role: 'editor', runbooks: ['billing.cancel-invoice', 'billing.create-invoice'] },
    { role: 'admin', runbooks: ['billing.cancel-invoice', 'billing.create-invoice', 'billing.legacy'] },
    { role: 'manager', runbooks: ['billing.cancel-invoice', 'billing.create-invoice'] },
  ])
  assert.deepEqual(affectedByChange(registry, runbooks, 'editor', 'other/*'), [])
})

test('roleRows counts runbooks, reviews, guesses and results', () => {
  const rows = roleRows(ROLES, config, registry, runbooks)
  assert.equal(rows.length, 5)
  const manager = rows.find((r) => r.name === 'manager')
  assert.equal(manager.reviews, 1)
  assert.equal(manager.runbooks, 2)
  assert.equal(manager.results.failed, 1)
  assert.equal(manager.results.never, 1)
  assert.deepEqual(manager.account, { emailEnv: 'UAT_MANAGER_EMAIL', passwordEnv: 'UAT_MANAGER_PASSWORD' })
  assert.deepEqual(manager.inherits, ['editor'])
  const viewer = rows.find((r) => r.name === 'viewer')
  assert.deepEqual(viewer.guesses, ['billing/*'])
  assert.equal(viewer.account, null)
  assert.equal(viewer.results['no-account'], 1)
})

test('roleDetail lists effective permissions and per-viewport states', () => {
  const detail = roleDetail(ROLES, config, registry, runbooks, 'manager')
  assert.equal(detail.effective['billing/invoices'].source, 'overridden')
  const cancel = detail.runbooksOf.find((r) => r.id === 'billing.cancel-invoice')
  assert.deepEqual(cancel.states, [{ viewport: 'desktop', result: 'failed' }, { viewport: 'mobile', result: 'passed' }])
  assert.equal(cancel.review, true)
  assert.deepEqual(cancel.outcomes, ['allowed'])
  assert.deepEqual(detail.runbooksOf.find((r) => r.id === 'billing.create-invoice').states, [])
  const viewer = roleDetail(ROLES, config, registry, runbooks, 'viewer')
  assert.deepEqual(viewer.runbooksOf.find((r) => r.id === 'billing.cancel-invoice').outcomes, ['read-only'])
  assert.equal(roleDetail(ROLES, config, registry, runbooks, 'nobody'), null)
})

test('roleDetail handles a role named like an Object key', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROLES, 'docs/runbooks/roles.json'), 'utf8'))
  const withConstructor = parseRoles({ ...raw, roles: { ...raw.roles, constructor: { description: 'Edge case' } } })
  const all = runbooks.map((rb) => ({ ...rb, roles: [...rb.roles, 'constructor'] }))
  const detail = roleDetail(ROLES, config, withConstructor, all, 'constructor')
  assert.deepEqual(detail.runbooksOf.find((r) => r.id === 'billing.cancel-invoice').outcomes, ['allowed'])
})

test('citingRole lists places and heirs', () => {
  const editor = citingRole(ROLES, registry, runbooks, 'editor')
  assert.deepEqual(editor.heirs, ['admin', 'manager'])
  assert.deepEqual(editor.runbooks, [
    { id: 'billing.cancel-invoice', path: 'docs/runbooks/billing/cancel-invoice.md', places: ['roles', 'role line'] },
    { id: 'billing.create-invoice', path: 'docs/runbooks/billing/create-invoice.md', places: ['roles'] },
  ])
  const admin = citingRole(ROLES, registry, runbooks, 'admin')
  assert.deepEqual(admin.runbooks.find((r) => r.id === 'billing.legacy').places, ['roles', 'As:'])
})

test('citingRole lists a runbook whose only link to the role is a review entry', () => {
  const base = runbooks.find((r) => r.id === 'billing.create-invoice')
  const only = { ...base, roles: ['admin'], review: [{ reason: 'role-permissions', role: 'editor', key: 'billing/invoices', change: 'delete removed', date: '2026-10-22' }] }
  const cited = citingRole(ROLES, registry, [only], 'editor')
  assert.deepEqual(cited.runbooks, [{ id: only.id, path: only.path, places: ['review'] }])
})

test('citingRole counts role lines with a case', () => {
  const dir = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
  const cfg = loadConfig(dir)
  const cited = citingRole(dir, loadRoles(dir, cfg), loadRunbooks(dir, cfg), 'manager')
  const edit = cited.runbooks.find((rb) => rb.id === 'clients.edit-client')
  assert.ok(edit.places.includes('role line'))
})

test('roleDetail shows states per case and viewport', () => {
  const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
  const cfg = loadConfig(CONTEXTS)
  const detail = roleDetail(CONTEXTS, cfg, loadRoles(CONTEXTS, cfg), loadRunbooks(CONTEXTS, cfg), 'manager')
  const states = detail.runbooksOf.find((rb) => rb.id === 'clients.edit-client').states
  assert.deepEqual(states.map((s) => s.case), ['vip-team', 'vip-outside', 'regular'])
  assert.ok(states.every((s) => s.viewport === null && s.result === 'passed'))
})

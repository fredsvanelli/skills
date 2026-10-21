import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { loadRoles } from './lib/roles.mjs'
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

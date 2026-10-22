import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { roleHistory, diffMatrices } from './lib/role-history.mjs'

const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
const REGISTRY = 'docs/runbooks/roles.json'

function tmpCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-history-'))
  fs.cpSync(ROLES, dir, { recursive: true })
  return dir
}

const git = (dir, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const editRegistry = (dir, edit) => {
  const file = path.join(dir, REGISTRY)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  edit(raw)
  fs.writeFileSync(file, JSON.stringify(raw, null, 2))
}

test('roleHistory reads permission changes from git', (t) => {
  const dir = tmpCopy()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q')
  editRegistry(dir, (raw) => { raw.roles.manager.permissions['billing/invoices'].push('delete') })
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'one')
  editRegistry(dir, (raw) => { raw.roles.manager.permissions['billing/invoices'] = ['view', 'create', 'edit', 'approve'] })
  const runbook = path.join(dir, 'docs/runbooks/billing/create-invoice.md')
  fs.writeFileSync(runbook, fs.readFileSync(runbook, 'utf8').replace(
    'status: draft\n',
    'status: draft\nreview: [{ reason: role-permissions, role: manager, key: billing/invoices, change: delete removed, date: 2026-10-20 }]\n'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'two')

  const config = loadConfig(dir)
  const manager = roleHistory(dir, config, 'manager')
  assert.equal(manager.length, 2)
  assert.deepEqual(manager[0].changes, ['billing/invoices: delete removed'])
  assert.equal(manager[0].marked, 1)
  assert.match(manager[0].date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(manager[0].commit, /^[0-9a-f]{7,}$/)
  assert.ok(manager[1].changes.includes('billing/invoices: key added'))

  const viewer = roleHistory(dir, config, 'viewer')
  assert.equal(viewer.length, 1)
  assert.deepEqual(viewer[0].changes, ['billing/*: key added'])
  assert.equal(roleHistory(dir, config, 'manager', { limit: 1 }).length, 1)
})

test('roleHistory is empty outside git', (t) => {
  const dir = tmpCopy()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(roleHistory(dir, loadConfig(dir), 'manager'), [])
})

test('roleHistory does not count review lines of a role whose name starts with this one', (t) => {
  const dir = tmpCopy()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'one')
  editRegistry(dir, (raw) => {
    raw.roles.manager.permissions['billing/invoices'].push('delete')
    raw.roles['manager-2'] = { description: 'Second manager', found: ['user'], permissions: { 'billing/*': ['view'] } }
  })
  const runbook = path.join(dir, 'docs/runbooks/billing/create-invoice.md')
  fs.writeFileSync(runbook, fs.readFileSync(runbook, 'utf8').replace(
    'status: draft\n',
    'status: draft\nreview: [{ reason: role-permissions, role: manager-2, key: billing/*, change: key added, date: 2026-10-20 }]\n'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'two')
  const [latest] = roleHistory(dir, loadConfig(dir), 'manager')
  assert.deepEqual(latest.changes, ['billing/invoices: delete added'])
  assert.equal(latest.marked, 0)
  assert.equal(roleHistory(dir, loadConfig(dir), 'manager-2')[0].marked, 1)
})

test('diffMatrices reports changes per case', () => {
  const before = { 'clients/*': { actions: ['view', 'edit'], cases: { a: ['view', 'edit'], b: ['view'] } } }
  const after = { 'clients/*': { actions: ['view'], cases: { a: ['view'], b: ['view'] } } }
  assert.deepEqual(diffMatrices(before, after), ['clients/*: a: edit removed'])
})

test('diffMatrices counts a list as the same actions in every case', () => {
  const list = { 'clients/*': { actions: ['view', 'edit'] } }
  const map = { 'clients/*': { actions: ['view'], cases: { a: ['view', 'edit'], b: ['view'] } } }
  assert.deepEqual(diffMatrices(list, map), ['clients/*: b: edit removed'])
  assert.deepEqual(diffMatrices(map, list), ['clients/*: b: edit added'])
  assert.deepEqual(diffMatrices(list, list), [])
})

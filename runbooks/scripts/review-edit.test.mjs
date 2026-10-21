import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { planReview, planEnableRoles } from './lib/review-edit.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const CONFIG = 'docs/runbooks/runbooks.config.json'
const RUNBOOKS = 'docs/runbooks'

// A copy of the fixture with role tracking on, admin and partner registered, and a placeholder runbook.
function project(t, { enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-review-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.cpSync(FIXTURE, root, { recursive: true })
  const file = path.join(root, CONFIG)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.roles = { enabled }
  fs.writeFileSync(file, JSON.stringify(raw, null, 2))
  fs.writeFileSync(path.join(root, RUNBOOKS, 'roles.json'), JSON.stringify({ version: 1, roles: { admin: {}, partner: {} } }))
  const cancel = path.join(root, RUNBOOKS, 'billing/cancel-invoice.md')
  fs.writeFileSync(cancel, fs.readFileSync(cancel, 'utf8').replace('status: draft', 'status: placeholder'))
  return { root, config: loadConfig(root) }
}

const read = (root, rel) => fs.readFileSync(path.join(root, RUNBOOKS, rel), 'utf8')
const files = ['billing/cancel-invoice.md', 'billing/issue-invoice.md', 'deliveries/list-deliveries.md', 'deliveries/old-list.md', 'broken/bad-frontmatter.md']
const snapshot = (root) => Object.fromEntries(files.map((rel) => [rel, read(root, rel)]))

test('planEnableRoles marks every runbook but placeholders and deprecated', (t) => {
  const { root, config } = project(t)
  const before = snapshot(root)
  const dry = planEnableRoles(root, config, { date: '2026-10-21' })
  assert.deepEqual(dry.runbooks.map((rb) => [rb.id, rb.roles, rb.review]), [
    ['billing.cancel-invoice', 'all', false],
    ['billing.issue-invoice', 'all', true],
    ['deliveries.list-deliveries', 'all', true],
  ])
  assert.deepEqual(dry.skipped.map((s) => s.id), ['broken.bad-frontmatter'])
  assert.deepEqual(snapshot(root), before)

  const written = planEnableRoles(root, config, { date: '2026-10-21', write: true })
  assert.equal(written.written.length, 3)
  assert.match(read(root, 'billing/issue-invoice.md'), /\nroles: all\nreview:\n {2}- \{ reason: roles-enabled, date: 2026-10-21 \}\n/)
  assert.doesNotMatch(read(root, 'billing/cancel-invoice.md'), /review:/)
  assert.equal(read(root, 'deliveries/old-list.md'), before['deliveries/old-list.md'])
  assert.equal(read(root, 'broken/bad-frontmatter.md'), before['broken/bad-frontmatter.md'])
  const loaded = loadRunbooks(root, config)
  assert.deepEqual(loaded.find((rb) => rb.id === 'billing.issue-invoice').review, [{ reason: 'roles-enabled', date: '2026-10-21' }])

  assert.deepEqual(planEnableRoles(root, config, { date: '2026-10-22' }).runbooks, [])
})

test('planReview adds once and clears', (t) => {
  const { root, config } = project(t)
  const entry = { reason: 'role-permissions', role: 'partner', key: 'billing/invoices', change: 'delete removed', date: '2026-10-14' }
  const first = planReview(root, config, ['billing.issue-invoice'], { entry, write: true })
  assert.deepEqual(first.runbooks[0].review, [entry])
  assert.match(read(root, 'billing/issue-invoice.md'), /\nroles: \[admin\]\nreview:\n {2}- \{ reason: role-permissions, role: partner, key: billing\/invoices, change: delete removed, date: 2026-10-14 \}\n/)
  const once = read(root, 'billing/issue-invoice.md')
  const second = planReview(root, config, ['billing.issue-invoice'], { entry: { ...entry, date: '2026-10-20' }, write: true })
  assert.equal(second.runbooks[0].review.length, 1)
  assert.deepEqual(second.written, [])
  assert.equal(read(root, 'billing/issue-invoice.md'), once)

  planReview(root, config, ['billing.issue-invoice'], { clear: true, write: true })
  assert.doesNotMatch(read(root, 'billing/issue-invoice.md'), /review/)
})

test('planReview throws for an unknown id', (t) => {
  const { root, config } = project(t)
  assert.throws(() => planReview(root, config, ['nope.nope'], { entry: { reason: 'roles-enabled', date: '2026-10-21' } }), /no runbook with id "nope.nope"/)
})

test('mark-review and enable-roles are dry runs without --write and refuse when tracking is off', (t) => {
  const { root } = project(t)
  const before = snapshot(root)
  const dry = run(['mark-review', 'billing.issue-invoice', '--reason', 'role-created', '--role', 'partner', '--root', root])
  assert.equal(dry.code, 0, dry.stderr)
  assert.match(dry.stdout, /Dry run: nothing written/)
  assert.match(dry.stdout, /role-created partner/)
  const enable = run(['enable-roles', '--date', '2026-10-21', '--root', root, '--json'])
  assert.equal(enable.code, 0, enable.stderr)
  assert.equal(JSON.parse(enable.stdout).runbooks.length, 3)
  assert.deepEqual(snapshot(root), before)

  const done = run(['mark-review', 'billing.issue-invoice', 'deliveries.list-deliveries', '--reason', 'roles-enabled', '--date', '2026-10-21', '--write', '--root', root])
  assert.equal(done.code, 0, done.stderr)
  assert.match(done.stdout, /Written: .*issue-invoice\.md/)
  assert.match(read(root, 'deliveries/list-deliveries.md'), /review:\n {2}- \{ reason: roles-enabled, date: 2026-10-21 \}/)

  const off = project(t, { enabled: false })
  for (const args of [['enable-roles'], ['mark-review', 'billing.issue-invoice', '--reason', 'roles-enabled']]) {
    const result = run([...args, '--root', off.root])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /role tracking is off; \/runbooks:settings roles turns it on/)
  }
})

test('with --write and nothing to change the output says so instead of "Dry run"', (t) => {
  const { root } = project(t)
  const args = ['enable-roles', '--date', '2026-10-21', '--write', '--root', root]
  const first = run(args)
  assert.equal(first.code, 0, first.stderr)
  assert.match(first.stdout, /Written: /)
  const second = run(args)
  assert.equal(second.code, 0, second.stderr)
  assert.match(second.stdout, /Nothing to change\./)
  assert.doesNotMatch(second.stdout, /Dry run/)
})

test('mark-review --clear --write removes the review key', (t) => {
  const { root } = project(t)
  run(['enable-roles', '--date', '2026-10-21', '--write', '--root', root])
  assert.match(read(root, 'billing/issue-invoice.md'), /review:/)
  const result = run(['mark-review', 'billing.issue-invoice', '--clear', '--write', '--root', root])
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(read(root, 'billing/issue-invoice.md'), /review:/)
})

test('mark-review names what is missing', (t) => {
  const { root } = project(t)
  const call = (...args) => run(['mark-review', 'billing.issue-invoice', ...args, '--root', root])
  assert.match(call().stderr, /needs --reason/)
  assert.match(call('--reason', 'bogus').stderr, /must be one of/)
  assert.match(call('--reason', 'role-created').stderr, /needs --role/)
  assert.match(call('--reason', 'role-permissions', '--role', 'partner').stderr, /needs --key, --change/)
  assert.match(call('--reason', 'roles-enabled', '--date', 'soon').stderr, /YYYY-MM-DD/)
})

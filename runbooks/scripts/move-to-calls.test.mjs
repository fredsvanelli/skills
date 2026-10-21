import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const CONFIG = 'docs/runbooks/runbooks.config.json'

// The fixture reads endpoints from the sibling ../api, the case docs/adr/0005 migrates away from.
function project(t, edit = (raw) => raw) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-move-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const root = path.join(tmp, 'project')
  fs.cpSync(FIXTURE, root, { recursive: true })
  fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
  const file = path.join(root, CONFIG)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.upstream = { mode: 'live', urlEnv: 'API_URL' }
  fs.writeFileSync(file, JSON.stringify(edit(raw), null, 2))
  return { root, tmp }
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const snapshot = (root) => Object.fromEntries(['billing/cancel-invoice.md', 'billing/issue-invoice.md', 'deliveries/list-deliveries.md', 'deliveries/old-list.md']
  .map((rel) => [rel, read(root, `docs/runbooks/${rel}`)]))
const moveJson = (root, ...args) => {
  const result = run(['move-to-calls', ...args, '--root', root, '--json'])
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('move-to-calls --source is a dry run that lists the moves and the coverage before and after', (t) => {
  const { root } = project(t)
  const before = snapshot(root)
  const plan = moveJson(root, '--source', '1')
  assert.equal(plan.source, 1)
  assert.equal(plan.sourceRoot, '../api')
  assert.deepEqual(plan.runbooks.map(({ id, move, calls }) => ({ id, move, calls })), [
    { id: 'billing.cancel-invoice', move: ['DELETE /admin/invoices/[id]'], calls: ['DELETE /admin/invoices/{id}'] },
    { id: 'billing.issue-invoice', move: ['POST /admin/invoices'], calls: ['POST /admin/invoices'] },
  ])
  assert.deepEqual(plan.orphansLeft, [{ runbook: 'deliveries.list-deliveries', ref: '/deliveries/[deliveryId]' }])
  const coverage = JSON.parse(run(['coverage', '--root', root, '--json']).stdout).entries
  assert.deepEqual(plan.coverage.before, { covered: coverage.covered, total: coverage.total })
  assert.deepEqual(plan.coverage.after, { covered: 2, total: 6 })
  assert.deepEqual(plan.written, [])
  assert.deepEqual(snapshot(root), before)
  const markdown = run(['move-to-calls', '--source', '1', '--root', root]).stdout
  assert.match(markdown, /^Entry coverage: 3 of 9 \(33\.3%\) now, 2 of 6 \(33\.3%\) after\.$/m)
  assert.match(markdown, /^Dry run: nothing written\. Run again with --write to apply\.$/m)
})

test('move-to-calls --write edits only covers.entries and calls, and a second run changes nothing', (t) => {
  const { root } = project(t)
  const before = snapshot(root)
  const plan = moveJson(root, '--source', '1', '--write')
  assert.deepEqual(plan.written, ['docs/runbooks/billing/cancel-invoice.md', 'docs/runbooks/billing/issue-invoice.md'])
  const issue = read(root, 'docs/runbooks/billing/issue-invoice.md')
  assert.equal(issue, before['billing/issue-invoice.md'].replace(
    '  entries: ["/billing/invoices", "POST /admin/invoices"]\n  requirements: [REQ-1]\n',
    '  entries: [/billing/invoices]\n  requirements: [REQ-1]\ncalls: [POST /admin/invoices]\n'))
  assert.equal(read(root, 'docs/runbooks/deliveries/list-deliveries.md'), before['deliveries/list-deliveries.md'])
  const config = loadConfig(root)
  const cancel = loadRunbooks(root, config).find((rb) => rb.id === 'billing.cancel-invoice')
  assert.deepEqual([cancel.covers.entries, cancel.calls, cancel.problems], [['/billing/invoices/[id]'], ['DELETE /admin/invoices/{id}'], []])
  assert.equal(cancel.status, 'draft')
  const after = snapshot(root)
  const again = moveJson(root, '--source', '1', '--write')
  assert.deepEqual([again.runbooks, again.written], [[], []])
  assert.deepEqual(snapshot(root), after)
})

test('without --source, once the source is gone, the orphan endpoint ids move and ui-route orphans stay', (t) => {
  const { root, tmp } = project(t, (raw) => ({ ...raw, entries: raw.entries.slice(0, 1), slices: { billing: ['src/app/[locale]/(dashboard)/billing/**'] } }))
  fs.rmSync(path.join(tmp, 'api'), { recursive: true })
  const plan = moveJson(root, '--write')
  assert.equal(plan.source, null)
  assert.deepEqual(plan.runbooks.map(({ id, calls }) => [id, calls]), [
    ['billing.cancel-invoice', ['DELETE /admin/invoices/{id}']],
    ['billing.issue-invoice', ['POST /admin/invoices']],
  ])
  assert.deepEqual(plan.orphansLeft, [{ runbook: 'deliveries.list-deliveries', ref: '/deliveries/[deliveryId]' }])
  const orphans = JSON.parse(run(['coverage', '--root', root, '--json']).stdout).orphans.filter((o) => o.kind === 'entry')
  assert.deepEqual(orphans, [{ runbook: 'deliveries.list-deliveries', kind: 'entry', ref: '/deliveries/[deliveryId]' }])
})

test('move-to-calls refuses what it cannot do safely', (t) => {
  const { root, tmp } = project(t)
  const fail = (args, message) => {
    const result = run(['move-to-calls', ...args, '--root', root])
    assert.equal(result.code, 2, args.join(' '))
    assert.match(result.stderr, message)
  }
  fail(['--source', '0'], /^runbooks: entries\[0\] is inside the project: its ids stay entries$/m)
  fail(['--source', '7'], /^runbooks: --source must be the index of an entries source, from 0 to 1$/m)
  fail([], /^runbooks: entries\[1\] still reads "\.\.\/api": pass --source 1$/m)
  fs.rmSync(path.join(tmp, 'api'), { recursive: true })
  fail(['--source', '1'], /^runbooks: entries\[1\]: root "\.\.\/api" does not exist, so its ids cannot be read\. Remove the source from the config and run move-to-calls without --source$/m)
  fail([], /^runbooks: entries\[1\] did not run, so an orphan cannot be told from an unread id\. Remove the source from the config first$/m)
  const file = path.join(root, CONFIG)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete raw.upstream
  fs.writeFileSync(file, JSON.stringify(raw))
  fail([], /^runbooks: calls need an upstream block in the config: run \/runbooks:settings upstream first$/m)
})

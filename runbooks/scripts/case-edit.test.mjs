import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { rewriteCases } from './lib/case-edit.mjs'

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
const EDIT = 'docs/runbooks/clients/edit-client.md'
const FIXTURES = 'docs/runbooks/_fixtures/clients/edit-client'

function copyContexts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-contexts-'))
  fs.cpSync(CONTEXTS, dir, { recursive: true })
  return dir
}

const read = (dir, file = EDIT) => fs.readFileSync(path.join(dir, file), 'utf8')
const fixtureText = () => fs.readFileSync(path.join(CONTEXTS, EDIT), 'utf8')

test('rewriteCases renames and removes cases in every place a runbook names them', () => {
  const text = fixtureText()
  const renamed = rewriteCases(text, (list) => list.map((c) => (c === 'vip-outside' ? 'vip-guest' : c)), { emptyStepLine: 'skip' })
  assert.match(renamed.text, /- manager in vip-guest: read-only/)
  assert.match(renamed.text, /  - vip-guest: client "Globex"/)
  const removed = rewriteCases(text, (list) => list.filter((c) => c !== 'vip-outside'), { emptyStepLine: 'skip' })
  assert.doesNotMatch(removed.text, /vip-outside/)
  assert.doesNotMatch(removed.text, /- manager in/)
  const dropped = rewriteCases(text, () => [], { emptyStepLine: 'remove' })
  assert.doesNotMatch(dropped.text, /- Cases:|\bin vip-|Cases: /)
})

test('rewriteCases handles frontmatter lists and step Cases lines', () => {
  const withList = fixtureText().replace('cases: all', 'cases: [vip-team, vip-outside]').replace('Parents: S01\n', 'Parents: S01\nCases: vip-outside\n')
  const renamed = rewriteCases(withList, (list) => list.map((c) => (c === 'vip-outside' ? 'vip-guest' : c)), { emptyStepLine: 'skip' })
  assert.match(renamed.text, /^cases: \[vip-team, vip-guest\]$/m)
  assert.match(renamed.text, /^Cases: vip-guest$/m)
  const skip = rewriteCases(withList, (list) => list.filter((c) => c !== 'vip-outside'), { emptyStepLine: 'skip' })
  assert.deepEqual(skip.skipped, ['S02 runs only in vip-outside'])
  assert.equal(skip.text, withList)
  const remove = rewriteCases(withList, (list) => list.filter((c) => c !== 'vip-outside'), { emptyStepLine: 'remove' })
  assert.deepEqual(remove.skipped, [])
  assert.doesNotMatch(remove.text, /^Cases:/m)
  const only = withList.replace('[vip-team, vip-outside]', '[vip-outside]')
  assert.deepEqual(rewriteCases(only, (list) => list.filter((c) => c !== 'vip-outside'), { emptyStepLine: 'remove' }).skipped, ['cases lists only vip-outside'])
})

test('rename-case moves fixture folders and delete-case skips a runbook it cannot edit alone', () => {
  const dir = copyContexts()
  fs.mkdirSync(path.join(dir, FIXTURES, '+vip-outside'), { recursive: true })
  fs.mkdirSync(path.join(dir, FIXTURES, 'S02/@manager/+vip-outside'), { recursive: true })
  const dry = JSON.parse(run(['rename-case', 'vip-outside', 'vip-guest', '--json', '--root', dir]).stdout)
  assert.equal(dry.written.length, 0)
  assert.equal(read(dir), fixtureText())
  assert.ok(fs.existsSync(path.join(dir, FIXTURES, '+vip-outside')))
  const plan = JSON.parse(run(['rename-case', 'vip-outside', 'vip-guest', '--write', '--json', '--root', dir]).stdout)
  assert.deepEqual(plan.folders, [
    { from: `${FIXTURES}/+vip-outside`, to: `${FIXTURES}/+vip-guest` },
    { from: `${FIXTURES}/S02/@manager/+vip-outside`, to: `${FIXTURES}/S02/@manager/+vip-guest` },
  ])
  assert.deepEqual(plan.written, [EDIT, 'docs/runbooks/clients/list-clients.md'])
  assert.ok(fs.existsSync(path.join(dir, FIXTURES, 'S02/@manager/+vip-guest')))
  assert.ok(!fs.existsSync(path.join(dir, FIXTURES, '+vip-outside')))
  assert.match(read(dir), /- manager in vip-guest: read-only/)
  const refused = run(['rename-case', 'vip-team', 'regular', '--root', dir])
  assert.equal(refused.code, 2)
  assert.match(refused.stderr, /"regular" is already a case/)
  assert.match(run(['rename-case', 'nope', 'other', '--root', dir]).stderr, /no case "nope"/)
})

test('rename-case renames the case in last_run cells', () => {
  const dir = copyContexts()
  const report = '_runs/2026-10-21-1000-clients.edit-client.md'
  const cells = `last_run:\n  date: 2026-10-21\n  commit: "abc1234"\n  result: passed\n  report: ${report}\n  runs:\n    r1: { date: 2026-10-21, commit: "abc1234", report: ${report} }\n  cells:\n    S01: { admin/vip-team: passed r1, admin/*: passed r1 }`
  fs.writeFileSync(path.join(dir, EDIT), fixtureText().replace(/^last_run:.*$/m, cells))
  const dry = JSON.parse(run(['rename-case', 'vip-team', 'key-team', '--json', '--root', dir]).stdout)
  assert.equal(dry.written.length, 0)
  assert.match(read(dir), /admin\/vip-team: passed r1/)
  const out = JSON.parse(run(['rename-case', 'vip-team', 'key-team', '--write', '--json', '--root', dir]).stdout)
  assert.ok(out.written.includes(EDIT), JSON.stringify(out))
  const text = read(dir)
  assert.match(text, /S01: \{ admin\/key-team: passed r1, admin\/\*: passed r1 \}/)
  assert.doesNotMatch(text, /admin\/vip-team/)
})

test('delete-case removes the case everywhere and skips a runbook whose cases list only it', () => {
  const dir = copyContexts()
  const list = path.join(dir, 'docs/runbooks/clients/list-clients.md')
  const before = fs.readFileSync(list, 'utf8')
  const only = before.replace(/^cases:.*\n/m, '').replace(/^roles:.*$/m, (m) => `${m}\ncases: [vip-team]`)
  assert.match(only, /cases: \[vip-team\]/)
  fs.writeFileSync(list, only)
  fs.mkdirSync(path.join(dir, FIXTURES, '+vip-team'), { recursive: true })
  const plan = JSON.parse(run(['delete-case', 'vip-team', '--write', '--json', '--root', dir]).stdout)
  assert.deepEqual(plan.skipped, [{ id: 'clients.list-clients', reason: 'cases lists only vip-team' }])
  assert.equal(fs.readFileSync(list, 'utf8'), only)
  assert.deepEqual(plan.folders, [{ from: `${FIXTURES}/+vip-team`, to: null }])
  assert.ok(fs.existsSync(path.join(dir, FIXTURES, '+vip-team')))
  assert.doesNotMatch(read(dir), /vip-team/)
})

test('a refusal writes nothing', () => {
  const dir = copyContexts()
  const list = path.join(dir, 'docs/runbooks/clients/list-clients.md')
  const only = fs.readFileSync(list, 'utf8').replace(/^cases:.*\n/m, '').replace(/^roles:.*$/m, (m) => `${m}\ncases: [vip-team]`)
  fs.writeFileSync(list, only)
  run(['delete-case', 'vip-team', '--write', '--root', dir])
  assert.equal(fs.readFileSync(list, 'utf8'), only)
})

test('rename keeps CRLF line endings', () => {
  const dir = copyContexts()
  fs.writeFileSync(path.join(dir, EDIT), fixtureText().replace(/\n/g, '\r\n'))
  run(['rename-case', 'vip-outside', 'vip-guest', '--write', '--root', dir])
  const text = read(dir)
  assert.match(text, /- manager in vip-guest: read-only/)
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false)
  assert.equal(text.includes('\r\n'), true)
})

test('delete-context strips cases from runbooks of the context', () => {
  const dir = copyContexts()
  const dry = JSON.parse(run(['delete-context', 'client-access', '--json', '--root', dir]).stdout)
  assert.deepEqual(dry.runbooks.map((r) => r.id).sort(), ['clients.edit-client', 'clients.list-clients'].filter((id) => dry.runbooks.some((r) => r.id === id)).sort())
  assert.equal(read(dir), fixtureText())
  run(['delete-context', 'client-access', '--write', '--root', dir])
  const text = read(dir)
  assert.doesNotMatch(text, /^cases:/m)
  assert.doesNotMatch(text, /- Cases:|\bin vip-|vip-team|regular/)
  assert.match(text, /- viewer: read-only/)
  assert.match(run(['delete-context', 'gold', '--root', dir]).stderr, /no context "gold"/)
})

test('deleting a wrapped role line removes its continuation lines too', () => {
  const dir = copyContexts()
  const wrapped = fixtureText().replace('- manager in vip-outside: read-only. The "Edit" button does not appear.', '- manager in vip-outside: read-only. The "Edit" button\n  does not appear.')
  assert.match(wrapped, /button\n  does not appear\.\n- viewer:/)
  fs.writeFileSync(path.join(dir, EDIT), wrapped)
  run(['delete-case', 'vip-outside', '--write', '--root', dir])
  const text = read(dir)
  assert.doesNotMatch(text, /vip-outside|^  does not appear/m)
  assert.match(text, /Expected: the page shows "Saved" and the phone "555-0100"\.\n- viewer: read-only\. The "Edit" button does not appear\.\n/)
  const removed = rewriteCases(wrapped, () => [], { emptyStepLine: 'remove' }).text
  assert.match(removed, /"555-0100"\.\n- viewer: read-only/)
})

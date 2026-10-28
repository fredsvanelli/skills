import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYaml } from './lib/yaml.mjs'
import { readLastRun, lastRunLines, passKey, parsePassKey } from './lib/last-run.mjs'

const SHAPE = `last_run:
  date: 2026-10-18
  oldest: 2026-10-16
  commit: "def5678"
  result: passed
  report: _runs/2026-10-18-0910-billing.issue-invoice.md
  mixed: true
  outdated: true
  runs:
    r1: { date: 2026-10-16, commit: "abc1234", report: _runs/2026-10-16-1432-billing.issue-invoice.md }
    r2: { date: 2026-10-18, commit: "def5678", report: _runs/2026-10-18-0910-billing.issue-invoice.md }
  cells:
    S01: { admin: passed r1 outdated, viewer: passed r1 outdated }
    S02: { admin: passed r2, viewer: passed r2 }
    S03: { @mobile: failed r2, admin/*@mobile: blocked r1 }
    S04: passed r2
`

const valid = parseYaml(SHAPE).last_run

test('readLastRun reads the old shape as legacy', () => {
  const { lastRun, problems } = readLastRun({ date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/x.md', outdated: true })
  assert.deepEqual(problems, [])
  assert.equal(lastRun.legacy, true)
  assert.deepEqual(lastRun.cells, [])
  assert.deepEqual(lastRun.runs, {})
  assert.equal(lastRun.outdated, true)
  assert.equal(lastRun.mixed, false)
  assert.equal(lastRun.date, '2026-10-01')
})

test('readLastRun returns null for a missing value', () => {
  assert.deepEqual(readLastRun(null), { lastRun: null, problems: [] })
})

test('readLastRun reads cells with every kind of pass key', () => {
  const { lastRun, problems } = readLastRun(valid)
  assert.deepEqual(problems, [])
  assert.equal(lastRun.legacy, false)
  assert.equal(lastRun.mixed, true)
  assert.equal(lastRun.oldest, '2026-10-16')
  assert.deepEqual(lastRun.cells.find((c) => c.step === 'S01' && c.role === 'viewer'),
    { step: 'S01', role: 'viewer', case: null, viewport: null, state: 'passed', run: 'r1', outdated: true })
  assert.deepEqual(parsePassKey('admin/*@mobile'), { role: 'admin', case: '*', viewport: 'mobile' })
  assert.deepEqual(parsePassKey('@mobile'), { role: null, case: null, viewport: 'mobile' })
  assert.deepEqual(parsePassKey(''), { role: null, case: null, viewport: null })
  assert.deepEqual(lastRun.cells.find((c) => c.step === 'S04'), { step: 'S04', role: null, case: null, viewport: null, state: 'passed', run: 'r2', outdated: false })
  assert.deepEqual(lastRun.cells.find((c) => c.step === 'S03' && c.state === 'blocked'),
    { step: 'S03', role: 'admin', case: '*', viewport: 'mobile', state: 'blocked', run: 'r1', outdated: false })
  assert.equal(lastRun.runs.r2.commit, 'def5678')
})

test('passKey builds the key from role, case and viewport', () => {
  assert.equal(passKey({ role: 'admin', case: null, viewport: null }), 'admin')
  assert.equal(passKey({ role: 'admin', case: 'vip-team', viewport: null }), 'admin/vip-team')
  assert.equal(passKey({ role: 'admin', case: '*', viewport: 'mobile' }), 'admin/*@mobile')
  assert.equal(passKey({ role: null, case: null, viewport: 'mobile' }), '@mobile')
  assert.equal(passKey({ role: null, case: null, viewport: null }), '')
})

test('readLastRun reports bad cells', () => {
  assert.deepEqual(readLastRun({ ...valid, result: 'meh' }).problems, ['last_run.result "meh" must be one of passed, failed, blocked, incomplete'])
  assert.deepEqual(readLastRun({ ...valid, cells: { S01: 'nope r1' } }).problems, ['last_run.cells.S01: state "nope" is not a step state'])
  assert.deepEqual(readLastRun({ ...valid, cells: { S01: 'passed r9' } }).problems, ['last_run.cells.S01: run "r9" is not in last_run.runs'])
  assert.deepEqual(readLastRun({ ...valid, outdated: 'yes' }).problems, ['last_run.outdated must be true or false'])
  assert.deepEqual(readLastRun({ date: '2026-10-01', outdated: 'yes' }).problems, ['last_run.outdated must be true or false'])
})

test('readLastRun treats cells null as no cells and runs alone as new shape', () => {
  const a = readLastRun({ ...valid, cells: null }).lastRun
  assert.equal(a.legacy, false)
  assert.deepEqual(a.cells, [])
  const b = readLastRun({ date: '2026-10-18', runs: {}, cells: {} }).lastRun
  assert.equal(b.legacy, false)
})

test('lastRunLines round-trips through parseYaml', () => {
  const { lastRun } = readLastRun(valid)
  const lines = lastRunLines(lastRun)
  assert.equal(lines[0], 'last_run:')
  const back = readLastRun(parseYaml(lines.join('\n')).last_run).lastRun
  assert.deepEqual(back, lastRun)
})

test('lastRunLines writes empty runs and cells for a new shape without cells', () => {
  const { lastRun } = readLastRun({ date: '2026-10-18', commit: 'abc1234', result: 'incomplete', report: '_runs/x.md', runs: {}, cells: {} })
  const lines = lastRunLines(lastRun)
  assert.ok(lines.includes('  runs: {}'))
  assert.ok(lines.includes('  cells: {}'))
  assert.deepEqual(readLastRun(parseYaml(lines.join('\n')).last_run).lastRun, lastRun)
})

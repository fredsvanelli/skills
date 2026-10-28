import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml, splitFrontmatter } from './lib/yaml.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRoles } from './lib/roles.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { parseSteps } from './lib/steps.mjs'
import { reportByName } from './lib/reports.mjs'
import {
  readLastRun, lastRunLines, passKey, parsePassKey,
  expectedCells, reportCells, pendingCells, mergeLastRun, markOutdated, renameCells
} from './lib/last-run.mjs'

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

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))

// A report as reportByName returns it. Rows are [step, state, role?, case?, viewport?].
function report(name, partial, rows) {
  return {
    name,
    path: `docs/runbooks/_runs/${name}`,
    run: name.replace(/\.md$/, ''),
    date: `${name.slice(0, 10)} ${name.slice(11, 13)}:${name.slice(13, 15)}`,
    commit: `sha-${name.slice(0, 15)}`,
    partial,
    steps: rows.map(([step, state, role, kase, viewport]) => ({
      step,
      state,
      ...(role === undefined ? {} : { role }),
      ...(kase === undefined ? {} : { case: kase }),
      ...(viewport === undefined ? {} : { viewport })
    }))
  }
}

const cell = (step, role = null, kase = null, viewport = null) => ({ step, role, case: kase, viewport })
const plain = ['S01', 'S02', 'S03'].map((step) => cell(step))
const FULL = '2026-10-16-1432-billing.issue-invoice.md'
const PART = '2026-10-18-0910-billing.issue-invoice.md'
const LATER = '2026-10-19-0800-billing.issue-invoice.md'
const cellOf = (lastRun, step, role = null, kase = null) =>
  lastRun.cells.find((c) => c.step === step && c.role === role && c.case === kase)

function loadFixture(root, id) {
  const config = loadConfig(root)
  const registry = loadRoles(root, config)
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, runbook.path), 'utf8'))
  return { config, registry, runbook, steps: parseSteps(parts.body) }
}

test('a --merge run replaces only the cells it ran', () => {
  const full = mergeLastRun(null, report('2026-10-16-1432-billing.issue-invoice.md', false, [['S01', 'passed'], ['S02', 'failed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  assert.equal(full.lastRun.result, 'failed')
  const merged = mergeLastRun(full.lastRun, report('2026-10-18-0910-billing.issue-invoice.md', true, [['S02', 'passed']]), plain, { merge: true, status: 'draft' })
  assert.equal(merged.lastRun.result, 'passed')
  assert.equal(merged.lastRun.mixed, true)
  assert.equal(merged.lastRun.date, '2026-10-18')
  assert.equal(merged.lastRun.oldest, '2026-10-16')
  assert.deepEqual(merged.lastRun.cells.map((c) => [c.step, c.state, merged.lastRun.runs[c.run].date]),
    [['S01', 'passed', '2026-10-16'], ['S02', 'passed', '2026-10-18'], ['S03', 'passed', '2026-10-16']])
  assert.equal(merged.status, 'active')
  assert.deepEqual(merged.changed.map((c) => [c.step, c.from, c.to]), [['S02', 'failed', 'passed']])
})

test('one role re-run keeps the other roles', () => {
  // 3 roles, role c failed; --role c --merge passes; a and b keep run r1
  const expected = ['S01', 'S02'].flatMap((step) => ['a', 'b', 'c'].map((role) => cell(step, role)))
  const rows = ['S01', 'S02'].flatMap((step) => ['a', 'b', 'c'].map((role) => [step, role === 'c' && step === 'S02' ? 'failed' : 'passed', role]))
  const full = mergeLastRun(null, report(FULL, false, rows), expected, { merge: false, status: 'draft' })
  assert.equal(full.lastRun.result, 'failed')
  assert.equal(full.status, 'draft')
  const merged = mergeLastRun(full.lastRun, report(PART, true, [['S01', 'passed', 'c'], ['S02', 'passed', 'c']]), expected, { merge: true, status: 'draft' })
  assert.deepEqual(merged.lastRun.cells.map((c) => `${c.step} ${c.role} ${c.state} ${c.run}`),
    ['S01 a passed r1', 'S01 b passed r1', 'S01 c passed r2', 'S02 a passed r1', 'S02 b passed r1', 'S02 c passed r2'])
  assert.equal(merged.lastRun.runs.r1.report, `_runs/${FULL}`)
  assert.equal(merged.lastRun.runs.r2.report, `_runs/${PART}`)
  assert.equal(merged.lastRun.result, 'passed')
  assert.equal(merged.status, 'active')
  assert.deepEqual(merged.changed.map((c) => [c.step, c.role, c.from, c.to]), [['S01', 'c', 'passed', 'passed'], ['S02', 'c', 'failed', 'passed']])
})

test('outdated cells keep their state, block status and clear only where the run ran', () => {
  // full run passed on draft, markOutdated, then --steps S02 --merge: S01 and S03 outdated, last_run.outdated true, status stays draft
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed'], ['S02', 'passed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  assert.equal(full.status, 'active')
  const marked = markOutdated(full.lastRun)
  assert.equal(marked.outdated, true)
  assert.ok(marked.cells.every((c) => c.outdated))
  const merged = mergeLastRun(marked, report(PART, true, [['S02', 'passed']]), plain, { merge: true, status: 'draft' })
  assert.deepEqual(merged.lastRun.cells.map((c) => [c.step, c.state, c.outdated]),
    [['S01', 'passed', true], ['S02', 'passed', false], ['S03', 'passed', true]])
  assert.equal(merged.lastRun.outdated, true)
  assert.equal(merged.lastRun.result, 'passed')
  assert.equal(merged.status, 'draft')
  const all = mergeLastRun(merged.lastRun, report(LATER, true, [['S01', 'passed'], ['S03', 'passed']]), plain, { merge: true, status: 'draft' })
  assert.equal(all.lastRun.outdated, false)
  assert.equal(all.status, 'active')
})

test('markOutdated sets only the whole on a legacy value', () => {
  const { lastRun } = readLastRun({ date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/x.md' })
  const marked = markOutdated(lastRun)
  assert.equal(marked.outdated, true)
  assert.equal(marked.legacy, true)
  assert.deepEqual(marked.cells, [])
  assert.equal(lastRun.outdated, false)
})

test('a pending cell makes the result incomplete', () => {
  // legacy previous + --steps S02 --merge: S01, S03 absent, result incomplete, status unchanged
  const { lastRun: legacy } = readLastRun({ date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/x.md' })
  const merged = mergeLastRun(legacy, report(PART, true, [['S02', 'passed']]), plain, { merge: true, status: 'draft' })
  assert.deepEqual(merged.lastRun.cells.map((c) => c.step), ['S02'])
  assert.equal(merged.lastRun.legacy, false)
  assert.equal(merged.lastRun.result, 'incomplete')
  assert.equal(merged.lastRun.mixed, false)
  assert.equal(merged.status, 'draft')
  assert.deepEqual(merged.changed.map((c) => [c.step, c.from, c.to]), [['S02', null, 'passed']])
  assert.deepEqual(pendingCells(merged.lastRun.cells, plain), [cell('S01'), cell('S03')])
})

test('a failed cell outranks blocked, and blocked outranks pending', () => {
  const blocked = mergeLastRun(null, report(PART, true, [['S01', 'blocked-by-parent']]), plain, { merge: true, status: 'draft' })
  assert.equal(blocked.lastRun.result, 'blocked')
  const failed = mergeLastRun(blocked.lastRun, report(LATER, true, [['S02', 'failed']]), plain, { merge: true, status: 'draft' })
  assert.equal(failed.lastRun.result, 'failed')
})

test('a no-account row fills only a pending cell', () => {
  // admin passed in r1; --merge report with admin no-account leaves admin passed r1
  const expected = [cell('S01', 'admin'), cell('S01', 'viewer')]
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed', 'admin']]), expected, { merge: false, status: 'draft' })
  assert.equal(full.lastRun.result, 'incomplete')
  const merged = mergeLastRun(full.lastRun, report(PART, true, [['S01', 'no-account', 'admin'], ['S01', 'no-account', 'viewer']]), expected, { merge: true, status: 'draft' })
  assert.deepEqual(cellOf(merged.lastRun, 'S01', 'admin'), { ...cell('S01', 'admin'), state: 'passed', run: 'r1', outdated: false })
  assert.deepEqual(cellOf(merged.lastRun, 'S01', 'viewer'), { ...cell('S01', 'viewer'), state: 'no-account', run: 'r2', outdated: false })
  assert.equal(merged.lastRun.result, 'passed')
  assert.deepEqual(merged.changed.map((c) => [c.role, c.from, c.to]), [['viewer', null, 'no-account']])
})

test('a blocked row replaces an existing cell', () => {
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed'], ['S02', 'passed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  const merged = mergeLastRun(full.lastRun, report(PART, true, [['S02', 'blocked']]), plain, { merge: true, status: 'active' })
  assert.equal(cellOf(merged.lastRun, 'S02').state, 'blocked')
  assert.equal(merged.lastRun.result, 'blocked')
  assert.equal(merged.status, 'active')
})

test('cells the runbook no longer has are dropped', () => {
  // previous has case old-case; expected lacks it; the cell is gone and does not count
  const before = [cell('S01', 'admin', 'vip'), cell('S01', 'admin', 'old-case')]
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed', 'admin', 'vip'], ['S01', 'failed', 'admin', 'old-case']]), before, { merge: false, status: 'draft' })
  assert.equal(full.lastRun.result, 'failed')
  const now = [cell('S01', 'admin', 'vip'), cell('S02', 'admin', 'vip')]
  const merged = mergeLastRun(full.lastRun, report(PART, true, [['S02', 'passed', 'admin', 'vip'], ['S02', 'failed', 'admin', 'old-case']]), now, { merge: true, status: 'draft' })
  assert.deepEqual(merged.lastRun.cells.map((c) => [c.step, passKey(c), c.state]), [['S01', 'admin/vip', 'passed'], ['S02', 'admin/vip', 'passed']])
  assert.equal(merged.lastRun.result, 'passed')
  assert.equal(merged.status, 'active')
})

test('merging the same report twice changes nothing', () => {
  // second mergeLastRun deepEquals first, changed is []
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed'], ['S02', 'failed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  const part = report(PART, true, [['S02', 'passed']])
  const once = mergeLastRun(full.lastRun, part, plain, { merge: true, status: 'draft' })
  const twice = mergeLastRun(once.lastRun, part, plain, { merge: true, status: once.status })
  assert.deepEqual(twice.lastRun, once.lastRun)
  assert.equal(twice.status, once.status)
  assert.deepEqual(twice.changed, [])
})

test('a full run replaces every cell and clears outdated', () => {
  // runs has one entry, mixed false, outdated false
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed'], ['S02', 'failed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  const mixed = markOutdated(mergeLastRun(full.lastRun, report(PART, true, [['S02', 'passed']]), plain, { merge: true, status: 'draft' }).lastRun)
  assert.equal(mixed.mixed, true)
  const name = '2026-10-20-1200-billing.issue-invoice.md'
  const again = mergeLastRun(mixed, report(name, false, [['S01', 'passed'], ['S02', 'passed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  assert.deepEqual(Object.keys(again.lastRun.runs), ['r1'])
  assert.deepEqual(again.lastRun.runs.r1, { date: '2026-10-20', commit: 'sha-2026-10-20-1200', report: `_runs/${name}` })
  assert.equal(again.lastRun.mixed, false)
  assert.equal(again.lastRun.outdated, false)
  assert.ok(again.lastRun.cells.every((c) => c.run === 'r1' && !c.outdated))
  assert.equal(again.lastRun.date, '2026-10-20')
  assert.equal(again.lastRun.oldest, '2026-10-20')
  assert.equal(again.lastRun.commit, 'sha-2026-10-20-1200')
  assert.equal(again.lastRun.report, `_runs/${name}`)
  assert.equal(again.status, 'active')
  assert.deepEqual(again.changed.map((c) => [c.step, c.from, c.to]), [['S01', 'passed', 'passed'], ['S02', 'passed', 'passed'], ['S03', 'passed', 'passed']])
  assert.deepEqual(readLastRun(parseYaml(lastRunLines(again.lastRun).join('\n')).last_run).lastRun, again.lastRun)
})

test('--merge with a full report acts as a full run', () => {
  // merge: true, report.partial false => same as merge: false
  const full = mergeLastRun(null, report(FULL, false, [['S01', 'passed'], ['S02', 'failed'], ['S03', 'passed']]), plain, { merge: false, status: 'draft' })
  const next = report(PART, false, [['S01', 'passed'], ['S02', 'passed']])
  const merged = mergeLastRun(full.lastRun, next, plain, { merge: true, status: 'draft' })
  assert.deepEqual(merged, mergeLastRun(full.lastRun, next, plain, { merge: false, status: 'draft' }))
  assert.equal(merged.lastRun.result, 'incomplete')
  assert.equal(merged.lastRun.mixed, false)
})

test('a partial report without merge is refused', () => {
  assert.throws(() => mergeLastRun(null, report('x', true, []), plain, { merge: false, status: 'draft' }), /a partial run changes last_run only with --merge/)
})

test('a report without a date takes the run date from its name', () => {
  const merged = mergeLastRun(null, { ...report(FULL, false, [['S01', 'passed']]), date: null }, plain, { merge: false, status: 'draft' })
  assert.equal(merged.lastRun.runs.r1.date, '2026-10-16')
  assert.equal(merged.lastRun.date, '2026-10-16')
})

test('a plain runbook expects one cell per step, so a merge leaves the other steps pending', () => {
  // Tracking off and no viewports: the real path from expectedCells, a legacy previous and --steps S02 --merge.
  const steps = ['S01', 'S02', 'S03'].map((step) => ({ step, roles: [], cases: [], viewports: [] }))
  const expected = expectedCells({ viewports: [] }, steps, { registry: null, config: {} })
  assert.deepEqual(expected, plain)
  const { lastRun: legacy } = readLastRun({ date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/x.md' })
  const merged = mergeLastRun(legacy, report(PART, true, [['S02', 'passed', '', '', '']]), expected, { merge: true, status: 'draft' })
  assert.deepEqual(merged.lastRun.cells.map((c) => [c.step, c.role, c.case, c.viewport, c.state]), [['S02', null, null, null, 'passed']])
  assert.equal(merged.lastRun.result, 'incomplete')
  assert.equal(merged.status, 'draft')
  assert.deepEqual(pendingCells(merged.lastRun.cells, expected), [cell('S01'), cell('S03')])
})

test('renameCells moves a case and leaves * and other cases', () => {
  const { lastRun } = readLastRun(parseYaml(`last_run:
  runs:
    r1: { date: 2026-10-16, commit: "abc1234", report: _runs/x.md }
  cells:
    S01: { admin/vip-team: passed r1, admin/*: passed r1, admin/regular@mobile: failed r1, viewer: passed r1 }
`).last_run)
  const renamed = renameCells(lastRun, { field: 'case', from: 'vip-team', to: 'key-team' })
  assert.deepEqual(renamed.cells.map(passKey), ['admin/key-team', 'admin/*', 'admin/regular@mobile', 'viewer'])
  assert.equal(renamed.cells[0].state, 'passed')
  assert.equal(renamed.cells[0].run, 'r1')
  const role = renameCells(lastRun, { field: 'role', from: 'admin', to: 'owner' })
  assert.deepEqual(role.cells.map(passKey), ['owner/vip-team', 'owner/*', 'owner/regular@mobile', 'viewer'])
  assert.deepEqual(renameCells(lastRun, { field: 'case', from: '*', to: 'x' }).cells.map(passKey), lastRun.cells.map(passKey))
  const { lastRun: legacy } = readLastRun({ date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/x.md' })
  assert.equal(renameCells(legacy, { field: 'case', from: 'a', to: 'b' }), legacy)
})

test('reportCells reads empty columns as null and leaves the run unset', () => {
  assert.deepEqual(reportCells(report(FULL, false, [['S01', 'passed', 'admin', '', 'mobile'], ['S02', 'failed']])), [
    { step: 'S01', role: 'admin', case: null, viewport: 'mobile', state: 'passed', run: null, outdated: false },
    { step: 'S02', role: null, case: null, viewport: null, state: 'failed', run: null, outdated: false }
  ])
})

test('expectedCells covers passes with tracking on and viewports with it off', () => {
  // the fixture project's runbooks
  const on = loadFixture(CONTEXTS, 'clients.edit-client')
  const cells = expectedCells(on.runbook, on.steps, on)
  assert.equal(cells.length, 12)
  assert.deepEqual(cells.slice(0, 6), [
    cell('S01', 'viewer', '*'), cell('S01', 'manager', 'vip-team'), cell('S01', 'manager', 'vip-outside'),
    cell('S01', 'manager', 'regular'), cell('S01', 'admin', '*'), cell('S01', 'anonymous', '*')
  ])
  const fixtureReport = reportByName(CONTEXTS, 'docs/runbooks', '2026-10-21-1000-clients.edit-client.md')
  const merged = mergeLastRun(null, fixtureReport, cells, { merge: false, status: 'draft' })
  assert.equal(merged.lastRun.cells.length, 12)
  assert.deepEqual(pendingCells(merged.lastRun.cells, cells), [])
  assert.equal(merged.lastRun.result, 'passed')
  assert.equal(merged.lastRun.runs.r1.date, '2026-10-21')

  // A step's Roles: and Cases: lines leave the other passes out, as junit does.
  const only = on.steps.map((s) => (s.step === 'S02' ? { ...s, roles: ['manager'], cases: ['regular'] } : s))
  assert.deepEqual(expectedCells(on.runbook, only, on).filter((c) => c.step === 'S02'), [cell('S02', 'manager', 'regular')])

  // Tracking off: the same runbook read with no registry.
  const off = { ...on, registry: null }
  assert.deepEqual(expectedCells(off.runbook, off.steps, off), [cell('S01'), cell('S02')])
  const withViewports = { ...off.runbook, viewports: ['desktop', 'mobile'] }
  assert.deepEqual(expectedCells(withViewports, off.steps, off), [
    cell('S01', null, null, 'desktop'), cell('S01', null, null, 'mobile'),
    cell('S02', null, null, 'desktop'), cell('S02', null, null, 'mobile')
  ])
  const mobileFirst = off.steps.map((s) => (s.step === 'S01' ? { ...s, viewports: ['mobile'] } : s))
  assert.deepEqual(expectedCells(withViewports, mobileFirst, off).filter((c) => c.step === 'S01'), [cell('S01', null, null, 'mobile')])
})

import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { runbooksView, runbookView, historyView, reportView, coverageView } from './lib/explore.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const TODAY = { today: '2026-10-20' }
const RUNS = 'docs/runbooks/_runs'

// The config reads endpoints from the sibling ../api, so the temp dir holds both.
function project(edit = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-explore-'))
  const root = path.join(tmp, 'project')
  fs.cpSync(FIXTURE, root, { recursive: true })
  fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
  const configFile = path.join(root, 'docs/runbooks/runbooks.config.json')
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  edit(raw, root)
  fs.writeFileSync(configFile, JSON.stringify(raw))
  return { root, config: loadConfig(root), cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) }
}

function withProject(fn, edit) {
  const p = project(edit)
  try {
    return fn(p)
  } finally {
    p.cleanup()
  }
}

const names = (view) => view.capabilities.map((c) => c.name)
const capability = (view, name) => view.capabilities.find((c) => c.name === name)
const ids = (items) => items.map((i) => i.id)
const row = (view, id) => view.capabilities.flatMap((c) => c.runbooks).find((r) => r.id === id)

const REPORT = (extra, table) => `---
runbook: x
run: 2026-10-19-1000
date: 2026-10-19 10:00
commit: "abc1234"
branch: main
mode: headless
${extra}result: passed
---

# Run 2026-10-19-1000

${table}
`

const TABLE = `| Step | Viewport | State | Seen |
|---|---|---|---|
| S01 | desktop | passed | ok |
| S01 | mobile | failed | broken |`

test('runbooksView lists capabilities and the group without a slice', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.equal(view.staleDays, 30)
  assert.equal(view.today, '2026-10-20')
  assert.deepEqual(names(view), ['billing', 'broken', 'deliveries', '(no slice)'])
  const none = capability(view, '(no slice)')
  assert.deepEqual(none.runbooks, [])
  assert.deepEqual(ids(none.uncovered), ['/', '/settings'])
  assert.equal(none.problems, 2)
  assert.deepEqual(none.coverage, { covered: 0, total: 2 })
  assert.equal(view.capabilities.reduce((n, c) => n + (c.coverage?.total ?? 0), 0), 9)
}))

test('a slice without runbooks gets its own item', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.deepEqual(names(view), ['billing', 'broken', 'deliveries', 'settings', '(no slice)'])
  assert.deepEqual(capability(view, 'settings').runbooks, [])
  assert.deepEqual(ids(capability(view, 'settings').uncovered), ['/settings'])
  assert.deepEqual(ids(capability(view, '(no slice)').uncovered), ['/'])
  assert.equal(view.capabilities.reduce((n, c) => n + (c.coverage?.total ?? 0), 0), 9)
}, (raw) => { raw.slices.settings = ['src/app/[locale]/(dashboard)/settings/**'] }))

test('a config slice with no entry points shows in both lists with zero coverage', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.deepEqual(names(view), ['billing', 'broken', 'deliveries', 'empty', '(no slice)'])
  assert.deepEqual(capability(view, 'empty'), {
    name: 'empty', problems: 0, stale: 0, uncovered: [], coverage: { covered: 0, total: 0 }, runbooks: [],
  })
  assert.equal(capability(view, 'broken').coverage, null)
  assert.deepEqual(coverageView(root, config).slices, [
    { name: 'billing', covered: 2, total: 5 },
    { name: 'deliveries', covered: 1, total: 2 },
    { name: 'empty', covered: 0, total: 0 },
    { name: '(no slice)', covered: 0, total: 2 },
  ])
}, (raw) => { raw.slices.empty = ['src/nothing/**'] }))

test('billing counts stale runbooks and uncovered entries', () => withProject(({ root, config }) => {
  const billing = capability(runbooksView(root, config, TODAY), 'billing')
  assert.equal(billing.problems, 2)
  assert.equal(billing.stale, 1)
  assert.deepEqual(ids(billing.uncovered), ['GET /admin/invoices'])
  assert.deepEqual(billing.coverage, { covered: 2, total: 5 })
  assert.equal(row(runbooksView(root, config, TODAY), 'billing.cancel-invoice').stale, true)
  const issue = billing.runbooks.find((r) => r.id === 'billing.issue-invoice')
  assert.equal(issue.flow, 'issue-invoice')
  assert.equal(issue.date, '2026-10-01')
  assert.equal(issue.time, '09:00')
  assert.equal(issue.age, 19)
  assert.equal(issue.stale, false)
  assert.equal(issue.runs, 1)
}))

test('deliveries: 30 days is not stale, outdated never makes it stale, deprecated is never stale', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  const list = row(view, 'deliveries.list-deliveries')
  assert.equal(list.age, 30)
  assert.equal(list.stale, false)
  assert.equal(list.outdated, true)
  assert.equal(row(view, 'deliveries.old-list').stale, false)
  assert.equal(capability(view, 'deliveries').problems, 1)
  assert.equal(row(runbooksView(root, { ...config, staleDays: 29 }, TODAY), 'deliveries.list-deliveries').stale, true)
}))

test('a broken runbook lists its problems and has no coverage', () => withProject(({ root, config }) => {
  const broken = capability(runbooksView(root, config, TODAY), 'broken')
  assert.equal(broken.coverage, null)
  assert.deepEqual(broken.uncovered, [])
  assert.ok(broken.runbooks[0].problems.length > 0)
}))

test('runbooksView runs no requirement source', () => withProject(({ root, config }) => {
  runbooksView(root, config, TODAY)
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), false)
}, (raw) => { raw.requirements = [{ extractor: 'command', command: 'echo ran > ran.txt; echo "[]"' }] }))

test('runbooksView returns the entry-source warnings and leaves runbook problems out', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.equal(view.warnings.length, 1)
  assert.match(view.warnings[0], /root "\.\.\/gone" does not exist/)
  assert.deepEqual(runbooksView(root, { ...config, entries: config.entries.slice(0, 1) }, TODAY).warnings, [])
}, (raw) => { raw.entries.push({ extractor: 'next-app-router', root: '../gone', glob: '**/page.tsx' }) }))

test('a partial report newer than last_run leaves the row unchanged and shows in the history', () => withProject(({ root, config }) => {
  const name = '2026-10-15-1200-billing.issue-invoice.md'
  fs.writeFileSync(path.join(root, RUNS, name), REPORT('partial: true\n', TABLE))
  const issue = row(runbooksView(root, config, TODAY), 'billing.issue-invoice')
  assert.equal(issue.age, 19)
  assert.equal(issue.date, '2026-10-01')
  assert.equal(issue.runs, 2)
  const runs = historyView(root, config, 'billing.issue-invoice').runs
  assert.deepEqual(runs.map((r) => [r.name, r.partial]), [[name, true], ['2026-10-01-0900-billing.issue-invoice.md', false]])
}))

test('runbookView', () => withProject(({ root, config }) => {
  assert.equal(runbookView(root, config, 'nope', TODAY), null)
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.equal(view.upstreamFromConfig, true)
  assert.equal(view.path, 'docs/runbooks/billing/issue-invoice.md')
  assert.deepEqual(view.stepStates, {})
  assert.equal(view.reportOnDisk, true)
}))

test('runbookView reads step states per viewport from the last_run report', () => withProject(({ root, config }) => {
  const file = path.join(root, 'docs/runbooks/billing/issue-invoice.md')
  const name = '2026-10-18-1000-billing.issue-invoice.md'
  fs.writeFileSync(path.join(root, RUNS, name), REPORT('', TABLE))
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('2026-10-01-0900-billing.issue-invoice.md', name))
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.deepEqual(view.stepStates.S01, [{ viewport: 'desktop', state: 'passed' }, { viewport: 'mobile', state: 'failed' }])
}))

test('a missing last_run report gives no step states, even with a newer local report', () => withProject(({ root, config }) => {
  fs.writeFileSync(path.join(root, RUNS, '2026-10-19-1000-deliveries.list-deliveries.md'), REPORT('', TABLE))
  const view = runbookView(root, config, 'deliveries.list-deliveries', TODAY)
  assert.equal(view.reportOnDisk, false)
  assert.deepEqual(view.stepStates, {})
}))

test('historyView and reportView read an old one-line report', () => withProject(({ root, config }) => {
  const history = historyView(root, config, 'billing.issue-invoice')
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0].branch, null)
  assert.equal(historyView(root, config, 'nope.nope'), null)
  const report = reportView(root, config, history.runs[0].name)
  assert.equal(typeof report.sectionsHtml, 'string')
  assert.equal(report.runbook, 'billing.issue-invoice')
  assert.equal(reportView(root, config, '../runbooks.config.json'), null)
}))

test('coverageView sums surfaces per slice and filters by slice', () => withProject(({ root, config }) => {
  const view = coverageView(root, config)
  assert.deepEqual(view.slices, [
    { name: 'billing', covered: 2, total: 5 },
    { name: 'deliveries', covered: 1, total: 2 },
    { name: '(no slice)', covered: 0, total: 2 },
  ])
  assert.equal(view.scope, 'overall')
  const billing = coverageView(root, config, 'billing')
  assert.deepEqual(ids(billing.result.entries.uncovered), ['GET /admin/invoices'])
  assert.deepEqual(billing.result.groups.map((g) => g.name), ['billing'])
  assert.deepEqual(ids(coverageView(root, config, '(no slice)').result.entries.uncovered).sort(), ['/', '/settings'])
}))

test('coverageView with a slice counts only that slice in result.entries', () => withProject(({ root, config }) => {
  const { entries } = coverageView(root, config, 'billing').result
  assert.deepEqual({ ...entries, uncovered: ids(entries.uncovered) }, { total: 5, covered: 2, pending: 2, planned: 0, uncovered: ['GET /admin/invoices'] })
  const none = coverageView(root, config, '(no slice)').result.entries
  assert.deepEqual([none.total, none.covered, none.pending, none.planned, none.uncovered.length], [2, 0, 0, 0, 2])
  const nothing = coverageView(root, config, 'nope').result.entries
  assert.deepEqual(nothing, { total: 0, covered: 0, pending: 0, planned: 0, uncovered: [] })
}))

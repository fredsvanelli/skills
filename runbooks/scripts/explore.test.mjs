import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { runbooksView, runbookView, historyView, reportView, coverageView, rolesView, roleView } from './lib/explore.mjs'
import { run } from './runbooks.mjs'

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

test('each row carries the effective upstream mode', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.equal(row(view, 'billing.cancel-invoice').upstream, 'live')
  assert.equal(row(view, 'billing.issue-invoice').upstream, 'mocked')
}, (raw, root) => {
  raw.upstream = { mode: 'live', urlEnv: 'API_URL' }
  const file = path.join(root, 'docs/runbooks/billing/issue-invoice.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: active', 'upstream: mocked\nstatus: active'))
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

test('runbooksView returns the config and entry-source warnings and leaves runbook problems out', () => withProject(({ root, config }) => {
  const view = runbooksView(root, config, TODAY)
  assert.deepEqual(view.warnings.slice(0, config.warnings.length), config.warnings)
  assert.equal(view.warnings.length, config.warnings.length + 1)
  assert.match(view.warnings.at(-1), /root "\.\.\/gone" does not exist/)
  assert.deepEqual(runbooksView(root, { ...config, warnings: [], entries: config.entries.slice(0, 1) }, TODAY).warnings, [])
}, (raw) => { raw.entries.push({ extractor: 'next-app-router', root: '../gone', glob: '**/page.tsx' }) }))

test('coverageView returns the config warnings with the source warnings', () => withProject(({ root, config }) => {
  assert.match(config.warnings.join('\n'), /entries\[1\]: root "\.\.\/api" is outside the project/)
  assert.deepEqual(coverageView(root, config).result.warnings, config.warnings)
}))

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
  assert.deepEqual(view.calls, [])
  assert.deepEqual(view.stepStates, {})
  assert.equal(view.reportOnDisk, true)
}))

test('runbookView reads step states per viewport from the last_run report', () => withProject(({ root, config }) => {
  const file = path.join(root, 'docs/runbooks/billing/issue-invoice.md')
  const name = '2026-10-18-1000-billing.issue-invoice.md'
  fs.writeFileSync(path.join(root, RUNS, name), REPORT('', TABLE))
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('2026-10-01-0900-billing.issue-invoice.md', name))
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.deepEqual(view.stepStates.S01, [{ role: null, viewport: 'desktop', state: 'passed' }, { role: null, viewport: 'mobile', state: 'failed' }])
}))

test('runbookView takes step states from the cells when they exist', () => withProject(({ root, config }) => {
  const file = path.join(root, 'docs/runbooks/billing/issue-invoice.md')
  const text = fs.readFileSync(file, 'utf8').replace(/^last_run: .*$/m, `last_run:
  date: 2026-10-18
  oldest: 2026-10-18
  commit: "abc1234"
  result: failed
  report: _runs/gone.md
  runs:
    r1: { date: 2026-10-18, commit: "abc1234", report: _runs/gone.md }
  cells:
    S01: { @desktop: passed r1, @mobile: failed r1 }`)
  fs.writeFileSync(file, text)
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.deepEqual(view.stepStates.S01, [{ role: null, viewport: 'desktop', state: 'passed' }, { role: null, viewport: 'mobile', state: 'failed' }])
  assert.deepEqual(view.reports, [{ name: 'gone.md', report: '_runs/gone.md', onDisk: false }])
}))

test('runbookView finds a report on disk when any cell cites one, and the row carries mixed and oldest', () => withProject(({ root, config }) => {
  const file = path.join(root, 'docs/runbooks/billing/issue-invoice.md')
  const text = fs.readFileSync(file, 'utf8').replace(/^last_run: .*$/m, `last_run:
  date: 2026-10-18
  oldest: 2026-10-01
  commit: "def5678"
  result: passed
  report: _runs/2026-10-18-0910-billing.issue-invoice.md
  mixed: true
  runs:
    r1: { date: 2026-10-01, commit: "abc1234", report: _runs/2026-10-01-0900-billing.issue-invoice.md }
    r2: { date: 2026-10-18, commit: "def5678", report: _runs/2026-10-18-0910-billing.issue-invoice.md }
  cells:
    S01: passed r1
    S02: passed r2`)
  fs.writeFileSync(file, text)
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.equal(view.reportOnDisk, true)
  assert.deepEqual(view.reports.map((r) => [r.name, r.onDisk]), [
    ['2026-10-01-0900-billing.issue-invoice.md', true],
    ['2026-10-18-0910-billing.issue-invoice.md', false],
  ])
  assert.equal(view.mixed, true)
  assert.equal(view.oldest, '2026-10-01')
  assert.equal(view.date, '2026-10-18')
  assert.equal(view.age, 19)
  const listed = row(runbooksView(root, config, TODAY), 'billing.issue-invoice')
  assert.equal(listed.mixed, true)
  assert.equal(listed.oldest, '2026-10-01')
}))

test('runbookView lists no cited reports for an old last_run', () => withProject(({ root, config }) => {
  const view = runbookView(root, config, 'billing.issue-invoice', TODAY)
  assert.deepEqual(view.reports, [])
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
  const billing = coverageView(root, config, { slice: 'billing' })
  assert.deepEqual(ids(billing.result.entries.uncovered), ['GET /admin/invoices'])
  assert.deepEqual(billing.result.groups.map((g) => g.name), ['billing'])
  assert.deepEqual(ids(coverageView(root, config, { slice: '(no slice)' }).result.entries.uncovered).sort(), ['/', '/settings'])
}))

test('coverageView with a slice counts only that slice in result.entries', () => withProject(({ root, config }) => {
  const { entries } = coverageView(root, config, { slice: 'billing' }).result
  assert.deepEqual({ ...entries, uncovered: ids(entries.uncovered) }, { total: 5, covered: 2, pending: 2, planned: 0, uncovered: ['GET /admin/invoices'] })
  const none = coverageView(root, config, { slice: '(no slice)' }).result.entries
  assert.deepEqual([none.total, none.covered, none.pending, none.planned, none.uncovered.length], [2, 0, 0, 0, 2])
  const nothing = coverageView(root, config, { slice: 'nope' }).result.entries
  assert.deepEqual(nothing, { total: 0, covered: 0, pending: 0, planned: 0, uncovered: [] })
}))

test('coverageView takes the filters of runbooks.mjs coverage and reports the same numbers', () => withProject(({ root, config }) => {
  const totals = ({ total, covered, pending, planned, uncovered }) => ({ total, covered, pending, planned, uncovered: ids(uncovered) })
  for (const filters of [{ path: 'src/**' }, { feature: 'invoices' }, { capability: 'billing' }]) {
    const [key, value] = Object.entries(filters)[0]
    const cli = JSON.parse(run(['coverage', `--${key}`, value, '--root', root, '--json']).stdout)
    const view = coverageView(root, config, filters)
    assert.equal(view.scope, cli.scope)
    assert.deepEqual(totals(view.result.entries), totals(cli.entries), key)
    assert.deepEqual(view.result.groups.map((g) => [g.name, g.covered, g.total]), cli.groups.map((g) => [g.name, g.covered, g.total]), key)
    assert.deepEqual(view.slices, coverageView(root, config).slices, 'the side list stays overall')
  }
  assert.equal(coverageView(root, config, { path: 'src/**' }).result.entries.total, 6)
  assert.equal(coverageView(root, config).result.entries.total, 9)
}))

const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))

test('rolesView counts roles, reviews, roles without an account and uncovered keys', () => {
  const view = rolesView(ROLES, loadConfig(ROLES), TODAY)
  assert.equal(view.enabled, true)
  assert.equal(view.counters.roles, 5)
  assert.equal(view.counters.reviews, 1)
  assert.equal(view.counters.noAccount, 1)
  assert.equal(typeof view.counters.keysWithoutRunbook, 'number')
  assert.equal(view.rows.length, 5)
  assert.ok(view.matrix.keys.includes('billing/invoices'))
  const manager = view.matrix.roles.find((r) => r.name === 'manager')
  assert.deepEqual(manager.cells['billing/invoices'].actions, ['view', 'create', 'edit', 'approve'])
  assert.equal(manager.cells['billing/invoices'].source, 'overridden')
})

test('rolesView is disabled without role tracking', () => {
  assert.deepEqual(rolesView(FIXTURE, loadConfig(FIXTURE), TODAY), { enabled: false })
})

test('roleView adds history and answers null for an unknown role', () => {
  const config = loadConfig(ROLES)
  const view = roleView(ROLES, config, 'manager')
  assert.equal(view.name, 'manager')
  assert.ok(Array.isArray(view.history))
  assert.equal(roleView(ROLES, config, 'ghost'), null)
  assert.equal(roleView(FIXTURE, loadConfig(FIXTURE), 'manager'), null)
})

test('runbookView and runbooksView carry the role review fields', () => {
  const config = loadConfig(ROLES)
  const view = runbookView(ROLES, config, 'billing.cancel-invoice', TODAY)
  assert.equal(view.review.length, 1)
  assert.equal(typeof view.rolesAll, 'boolean')
  const rows = runbooksView(ROLES, config, TODAY).capabilities.flatMap((c) => c.runbooks)
  assert.equal(rows.find((r) => r.id === 'billing.cancel-invoice').review, true)
  assert.equal(rows.find((r) => r.id === 'billing.create-invoice').review, false)
})

test('coverageView narrows the roles to the role filter', () => {
  const config = loadConfig(ROLES)
  assert.equal(coverageView(ROLES, config, {}).result.roles.length, 5)
  const one = coverageView(ROLES, config, { role: 'viewer' })
  assert.deepEqual(one.result.roles.map((r) => r.role), ['viewer'])
  assert.equal(one.scope, 'overall')
})

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))

test('runbookView and rolesView carry the case', () => {
  const config = loadConfig(CONTEXTS)
  const view = runbookView(CONTEXTS, config, 'clients.edit-client', TODAY)
  assert.equal(view.context, 'client-access')
  assert.equal(view.casesAll, true)
  assert.deepEqual(view.cases, ['vip-team', 'vip-outside', 'regular'])
  assert.ok(view.stepStates.S02.some((s) => s.role === 'manager' && s.case === 'vip-outside'))
  assert.ok(view.stepStates.S02.some((s) => s.role === 'admin' && s.case === '*'))
  const roles = rolesView(CONTEXTS, config, TODAY)
  const manager = roles.matrix.roles.find((r) => r.name === 'manager')
  assert.deepEqual(Object.keys(manager.cells['clients/*'].cases), ['vip-team', 'vip-outside', 'regular'])
  assert.equal(roles.matrix.roles.find((r) => r.name === 'viewer').cells['billing/*'].cases, undefined)
  assert.deepEqual(roles.contexts.map((c) => c.name), ['client-access'])
})

test('without contexts the views keep their shape', () => {
  const view = rolesView(ROLES, loadConfig(ROLES), TODAY)
  assert.equal('contexts' in view, false)
  assert.equal('caseKeys' in view.rows[0], false)
  const rb = runbookView(ROLES, loadConfig(ROLES), 'billing.cancel-invoice', TODAY)
  assert.equal('context' in rb, false)
})

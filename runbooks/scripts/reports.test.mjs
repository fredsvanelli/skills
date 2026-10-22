import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listReports, reportByName, latestReport } from './lib/reports.mjs'

const FIXTURE_RUNS = path.join(import.meta.dirname, '__fixtures__/project/docs/runbooks/_runs')

const report = ({ id = 'billing.pay', run, table, extra = '' }) => `---
runbook: ${id}
run: ${run}
date: ${run.slice(0, 10)} ${run.slice(11, 13)}:${run.slice(13, 15)}
commit: "abc1234"
branch: feat/pay
mode: headless
executor: the agent
partial: false
${extra}result: passed
---

# Run ${run}

${table}

## Failures
`

const TABLE = `| Step | State | Seen | Evidence |
|---|---|---|---|
| S01 | passed | ok | \`a.png\` |`

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-reports-'))
  const runs = path.join(dir, 'docs/runbooks/_runs')
  fs.mkdirSync(runs, { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(runs, name), text)
  return dir
}

const RUNBOOKS = 'docs/runbooks'

test('listReports returns the reports of one runbook, newest first', () => {
  const dir = project({
    '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table: TABLE }),
    '2026-10-03-1000-billing.pay.md': report({ run: '2026-10-03-1000-billing.pay', table: TABLE }),
    '2026-10-02-0800-billing.pay.md': report({ run: '2026-10-02-0800-billing.pay', table: TABLE }),
    '2026-10-04-0800-billing.pay-later.md': report({ id: 'billing.pay-later', run: '2026-10-04-0800-billing.pay-later', table: TABLE }),
  })
  const reports = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.deepEqual(reports.map((r) => r.name), [
    '2026-10-03-1000-billing.pay.md',
    '2026-10-02-0800-billing.pay.md',
    '2026-10-01-0900-billing.pay.md',
  ])
  assert.equal(reports[0].upstream, null)
  assert.deepEqual(reports[0].viewports, [])
  assert.equal(latestReport(dir, RUNBOOKS, 'billing.pay').name, '2026-10-03-1000-billing.pay.md')
})

test('a Viewport column gives one step entry per viewport', () => {
  const table = `| Step | State | Viewport | Seen | Evidence |
|---|---|---|---|---|
| S01 | passed | desktop | ok | \`a.png\` |
| S01 | failed | mobile | bad | \`b.png\` |`
  const dir = project({
    '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table, extra: 'upstream: mocked\nviewports: [desktop 1280x800, mobile 390x844]\n' }),
  })
  const [r] = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.deepEqual(r.steps, [
    { step: 'S01', state: 'passed', viewport: 'desktop' },
    { step: 'S01', state: 'failed', viewport: 'mobile' },
  ])
  assert.deepEqual(r.counts, { passed: 1, failed: 1 })
  assert.equal(r.upstream, 'mocked')
  assert.deepEqual(r.viewports, ['desktop 1280x800', 'mobile 390x844'])
})

test('the column order comes from the header row', () => {
  const table = `| Step | Viewport | State | Seen | Evidence |
|---|---|---|---|---|
| S01 | desktop | passed | ok | \`a.png\` |
| S02 | mobile | blocked | no | \`b.png\` |`
  const dir = project({
    '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table }),
  })
  const [r] = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.deepEqual(r.steps, [
    { step: 'S01', state: 'passed', viewport: 'desktop' },
    { step: 'S02', state: 'blocked', viewport: 'mobile' },
  ])
})

test('a table without a Viewport column gives steps without the viewport key', () => {
  const dir = project({
    '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table: TABLE }),
  })
  assert.deepEqual(listReports(dir, RUNBOOKS, 'billing.pay')[0].steps, [{ step: 'S01', state: 'passed' }])
})

test('a one-line report without frontmatter reads with null fields', () => {
  const name = '2026-10-01-0900-billing.issue-invoice.md'
  const dir = project({ [name]: fs.readFileSync(path.join(FIXTURE_RUNS, name), 'utf8') })
  const [r] = listReports(dir, RUNBOOKS, 'billing.issue-invoice')
  assert.equal(r.branch, null)
  assert.equal(r.mode, null)
  assert.equal(r.upstream, null)
  assert.equal(r.date, null)
  assert.deepEqual(r.steps, [])
  assert.deepEqual(r.viewports, [])
})

test('reportByName rejects names outside the runs directory and unknown names', () => {
  const dir = project({
    '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table: TABLE }),
    'notes.md': 'notes',
  })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbooks.config.json'), '{}')
  for (const name of ['../runbooks.config.json', '2026-10-01-0900-billing.pay.md/../x', 'notes.md', '2026-10-09-0900-billing.pay.md']) {
    assert.equal(reportByName(dir, RUNBOOKS, name), null, name)
  }
  const found = reportByName(dir, RUNBOOKS, '2026-10-01-0900-billing.pay.md')
  assert.equal(found.runbook, 'billing.pay')
  assert.equal(found.name, '2026-10-01-0900-billing.pay.md')
  assert.match(found.body, /^\n?# Run 2026-10-01-0900-billing\.pay/)
  assert.doesNotMatch(found.body, /^runbook:/m)
})

test('a report with malformed frontmatter still lists, with null fields', () => {
  const name = '2026-10-01-0900-billing.pay.md'
  const dir = project({ [name]: `---\nbranch: [x\n---\n\n${TABLE}\n` })
  const [r] = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.equal(r.branch, null)
  assert.deepEqual(r.steps, [{ step: 'S01', state: 'passed' }])
  assert.equal(reportByName(dir, RUNBOOKS, name).branch, null)
})

test('a row without a state cell is skipped', () => {
  const table = `| Step | State | Seen |
|---|---|---|
| S01 |
| S02 | | x |
| S03 | passed | ok |`
  const dir = project({ '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table }) })
  const [r] = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.deepEqual(r.steps, [{ step: 'S03', state: 'passed' }])
  assert.deepEqual(r.counts, { passed: 1 })
})

test('reports read the Role column and roles', () => {
  const ROLES = path.join(import.meta.dirname, '__fixtures__/roles')
  const [r] = listReports(ROLES, 'docs/runbooks', 'billing.cancel-invoice')
  assert.deepEqual(r.roles, ['viewer', 'editor', 'manager', 'admin', 'anonymous'])
  assert.deepEqual(r.steps.find((s) => s.step === 'S03' && s.role === 'manager' && s.viewport === 'desktop'), { step: 'S03', state: 'failed', role: 'manager', viewport: 'desktop' })
  assert.equal(r.counts['not-applicable'] > 0, true)
})

test('a report without roles has roles [] and no role on its steps', () => {
  const table = `| Step | State | Seen |
|---|---|---|
| S01 | passed | ok |`
  const dir = project({ '2026-10-01-0900-billing.pay.md': report({ run: '2026-10-01-0900-billing.pay', table }) })
  const [r] = listReports(dir, RUNBOOKS, 'billing.pay')
  assert.deepEqual(r.roles, [])
  assert.deepEqual(r.steps, [{ step: 'S01', state: 'passed' }])
})

test('readReport reads the Case column', () => {
  const CONTEXTS = path.join(import.meta.dirname, '__fixtures__/contexts')
  const report = latestReport(CONTEXTS, 'docs/runbooks', 'clients.edit-client')
  assert.deepEqual(report.cases, ['vip-team', 'vip-outside', 'regular'])
  assert.ok(report.steps.some((row) => row.role === 'manager' && row.case === 'vip-outside' && row.step === 'S02' && row.state === 'passed'))
  assert.ok(report.steps.some((row) => row.role === 'admin' && row.case === '*'))
})

test('a report without a Case column has no cases and rows without a case', () => {
  const report = latestReport(path.join(import.meta.dirname, '__fixtures__/roles'), 'docs/runbooks', 'billing.cancel-invoice')
  assert.deepEqual(report.cases, [])
  assert.ok(report.steps.every((row) => !('case' in row)))
})

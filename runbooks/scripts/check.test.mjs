import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { checkMarkdown } from './lib/format.mjs'

const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))

const RUNBOOK = (lastRun) => `---
id: billing.pay
title: Pay an invoice
capability: billing
status: active
last_run: ${lastRun}
---
`

const REPORT = ({ run: runId, result, partial = false, rows }) => `---
runbook: billing.pay
run: ${runId}
date: ${runId.slice(0, 10)} ${runId.slice(11, 13)}:${runId.slice(13, 15)}
commit: "abc1234"
branch: feat/pay
mode: headless
executor: the agent
partial: ${partial}
result: ${result}
---

# Run ${runId}

| Step | State | Seen | Evidence |
|---|---|---|---|
${rows.map(([step, state, seen]) => `| ${step} | ${state} | ${seen} | \`${step}.png\` |`).join('\n')}

## Failures
`

function project({ lastRun = 'null', reports = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-check-'))
  const runbooks = path.join(dir, 'docs/runbooks')
  fs.mkdirSync(path.join(runbooks, 'billing'), { recursive: true })
  fs.mkdirSync(path.join(runbooks, '_runs'))
  fs.writeFileSync(path.join(runbooks, 'runbooks.config.json'), '{ "version": 1 }')
  fs.writeFileSync(path.join(runbooks, 'billing/pay.md'), RUNBOOK(lastRun))
  for (const report of reports) {
    fs.writeFileSync(path.join(runbooks, `_runs/${report.run}.md`), REPORT(report))
  }
  return dir
}

const FULL = {
  run: '2026-10-01-0900-billing.pay',
  result: 'failed',
  rows: [['S01', 'passed', 'ok'], ['S02', 'failed', '"Error"'], ['S03', 'blocked-by-parent', '—']],
}
const PARTIAL = {
  run: '2026-10-02-1000-billing.pay',
  result: 'passed',
  partial: true,
  rows: [['S02', 'passed', 'ok']],
}
const OTHER_RUNBOOK = { run: '2026-10-03-1100-billing.pay-later', result: 'passed', rows: [['S01', 'passed', 'ok']] }

test('check says a runbook was never run when it has no report', () => {
  const { code, stdout } = run(['check', 'billing.pay', '--root', project()])
  assert.equal(code, 0)
  assert.equal(stdout, 'billing.pay (Pay an invoice) has never been run.\n')
  const json = JSON.parse(run(['check', 'billing.pay', '--root', project(), '--json']).stdout)
  assert.equal(json.latest, null)
})

test('check picks the newest report of that id, partial runs included', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md }`,
    reports: [FULL, PARTIAL, OTHER_RUNBOOK],
  })
  const json = JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout)
  assert.equal(json.latest.path, `docs/runbooks/_runs/${PARTIAL.run}.md`)
  assert.equal(json.latest.partial, true)
  assert.equal(json.latest.result, 'passed')
  assert.deepEqual(json.latest.steps, [{ step: 'S02', state: 'passed' }])
  assert.equal(json.lastRun.report, `_runs/${FULL.run}.md`)
  assert.equal(json.lastRunIsLatest, false)
})

test('check counts the step states of the newest report', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md }`,
    reports: [FULL],
  })
  const json = JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout)
  assert.deepEqual(json.latest.counts, { passed: 1, failed: 1, 'blocked-by-parent': 1 })
  assert.equal(json.latest.commit, 'abc1234')
  assert.equal(json.latest.mode, 'headless')
  assert.equal(json.lastRunIsLatest, true)
})

test('check prints the newest report as Markdown', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md }`,
    reports: [FULL],
  })
  const { code, stdout } = run(['check', 'billing.pay', '--root', dir])
  assert.equal(code, 0)
  assert.match(stdout, /^Last run of billing\.pay \(Pay an invoice\): failed$/m)
  assert.match(stdout, /^Report: docs\/runbooks\/_runs\/2026-10-01-0900-billing\.pay\.md$/m)
  assert.match(stdout, /^Date: 2026-10-01 09:00 · commit abc1234 · branch feat\/pay · mode headless · full run$/m)
  assert.match(stdout, /^Steps: 1 passed, 1 failed, 1 blocked-by-parent$/m)
})

test('check warns when the newest report is partial and differs from last_run', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md }`,
    reports: [FULL, PARTIAL],
  })
  const { stdout } = run(['check', 'billing.pay', '--root', dir])
  assert.match(stdout, /· partial run \(--steps\)$/m)
  assert.match(stdout, /^Last full run \(last_run\): 2026-10-01 failed, report _runs\/2026-10-01-0900-billing\.pay\.md$/m)
})

test('check fails on an unknown id or a missing id', () => {
  const unknown = run(['check', 'billing.nope', '--root', project()])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /^runbooks: no runbook with id "billing\.nope"$/m)
  const missing = run(['check', '--root', project()])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /^runbooks: check needs a runbook id$/m)
})

test('check --full skips newer partial runs and returns the newest full run', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md }`,
    reports: [FULL, PARTIAL],
  })
  const json = JSON.parse(run(['check', 'billing.pay', '--full', '--root', dir, '--json']).stdout)
  assert.equal(json.latest.path, `docs/runbooks/_runs/${FULL.run}.md`)
  assert.equal(json.latest.partial, false)
  assert.equal(json.lastRunIsLatest, true)
  const { stdout } = run(['check', 'billing.pay', '--full', '--root', dir])
  assert.match(stdout, /^Last full run of billing\.pay \(Pay an invoice\): failed$/m)
  assert.doesNotMatch(stdout, /Last full run \(last_run\)/)
})

test('check says when update changed the runbook after its last full run', () => {
  const dir = project({
    lastRun: `{ date: 2026-10-01, commit: "abc1234", result: failed, report: _runs/${FULL.run}.md, outdated: true }`,
    reports: [FULL],
  })
  assert.equal(JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout).lastRun.outdated, true)
  const { stdout } = run(['check', 'billing.pay', '--root', dir])
  assert.match(stdout, /^Outdated: the runbook changed after its last full run$/m)
})

test('check --full also works before the id', () => {
  const dir = project({ reports: [FULL, PARTIAL] })
  const { code, stdout } = run(['check', '--full', 'billing.pay', '--root', dir, '--json'])
  assert.equal(code, 0)
  assert.equal(JSON.parse(stdout).latest.path, `docs/runbooks/_runs/${FULL.run}.md`)
})

test('check --full says when a runbook only has partial runs', () => {
  const dir = project({ reports: [PARTIAL] })
  const { code, stdout } = run(['check', 'billing.pay', '--full', '--root', dir])
  assert.equal(code, 0)
  assert.equal(stdout, 'billing.pay (Pay an invoice) has never had a full run.\n')
})

test('check prints one line per pending review entry', () => {
  const { code, stdout } = run(['check', 'billing.cancel-invoice', '--root', ROLES])
  assert.equal(code, 0)
  assert.match(stdout, /^Review: role-permissions, manager, billing\/invoices \(delete removed\), 2026-10-14$/m)
})

const STEPS_BODY = `
# Pay

### S01. Open
### S02. Pay
### S03. Confirm
`

function cellProject(lastRun, reports) {
  const dir = project({ lastRun: 'null', reports })
  const file = path.join(dir, 'docs/runbooks/billing/pay.md')
  const text = fs.readFileSync(file, 'utf8').replace('last_run: null\n', `${lastRun}\n`)
  fs.writeFileSync(file, text + STEPS_BODY)
  return dir
}

const CELLS_RUN = `last_run:
  date: 2026-10-02
  oldest: 2026-10-01
  commit: "abc1234"
  result: failed
  report: _runs/${PARTIAL.run}.md
  mixed: true
  outdated: true
  runs:
    r1: { date: 2026-10-01, commit: "abc1234", report: _runs/${FULL.run}.md }
    r2: { date: 2026-10-02, commit: "abc1234", report: _runs/${PARTIAL.run}.md }
  cells:
    S01: failed r1
    S02: passed r2 outdated`

test('check names the mixed runs and the pending, failed and outdated cells', () => {
  const dir = cellProject(CELLS_RUN, [FULL, PARTIAL])
  const { stdout } = run(['check', 'billing.pay', '--root', dir])
  assert.match(stdout, /^Mixed runs: .*_runs\/2026-10-01-0900-billing\.pay\.md.*_runs\/2026-10-02-1000-billing\.pay\.md$/m)
  assert.match(stdout, /^Pending: S03$/m)
  assert.match(stdout, /^Failed cells: S01$/m)
  assert.match(stdout, /^Outdated cells: S02 \(the runbook changed after the run of these cells\)$/m)
  const json = JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout)
  assert.deepEqual(json.pending, [{ step: 'S03', role: null, case: null, viewport: null }])
})

test('check labels cells with role, case and viewport', () => {
  const lastRun = { mixed: true, runs: { r1: { report: 'a.md' }, r2: { report: 'b.md' } }, outdated: true }
  const out = checkMarkdown({
    id: 'x', lastRun, latest: { date: 'd', counts: {}, path: 'p' }, lastRunIsLatest: true,
    pending: [{ step: 'S01', role: 'admin', case: '*', viewport: null }, { step: 'S01', role: 'admin', case: 'vip-team', viewport: 'mobile' }],
  })
  assert.match(out, /^Pending: S01 as admin, S01 as admin in vip-team @ mobile$/m)
})

test('check counts a report cited by a cell as the one last_run records', () => {
  const dir = cellProject(CELLS_RUN, [FULL, PARTIAL])
  const older = JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout)
  assert.equal(older.lastRunIsLatest, true)
  // The newest report is a third one that no cell cites.
  const later = { run: '2026-10-05-1000-billing.pay', result: 'passed', partial: true, rows: [['S03', 'passed', 'ok']] }
  fs.writeFileSync(path.join(dir, `docs/runbooks/_runs/${later.run}.md`), REPORT(later))
  assert.equal(JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout).lastRunIsLatest, false)
  fs.rmSync(path.join(dir, `docs/runbooks/_runs/${later.run}.md`))
  fs.rmSync(path.join(dir, `docs/runbooks/_runs/${PARTIAL.run}.md`))
  // Only the older report is on disk and a cell cites it.
  assert.equal(JSON.parse(run(['check', 'billing.pay', '--root', dir, '--json']).stdout).lastRunIsLatest, true)
})

test('check answers from the cells when no report is on disk', () => {
  const dir = cellProject(CELLS_RUN, [])
  const { stdout } = run(['check', 'billing.pay', '--root', dir])
  assert.doesNotMatch(stdout, /never/)
  assert.match(stdout, /^Last run of billing\.pay \(Pay an invoice\): 2026-10-02 failed \(mixed\) \(outdated\), no report on disk$/m)
  assert.match(stdout, /^Mixed runs: /m)
  assert.match(stdout, /^Pending: S03$/m)
  assert.match(stdout, /^Failed cells: S01$/m)
  assert.match(stdout, /^Outdated cells: S02/m)
})

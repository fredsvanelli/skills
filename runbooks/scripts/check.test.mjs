import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'

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

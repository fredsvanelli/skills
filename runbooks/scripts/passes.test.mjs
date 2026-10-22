import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRoles } from './lib/roles.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { splitFrontmatter } from './lib/yaml.mjs'
import { parseSteps } from './lib/steps.mjs'
import { runsOnce, casePlan, passPlan } from './lib/passes.mjs'
import { passesMarkdown } from './lib/format.mjs'
import { stepStates } from './lib/junit.mjs'

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))

const EDIT = 'docs/runbooks/clients/edit-client.md'

function loadFixtureRunbook(id, root = CONTEXTS) {
  const config = loadConfig(root)
  const registry = loadRoles(root, config)
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, runbook.path), 'utf8'))
  return { registry, runbook, steps: parseSteps(parts.body) }
}

// A copy of the contexts fixture with edit-client.md changed by edit(text).
function copyWithEdit(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-passes-'))
  fs.cpSync(CONTEXTS, dir, { recursive: true })
  const file = path.join(dir, EDIT)
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
  return dir
}

test('passPlan runs a role per case only when its actions or lines change by case', () => {
  const { registry, runbook, steps } = loadFixtureRunbook('clients.edit-client')
  assert.equal(runsOnce(registry, runbook, steps, 'manager'), false)
  assert.equal(runsOnce(registry, runbook, steps, 'admin'), true)
  assert.equal(runsOnce(registry, runbook, steps, 'viewer'), true) // one line with no case, same actions everywhere
  const plan = passPlan(registry, loadConfig(CONTEXTS), runbook, steps)
  assert.deepEqual(plan.filter((p) => p.role === 'manager').map((p) => p.case), ['vip-team', 'vip-outside', 'regular'])
  assert.deepEqual(plan.find((p) => p.role === 'admin'), { role: 'admin', case: '*', dataCase: 'vip-team', viewport: null, noAccount: false })
  assert.equal(plan.find((p) => p.role === 'viewer').noAccount, true)
  assert.deepEqual(passPlan(registry, loadConfig(CONTEXTS), runbook, steps, { roles: ['admin'], cases: ['regular'] }), [{ role: 'admin', case: '*', dataCase: 'regular', viewport: null, noAccount: false }])
  assert.deepEqual(passPlan(registry, loadConfig(CONTEXTS), runbook, steps, { roles: ['manager'], cases: ['regular'] }).map((p) => p.case), ['regular'])
})

test('casePlan maps each role to once or its cases, and is null without a context', () => {
  const { registry, runbook, steps } = loadFixtureRunbook('clients.edit-client')
  const plan = casePlan(registry, runbook, steps)
  assert.deepEqual(plan.manager, { once: false, cases: ['vip-team', 'vip-outside', 'regular'] })
  assert.deepEqual(plan.admin, { once: true, cases: ['vip-team'] })
  const billing = loadFixtureRunbook('billing.list-invoices')
  assert.equal(casePlan(billing.registry, billing.runbook, billing.steps), null)
  assert.equal(runsOnce(billing.registry, billing.runbook, billing.steps, 'admin'), false)
})

test('passes CLI lists the passes in order', () => {
  const out = run(['passes', 'clients.edit-client', '--json', '--root', CONTEXTS])
  assert.equal(out.code, 0)
  const data = JSON.parse(out.stdout)
  assert.equal(data.id, 'clients.edit-client')
  assert.equal(data.context, 'client-access')
  assert.deepEqual(data.passes.map((p) => `${p.role}:${p.case}`), ['viewer:*', 'manager:vip-team', 'manager:vip-outside', 'manager:regular', 'admin:*', 'anonymous:*'])
  const billing = JSON.parse(run(['passes', 'billing.list-invoices', '--json', '--root', CONTEXTS]).stdout)
  assert.equal(billing.passes.length, 4)
  assert.ok(billing.passes.every((p) => p.case === null))
  const filtered = JSON.parse(run(['passes', 'clients.edit-client', '--json', '--role', 'manager', '--case', 'regular', '--root', CONTEXTS]).stdout)
  assert.deepEqual(filtered.passes.map((p) => p.case), ['regular'])
  const md = run(['passes', 'clients.edit-client', '--root', CONTEXTS])
  assert.match(md.stdout, /\| Role \| Case \| Data case \| Viewport \| Account \|/)
  assert.match(passesMarkdown({ id: 'x', context: null, passes: [] }), /No passes/)
  assert.equal(run(['passes', 'nope', '--root', CONTEXTS]).code, 2)
  assert.equal(run(['passes', 'clients.edit-client', '--role', 'ghost', '--root', CONTEXTS]).code, 2)
  assert.equal(run(['passes', 'clients.edit-client', '--case', 'ghost', '--root', CONTEXTS]).code, 2)
})

test('a case named like an Object key does not crash passes or junit', () => {
  for (const name of ['constructor', '__proto__']) {
    const dir = copyWithEdit((text) => text.replace('cases: all', `cases: [vip-team, ${name}]`))
    const { registry, runbook, steps } = loadFixtureRunbook('clients.edit-client', dir)
    assert.deepEqual(runbook.cases, ['vip-team', name])
    assert.ok(runbook.problems.includes(`case "${name}" is not a case of client-access`))
    assert.equal(runsOnce(registry, runbook, steps, 'admin'), false) // full access in vip-team, none in the unknown case
    const out = run(['passes', 'clients.edit-client', '--json', '--root', dir])
    assert.equal(out.code, 0, out.stderr)
    assert.deepEqual(JSON.parse(out.stdout).passes.filter((p) => p.role === 'manager').map((p) => p.case), ['vip-team', name])
    const casesOf = casePlan(registry, runbook, steps)
    const result = stepStates(steps, [{ name: `S01 open as admin in ${name}`, classname: 'ui', outcome: 'passed', seen: '' }], { roles: runbook.roles, casesOf })
    const row = result.steps.find((r) => r.role === 'admin' && r.case === name && r.step === 'S01')
    // A test name can carry only a kebab-case case, so the S01 test maps to the constructor row alone.
    assert.equal(row.state, name === 'constructor' ? 'passed' : 'blocked')
    fs.writeFileSync(path.join(dir, 'run.xml'), '<testsuites><testsuite name="ui"><testcase classname="ui" name="S01 open as admin in constructor"/></testsuite></testsuites>')
    const junit = run(['junit', 'clients.edit-client', '--file', 'run.xml', '--root', dir, '--json'])
    assert.equal(junit.code, 0, junit.stderr)
  }
})

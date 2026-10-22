import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))

function loadFixtureRunbook(id) {
  const config = loadConfig(CONTEXTS)
  const registry = loadRoles(CONTEXTS, config)
  const runbook = loadRunbooks(CONTEXTS, config).find((rb) => rb.id === id)
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(CONTEXTS, runbook.path), 'utf8'))
  return { registry, runbook, steps: parseSteps(parts.body) }
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

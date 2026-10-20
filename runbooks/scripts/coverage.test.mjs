import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { extractItems } from './lib/extract.mjs'
import { computeCoverage, sliceOf } from './lib/coverage.mjs'
import { nextStatus } from './lib/status.mjs'
import { coverageMarkdown } from './lib/format.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))

function coverageOf(root, filters = {}, withItems = false) {
  const config = loadConfig(root)
  return computeCoverage({
    runbooks: loadRunbooks(root, config),
    entries: extractItems(root, config.entries, 'entries').items,
    requirements: extractItems(root, config.requirements, 'requirements').items,
    requirementsConfigured: config.requirements.length > 0,
    slices: config.slices,
    filters,
    withItems,
  })
}

const fixtureCoverage = (filters = {}, withItems = false) => coverageOf(FIXTURE, filters, withItems)

const ids = (items) => items.map((i) => i.id).sort()

test('sliceOf', () => {
  const slices = { billing: ['src/billing/**'], api: ['../api/**'] }
  assert.equal(sliceOf('src/billing/x.ts', slices), 'billing')
  assert.equal(sliceOf('../api/src/a.ts', slices), 'api')
  assert.equal(sliceOf('src/other.ts', slices), null)
  assert.equal(sliceOf(null, slices), null)
})

test('overall coverage counts only active runbooks; drafts are pending', () => {
  const result = fixtureCoverage()
  assert.deepEqual({ ...result.entries, uncovered: ids(result.entries.uncovered) }, {
    total: 9,
    covered: 3,
    pending: 2,
    planned: 0,
    uncovered: ['/', '/deliveries/[id]', '/settings', 'GET /admin/invoices'],
  })
  assert.deepEqual({ ...result.requirements, uncovered: ids(result.requirements.uncovered) }, {
    total: 3, covered: 1, pending: 1, planned: 0, uncovered: ['REQ-3'],
  })
  assert.deepEqual(result.runbooks, { active: 2, draft: 1, placeholder: 0, automated: 1 })
})

test('groups by slice with (no slice) last', () => {
  assert.deepEqual(fixtureCoverage().groups, [
    { name: 'billing', total: 5, covered: 2, pending: 2, planned: 0 },
    { name: 'deliveries', total: 2, covered: 1, pending: 0, planned: 0 },
    { name: '(no slice)', total: 2, covered: 0, pending: 0, planned: 0 },
  ])
})

test('withItems lists each slice entry with its state and the scripts of the runbooks that cite it', () => {
  const billing = fixtureCoverage({}, true).groups.find((g) => g.name === 'billing')
  assert.deepEqual(billing.items.map(({ id, state, tests }) => ({ id, state, tests })), [
    { id: '/billing/invoices', state: 'covered', tests: ['e2e/billing/issue-invoice.runbook.spec.ts'] },
    { id: '/billing/invoices/[id]', state: 'pending', tests: [] },
    { id: 'DELETE /admin/invoices/[id]', state: 'pending', tests: [] },
    { id: 'GET /admin/invoices', state: 'uncovered', tests: [] },
    { id: 'POST /admin/invoices', state: 'covered', tests: ['e2e/billing/issue-invoice.runbook.spec.ts'] },
  ])
  assert.equal(billing.items.length, billing.total)
})

test('withItems gives each slice entry its kind and the runbooks that cite it', () => {
  const billing = fixtureCoverage({}, true).groups.find((g) => g.name === 'billing')
  assert.deepEqual(billing.items.map(({ id, kind, runbooks }) => ({ id, kind, runbooks })), [
    { id: '/billing/invoices', kind: 'ui-route', runbooks: ['billing.issue-invoice'] },
    { id: '/billing/invoices/[id]', kind: 'ui-route', runbooks: ['billing.cancel-invoice'] },
    { id: 'DELETE /admin/invoices/[id]', kind: 'api-endpoint', runbooks: ['billing.cancel-invoice'] },
    { id: 'GET /admin/invoices', kind: 'api-endpoint', runbooks: [] },
    { id: 'POST /admin/invoices', kind: 'api-endpoint', runbooks: ['billing.issue-invoice'] },
  ])
})

test('an id that does not exist exactly is an orphan, not silent', () => {
  assert.deepEqual(fixtureCoverage().orphans, [
    { runbook: 'deliveries.list-deliveries', kind: 'entry', ref: '/deliveries/[deliveryId]' },
    { runbook: 'deliveries.list-deliveries', kind: 'requirement', ref: 'REQ-9' },
  ])
})

test('placeholders make an item planned, never covered or pending', () => {
  const config = loadConfig(FIXTURE)
  const placeholder = {
    id: 'settings.edit-settings', path: 'docs/runbooks/settings/edit-settings.md', capability: 'settings', feature: null, tags: [], roles: [],
    covers: { entries: ['/settings', '/billing/invoices'], requirements: ['REQ-3'] }, sources: [], scripts: [], status: 'placeholder', lastRun: null, problems: [],
  }
  const result = computeCoverage({
    runbooks: [...loadRunbooks(FIXTURE, config), placeholder],
    entries: extractItems(FIXTURE, config.entries, 'entries').items,
    requirements: extractItems(FIXTURE, config.requirements, 'requirements').items,
    requirementsConfigured: true,
    slices: config.slices,
  })
  assert.deepEqual([result.entries.covered, result.entries.pending, result.entries.planned], [3, 2, 1])
  assert.deepEqual(ids(result.entries.uncovered), ['/', '/deliveries/[id]', 'GET /admin/invoices'])
  assert.deepEqual([result.requirements.planned, result.requirements.uncovered], [1, []])
  assert.equal(result.runbooks.placeholder, 1)
})

test('invalid runbooks are reported and never count', () => {
  const result = fixtureCoverage()
  assert.deepEqual(result.invalid.map((i) => i.id), ['broken.bad-frontmatter'])
})

test('deprecated runbooks never count', () => {
  const config = loadConfig(FIXTURE)
  const runbooks = loadRunbooks(FIXTURE, config).filter((rb) => rb.id !== 'deliveries.list-deliveries')
  const result = computeCoverage({
    runbooks,
    entries: extractItems(FIXTURE, config.entries, 'entries').items,
    requirements: [],
    requirementsConfigured: false,
    slices: config.slices,
  })
  assert.equal(result.entries.uncovered.some((i) => i.id === '/deliveries'), true)
  assert.equal(result.requirements, null)
})

test('filters: capability and slice use the slice map', () => {
  for (const filters of [{ capability: 'billing' }, { slice: 'billing' }]) {
    const result = fixtureCoverage(filters)
    assert.equal(result.entries.total, 5)
    assert.equal(result.entries.covered, 2)
    assert.deepEqual(ids(result.entries.uncovered), ['GET /admin/invoices'])
  }
  assert.deepEqual(fixtureCoverage({ capability: 'billing' }).runbooks, { active: 1, draft: 1, placeholder: 0, automated: 1 })
})

test('filters: feature keeps the entries its runbooks cite', () => {
  const result = fixtureCoverage({ feature: 'deliveries' })
  assert.deepEqual({ total: result.entries.total, covered: result.entries.covered }, { total: 1, covered: 1 })
  assert.equal(result.requirements.total, 0)
  assert.equal(result.orphans.length, 2)
})

test('filters: path keeps entries whose file matches', () => {
  const result = fixtureCoverage({ path: 'src/app/[locale]/(dashboard)/deliveries/**' })
  assert.equal(result.entries.total, 2)
})

test('nextStatus promotes a clean full run only', () => {
  assert.equal(nextStatus('draft', ['passed', 'waived', 'passed']), 'active')
  assert.equal(nextStatus('draft', ['passed', 'failed']), 'draft')
  assert.equal(nextStatus('draft', ['passed', 'blocked']), 'draft')
  assert.equal(nextStatus('draft', ['passed', 'blocked-by-parent']), 'draft')
  assert.equal(nextStatus('draft', ['passed'], { partial: true }), 'draft')
  assert.equal(nextStatus('active', ['failed']), 'active')
  assert.equal(nextStatus('deprecated', ['passed']), 'deprecated')
})

test('nextStatus keeps draft when every step was waived', () => {
  assert.equal(nextStatus('draft', ['waived', 'waived']), 'draft')
  assert.equal(nextStatus('draft', []), 'draft')
})

test('nextStatus rejects unknown states', () => {
  assert.throws(() => nextStatus('draft', ['ok']), /unknown step state: ok/)
})

test('a list whose sources did not all run gets no orphan check', () => {
  const config = loadConfig(FIXTURE)
  const local = extractItems(FIXTURE, [config.entries[0]], 'entries').items
  const result = computeCoverage({
    runbooks: loadRunbooks(FIXTURE, config),
    entries: local,
    requirements: extractItems(FIXTURE, config.requirements, 'requirements').items,
    requirementsConfigured: true,
    slices: config.slices,
    unavailable: { entries: true, requirements: false },
  })
  assert.deepEqual(result.orphans, [{ runbook: 'deliveries.list-deliveries', kind: 'requirement', ref: 'REQ-9' }])
  assert.deepEqual(result.orphanChecksSkipped, ['entry'])
})

test('requirement sources that all failed are reported as unavailable, not as zero coverage', () => {
  const config = loadConfig(FIXTURE)
  const result = computeCoverage({
    runbooks: loadRunbooks(FIXTURE, config),
    entries: extractItems(FIXTURE, config.entries, 'entries').items,
    requirements: [],
    requirementsConfigured: true,
    requirementsRan: false,
    slices: config.slices,
    unavailable: { entries: false, requirements: true },
  })
  assert.equal(result.requirements, null)
  assert.equal(result.requirementsNote, 'requirement sources did not run')
  assert.equal(result.orphans.some((o) => o.kind === 'requirement'), false)
})

test('with api runbooks in the stack, an endpoint is covered only through an api runbook', () => {
  const runbook = (id, surface, entries) => ({
    id, path: `docs/runbooks/${id.replace('.', '/')}.md`, capability: id.split('.')[0], surface, feature: null, tags: [], roles: [],
    covers: { entries, requirements: [] }, sources: [], scripts: [], status: 'active', lastRun: null, problems: [],
  })
  const entries = [
    { id: '/invoices', kind: 'ui-route', file: 'src/app/invoices/page.tsx' },
    { id: 'POST /invoices', kind: 'api-endpoint', file: 'src/app/api/invoices/route.ts' },
    { id: 'GET /invoices', kind: 'api-endpoint', file: 'src/app/api/invoices/route.ts' },
  ]
  const runbooks = [
    runbook('billing.issue-invoice', 'ui', ['/invoices', 'POST /invoices', 'GET /invoices']),
    runbook('billing.create-invoice', 'api', ['POST /invoices']),
  ]
  const slices = { billing: ['src/app/**'] }
  const coverage = (stack) => computeCoverage({ runbooks, entries, requirements: [], requirementsConfigured: false, slices, stack })

  const frontend = coverage('frontend')
  assert.equal(frontend.entries.covered, 3)
  assert.deepEqual(frontend.groups, [{ name: 'billing', total: 3, covered: 3, pending: 0, planned: 0 }])

  const fullstack = coverage('fullstack')
  assert.deepEqual(ids(fullstack.entries.uncovered), ['GET /invoices'])
  assert.deepEqual(fullstack.groups, [
    { name: 'billing', surface: 'api', total: 2, covered: 1, pending: 0, planned: 0 },
    { name: 'billing', surface: 'ui', total: 1, covered: 1, pending: 0, planned: 0 },
  ])
})

test('a mocked runbook covers its screens but not its endpoints', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-mocked-'))
  const dir = path.join(tmp, 'project')
  try {
    // The config reads endpoints from the sibling ../api, so copy both.
    fs.cpSync(FIXTURE, dir, { recursive: true })
    fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
    const configPath = path.join(dir, 'docs/runbooks/runbooks.config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.upstream = { mode: 'live', urlEnv: 'API_URL' }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    const runbookPath = path.join(dir, 'docs/runbooks/billing/issue-invoice.md')
    fs.writeFileSync(runbookPath, fs.readFileSync(runbookPath, 'utf8').replace('status: active', 'upstream: mocked\nstatus: active'))

    const result = coverageOf(dir)
    const uncovered = Object.fromEntries(result.entries.uncovered.map((i) => [i.id, i]))
    assert.deepEqual(uncovered['POST /admin/invoices'].citedByMocked, ['billing.issue-invoice'])
    assert.equal(result.entries.uncovered.some((i) => i.id === '/billing/invoices'), false)
    assert.match(coverageMarkdown(result, 'overall'), /`POST \/admin\/invoices`.*cited, not covered \(mocked: billing\.issue-invoice\)/)
    const items = coverageOf(dir, {}, true).groups.find((g) => g.name === 'billing').items
    assert.deepEqual(items.find((i) => i.id === 'POST /admin/invoices').citedByMocked, ['billing.issue-invoice'])
    assert.equal('citedByMocked' in items.find((i) => i.id === '/billing/invoices'), false)
    // A mocked runbook stays in citedByMocked: it does not cite the endpoint under the coverage rule.
    assert.deepEqual(items.find((i) => i.id === 'POST /admin/invoices').runbooks, [])
    assert.deepEqual(items.find((i) => i.id === '/billing/invoices').runbooks, ['billing.issue-invoice'])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('in a fullstack stack a mocked ui runbook still covers its ui-route, not its endpoint', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-mocked-full-'))
  const dir = path.join(tmp, 'project')
  try {
    fs.cpSync(FIXTURE, dir, { recursive: true })
    fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
    const configPath = path.join(dir, 'docs/runbooks/runbooks.config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.stack = 'fullstack'
    config.upstream = { mode: 'live', urlEnv: 'API_URL' }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    const runbookPath = path.join(dir, 'docs/runbooks/billing/issue-invoice.md')
    fs.writeFileSync(runbookPath, fs.readFileSync(runbookPath, 'utf8').replace('status: active', 'upstream: mocked\nstatus: active'))

    const loaded = loadConfig(dir)
    const result = computeCoverage({
      runbooks: loadRunbooks(dir, loaded),
      entries: extractItems(dir, loaded.entries, 'entries').items,
      requirements: extractItems(dir, loaded.requirements, 'requirements').items,
      requirementsConfigured: loaded.requirements.length > 0,
      slices: loaded.slices,
      stack: 'fullstack',
    })
    const uncovered = Object.fromEntries(result.entries.uncovered.map((i) => [i.id, i]))
    assert.equal('/billing/invoices' in uncovered, false)
    assert.deepEqual(uncovered['POST /admin/invoices'].citedByMocked, ['billing.issue-invoice'])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, ConfigError } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { filterRunbooks } from './lib/filter.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-project-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

const CONFIG_PATH = 'docs/runbooks/runbook.config.json'

test('loadConfig reads the fixture', () => {
  const config = loadConfig(FIXTURE)
  assert.equal(config.git.base, 'main')
  assert.equal(config.entries.length, 2)
  assert.equal(config.paths.runbooks, 'docs/runbooks')
})

test('loadConfig fills defaults', () => {
  const dir = tmpProject({ [CONFIG_PATH]: '{ "version": 1 }' })
  const config = loadConfig(dir)
  assert.equal(config.paths.runbooks, 'docs/runbooks')
  assert.equal(config.paths.e2e, null)
  assert.deepEqual(config.entries, [])
  assert.deepEqual(config.slices, {})
  assert.equal(config.commits.runs, 'auto')
  assert.equal(config.git.base, 'main')
})

test('loadConfig explains what is wrong', () => {
  assert.throws(() => loadConfig(tmpProject({})), (err) => err instanceof ConfigError && /not found\. Run \/runbook:setup first/.test(err.message))
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ nope' })), /is not valid JSON/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 2 }' })), /unsupported version 2, expected 1/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "entries": [{ "extractor": "sitemap", "glob": "x" }] }' })), /entries\[0\]: extractor must be one of next-app-router, regex/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "requirements": [{ "extractor": "regex", "glob": "x", "pattern": "^- (REQ)" }] }' })), /requirements\[0\]: pattern needs a named group \(\?<id>\.\.\.\)/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "requirements": [{ "extractor": "regex", "glob": "x", "pattern": "(?<id>[" }] }' })), /requirements\[0\]: invalid pattern/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "requirements": [{ "extractor": "command" }] }' })), /requirements\[0\]: "command" is required/)
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "commits": { "runs": "yes" } }' })), /commits\.runs must be one of never, ask, auto/)
})

test('loadRunbooks skips reports and README, sorts by path', () => {
  const runbooks = loadRunbooks(FIXTURE, loadConfig(FIXTURE))
  assert.deepEqual(runbooks.map((rb) => rb.id), [
    'billing.cancel-invoice',
    'billing.issue-invoice',
    'broken.bad-frontmatter',
    'deliveries.list-deliveries',
    'deliveries.old-list',
  ])
})

test('loadRunbooks maps frontmatter fields', () => {
  const issue = loadRunbooks(FIXTURE, loadConfig(FIXTURE)).find((rb) => rb.id === 'billing.issue-invoice')
  assert.deepEqual(issue, {
    id: 'billing.issue-invoice',
    path: 'docs/runbooks/billing/issue-invoice.md',
    title: 'Issue a partner invoice',
    capability: 'billing',
    feature: 'invoices',
    tags: ['financial', 'critical'],
    roles: ['admin'],
    covers: { entries: ['/financeiro/faturas', 'POST /admin/invoices'], requirements: ['REQ-1'] },
    sources: ['docs/specs/billing.md'],
    scripts: ['e2e/billing/issue-invoice.runbook.spec.ts'],
    status: 'active',
    lastRun: { date: '2026-10-01', commit: 'abc1234', result: 'passed', report: '_runs/2026-10-01-0900-billing.issue-invoice.md' },
    problems: [],
  })
})

test('a broken frontmatter becomes a problem, not a crash', () => {
  const broken = loadRunbooks(FIXTURE, loadConfig(FIXTURE)).find((rb) => rb.id === 'broken.bad-frontmatter')
  assert.equal(broken.status, null)
  assert.match(broken.problems[0], /^frontmatter: line 2: expected , or \]/)
})

test('id, capability, status and depth are checked against the path', () => {
  const dir = tmpProject({
    [CONFIG_PATH]: '{ "version": 1 }',
    'docs/runbooks/x/y.md': '---\nid: x.z\ncapability: w\nstatus: done\n---\n',
    'docs/runbooks/a/b/c.md': '---\nid: a.b.c\ncapability: a\nstatus: draft\n---\n',
    'docs/runbooks/n/none.md': '# no frontmatter\n',
  })
  const byId = Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  assert.deepEqual(byId['x.y'].problems, [
    'id "x.z" does not match the path, expected "x.y"',
    'capability "w" does not match the folder "x"',
    'status "done" must be one of placeholder, draft, active, deprecated',
  ])
  assert.equal(byId['x.y'].status, null)
  assert.deepEqual(byId['a.b.c'].problems, ['runbooks live exactly one folder deep: <capability>/<flow>.md'])
  assert.deepEqual(byId['n.none'].problems, ['missing frontmatter block'])
})

test('filterRunbooks', () => {
  const runbooks = loadRunbooks(FIXTURE, loadConfig(FIXTURE))
  const ids = (list) => list.map((rb) => rb.id)
  assert.deepEqual(ids(filterRunbooks(runbooks, { capability: 'billing' })), ['billing.cancel-invoice', 'billing.issue-invoice'])
  assert.deepEqual(ids(filterRunbooks(runbooks, { status: 'draft' })), ['billing.cancel-invoice'])
  assert.deepEqual(ids(filterRunbooks(runbooks, { tag: 'critical' })), ['billing.issue-invoice'])
  assert.deepEqual(ids(filterRunbooks(runbooks, { feature: 'deliveries' })), ['deliveries.list-deliveries', 'deliveries.old-list'])
  const entryFiles = new Map([['/deliveries', 'src/app/[locale]/(dashboard)/deliveries/page.tsx']])
  assert.deepEqual(ids(filterRunbooks(runbooks, { path: 'src/app/[locale]/(dashboard)/deliveries/**' }, entryFiles)), ['deliveries.list-deliveries', 'deliveries.old-list'])
  assert.deepEqual(ids(filterRunbooks(runbooks, {})), ids(runbooks))
})

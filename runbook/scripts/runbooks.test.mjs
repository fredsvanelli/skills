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
  assert.deepEqual(config.commits, { runbooks: 'ask', setup: 'ask' })
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
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "commits": { "runbooks": "yes" } }' })), /commits\.runbooks must be one of never, ask, auto/)
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
    surface: 'ui',
    feature: 'invoices',
    tags: ['financial', 'critical'],
    roles: ['admin'],
    viewports: [],
    design: {},
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

test('surface defaults to ui and must be allowed by the stack', () => {
  const runbook = (surface) => `---\nid: s.${surface}\ncapability: s\nsurface: ${surface}\nstatus: draft\n---\n`
  const files = { 'docs/runbooks/s/ui.md': runbook('ui'), 'docs/runbooks/s/api.md': runbook('api'), 'docs/runbooks/s/cli.md': runbook('cli') }
  const load = (config) => {
    const dir = tmpProject({ [CONFIG_PATH]: config, ...files, 'docs/runbooks/s/none.md': '---\nid: s.none\ncapability: s\nstatus: draft\n---\n' })
    return Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  }
  const frontend = load('{ "version": 1 }')
  assert.equal(frontend['s.none'].surface, 'ui')
  assert.deepEqual(frontend['s.ui'].problems, [])
  assert.deepEqual(frontend['s.api'].problems, ['surface "api" is not allowed in a frontend stack'])
  assert.deepEqual(frontend['s.cli'].problems, ['surface "cli" must be one of ui, api'])
  const fullstack = load('{ "version": 1, "stack": "fullstack" }')
  assert.equal(fullstack['s.api'].surface, 'api')
  assert.deepEqual(fullstack['s.api'].problems, [])
  assert.deepEqual(load('{ "version": 1, "stack": "backend" }')['s.ui'].problems, ['surface "ui" is not allowed in a backend stack'])
})

test('loadConfig reads stack and tests, and migrates paths.e2e', () => {
  const load = (json) => loadConfig(tmpProject({ [CONFIG_PATH]: json }))
  assert.equal(load('{ "version": 1 }').stack, 'frontend')
  assert.deepEqual(load('{ "version": 1 }').tests, {})
  assert.deepEqual(load('{ "version": 1, "paths": { "e2e": "e2e" } }').tests, { ui: { framework: 'playwright', dir: 'e2e' } })
  const api = { framework: 'phpunit', dir: 'tests/Feature', command: 'php artisan test {files} --log-junit {junit}' }
  assert.deepEqual(load(JSON.stringify({ version: 1, stack: 'backend', tests: { api } })).tests, { api })
  assert.throws(() => load('{ "version": 1, "stack": "mobile" }'), /stack must be one of frontend, backend, fullstack/)
})

test('loadConfig checks viewports', () => {
  const load = (viewports) => loadConfig(tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, viewports }) }))
  assert.deepEqual(loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1 }' })).viewports, {})
  assert.deepEqual(load({ mobile: { width: 390, height: 844 } }).viewports, { mobile: { width: 390, height: 844 } })
  assert.throws(() => load(['mobile']), /viewports must map each name to \{ "width", "height" \}/)
  assert.throws(() => load({ Mobile: { width: 390, height: 844 } }), /viewports\.Mobile: names are kebab-case/)
  assert.throws(() => load({ mobile: { width: 390 } }), /viewports\.mobile: width and height must be positive integers/)
  assert.throws(() => load({ mobile: { width: '390', height: 844 } }), /viewports\.mobile: width and height must be positive integers/)
})

test('viewports must be in the config and apply only to ui runbooks', () => {
  const runbook = (id, extra) => `---\nid: v.${id}\ncapability: v\nstatus: draft\n${extra}\n---\n`
  const dir = tmpProject({
    [CONFIG_PATH]: JSON.stringify({ version: 1, stack: 'fullstack', viewports: { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } }),
    'docs/runbooks/v/ok.md': runbook('ok', 'viewports: [desktop, mobile]'),
    'docs/runbooks/v/unknown.md': runbook('unknown', 'viewports: [desktop, watch]'),
    'docs/runbooks/v/api.md': runbook('api', 'surface: api\nviewports: [mobile]'),
  })
  const byId = Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  assert.deepEqual(byId['v.ok'].viewports, ['desktop', 'mobile'])
  assert.deepEqual(byId['v.ok'].problems, [])
  assert.deepEqual(byId['v.unknown'].problems, ['viewport "watch" is not in the config viewports'])
  assert.deepEqual(byId['v.api'].problems, ['viewports apply only to ui runbooks'])
})

test('loadConfig checks the design system', () => {
  const load = (json) => loadConfig(tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, ...json }) }))
  assert.equal(load({}).design, null)
  assert.deepEqual(load({ design: { system: 'figma', mcp: 'figma' } }).design, { system: 'figma', mcp: 'figma' })
  assert.deepEqual(load({ design: { system: 'claude-design' } }).design, { system: 'claude-design' })
  assert.throws(() => load({ design: 'figma' }), /design must be an object with a "system"/)
  assert.throws(() => load({ design: { system: 'sketchbook' } }), /design\.system must be one of figma, claude-design, adobe-xd, files, other/)
  assert.throws(() => load({ design: { system: 'figma' } }), /design: figma needs "mcp" or "files"/)
  assert.throws(() => load({ design: { system: 'adobe-xd', mcp: 'xd' } }), /design: adobe-xd needs "files"/)
  assert.throws(() => load({ stack: 'backend', design: { system: 'files', files: 'design/**' } }), /design applies only to ui runbooks, and a backend stack has none/)
})

test('design references need a system, a ui surface and known viewports', () => {
  const runbook = (id, extra) => `---\nid: d.${id}\ncapability: d\nstatus: draft\n${extra}\n---\n`
  const files = {
    'docs/runbooks/d/ok.md': runbook('ok', 'viewports: [mobile]\ndesign:\n  list: "https://www.figma.com/design/AbC/App?node-id=1-2"\n  list.mobile: design/list-mobile.png'),
    'docs/runbooks/d/bad.md': runbook('bad', 'design:\n  list.watch: design/list.png\n  empty: ""'),
    'docs/runbooks/d/api.md': runbook('api', 'surface: api\ndesign:\n  list: design/list.png'),
    'docs/runbooks/d/list.md': runbook('list', 'design: [design/list.png]'),
  }
  const load = (design) => {
    const dir = tmpProject({
      [CONFIG_PATH]: JSON.stringify({ version: 1, stack: 'fullstack', viewports: { mobile: { width: 390, height: 844 } }, design }),
      ...files,
    })
    return Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  }
  const byId = load({ system: 'figma', mcp: 'figma' })
  assert.deepEqual(byId['d.ok'].design, { list: 'https://www.figma.com/design/AbC/App?node-id=1-2', 'list.mobile': 'design/list-mobile.png' })
  assert.deepEqual(byId['d.ok'].problems, [])
  assert.deepEqual(byId['d.bad'].problems, ['design "list.watch": "watch" is not one of the runbook\'s viewports', 'design "empty" needs a reference'])
  assert.deepEqual(byId['d.api'].problems, ['design applies only to ui runbooks'])
  assert.deepEqual(byId['d.list'].problems, ['design must map each name to a reference'])
  assert.deepEqual(load(null)['d.ok'].problems, ['design references need a design system in the config'])
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

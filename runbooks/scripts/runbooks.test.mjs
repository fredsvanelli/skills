import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, ConfigError, upstreamModeOf, rolesEnabled, rolesFileOf } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { filterRunbooks } from './lib/filter.mjs'
import { run } from './runbooks.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-project-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

const CONFIG_PATH = 'docs/runbooks/runbooks.config.json'

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

test('loadConfig reads roles.enabled', () => {
  assert.deepEqual(loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1 }' })).roles, { enabled: false })
  const on = loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "roles": { "enabled": true } }' }))
  assert.equal(rolesEnabled(on), true)
  assert.equal(rolesFileOf(on), 'docs/runbooks/roles.json')
  assert.throws(() => loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1, "roles": { "enabled": "yes" } }' })), /roles\.enabled must be true or false/)
})

test('loadConfig explains what is wrong', () => {
  assert.throws(() => loadConfig(tmpProject({})), (err) => err instanceof ConfigError && /not found\. Run \/runbooks:setup first/.test(err.message))
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
    rolesAll: false,
    review: [],
    roleOutcomes: {},
    viewports: [],
    design: {},
    covers: { entries: ['/billing/invoices', 'POST /admin/invoices'], requirements: ['REQ-1'] },
    calls: [],
    sources: ['docs/specs/billing.md'],
    scripts: ['e2e/billing/issue-invoice.runbook.spec.ts'],
    status: 'active',
    lastRun: {
      date: '2026-10-01',
      oldest: null,
      commit: 'abc1234',
      result: 'passed',
      report: '_runs/2026-10-01-0900-billing.issue-invoice.md',
      mixed: false,
      outdated: false,
      runs: {},
      cells: [],
      legacy: true
    },
    upstream: 'live',
    problems: [],
    warnings: [],
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

test('last_run.outdated must be a boolean', () => {
  const runbook = (flow, outdated) => `---\nid: o.${flow}\ncapability: o\nstatus: active\nlast_run: { date: 2026-10-01, commit: "abc1234", result: passed, report: _runs/x.md, outdated: ${outdated} }\n---\n`
  const dir = tmpProject({
    [CONFIG_PATH]: '{ "version": 1 }',
    'docs/runbooks/o/yes.md': runbook('yes', 'true'),
    'docs/runbooks/o/maybe.md': runbook('maybe', 'maybe'),
  })
  const byId = Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  assert.equal(byId['o.yes'].lastRun.outdated, true)
  assert.deepEqual(byId['o.yes'].problems, [])
  assert.deepEqual(byId['o.maybe'].problems, ['last_run.outdated must be true or false'])
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

function upstreamProject(config) {
  const runbook = (id, extra = '') => `---\nid: billing.${id}\ncapability: billing\nstatus: active\n${extra}---\n`
  return tmpProject({
    [CONFIG_PATH]: JSON.stringify({ version: 1, stack: 'frontend', ...config }),
    'docs/runbooks/billing/issue.md': runbook('issue'),
    'docs/runbooks/billing/errors.md': runbook('errors', 'upstream: mocked\n'),
  })
}

test('a ui runbook takes the project mode unless it overrides it', () => {
  const dir = upstreamProject({ upstream: { mode: 'live', urlEnv: 'API_URL' } })
  const byId = Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  assert.equal(byId['billing.issue'].upstream, 'live')
  assert.equal(byId['billing.errors'].upstream, 'mocked')
  assert.deepEqual(byId['billing.errors'].warnings, [
    'mocked runbook without a script: no automated run checks its fixtures',
    'mocked runbook has no fixtures in docs/runbooks/_fixtures/billing/errors',
  ])
  assert.deepEqual(byId['billing.errors'].problems, [])
  assert.deepEqual(byId['billing.issue'].warnings, [])
})

test('a mocked runbook with fixtures and a script has no warnings', () => {
  const dir = upstreamProject({ upstream: { mode: 'mocked', urlEnv: 'API_URL' } })
  fs.mkdirSync(path.join(dir, 'docs/runbooks/_fixtures/billing/issue/S01'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/_fixtures/billing/issue/S01/get.json'), '{}')
  fs.writeFileSync(path.join(dir, 'docs/runbooks/billing/issue.md'), '---\nid: billing.issue\ncapability: billing\nstatus: active\nscripts: [e2e/issue.spec.ts]\n---\n')
  const issue = loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'billing.issue')
  assert.equal(issue.upstream, 'mocked')
  assert.deepEqual(issue.warnings, [])
})

test('upstream problems', () => {
  const runbook = (id, extra) => `---\nid: u.${id}\ncapability: u\nstatus: active\n${extra}\n---\n`
  const load = (config, files) => {
    const dir = tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, ...config }), ...files })
    return Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  }
  const withUrl = load({ stack: 'fullstack', upstream: { mode: 'live', urlEnv: 'API_URL' } }, {
    'docs/runbooks/u/fake.md': runbook('fake', 'upstream: fake'),
    'docs/runbooks/u/api.md': runbook('api', 'surface: api\nupstream: mocked'),
  })
  assert.deepEqual(withUrl['u.fake'].problems, ['upstream "fake" must be one of live, mocked'])
  assert.equal(withUrl['u.fake'].upstream, 'live')
  assert.deepEqual(withUrl['u.api'].problems, ['upstream applies only to ui runbooks'])
  assert.equal(withUrl['u.api'].upstream, null)
  const noUrl = load({ stack: 'frontend' }, { 'docs/runbooks/u/m.md': runbook('m', 'upstream: mocked') })
  assert.deepEqual(noUrl['u.m'].problems, ['a mocked runbook needs upstream.urlEnv in the config'])
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

test('loadConfig: no upstream block means live', () => {
  const config = loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1 }' }))
  assert.equal(config.upstream, null)
  assert.equal(upstreamModeOf(config), 'live')
})

test('loadConfig fills upstream defaults', () => {
  const dir = tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, upstream: { mode: 'mocked', urlEnv: 'NEXT_PUBLIC_API_URL' } }) })
  const { upstream } = loadConfig(dir)
  assert.deepEqual(upstream, {
    mode: 'mocked', baseUrl: '', start: [], urlEnv: 'NEXT_PUBLIC_API_URL', port: 4010,
    fixtures: 'docs/runbooks/_fixtures', schema: null, redactHeaders: [], redactBodyKeys: [], tokenEnv: '', serverFile: null,
  })
})

test('loadConfig rejects a bad upstream block', () => {
  const bad = (upstream, extra = {}) => tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, upstream, ...extra }) })
  assert.throws(() => loadConfig(bad({ mode: 'fake' })), /upstream.mode must be one of live, mocked/)
  assert.throws(() => loadConfig(bad({ mode: 'live' }, { stack: 'backend' })), /upstream applies only to ui runbooks, and a backend stack has none/)
  assert.throws(() => loadConfig(bad({ mode: 'mocked' })), /upstream.urlEnv is required when upstream.mode is mocked/)
  assert.throws(() => loadConfig(bad({ mode: 'live', port: 70000 })), /upstream.port must be an integer from 1 to 65535/)
  assert.throws(() => loadConfig(bad({ mode: 'live', schema: 'openapi.yaml' })), /upstream.schema must be a JSON file/)
  assert.throws(() => loadConfig(bad({ mode: 'live', redactHeaders: 'x-key' })), /upstream.redactHeaders must be a list of header names/)
  assert.throws(() => loadConfig(bad({ mode: 'live', redactBodyKeys: ['otp', ''] })), /upstream.redactBodyKeys must be a list of key names/)
})

test('loadConfig rejects an upstream block that is not an object', () => {
  for (const upstream of ['abc', [1], false, 0]) {
    const dir = tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, upstream }) })
    assert.throws(() => loadConfig(dir), /upstream must be an object/)
  }
})

test('loadConfig warns about paths outside the project except tests.ui.root, see docs/adr/0005 and 0007', () => {
  const load = (config) => loadConfig(tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, ...config }) })).warnings
  assert.deepEqual(load({}), [])
  assert.deepEqual(load({
    stack: 'fullstack',
    entries: [
      { extractor: 'next-app-router', glob: 'src/app/**/page.tsx' },
      { extractor: 'next-app-router', root: 'apps/api', glob: 'src/app/**/route.ts' },
      { extractor: 'next-app-router', root: '../api', glob: 'src/app/**/route.ts' },
    ],
    slices: { billing: ['src/app/billing/**', 'apps/api/src/app/invoices/**', '../api/src/app/invoices/**'] },
    tests: { ui: { framework: 'playwright', dir: 'tests', root: '../app-e2e' }, api: { framework: 'jest', dir: 'test', root: '../api' } },
    upstream: { mode: 'live', root: '../api' },
  }), [
    'entries[2]: root "../api" is outside the project, so its CI never reads it (docs/adr/0005). /runbooks:settings sources moves its ids to calls. From runbooks 2.0 it is a config error',
    'slices.billing: glob "../api/src/app/invoices/**" is outside the project and never matches a change (docs/adr/0005). From runbooks 2.0 it is a config error',
    'tests.api.root "../api" is outside the project (docs/adr/0005). From runbooks 2.0 it is a config error',
    'upstream.root is no longer read (docs/adr/0005); /runbooks:settings upstream removes it',
  ])
})

test('calls: METHOD /path of the upstream API, braces for parameters, see docs/adr/0005', () => {
  const runbook = (id, extra) => `---\nid: u.${id}\ncapability: u\nstatus: active\n${extra}\n---\n`
  const load = (config, files) => {
    const dir = tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, ...config }), ...files })
    return Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  }
  const upstream = { mode: 'live', urlEnv: 'API_URL' }
  const byId = load({ stack: 'fullstack', upstream }, {
    'docs/runbooks/u/screen.md': runbook('screen', 'calls: [GET /quotes/[id], "POST /quotes", GET /quotes/{id}, GET /files/[...path]]'),
    'docs/runbooks/u/none.md': runbook('none', ''),
    'docs/runbooks/u/bad.md': runbook('bad', 'calls: [/quotes, fetch /x, GET quotes]'),
    'docs/runbooks/u/api.md': runbook('api', 'surface: api\ncalls: [GET /quotes]'),
  })
  assert.deepEqual(byId['u.screen'].calls, ['GET /quotes/{id}', 'POST /quotes', 'GET /files/{path}'])
  assert.deepEqual(byId['u.screen'].problems, [])
  assert.deepEqual(byId['u.none'].calls, [])
  assert.deepEqual(byId['u.bad'].problems, [
    'call "/quotes" must be "METHOD /path"',
    'call "fetch /x" must be "METHOD /path"',
    'call "GET quotes" must be "METHOD /path"',
  ])
  assert.deepEqual(byId['u.api'].problems, ['calls apply only to ui runbooks'])
  const noUpstream = load({ stack: 'frontend' }, { 'docs/runbooks/u/screen.md': runbook('screen', 'calls: [GET /quotes]') })
  assert.deepEqual(noUpstream['u.screen'].problems, ['calls need an upstream block in the config'])
})

const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))

const roleRunbook = (dir, id) => loadRunbooks(dir, loadConfig(dir)).find((r) => r.id === id)

function rolesCopy(rel, edit) {
  const dir = tmpProject({})
  fs.cpSync(ROLES, dir, { recursive: true })
  const file = path.join(dir, 'docs/runbooks', rel)
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
  return dir
}

test('loadRunbooks expands roles: all and reads review', () => {
  const rb = roleRunbook(ROLES, 'billing.cancel-invoice')
  assert.equal(rb.rolesAll, true)
  assert.deepEqual(rb.roles, ['viewer', 'editor', 'manager', 'admin', 'anonymous'])
  assert.deepEqual(rb.review, [{ reason: 'role-permissions', role: 'manager', key: 'billing/invoices', change: 'delete removed', date: '2026-10-14' }])
  assert.deepEqual(rb.roleOutcomes, { anonymous: ['denied'], editor: ['hidden'], viewer: ['read-only'] })
  assert.deepEqual(rb.problems, [])
})

test('loadRunbooks warns about As: outside the migration', () => {
  const rb = roleRunbook(ROLES, 'billing.legacy')
  assert.deepEqual(rb.warnings, ['S01: As: is replaced by role lines; /runbooks:update rewrites it'])
  assert.deepEqual(rb.problems, [])
  assert.equal(rb.rolesAll, false)
  assert.deepEqual(rb.roles, ['admin'])
})

test('loadRunbooks checks role lines against the runbook and the surface', () => {
  const dir = rolesCopy('billing/create-invoice.md', (text) => text
    .replace('- anonymous: denied. 401', '- anonymous: denied. 401\n- editor: hidden.')
    .replace('Parents: S01\nEndpoint', 'Parents: S01\nRoles: ghost\nEndpoint'))
  const rb = roleRunbook(dir, 'billing.create-invoice')
  assert.ok(rb.problems.includes('S01: outcome "hidden" does not apply to api steps'))
  assert.ok(rb.problems.includes('role "ghost" is not registered'))
  assert.ok(rb.problems.includes('S02: Roles: "ghost" is not one of the runbook\'s roles'))
})

test('loadRunbooks checks a role line against the step roles and the review entries', () => {
  const dir = rolesCopy('billing/cancel-invoice.md', (text) => text
    .replace('Parents: S01\nPage', 'Parents: S01\nRoles: editor\nPage')
    .replace('review: [{', 'review: [{ reason: role-created }, { reason: bogus, date: 2026-10-14 }, { reason: roles-enabled, date: 2026-10-14 }, {')
    .replace('- editor: hidden.', '- editor: hidden.\n- viewer: hidden.'))
  const rb = roleRunbook(dir, 'billing.cancel-invoice')
  assert.ok(rb.problems.includes('S02: role line "viewer" is not one of the step\'s roles'))
  assert.ok(rb.problems.includes('review[0]: date is required'))
  assert.ok(rb.problems.includes('review[0]: role-created needs role'))
  assert.ok(rb.problems.includes('review[1]: reason "bogus" must be one of roles-enabled, role-permissions, role-created, role-deleted, context-created, case-created'))
  assert.equal(rb.problems.some((p) => p.startsWith('review[2]')), false)
})

test('loadRunbooks ignores Not covered and Cleanup bullets after the last step', () => {
  const dir = rolesCopy('billing/cancel-invoice.md', (text) => text
    .replace('- E-mail sent to the client.', '- persistence: mocked runbooks cannot show it.')
    .replace('Reopen "Invoice A" in the test data.', '- data: deleted by the script.'))
  const rb = roleRunbook(dir, 'billing.cancel-invoice')
  assert.deepEqual(rb.problems, [])
  assert.deepEqual(rb.roleOutcomes, { anonymous: ['denied'], editor: ['hidden'], viewer: ['read-only'] })
})

test('loadRunbooks keeps plain Expected bullets and reports an outcome line for an unregistered role', () => {
  const dir = rolesCopy('billing/cancel-invoice.md', (text) => text
    .replace('- editor: hidden. The row shows no "Cancel" button.', '- status: paid\n- editor: hidden. The row shows no "Cancel" button.\n- ghost: denied.'))
  const rb = roleRunbook(dir, 'billing.cancel-invoice')
  assert.deepEqual(rb.problems, ['role "ghost" is not registered'])
  assert.equal(rb.roleOutcomes.status, undefined)
})

test('loadRunbooks reads a role line named like an Object key without crashing', () => {
  const dir = rolesCopy('billing/cancel-invoice.md', (text) => text.replace('- editor: hidden.', '- editor: hidden.\n- constructor: denied.'))
  const rb = roleRunbook(dir, 'billing.cancel-invoice')
  assert.deepEqual(rb.problems, ['role "constructor" is not registered'])
  assert.ok(Object.hasOwn(rb.roleOutcomes, 'constructor'))
  assert.deepEqual(rb.roleOutcomes.constructor, ['denied'])
})

test('loadRunbooks reports an empty roles list when tracking is on', () => {
  const dir = rolesCopy('billing/legacy.md', (text) => text.replace('roles: [admin]', 'roles: []'))
  const rb = roleRunbook(dir, 'billing.legacy')
  assert.deepEqual(rb.problems, ['roles must list at least one role, or be all'])
  assert.deepEqual(rb.roles, [])
})

test('loadRunbooks reports a role-permissions entry without its fields', () => {
  const dir = rolesCopy('billing/cancel-invoice.md', (text) => text.replace(', key: billing/invoices, change: delete removed', ''))
  assert.ok(roleRunbook(dir, 'billing.cancel-invoice').problems.includes('review[0]: role-permissions needs role, key and change'))
})

test('loadRunbooks rejects roles: all and review when tracking is off', () => {
  const dir = tmpProject({
    [CONFIG_PATH]: '{ "version": 1, "stack": "frontend" }',
    'docs/runbooks/a/b.md': '---\nid: a.b\ncapability: a\nstatus: draft\nroles: all\nreview: [{ reason: roles-enabled, date: 2026-10-14 }]\n---\n\n# B\n\n### S01. x\n\nAs: nobody\n- ghost: hidden.\n',
  })
  const rb = roleRunbook(dir, 'a.b')
  assert.deepEqual(rb.problems, ['roles: all needs role tracking (roles.enabled)', 'review needs role tracking (roles.enabled)'])
  assert.deepEqual(rb.warnings, [])
  assert.equal(rb.rolesAll, false)
})

test('tracking off keeps 1.5.0 behavior', () => {
  const runbooks = loadRunbooks(FIXTURE, loadConfig(FIXTURE))
  assert.deepEqual(runbooks.find((r) => r.id === 'deliveries.list-deliveries').roles, ['admin', 'partner'])
  assert.ok(runbooks.every((r) => r.rolesAll === false && r.review.length === 0))
  // Recorded from the 1.5.0 loader before the roles change.
  const recorded = {
    'billing.cancel-invoice': { problems: [], warnings: [] },
    'billing.issue-invoice': { problems: [], warnings: [] },
    'broken.bad-frontmatter': { problems: ['frontmatter: line 2: expected , or ]'], warnings: [] },
    'deliveries.list-deliveries': { problems: [], warnings: [] },
    'deliveries.old-list': { problems: [], warnings: [] },
  }
  assert.deepEqual(Object.fromEntries(runbooks.map((r) => [r.id, { problems: r.problems, warnings: r.warnings }])), recorded)
})

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))

function copyContexts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-contexts-'))
  fs.cpSync(CONTEXTS, dir, { recursive: true })
  return dir
}

function withEditClient(transform) {
  const dir = copyContexts()
  const file = path.join(dir, 'docs/runbooks/clients/edit-client.md')
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')))
  return loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'clients.edit-client').problems
}

test('loadRunbooks reads cases and their outcomes', () => {
  const byId = new Map(loadRunbooks(CONTEXTS, loadConfig(CONTEXTS)).map((rb) => [rb.id, rb]))
  const edit = byId.get('clients.edit-client')
  assert.deepEqual(edit.problems, [])
  assert.equal(edit.context, 'client-access')
  assert.deepEqual(edit.cases, ['vip-team', 'vip-outside', 'regular'])
  assert.equal(edit.casesAll, true)
  assert.deepEqual(edit.outcomesByCase.manager, { 'vip-outside': ['read-only'] })
  assert.deepEqual(edit.outcomesByCase.viewer, { 'vip-team': ['read-only'], 'vip-outside': ['read-only'], regular: ['read-only'] })
  assert.deepEqual(edit.roleOutcomes.manager, ['read-only'])
  assert.equal(byId.get('clients.list-clients').casesAll, true)
  assert.deepEqual(byId.get('clients.list-clients').problems, [])
  assert.equal(byId.get('billing.list-invoices').context, null)
  assert.deepEqual(byId.get('billing.list-invoices').cases, [])
})

test('loadRunbooks reports case problems', () => {
  const has = (transform, problem) => assert.ok(withEditClient(transform).includes(problem), problem)
  has((t) => t.replace('cases: all', 'cases: []'), 'cases must list at least one case, or be all')
  has((t) => t.replace('cases: all', 'cases: [vip-team, toString]'), 'case "toString" is not a case of client-access')
  has((t) => t.replace(/ {2}- vip-team:.*\r?\n/, ''), 'Preconditions: case "vip-team" has no line under Cases:')
  has((t) => t.replace('Parents: S01', 'Parents: S01\nCases: gold'), 'S02: Cases: "gold" is not one of the runbook\'s cases')
  has((t) => t.replace('Parents: S01', 'Parents: S01\nCases: regular'), 'S02: role line "manager in vip-outside" names a case the step does not run')
  has((t) => t.replace('- viewer: read-only.', '- viewer: hidden. Twice.\n- viewer: read-only.'), 'S02: two role lines for viewer')
  has((t) => t.replace('- viewer: read-only.', '- viewer in regular: hidden. A.\n- viewer in regular: hidden. B.\n- viewer: read-only.'), 'S02: two role lines for viewer in regular')
  has((t) => t.replace('  - regular:', '  - gold: client "Zed".\n  - regular:'), 'Preconditions: Cases: "gold" is not one of the runbook\'s cases')
})

test('a role line with a case needs a runbook with a context', () => {
  const dir = copyContexts()
  const file = path.join(dir, 'docs/runbooks/billing/list-invoices.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('the list holds the invoice.', 'the list holds the invoice.\n- viewer in regular: denied. 403.'))
  const billing = loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'billing.list-invoices')
  assert.ok(billing.problems.includes('S01: role line "viewer in regular": the runbook has no context'))
})

test('context-created and case-created review entries need their field', () => {
  const problems = withEditClient((t) => t.replace('cases: all', 'cases: all\nreview:\n  - { reason: context-created, date: 2026-10-22 }\n  - { reason: case-created, date: 2026-10-22 }'))
  assert.ok(problems.includes('review[0]: context-created needs context'))
  assert.ok(problems.includes('review[1]: case-created needs case'))
})

test('cases need a context and role tracking', () => {
  const dir = copyContexts()
  const file = path.join(dir, 'docs/runbooks/billing/list-invoices.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('roles: all', 'roles: all\ncases: all'))
  const billing = loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'billing.list-invoices')
  assert.ok(billing.problems.includes('cases needs a context: billing/invoices belongs to no context'))

  const off = copyContexts()
  const cfgPath = path.join(off, 'docs/runbooks/runbooks.config.json')
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  cfg.roles = { enabled: false }
  fs.writeFileSync(cfgPath, JSON.stringify(cfg))
  const edit = loadRunbooks(off, loadConfig(off)).find((rb) => rb.id === 'clients.edit-client')
  assert.ok(edit.problems.includes('cases needs role tracking (roles.enabled)'))
})

test('outcomesByCase keeps the outcome that applies in each step', () => {
  const by = (transform) => {
    const dir = copyContexts()
    const file = path.join(dir, 'docs/runbooks/clients/edit-client.md')
    fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')))
    return loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'clients.edit-client')
  }
  const same = by((t) => t.replace('- viewer: read-only.', '- viewer in regular: hidden. A.\n- viewer: read-only.'))
  assert.deepEqual(same.outcomesByCase.viewer, { 'vip-team': ['read-only'], 'vip-outside': ['read-only'], regular: ['hidden'] })
  const two = by((t) => t.replace('Expected: the page shows the client.', 'Expected: the page shows the client.\n- viewer: read-only. A.').replace('- viewer: read-only. The', '- viewer in regular: hidden. The'))
  assert.deepEqual(two.outcomesByCase.viewer.regular, ['read-only', 'hidden'])
  assert.deepEqual(two.outcomesByCase.viewer['vip-team'], ['read-only'])
  const limited = by((t) => t.replace('Parents: S01', 'Parents: S01\nCases: regular'))
  assert.deepEqual(limited.outcomesByCase.viewer, { regular: ['read-only'] })
})

test('a registry with no contexts gives runbooks without the case fields', () => {
  const fields = ['context', 'cases', 'casesAll', 'outcomesByCase']
  const runbooks = loadRunbooks(ROLES, loadConfig(ROLES))
  assert.ok(runbooks.length > 0)
  for (const rb of runbooks) assert.deepEqual(fields.filter((field) => Object.hasOwn(rb, field)), [], rb.id)
  const dir = rolesCopy('billing/cancel-invoice.md', (t) => t.replace('roles: all', 'roles: all\ncases: [regular]'))
  const rb = roleRunbook(dir, 'billing.cancel-invoice')
  assert.ok(rb.problems.includes('cases needs a context: billing/invoices belongs to no context'))
  assert.deepEqual(fields.filter((field) => Object.hasOwn(rb, field)), [])
})

test('a case listed twice in cases is a problem and runs once', () => {
  const dir = copyContexts()
  const file = path.join(dir, 'docs/runbooks/clients/edit-client.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('cases: all', 'cases: [vip-team, vip-team, regular]').replace(/ {2}- vip-outside:.*\r?\n/, ''))
  const edit = loadRunbooks(dir, loadConfig(dir)).find((rb) => rb.id === 'clients.edit-client')
  assert.deepEqual(edit.cases, ['vip-team', 'regular'])
  assert.deepEqual(edit.problems.filter((p) => p.startsWith('case ')), ['case "vip-team" appears twice in cases'])
  const out = run(['passes', 'clients.edit-client', '--json', '--role', 'manager', '--root', dir])
  assert.deepEqual(JSON.parse(out.stdout).passes.map((p) => p.case), ['vip-team', 'regular'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { run } from './runbooks.mjs'
import { upstreamOptions, copiedServerWarning, copiedServerProblem, packageScript } from './lib/upstream.mjs'
import { VERSION, createUpstreamServer } from './upstream-server.mjs'
import { parseArgs } from './lib/args.mjs'
import { loadConfig } from './lib/config.mjs'
import { pct } from './lib/format.mjs'
import { DEFAULT_MODELS } from './lib/models.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const SCRIPT = fileURLToPath(new URL('./runbooks.mjs', import.meta.url))

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['list', '--affected', '--json']), { command: 'list', options: { affected: true, json: true }, positionals: [] })
  assert.deepEqual(parseArgs(['list', '--affected', 'develop']), { command: 'list', options: { affected: 'develop' }, positionals: [] })
  assert.deepEqual(parseArgs(['coverage', 'x', '--slice', 'billing']), { command: 'coverage', options: { slice: 'billing' }, positionals: ['x'] })
})

test('pct', () => {
  assert.equal(pct(3, 9), '33.3%')
  assert.equal(pct(0, 0), 'n/a')
  assert.equal(pct(2, 2), '100%')
})

test('list prints a table and warns about invalid runbooks', () => {
  const result = run(['list', '--root', FIXTURE])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /^\| Id \| Title \| Capability \/ feature \| Status \| Last run \|$/m)
  assert.match(result.stdout, /^\| billing\.issue-invoice \| Issue a partner invoice \| billing \/ invoices \| active \| 2026-10-01 passed \|$/m)
  assert.match(result.stdout, /^\| billing\.cancel-invoice \| Cancel an invoice \| billing \/ invoices \| draft \| never \|$/m)
  assert.match(result.stdout, /^\| deliveries\.list-deliveries \| List deliveries \| deliveries \/ deliveries \| active \| 2026-09-20 failed \(outdated\) \|$/m)
  assert.match(result.stdout, /^\| broken\.bad-frontmatter \|  \| broken \| invalid \| never \|$/m)
  assert.match(result.stderr, /^warning: docs\/runbooks\/broken\/bad-frontmatter\.md: frontmatter: line 2: expected , or \]$/m)
})

test('list filters and --json', () => {
  const result = run(['list', '--root', FIXTURE, '--capability', 'deliveries', '--status', 'active', '--json'])
  assert.deepEqual(JSON.parse(result.stdout).map((rb) => rb.id), ['deliveries.list-deliveries'])
  const byPath = run(['list', '--root', FIXTURE, '--path', 'src/app/[locale]/(dashboard)/deliveries/**', '--json'])
  assert.deepEqual(JSON.parse(byPath.stdout).map((rb) => rb.id), ['deliveries.list-deliveries', 'deliveries.old-list'])
  assert.equal(run(['list', '--root', FIXTURE, '--tag', 'nope']).stdout, 'No runbooks match.\n')
})

test('entries and requirements', () => {
  const entries = JSON.parse(run(['entries', '--root', FIXTURE, '--slice', 'billing', '--json']).stdout)
  assert.equal(entries.length, 5)
  assert.equal(entries.every((e) => e.slice === 'billing'), true)
  const table = run(['entries', '--root', FIXTURE]).stdout
  assert.match(table, /^\| POST \/admin\/invoices \| api-endpoint \| billing \| \.\.\/api\/src\/app\/admin\/invoices\/route\.ts \|$/m)
  const requirements = JSON.parse(run(['requirements', '--root', FIXTURE, '--json']).stdout)
  assert.deepEqual(requirements.map((r) => r.id), ['REQ-1', 'REQ-2', 'REQ-3'])
})

test('coverage Markdown carries the script numbers', () => {
  const { code, stdout } = run(['coverage', '--root', FIXTURE])
  assert.equal(code, 0)
  assert.match(stdout, /^Scope: overall$/m)
  assert.match(stdout, /^\| Entry points \| 3 \| 2 \| 0 \| 9 \| 33\.3% \|$/m)
  assert.match(stdout, /^\| Requirements \| 1 \| 1 \| 0 \| 3 \| 33\.3% \|$/m)
  assert.match(stdout, /^Active runbooks: 2\. Draft runbooks: 1\. Placeholders: 0\. Active runbooks with a script: 1\.$/m)
  assert.match(stdout, /^\| billing \| 2 \| 2 \| 0 \| 5 \| 40% \|$/m)
  assert.match(stdout, /^- `GET \/admin\/invoices` \(`\.\.\/api\/src\/app\/admin\/invoices\/route\.ts`\)$/m)
  assert.match(stdout, /^- `REQ-3`: Partner downloads an invoice PDF$/m)
  assert.match(stdout, /^- `deliveries\.list-deliveries` cites entry `\/deliveries\/\[deliveryId\]`, which no longer exists$/m)
  assert.match(stdout, /^- `docs\/runbooks\/broken\/bad-frontmatter\.md`: frontmatter: line 2/m)
})

test('coverage with a filter names the scope; --json returns the numbers', () => {
  assert.match(run(['coverage', '--root', FIXTURE, '--capability', 'billing']).stdout, /^Scope: capability billing$/m)
  const json = JSON.parse(run(['coverage', '--root', FIXTURE, '--json']).stdout)
  assert.equal(json.entries.total, 9)
  assert.deepEqual(json.warnings, [])
})

test('coverage without requirement sources says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbooks.config.json'), '{ "version": 1 }')
  assert.match(run(['coverage', '--root', dir]).stdout, /^\| Requirements \| - \| - \| - \| - \| no requirement source configured \|$/m)
})

test('a config under the old plugin name points to setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbook.config.json'), '{ "version": 1 }')
  const result = run(['list', '--root', dir])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /docs\/runbooks\/runbook\.config\.json exists\. Run \/runbooks:setup to migrate it\./)
})

test('status', () => {
  assert.equal(run(['status', '--current', 'draft', '--states', 'passed,waived']).stdout, 'active\n')
  assert.equal(run(['status', '--current', 'draft', '--states', 'waived,waived']).stdout, 'draft\n')
  assert.equal(run(['status', '--current', 'draft', '--states', 'passed', '--partial']).stdout, 'draft\n')
  assert.deepEqual(JSON.parse(run(['status', '--current', 'draft', '--states', 'passed', '--json']).stdout), { status: 'active' })
  const bad = run(['status', '--current', 'draft'])
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /status needs --current and --states/)
})

test('errors exit 2 with a readable message', () => {
  const missing = run(['list', '--root', path.join(os.tmpdir(), 'runbooks-no-such-project')])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /^runbooks: docs\/runbooks\/runbooks\.config\.json not found/m)
  const unknown = run(['bogus'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /unknown command "bogus"/)
  assert.match(unknown.stdout, /^Usage: runbooks\.mjs <command> \[options\]/)
})

test('help', () => {
  assert.match(run([]).stdout, /^Usage:/)
  assert.match(run(['--help']).stdout, /^Usage:/)
})

test('the file runs as a program', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'list', '--root', FIXTURE, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(JSON.parse(out).length, 5)
})

test('list, coverage, entries and requirements print the config warnings', () => {
  for (const command of ['list', 'coverage', 'entries', 'requirements']) {
    const { code, stderr } = run([command, '--root', FIXTURE])
    assert.equal(code, 0)
    assert.match(stderr, /^warning: entries\[1\]: root "\.\.\/api" is outside the project/m, command)
    assert.match(stderr, /^warning: slices\.billing: glob "\.\.\/api\/src\/app\/admin\/invoices\/\*\*" is outside the project/m, command)
  }
  assert.doesNotMatch(run(['check', 'billing.issue-invoice', '--root', FIXTURE]).stderr, /outside the project/)
})

test('coverage with a missing sibling root reports no false orphans', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks/billing'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbooks.config.json'), JSON.stringify({
    version: 1,
    entries: [{ extractor: 'next-app-router', root: '../missing-api', glob: 'src/app/**/route.ts' }],
    requirements: [{ extractor: 'command', command: 'node -e "process.exit(3)"' }],
  }))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/billing/pay.md'), '---\nid: billing.pay\ncapability: billing\nstatus: active\ncovers:\n  entries: [POST /admin/pay]\n  requirements: [REQ-1]\n---\n')
  const { code, stdout } = run(['coverage', '--root', dir])
  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /which no longer exists/)
  assert.match(stdout, /^Orphan check skipped for entry points, requirements: a source did not run \(see Warnings\)\.$/m)
  assert.match(stdout, /^\| Requirements \| - \| - \| - \| - \| requirement sources did not run \|$/m)
})

test('output is no longer a command', () => {
  const result = run(['output', '--root', FIXTURE])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /^runbooks: unknown command "output"$/m)
  assert.doesNotMatch(result.stdout, /output/)
})

test('list warns about a mocked runbook without a script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks/billing'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbooks.config.json'), JSON.stringify({ version: 1, stack: 'frontend', upstream: { mode: 'live', urlEnv: 'API_URL' } }))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/billing/errors.md'), '---\nid: billing.errors\ncapability: billing\nstatus: active\nupstream: mocked\n---\n')
  const { code, stderr } = run(['list', '--root', dir])
  assert.equal(code, 0)
  assert.match(stderr, /warning: docs\/runbooks\/billing\/errors\.md: mocked runbook without a script/)
})

function upstreamProject(upstream, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-upstream-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'docs/runbooks/runbooks.config.json'),
    JSON.stringify({ version: 1, stack: 'frontend', upstream: upstream && { mode: 'mocked', urlEnv: 'API_URL', ...upstream }, ...extra }),
  )
  return dir
}

const configOf = (dir) => loadConfig(dir)

test('upstreamOptions resolves the config and the flags', () => {
  const dir = upstreamProject({ baseUrl: 'https://api.example.com/v1', port: 4321, redactHeaders: ['x-key'], redactBodyKeys: ['otp'] })
  const config = configOf(dir)
  assert.deepEqual(upstreamOptions(dir, config, {}), {
    fixturesRoot: path.join(dir, 'docs/runbooks/_fixtures'),
    target: 'https://api.example.com/v1',
    redactHeaders: ['x-key'],
    redactBodyKeys: ['otp'],
    port: 4321,
    mode: 'live',
    runbook: null,
    role: null,
    case: null,
    step: null,
  })
  const flags = upstreamOptions(dir, config, { port: '0', mode: 'record', runbook: 'billing.issue', role: 'editor', step: 'S02' })
  assert.deepEqual([flags.port, flags.mode, flags.runbook, flags.role, flags.step], [0, 'record', 'billing.issue', 'editor', 'S02'])
})

test('upstreamOptions rejects bad flags and a missing upstream block', () => {
  const dir = upstreamProject({})
  const config = configOf(dir)
  assert.throws(() => upstreamOptions(dir, config, { port: '70000' }), /--port/)
  assert.throws(() => upstreamOptions(dir, config, { port: 'abc' }), /--port/)
  assert.throws(() => upstreamOptions(dir, config, { mode: 'fake' }), /--mode/)
  assert.throws(() => upstreamOptions(dir, config, { role: 'Bad Role' }), /--role/)
  assert.throws(() => upstreamOptions(dir, config, { role: true }), /--role/)
  assert.equal(upstreamOptions(dir, config, { case: 'vip-team' }).case, 'vip-team')
  assert.throws(() => upstreamOptions(dir, config, { case: 'Bad!' }), /--case/)
  const none = upstreamProject(null)
  assert.throws(() => upstreamOptions(none, configOf(none), {}), /the config has no upstream block\. Run \/runbooks:setup/)
})

test('copiedServerWarning reports a missing copy and a version mismatch', () => {
  const dir = upstreamProject({ serverFile: 'tools/upstream-server.mjs' })
  const config = configOf(dir)
  assert.equal(
    copiedServerWarning(dir, config, VERSION),
    'upstream.serverFile tools/upstream-server.mjs is missing: run /runbooks:setup to copy it',
  )
  fs.mkdirSync(path.join(dir, 'tools'))
  fs.writeFileSync(path.join(dir, 'tools/upstream-server.mjs'), "export const VERSION = '0.9.0'\n")
  assert.equal(
    copiedServerWarning(dir, config, VERSION),
    `upstream.serverFile tools/upstream-server.mjs is from runbooks 0.9.0, the plugin is ${VERSION}: run /runbooks:setup to refresh it`,
  )
  fs.writeFileSync(path.join(dir, 'tools/upstream-server.mjs'), '// no version\n')
  assert.match(copiedServerWarning(dir, config, VERSION), /is from runbooks unknown,/)
  fs.writeFileSync(path.join(dir, 'tools/upstream-server.mjs'), `export const VERSION = '${VERSION}'\n`)
  assert.equal(copiedServerWarning(dir, config, VERSION), null)
  const unset = upstreamProject({})
  assert.equal(copiedServerWarning(unset, configOf(unset), VERSION), null)
  const none = upstreamProject(null)
  assert.equal(copiedServerWarning(none, configOf(none), VERSION), null)
})

test('copiedServerWarning skips a copy in a UI tests repository that is not cloned, see docs/adr/0007', () => {
  const tests = { ui: { framework: 'playwright', root: '../app-e2e', dir: 'tests' } }
  const dir = upstreamProject({ serverFile: '../app-e2e/tests/runbooks-upstream.mjs' }, { tests })
  assert.equal(copiedServerWarning(dir, configOf(dir), VERSION), null)
  fs.mkdirSync(path.resolve(dir, '../app-e2e'), { recursive: true })
  try {
    assert.equal(
      copiedServerWarning(dir, configOf(dir), VERSION),
      'upstream.serverFile ../app-e2e/tests/runbooks-upstream.mjs is missing: run /runbooks:setup to copy it',
    )
  } finally {
    fs.rmSync(path.resolve(dir, '../app-e2e'), { recursive: true })
  }
})

test('copiedServerProblem is strict about an unset file and a UI tests repository not cloned', () => {
  const unset = upstreamProject({})
  assert.equal(copiedServerProblem(unset, configOf(unset), VERSION), 'upstream.serverFile is not set: run /runbooks:setup to copy the server')
  const none = upstreamProject(null)
  assert.equal(copiedServerProblem(none, configOf(none), VERSION), 'the config has no upstream block. Run /runbooks:setup')
  const tests = { ui: { framework: 'playwright', root: '../app-e2e', dir: 'tests' } }
  const far = upstreamProject({ serverFile: '../app-e2e/tests/runbooks-upstream.mjs' }, { tests })
  assert.equal(
    copiedServerProblem(far, configOf(far), VERSION),
    'upstream.serverFile ../app-e2e/tests/runbooks-upstream.mjs is in ../app-e2e, which is not cloned: clone it there or run /runbooks:setup',
  )
})

const pick = ({ code, stdout }) => [code, stdout]

test('upstream-copy prints the file when it is current and the problem otherwise', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  assert.deepEqual(pick(run(['upstream-copy', '--root', dir])), [1, 'upstream.serverFile tests/runbooks-upstream.mjs is missing: run /runbooks:setup to copy it\n'])
  fs.mkdirSync(path.join(dir, 'tests'))
  fs.writeFileSync(path.join(dir, 'tests/runbooks-upstream.mjs'), "export const VERSION = '0.9.0'\n")
  assert.equal(run(['upstream-copy', '--root', dir]).code, 1)
  fs.writeFileSync(path.join(dir, 'tests/runbooks-upstream.mjs'), `export const VERSION = '${VERSION}'\n`)
  assert.deepEqual(pick(run(['upstream-copy', '--root', dir])), [0, 'tests/runbooks-upstream.mjs\n'])
})

test('ui-copy reports a missing copy, writes it with --write, then prints its path', () => {
  const dir = upstreamProject(null)
  assert.deepEqual(pick(run(['ui-copy', '--root', dir])), [1, 'runbooks UI copy docs/runbooks/runbooks-ui.mjs is missing: run /runbooks:setup to write it\n'])
  assert.deepEqual(pick(run(['ui-copy', '--root', dir, '--write'])), [0, 'added: docs/runbooks/runbooks-ui.mjs\n'])
  assert.deepEqual(pick(run(['ui-copy', '--root', dir])), [0, 'docs/runbooks/runbooks-ui.mjs\n'])
  assert.deepEqual(pick(run(['ui-copy', '--root', dir, '--write'])), [0, 'unchanged: docs/runbooks/runbooks-ui.mjs\n'])
})

test('ui-copy names the version of a stale copy, and --write replaces it', () => {
  const dir = upstreamProject(null)
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbooks-ui.mjs'), "export const VERSION = '0.9.0'\n")
  assert.deepEqual(pick(run(['ui-copy', '--root', dir])), [
    1,
    `runbooks UI copy docs/runbooks/runbooks-ui.mjs is from runbooks 0.9.0, the plugin is ${VERSION}: run /runbooks:setup to refresh it\n`,
  ])
  assert.deepEqual(pick(run(['ui-copy', '--root', dir, '--write'])), [0, 'replaced: docs/runbooks/runbooks-ui.mjs\n'])
  assert.equal(run(['ui-copy', '--root', dir]).code, 0)
})

test('ui-copy follows paths.runbooks', () => {
  const dir = upstreamProject(null, { paths: { runbooks: 'qa\\runbooks' } })
  assert.equal(run(['ui-copy', '--root', dir, '--write']).stdout, 'added: qa/runbooks/runbooks-ui.mjs\n')
  assert.ok(fs.existsSync(path.join(dir, 'qa/runbooks/runbooks-ui.mjs')))
})

test('packageScript adds, keeps and replaces the runbooks:upstream script', () => {
  const dir = upstreamProject({ serverFile: 'tests\\e2e\\runbooks-upstream.mjs' })
  const config = configOf(dir)
  assert.equal(packageScript(dir, config).status, 'no-package')
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, '{\n    "name": "app",\n    "scripts": {\n        "dev": "next dev"\n    }\n}')
  assert.deepEqual(packageScript(dir, config), { status: 'missing', value: 'node tests/e2e/runbooks-upstream.mjs', current: null })
  assert.equal(packageScript(dir, config, { write: true }).status, 'added')
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '{\n    "name": "app",\n    "scripts": {\n        "dev": "next dev",\n        "runbooks:upstream": "node tests/e2e/runbooks-upstream.mjs"\n    }\n}',
  )
  assert.equal(packageScript(dir, config).status, 'unchanged')
})

test('packageScript reports and replaces a different script, and adds scripts when absent', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, '{\n\t"scripts": { "runbooks:upstream": "node old.mjs" }\n}\n')
  assert.deepEqual(packageScript(dir, configOf(dir)), { status: 'differs', value: 'node tests/runbooks-upstream.mjs', current: 'node old.mjs' })
  assert.equal(packageScript(dir, configOf(dir), { write: true }).status, 'replaced')
  assert.match(fs.readFileSync(file, 'utf8'), /^\{\n\t"scripts": \{\n\t\t"runbooks:upstream": "node tests\/runbooks-upstream\.mjs"\n\t\}\n\}\n$/)
  fs.writeFileSync(file, '{ "name": "app" }\n')
  packageScript(dir, configOf(dir), { write: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).scripts, { 'runbooks:upstream': 'node tests/runbooks-upstream.mjs' })
})

test('packageScript keeps CRLF line endings', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, '{\r\n  "name": "app"\r\n}\r\n')
  packageScript(dir, configOf(dir), { write: true })
  assert.equal(fs.readFileSync(file, 'utf8'), '{\r\n  "name": "app",\r\n  "scripts": {\r\n    "runbooks:upstream": "node tests/runbooks-upstream.mjs"\r\n  }\r\n}\r\n')
})

test('upstream-copy reads and prints a serverFile written with backslashes as a forward-slash path', () => {
  const dir = upstreamProject({ serverFile: 'tests\\runbooks-upstream.mjs' })
  fs.mkdirSync(path.join(dir, 'tests'))
  fs.writeFileSync(path.join(dir, 'tests/runbooks-upstream.mjs'), `export const VERSION = '${VERSION}'\n`)
  const { code, stdout } = run(['upstream-copy', '--root', dir])
  assert.deepEqual([code, stdout], [0, 'tests/runbooks-upstream.mjs\n'])
})

test('packageScript needs upstream.serverFile', () => {
  const dir = upstreamProject({})
  assert.throws(() => packageScript(dir, configOf(dir)), /^Error: upstream\.serverFile is not set: run \/runbooks:setup to copy the server first$/)
})

test('package-script prints one line', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  assert.equal(run(['package-script', '--root', dir]).stdout, 'no package.json: start the server with node tests/runbooks-upstream.mjs\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n')
  assert.equal(run(['package-script', '--root', dir, '--write']).stdout, 'added: "runbooks:upstream": "node tests/runbooks-upstream.mjs"\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "runbooks:upstream": "node old.mjs" } }\n')
  assert.equal(run(['package-script', '--root', dir]).stdout, 'differs: "runbooks:upstream" is "node old.mjs", expected "node tests/runbooks-upstream.mjs"\n')
})

test('list and coverage warn about the copied server', () => {
  const dir = upstreamProject({ serverFile: 'tools/upstream-server.mjs' })
  for (const command of ['list', 'coverage']) {
    assert.match(run([command, '--root', dir]).stderr, /^warning: upstream\.serverFile tools\/upstream-server\.mjs is missing/m)
  }
})

// Starts a script, resolves with its first stdout line, and kills the child.
function firstLine(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.includes('\n')) {
        child.kill('SIGTERM')
        resolve(out.split('\n')[0])
      }
    })
    child.on('error', reject)
    child.on('exit', () => { if (!out.includes('\n')) reject(new Error(`exited early: ${out}`)) })
  })
}

test('runbooks.mjs upstream prints the listening line with the bound port', async () => {
  const dir = upstreamProject({})
  const line = await firstLine([SCRIPT, 'upstream', '--root', dir, '--port', '0'])
  assert.match(line, /^runbooks-upstream listening on http:\/\/127\.0\.0\.1:\d+$/)
  assert.doesNotMatch(line, /:0$/)
})

test('runbooks.mjs upstream exits 2 naming the port when it is in use', async () => {
  const holder = net.createServer()
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve))
  const { port } = holder.address()
  try {
    const dir = upstreamProject({})
    const result = spawnSync(process.execPath, [SCRIPT, 'upstream', '--root', dir, '--port', String(port)], { encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.equal(result.stderr, `runbooks: port ${port} is in use; stop what holds it or change upstream.port\n`)
    assert.doesNotMatch(result.stderr, /\n\s+at /)
  } finally {
    holder.close()
  }
})

test('runbooks.mjs ui exits 2 naming the port when it is in use', async () => {
  const holder = net.createServer()
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve))
  const { port } = holder.address()
  try {
    const dir = upstreamProject({})
    const result = spawnSync(process.execPath, [SCRIPT, 'ui', '--port', String(port), '--root', dir], { encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /port \d+ is in use/)
    assert.doesNotMatch(result.stderr, /\n\s+at /)
  } finally {
    holder.close()
  }
})

test('runbooks.mjs ui exits 2 when the root has no config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-noconfig-'))
  const result = spawnSync(process.execPath, [SCRIPT, 'ui', '--port', '0', '--root', dir], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^runbooks: /)
  assert.equal(result.stdout, '')
})

test('runbooks.mjs ui exits 2 on a bad --port', () => {
  const dir = upstreamProject({})
  const result = spawnSync(process.execPath, [SCRIPT, 'ui', '--port', '70000', '--root', dir], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--port/)
})

test('runbooks.mjs upstream exits 2 without an upstream block or with a bad flag', () => {
  const none = upstreamProject(null)
  const result = spawnSync(process.execPath, [SCRIPT, 'upstream', '--root', none], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^runbooks: the config has no upstream block\. Run \/runbooks:setup$/m)
  const dir = upstreamProject({})
  const bad = spawnSync(process.execPath, [SCRIPT, 'upstream', '--root', dir, '--mode', 'fake'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /--mode/)
})

const SERVER = fileURLToPath(new URL('./upstream-server.mjs', import.meta.url))

test('the copied server file starts from its own flags', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-copy-'))
  const line = await firstLine([SERVER, '--fixtures', 'fx', '--port', '0', '--redact', 'a,b', '--mode', 'mocked'], dir)
  assert.match(line, /^runbooks-upstream listening on http:\/\/127\.0\.0\.1:\d+$/)
})

test('the copied server file exits 2 when the port is in use', async () => {
  const holder = net.createServer()
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve))
  const { port } = holder.address()
  try {
    const result = spawnSync(process.execPath, [SERVER, '--fixtures', 'fx', '--port', String(port)], { encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.equal(result.stderr, `runbooks: port ${port} is in use; stop what holds it or change upstream.port\n`)
  } finally {
    holder.close()
  }
})

// Spawns the upstream CLI, waits for the listening line, and resolves with the child and its port.
function startUpstream(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args)
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
      if (match) resolve({ child, port: Number(match[1]) })
    })
    child.on('error', reject)
    child.on('exit', () => reject(new Error(`exited early: ${out}`)))
  })
}

// Sends the signal and resolves with the exit code, failing after 5 seconds so a regression cannot hang the suite.
function exitOnSignal(child, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`still running 5s after ${signal}`)) }, 5000)
    child.on('exit', (code) => { clearTimeout(timer); resolve(code) })
    child.kill(signal)
  })
}

test('runbooks.mjs upstream exits 0 on SIGINT and SIGTERM', async () => {
  const dir = upstreamProject({})
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const { child } = await startUpstream([SCRIPT, 'upstream', '--root', dir, '--port', '0'])
    assert.equal(await exitOnSignal(child, signal), 0)
  }
})

test('runbooks.mjs upstream exits 0 on SIGINT with an open connection', async () => {
  const dir = upstreamProject({})
  const { child, port } = await startUpstream([SCRIPT, 'upstream', '--root', dir, '--port', '0'])
  const client = net.connect(port, '127.0.0.1')
  client.on('error', () => {})
  await new Promise((resolve) => client.once('connect', resolve))
  client.write('GET /__runbooks/state HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')
  await new Promise((resolve) => client.once('data', resolve))
  assert.equal(await exitOnSignal(child, 'SIGINT'), 0)
  client.destroy()
})

test('runbooks.mjs upstream exits 0 on SIGINT with a tunneled upgrade socket open', async () => {
  const sockets = []
  const api = net.createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    socket.once('data', () => socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'))
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  const dir = upstreamProject({ mode: 'live', baseUrl: `http://127.0.0.1:${api.address().port}` })
  try {
    const { child, port } = await startUpstream([SCRIPT, 'upstream', '--root', dir, '--port', '0'])
    const client = net.connect(port, '127.0.0.1')
    client.on('error', () => {})
    await new Promise((resolve) => client.once('connect', resolve))
    client.write('GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    await new Promise((resolve) => client.once('data', resolve))
    assert.equal(await exitOnSignal(child, 'SIGINT'), 0)
    client.destroy()
  } finally {
    sockets.forEach((socket) => socket.destroy())
    api.close()
  }
})

// docs/adr/0005: in CI a front is checked out alone, and nothing it runs may need the API's repository.
test('a front checked out alone, with no sibling folder, runs coverage, list --affected, fixtures, contract and the upstream server', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ci-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const root = path.join(tmp, 'front')
  fs.cpSync(fileURLToPath(new URL('./__fixtures__/front', import.meta.url)), root, { recursive: true })
  assert.deepEqual(fs.readdirSync(tmp), ['front'])
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-qm', 'init')

  const config = loadConfig(root)
  assert.deepEqual(config.warnings, [])
  const coverage = run(['coverage', '--root', root, '--json'])
  assert.deepEqual([coverage.code, coverage.stderr], [0, ''])
  const result = JSON.parse(coverage.stdout)
  assert.deepEqual([result.orphanChecksSkipped, result.orphans, result.invalid], [[], [], []])
  assert.deepEqual([result.entries.covered, result.entries.total], [2, 3])

  git('switch', '-q', '-c', 'feature')
  fs.appendFileSync(path.join(root, 'src/app/quotes/page.tsx'), '// changed\n')
  const affected = run(['list', '--affected', 'main', '--root', root, '--json'])
  assert.deepEqual([affected.code, affected.stderr], [0, ''])
  assert.deepEqual(JSON.parse(affected.stdout).map((rb) => [rb.id, rb.reasons]), [
    ['quotes.list-quotes', ['/quotes (src/app/quotes/page.tsx)', 'slice quotes: 1 file(s)']],
    ['quotes.rate-table', ['slice quotes: 1 file(s)']],
  ])

  const fixtures = JSON.parse(run(['fixtures', 'quotes.list-quotes', '--root', root, '--json']).stdout)
  assert.deepEqual([fixtures.fixtures.length, fixtures.problems], [2, []])
  const contract = run(['contract', '--strict', '--root', root])
  assert.deepEqual([contract.code, contract.stderr], [0, ''])

  const { port, ...options } = upstreamOptions(root, config, {})
  assert.equal(port, 4010)
  const server = createUpstreamServer(options)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  await fetch(`${base}/__runbooks/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runbook: 'quotes.list-quotes', mode: 'mocked' }) })
  const res = await fetch(`${base}/quotes`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), [{ id: 'q1', total: 120 }])
})

test('junit maps a roles runbook per role', () => {
  const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  const names = ['admin', 'editor', 'manager'].flatMap((role) => [`S01 creates as ${role}`, `S02 reads back as ${role}`])
  names.push('S01 creates as viewer', 'S01 creates as anonymous')
  fs.writeFileSync(path.join(dir, 'junit.xml'), `<testsuite>${names.map((name) => `<testcase name="${name}"/>`).join('')}</testsuite>`)
  const out = run(['junit', 'billing.create-invoice', '--root', ROLES, '--file', path.join(dir, 'junit.xml'), '--json'])
  assert.equal(out.code, 0, out.stderr)
  const parsed = JSON.parse(out.stdout)
  assert.ok(parsed.steps.every((row) => typeof row.role === 'string'))
  assert.deepEqual(parsed.steps.filter((r) => r.role === 'viewer').map((r) => r.state), ['passed', 'not-applicable'])
  assert.deepEqual(parsed.extra, [])
  assert.equal(parsed.result, 'passed')
})

test('roles lists the roles, shows one, and needs tracking on', () => {
  const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
  const list = run(['roles', '--root', ROLES, '--json'])
  assert.equal(list.code, 0, list.stderr)
  assert.equal(JSON.parse(list.stdout).length, 5)
  assert.match(run(['roles', '--root', ROLES]).stdout, /\| manager \|/)
  const detail = JSON.parse(run(['roles', 'manager', '--root', ROLES, '--json']).stdout)
  assert.equal(detail.name, 'manager')
  assert.match(run(['roles', 'manager', '--root', ROLES]).stdout, /billing\.cancel-invoice/)
  const affected = JSON.parse(run(['roles', '--affected', '--role', 'editor', '--key', 'billing/invoices', '--json', '--root', ROLES]).stdout)
  assert.equal(affected.length, 3)
  assert.match(run(['roles', '--affected', '--role', 'editor', '--root', ROLES]).stderr, /--key/)
  assert.match(run(['roles', '--affected', '--key', 'a/b', '--root', ROLES]).stderr, /--role/)
  const citing = JSON.parse(run(['roles', '--citing', 'editor', '--json', '--root', ROLES]).stdout)
  assert.deepEqual(citing.heirs, ['admin', 'manager'])
  const unknown = run(['roles', 'x', '--root', ROLES])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /no role "x"/)
  for (const args of [['constructor'], ['--citing', 'hasOwnProperty'], ['--affected', '--role', 'toString', '--key', 'billing/*']]) {
    const inherited = run(['roles', ...args, '--root', ROLES])
    assert.equal(inherited.code, 2, args.join(' '))
    assert.match(inherited.stderr, new RegExp(`no role "${args.at(-1) === 'billing/*' ? 'toString' : args.at(-1)}"`))
  }
  const off = run(['roles', '--root', FIXTURE])
  assert.equal(off.code, 2)
  assert.match(off.stderr, /role tracking is off; \/runbooks:settings roles turns it on/)
})

test('list filters by role and review, and coverage reports roles', () => {
  const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
  const ids = (args) => JSON.parse(run(['list', ...args, '--json', '--root', ROLES]).stdout).map((rb) => rb.id).sort()
  assert.deepEqual(ids(['--role', 'viewer']), ['billing.cancel-invoice', 'billing.create-invoice'])
  assert.deepEqual(ids(['--review']), ['billing.cancel-invoice'])
  assert.match(run(['list', '--root', ROLES]).stdout, /review/)
  const cov = run(['coverage', '--role', 'viewer', '--json', '--root', ROLES])
  assert.equal(cov.code, 0, cov.stderr)
  assert.deepEqual(JSON.parse(cov.stdout).roles.map((r) => r.role), ['viewer'])
  assert.match(run(['coverage', '--root', ROLES]).stdout, /### Roles/)
  const unknown = run(['coverage', '--role', 'nobody', '--root', ROLES])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /no role "nobody"/)
  const off = run(['coverage', '--role', 'viewer', '--root', FIXTURE])
  assert.equal(off.code, 2)
  assert.match(off.stderr, /role tracking is off; \/runbooks:settings roles turns it on/)
  assert.equal(JSON.parse(run(['coverage', '--json', '--root', FIXTURE]).stdout).roles, undefined)
  assert.equal(run(['list', '--role', 'admin', '--root', FIXTURE]).code, 0)
})

const CONTEXTS = fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url))
function copyContexts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-contexts-'))
  fs.cpSync(CONTEXTS, dir, { recursive: true })
  return dir
}

test('mark-review takes case-created and contexts lists the affected runbooks', () => {
  const dir = copyContexts()
  const dry = JSON.parse(run(['mark-review', 'clients.edit-client', '--reason', 'case-created', '--case', 'regular', '--date', '2026-10-22', '--json', '--root', dir]).stdout)
  assert.deepEqual(dry.runbooks[0].review.at(-1), { reason: 'case-created', case: 'regular', date: '2026-10-22' })
  assert.match(run(['mark-review', 'clients.edit-client', '--reason', 'context-created', '--root', dir]).stderr, /--reason context-created needs --context/)
  assert.deepEqual(JSON.parse(run(['contexts', '--affected', 'client-access', '--json', '--root', dir]).stdout), ['clients.edit-client', 'clients.list-clients'])
  assert.deepEqual(JSON.parse(run(['contexts', '--affected', 'client-access', '--key', 'clients/list', '--json', '--root', dir]).stdout), ['clients.list-clients'])
  assert.equal(JSON.parse(run(['contexts', '--json', '--root', dir]).stdout)[0].runbooks, 2)
  assert.match(run(['contexts', '--affected', 'gold', '--root', dir]).stderr, /no context "gold"/)
  assert.match(run(['contexts', '--root', dir]).stdout, /client-access/)
  assert.match(run(['contexts', 'toString', '--root', dir]).stderr, /no context "toString"/)
})

test('two case-created marks for different cases both stay, and roles --affected takes --case', () => {
  const dir = copyContexts()
  for (const kase of ['regular', 'vip-team']) run(['mark-review', 'clients.edit-client', '--reason', 'case-created', '--case', kase, '--date', '2026-10-22', '--write', '--root', dir])
  const text = fs.readFileSync(path.join(dir, 'docs/runbooks/clients/edit-client.md'), 'utf8')
  assert.match(text, /case: regular/)
  assert.match(text, /case: vip-team/)
  const all = JSON.parse(run(['roles', '--affected', '--role', 'viewer', '--key', 'clients/list', '--json', '--root', dir]).stdout)
  assert.ok(all.length > 0)
  const regular = JSON.parse(run(['roles', '--affected', '--role', 'viewer', '--key', 'clients/list', '--case', 'regular', '--json', '--root', dir]).stdout)
  assert.deepEqual(regular, [{ role: 'viewer', runbooks: ['clients.list-clients'] }])
  for (const kase of ['nope', 'constructor']) {
    const unknown = run(['roles', '--affected', '--role', 'viewer', '--key', 'clients/list', '--case', kase, '--json', '--root', dir])
    assert.deepEqual([unknown.code, unknown.stdout], [2, ''])
    assert.match(unknown.stderr, new RegExp(`no case "${kase}"`))
  }
  assert.match(run(['roles', '--affected', '--role', 'viewer', '--key', 'clients/list', '--case', '--root', dir]).stderr, /--case needs a case name/)
  assert.match(run(['roles', '--affected', '--role', 'editor', '--key', 'billing/invoices', '--case', 'regular', '--root', fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))]).stderr, /no case "regular"/)
})

test('roles prints the Case keys column and one row per case for a context', () => {
  const list = run(['roles', '--root', CONTEXTS])
  assert.match(list.stdout, /\| Case keys \|/)
  const detail = run(['roles', 'manager', '--root', CONTEXTS]).stdout
  assert.match(detail, /\| Key \| Case \| Actions \| Source \| From \|/)
  assert.match(detail, /\| clients\/\* \| vip-outside \|/)
  assert.doesNotMatch(run(['roles', '--root', fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))]).stdout, /Case keys/)
})

test('model and models commands', () => {
  assert.equal(run(['model', '--root', FIXTURE, 'run', 'billing.issue-invoice', '--mode', 'test']).stdout, 'haiku\n')
  assert.deepEqual(JSON.parse(run(['model', '--root', FIXTURE, 'help', 'who?', '--json']).stdout), { model: 'sonnet', row: 'help <question>', forced: false })
  assert.equal(run(['model', '--root', FIXTURE, 'run', '--help']).stdout, 'sonnet\n')
  const bad = run(['model', '--root', FIXTURE, 'run', '--model', 'gpt'])
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /--model must be one of/)
  assert.deepEqual(JSON.parse(run(['models', '--defaults', '--json', '--root', '/nonexistent']).stdout), DEFAULT_MODELS)
  const diff = JSON.parse(run(['models', '--diff', '--json', '--root', FIXTURE]).stdout)
  assert.deepEqual(diff.differing, [])
  assert.equal(diff.missing.length, Object.keys(DEFAULT_MODELS).length)
  assert.match(run(['models', '--root', FIXTURE]).stdout, /^\| run --mode test \| haiku \| haiku \|$/m)
  assert.match(run(['models', '--diff', '--root', FIXTURE]).stdout, /^Missing rows: \d+\n\nNo row differs from the default\.\n$/)
})

const FULL_REPORT = '2026-10-10-0900-billing.issue-invoice.md'
const PARTIAL_REPORT = '2026-10-12-0900-billing.issue-invoice.md'

function reportText({ runbook = 'billing.issue-invoice', date, partial, rows }) {
  return `---
runbook: ${runbook}
run: ${date.replace(/[ :]/g, '-')}
date: ${date}
commit: "def5678"
branch: main
mode: test
executor: the project's test command
partial: ${partial}
upstream: live
roles: []
cases: []
viewports: []
result: passed
---

# Run

| Step | State | Seen | Evidence |
|---|---|---|---|
${rows.map(([step, state]) => `| ${step} | ${state} | seen | \`e.png\` |`).join('\n')}
`
}

// A copy of the fixture project whose issue-invoice runbook has two steps, with a full and a partial report in _runs.
function lastRunProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-cli-'))
  fs.cpSync(FIXTURE, dir, { recursive: true })
  const file = path.join(dir, 'docs/runbooks/billing/issue-invoice.md')
  fs.appendFileSync(file, '\n### S01. Open the form\n\nExpected: it opens.\n\n### S02. Send the form\n\nExpected: it sends.\n')
  const runs = path.join(dir, 'docs/runbooks/_runs')
  fs.writeFileSync(path.join(runs, FULL_REPORT), reportText({ date: '2026-10-10 09:00', partial: false, rows: [['S01', 'passed'], ['S02', 'failed']] }))
  fs.writeFileSync(path.join(runs, PARTIAL_REPORT), reportText({ date: '2026-10-12 09:00', partial: true, rows: [['S02', 'passed']] }))
  return { dir, file }
}

test('last-run writes a full run, then merges a partial one', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const full = run(['last-run', 'billing.issue-invoice', '--report', FULL_REPORT, '--write', '--root', dir])
  assert.equal(full.code, 0, full.stderr)
  assert.match(fs.readFileSync(file, 'utf8'), /^  cells:\n    S01: passed r1\n    S02: failed r1$/m)
  assert.match(fs.readFileSync(file, 'utf8'), /^  result: failed$/m)
  const merged = run(['last-run', '--report', `_runs/${PARTIAL_REPORT}`, '--merge', 'billing.issue-invoice', '--write', '--json', '--root', dir])
  assert.equal(merged.code, 0, merged.stderr)
  const parsed = JSON.parse(merged.stdout)
  assert.equal(parsed.lastRun.result, 'passed')
  assert.equal(parsed.lastRun.mixed, true)
  assert.deepEqual(parsed.changed.map((c) => [c.step, c.from, c.to]), [['S02', 'failed', 'passed']])
  assert.deepEqual(parsed.pending, [])
  assert.deepEqual(parsed.status, { from: 'active', to: 'active' })
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^  mixed: true$/m)
  assert.match(text, /^  result: passed$/m)
  assert.match(text, /^    S01: passed r1$/m)
  assert.match(text, /^    S02: passed r2$/m)
})

test('last-run is a dry run without --write', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const before = fs.readFileSync(file, 'utf8')
  const out = run(['last-run', 'billing.issue-invoice', '--report', FULL_REPORT, '--root', dir])
  assert.equal(out.code, 0, out.stderr)
  assert.match(out.stdout, /Dry run: nothing written\. Add --write to apply\./)
  assert.match(out.stdout, /^\| S02 \|.*\| failed \| 2026-10-10 \|$/m)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('last-run refuses a partial report without --merge', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const before = fs.readFileSync(file, 'utf8')
  const out = run(['last-run', 'billing.issue-invoice', '--report', PARTIAL_REPORT, '--write', '--root', dir])
  assert.equal(out.code, 2)
  assert.match(out.stderr, /--merge/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('last-run refuses a report of another runbook and names the other errors', (t) => {
  const { dir } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const other = '2026-10-11-0900-billing.cancel-invoice.md'
  fs.writeFileSync(path.join(dir, 'docs/runbooks/_runs', other), reportText({ runbook: 'billing.cancel-invoice', date: '2026-10-11 09:00', partial: false, rows: [['S01', 'passed']] }))
  const wrong = run(['last-run', 'billing.issue-invoice', '--report', other, '--root', dir])
  assert.equal(wrong.code, 2)
  assert.match(wrong.stderr, /report 2026-10-11-0900-billing\.cancel-invoice\.md belongs to billing\.cancel-invoice/)
  assert.match(run(['last-run', 'billing.issue-invoice', '--report', '2026-01-01-0000-billing.issue-invoice.md', '--root', dir]).stderr, /no report "2026-01-01-0000-billing\.issue-invoice\.md" in _runs/)
  assert.match(run(['last-run', 'nope.nope', '--report', FULL_REPORT, '--root', dir]).stderr, /no runbook with id "nope\.nope"/)
  assert.match(run(['last-run', 'billing.issue-invoice', '--root', dir]).stderr, /last-run needs a runbook id and --report <name>/)
})

test('mark-outdated marks every cell and skips a runbook with no last_run', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.equal(run(['last-run', 'billing.issue-invoice', '--report', FULL_REPORT, '--write', '--root', dir]).code, 0)
  const ids = ['billing.issue-invoice', 'billing.cancel-invoice']
  const before = fs.readFileSync(file, 'utf8')
  const dry = run(['mark-outdated', ...ids, '--json', '--root', dir])
  assert.equal(dry.code, 0, dry.stderr)
  assert.deepEqual(JSON.parse(dry.stdout), {
    runbooks: [{ id: 'billing.issue-invoice', path: 'docs/runbooks/billing/issue-invoice.md' }],
    skipped: [{ id: 'billing.cancel-invoice', reason: 'no last_run' }],
    written: []
  })
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  const out = run(['mark-outdated', ...ids, '--write', '--root', dir])
  assert.equal(out.code, 0, out.stderr)
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^  outdated: true$/m)
  assert.match(text, /^    S01: passed r1 outdated$/m)
  assert.match(text, /^    S02: failed r1 outdated$/m)
  assert.equal(run(['mark-outdated', '--root', dir]).code, 2)
})

test('mark-outdated keeps the one-line shape of an old last_run, so check lists no pending cell', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const before = fs.readFileSync(file, 'utf8')
  const out = run(['mark-outdated', 'billing.issue-invoice', '--write', '--root', dir])
  assert.equal(out.code, 0, out.stderr)
  const text = fs.readFileSync(file, 'utf8')
  const line = 'last_run: { date: 2026-10-01, commit: "abc1234", result: passed, report: _runs/2026-10-01-0900-billing.issue-invoice.md, outdated: true }'
  assert.equal(text, before.replace(/^last_run: .*$/m, line))
  const check = run(['check', 'billing.issue-invoice', '--json', '--root', dir])
  assert.equal(check.code, 0, check.stderr)
  const parsed = JSON.parse(check.stdout)
  assert.deepEqual(parsed.pending, [])
  assert.equal(parsed.lastRun.legacy, true)
  assert.equal(parsed.lastRun.outdated, true)
})

test('last-run and mark-outdated refuse a runbook whose last_run has problems and write nothing', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const block = `last_run:\n  runs:\n    r1: { date: 2026-10-10, commit: "abc1234", report: _runs/${FULL_REPORT} }\n  cells:\n    S01: passed r1\n    S02: nope r1`
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^last_run:.*$/m, block))
  const before = fs.readFileSync(file, 'utf8')
  const lastRun = run(['last-run', 'billing.issue-invoice', '--report', FULL_REPORT, '--write', '--root', dir])
  assert.equal(lastRun.code, 2)
  assert.match(lastRun.stderr, /billing\.issue-invoice: last_run\.cells\.S02: state "nope" is not a step state\. Fix last_run by hand first\. Nothing was written/)
  const marked = run(['mark-outdated', 'billing.issue-invoice', '--write', '--root', dir])
  assert.equal(marked.code, 2)
  assert.match(marked.stderr, /billing\.issue-invoice: last_run\.cells\.S02: state "nope" is not a step state/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  fs.writeFileSync(file, before.replace(/^last_run:\n(?: {2}.*\n)+/m, 'last_run: [a, b]\n'))
  const notMap = run(['mark-outdated', 'billing.issue-invoice', '--write', '--root', dir])
  assert.equal(notMap.code, 2)
  assert.match(notMap.stderr, /billing\.issue-invoice: last_run must be a map/)
})

test('rename-role-cells renames only last_run cells', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configFile = path.join(dir, 'docs/runbooks/runbooks.config.json')
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  raw.roles = { enabled: true }
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/roles.json'), JSON.stringify({ version: 1, roles: { admin: {}, partner: {} } }))
  const block = `last_run:\n  runs:\n    r1: { date: 2026-10-10, commit: "abc1234", report: _runs/${FULL_REPORT} }\n  cells:\n    S01: { admin: passed r1, partner: passed r1 }\n    S02: { admin: failed r1 }`
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^last_run:.*$/m, block))
  const before = fs.readFileSync(file, 'utf8')
  const dry = run(['rename-role-cells', 'admin', 'owner', '--json', '--root', dir])
  assert.equal(dry.code, 0, dry.stderr)
  assert.deepEqual(JSON.parse(dry.stdout), { runbooks: [{ id: 'billing.issue-invoice', path: 'docs/runbooks/billing/issue-invoice.md' }], written: [] })
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  const out = run(['rename-role-cells', 'admin', 'owner', '--root', dir, '--write'])
  assert.equal(out.code, 0, out.stderr)
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^ {4}S01: \{ owner: passed r1, partner: passed r1 \}$/m)
  assert.match(text, /^ {4}S02: \{ owner: failed r1 \}$/m)
  assert.match(text, /^roles: \[admin\]$/m)
  const strip = (s) => s.replace(/^last_run:\n(?: {2}.*\n)+/m, '')
  assert.equal(strip(text), strip(before))
  assert.equal(run(['rename-role-cells', 'admin', '--root', dir]).code, 2)
})

test('rename-role-cells refuses same, non-kebab and existing target names and writes nothing', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configFile = path.join(dir, 'docs/runbooks/runbooks.config.json')
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  raw.roles = { enabled: true }
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/roles.json'), JSON.stringify({ version: 1, roles: { admin: {}, partner: {} } }))
  const block = `last_run:\n  runs:\n    r1: { date: 2026-10-10, commit: "abc1234", report: _runs/${FULL_REPORT} }\n  cells:\n    S01: { admin: passed r1, partner: passed r1 }`
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^last_run:.*$/m, block))
  const before = fs.readFileSync(file, 'utf8')
  const same = run(['rename-role-cells', 'admin', 'admin', '--write', '--root', dir])
  assert.equal(same.code, 2)
  const bad = run(['rename-role-cells', 'admin', 'Owner', '--root', dir, '--write'])
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /must be kebab-case/)
  const clash = run(['rename-role-cells', 'admin', 'partner', '--root', dir, '--write'])
  assert.equal(clash.code, 2)
  assert.match(clash.stderr, /docs\/runbooks\/billing\/issue-invoice\.md: last_run already has cells for role "partner"\. Nothing was written/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('rename-role-cells refuses a runbook whose last_run has problems and writes nothing', (t) => {
  const { dir, file } = lastRunProject()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configFile = path.join(dir, 'docs/runbooks/runbooks.config.json')
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  raw.roles = { enabled: true }
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2))
  fs.writeFileSync(path.join(dir, 'docs/runbooks/roles.json'), JSON.stringify({ version: 1, roles: { admin: {}, partner: {} } }))
  const block = `last_run:\n  runs:\n    r1: { date: 2026-10-10, commit: "abc1234", report: _runs/${FULL_REPORT} }\n  cells:\n    S01: { admin: passed r1 }\n    S02: { admin: nope r1 }`
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^last_run:.*$/m, block))
  const before = fs.readFileSync(file, 'utf8')
  const out = run(['rename-role-cells', 'admin', 'owner', '--root', dir, '--write'])
  assert.equal(out.code, 2)
  assert.match(out.stderr, /billing\.issue-invoice: last_run\.cells\.S02: state "nope" is not a step state\. Fix last_run by hand first\. Nothing was written/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

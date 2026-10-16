import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './runbook.mjs'
import { parseArgs } from './lib/args.mjs'
import { pct } from './lib/format.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const SCRIPT = fileURLToPath(new URL('./runbook.mjs', import.meta.url))

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
  assert.match(stdout, /^\| Entry points \| 3 \| 2 \| 9 \| 33\.3% \|$/m)
  assert.match(stdout, /^\| Requirements \| 1 \| 1 \| 3 \| 33\.3% \|$/m)
  assert.match(stdout, /^Active runbooks: 2\. Draft runbooks: 1\. Active runbooks with a to-script spec: 1\.$/m)
  assert.match(stdout, /^\| billing \| 2 \| 2 \| 5 \| 40% \|$/m)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-cli-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs/runbooks/runbook.config.json'), '{ "version": 1 }')
  assert.match(run(['coverage', '--root', dir]).stdout, /^\| Requirements \| - \| - \| - \| no requirement source configured \|$/m)
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
  const missing = run(['list', '--root', path.join(os.tmpdir(), 'runbook-no-such-project')])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /^runbook: docs\/runbooks\/runbook\.config\.json not found/m)
  const unknown = run(['bogus'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /unknown command "bogus"/)
  assert.match(unknown.stdout, /^Usage: runbook\.mjs <command> \[options\]/)
})

test('help', () => {
  assert.match(run([]).stdout, /^Usage:/)
  assert.match(run(['--help']).stdout, /^Usage:/)
})

test('the file runs as a program', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'list', '--root', FIXTURE, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(JSON.parse(out).length, 5)
})

import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { run } from './runbooks.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRoles } from './lib/roles.mjs'
import { exportPermissions, parseCsv, planImport } from './lib/permissions-csv.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
const ROLES_FILE = 'docs/runbooks/roles.json'

// A copy of the roles fixture, so a write never touches the fixture.
function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-permissions-'))
  fs.cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

const HEADER = 'role,key,view,create,edit,delete,approve,origin'

function plan(dir, csv, options) {
  const config = loadConfig(dir)
  return planImport(dir, config, loadRoles(dir, config), csv, options)
}

const readRoles = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ROLES_FILE), 'utf8'))

test('exportPermissions writes one row per role and key with x marks and the origin', () => {
  const registry = loadRoles(FIXTURE, loadConfig(FIXTURE))
  const lines = exportPermissions(registry).split('\r\n')
  assert.equal(lines[0], HEADER)
  assert.equal(lines[1], 'viewer,billing/*,x,,,,,guess')
  assert.equal(lines[4], 'manager,billing/invoices,x,x,x,,x,')
  assert.equal(lines.at(-1), '')
  assert.equal(exportPermissions(registry, { role: 'manager' }), `${HEADER}\r\nmanager,billing/invoices,x,x,x,,x,\r\n`)
})

test('exportPermissions quotes a field that holds a comma or a quote', () => {
  const registry = { actions: ['view'], names: ['a'], roles: { a: { permissions: { 'billing/Open, "late"': ['view'] }, origins: {} } } }
  assert.equal(exportPermissions(registry).split('\r\n')[1], 'a,"billing/Open, ""late""",x,')
})

test('parseCsv reads quotes, line breaks in quotes, a BOM and the ";" delimiter', () => {
  const { delimiter, rows } = parseCsv('﻿role;key;view\r\neditor;"billing/a;b";x\n\neditor;"billing/two\nlines";\n')
  assert.equal(delimiter, ';')
  assert.deepEqual(rows, [
    { line: 1, cells: ['role', 'key', 'view'] },
    { line: 2, cells: ['editor', 'billing/a;b', 'x'] },
    { line: 4, cells: ['editor', 'billing/two\nlines', ''] },
  ])
  assert.throws(() => parseCsv('role,key\n"open'), /line 2: a quoted field is not closed/)
})

test('an exported CSV imports back with no change', () => {
  const dir = copyFixture()
  const csv = run(['export-permissions', '--root', dir]).stdout
  const result = plan(dir, csv, { write: true })
  assert.deepEqual(result.changes, [])
  assert.deepEqual(result.actionsAdded, [])
  assert.deepEqual(result.kept, ['anonymous'])
  assert.equal(result.written, false)
})

test('planImport changes, adds and removes keys, and drops the origin of each key it touches', () => {
  const dir = copyFixture()
  const csv = [
    'role,key,view,create,edit,delete,approve,export',
    'viewer,billing/*,x,,,,,x',
    'editor,billing/invoices,x,x,x,,,',
    'editor,billing/clients,X,1,,,,',
    'manager,billing/invoices,x,x,x,,x,',
    'manager,billing/reports,,,,,,',
  ].join('\n')
  const dry = plan(dir, csv)
  assert.equal(dry.written, false)
  assert.deepEqual(dry.actionsAdded, ['export'])
  assert.deepEqual(dry.kept, ['admin', 'anonymous'])
  assert.deepEqual(dry.changes, [
    { role: 'viewer', key: 'billing/*', before: ['view'], after: ['view', 'export'] },
    { role: 'editor', key: 'billing/invoices', before: ['view', 'create', 'edit', 'delete'], after: ['view', 'create', 'edit'] },
    { role: 'editor', key: 'billing/*', before: ['view'], after: null },
    { role: 'editor', key: 'billing/clients', before: null, after: ['view', 'create'] },
    { role: 'manager', key: 'billing/reports', before: null, after: [] },
  ])
  assert.deepEqual(readRoles(dir).roles.editor.permissions['billing/*'], ['view'])

  plan(dir, csv, { write: true })
  const roles = readRoles(dir)
  assert.deepEqual(roles.actions, ['approve', 'export'])
  assert.deepEqual(roles.roles.viewer, { description: 'Reads billing', found: ['src/auth/roles.ts:8'], permissions: { 'billing/*': ['view', 'export'] } })
  assert.deepEqual(Object.keys(roles.roles.editor.permissions), ['billing/invoices', 'billing/clients'])
  assert.deepEqual(roles.roles.manager.permissions, { 'billing/invoices': ['view', 'create', 'edit', 'approve'], 'billing/reports': [] })
  assert.deepEqual(roles.roles.admin, readRoles(FIXTURE).roles.admin)
  assert.equal(Object.keys(roles)[0], 'version')
})

test('planImport keeps the origin of an unchanged key and adds anonymous when the CSV gives it keys', () => {
  const dir = copyFixture()
  const result = plan(dir, `${HEADER}\nviewer,billing/*,x,,,,,guess\nanonymous,billing/*,x,,,,,\n`, { write: true })
  assert.deepEqual(result.changes, [{ role: 'anonymous', key: 'billing/*', before: null, after: ['view'] }])
  const roles = readRoles(dir).roles
  assert.deepEqual(roles.viewer.origins, { 'billing/*': 'guess' })
  assert.deepEqual(roles.anonymous, { description: 'No session', permissions: { 'billing/*': ['view'] } })
})

test('planImport explains a CSV it cannot apply', () => {
  const dir = copyFixture()
  assert.throws(() => plan(dir, ''), /the CSV is empty/)
  assert.throws(() => plan(dir, 'role,view,create,edit,delete,approve\n'), /line 1: the header has no "key" column/)
  assert.throws(() => plan(dir, 'role,key,view,create,edit,approve\n'), /line 1: the header has no column for delete; a missing column would remove that action from every key/)
  assert.throws(() => plan(dir, `${HEADER},view\n`), /line 1: column "view" appears twice/)
  assert.throws(() => plan(dir, `${HEADER},Bulk Export\n`), /line 1: column "Bulk Export" is not an action/)
  assert.throws(() => plan(dir, `${HEADER}\nghost,billing/*,x,,,,,\n`), /line 2: role "ghost" is not registered; \/runbooks:roles:create adds it/)
  assert.throws(() => plan(dir, `${HEADER}\neditor,invoices,x,,,,,\n`), /line 2: key "invoices" must be <capability>\/<feature> or <capability>\/\*/)
  assert.throws(() => plan(dir, `${HEADER}\neditor,billing/*,x,,,,,\neditor,billing/*,,,,,,\n`), /line 3: editor "billing\/\*" repeats line 2/)
  assert.throws(() => plan(dir, `${HEADER}\neditor,billing/*,maybe,,,,,\n`), /line 2, column view: "maybe" must be x or empty/)
  assert.deepEqual(readRoles(dir), readRoles(FIXTURE))
})

test('export-permissions and import-permissions run from the CLI and need tracking on', () => {
  const dir = copyFixture()
  fs.writeFileSync(path.join(dir, 'perms.csv'), `${HEADER.replaceAll(',', ';')}\neditor;billing/invoices;x;;;;;\n`)
  const dry = run(['import-permissions', '--file', 'perms.csv', '--root', dir])
  assert.equal(dry.code, 0)
  assert.match(dry.stdout, /\| editor \| billing\/invoices \| view, create, edit, delete \| view \|/)
  assert.match(dry.stdout, /Roles with no row, left as they are: viewer, manager, admin, anonymous\./)
  assert.match(dry.stdout, /Dry run: nothing written/)
  const written = JSON.parse(run(['import-permissions', '--file', 'perms.csv', '--write', '--json', '--root', dir]).stdout)
  assert.equal(written.written, true)
  assert.equal(written.delimiter, ';')
  assert.deepEqual(readRoles(dir).roles.editor.permissions, { 'billing/invoices': ['view'] })

  assert.equal(run(['export-permissions', '--out', 'out.csv', '--root', dir]).stdout, 'Written: out.csv, 4 rows.\n')
  assert.equal(fs.readFileSync(path.join(dir, 'out.csv'), 'utf8'), run(['export-permissions', '--root', dir]).stdout)

  assert.match(run(['import-permissions', '--root', dir]).stderr, /import-permissions needs --file <csv>/)
  assert.match(run(['import-permissions', '--file', 'nope.csv', '--root', dir]).stderr, /nope\.csv not found/)
  assert.match(run(['export-permissions', '--role', 'ghost', '--root', dir]).stderr, /no role "ghost"/)
  const PROJECT = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
  const off = run(['export-permissions', '--root', PROJECT])
  assert.equal(off.code, 2)
  assert.match(off.stderr, /role tracking is off/)
})

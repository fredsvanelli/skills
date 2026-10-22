import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFixtures, sourceCounts, checkFixtures } from './lib/fixtures.mjs'
import { validateSchema } from './lib/schema.mjs'
import { run } from './runbooks.mjs'

const fixture = (method, p, status, body, source = 'hand-written', headers) =>
  JSON.stringify({ request: { method, path: p }, response: { status, headers, body }, source })

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-fixtures-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

const DOC = {
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/invoices': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/List' } } } } } } },
    '/invoices/{id}': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['id'] } } } } } } },
  },
  components: { schemas: { List: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', properties: { total: { type: 'number' } } } } } } } },
}

test('loadFixtures reads runbook-level and step fixtures and reports broken ones', () => {
  const dir = 'docs/runbooks/_fixtures/billing/issue'
  const root = tmp({
    [`${dir}/list.json`]: fixture('GET', '/v1/invoices', 200, { items: [] }),
    [`${dir}/S03/get.json`]: fixture('GET', '/v1/invoices/1', 200, { id: 1 }, 'recorded 2026-10-01'),
    [`${dir}/broken.json`]: '{ nope',
    [`${dir}/partial.json`]: JSON.stringify({ request: { method: 'GET' }, response: {} }),
    [`${dir}/notes/x.json`]: '{}',
    [`${dir}/readme.md`]: 'x',
  })
  const { fixtures, problems } = loadFixtures(root, dir)
  assert.deepEqual(fixtures.map((f) => [f.file, f.step]), [[`${dir}/list.json`, null], [`${dir}/S03/get.json`, 'S03']])
  assert.equal(problems.length, 3)
  assert.ok(problems.some((p) => p.startsWith(`${dir}/broken.json: not valid JSON`)))
  assert.ok(problems.includes(`${dir}/partial.json: missing request.path, response.status`))
  assert.ok(problems.includes(`${dir}/notes: not a step folder`))
  assert.deepEqual(loadFixtures(root, 'nowhere'), { fixtures: [], problems: [] })
})

test('sourceCounts groups by source prefix', () => {
  const f = (source) => ({ source })
  assert.deepEqual(sourceCounts([f('recorded 2026-10-01'), f('recorded x'), f('schema'), f('hand-written')]), { recorded: 2, schema: 1, handWritten: 1 })
})

test('validateSchema checks types, required, refs, nullable, enum and combinators', () => {
  const body = { items: [{ total: 'x' }] }
  assert.deepEqual(validateSchema(body, DOC.components.schemas.List, DOC), ['body.items[0].total: expected number, got string'])
  assert.deepEqual(validateSchema({}, { $ref: '#/components/schemas/List' }, DOC), ['body.items: required, missing'])
  assert.deepEqual(validateSchema(null, { type: 'string', nullable: true }, DOC), [])
  assert.deepEqual(validateSchema(null, { type: 'string' }, DOC), ['body: expected string, got null'])
  assert.deepEqual(validateSchema(1.5, { type: 'integer' }, DOC), ['body: expected integer, got number'])
  assert.equal(validateSchema('c', { enum: ['a', 'b'] }, DOC).length, 1)
  assert.deepEqual(validateSchema('a', { enum: ['a', 'b'] }, DOC), [])
  assert.deepEqual(validateSchema(3, { oneOf: [{ type: 'string' }, { type: 'number' }] }, DOC), [])
  assert.equal(validateSchema(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }, DOC).length, 1)
  assert.equal(validateSchema({}, { allOf: [{ required: ['a'] }, { required: ['b'] }] }, DOC).length, 2)
})

test('checkFixtures matches templates, strips the server path and flags gaps', () => {
  const fx = (file, method, p, status, body, headers) => ({ file, request: { method, path: p }, response: { status, body, headers } })
  assert.deepEqual(checkFixtures([fx('a', 'GET', '/v1/invoices/42', 200, { id: 42 })], DOC), [])
  assert.deepEqual(checkFixtures([fx('b', 'GET', '/invoices/42', 200, {})], DOC), ['b: body.id: required, missing'])
  assert.deepEqual(checkFixtures([fx('c', 'GET', '/x', 200, {})], DOC), ['c: no operation for GET /x in the schema'])
  assert.deepEqual(checkFixtures([fx('d', 'GET', '/invoices', 404, {})], DOC), ['d: no response 404 for GET /invoices in the schema'])
  assert.deepEqual(checkFixtures([fx('e', 'GET', '/invoices', 200, 'a,b', { 'Content-Type': 'text/csv' })], DOC), [])
})

test('runbooks.mjs fixtures reports problems and exits 2 on unusable input', () => {
  const dir = 'docs/runbooks/_fixtures/billing/issue'
  const root = tmp({
    'docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, stack: 'frontend', upstream: { mode: 'mocked', urlEnv: 'API_URL', schema: 'openapi.json' } }),
    'docs/runbooks/billing/issue.md': '---\nid: billing.issue\ncapability: billing\nstatus: active\n---\n',
    'openapi.json': JSON.stringify(DOC),
    [`${dir}/list.json`]: fixture('GET', '/v1/invoices', 200, { items: [{ total: 'x' }] }, 'recorded 2026-10-01'),
  })
  const result = run(['fixtures', 'billing.issue', '--root', root, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.dir, dir)
  assert.equal(data.sources.recorded, 1)
  assert.deepEqual(data.problems, [`${dir}/list.json: body.items[0].total: expected number, got string`])
  assert.match(run(['fixtures', 'billing.issue', '--root', root]).stdout, /expected number, got string/)
  assert.equal(run(['fixtures', '--root', root]).code, 2)
  assert.equal(run(['fixtures', 'nope', '--root', root]).code, 2)
  fs.writeFileSync(path.join(root, 'openapi.json'), '{ bad')
  assert.equal(run(['fixtures', 'billing.issue', '--root', root]).code, 2)
  fs.rmSync(path.join(root, 'openapi.json'))
  assert.equal(run(['fixtures', 'billing.issue', '--root', root]).code, 2)
})

test('checkFixtures resolves $ref on responses and path items', () => {
  const doc = {
    paths: {
      '/a': { get: { responses: { 404: { $ref: '#/components/responses/NotFound' } } } },
      '/b': { $ref: '#/components/pathItems/B' },
    },
    components: {
      responses: { NotFound: { content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'integer' } } } } } } },
      pathItems: { B: { get: { responses: { 404: { $ref: '#/components/responses/NotFound' } } } } },
    },
  }
  const fx = (file, p) => ({ file, request: { method: 'GET', path: p }, response: { status: 404, body: { code: 'x' } } })
  assert.deepEqual(checkFixtures([fx('a', '/a'), fx('b', '/b')], doc),
    ['a: body.code: expected integer, got string', 'b: body.code: expected integer, got string'])
})

test('loadFixtures reads @role folders at the runbook level and inside steps', () => {
  const root = tmp({
    'f/me.json': fixture('GET', '/me', 200, {}),
    'f/@viewer/me.json': fixture('GET', '/me', 200, {}),
    'f/S02/@viewer/me.json': fixture('GET', '/me', 200, {}),
  })
  const { fixtures, problems } = loadFixtures(root, 'f', { roles: ['anonymous', 'viewer'] })
  assert.deepEqual(problems, [])
  assert.deepEqual(fixtures.map((x) => [x.file, x.step, x.role]), [
    ['f/me.json', null, null],
    ['f/@viewer/me.json', null, 'viewer'],
    ['f/S02/@viewer/me.json', 'S02', 'viewer'],
  ])
})

test('loadFixtures reports role folders without tracking and unregistered roles', () => {
  const root = tmp({ 'f/@editor/me.json': fixture('GET', '/me', 200, {}), 'f/S01/@ghost/me.json': fixture('GET', '/me', 200, {}) })
  assert.deepEqual(loadFixtures(root, 'f').problems, ['f/@editor: role folders need role tracking', 'f/S01/@ghost: role folders need role tracking'])
  const { fixtures, problems } = loadFixtures(root, 'f', { roles: ['anonymous', 'editor'] })
  assert.deepEqual(problems, ['f/S01/@ghost: role ghost is not registered'])
  assert.equal(fixtures.length, 1)
})

test('loadFixtures reads +case folders at the four levels', () => {
  const root = tmp({
    'f/me.json': fixture('GET', '/me', 200, {}),
    'f/+vip-team/me.json': fixture('GET', '/me', 200, {}),
    'f/@viewer/+vip-team/me.json': fixture('GET', '/me', 200, {}),
    'f/S02/+regular/me.json': fixture('GET', '/me', 200, {}),
    'f/S02/@viewer/+vip-team/me.json': fixture('GET', '/me', 200, {}),
  })
  const { fixtures, problems } = loadFixtures(root, 'f', { roles: ['anonymous', 'viewer'], cases: ['vip-team', 'regular'] })
  assert.deepEqual(problems, [])
  assert.deepEqual(fixtures.map((x) => [x.file, x.step, x.role, x.case]), [
    ['f/me.json', null, null, null],
    ['f/+vip-team/me.json', null, null, 'vip-team'],
    ['f/@viewer/+vip-team/me.json', null, 'viewer', 'vip-team'],
    ['f/S02/+regular/me.json', 'S02', null, 'regular'],
    ['f/S02/@viewer/+vip-team/me.json', 'S02', 'viewer', 'vip-team'],
  ])
})

test('loadFixtures reports unknown cases, case folders without a context and bad case names', () => {
  const root = tmp({
    'f/+gold/me.json': fixture('GET', '/me', 200, {}),
    'f/+vip-team/me.json': fixture('GET', '/me', 200, {}),
    'f/S01/+Bad/me.json': fixture('GET', '/me', 200, {}),
  })
  assert.deepEqual(loadFixtures(root, 'f', { cases: ['vip-team'] }).problems,
    ["f/+gold: case gold is not one of the runbook's cases", 'f/S01/+Bad: not a case folder'])
  assert.deepEqual(loadFixtures(root, 'f').problems,
    ['f/+gold: case folders need a context', 'f/+vip-team: case folders need a context', 'f/S01/+Bad: not a case folder'])
})

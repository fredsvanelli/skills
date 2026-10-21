import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchCall, callServes, changedOperations } from './lib/contract.mjs'
import { run } from './runbooks.mjs'

const FRONT = fileURLToPath(new URL('./__fixtures__/front', import.meta.url))
const SCHEMA = 'docs/runbooks/_contract/openapi.json'

const json = (schema) => ({ content: { 'application/json': { schema } } })
const DOC = {
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/quotes': { get: { summary: 'List', responses: { 200: json({ type: 'array', items: { $ref: '#/components/schemas/Quote' } }) } } },
    '/quotes/{quoteId}': {
      parameters: [{ name: 'quoteId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { responses: { 200: json({ $ref: '#/components/schemas/Quote' }) } },
    },
    '/quotes/{id}/tax-estimate': { post: { responses: { 200: json({ type: 'object', properties: { tax: { type: 'number' } } }) } } },
  },
  components: { schemas: { Quote: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, total: { type: 'number' } } } } },
}
const clone = (value) => structuredClone(value)

test('matchCall finds the operation whatever the parameter names, with or without the server path', () => {
  assert.equal(matchCall('GET /quotes/{id}', DOC), 'GET /quotes/{quoteId}')
  assert.equal(matchCall('GET /v1/quotes/{id}', DOC), 'GET /quotes/{quoteId}')
  assert.equal(matchCall('GET /quotes', DOC), 'GET /quotes')
  assert.equal(matchCall('POST /quotes', DOC), null)
  assert.equal(matchCall('GET /quotes/{id}/lines', DOC), null)
})

test('callServes tells whether a call names a request, with the server path stripped when needed', () => {
  assert.equal(callServes('GET /quotes/{id}', 'GET', '/quotes/q1'), true)
  assert.equal(callServes('GET /quotes/{id}', 'get', '/quotes/q1?x=1'), true)
  assert.equal(callServes('GET /quotes/{id}', 'GET', '/quotes/q1/lines'), false)
  assert.equal(callServes('GET /quotes/{id}', 'POST', '/quotes/q1'), false)
  assert.equal(callServes('GET /quotes/{id}', 'GET', '/v1/quotes/q1', DOC), true)
  assert.equal(callServes('GET /quotes/{id}', 'GET', '/v1/quotes/q1'), false)
})

test('changedOperations reports added, removed and changed operations, through $ref and path parameters', () => {
  assert.deepEqual(changedOperations(DOC, clone(DOC)), [])
  const quote = clone(DOC)
  quote.components.schemas.Quote.required.push('total')
  assert.deepEqual(changedOperations(DOC, quote), [
    { operation: 'GET /quotes', change: 'changed' },
    { operation: 'GET /quotes/{quoteId}', change: 'changed' },
  ])
  const parameter = clone(DOC)
  parameter.paths['/quotes/{quoteId}'].parameters[0].schema.type = 'integer'
  assert.deepEqual(changedOperations(DOC, parameter), [{ operation: 'GET /quotes/{quoteId}', change: 'changed' }])
  const moved = clone(DOC)
  delete moved.paths['/quotes'].get
  moved.paths['/quotes'].post = { responses: { 201: json({ $ref: '#/components/schemas/Quote' }) } }
  assert.deepEqual(changedOperations(DOC, moved), [
    { operation: 'GET /quotes', change: 'removed' },
    { operation: 'POST /quotes', change: 'added' },
  ])
})

test('changedOperations ignores prose, examples, renamed parameters and x- keys', () => {
  const prose = clone(DOC)
  prose.paths['/quotes'].get.summary = 'All quotes'
  prose.paths['/quotes'].get.description = 'Lists every quote'
  prose.paths['/quotes'].get['x-owner'] = 'billing'
  prose.components.schemas.Quote.description = 'A quote'
  prose.components.schemas.Quote.properties.total.example = 12
  assert.deepEqual(changedOperations(DOC, prose), [])
  const renamed = clone(DOC)
  renamed.paths['/quotes/{quoteId}/tax-estimate'] = renamed.paths['/quotes/{id}/tax-estimate']
  delete renamed.paths['/quotes/{id}/tax-estimate']
  assert.deepEqual(changedOperations(DOC, renamed), [])
})

test('changedOperations keeps a recursive schema finite', () => {
  const tree = clone(DOC)
  tree.components.schemas.Quote.properties.parent = { $ref: '#/components/schemas/Quote' }
  const deeper = clone(tree)
  deeper.components.schemas.Quote.properties.id.type = 'integer'
  assert.deepEqual(changedOperations(tree, clone(tree)), [])
  assert.equal(changedOperations(tree, deeper).length, 2)
})

// The front fixture with its calls, fixtures and schema, copied so a test can edit it.
function front(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-contract-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.cpSync(FRONT, root, { recursive: true })
  return root
}
const editJson = (root, rel, edit) => {
  const file = path.join(root, rel)
  fs.writeFileSync(file, JSON.stringify(edit(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2))
}

test('contract passes on the front fixture and --strict exits 0', (t) => {
  const root = front(t)
  const result = run(['contract', '--strict', '--root', root, '--json'])
  assert.deepEqual([result.code, result.stderr], [0, ''])
  const body = JSON.parse(result.stdout)
  assert.deepEqual([body.schema, body.runbooks, body.findings], [SCHEMA, ['quotes.list-quotes', 'quotes.rate-table'], []])
  assert.match(run(['contract', '--root', root]).stdout, /^No findings\.$/m)
})

test('contract lists calls the schema lacks, fixtures no call names and fixtures the schema rejects', (t) => {
  const root = front(t)
  editJson(root, SCHEMA, (doc) => {
    delete doc.paths['/quotes/{id}/tax-estimate']
    doc.components.schemas.Quote.required.push('currency')
    return doc
  })
  fs.writeFileSync(path.join(root, 'docs/runbooks/_fixtures/quotes/list-quotes/S02/get-lines.json'),
    JSON.stringify({ request: { method: 'GET', path: '/quotes/q1/lines' }, response: { status: 200, body: [] }, source: 'hand-written: test' }))
  const result = run(['contract', '--strict', '--root', root, '--json'])
  assert.equal(result.code, 1)
  assert.deepEqual(JSON.parse(result.stdout).findings, [
    { runbook: 'quotes.list-quotes', kind: 'fixture', message: 'docs/runbooks/_fixtures/quotes/list-quotes/get-quotes.json: body[0].currency: required, missing' },
    { runbook: 'quotes.list-quotes', kind: 'fixture', message: 'docs/runbooks/_fixtures/quotes/list-quotes/S02/get-lines.json: requests GET /quotes/q1/lines, which no call or entry of the runbook names' },
    { runbook: 'quotes.list-quotes', kind: 'fixture', message: 'docs/runbooks/_fixtures/quotes/list-quotes/S02/get-lines.json: no operation for GET /quotes/q1/lines in the schema' },
    { runbook: 'quotes.list-quotes', kind: 'fixture', message: 'docs/runbooks/_fixtures/quotes/list-quotes/S02/get-quote.json: body.currency: required, missing' },
    { runbook: 'quotes.rate-table', kind: 'call', message: `call POST /quotes/{id}/tax-estimate matches no operation in ${SCHEMA}` },
  ])
  assert.equal(run(['contract', '--root', root, '--json']).code, 0, 'findings exit 0 without --strict')
  assert.match(run(['contract', '--root', root]).stdout, /^\| quotes\.rate-table \| call \| call POST \/quotes\/\{id\}\/tax-estimate matches no operation in/m)
})

test('without upstream.schema, contract checks only fixtures against calls and says so', (t) => {
  const root = front(t)
  editJson(root, 'docs/runbooks/runbooks.config.json', (config) => ({ ...config, upstream: { ...config.upstream, schema: null } }))
  const ok = run(['contract', '--strict', '--root', root, '--json'])
  assert.equal(ok.code, 0)
  assert.equal(JSON.parse(ok.stdout).schema, null)
  assert.match(run(['contract', '--root', root]).stdout, /^No upstream\.schema in the config: calls and fixtures were checked against each other only\.$/m)
  const runbook = path.join(root, 'docs/runbooks/quotes/list-quotes.md')
  fs.writeFileSync(runbook, fs.readFileSync(runbook, 'utf8').replace('calls: [GET /quotes, GET /quotes/{id}]', 'calls: [GET /quotes]'))
  const missing = run(['contract', '--strict', '--root', root, '--json'])
  assert.equal(missing.code, 1)
  assert.deepEqual(JSON.parse(missing.stdout).findings.map((f) => f.message), [
    'docs/runbooks/_fixtures/quotes/list-quotes/S02/get-quote.json: requests GET /quotes/q1, which no call or entry of the runbook names',
  ])
})

test('contract exits 2 without an upstream block or with a missing schema file', (t) => {
  const root = front(t)
  editJson(root, 'docs/runbooks/runbooks.config.json', (config) => ({ ...config, upstream: { ...config.upstream, schema: 'docs/nope.json' } }))
  const missing = run(['contract', '--root', root])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /^runbooks: docs\/nope\.json not found: upstream\.schema points to a missing file$/m)
  editJson(root, 'docs/runbooks/runbooks.config.json', (config) => {
    delete config.upstream
    return config
  })
  const none = run(['contract', '--root', root])
  assert.equal(none.code, 2)
  assert.match(none.stderr, /^runbooks: the config has no upstream block, so there is no contract to check$/m)
})

test('with role tracking on, contract checks the requests of @<role> fixture folders', (t) => {
  const root = front(t)
  editJson(root, 'docs/runbooks/runbooks.config.json', (config) => ({ ...config, roles: { enabled: true } }))
  fs.writeFileSync(path.join(root, 'docs/runbooks/roles.json'),
    JSON.stringify({ version: 1, roles: { editor: { description: 'Edits quotes', permissions: { 'quotes/*': ['view'] } } } }))
  const fixtures = path.join(root, 'docs/runbooks/_fixtures/quotes/list-quotes')
  fs.mkdirSync(path.join(fixtures, '@editor'))
  fs.writeFileSync(path.join(fixtures, '@editor/get-quotes.json'),
    JSON.stringify({ request: { method: 'GET', path: '/quotes' }, response: { status: 200, body: [] }, source: 'hand-written: test' }))
  assert.deepEqual(JSON.parse(run(['contract', '--strict', '--root', root, '--json']).stdout).findings, [])
  fs.writeFileSync(path.join(fixtures, '@editor/get-lines.json'),
    JSON.stringify({ request: { method: 'GET', path: '/quotes/q1/lines' }, response: { status: 200, body: [] }, source: 'hand-written: test' }))
  const result = run(['contract', '--strict', '--root', root, '--json'])
  assert.equal(result.code, 1)
  assert.deepEqual(JSON.parse(result.stdout).findings.map((f) => f.message), [
    'docs/runbooks/_fixtures/quotes/list-quotes/@editor/get-lines.json: requests GET /quotes/q1/lines, which no call or entry of the runbook names',
    'docs/runbooks/_fixtures/quotes/list-quotes/@editor/get-lines.json: no operation for GET /quotes/q1/lines in the schema',
  ])
})

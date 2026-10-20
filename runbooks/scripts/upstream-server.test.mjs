import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createUpstreamServer, matchFixture, VERSION } from './upstream-server.mjs'

const fixture = (method, p, response, query) =>
  JSON.stringify({ request: { method, path: p, ...(query ? { query } : {}) }, response, source: 'hand-written' })

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-upstream-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

async function start(t, files, options = {}) {
  const fixturesRoot = tmp(files)
  const logs = []
  const server = createUpstreamServer({ fixturesRoot, log: (line) => logs.push(line), ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const select = (body) => fetch(`${base}/__runbooks/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const state = async () => (await fetch(`${base}/__runbooks/state`)).json()
  return { base, select, state, logs, fixturesRoot }
}

const FILES = {
  'billing/list/invoices.json': fixture('GET', '/invoices', { status: 200, body: { items: [] } }),
  'billing/list/paged.json': fixture('GET', '/invoices', { status: 200, body: { items: [1] } }, { page: '1' }),
  'billing/list/S03/invoices.json': fixture('GET', '/invoices', { status: 200, body: { items: ['s03'] } }),
  'billing/list/export.json': fixture('GET', '/export', { status: 200, headers: { 'content-type': 'text/csv' }, body: 'a,b\n1,2\n' }),
  'billing/list/delete.json': fixture('DELETE', '/invoices/1', { status: 204 }),
  'billing/list/broken.json': '{ nope',
}

test('VERSION matches the plugin manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, manifest.version)
})

test('matchFixture ranks the step folder first, then more query keys, then file name', () => {
  const f = (file, step, query) => ({ file, step, request: { method: 'get', path: '/a', query }, response: { status: 200 } })
  const req = { method: 'GET', path: '/a', query: { page: '1', sort: 'asc' } }
  const plain = f('a.json', null)
  const one = f('b.json', null, { page: '1' })
  const two = f('c.json', null, { page: '1', sort: 'asc' })
  const stepPlain = f('S02/a.json', 'S02')
  assert.equal(matchFixture([plain, one, two], req, null), two)
  assert.equal(matchFixture([plain, one, two, stepPlain], req, 'S02'), stepPlain)
  assert.equal(matchFixture([plain, one, two, stepPlain], req, 'S03'), two)
  assert.equal(matchFixture([f('z.json', null), f('b.json', null)], req, null).file, 'b.json')
  assert.equal(matchFixture([f('x.json', null, { page: '2' })], req, null), null)
  assert.equal(matchFixture([plain], { ...req, path: '/a/' }, null), null)
  assert.equal(matchFixture([plain], { ...req, method: 'POST' }, null), null)
})

test('a selected runbook serves its fixture and logs the request', async (t) => {
  const s = await start(t, FILES)
  const res = await s.select({ runbook: 'billing.list' })
  assert.deepEqual(await res.json(), { runbook: 'billing.list', mode: 'mocked', step: null })
  const r = await fetch(`${s.base}/invoices`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await r.json(), { items: [] })
  const state = await s.state()
  assert.deepEqual(state.requests, [{ method: 'GET', path: '/invoices', query: {}, body: null, step: null, status: 200 }])
  assert.deepEqual(s.logs, ['GET /invoices -> 200'])
})

test('a step folder overrides the runbook fixture after select', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list' })
  await s.select({ step: 'S03' })
  assert.deepEqual(await (await fetch(`${s.base}/invoices`)).json(), { items: ['s03'] })
  await s.select({ runbook: 'billing.list' })
  assert.equal((await s.state()).step, null)
})

test('query matching ignores extra params and compares first values as strings', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list' })
  assert.deepEqual(await (await fetch(`${s.base}/invoices?_t=9&page=1`)).json(), { items: [1] })
  assert.deepEqual(await (await fetch(`${s.base}/invoices?page=2`)).json(), { items: [] })
  const state = await s.state()
  assert.deepEqual(state.requests[0].query, { _t: '9', page: '1' })
})

test('an unknown request gets a 501 and appears in unmatched', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list', step: 'S01' })
  const r = await fetch(`${s.base}/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  assert.equal(r.status, 501)
  assert.deepEqual(await r.json(), { error: 'no fixture', method: 'POST', path: '/nope', runbook: 'billing.list', step: 'S01' })
  const state = await s.state()
  assert.deepEqual(state.unmatched, [{ method: 'POST', path: '/nope', step: 'S01' }])
  assert.deepEqual(state.requests[0].body, { a: 1 })
  assert.equal(state.requests[0].status, 501)
  await s.select({ step: 'S02' })
  assert.deepEqual((await s.state()).unmatched, [])
})

test('no runbook selected answers 501', async (t) => {
  const s = await start(t, FILES)
  const r = await fetch(`${s.base}/invoices`)
  assert.equal(r.status, 501)
  assert.deepEqual(await r.json(), { error: 'no runbook selected' })
})

test('a runbook folder missing on disk is unmatched, not a crash', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'ghost.flow' })
  assert.equal((await fetch(`${s.base}/invoices`)).status, 501)
})

test('preflight and CORS headers', async (t) => {
  const s = await start(t, FILES)
  const pre = await fetch(`${s.base}/invoices`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-headers': 'x-a,content-type' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  assert.equal(pre.headers.get('access-control-allow-headers'), 'x-a,content-type')
  const plain = await fetch(`${s.base}/__runbooks/state`)
  assert.equal(plain.headers.get('access-control-allow-origin'), '*')
  assert.equal(plain.headers.get('access-control-allow-credentials'), null)
  await s.select({ runbook: 'billing.list' })
  const withOrigin = await fetch(`${s.base}/invoices`, { headers: { origin: 'http://x.test' } })
  assert.equal(withOrigin.headers.get('access-control-allow-origin'), 'http://x.test')
})

test('a 204 fixture sends an empty body and a string body keeps its content type', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list' })
  const del = await fetch(`${s.base}/invoices/1`, { method: 'DELETE' })
  assert.equal(del.status, 204)
  assert.equal(await del.text(), '')
  const csv = await fetch(`${s.base}/export`)
  assert.equal(csv.headers.get('content-type'), 'text/csv')
  assert.equal(await csv.text(), 'a,b\n1,2\n')
})

test('select validates input and changes nothing on error', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list', step: 'S01' })
  const bad = await s.select({ mode: 'weird', step: 'S02' })
  assert.equal(bad.status, 400)
  assert.equal(typeof (await bad.json()).error, 'string')
  const notObject = await fetch(`${s.base}/__runbooks/select`, { method: 'POST', body: '[1]' })
  assert.equal(notObject.status, 400)
  const notJson = await fetch(`${s.base}/__runbooks/select`, { method: 'POST', body: 'x' })
  assert.equal(notJson.status, 400)
  const state = await s.state()
  assert.equal(state.step, 'S01')
  assert.equal(state.mode, 'mocked')
})

test('an unknown control route answers 404 JSON', async (t) => {
  const s = await start(t, FILES)
  const r = await fetch(`${s.base}/__runbooks/nope`)
  assert.equal(r.status, 404)
  assert.equal(typeof (await r.json()).error, 'string')
})

test('live and record modes answer a 501 placeholder', async (t) => {
  const s = await start(t, FILES)
  await s.select({ mode: 'live' })
  const r = await fetch(`${s.base}/invoices`)
  assert.equal(r.status, 501)
  assert.deepEqual(await r.json(), { error: 'mode live is not available' })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { createUpstreamServer, redactPayload, matchFixture, payloadMatches, payloadFields, VERSION } from './upstream-server.mjs'

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
  assert.deepEqual(await res.json(), { runbook: 'billing.list', mode: 'mocked', role: null, case: null, step: null })
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
  assert.deepEqual(await r.json(), { error: 'no fixture', method: 'POST', path: '/nope', body: { a: 1 }, runbook: 'billing.list', step: 'S01' })
  const state = await s.state()
  assert.deepEqual(state.unmatched, [{ method: 'POST', path: '/nope', body: { a: 1 }, step: 'S01' }])
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
  const plain = await fetch(`${s.base}/invoices`)
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
  const json = { 'content-type': 'application/json' }
  const notObject = await fetch(`${s.base}/__runbooks/select`, { method: 'POST', headers: json, body: '[1]' })
  assert.equal(notObject.status, 400)
  const notJson = await fetch(`${s.base}/__runbooks/select`, { method: 'POST', headers: json, body: 'x' })
  assert.equal(notJson.status, 400)
  const state = await s.state()
  assert.equal(state.step, 'S01')
  assert.equal(state.mode, 'mocked')
})

test('control routes send no CORS headers and approve no preflight', async (t) => {
  const s = await start(t, FILES)
  const origin = 'https://evil.example'
  const sel = await fetch(`${s.base}/__runbooks/select`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ runbook: 'billing.list' }),
  })
  assert.equal(sel.status, 200)
  assert.equal(sel.headers.get('access-control-allow-origin'), null)
  assert.equal(sel.headers.get('access-control-allow-credentials'), null)
  const state = await fetch(`${s.base}/__runbooks/state`, { headers: { origin } })
  assert.equal(state.headers.get('access-control-allow-origin'), null)
  const pre = await fetch(`${s.base}/__runbooks/select`, {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  })
  assert.equal(pre.status, 404)
  assert.equal(pre.headers.get('access-control-allow-origin'), null)
  assert.equal(pre.headers.get('access-control-allow-methods'), null)
})

test('select needs a JSON content type and changes nothing without it', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list', step: 'S01' })
  const plain = await fetch(`${s.base}/__runbooks/select`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ runbook: 'other.flow', mode: 'record' }),
  })
  assert.equal(plain.status, 415)
  assert.deepEqual(await plain.json(), { error: 'select needs content-type: application/json' })
  const withCharset = await fetch(`${s.base}/__runbooks/select`, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ step: 'S02' }),
  })
  assert.equal(withCharset.status, 200)
  const state = await s.state()
  assert.equal(state.runbook, 'billing.list')
  assert.equal(state.mode, 'mocked')
  assert.equal(state.step, 'S02')
})

test('select rejects a runbook or step that is not an id and changes nothing', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list', step: 'S01' })
  for (const [body, key] of [
    [{ runbook: '../../x.y', mode: 'record' }, 'runbook'],
    [{ runbook: ['billing.list'] }, 'runbook'],
    [{ runbook: 'billing' }, 'runbook'],
    [{ step: '../S1', mode: 'record' }, 'step'],
    [{ step: 'S1/..' }, 'step'],
  ]) {
    const r = await s.select(body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.match((await r.json()).error, new RegExp(`^${key} `))
  }
  const state = await s.state()
  assert.deepEqual([state.runbook, state.mode, state.step], ['billing.list', 'mocked', 'S01'])
  const cleared = await s.select({ runbook: null, step: null })
  assert.deepEqual(await cleared.json(), { runbook: null, mode: 'mocked', role: null, case: null, step: null })
})

// Sends a request with a chosen Host header, which fetch does not allow.
function rawRequest(base, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${pathname}`, { method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('control routes need a local Host and app traffic does not', async (t) => {
  const s = await start(t, FILES)
  await s.select({ runbook: 'billing.list' })
  const evil = await rawRequest(s.base, '/__runbooks/select', {
    method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' }, body: '{"mode":"record"}',
  })
  assert.equal(evil.status, 403)
  assert.deepEqual(JSON.parse(evil.text), { error: 'control routes accept only a local Host' })
  assert.equal((await rawRequest(s.base, '/__runbooks/state', { headers: { host: 'evil.example:4010' } })).status, 403)
  assert.equal((await rawRequest(s.base, '/__runbooks/state', { headers: { host: 'localhost.evil.example' } })).status, 403)
  for (const host of ['127.0.0.1', 'localhost:4010', 'LOCALHOST', '[::1]:4010']) {
    assert.equal((await rawRequest(s.base, '/__runbooks/state', { headers: { host } })).status, 200, host)
  }
  assert.equal((await s.state()).mode, 'mocked')
  const app = await rawRequest(s.base, '/invoices', { headers: { host: 'evil.example' } })
  assert.equal(app.status, 200)
})

test('a mocked response answers the request origin over fixture CORS headers', async (t) => {
  const s = await start(t, {
    'billing/list/a.json': fixture('GET', '/a', { status: 200, headers: { 'access-control-allow-origin': 'http://localhost:3000' }, body: {} }),
    'billing/list/b.json': fixture('GET', '/b', { status: 200, headers: { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'x-keep': 'yes' }, body: {} }),
  })
  await s.select({ runbook: 'billing.list' })
  for (const name of ['a', 'b']) {
    const r = await rawRequest(s.base, `/${name}`, { headers: { origin: 'http://127.0.0.1:3001' } })
    assert.equal(r.headers['access-control-allow-origin'], 'http://127.0.0.1:3001', name)
    assert.equal(r.headers['access-control-allow-credentials'], 'true', name)
  }
  assert.equal((await rawRequest(s.base, '/b')).headers['x-keep'], 'yes')
})

test('an unknown control route answers 404 JSON', async (t) => {
  const s = await start(t, FILES)
  const r = await fetch(`${s.base}/__runbooks/nope`)
  assert.equal(r.status, 404)
  assert.equal(typeof (await r.json()).error, 'string')
})

// A second http.Server plays the live API.
async function fakeApi(t, handler) {
  const seen = []
  const api = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      handler(req, res)
    })
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { api.closeAllConnections?.(); api.close(resolve) }))
  return { api, seen, port: api.address().port }
}

async function until(check) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(check(), 'condition not reached')
}

test('live mode proxies method, path under a prefix, query, body and rewrites host', async (t) => {
  const fake = await fakeApi(t, (req, res) => {
    res.writeHead(201, { 'content-type': 'application/json', 'x-api': 'yes' })
    res.end('{"id":9}')
  })
  const s = await start(t, FILES, { target: `http://127.0.0.1:${fake.port}/v1` })
  await s.select({ mode: 'live' })
  const r = await fetch(`${s.base}/v1/invoices?_t=1&page=2`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-custom': 'a' }, body: '{"n":1}',
  })
  assert.equal(r.status, 201)
  assert.equal(r.headers.get('x-api'), 'yes')
  assert.deepEqual(await r.json(), { id: 9 })
  assert.equal(fake.seen[0].method, 'POST')
  assert.equal(fake.seen[0].url, '/v1/invoices?_t=1&page=2')
  assert.equal(fake.seen[0].body, '{"n":1}')
  assert.equal(fake.seen[0].headers.host, `127.0.0.1:${fake.port}`)
  assert.equal(fake.seen[0].headers['x-custom'], 'a')
  assert.equal(fake.seen[0].headers['x-forwarded-for'], undefined)
  const state = await s.state()
  assert.deepEqual(state.requests, [{ method: 'POST', path: '/v1/invoices', query: { _t: '1', page: '2' }, body: { n: 1 }, step: null, status: 201 }])
  assert.deepEqual(s.logs, ['POST /v1/invoices -> 201'])
})

test('live mode passes preflights and CORS headers through unchanged', async (t) => {
  const fake = await fakeApi(t, (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': 'https://app.example' }); return res.end() }
    res.writeHead(200); res.end('ok')
  })
  const s = await start(t, FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ mode: 'live' })
  const pre = await fetch(`${s.base}/x`, { method: 'OPTIONS', headers: { origin: 'https://other.example' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.example')
  assert.equal(fake.seen[0].method, 'OPTIONS')
  const plain = await fetch(`${s.base}/x`)
  assert.equal(plain.headers.get('access-control-allow-origin'), null)
})

test('live mode streams SSE before the upstream response ends', async (t) => {
  let finish
  const fake = await fakeApi(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: one\n\n')
    finish = () => res.end('data: two\n\n')
  })
  const s = await start(t, FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ mode: 'live' })
  const r = await fetch(`${s.base}/events`)
  assert.equal(r.status, 200)
  const reader = r.body.getReader()
  const first = await reader.read()
  assert.equal(new TextDecoder().decode(first.value), 'data: one\n\n')
  finish()
  const second = await reader.read()
  assert.equal(new TextDecoder().decode(second.value), 'data: two\n\n')
})

test('live mode tunnels a WebSocket upgrade both ways', async (t) => {
  const fake = await fakeApi(t, (req, res) => res.end())
  let upgradeHead
  fake.api.on('upgrade', (req, socket) => {
    upgradeHead = req
    socket.on('end', () => socket.end())
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', (d) => socket.write(`echo:${d.toString()}`))
  })
  const s = await start(t, FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ mode: 'live' })
  const client = net.connect(new URL(s.base).port, '127.0.0.1')
  t.after(() => client.destroy())
  let received = ''
  client.on('data', (d) => { received += d.toString() })
  client.write('GET /ws?room=1 HTTP/1.1\r\nHost: localhost:4010\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\n\r\n')
  await until(() => received.includes('\r\n\r\n'))
  assert.match(received, /^HTTP\/1\.1 101/)
  assert.equal(upgradeHead.url, '/ws?room=1')
  assert.equal(upgradeHead.headers.host, `127.0.0.1:${fake.port}`)
  client.write('frame')
  await until(() => received.includes('echo:frame'))
  client.destroy()
})

test('upgrade outside live mode gets 501 and the socket closes', async (t) => {
  const s = await start(t, FILES)
  const client = net.connect(new URL(s.base).port, '127.0.0.1')
  t.after(() => client.destroy())
  let received = ''
  client.on('data', (d) => { received += d.toString() })
  const closed = new Promise((resolve) => client.on('close', resolve))
  client.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  await closed
  assert.match(received, /^HTTP\/1\.1 501 Not Implemented/)
})

test('a reset upgrade socket does not kill the server', async (t) => {
  const s = await start(t, FILES)
  const client = net.connect(new URL(s.base).port, '127.0.0.1')
  client.on('error', () => {})
  await new Promise((resolve) => client.on('connect', resolve))
  client.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  client.resetAndDestroy()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const r = await fetch(`${s.base}/__runbooks/state`)
  assert.equal(r.status, 200)
})

test('control routes never upgrade', async (t) => {
  const fake = await fakeApi(t, (req, res) => res.end())
  const s = await start(t, FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ mode: 'live' })
  const client = net.connect(new URL(s.base).port, '127.0.0.1')
  t.after(() => client.destroy())
  let received = ''
  client.on('data', (d) => { received += d.toString() })
  const closed = new Promise((resolve) => client.on('close', resolve))
  client.write('GET /__runbooks/state HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  await closed
  assert.match(received, /^HTTP\/1\.1 501 Not Implemented/)
  assert.equal(fake.seen.length, 0)
})

test('a dead target answers 502 and is logged', async (t) => {
  const dead = http.createServer()
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve))
  const port = dead.address().port
  await new Promise((resolve) => dead.close(resolve))
  const target = `http://127.0.0.1:${port}/v1`
  const s = await start(t, FILES, { target })
  await s.select({ mode: 'live' })
  const r = await fetch(`${s.base}/v1/invoices`)
  assert.equal(r.status, 502)
  assert.deepEqual(await r.json(), { error: 'upstream unreachable', target })
  const state = await s.state()
  assert.equal(state.requests[0].status, 502)
  assert.deepEqual(s.logs, ['GET /v1/invoices -> 502'])
})

test('an empty target in live mode answers 502 with an empty target', async (t) => {
  const s = await start(t, FILES)
  await s.select({ mode: 'live' })
  const r = await fetch(`${s.base}/invoices`)
  assert.equal(r.status, 502)
  assert.deepEqual(await r.json(), { error: 'upstream unreachable', target: '' })
})

const RECORD_FILES = { 'billing/list/.keep': '' }

function recordApi(t, handler) {
  return fakeApi(t, handler ?? ((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json', 'set-cookie': 'sid=1', authorization: 'Bearer x', 'x-api-key': 'k', 'x-keep': 'yes',
    })
    res.end('{"items":[1]}')
  }))
}

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, 'billing/list', rel), 'utf8'))
const exists = (root, rel) => fs.existsSync(path.join(root, 'billing/list', rel))

test('record mode saves a first response at runbook level without secret headers', async (t) => {
  const fake = await recordApi(t)
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}/v1`, redactHeaders: ['X-Api-Key'] })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  const r = await fetch(`${s.base}/v1/invoices`, { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { items: [1] })
  assert.equal(fake.seen[0].headers['accept-encoding'], 'identity')
  const saved = readJson(s.fixturesRoot, 'get--v1-invoices.json')
  assert.deepEqual(saved.request, { method: 'GET', path: '/v1/invoices' })
  assert.equal(saved.response.status, 200)
  assert.deepEqual(saved.response.body, { items: [1] })
  assert.deepEqual(Object.keys(saved.response.headers).sort(), ['content-type', 'date', 'x-keep'])
  assert.equal(saved.source, `recorded ${new Date().toISOString().slice(0, 10)} from http://127.0.0.1:${fake.port}`)
  const state = await s.state()
  assert.equal(state.requests[0].status, 200)
  assert.deepEqual(s.logs, ['GET /v1/invoices -> 200'])
})

test('record mode drops access-control and vary headers', async (t) => {
  const fake = await recordApi(t, (req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': 'http://localhost:3000',
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'x-keep',
      vary: 'Origin',
      'x-keep': 'yes',
    })
    res.end('{}')
  })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(Object.keys(readJson(s.fixturesRoot, 'get--invoices.json').response.headers).sort(), ['content-type', 'date', 'x-keep'])
})

test('record mode writes nothing for an identical response and a step file for a different one', async (t) => {
  let body = '{"items":[1]}'
  const fake = await recordApi(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body) })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/invoices`)
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(fs.readdirSync(path.join(s.fixturesRoot, 'billing/list')).sort(), ['.keep', 'get--invoices.json'])
  await s.select({ step: 'S03' })
  await fetch(`${s.base}/invoices`)
  assert.ok(!exists(s.fixturesRoot, 'S03/get--invoices.json'))
  body = '{"items":[2]}'
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, 'S03/get--invoices.json').response.body, { items: [2] })
  assert.deepEqual(readJson(s.fixturesRoot, 'get--invoices.json').response.body, { items: [1] })
})

test('record mode names query files by hash and keeps the query as first values', async (t) => {
  const fake = await recordApi(t)
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/Invoices?page=1&page=2`)
  const name = fs.readdirSync(path.join(s.fixturesRoot, 'billing/list')).find((n) => n.startsWith('get--invoices-'))
  assert.match(name, /^get--invoices-[0-9a-f]{8}\.json$/)
  assert.deepEqual(readJson(s.fixturesRoot, name).request, { method: 'GET', path: '/Invoices', query: { page: '1' } })
})

test('record mode stores text bodies as strings and omits the body of a 204', async (t) => {
  const fake = await recordApi(t, (req, res) => {
    if (req.url === '/gone') { res.writeHead(204); return res.end() }
    if (req.url === '/bad') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{ nope') }
    res.writeHead(200, { 'content-type': 'text/csv' }); res.end('a,b\n1,2\n')
  })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/export`)
  await fetch(`${s.base}/gone`, { method: 'DELETE' })
  await fetch(`${s.base}/bad`)
  assert.equal(readJson(s.fixturesRoot, 'get--export.json').response.body, 'a,b\n1,2\n')
  assert.ok(!('body' in readJson(s.fixturesRoot, 'delete--gone.json').response))
  assert.equal(readJson(s.fixturesRoot, 'get--bad.json').response.body, '{ nope')
})

test('record mode with no runbook proxies and writes nothing; event streams are not recorded', async (t) => {
  const fake = await recordApi(t, (req, res) => {
    if (req.url === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end('data: 1\n\n') }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}')
  })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ mode: 'record' })
  assert.equal((await fetch(`${s.base}/invoices`)).status, 200)
  assert.deepEqual(fs.readdirSync(s.fixturesRoot), ['billing'])
  await s.select({ runbook: 'billing.list' })
  assert.equal(await (await fetch(`${s.base}/events`)).text(), 'data: 1\n\n')
  assert.deepEqual(fs.readdirSync(path.join(s.fixturesRoot, 'billing/list')), ['.keep'])
})

test('record mode keeps serving when a fixture cannot be written', async (t) => {
  const fake = await recordApi(t)
  const files = {
    'billing/list/get--invoices.json': fixture('GET', '/invoices', { status: 200, body: { items: ['old'] } }),
    'billing/list/S03': 'not a folder',
  }
  const s = await start(t, files, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', step: 'S03' })
  const r = await fetch(`${s.base}/invoices`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { items: [1] })
  assert.equal((await fetch(`${s.base}/__runbooks/state`)).status, 200)
  assert.ok(s.logs.some((line) => line.startsWith('could not record GET /invoices')), s.logs.join('\n'))
})

test('matchFixture prefers step and role, then step, then role', () => {
  const f = (file, step, role) => ({ file, step, role, request: { method: 'GET', path: '/me' }, response: { status: 200 } })
  const all = [f('me.json', null, null), f('@viewer/me.json', null, 'viewer'), f('S02/me.json', 'S02', null), f('S02/@viewer/me.json', 'S02', 'viewer')]
  const req = { method: 'GET', path: '/me', query: {} }
  assert.equal(matchFixture(all, req, 'S02', 'viewer').file, 'S02/@viewer/me.json')
  assert.equal(matchFixture(all, req, 'S02', 'admin').file, 'S02/me.json')
  assert.equal(matchFixture(all, req, 'S01', 'viewer').file, '@viewer/me.json')
  assert.equal(matchFixture(all, req, 'S01', 'admin').file, 'me.json')
  assert.equal(matchFixture(all, req, 'S01').file, 'me.json')
})

test('a role without a folder falls back to the runbook fixtures', async (t) => {
  const s = await start(t, {
    'billing/list/me.json': fixture('GET', '/me', { status: 200, body: { who: 'any' } }),
    'billing/list/@admin/me.json': fixture('GET', '/me', { status: 200, body: { who: 'admin' } }),
  })
  await s.select({ runbook: 'billing.list', mode: 'mocked', role: 'viewer', step: 'S01' })
  const r = await fetch(`${s.base}/me`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { who: 'any' })
  assert.deepEqual((await s.state()).unmatched, [])
  await s.select({ role: 'admin' })
  assert.deepEqual(await (await fetch(`${s.base}/me`)).json(), { who: 'admin' })
})

test('select validates role and resets it with a new runbook', async (t) => {
  const s = await start(t, FILES)
  const bad = await s.select({ role: 'Bad Role' })
  assert.equal(bad.status, 400)
  assert.deepEqual(await bad.json(), { error: 'role must be null or a role name like editor' })
  await s.select({ runbook: 'billing.list', role: 'viewer', step: 'S02' })
  assert.deepEqual(await s.state(), { runbook: 'billing.list', mode: 'mocked', role: 'viewer', case: null, step: 'S02', requests: [], unmatched: [] })
  await s.select({ role: 'editor' })
  assert.equal((await s.state()).step, null)
  assert.equal((await s.state()).role, 'editor')
  await s.select({ runbook: 'billing.list' })
  assert.equal((await s.state()).role, null)
})

test('record saves under the selected role', async (t) => {
  let body = '{"items":[1]}'
  const fake = await recordApi(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body) })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', role: 'viewer', step: 'S03' })
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, '@viewer/get--invoices.json').response.body, { items: [1] })
  assert.ok(!exists(s.fixturesRoot, 'get--invoices.json'))
  await fetch(`${s.base}/invoices`)
  assert.ok(!exists(s.fixturesRoot, 'S03/@viewer/get--invoices.json'))
  body = '{"items":[2]}'
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, 'S03/@viewer/get--invoices.json').response.body, { items: [2] })
  await s.select({ step: null })
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, '@viewer/get--invoices.json').response.body, { items: [2] })
})

test('matchFixture prefers step, role and case, and falls back when the case has no folder', () => {
  const f = (file, step, role, kase) => ({ file, step, role, case: kase, request: { method: 'GET', path: '/clients/1' }, response: { status: 200 } })
  const all = [f('root.json', null, null, null), f('+vip.json', null, null, 'vip-team'), f('@m.json', null, 'manager', null),
    f('@m+vip.json', null, 'manager', 'vip-team'), f('S02.json', 'S02', null, null), f('S02+vip.json', 'S02', null, 'vip-team'),
    f('S02@m.json', 'S02', 'manager', null), f('S02@m+vip.json', 'S02', 'manager', 'vip-team')]
  const req = { method: 'GET', path: '/clients/1' }
  assert.equal(matchFixture(all, req, 'S02', 'manager', 'vip-team').file, 'S02@m+vip.json')
  assert.equal(matchFixture(all.filter((x) => x.file !== 'S02@m+vip.json'), req, 'S02', 'manager', 'vip-team').file, 'S02@m.json')
  assert.equal(matchFixture(all.filter((x) => !x.step), req, 'S02', 'manager', 'vip-team').file, '@m+vip.json')
  assert.equal(matchFixture(all, req, 'S02', 'manager', 'regular').file, 'S02@m.json')
  assert.equal(matchFixture(all, req, null, null, 'regular').file, 'root.json')
})

const CASE_FILES = {
  'clients/view/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'root' } }),
  'clients/view/+vip-team/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'case' } }),
  'clients/view/@manager/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'role' } }),
  'clients/view/@manager/+vip-team/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'role+case' } }),
  'clients/view/S02/+vip-team/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'step+case' } }),
  'clients/view/S03/@manager/+vip-team/client.json': fixture('GET', '/clients/1', { status: 200, body: { who: 'step+role+case' } }),
}

test('the case layer serves +<case> folders at the four levels', async (t) => {
  const s = await start(t, CASE_FILES)
  const who = async () => (await (await fetch(`${s.base}/clients/1`)).json()).who
  await s.select({ runbook: 'clients.view', role: 'manager', case: 'vip-team' })
  assert.equal(await who(), 'role+case')
  await s.select({ step: 'S02' })
  assert.equal(await who(), 'step+case')
  await s.select({ role: 'manager', case: 'vip-team', step: 'S03' })
  assert.equal(await who(), 'step+role+case')
  await s.select({ role: null, case: 'vip-team', step: 'S02' })
  assert.equal(await who(), 'step+case')
  await s.select({ case: 'vip-team' })
  assert.equal(await who(), 'case')
  await s.select({ case: null })
  assert.equal(await who(), 'root')
})

test('a case without a folder serves the role fixture, not 501', async (t) => {
  const s = await start(t, CASE_FILES)
  await s.select({ runbook: 'clients.view', role: 'manager', case: 'gold' })
  const r = await fetch(`${s.base}/clients/1`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { who: 'role' })
})

test('select validates case, and resets follow runbook, role and case', async (t) => {
  const s = await start(t, CASE_FILES)
  const bad = await s.select({ case: 'Bad!' })
  assert.equal(bad.status, 400)
  assert.deepEqual(await bad.json(), { error: 'case must be null or a case name like vip-team' })
  await s.select({ runbook: 'clients.view', role: 'manager', case: 'vip-team', step: 'S02' })
  assert.deepEqual(await s.state(), { runbook: 'clients.view', mode: 'mocked', role: 'manager', case: 'vip-team', step: 'S02', requests: [], unmatched: [] })
  await s.select({ case: 'regular' })
  const afterCase = await s.state()
  assert.equal(afterCase.case, 'regular')
  assert.equal(afterCase.step, null)
  assert.equal(afterCase.role, 'manager')
  await s.select({ case: 'vip-team', step: 'S02' })
  await s.select({ role: 'admin' })
  const afterRole = await s.state()
  assert.equal(afterRole.case, null)
  assert.equal(afterRole.step, null)
  await s.select({ case: 'vip-team' })
  await s.select({ runbook: 'clients.view' })
  assert.equal((await s.state()).case, null)
  assert.equal((await s.state()).role, null)
})

test('select clears the request log', async (t) => {
  const s = await start(t, CASE_FILES)
  await s.select({ runbook: 'clients.view' })
  await fetch(`${s.base}/clients/1`)
  assert.equal((await s.state()).requests.length, 1)
  await s.select({ case: 'vip-team' })
  assert.deepEqual((await s.state()).requests, [])
})

test('record saves under the selected role and case', async (t) => {
  const fake = await recordApi(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"items":[1]}') })
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', role: 'viewer', case: 'vip-team', step: 'S03' })
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, '@viewer/+vip-team/get--invoices.json').response.body, { items: [1] })
  await s.select({ role: null, case: 'regular' })
  await fetch(`${s.base}/invoices`)
  assert.deepEqual(readJson(s.fixturesRoot, '+regular/get--invoices.json').response.body, { items: [1] })
})

test('matchFixture prefers a fixture naming the operation in its folder, and a request without one skips such fixtures', () => {
  const f = (file, step, operationName, query) =>
    ({ file, step, request: { method: 'POST', path: '/graphql', ...(operationName ? { operationName } : {}), ...(query ? { query } : {}) }, response: { status: 200 } })
  const any = f('any.json', null)
  const groups = f('groups.json', null, 'GroupsByPartyId')
  const client = f('client.json', null, 'Client')
  const req = { method: 'POST', path: '/graphql', query: { v: '1' } }
  assert.equal(matchFixture([any, groups, client], { ...req, operationName: 'GroupsByPartyId' }, null), groups)
  assert.equal(matchFixture([any, groups, client], { ...req, operationName: 'Client' }, null), client)
  assert.equal(matchFixture([any, groups, client], { ...req, operationName: 'Other' }, null), any)
  assert.equal(matchFixture([groups, client], { ...req, operationName: 'Other' }, null), null)
  assert.equal(matchFixture([groups, client], req, null), null)
  assert.equal(matchFixture([f('keyed.json', null, null, { v: '1' }), groups], { ...req, operationName: 'GroupsByPartyId' }, null), groups)
  assert.equal(matchFixture([groups, f('S02/any.json', 'S02')], { ...req, operationName: 'GroupsByPartyId' }, 'S02').file, 'S02/any.json')
})

const gqlFixture = (operationName, response) =>
  JSON.stringify({ request: { method: 'POST', path: '/graphql', operationName }, response, source: 'hand-written: test' })

const GQL_FILES = {
  'clients/edit/groups.json': gqlFixture('GroupsByPartyId', { status: 200, headers: { 'x-shared': 'groups' }, body: { data: { groupsByPartyId: [] } } }),
  'clients/edit/client.json': gqlFixture('Client', { status: 200, headers: { 'X-Shared': 'client', 'x-from': 'client' }, body: { data: { client: { id: 1 } } } }),
  'clients/edit/S02/client.json': gqlFixture('Client', { status: 500, headers: { 'content-type': 'text/plain' }, body: 'boom' }),
  'clients/edit/S03/client.json': gqlFixture('Client', { status: 200, body: 'not json' }),
}

const gql = (base, body) => fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const searchFixture = (variables, items) => JSON.stringify({
  request: { method: 'POST', path: '/graphql', operationName: 'SearchClients', variables },
  response: { status: 200, body: { data: { searchClients: items } } },
  source: 'hand-written: test',
})

const TAB_FILES = {
  'clients/tabs/clients.json': searchFixture({ type: 'clients' }, ['client']),
  'clients/tabs/contacts.json': searchFixture({ type: 'contacts' }, ['contact']),
  'clients/tabs/search.json': searchFixture({ search: 'Fred' }, ['fred']),
}

test('three tabs sending SearchClients with different variables each get their own fixture', async (t) => {
  const s = await start(t, TAB_FILES)
  await s.select({ runbook: 'clients.tabs', step: 'S01' })
  const items = async (body) => (await (await gql(s.base, body)).json())
  assert.deepEqual(await items({ operationName: 'SearchClients', variables: { type: 'clients' } }), { data: { searchClients: ['client'] } })
  assert.deepEqual(await items({ operationName: 'SearchClients', variables: { type: 'contacts' } }), { data: { searchClients: ['contact'] } })
  await s.select({ step: 'S02' })
  assert.deepEqual(await items({ operationName: 'SearchClients', variables: { type: null, search: 'Fred' } }), { data: { searchClients: ['fred'] } })
  assert.equal((await gql(s.base, { operationName: 'SearchClients' })).status, 501)
  assert.equal((await gql(s.base, { operationName: 'SearchClients', variables: null })).status, 501)
})

test('a batch answers two SearchClients items from their variables', async (t) => {
  const s = await start(t, TAB_FILES)
  await s.select({ runbook: 'clients.tabs' })
  const r = await gql(s.base, [
    { operationName: 'SearchClients', variables: { type: 'contacts' } },
    { operationName: 'SearchClients', variables: { type: 'clients' } },
  ])
  assert.deepEqual(await r.json(), [{ data: { searchClients: ['contact'] } }, { data: { searchClients: ['client'] } }])
})

test('a REST body fixture answers only a JSON body that carries its values', async (t) => {
  const s = await start(t, {
    'billing/list/any.json': fixture('POST', '/search', { status: 200, body: { any: true } }),
    'billing/list/contacts.json': JSON.stringify({ request: { method: 'POST', path: '/search', body: { type: 'contacts' } }, response: { status: 200, body: { contacts: true } } }),
  })
  await s.select({ runbook: 'billing.list' })
  const post = (body, type = 'application/json') => fetch(`${s.base}/search`, { method: 'POST', headers: { 'content-type': type }, body })
  assert.deepEqual(await (await post('{"type":"contacts","q":"a"}')).json(), { contacts: true })
  assert.deepEqual(await (await post('{"type":"clients"}')).json(), { any: true })
  assert.deepEqual(await (await post('{"type":"contacts"}', 'text/plain')).json(), { any: true })
})

test('the server skips fixtures with invalid variables or body', async (t) => {
  const bad = (request) => JSON.stringify({ request: { method: 'POST', path: '/graphql', ...request }, response: { status: 200, body: { bad: true } } })
  const s = await start(t, {
    'clients/tabs/array.json': bad({ operationName: 'SearchClients', variables: ['clients'] }),
    'clients/tabs/orphan.json': bad({ variables: { type: 'clients' } }),
    'clients/tabs/mixed.json': bad({ operationName: 'SearchClients', body: { type: 'clients' } }),
  })
  await s.select({ runbook: 'clients.tabs' })
  assert.equal((await gql(s.base, { operationName: 'SearchClients', variables: { type: 'clients' } })).status, 501)
})

test('payloadMatches matches objects by subset and everything else exactly', () => {
  assert.equal(payloadMatches({ type: 'clients' }, { type: 'clients', page: 1 }), true)
  assert.equal(payloadMatches({ filter: { type: 'x' } }, { filter: { type: 'x', q: 'a' } }), true)
  assert.equal(payloadMatches({ ids: [1, 2] }, { ids: [1, 2, 3] }), false)
  assert.equal(payloadMatches({ ids: [1, 2] }, { ids: [1, 2] }), true)
  assert.equal(payloadMatches({ type: null }, {}), false)
  assert.equal(payloadMatches({ type: null }, { type: null }), true)
  assert.equal(payloadMatches({}, { anything: 1 }), true)
  assert.equal(payloadMatches({ filter: { type: 'x' } }, { filter: null }), false)
  assert.equal(payloadMatches({ filter: { type: 'x' } }, { filter: ['x'] }), false)
  assert.equal(payloadMatches({ filter: { type: 'x' } }, { filter: 'x' }), false)
})

test('payloadFields counts leaves, an array as one', () => {
  assert.equal(payloadFields({}), 0)
  assert.equal(payloadFields({ filter: { type: 'clients' }, ids: [1, 2] }), 2)
  assert.equal(payloadFields([{ a: 1 }]), 1)
})

test('matchFixture picks the fixture whose variables match, more fields first, folder layer before fields', () => {
  const f = (file, step, variables) =>
    ({ file, step, request: { method: 'POST', path: '/graphql', operationName: 'SearchClients', ...(variables ? { variables } : {}) }, response: { status: 200 } })
  const any = f('any.json', null)
  const clients = f('clients.json', null, { type: 'clients' })
  const contacts = f('contacts.json', null, { type: 'contacts' })
  const search = f('search.json', null, { search: 'Fred' })
  const both = f('both.json', null, { type: 'clients', page: 1 })
  const req = (variables) => ({ method: 'POST', path: '/graphql', query: {}, operationName: 'SearchClients', variables })
  const all = [any, clients, contacts, search]
  assert.equal(matchFixture(all, req({ type: 'clients' }), null), clients)
  assert.equal(matchFixture(all, req({ type: 'contacts' }), null), contacts)
  assert.equal(matchFixture(all, req({ type: null, search: 'Fred' }), null), search)
  assert.equal(matchFixture(all, req({ type: 'other' }), null), any)
  assert.equal(matchFixture([clients, both], req({ type: 'clients', page: 1 }), null), both)
  assert.equal(matchFixture([clients], req({}), null), null)
  assert.equal(matchFixture([clients, f('S02/any.json', 'S02')], req({ type: 'clients' }), 'S02').file, 'S02/any.json')
})

test('matchFixture matches a REST body only against a JSON body', () => {
  const f = (file, body) => ({ file, step: null, request: { method: 'POST', path: '/search', ...(body !== undefined ? { body } : {}) }, response: { status: 200 } })
  const plain = f('plain.json')
  const contacts = f('contacts.json', { type: 'contacts' })
  const req = (body) => ({ method: 'POST', path: '/search', query: {}, body })
  assert.equal(matchFixture([plain, contacts], req({ type: 'contacts', q: 'a' }), null), contacts)
  assert.equal(matchFixture([plain, contacts], req({ type: 'clients' }), null), plain)
  assert.equal(matchFixture([contacts], req(undefined), null), null)
})

test('a fixture with operationName answers only that operation and the 501 names an unknown one', async (t) => {
  const s = await start(t, GQL_FILES)
  await s.select({ runbook: 'clients.edit' })
  const groups = await gql(s.base, { operationName: 'GroupsByPartyId', query: 'query GroupsByPartyId { x }' })
  assert.equal(groups.status, 200)
  assert.deepEqual(await groups.json(), { data: { groupsByPartyId: [] } })
  assert.deepEqual(await (await gql(s.base, { operationName: 'Client' })).json(), { data: { client: { id: 1 } } })
  const other = await gql(s.base, { operationName: 'Other' })
  assert.equal(other.status, 501)
  assert.deepEqual(await other.json(), { error: 'no fixture', method: 'POST', path: '/graphql', operationName: 'Other', runbook: 'clients.edit', step: null })
  const none = await fetch(`${s.base}/graphql`, { method: 'POST', body: '{"operationName":"Client"}' })
  assert.equal(none.status, 501)
  assert.deepEqual(await none.json(), { error: 'no fixture', method: 'POST', path: '/graphql', runbook: 'clients.edit', step: null })
  const state = await s.state()
  assert.deepEqual(state.unmatched, [{ method: 'POST', path: '/graphql', operationName: 'Other', step: null }, { method: 'POST', path: '/graphql', step: null }])
  assert.deepEqual(state.requests[0].body, { operationName: 'GroupsByPartyId', query: 'query GroupsByPartyId { x }' })
})

test('a fixture without operationName answers any body and loses to one naming the operation', async (t) => {
  const s = await start(t, {
    ...GQL_FILES,
    'clients/edit/any.json': fixture('POST', '/graphql', { status: 200, body: { any: true } }),
    'clients/edit/blank.json': JSON.stringify({ request: { method: 'POST', path: '/graphql', operationName: '' }, response: { status: 200, body: { blank: true } } }),
  })
  await s.select({ runbook: 'clients.edit' })
  assert.deepEqual(await (await gql(s.base, { operationName: 'Other' })).json(), { any: true })
  assert.deepEqual(await (await gql(s.base, { query: '{ x }' })).json(), { any: true })
  assert.deepEqual(await (await fetch(`${s.base}/graphql`, { method: 'POST' })).json(), { any: true })
  assert.deepEqual(await (await gql(s.base, { operationName: 'GroupsByPartyId' })).json(), { data: { groupsByPartyId: [] } })
})

test('a batch is answered item by item with merged headers', async (t) => {
  const s = await start(t, GQL_FILES)
  await s.select({ runbook: 'clients.edit' })
  const r = await gql(s.base, [{ operationName: 'GroupsByPartyId' }, { operationName: 'Client' }])
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/json')
  assert.equal(r.headers.get('x-shared'), 'groups')
  assert.equal(r.headers.get('x-from'), 'client')
  assert.deepEqual(await r.json(), [{ data: { groupsByPartyId: [] } }, { data: { client: { id: 1 } } }])
  assert.equal((await s.state()).requests[0].status, 200)
})

test('a batch item without a fixture makes the whole batch a 501 that lists the missing operations', async (t) => {
  const s = await start(t, GQL_FILES)
  await s.select({ runbook: 'clients.edit', step: 'S01' })
  const r = await gql(s.base, [{ operationName: 'GroupsByPartyId' }, { operationName: 'Other' }, { query: '{ x }' }])
  assert.equal(r.status, 501)
  assert.deepEqual(await r.json(), { error: 'no fixture', method: 'POST', path: '/graphql', operationNames: ['Other', null], runbook: 'clients.edit', step: 'S01' })
  assert.deepEqual((await s.state()).unmatched, [
    { method: 'POST', path: '/graphql', operationName: 'Other', step: 'S01' },
    { method: 'POST', path: '/graphql', operationName: null, step: 'S01' },
  ])
})

test('a batch item whose fixture fails answers the whole batch, unless another item has no fixture', async (t) => {
  const s = await start(t, GQL_FILES)
  await s.select({ runbook: 'clients.edit', step: 'S02' })
  const r = await gql(s.base, [{ operationName: 'GroupsByPartyId' }, { operationName: 'Client' }])
  assert.equal(r.status, 500)
  assert.equal(r.headers.get('content-type'), 'text/plain')
  assert.equal(await r.text(), 'boom')
  assert.equal((await gql(s.base, [{ operationName: 'Client' }, { operationName: 'Other' }])).status, 501)
})

test('a batch item whose 2xx fixture has no JSON body gets a 500 naming the file', async (t) => {
  const s = await start(t, GQL_FILES)
  await s.select({ runbook: 'clients.edit', step: 'S03' })
  const r = await gql(s.base, [{ operationName: 'Client' }])
  assert.equal(r.status, 500)
  assert.deepEqual(await r.json(), { error: 'S03/client.json answers an item of a batch, so its response needs a JSON body' })
  const single = await gql(s.base, { operationName: 'Client' })
  assert.equal(single.status, 200)
  assert.equal(await single.text(), 'not json')
})

test('an array body with no operation fixture matches as a whole, as before', async (t) => {
  const s = await start(t, { ...GQL_FILES, 'clients/edit/bulk.json': fixture('POST', '/graphql', { status: 200, body: [{ whole: true }] }) })
  await s.select({ runbook: 'clients.edit' })
  assert.deepEqual(await (await gql(s.base, [{ operationName: 'Other' }])).json(), [{ whole: true }])
  assert.deepEqual(await (await gql(s.base, [])).json(), [{ whole: true }])
  assert.deepEqual(await (await gql(s.base, [{ a: 1 }])).json(), [{ whole: true }])
})

// A fake GraphQL API: answer(sent) gives [status, body] for the parsed request body.
async function graphqlApi(t, answer) {
  let api = null
  api = await fakeApi(t, (req, res) => {
    const [status, body] = answer(JSON.parse(api.seen.at(-1).body))
    res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': 'sid=1', 'x-keep': 'yes' })
    res.end(JSON.stringify(body))
  })
  return api
}

const RESULTS = { GroupsByPartyId: { data: { groupsByPartyId: [] } }, Client: { data: { client: { id: 1 } } } }
const result = (item) => RESULTS[item.operationName] ?? { data: null }
const listed = (root) => fs.readdirSync(path.join(root, 'billing/list'), { recursive: true }).filter((name) => name.endsWith('.json')).sort()

test('record names each operation in its file and request, and a second recording writes nothing', async (t) => {
  const fake = await graphqlApi(t, (sent) => [200, Array.isArray(sent) ? sent.map(result) : result(sent)])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  for (let pass = 0; pass < 2; pass++) {
    await gql(s.base, { operationName: 'GroupsByPartyId' })
    await gql(s.base, { operationName: 'Client' })
  }
  assert.deepEqual(listed(s.fixturesRoot), ['post--graphql-Client.json', 'post--graphql-GroupsByPartyId.json'])
  const saved = readJson(s.fixturesRoot, 'post--graphql-GroupsByPartyId.json')
  assert.deepEqual(saved.request, { method: 'POST', path: '/graphql', operationName: 'GroupsByPartyId' })
  assert.deepEqual(saved.response.body, RESULTS.GroupsByPartyId)
  await s.select({ step: 'S02' })
  await gql(s.base, [{ operationName: 'GroupsByPartyId' }, { operationName: 'Client' }])
  assert.deepEqual(listed(s.fixturesRoot), ['post--graphql-Client.json', 'post--graphql-GroupsByPartyId.json'])
  assert.ok(!s.logs.some((line) => line.startsWith('overwrote')))
})

test('record saves a batch item by item with the batch headers', async (t) => {
  const fake = await graphqlApi(t, (sent) => [200, sent.map(result)])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  const r = await gql(s.base, [{ operationName: 'GroupsByPartyId' }, { operationName: 'Client' }, { query: '{ x }' }])
  assert.deepEqual(await r.json(), [RESULTS.GroupsByPartyId, RESULTS.Client, { data: null }])
  assert.deepEqual(listed(s.fixturesRoot), ['post--graphql-Client.json', 'post--graphql-GroupsByPartyId.json'])
  const client = readJson(s.fixturesRoot, 'post--graphql-Client.json')
  assert.deepEqual(client.request, { method: 'POST', path: '/graphql', operationName: 'Client' })
  assert.deepEqual(client.response.body, RESULTS.Client)
  assert.deepEqual(Object.keys(client.response.headers).sort(), ['content-type', 'date', 'x-keep'])
  assert.ok(s.logs.includes('not recording item 3 of POST /graphql (GroupsByPartyId, Client, unnamed): it has no operationName'))
})

test('record writes nothing for a failed batch or a response that is not one result per item', async (t) => {
  let reply = [500, { errors: [{ message: 'down' }] }]
  const fake = await graphqlApi(t, () => reply)
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  const batch = [{ operationName: 'GroupsByPartyId' }, { operationName: 'Client' }]
  assert.equal((await gql(s.base, batch)).status, 500)
  reply = [200, [RESULTS.Client]]
  await gql(s.base, batch)
  reply = [200, { data: {} }]
  await gql(s.base, batch)
  assert.deepEqual(listed(s.fixturesRoot), [])
  assert.ok(s.logs.includes("not recording POST /graphql (GroupsByPartyId, Client): the batch answered 500; write the failing operation's fixture by hand"))
  assert.equal(s.logs.filter((line) => line === 'not recording POST /graphql (GroupsByPartyId, Client): the response is not an array of 2 results').length, 2)
})

test('record puts an operation in the runbook folder when only a fixture without operationName answers it', async (t) => {
  const fake = await graphqlApi(t, (sent) => [200, result(sent)])
  const s = await start(t, { ...RECORD_FILES, 'billing/list/any.json': fixture('POST', '/graphql', { status: 200, body: { any: true } }) },
    { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', step: 'S02' })
  await gql(s.base, { operationName: 'Client' })
  assert.deepEqual(listed(s.fixturesRoot), ['any.json', 'post--graphql-Client.json'])
})

test('record keeps an array body without operations as one request, and logs an overwritten operation', async (t) => {
  let n = 0
  const fake = await graphqlApi(t, (sent) => [200, Array.isArray(sent) && sent[0]?.operationName ? sent.map(() => ({ n: ++n })) : { bulk: true }])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/bulk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[{"a":1}]' })
  const bulk = listed(s.fixturesRoot).filter((name) => name.startsWith('post--bulk-'))
  assert.equal(bulk.length, 1)
  assert.match(bulk[0], /^post--bulk-[0-9a-f]{8}\.json$/)
  assert.deepEqual(readJson(s.fixturesRoot, bulk[0]).request, { method: 'POST', path: '/bulk', body: [{ a: 1 }] })
  await gql(s.base, [{ operationName: 'Client' }, { operationName: 'Client' }])
  assert.deepEqual(readJson(s.fixturesRoot, 'post--graphql-Client.json').response.body, { n: 2 })
  assert.ok(s.logs.includes('overwrote post--graphql-Client.json with a different response'))
})

test('redactPayload drops secret keys at any depth, case ignored', () => {
  const names = [...['password', 'token', 'secret'], 'otp']
  assert.deepEqual(
    redactPayload({ email: 'a', Password: 'x', input: { accessToken: 't', otp: '1', keep: 1 }, users: [{ password: 'y', name: 'b' }] }, names),
    { email: 'a', input: { keep: 1 }, users: [{ name: 'b' }] })
  assert.equal(redactPayload('plain', names), 'plain')
})

test('a 501 shows the payload of the unmatched request without secrets', async (t) => {
  const s = await start(t, TAB_FILES, { redactBodyKeys: ['OTP'] })
  await s.select({ runbook: 'clients.tabs' })
  const r = await gql(s.base, { operationName: 'SearchClients', variables: { type: 'other', token: 't', otp: '1' } })
  assert.deepEqual(await r.json(), { error: 'no fixture', method: 'POST', path: '/graphql', operationName: 'SearchClients', variables: { type: 'other' }, runbook: 'clients.tabs', step: null })
  const batch = await gql(s.base, [{ operationName: 'SearchClients', variables: { type: 'clients' } }, { operationName: 'SearchClients', variables: { type: 'x' } }, { operationName: 'Other' }])
  const body = await batch.json()
  assert.deepEqual(body.operationNames, ['SearchClients', 'Other'])
  assert.deepEqual(body.variables, [{ type: 'x' }, null])
  const state = await s.state()
  assert.deepEqual(state.unmatched[0], { method: 'POST', path: '/graphql', operationName: 'SearchClients', variables: { type: 'other' }, step: null })
  assert.deepEqual(state.unmatched[2], { method: 'POST', path: '/graphql', operationName: 'Other', step: null })
})

test('record saves each SearchClients variables in its own file, and a second pass writes nothing', async (t) => {
  const tab = (item) => ({ data: { searchClients: [item.variables?.type ?? 'none'] } })
  const fake = await graphqlApi(t, (sent) => [200, Array.isArray(sent) ? sent.map(tab) : tab(sent)])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', step: 'S01' })
  for (let pass = 0; pass < 2; pass++) {
    await gql(s.base, [
      { operationName: 'SearchClients', variables: { type: 'clients', page: 1 } },
      { operationName: 'SearchClients', variables: { page: 1, type: 'contacts' } },
    ])
  }
  await gql(s.base, { operationName: 'SearchClients', variables: { page: 1, type: 'clients' } })
  const names = listed(s.fixturesRoot)
  assert.equal(names.length, 2)
  for (const name of names) assert.match(name, /^post--graphql-SearchClients-[0-9a-f]{8}\.json$/)
  const saved = names.map((name) => readJson(s.fixturesRoot, name).request.variables.type).sort()
  assert.deepEqual(saved, ['clients', 'contacts'])
  assert.ok(!s.logs.some((line) => line.startsWith('overwrote')))
})

test('record puts a payload fixture in the runbook folder over an old fixture without variables', async (t) => {
  const fake = await graphqlApi(t, () => [200, { data: { searchClients: ['client'] } }])
  const s = await start(t, { ...RECORD_FILES, 'billing/list/post--graphql-SearchClients.json': searchFixture(undefined, ['client']) },
    { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record', step: 'S02' })
  await gql(s.base, { operationName: 'SearchClients', variables: { type: 'clients' } })
  const names = listed(s.fixturesRoot)
  assert.equal(names.length, 2)
  assert.ok(names.every((name) => !name.startsWith('S02')))
})

test('record drops secrets from saved bodies and variables', async (t) => {
  const fake = await graphqlApi(t, () => [200, { ok: true }])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}`, redactBodyKeys: ['otp'] })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await fetch(`${s.base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.c","password":"x","otp":"1"}' })
  await gql(s.base, { operationName: 'Login', variables: { input: { email: 'a@b.c', accessToken: 't' } } })
  await gql(s.base, { operationName: 'Refresh', variables: { refreshToken: 't' } })
  const requests = listed(s.fixturesRoot).map((name) => readJson(s.fixturesRoot, name).request)
  assert.deepEqual(requests.find((r) => r.path === '/login').body, { email: 'a@b.c' })
  assert.deepEqual(requests.find((r) => r.operationName === 'Login').variables, { input: { email: 'a@b.c' } })
  assert.equal('variables' in requests.find((r) => r.operationName === 'Refresh'), false)
})

test('record saves REST bodies that carry a query field, one file each', async (t) => {
  const fake = await graphqlApi(t, () => [200, { ok: true }])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  for (const query of ['foo', 'bar']) {
    await fetch(`${s.base}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
  }
  const bodies = listed(s.fixturesRoot).filter((name) => name.startsWith('post--search-')).map((name) => readJson(s.fixturesRoot, name).request.body)
  assert.deepEqual(bodies.sort((a, b) => a.query.localeCompare(b.query)), [{ query: 'bar' }, { query: 'foo' }])
})

test('record saves an anonymous GraphQL operation without a body', async (t) => {
  const fake = await graphqlApi(t, () => [200, { data: {} }])
  const s = await start(t, RECORD_FILES, { target: `http://127.0.0.1:${fake.port}` })
  await s.select({ runbook: 'billing.list', mode: 'record' })
  await gql(s.base, { query: '{ x }' })
  await gql(s.base, { query: '  query Foo { x }' })
  const requests = listed(s.fixturesRoot).filter((name) => name.startsWith('post--graphql')).map((name) => readJson(s.fixturesRoot, name).request)
  assert.ok(requests.length >= 1)
  assert.ok(requests.every((request) => !('body' in request)))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
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
  assert.deepEqual(await cleared.json(), { runbook: null, mode: 'mocked', step: null })
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

import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createUiServer } from './ui-server.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const ROLES = fileURLToPath(new URL('./__fixtures__/roles', import.meta.url))
const CONFIG = 'docs/runbooks/runbooks.config.json'
const API = { 'x-runbooks': '1' }
// The API answers only requests with the x-runbooks header, as the page sends.
const get = (url, init = {}) => fetch(url, { ...init, headers: { ...API, ...init.headers } })

// The config reads endpoints from the sibling ../api, so the temp dir holds both.
async function start(t, { fixture, ...rest } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-'))
  const root = path.join(tmp, 'project')
  fs.cpSync(fixture ?? FIXTURE, root, { recursive: true })
  fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
  const server = createUiServer({ root, today: () => '2026-10-20', html: () => '<!doctype html><title>ui</title>', ...rest })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(resolve)
    fs.rmSync(tmp, { recursive: true, force: true })
  }))
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, root }
}

test('/ serves the page as HTML', async (t) => {
  const { base } = await start(t)
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(await res.text(), /<title>ui<\/title>/)
})

test('/ answers 500 with an error when the page cannot be read', async (t) => {
  const { base } = await start(t, { html: () => fs.readFileSync('/nonexistent/ui.html', 'utf8') })
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /ui\.html/)
  assert.equal((await get(`${base}/api/runbooks`)).status, 200)
})

test('/api/runbooks lists the capabilities with their problems', async (t) => {
  const { base } = await start(t)
  const res = await get(`${base}/api/runbooks`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const body = await res.json()
  const billing = JSON.stringify(body)
  assert.match(billing, /"billing"/)
  const found = []
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if (v.capability === 'billing' || v.name === 'billing') found.push(v)
      Object.values(v).forEach(walk)
    }
  }
  walk(body)
  assert.ok(found.some((c) => c.problems === 2), 'billing has problems: 2')
})

test('/api/runbook/<id> answers 200 for a known id and 404 for an unknown one', async (t) => {
  const { base } = await start(t)
  assert.equal((await get(`${base}/api/runbook/billing.issue-invoice`)).status, 200)
  const missing = await get(`${base}/api/runbook/nope`)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: 'not found' })
  assert.equal((await get(`${base}/api/runbook/billing.issue-invoice/runs`)).status, 200)
  assert.equal((await get(`${base}/api/runbook/nope/runs`)).status, 404)
})

test('/api/runs/<name> serves a report and rejects any other name', async (t) => {
  const { base } = await start(t)
  assert.equal((await get(`${base}/api/runs/2026-10-01-0900-billing.issue-invoice.md`)).status, 200)
  assert.equal((await get(`${base}/api/runs/..%2Frunbooks.config.json`)).status, 404)
  assert.equal((await get(`${base}/api/runs/2026-10-01-0900-billing.nope.md`)).status, 404)
})

test('a malformed escape answers 404 and the server keeps running', async (t) => {
  const { base } = await start(t)
  assert.equal((await get(`${base}/api/runs/%E0%A4%A`)).status, 404)
  assert.equal((await get(`${base}/api/runbooks`)).status, 200)
})

test('/api/coverage takes an optional slice', async (t) => {
  const { base } = await start(t)
  assert.equal((await get(`${base}/api/coverage`)).status, 200)
  const res = await get(`${base}/api/coverage?slice=billing`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).scope, 'billing')
})

test('/api/coverage takes the path, feature and capability filters', async (t) => {
  const { base } = await start(t)
  const res = await get(`${base}/api/coverage?path=${encodeURIComponent('src/**')}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.scope, 'path src/**')
  assert.equal(body.result.entries.total, 6)
  assert.equal((await (await get(`${base}/api/coverage?feature=invoices`)).json()).scope, 'feature invoices')
  assert.equal((await (await get(`${base}/api/coverage?capability=billing`)).json()).scope, 'capability billing')
})

// fetch cannot set Host, so this uses node:http.
function request(port, { method = 'GET', pathname = '/api/runbooks', host }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { ...API, ...(host && { host }) } }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('a foreign Host gets 403 and no CORS header', async (t) => {
  const { port } = await start(t)
  const res = await request(port, { host: 'evil.test' })
  assert.equal(res.status, 403)
  assert.deepEqual(JSON.parse(res.body), { error: 'forbidden host' })
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  const ok = await request(port, { host: `localhost:${port}` })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['access-control-allow-origin'], undefined)
})

test('an API request without the x-runbooks header gets 403; the page needs none', async (t) => {
  const { base, root } = await start(t)
  fs.writeFileSync(path.join(root, CONFIG), JSON.stringify({
    ...JSON.parse(fs.readFileSync(path.join(root, CONFIG), 'utf8')),
    requirements: [{ extractor: 'command', command: 'echo ran > ran.txt; echo "[]"' }],
  }))
  for (const route of ['/api/runbooks', '/api/coverage', '/api/runbook/billing.issue-invoice', '/api/nothing']) {
    const res = await fetch(`${base}${route}`)
    assert.equal(res.status, 403, route)
    assert.deepEqual(await res.json(), { error: 'missing x-runbooks header' })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  }
  assert.equal((await fetch(`${base}/api/coverage`, { headers: { 'x-runbooks': '0' } })).status, 403)
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), false)
  assert.equal((await fetch(`${base}/`)).status, 200)
  assert.equal((await fetch(`${base}/api/runbooks`, { method: 'OPTIONS' })).status, 405)
})

test('other methods get 405 and other paths 404', async (t) => {
  const { base } = await start(t)
  assert.equal((await get(`${base}/api/runbooks`, { method: 'POST' })).status, 405)
  const res = await get(`${base}/api/nothing`)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'not found' })
})

test('a new runbook file shows on the next request', async (t) => {
  const { base, root } = await start(t)
  const before = await (await get(`${base}/api/runbooks`)).text()
  assert.doesNotMatch(before, /billing\.brand-new/)
  fs.writeFileSync(path.join(root, 'docs/runbooks/billing/brand-new.md'), '---\nid: billing.brand-new\ncapability: billing\nstatus: active\n---\n# Brand new\n')
  const after = await (await get(`${base}/api/runbooks`)).text()
  assert.match(after, /billing\.brand-new/)
})

test('a broken config answers 500 naming the problem', async (t) => {
  const { base, root } = await start(t)
  fs.writeFileSync(path.join(root, CONFIG), JSON.stringify({ version: 2 }))
  const res = await get(`${base}/api/runbooks`)
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /version/)
})

test('/api/roles and /api/role/<name> serve the registry', async (t) => {
  const { base } = await start(t, { fixture: ROLES })
  const roles = await get(`${base}/api/roles`)
  assert.equal(roles.status, 200)
  assert.equal((await roles.json()).enabled, true)
  const manager = await get(`${base}/api/role/manager`)
  assert.equal(manager.status, 200)
  assert.equal((await manager.json()).name, 'manager')
  assert.equal((await get(`${base}/api/role/ghost`)).status, 404)
  assert.equal((await get(`${base}/api/role/constructor`)).status, 404)
  const coverage = await (await get(`${base}/api/coverage?role=viewer`)).json()
  assert.deepEqual(coverage.result.roles.map((r) => r.role), ['viewer'])
})

test('/api/roles answers enabled false without role tracking', async (t) => {
  const { base } = await start(t)
  assert.deepEqual(await (await get(`${base}/api/roles`)).json(), { enabled: false })
  assert.equal((await get(`${base}/api/role/manager`)).status, 404)
})

test('the real page has a Case column in the runbook grid and lists contexts', () => {
  const html = fs.readFileSync(fileURLToPath(new URL('../templates/ui.html', import.meta.url)), 'utf8')
  assert.match(html, /'Case'/)
  assert.match(html, /Contexts/)
})

test('/api/roles and /api/runbook serve the cases of a context', async (t) => {
  const { base } = await start(t, { fixture: fileURLToPath(new URL('./__fixtures__/contexts', import.meta.url)) })
  const roles = await (await get(`${base}/api/roles`)).json()
  assert.equal(roles.contexts[0].name, 'client-access')
  const runbook = await (await get(`${base}/api/runbook/clients.edit-client`)).json()
  assert.equal(runbook.context, 'client-access')
})

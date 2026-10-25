// runbooks upstream server, runbooks 1.10.0. Copied by /runbooks:setup; do not edit.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

export const VERSION = '1.10.0'

const MODES = ['mocked', 'live', 'record']
const STEP_DIR = /^S\d+$/
const ROLE = /^[a-z0-9][a-z0-9-]*$/
const CASE_DIR = /^\+[a-z0-9][a-z0-9-]*$/
const RUNBOOK_ID = /^[\w-]+\.[\w-]+$/
const CONTROL = '/__runbooks/'
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']
// Headers starting with access-control- are never recorded either: the server answers CORS itself.
const NEVER_RECORDED = ['set-cookie', 'authorization', 'cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'vary']

const validOperation = (name) => typeof name === 'string' && name !== ''

// The GraphQL operation a request body names: a JSON object with a non-empty string operationName. Else null.
function operationOf(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) && validOperation(body.operationName) ? body.operationName : null
}

// A GraphQL batch is a JSON array body with at least one named operation. Any other array, such as the body of
// a REST bulk endpoint, is recorded as one request.
const isBatch = (body) => Array.isArray(body) && body.some((item) => operationOf(item) !== null)

// Reads the .json files of a runbook folder (step null) and of its S<nn> subfolders, those of the @<role>
// folders at both levels (role set), and those of the +<case> folders inside each of them (case set).
// Invalid files are skipped, a request.operationName that is not a non-empty string included.
function readFixtures(dir) {
  const fixtures = []
  const readDir = (folder, step, role = null, kase = null) => {
    let names
    try {
      names = fs.readdirSync(path.join(dir, folder)).sort()
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, folder, name), 'utf8'))
        if (!data?.request?.method || !data?.request?.path || data?.response?.status === undefined) continue
        if ('operationName' in data.request && !validOperation(data.request.operationName)) continue
        fixtures.push({ file: folder ? `${folder}/${name}` : name, step, role, case: kase, request: data.request, response: data.response })
      } catch {
        continue
      }
    }
  }
  const readRoles = (parent, step) => {
    let entries = []
    try {
      entries = fs.readdirSync(path.join(dir, parent), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('@') && ROLE.test(entry.name.slice(1))) {
        const folder = parent ? `${parent}/${entry.name}` : entry.name
        readDir(folder, step, entry.name.slice(1))
        readCases(folder, step, entry.name.slice(1))
      }
    }
  }
  const readCases = (parent, step, role) => {
    let entries = []
    try {
      entries = fs.readdirSync(path.join(dir, parent), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && CASE_DIR.test(entry.name)) {
        readDir(parent ? `${parent}/${entry.name}` : entry.name, step, role, entry.name.slice(1))
      }
    }
  }
  readDir('', null)
  readCases('', null, null)
  readRoles('', null)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return fixtures
  }
  for (const entry of entries) {
    if (entry.isDirectory() && STEP_DIR.test(entry.name)) {
      readDir(entry.name, entry.name)
      readCases(entry.name, entry.name, null)
      readRoles(entry.name, entry.name)
    }
  }
  return fixtures
}

function queryOf(fixture) {
  const [, inline = ''] = String(fixture.request.path).split('?')
  const query = {}
  for (const [key, value] of new URLSearchParams(inline)) if (!(key in query)) query[key] = value
  for (const [key, value] of Object.entries(fixture.request.query ?? {})) query[key] = String(value)
  return query
}

// A candidate needs the same method and path and every query key it names equal in the request. A fixture
// with an operationName is a candidate only for a request with that operationName; one without answers any body.
// A fixture with a role is a candidate only for that role, and one with a case only for that case. The score is
// step * 4 + role * 2 + case, so the order is step, role and case; step and role; step and case; step; role
// and case; role; case; runbook level. Then a fixture naming the operation, then more query keys, then the file name.
export function matchFixture(fixtures, { method, path: requestPath, query = {}, operationName = null }, step, role = null, kase = null) {
  const candidates = []
  for (const fixture of fixtures) {
    if (String(fixture.request.method).toUpperCase() !== String(method).toUpperCase()) continue
    if (String(fixture.request.path).split('?')[0] !== requestPath) continue
    if (fixture.step !== null && fixture.step !== step) continue
    if (fixture.role != null && fixture.role !== role) continue
    if (fixture.case != null && fixture.case !== kase) continue
    const operation = fixture.request.operationName !== undefined
    if (operation && fixture.request.operationName !== operationName) continue
    const named = queryOf(fixture)
    if (!Object.entries(named).every(([key, value]) => query[key] === value)) continue
    candidates.push({ fixture, operation, keys: Object.keys(named).length })
  }
  const score = ({ step: s, role: r, case: c }) => (s !== null) * 4 + (r != null) * 2 + (c != null)
  candidates.sort((a, b) =>
    score(b.fixture) - score(a.fixture) ||
    b.operation - a.operation ||
    b.keys - a.keys ||
    (a.fixture.file < b.fixture.file ? -1 : a.fixture.file > b.fixture.file ? 1 : 0))
  return candidates[0]?.fixture ?? null
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

// True when the Host header names this machine, so a page on another site cannot reach the control routes
// through DNS rebinding.
function localHost(host) {
  try {
    return LOCAL_HOSTS.includes(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

function parseBody(raw, contentType) {
  if (raw === '') return null
  if (String(contentType ?? '').includes('json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

export function createUpstreamServer({ fixturesRoot, target = '', redactHeaders = [], log = () => {}, mode = 'mocked', runbook = null, role = null, case: kase = null, step = null }) {
  const state = { runbook, mode, role, case: kase, step }
  let requests = []
  let unmatched = []

  // Control routes get no CORS headers, so a page on another origin cannot read them or send them JSON.
  const cors = (req) => {
    if (new URL(req.url, 'http://upstream.local').pathname.startsWith(CONTROL)) return {}
    const origin = req.headers.origin
    const headers = { 'access-control-allow-origin': origin ?? '*' }
    if (origin) headers['access-control-allow-credentials'] = 'true'
    return headers
  }

  // The server's CORS headers replace any header of the same name, in any case, from a fixture.
  const send = (req, res, status, headers = {}, body) => {
    const own = cors(req)
    const out = {}
    for (const [name, value] of Object.entries(headers)) if (!Object.hasOwn(own, name.toLowerCase())) out[name] = value
    res.writeHead(status, { ...out, ...own })
    res.end(body)
  }

  const sendJson = (req, res, status, value) =>
    send(req, res, status, { 'content-type': 'application/json' }, JSON.stringify(value))

  const snapshot = () => ({ runbook: state.runbook, mode: state.mode, role: state.role, case: state.case, step: state.step })

  async function control(req, res, pathname) {
    if (!localHost(req.headers.host)) {
      return sendJson(req, res, 403, { error: 'control routes accept only a local Host' })
    }
    if (req.method === 'GET' && pathname === `${CONTROL}state`) {
      return sendJson(req, res, 200, { ...snapshot(), requests, unmatched })
    }
    if (req.method === 'POST' && pathname === `${CONTROL}select`) {
      if (String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
        return sendJson(req, res, 415, { error: 'select needs content-type: application/json' })
      }
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        return sendJson(req, res, 400, { error: 'body must be JSON' })
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(req, res, 400, { error: 'body must be a JSON object' })
      }
      if ('mode' in body && !MODES.includes(body.mode)) {
        return sendJson(req, res, 400, { error: `mode must be one of ${MODES.join(', ')}` })
      }
      if ('runbook' in body && body.runbook !== null && !(typeof body.runbook === 'string' && RUNBOOK_ID.test(body.runbook))) {
        return sendJson(req, res, 400, { error: 'runbook must be null or a runbook id like billing.list' })
      }
      if ('role' in body && body.role !== null && !(typeof body.role === 'string' && ROLE.test(body.role))) {
        return sendJson(req, res, 400, { error: 'role must be null or a role name like editor' })
      }
      if ('case' in body && body.case !== null && !(typeof body.case === 'string' && ROLE.test(body.case))) {
        return sendJson(req, res, 400, { error: 'case must be null or a case name like vip-team' })
      }
      if ('step' in body && body.step !== null && !(typeof body.step === 'string' && STEP_DIR.test(body.step))) {
        return sendJson(req, res, 400, { error: 'step must be null or a step id like S01' })
      }
      if ('runbook' in body) {
        state.runbook = body.runbook
        if (!('role' in body)) state.role = null
        if (!('case' in body)) state.case = null
        if (!('step' in body)) state.step = null
      }
      if ('role' in body) {
        state.role = body.role
        if (!('case' in body)) state.case = null
        if (!('step' in body)) state.step = null
      }
      if ('case' in body) {
        state.case = body.case
        if (!('step' in body)) state.step = null
      }
      if ('step' in body) state.step = body.step
      if ('mode' in body) state.mode = body.mode
      requests = []
      unmatched = []
      return sendJson(req, res, 200, snapshot())
    }
    return sendJson(req, res, 404, { error: `unknown control route ${req.method} ${pathname}` })
  }

  function fixtureDir() {
    const text = String(state.runbook)
    const dot = text.indexOf('.')
    if (dot < 0) return null
    return path.join(fixturesRoot, text.slice(0, dot), text.slice(dot + 1))
  }

  function mocked(req, res, request, sent) {
    if (!state.runbook) return { status: 501, send: () => sendJson(req, res, 501, { error: 'no runbook selected' }) }
    const dir = fixtureDir()
    const fixtures = dir ? readFixtures(dir) : []
    const answer = Array.isArray(sent) ? batch(req, res, request, sent, fixtures) : null
    if (answer) return answer
    const operationName = operationOf(sent)
    const fixture = matchFixture(fixtures, { ...request, operationName }, state.step, state.role, state.case)
    if (!fixture) {
      const operation = operationName === null ? {} : { operationName }
      unmatched.push({ method: request.method, path: request.path, ...operation, step: state.step })
      return {
        status: 501,
        send: () => sendJson(req, res, 501, { error: 'no fixture', method: request.method, path: request.path, ...operation, runbook: state.runbook, step: state.step }),
      }
    }
    const { status, headers = {}, body } = fixture.response
    return { status, send: () => sendFixture(req, res, status, headers, body) }
  }

  // Answers a GraphQL batch item by item from the fixtures that name an operation. Returns null when no item has
  // such a fixture, so the request matches as a whole like any other. An item without a fixture makes the batch a
  // 501. Else the first item whose fixture has a status of 300 or more answers the batch as is, and otherwise the
  // batch gets a 200 with the items' bodies in order and their headers merged, the first item winning.
  function batch(req, res, request, sent, fixtures) {
    const named = fixtures.filter((fixture) => fixture.request.operationName !== undefined)
    const names = sent.map(operationOf)
    const found = names.map((operationName) =>
      operationName === null ? null : matchFixture(named, { ...request, operationName }, state.step, state.role, state.case))
    if (!found.some(Boolean)) return null
    const missing = names.filter((_, i) => !found[i])
    if (missing.length > 0) {
      for (const operationName of missing) unmatched.push({ method: request.method, path: request.path, operationName, step: state.step })
      return {
        status: 501,
        send: () => sendJson(req, res, 501, { error: 'no fixture', method: request.method, path: request.path, operationNames: missing, runbook: state.runbook, step: state.step }),
      }
    }
    const failed = found.find((fixture) => fixture.response.status >= 300)
    if (failed) {
      const { status, headers = {}, body } = failed.response
      return { status, send: () => sendFixture(req, res, status, headers, body) }
    }
    const textual = found.find(({ response }) => response.body === undefined || response.body === null || typeof response.body === 'string')
    if (textual) {
      return { status: 500, send: () => sendJson(req, res, 500, { error: `${textual.file} answers an item of a batch, so its response needs a JSON body` }) }
    }
    const headers = {}
    for (const fixture of found) {
      for (const [name, value] of Object.entries(fixture.response.headers ?? {})) {
        const key = name.toLowerCase()
        if (key !== 'content-type' && !(key in headers)) headers[key] = value
      }
    }
    headers['content-type'] = 'application/json'
    return { status: 200, send: () => sendFixture(req, res, 200, headers, found.map((fixture) => fixture.response.body)) }
  }

  function sendFixture(req, res, status, headers, body) {
    const out = { ...headers }
    const typeKey = Object.keys(out).find((name) => name.toLowerCase() === 'content-type')
    if (status === 204 || body === undefined || body === null) return send(req, res, status, out)
    if (typeof body === 'string') {
      if (!typeKey) out['content-type'] = 'text/plain'
      return send(req, res, status, out, body)
    }
    if (!typeKey) out['content-type'] = 'application/json'
    return send(req, res, status, out, JSON.stringify(body))
  }

  // The target's origin, or null when target is empty or not a URL. The target's path prefix is not added:
  // the app already sends it, and fixtures keep the full path.
  function targetUrl() {
    try {
      return new URL(target)
    } catch {
      return null
    }
  }

  const fixtureFile = ({ method, path: requestPath, query, operationName }) => {
    const base = `${method.toLowerCase()}-${requestPath.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const operation = operationName ? `-${operationName.replace(/[^A-Za-z0-9_]/g, '-')}` : ''
    const hash = Object.keys(query).length ? `-${crypto.createHash('sha1').update(new URLSearchParams(query).toString()).digest('hex').slice(0, 8)}` : ''
    return `${base}${operation}${hash}.json`
  }

  // Saves the response as fixtures of the selected runbook, given the request body the app sent. A GraphQL batch
  // is saved item by item when it answered below 300 with an array of one result per item. Otherwise nothing of
  // it is saved, because the failure or the results cannot be tied to an operation.
  function saveFixture(request, upRes, raw, sent) {
    const dir = state.runbook ? fixtureDir() : null
    if (!dir) return
    const skip = new Set([...NEVER_RECORDED, ...redactHeaders.map((name) => String(name).toLowerCase())])
    const headers = {}
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (!skip.has(name) && !name.startsWith('access-control-')) headers[name] = value
    }
    const status = upRes.statusCode
    const kept = Object.keys(headers).length ? { headers } : {}
    const body = parseBody(raw, upRes.headers['content-type'])
    if (!isBatch(sent)) {
      return saveOne(dir, { ...request, operationName: operationOf(sent) }, { status, ...kept, ...(body === null ? {} : { body }) })
    }
    const label = `${request.method} ${request.path} (${sent.map((item) => operationOf(item) ?? 'unnamed').join(', ')})`
    if (status >= 300) return log(`not recording ${label}: the batch answered ${status}; write the failing operation's fixture by hand`)
    if (!Array.isArray(body) || body.length !== sent.length) return log(`not recording ${label}: the response is not an array of ${sent.length} results`)
    sent.forEach((item, i) => {
      const operationName = operationOf(item)
      if (operationName === null) return log(`not recording item ${i + 1} of ${label}: it has no operationName`)
      saveOne(dir, { ...request, operationName }, { status, ...kept, body: body[i] })
    })
  }

  // Writes one fixture, unless the fixture the server would serve for the request is equal. For a request with an
  // operationName, only a fixture naming that operation counts. A differing response goes in the current step's
  // folder. With a role selected, the file goes in that role's folder inside the folder it would otherwise use, and
  // with a case selected, in the +<case> folder inside that.
  function saveOne(dir, request, response) {
    const fixtures = readFixtures(dir)
    const pool = request.operationName ? fixtures.filter((fixture) => fixture.request.operationName !== undefined) : fixtures
    const existing = matchFixture(pool, request, state.step, state.role, state.case)
    let folder = dir
    if (existing) {
      const stored = existing.response
      if (stored.status === response.status && isDeepStrictEqual(stored.body ?? null, response.body ?? null)) return
      if (state.step) folder = path.join(dir, state.step)
    }
    if (state.role) folder = path.join(folder, `@${state.role}`)
    if (state.case) folder = path.join(folder, `+${state.case}`)
    const saved = {
      request: {
        method: request.method,
        path: request.path,
        ...(request.operationName ? { operationName: request.operationName } : {}),
        ...(Object.keys(request.query).length ? { query: request.query } : {}),
      },
      response,
      source: `recorded ${new Date().toISOString().slice(0, 10)} from ${targetUrl().origin}`,
    }
    const file = path.join(folder, fixtureFile(request))
    if (fs.existsSync(file)) log(`overwrote ${path.relative(dir, file)} with a different response`)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`)
  }

  // Pipes the request to the target and streams the response back. In record mode (record true) it asks for an
  // uncompressed response and buffers it so it can be saved as a fixture, except for event streams.
  function proxy(req, res, request, record = false) {
    const base = targetUrl()
    const entry = { ...request, body: null, step: state.step, status: 0 }
    const chunks = []
    const finish = (status) => {
      entry.status = status
      entry.body = parseBody(Buffer.concat(chunks).toString('utf8'), req.headers['content-type'])
      requests.push(entry)
      log(`${request.method} ${request.path} -> ${status}`)
    }
    const unreachable = () => {
      finish(502)
      sendJson(req, res, 502, { error: 'upstream unreachable', target })
    }
    if (!base) return unreachable()
    const client = base.protocol === 'https:' ? https : http
    const upstream = client.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: base.host, ...(record ? { 'accept-encoding': 'identity' } : {}) },
    }, (upRes) => {
      finish(upRes.statusCode)
      res.writeHead(upRes.statusCode, upRes.statusMessage, upRes.rawHeaders)
      upRes.on('error', () => res.destroy())
      if (!record || String(upRes.headers['content-type'] ?? '').includes('text/event-stream')) return upRes.pipe(res)
      const parts = []
      upRes.on('data', (chunk) => parts.push(chunk))
      upRes.on('end', () => {
        const raw = Buffer.concat(parts)
        res.end(raw)
        try {
          saveFixture(request, upRes, raw.toString('utf8'), parseBody(Buffer.concat(chunks).toString('utf8'), req.headers['content-type']))
        } catch (err) {
          log(`could not record ${request.method} ${request.path}: ${err?.message ?? err}`)
        }
      })
    })
    upstream.on('error', () => {
      if (!res.headersSent) unreachable()
      else res.destroy()
    })
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy()
    })
    req.on('data', (chunk) => chunks.push(chunk))
    req.pipe(upstream)
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://upstream.local')
    if (url.pathname.startsWith(CONTROL)) return control(req, res, url.pathname)
    if (state.mode === 'live' || state.mode === 'record') {
      const query = {}
      for (const [key, value] of url.searchParams) if (!(key in query)) query[key] = value
      return proxy(req, res, { method: req.method.toUpperCase(), path: url.pathname, query }, state.mode === 'record')
    }
    if (req.method === 'OPTIONS') {
      return send(req, res, 204, {
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        ...(req.headers['access-control-request-headers']
          ? { 'access-control-allow-headers': req.headers['access-control-request-headers'] }
          : {}),
      })
    }
    const raw = await readBody(req)
    const query = {}
    for (const [key, value] of url.searchParams) if (!(key in query)) query[key] = value
    const request = { method: req.method.toUpperCase(), path: url.pathname, query }
    const body = parseBody(raw, req.headers['content-type'])
    const answer = mocked(req, res, request, body)
    requests.push({ ...request, body, step: state.step, status: answer.status })
    log(`${request.method} ${request.path} -> ${answer.status}`)
    answer.send()
  }

  // Opens a raw socket to the target, replays the request head with the host rewritten, and pipes both ways.
  function tunnel(req, socket, head) {
    const base = targetUrl()
    if (!base) return socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    const secure = base.protocol === 'https:'
    const port = Number(base.port || (secure ? 443 : 80))
    const upstream = secure ? tls.connect({ host: base.hostname, port, servername: base.hostname }) : net.connect(port, base.hostname)
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      lines.push(`${name}: ${name.toLowerCase() === 'host' ? base.host : req.rawHeaders[i + 1]}`)
    }
    upstream.on(secure ? 'secureConnect' : 'connect', () => {
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', () => {
      if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      else socket.destroy()
    })
    upstream.on('close', () => socket.destroy())
    // The client socket allows half-open connections, so a client that hangs up must close both sides itself.
    socket.on('end', () => upstream.end(() => { upstream.destroy(); socket.destroy() }))
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(req, res, 500, { error: String(err?.message ?? err) })
      else res.end()
    })
  })

  server.on('upgrade', (req, socket, head) => {
    // Node removes its own error listener once it emits upgrade; a client reset would otherwise crash the process.
    socket.on('error', () => socket.destroy())
    const pathname = new URL(req.url, 'http://upstream.local').pathname
    if (pathname.startsWith(CONTROL) || (state.mode !== 'live' && state.mode !== 'record')) {
      return socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n')
    }
    tunnel(req, socket, head)
  })

  return server
}

// Listens on 127.0.0.1, prints the listening line and closes on SIGINT or SIGTERM. Exits 2 when the port is taken.
export function serveUpstream({ port, ...options }) {
  const server = createUpstreamServer({ ...options, log: (line) => process.stdout.write(`${line}\n`) })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`runbooks: port ${port} is in use; stop what holds it or change upstream.port\n`)
    } else {
      process.stderr.write(`runbooks: ${err.message}\n`)
    }
    process.exit(2)
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`runbooks-upstream listening on http://127.0.0.1:${server.address().port}\n`)
  })
  // Upgraded sockets leave the HTTP server's own bookkeeping, so every connection is tracked here and destroyed on a signal.
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  const stop = () => {
    server.close()
    server.closeAllConnections()
    for (const socket of sockets) socket.destroy()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop)
  return server
}

function cliOptions(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i].startsWith('--') && argv[i + 1] !== undefined) flags[argv[i].slice(2)] = argv[i + 1]
  }
  const port = flags.port === undefined ? 4010 : Number(flags.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535')
  const mode = flags.mode ?? 'mocked'
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`)
  if (flags.role !== undefined && !ROLE.test(flags.role)) throw new Error('--role must be a role name like editor')
  if (flags.case !== undefined && !ROLE.test(flags.case)) throw new Error('--case must be a case name like vip-team')
  if (!flags.fixtures) throw new Error('--fixtures <dir> is required')
  return {
    fixturesRoot: path.resolve(flags.fixtures),
    target: flags.target ?? '',
    redactHeaders: flags.redact ? flags.redact.split(',').map((name) => name.trim()).filter(Boolean) : [],
    port,
    mode,
    runbook: flags.runbook ?? null,
    role: flags.role ?? null,
    case: flags.case ?? null,
    step: flags.step ?? null,
  }
}

const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : null
if (invokedPath && invokedPath === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let options
  try {
    options = cliOptions(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`runbooks: ${err.message}\n`)
    process.exit(2)
  }
  serveUpstream(options)
}

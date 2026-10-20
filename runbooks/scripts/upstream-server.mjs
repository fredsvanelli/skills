// runbooks upstream server, runbooks 1.2.1. Copied by /runbooks:setup; do not edit.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

export const VERSION = '1.2.1'

const MODES = ['mocked', 'live', 'record']
const STEP_DIR = /^S\d+$/
const RUNBOOK_ID = /^[\w-]+\.[\w-]+$/
const CONTROL = '/__runbooks/'
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']
// Headers starting with access-control- are never recorded either: the server answers CORS itself.
const NEVER_RECORDED = ['set-cookie', 'authorization', 'cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'vary']

// Reads the .json files of a runbook folder (step null) and of its S<nn> subfolders. Invalid files are skipped.
function readFixtures(dir) {
  const fixtures = []
  const readDir = (folder, step) => {
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
        fixtures.push({ file: folder ? `${folder}/${name}` : name, step, request: data.request, response: data.response })
      } catch {
        continue
      }
    }
  }
  readDir('', null)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return fixtures
  }
  for (const entry of entries) {
    if (entry.isDirectory() && STEP_DIR.test(entry.name)) readDir(entry.name, entry.name)
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

// A candidate needs the same method and path and every query key it names equal in the request.
// The current step's folder wins over runbook-level files, then more query keys, then the file name.
export function matchFixture(fixtures, { method, path: requestPath, query = {} }, step) {
  const candidates = []
  for (const fixture of fixtures) {
    if (String(fixture.request.method).toUpperCase() !== String(method).toUpperCase()) continue
    if (String(fixture.request.path).split('?')[0] !== requestPath) continue
    if (fixture.step !== null && fixture.step !== step) continue
    const named = queryOf(fixture)
    if (!Object.entries(named).every(([key, value]) => query[key] === value)) continue
    candidates.push({ fixture, keys: Object.keys(named).length })
  }
  candidates.sort((a, b) =>
    (b.fixture.step !== null) - (a.fixture.step !== null) ||
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

export function createUpstreamServer({ fixturesRoot, target = '', redactHeaders = [], log = () => {}, mode = 'mocked', runbook = null, step = null }) {
  const state = { runbook, mode, step }
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

  const snapshot = () => ({ runbook: state.runbook, mode: state.mode, step: state.step })

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
      if ('step' in body && body.step !== null && !(typeof body.step === 'string' && STEP_DIR.test(body.step))) {
        return sendJson(req, res, 400, { error: 'step must be null or a step id like S01' })
      }
      if ('runbook' in body) {
        state.runbook = body.runbook
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

  function mocked(req, res, request) {
    if (!state.runbook) return { status: 501, send: () => sendJson(req, res, 501, { error: 'no runbook selected' }) }
    const dir = fixtureDir()
    const fixture = dir ? matchFixture(readFixtures(dir), request, state.step) : null
    if (!fixture) {
      unmatched.push({ method: request.method, path: request.path, step: state.step })
      return {
        status: 501,
        send: () => sendJson(req, res, 501, { error: 'no fixture', method: request.method, path: request.path, runbook: state.runbook, step: state.step }),
      }
    }
    const { status, headers = {}, body } = fixture.response
    return { status, send: () => sendFixture(req, res, status, headers, body) }
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

  const fixtureFile = ({ method, path: requestPath, query }) => {
    const base = `${method.toLowerCase()}-${requestPath.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const hash = Object.keys(query).length ? `-${crypto.createHash('sha1').update(new URLSearchParams(query).toString()).digest('hex').slice(0, 8)}` : ''
    return `${base}${hash}.json`
  }

  // Saves the response as a fixture of the selected runbook. Writes nothing when the runbook already has an
  // equal one, and puts a differing response in the current step's folder.
  function saveFixture(request, upRes, raw) {
    const dir = state.runbook ? fixtureDir() : null
    if (!dir) return
    const skip = new Set([...NEVER_RECORDED, ...redactHeaders.map((name) => String(name).toLowerCase())])
    const headers = {}
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (!skip.has(name) && !name.startsWith('access-control-')) headers[name] = value
    }
    const body = parseBody(raw, upRes.headers['content-type'])
    const response = { status: upRes.statusCode, ...(Object.keys(headers).length ? { headers } : {}), ...(body === null ? {} : { body }) }
    const existing = matchFixture(readFixtures(dir), request, state.step)
    let folder = dir
    if (existing) {
      const stored = existing.response
      if (stored.status === response.status && isDeepStrictEqual(stored.body ?? null, body)) return
      if (state.step) folder = path.join(dir, state.step)
    }
    const saved = {
      request: { method: request.method, path: request.path, ...(Object.keys(request.query).length ? { query: request.query } : {}) },
      response,
      source: `recorded ${new Date().toISOString().slice(0, 10)} from ${targetUrl().origin}`,
    }
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, fixtureFile(request)), `${JSON.stringify(saved, null, 2)}\n`)
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
          saveFixture(request, upRes, raw.toString('utf8'))
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
    const answer = mocked(req, res, request)
    requests.push({ ...request, body: parseBody(raw, req.headers['content-type']), step: state.step, status: answer.status })
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
  if (!flags.fixtures) throw new Error('--fixtures <dir> is required')
  return {
    fixturesRoot: path.resolve(flags.fixtures),
    target: flags.target ?? '',
    redactHeaders: flags.redact ? flags.redact.split(',').map((name) => name.trim()).filter(Boolean) : [],
    port,
    mode,
    runbook: flags.runbook ?? null,
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

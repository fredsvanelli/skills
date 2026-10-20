// runbooks upstream server, runbooks 1.1.0. Copied by /runbooks:setup; do not edit.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

export const VERSION = '1.1.0'

const MODES = ['mocked', 'live', 'record']
const STEP_DIR = /^S\d+$/
const CONTROL = '/__runbooks/'

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

export function createUpstreamServer({ fixturesRoot, target = '', redactHeaders = [], log = () => {} }) {
  const state = { runbook: null, mode: 'mocked', step: null }
  let requests = []
  let unmatched = []

  const cors = (req) => {
    const origin = req.headers.origin
    const headers = { 'access-control-allow-origin': origin ?? '*' }
    if (origin) headers['access-control-allow-credentials'] = 'true'
    return headers
  }

  const send = (req, res, status, headers = {}, body) => {
    res.writeHead(status, { ...cors(req), ...headers })
    res.end(body)
  }

  const sendJson = (req, res, status, value) =>
    send(req, res, status, { 'content-type': 'application/json' }, JSON.stringify(value))

  const snapshot = () => ({ runbook: state.runbook, mode: state.mode, step: state.step })

  async function control(req, res, pathname) {
    if (req.method === 'GET' && pathname === `${CONTROL}state`) {
      return sendJson(req, res, 200, { ...snapshot(), requests, unmatched })
    }
    if (req.method === 'POST' && pathname === `${CONTROL}select`) {
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

  async function handle(req, res) {
    const url = new URL(req.url, 'http://upstream.local')
    if (url.pathname.startsWith(CONTROL)) return control(req, res, url.pathname)
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
    // The mode switch. Task 7 adds live and record.
    const answer = state.mode === 'mocked'
      ? mocked(req, res, request)
      : { status: 501, send: () => sendJson(req, res, 501, { error: `mode ${state.mode} is not available` }) }
    requests.push({ ...request, body: parseBody(raw, req.headers['content-type']), step: state.step, status: answer.status })
    log(`${request.method} ${request.path} -> ${answer.status}`)
    answer.send()
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(req, res, 500, { error: String(err?.message ?? err) })
      else res.end()
    })
  })
}

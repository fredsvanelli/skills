// runbooks UI server. Read-only: it serves the views of the runbooks on disk to templates/ui.html.
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { todayLocal } from './lib/stale.mjs'
import { runbooksView, runbookView, historyView, reportView, coverageView, rolesView, roleView } from './lib/explore.mjs'

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']
const PAGE = fileURLToPath(new URL('../templates/ui.html', import.meta.url))

// True when the Host header names this machine, so a page on another site cannot read the views through DNS rebinding.
function localHost(host) {
  try {
    return LOCAL_HOSTS.includes(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

// Decodes one path segment. A malformed escape returns null, which the caller answers with 404.
function decode(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function createUiServer({ root, configPath, today = todayLocal, html = () => fs.readFileSync(PAGE, 'utf8') }) {
  const sendJson = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const found = (res, value) => (value === null ? sendJson(res, 404, { error: 'not found' }) : sendJson(res, 200, value))

  function route(req, res, url) {
    const segments = url.pathname.split('/').slice(1).map(decode)
    if (segments.includes(null)) return sendJson(res, 404, { error: 'not found' })
    const [first, second, id, third, ...rest] = segments
    if (url.pathname === '/') {
      const page = html()
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(page)
    }
    if (first !== 'api') return sendJson(res, 404, { error: 'not found' })
    // A page on another site can send a plain GET, which would run the config's command sources. It
    // cannot add this header without a CORS preflight, and the server approves none.
    if (req.headers['x-runbooks'] !== '1') return sendJson(res, 403, { error: 'missing x-runbooks header' })
    const config = loadConfig(root, configPath)
    if (second === 'runbooks' && id === undefined) return sendJson(res, 200, runbooksView(root, config, { today: today() }))
    if (second === 'runbook' && id && third === undefined) return found(res, runbookView(root, config, id, { today: today() }))
    if (second === 'runbook' && id && third === 'runs' && rest.length === 0) return found(res, historyView(root, config, id))
    if (second === 'roles' && id === undefined) return sendJson(res, 200, rolesView(root, config, { today: today() }))
    if (second === 'role' && id && third === undefined) return found(res, roleView(root, config, id))
    if (second === 'runs' && id === undefined) return sendJson(res, 404, { error: 'not found' })
    if (second === 'runs' && third === undefined) return found(res, reportView(root, config, id))
    if (second === 'coverage' && id === undefined) {
      const filters = Object.fromEntries(['capability', 'feature', 'path', 'slice', 'role']
        .filter((key) => url.searchParams.has(key)).map((key) => [key, url.searchParams.get(key)]))
      return sendJson(res, 200, coverageView(root, config, filters))
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  return http.createServer((req, res) => {
    try {
      if (!localHost(req.headers.host)) return sendJson(res, 403, { error: 'forbidden host' })
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      route(req, res, new URL(req.url, 'http://localhost'))
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: String(err?.message ?? err) })
      else res.end()
    }
  })
}

// Listens on 127.0.0.1, prints the listening line and closes on SIGINT or SIGTERM. Exits 2 when the port is taken.
export function serveUi({ root, configPath, port }) {
  const server = createUiServer({ root, configPath })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`runbooks: port ${port} is in use; stop what holds it or pass --port\n`)
    } else {
      process.stderr.write(`runbooks: ${err.message}\n`)
    }
    process.exit(2)
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`runbooks-ui listening on http://127.0.0.1:${server.address().port}\n`)
  })
  const stop = () => {
    server.close()
    server.closeAllConnections()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop)
  return server
}

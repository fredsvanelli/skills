import fs from 'node:fs'
import path from 'node:path'

import { isOutside } from './config.mjs'
import { upstreamServerOptions } from '../upstream-server.mjs'

// Turns the config's upstream block and the CLI flags into the options of createUpstreamServer, plus the port.
export function upstreamOptions(root, config, options) {
  if (!config.upstream) throw new Error('the config has no upstream block. Run /runbooks:setup')
  return upstreamServerOptions(root, config.upstream, options)
}

// A UI tests repository outside this project that is not cloned next to it; see docs/adr/0007.
function uncloned(root, config) {
  const testsRoot = config.tests?.ui?.root
  return testsRoot && isOutside(root, testsRoot) && !fs.existsSync(path.resolve(root, testsRoot)) ? testsRoot : null
}

// upstream.serverFile with forward slashes, so a path written on Windows resolves on POSIX and survives a shell.
export const serverFileOf = (config) => config.upstream?.serverFile?.replaceAll('\\', '/') ?? null

// Compares the copied server's VERSION with the plugin's. Reads the file as text and never imports it.
function fileProblem(root, file, version) {
  const full = path.resolve(root, file)
  if (!fs.existsSync(full)) return `upstream.serverFile ${file} is missing: run /runbooks:setup to copy it`
  const found = /export const VERSION = '([^']*)'/.exec(fs.readFileSync(full, 'utf8'))?.[1] ?? 'unknown'
  if (found === version) return null
  return `upstream.serverFile ${file} is from runbooks ${found}, the plugin is ${version}: run /runbooks:setup to refresh it`
}

// The warning list and coverage print. A copy in a UI tests repository that is not cloned here is not missing.
export function copiedServerWarning(root, config, version) {
  const file = serverFileOf(config)
  if (!file || uncloned(root, config)) return null
  return fileProblem(root, file, version)
}

// Why run cannot start the copied server, or null when it can: run needs the copy, so nothing here is lenient.
export function copiedServerProblem(root, config, version) {
  if (!config.upstream) return 'the config has no upstream block. Run /runbooks:setup'
  const file = serverFileOf(config)
  if (!file) return 'upstream.serverFile is not set: run /runbooks:setup to copy the server'
  const testsRoot = uncloned(root, config)
  if (testsRoot) return `upstream.serverFile ${file} is in ${testsRoot}, which is not cloned: clone it there or run /runbooks:setup`
  return fileProblem(root, file, version)
}

export const PACKAGE_SCRIPT = 'runbooks:upstream'

// Compares the runbooks:upstream script of package.json with `node <upstream.serverFile>`, and writes it with write.
// A write keeps the file's indent, its key order, its line endings and its final newline.
export function packageScript(root, config, { write = false } = {}) {
  const file = serverFileOf(config)
  if (!file) throw new Error('upstream.serverFile is not set: run /runbooks:setup to copy the server first')
  const value = `node ${file}`
  const packagePath = path.join(root, 'package.json')
  if (!fs.existsSync(packagePath)) return { status: 'no-package', value, current: null }
  const text = fs.readFileSync(packagePath, 'utf8')
  const pkg = JSON.parse(text)
  const current = pkg.scripts?.[PACKAGE_SCRIPT] ?? null
  if (current === value) return { status: 'unchanged', value, current }
  if (write) {
    pkg.scripts = { ...pkg.scripts, [PACKAGE_SCRIPT]: value }
    const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const json = JSON.stringify(pkg, null, indent).replaceAll('\n', eol)
    fs.writeFileSync(packagePath, `${json}${text.endsWith('\n') ? eol : ''}`)
  }
  const status = current === null ? (write ? 'added' : 'missing') : write ? 'replaced' : 'differs'
  return { status, value, current }
}

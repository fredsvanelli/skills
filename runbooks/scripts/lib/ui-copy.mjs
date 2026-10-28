import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The plugin's scripts/ folder, from which the module paths of the copy are relative.
const SCRIPTS = fileURLToPath(new URL('..', import.meta.url))
const PAGE = fileURLToPath(new URL('../../templates/ui.html', import.meta.url))

export const UI_COPY_NAME = 'runbooks-ui.mjs'

// LF only, so a Windows checkout of the plugin writes the same copy.
const read = (file) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')

// ui-server.mjs and every module it reaches through relative static imports, as [path from scripts/, source], sorted.
export function uiModules() {
  const found = new Map()
  const visit = (rel) => {
    if (found.has(rel)) return
    const source = read(path.join(SCRIPTS, rel))
    found.set(rel, source)
    for (const match of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      const next = path.posix.join(path.posix.dirname(rel), match[1])
      if (next.startsWith('../')) throw new Error(`${rel} imports ${match[1]}, outside scripts/`)
      visit(next)
    }
  }
  visit('ui-server.mjs')
  return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

// Where setup writes the copy, relative to the project, with forward slashes so it survives a shell.
export const uiCopyFile = (config) => `${config.paths.runbooks.replaceAll('\\', '/')}/${UI_COPY_NAME}`

// Why /runbooks:ui cannot start the copy, or null when it can. Reads the copy as text and never imports it.
export function uiCopyProblem(root, config, version) {
  const file = uiCopyFile(config)
  const full = path.resolve(root, file)
  if (!fs.existsSync(full)) return `runbooks UI copy ${file} is missing: run /runbooks:setup to write it`
  const found = /export const VERSION = '([^']*)'/.exec(fs.readFileSync(full, 'utf8'))?.[1] ?? 'unknown'
  if (found === version) return null
  return `runbooks UI copy ${file} is from runbooks ${found}, the plugin is ${version}: run /runbooks:setup to refresh it`
}

// Writes or refreshes the copy. unchanged means the file already holds these bytes.
export function writeUiCopy(root, config, version) {
  const file = uiCopyFile(config)
  const full = path.resolve(root, file)
  const text = buildUiCopy(version)
  const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
  if (current === text) return { status: 'unchanged', file }
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
  return { status: current === null ? 'added' : 'replaced', file }
}

// The project's copy of the UI server: the modules and the page as strings, written to a temp folder at startup.
export function buildUiCopy(version) {
  const modules = uiModules().map(([rel, source]) => `  ${JSON.stringify(rel)}: ${JSON.stringify(source)},`)
  return `// runbooks UI server, runbooks ${version}. Written by /runbooks:setup from the plugin's sources; do not edit.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VERSION = '${version}'

const MODULES = {
${modules.join('\n')}
}

const PAGE = ${JSON.stringify(read(PAGE))}

// Node imports modules from files, so they go to a fresh temp folder, which is gone before the server listens.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-'))
let startUi
try {
  for (const [rel, source] of Object.entries(MODULES)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), source)
  }
  ;({ startUi } = await import(pathToFileURL(path.join(dir, 'ui-server.mjs')).href))
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
startUi(process.argv.slice(2), { html: () => PAGE })
`
}

import fs from 'node:fs'
import path from 'node:path'

import { serverFileOf } from './upstream.mjs'
import { uiCopyFile } from './ui-copy.mjs'

// The npm scripts setup writes: runbooks:ui always, runbooks:upstream once upstream.serverFile is set.
function wanted(config) {
  const scripts = [{ name: 'runbooks:ui', value: `node ${uiCopyFile(config)}` }]
  const serverFile = serverFileOf(config)
  if (serverFile) scripts.push({ name: 'runbooks:upstream', value: `node ${serverFile}` })
  return scripts
}

// Compares each script of package.json with its expected value. write adds the missing ones, and replaces the
// differing ones only with replace; only limits both to one script. A write keeps the file's indent, its key order, its
// line endings and its final newline.
export function packageScripts(root, config, { write = false, replace = false, only = null } = {}) {
  if (only !== null && !['runbooks:ui', 'runbooks:upstream'].includes(only)) throw new Error('--only must be runbooks:ui or runbooks:upstream')
  const packagePath = path.join(root, 'package.json')
  const scripts = wanted(config).filter(({ name }) => only === null || name === only)
  if (!fs.existsSync(packagePath)) return scripts.map(({ name, value }) => ({ name, status: 'no-package', value, current: null }))
  const text = fs.readFileSync(packagePath, 'utf8')
  const pkg = JSON.parse(text)
  const items = scripts.map(({ name, value }) => {
    const current = pkg.scripts?.[name] ?? null
    if (current === value) return { name, status: 'unchanged', value, current }
    if (current === null) return { name, status: write ? 'added' : 'missing', value, current }
    return { name, status: write && replace ? 'replaced' : 'differs', value, current }
  })
  const changed = items.filter(({ status }) => status === 'added' || status === 'replaced')
  if (changed.length > 0) {
    pkg.scripts = { ...pkg.scripts, ...Object.fromEntries(changed.map(({ name, value }) => [name, value])) }
    const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const json = JSON.stringify(pkg, null, indent).replaceAll('\n', eol)
    fs.writeFileSync(packagePath, `${json}${text.endsWith('\n') ? eol : ''}`)
  }
  return items
}

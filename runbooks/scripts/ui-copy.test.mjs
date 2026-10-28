import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { uiModules, buildUiCopy } from './lib/ui-copy.mjs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))
const COPY = 'docs/runbooks/runbooks-ui.mjs'

// The fixture project and its sibling ../api in a temp folder, with the copy written into the project.
function project() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-copy-'))
  const root = path.join(tmp, 'project')
  fs.cpSync(FIXTURE, root, { recursive: true })
  fs.cpSync(path.join(FIXTURE, '../api'), path.join(tmp, 'api'), { recursive: true })
  fs.writeFileSync(path.join(root, COPY), buildUiCopy('9.9.9'))
  return { tmp, root }
}

// Spawns the copy and resolves with the child and its first stdout line.
function spawnCopy(t, cwd, args, env = {}) {
  const child = spawn(process.execPath, [path.join(cwd, args.copy ?? COPY), ...args.flags], { cwd, env: { ...process.env, ...env } })
  t.after(() => child.kill('SIGTERM'))
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    child.stderr.on('data', (chunk) => { err += chunk })
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.includes('\n')) resolve({ child, line: out.split('\n')[0] })
    })
    child.on('exit', (code) => reject(new Error(`copy exited ${code}: ${err}`)))
  })
}

test('uiModules holds every module ui-server.mjs reaches and nothing else', () => {
  const modules = uiModules()
  const paths = modules.map(([rel]) => rel)
  assert.ok(paths.includes('ui-server.mjs') && paths.includes('lib/explore.mjs') && paths.includes('lib/args.mjs'))
  assert.ok(!paths.includes('runbooks.mjs'))
  assert.deepEqual(paths, [...paths].sort())
  for (const [rel, source] of modules) {
    for (const match of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      assert.ok(paths.includes(path.posix.join(path.posix.dirname(rel), match[1])), `${rel} imports ${match[1]}`)
    }
  }
})

test('buildUiCopy writes the header and VERSION, is stable, and names no plugin path', () => {
  const text = buildUiCopy('9.9.9')
  assert.match(text, /^\/\/ runbooks UI server, runbooks 9\.9\.9\. Written by \/runbooks:setup from the plugin's sources; do not edit\.\n/)
  assert.match(text, /^export const VERSION = '9\.9\.9'$/m)
  assert.equal(buildUiCopy('9.9.9'), text)
  assert.ok(!text.includes(PLUGIN_ROOT))
})

test('the copy serves the page and the API from the project folder and leaves no temp folder', async (t) => {
  const { tmp, root } = project()
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-tmpdir-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const { line } = await spawnCopy(t, root, { flags: ['--port', '0'] }, { TMPDIR: tmpdir })
  assert.match(line, /^runbooks-ui listening on http:\/\/127\.0\.0\.1:\d+$/)
  const base = line.slice('runbooks-ui listening on '.length)
  const page = await fetch(`${base}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<title>runbooks<\/title>/)
  const api = await fetch(`${base}/api/runbooks`, { headers: { 'x-runbooks': '1' } })
  assert.equal(api.status, 200)
  assert.deepEqual(fs.readdirSync(tmpdir), [])
})

test('the copy resolves --root from the current folder', async (t) => {
  const { tmp } = project()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(tmp, 'e2e'))
  const { line } = await spawnCopy(t, path.join(tmp, 'e2e'), { copy: `../project/${COPY}`, flags: ['--root', '../project', '--port', '0'] })
  assert.match(line, /^runbooks-ui listening on /)
})

test('the copy keeps running after the shell that started it with node exits', async (t) => {
  const { tmp, root } = project()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  // The shell starts the copy in the background, waits for its listening line, writes its pid and exits.
  const script = `${JSON.stringify(process.execPath)} ${COPY} --port 0 > out.txt 2>&1 & echo $! > pid.txt
    while ! grep -q listening out.txt; do sleep 0.1; done`
  const env = { ...process.env }
  delete env.npm_lifecycle_event
  const shell = spawnSync('sh', ['-c', script], { cwd: root, env, timeout: 10000 })
  assert.equal(shell.status, 0)
  const pid = Number(fs.readFileSync(path.join(root, 'pid.txt'), 'utf8'))
  t.after(() => {
    try { process.kill(pid, 'SIGTERM') } catch {}
  })
  const base = /http:\/\/127\.0\.0\.1:\d+/.exec(fs.readFileSync(path.join(root, 'out.txt'), 'utf8'))[0]
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal((await fetch(`${base}/`)).status, 200)
})

test('the copy exits 2 with a runbooks: line when the root has no config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-ui-copy-noconfig-'))
  fs.mkdirSync(path.join(dir, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(path.join(dir, COPY), buildUiCopy('9.9.9'))
  const result = spawnSync(process.execPath, [COPY, '--port', '0'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^runbooks: /)
  assert.doesNotMatch(result.stderr, /\n\s+at /)
  assert.equal(result.stdout, '')
})

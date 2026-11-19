#!/usr/bin/env node
// Lists the agent instruction files (CLAUDE.md, AGENTS.md, nested), which one is the source,
// their managed blocks, and checks every backticked reference against the base and HEAD trees.
// Usage: node refs.mjs [--base <ref>] [<file>…]   (run from the repository root)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }) } catch { return null }
}
const argv = process.argv.slice(2)
const bi = argv.indexOf('--base')
const base = bi >= 0 ? argv[bi + 1] : 'main'
const given = argv.filter((a, i) => a !== '--base' && i !== bi + 1)
const mergeBase = (git('merge-base', base, 'HEAD') || '').trim()
if (!mergeBase) { console.error(`cannot find merge base with ${base}`); process.exit(2) }

const NAMES = new Set(['CLAUDE.md', 'AGENTS.md'])
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.git)\//
const files = given.length ? given : git('ls-files', '--cached', '--others', '--exclude-standard')
  .split('\n').filter((f) => NAMES.has(path.basename(f)) && !SKIP.test(f) && fs.existsSync(f)).sort()

const baseTree = new Set(git('ls-tree', '-r', '--name-only', mergeBase).split('\n').filter(Boolean))
const inBase = (p) => baseTree.has(p) || [...baseTree].some((f) => f.startsWith(p + '/'))
const renames = new Map()
for (const line of (git('diff', '--name-status', '-M', `${mergeBase}`, '--') || '').split('\n')) {
  const [st, from, to] = line.split('\t')
  if (st?.startsWith('R')) renames.set(from, to)
}
const scriptsAt = (ref, dir) => {
  const p = path.posix.join(dir, 'package.json')
  const raw = ref ? git('show', `${ref}:${p}`) : (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
  try { return new Set(Object.keys(JSON.parse(raw).scripts || {})) } catch { return null }
}
const EXCLUDE = [':(exclude,glob)**/CLAUDE.md', ':(exclude,glob)**/AGENTS.md']
const grepHead = (id) => git('grep', '-q', '-w', '-F', '--untracked', '-e', id, '--', '.', ...EXCLUDE) !== null
const grepBase = (id) => git('grep', '-q', '-w', '-F', '-e', id, mergeBase, '--', '.', ...EXCLUDE) !== null

const RUNNER = /^(?:yarn|pnpm|bun|npm)(?:\s+run)?\s+([\w:.-]+)/
const NPM_BUILTIN = new Set(['install', 'add', 'remove', 'ci', 'exec', 'dlx', 'x', 'why', 'audit', 'upgrade', 'outdated', 'link', 'publish', 'init', 'create'])

function classify(tok) {
  const m = tok.match(RUNNER)
  if (m) return NPM_BUILTIN.has(m[1]) && !/run\s/.test(tok) ? null : { kind: 'script', name: m[1] }
  if (/[\s<>*{}$|=]|^-|:\/\//.test(tok)) return null
  const p = tok.replace(/^@/, '').replace(/^\.\//, '').replace(/(:\d+)+$/, '').replace(/\/$/, '')
  if (p.includes('/') || /\.[a-z][a-z0-9]{0,4}$/i.test(p)) return { kind: 'path', name: p }
  const id = tok.replace(/\(\)$/, '')
  // code-shaped only (camelCase, PascalCase, snake_case, call): plain words like `yarn` are prose
  if (/^[A-Za-z_$][\w$]{2,}$/.test(id) && (/[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/.test(id) || tok.endsWith('()'))) return { kind: 'identifier', name: id }
  return null
}

function check(ref, file) {
  const dir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
  if (ref.kind === 'script') {
    const head = scriptsAt(null, dir) || scriptsAt(null, '')
    const was = scriptsAt(mergeBase, dir) || scriptsAt(mergeBase, '')
    if (!head) return { status: 'unchecked', note: 'no package.json' }
    const now = head.has(ref.name), then = was?.has(ref.name)
    const added = was ? [...head].filter((s) => !was.has(s)) : []
    return { status: now ? 'ok' : then ? 'broken-by-branch' : 'already-broken', note: !now && added.length ? `scripts added on branch: ${added.join(', ')}` : '' }
  }
  if (ref.kind === 'path') {
    const cands = dir ? [path.posix.join(dir, ref.name), ref.name] : [ref.name]
    if (cands.some((c) => fs.existsSync(c))) return { status: 'ok' }
    const then = cands.find(inBase)
    if (!then) return { status: 'already-broken' }
    const to = renames.get(then) || [...renames].find(([f]) => f.startsWith(then + '/'))?.[1]
    return { status: 'broken-by-branch', note: to ? `renamed to ${to}` : 'deleted on branch' }
  }
  const now = grepHead(ref.name)
  return { status: now ? 'ok' : grepBase(ref.name) ? 'broken-by-branch' : 'already-broken' }
}

const START = /<!--\s*([\w:-]+?)(?::start\b|\s.*?)?\s*-->/
const END = /<!--\s*(?:end[\s:-]+([\w:-]+)|([\w:-]+):end)\s*-->/i
for (const file of files) {
  const lst = fs.lstatSync(file)
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  console.log(`\n## ${file} (${lines.length - (text.endsWith('\n') ? 1 : 0)} lines)`)
  if (lst.isSymbolicLink()) { console.log(`symlink -> ${fs.readlinkSync(file)}: edit the target, not this file`); continue }
  const imports = lines.filter((l) => /^\s*@\S+\.md\s*$/.test(l)).map((l) => l.trim().slice(1))
  if (imports.length) console.log(`imports: ${imports.join(', ')}${lines.filter((l) => l.trim()).length === imports.length ? ' (import only: edit the imported file)' : ''}`)
  const blocks = []
  let open = null
  lines.forEach((l, i) => {
    if (open && END.test(l)) { blocks.push([open[0], open[1], i + 1]); open = null }
    else if (!open && START.test(l) && !END.test(l)) open = [l.trim(), i + 1]
  })
  for (const [tag, from, to] of blocks) console.log(`managed block lines ${from}-${to}: ${tag} (never edit)`)
  const managed = (n) => blocks.some(([, from, to]) => n >= from && n <= to)
  const seen = new Set()
  const rows = { 'broken-by-branch': [], 'already-broken': [], ok: [], unchecked: [] }
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence
    if (fence) return
    for (const [, tok] of l.matchAll(/`([^`\n]+)`/g)) {
      const key = tok.trim()
      if (seen.has(key)) continue
      seen.add(key)
      const ref = classify(key)
      if (!ref) { rows.unchecked.push(`${i + 1}: \`${key}\``); continue }
      const r = check(ref, file)
      rows[r.status].push(`${i + 1}: \`${key}\` [${ref.kind}]${r.note ? ` (${r.note})` : ''}${managed(i + 1) ? ' (in managed block)' : ''}`)
    }
  })
  for (const [k, v] of Object.entries(rows)) if (v.length) console.log(`${k} (${v.length}):\n${v.map((x) => '  ' + x).join('\n')}`)
}
if (!files.length) console.log('no CLAUDE.md or AGENTS.md found')

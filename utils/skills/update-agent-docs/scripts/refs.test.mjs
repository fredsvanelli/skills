// Self-check for refs.mjs on a throwaway repo: node --test refs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const refs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'refs.mjs')

test('splits references broken by the branch from those already broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-'))
  const sh = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir })
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s) }
  sh('init', '-q', '-b', 'main')
  write('package.json', JSON.stringify({ scripts: { dev: 'x', 'db:seed': 'x' } }))
  write('src/apiClient.ts', 'export function apiGet() {}\n')
  write('CLAUDE.md', [
    'Run `yarn dev`, then `yarn db:seed`.',
    'Calls go through `apiGet` in `src/apiClient.ts`. See `docs/missing.md`.',
    '<!-- runbooks:start -->', 'Run `yarn gone`.', '<!-- runbooks:end -->', '',
  ].join('\n'))
  write('AGENTS.md', '@CLAUDE.md\n')
  sh('add', '-A'); sh('commit', '-qm', 'init'); sh('checkout', '-qb', 'feat')
  sh('mv', 'src/apiClient.ts', 'src/http.ts')
  write('package.json', JSON.stringify({ scripts: { dev: 'x', 'db:seed:dev': 'x' } }))
  sh('commit', '-qam', 'rename')

  const out = execFileSync('node', [refs, '--base', 'main'], { cwd: dir, encoding: 'utf8' })
  const section = (name) => (out.split(new RegExp(`^${name} \\(\\d+\\):$`, 'm'))[1] || '').split(/^\S/m)[0]
  assert.match(out, /AGENTS\.md[\s\S]*import only/)
  assert.match(out, /managed block lines 3-5/)
  assert.match(section('broken-by-branch'), /yarn db:seed` \[script\] \(scripts added on branch: db:seed:dev\)/)
  assert.match(section('broken-by-branch'), /src\/apiClient\.ts` \[path\] \(renamed to src\/http\.ts\)/)
  assert.match(section('already-broken'), /docs\/missing\.md/)
  assert.match(section('already-broken'), /yarn gone.*in managed block/)
  assert.match(section('ok'), /yarn dev/)
  assert.match(section('ok'), /apiGet/)
})

test('leaves slash commands and bare extensions unchecked, still checks dotfiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-'))
  const sh = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir })
  fs.writeFileSync(path.join(dir, '.nvmrc'), '20\n')
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Run `/pmkit:issues:move` or `/grill-with-docs`. Files are `.mjs`. Node is in `.nvmrc`. See `/docs/gone.md`.\n')
  sh('init', '-q', '-b', 'main'); sh('add', '-A'); sh('commit', '-qm', 'init')

  const out = execFileSync('node', [refs, '--base', 'main'], { cwd: dir, encoding: 'utf8' })
  const section = (name) => (out.split(new RegExp(`^${name} \\(\\d+\\):$`, 'm'))[1] || '').split(/^\S/m)[0]
  for (const tok of ['/pmkit:issues:move', '/grill-with-docs', '.mjs']) assert.match(section('unchecked'), new RegExp('`' + tok + '`'))
  assert.match(section('ok'), /\.nvmrc/)
  assert.match(section('already-broken'), /\/docs\/gone\.md/)
})

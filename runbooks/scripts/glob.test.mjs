import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { globToRegExp, matchesGlob, findFiles } from './lib/glob.mjs'

test('** matches zero or more folders', () => {
  assert.equal(matchesGlob('src/page.tsx', 'src/**/page.tsx'), true)
  assert.equal(matchesGlob('src/a/b/page.tsx', 'src/**/page.tsx'), true)
  assert.equal(matchesGlob('src/a/page.tsx.bak', 'src/**/page.tsx'), false)
})

test('* stays inside one folder', () => {
  assert.equal(matchesGlob('docs/a.md', 'docs/*.md'), true)
  assert.equal(matchesGlob('docs/x/a.md', 'docs/*.md'), false)
})

test('a trailing ** matches every file below', () => {
  assert.equal(matchesGlob('a/b/c/d.ts', 'a/**'), true)
  assert.equal(matchesGlob('b/c.ts', 'a/**'), false)
})

test('brackets, parentheses and dots are literal', () => {
  const glob = 'src/app/[locale]/(dashboard)/**'
  assert.equal(matchesGlob('src/app/[locale]/(dashboard)/x/page.tsx', glob), true)
  assert.equal(matchesGlob('src/app/l/dashboard/x/page.tsx', glob), false)
  assert.equal(matchesGlob('../api/src/app/x/route.ts', '../api/src/**'), true)
  assert.equal(globToRegExp('a.md').test('aXmd'), false)
})

test('findFiles walks from the literal prefix and skips node_modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-glob-'))
  for (const rel of ['src/app/[locale]/page.tsx', 'src/app/[locale]/x/page.tsx', 'src/node_modules/y/page.tsx', 'src/app/[locale]/x/layout.tsx']) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), '')
  }
  assert.deepEqual(findFiles(dir, 'src/**/page.tsx'), ['src/app/[locale]/page.tsx', 'src/app/[locale]/x/page.tsx'])
  assert.deepEqual(findFiles(dir, 'missing/**/*.md'), [])
  assert.deepEqual(findFiles(path.join(dir, 'nope'), '**/*.md'), [])
})

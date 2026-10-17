import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { extractItems } from './lib/extract.mjs'
import { changedFiles, affectedRunbooks } from './lib/affected.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))

function fixtureAffected(changed) {
  const config = loadConfig(FIXTURE)
  return affectedRunbooks({
    runbooks: loadRunbooks(FIXTURE, config),
    entries: extractItems(FIXTURE, config.entries, 'entries').items,
    slices: config.slices,
    changed,
  })
}

test('a changed page affects the runbooks citing it and its slice', () => {
  const hits = fixtureAffected(['src/app/[locale]/(dashboard)/financeiro/faturas/page.tsx'])
  assert.deepEqual(hits.map((h) => [h.runbook.id, h.reasons]), [
    ['billing.cancel-invoice', ['slice billing: 1 file(s)']],
    ['billing.issue-invoice', [
      '/financeiro/faturas (src/app/[locale]/(dashboard)/financeiro/faturas/page.tsx)',
      'slice billing: 1 file(s)',
    ]],
  ])
})

test('a changed runbook file affects that runbook; deprecated ones never show', () => {
  const hits = fixtureAffected(['docs/runbooks/deliveries/list-deliveries.md', 'src/app/[locale]/(dashboard)/deliveries/page.tsx'])
  assert.deepEqual(hits.map((h) => h.runbook.id), ['deliveries.list-deliveries'])
  assert.equal(hits[0].reasons[0], 'runbook changed')
})

test('nothing changed, nothing affected', () => {
  assert.deepEqual(fixtureAffected([]), [])
})

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-git-'))
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('switch', '-q', '-c', 'feature')
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
  git('add', 'b.txt')
  git('commit', '-qm', 'b')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed')
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c')
  return dir
}

test('changedFiles joins branch commits, working tree edits and untracked files', () => {
  assert.deepEqual(changedFiles(tmpRepo(), 'main'), ['a.txt', 'b.txt', 'c.txt'])
})

test('changedFiles names an unknown base', () => {
  assert.throws(() => changedFiles(tmpRepo(), 'nope'), /^Error: base "nope" is not a known branch or commit$/)
})

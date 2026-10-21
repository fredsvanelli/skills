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
import { run } from './runbooks.mjs'

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
  const hits = fixtureAffected(['src/app/[locale]/(dashboard)/billing/invoices/page.tsx'])
  assert.deepEqual(hits.map((h) => [h.runbook.id, h.reasons]), [
    ['billing.cancel-invoice', ['slice billing: 1 file(s)']],
    ['billing.issue-invoice', [
      '/billing/invoices (src/app/[locale]/(dashboard)/billing/invoices/page.tsx)',
      'slice billing: 1 file(s)',
    ]],
  ])
})

test('placeholders never show: they have no steps to run', () => {
  const config = loadConfig(FIXTURE)
  const placeholder = { ...loadRunbooks(FIXTURE, config).find((rb) => rb.id === 'billing.cancel-invoice'), status: 'placeholder' }
  const hits = affectedRunbooks({
    runbooks: [placeholder],
    entries: extractItems(FIXTURE, config.entries, 'entries').items,
    slices: config.slices,
    changed: [placeholder.path, 'src/app/[locale]/(dashboard)/billing/invoices/page.tsx'],
  })
  assert.deepEqual(hits, [])
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-git-'))
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

// docs/adr/0005: a new version of upstream.schema reaches the runbooks whose calls name a changed operation.
function frontRepo(t, { schemaAtBase = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-schema-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.cpSync(fileURLToPath(new URL('./__fixtures__/front', import.meta.url)), dir, { recursive: true })
  const schema = path.join(dir, 'docs/runbooks/_contract/openapi.json')
  const doc = JSON.parse(fs.readFileSync(schema, 'utf8'))
  if (!schemaAtBase) fs.rmSync(schema)
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('switch', '-q', '-c', 'feature')
  const write = (edit) => fs.writeFileSync(schema, JSON.stringify(edit(structuredClone(doc)), null, 2))
  return { dir, write, commit: () => { git('add', '.'); git('commit', '-qm', 'schema') } }
}

const affectedJson = (dir) => {
  const result = run(['list', '--affected', 'main', '--root', dir, '--json'])
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout).map((rb) => [rb.id, rb.reasons])
}

test('a changed operation in upstream.schema affects the runbooks whose calls name it', (t) => {
  const { dir, write, commit } = frontRepo(t)
  write((doc) => {
    doc.paths['/quotes/{id}/tax-estimate'].post.responses['200'].content['application/json'].schema.required.push('currency')
    return doc
  })
  commit()
  assert.deepEqual(affectedJson(dir), [
    ['quotes.rate-table', ['upstream schema: POST /quotes/{id}/tax-estimate changed']],
  ])
})

test('a changed component reaches every operation that uses it, and the working tree counts', (t) => {
  const { dir, write } = frontRepo(t)
  write((doc) => {
    doc.components.schemas.Quote.properties.total.type = 'string'
    return doc
  })
  assert.deepEqual(affectedJson(dir), [
    ['quotes.list-quotes', ['upstream schema: GET /quotes changed', 'upstream schema: GET /quotes/{id} changed']],
    ['quotes.rate-table', ['upstream schema: GET /quotes/{id} changed']],
  ])
})

test('a removed operation is named as removed, and prose changes affect nothing', (t) => {
  const { dir, write } = frontRepo(t)
  write((doc) => {
    delete doc.paths['/quotes']
    doc.info.description = 'Quotes, now documented'
    return doc
  })
  assert.deepEqual(affectedJson(dir), [['quotes.list-quotes', ['upstream schema: GET /quotes removed']]])
  write((doc) => {
    doc.info.description = 'Quotes, now documented'
    doc.paths['/quotes'].get.summary = 'List the quotes'
    return doc
  })
  assert.deepEqual(affectedJson(dir), [])
})

test('a schema that did not exist at the base gives no schema reason', (t) => {
  const { dir, write } = frontRepo(t, { schemaAtBase: false })
  write((doc) => doc)
  assert.deepEqual(affectedJson(dir), [])
})

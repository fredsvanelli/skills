import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitFrontmatter, parseYaml, FrontmatterError } from './lib/yaml.mjs'

const SAMPLE = `id: billing.issue-invoice
title: Issue a partner invoice
capability: billing
feature: invoices
tags: [financial, critical]
roles: [admin]
covers:
  entries: ["/financeiro/faturas", "POST /admin/internal/invoices"]
  requirements: ["CHE-581#AC2"]
sources: ["docs/specs/x.md", "CHE-581"]
scripts: []
status: draft            # draft | active | deprecated
last_run: { date: 2026-10-16, commit: "abc1234", result: passed, report: _runs/2026-10-16-1432-billing.issue-invoice.md }
`

test('parses the runbook frontmatter shape', () => {
  assert.deepEqual(parseYaml(SAMPLE), {
    id: 'billing.issue-invoice',
    title: 'Issue a partner invoice',
    capability: 'billing',
    feature: 'invoices',
    tags: ['financial', 'critical'],
    roles: ['admin'],
    covers: {
      entries: ['/financeiro/faturas', 'POST /admin/internal/invoices'],
      requirements: ['CHE-581#AC2'],
    },
    sources: ['docs/specs/x.md', 'CHE-581'],
    scripts: [],
    status: 'draft',
    last_run: {
      date: '2026-10-16',
      commit: 'abc1234',
      result: 'passed',
      report: '_runs/2026-10-16-1432-billing.issue-invoice.md',
    },
  })
})

test('block lists work indented or at the key level', () => {
  assert.deepEqual(parseYaml('tags:\n  - a\n  - "b c"\n'), { tags: ['a', 'b c'] })
  assert.deepEqual(parseYaml('tags:\n- a\n- b\nnext: 1\n'), { tags: ['a', 'b'], next: 1 })
})

test('scalars: only plain integers and decimals become numbers', () => {
  assert.deepEqual(parseYaml('a: 12\nb: 0012345\nc: 2026-10-16\nd: true\ne: null\nf: ~\ng:\n'), {
    a: 12, b: '0012345', c: '2026-10-16', d: true, e: null, f: null, g: null,
  })
})

test('a # inside quotes or a word is kept; a spaced # starts a comment', () => {
  assert.deepEqual(parseYaml('title: "Fix #12"\nref: CHE-1#AC2\nx: y # note\n'), {
    title: 'Fix #12', ref: 'CHE-1#AC2', x: 'y',
  })
})

test('a colon inside a plain value stays in the value', () => {
  assert.deepEqual(parseYaml('title: Issue: partner\n'), { title: 'Issue: partner' })
})

test('errors name the line', () => {
  assert.throws(() => parseYaml('id: x\ntitle: [unterminated\n'), (err) => err instanceof FrontmatterError && /^line 2: expected , or \]/.test(err.message))
  assert.throws(() => parseYaml('just text\n'), /line 1: expected "key: value"/)
  assert.throws(() => parseYaml('a:\n\t- x\n'), /line 2: tabs are not allowed/)
  assert.throws(() => parseYaml('a: "open\n'), /line 1: unterminated string/)
  assert.throws(() => parseYaml('a: 1\n    b: 2\n'), /line 2: unexpected indentation/)
})

test('splitFrontmatter handles LF, CRLF, BOM and missing blocks', () => {
  assert.deepEqual(splitFrontmatter('---\na: 1\n---\n# Body\n'), { yaml: 'a: 1', body: '# Body\n' })
  assert.deepEqual(splitFrontmatter('\uFEFF---\r\na: 1\r\n---\r\n# Body\r\n'), { yaml: 'a: 1', body: '# Body\n' })
  assert.equal(splitFrontmatter('# No frontmatter\n'), null)
  assert.equal(splitFrontmatter('---\na: 1\n'), null)
})

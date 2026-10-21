import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setListKeys } from './lib/frontmatter-edit.mjs'
import { splitFrontmatter, parseYaml } from './lib/yaml.mjs'

const doc = (yaml, body = '\n# Title\n\nBody text.\n') => `---\n${yaml}\n---\n${body}`
const data = (text) => parseYaml(splitFrontmatter(text).yaml)

test('a one-line flow list is replaced and calls go after the covers block', () => {
  const before = doc('id: a.b\ncovers:\n  entries: ["/x", "POST /admin/x"]\n  requirements: [REQ-1]\nstatus: active            # draft | active')
  const after = setListKeys(before, { 'covers.entries': ['/x'], calls: ['POST /admin/x'] })
  assert.equal(after, doc('id: a.b\ncovers:\n  entries: [/x]\n  requirements: [REQ-1]\ncalls: [POST /admin/x]\nstatus: active            # draft | active'))
})

test('a flow list over several lines becomes one line', () => {
  const before = doc('covers:\n  entries: [/x,\n    GET /y,\n    GET /z]\nstatus: draft')
  const after = setListKeys(before, { 'covers.entries': ['/x'], calls: ['GET /y', 'GET /z'] })
  assert.equal(after, doc('covers:\n  entries: [/x]\ncalls: [GET /y, GET /z]\nstatus: draft'))
})

test('a block list, deeper or at the key indent, becomes a flow list', () => {
  const deeper = doc('covers:\n  entries:\n    - /deliveries\n    - "GET /deliveries/[id]"\n  requirements: []\nstatus: active')
  assert.equal(setListKeys(deeper, { 'covers.entries': ['/deliveries'], calls: ['GET /deliveries/{id}'] }),
    doc('covers:\n  entries: [/deliveries]\n  requirements: []\ncalls: [GET /deliveries/{id}]\nstatus: active'))
  const same = doc('covers:\n  entries:\n  - /a\n  - GET /b\nstatus: active')
  assert.equal(setListKeys(same, { 'covers.entries': ['/a'] }), doc('covers:\n  entries: [/a]\nstatus: active'))
})

test('an existing calls key is replaced in place', () => {
  const before = doc('calls: [GET /a]\ncovers:\n  entries: [/x, GET /b]\nstatus: active')
  assert.equal(setListKeys(before, { 'covers.entries': ['/x'], calls: ['GET /a', 'GET /b'] }),
    doc('calls: [GET /a, GET /b]\ncovers:\n  entries: [/x]\nstatus: active'))
})

test('an empty entries list stays as [] and an empty calls key goes away', () => {
  const before = doc('covers:\n  entries: [GET /b]\ncalls: [GET /a]\nstatus: active')
  assert.equal(setListKeys(before, { 'covers.entries': [], calls: [] }), doc('covers:\n  entries: []\nstatus: active'))
  const plain = doc('covers:\n  entries: [/x]\nstatus: active')
  assert.equal(setListKeys(plain, { calls: [] }), plain)
})

test('values the parser would misread are quoted', () => {
  const after = setListKeys(doc('covers:\n  entries: [/x]'), { 'covers.entries': ['[odd]', 'a, b', 'say "hi"', '/x #y'] })
  assert.deepEqual(data(after).covers.entries, ['[odd]', 'a, b', 'say "hi"', '/x #y'])
})

test('the body and CRLF line ends stay as they were', () => {
  const before = '---\r\nid: a.b\r\ncovers:\r\n  entries: [/x, GET /y]\r\nstatus: active\r\n---\r\n\r\n# T\r\n\r\ncovers: [not frontmatter]\r\n'
  const after = setListKeys(before, { 'covers.entries': ['/x'], calls: ['GET /y'] })
  assert.equal(after, '---\r\nid: a.b\r\ncovers:\r\n  entries: [/x]\r\ncalls: [GET /y]\r\nstatus: active\r\n---\r\n\r\n# T\r\n\r\ncovers: [not frontmatter]\r\n')
})

test('a missing covers block gets one, and a file without frontmatter throws', () => {
  assert.equal(setListKeys(doc('id: a.b\nstatus: active'), { 'covers.entries': ['/x'], calls: ['GET /y'] }),
    doc('id: a.b\nstatus: active\ncovers:\n  entries: [/x]\ncalls: [GET /y]'))
  assert.throws(() => setListKeys('# no frontmatter\n', { calls: ['GET /y'] }), /no frontmatter block/)
})

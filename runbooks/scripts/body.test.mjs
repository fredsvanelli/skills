import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBody } from './lib/body.mjs'

const UI_BODY = `# Invoice list

---

## Goal

The user sees the invoices.

---

## Preconditions

- Services: \`npm run dev\`
- Accounts: admin (\`ADMIN_EMAIL\` / \`ADMIN_PASSWORD\`)

---

## Steps

### S01. The list shows the invoices

Parents: none
Requirement: none
Page: \`/billing/invoices\`
Design: invoices-list

Actions:

1. Open the page "Invoices".
2. Click "Filter".
3. Type "2026" in "Search".

Expected: The table shows 3 rows.

---

### S02. The list is usable on desktop

Parents: S01
Requirement: none
Page: \`/billing/invoices\`
Viewports: desktop

Expected: The "Export" button is visible.

---

## Not covered

- Email delivery: the browser cannot read mail.

---

## Cleanup

- Delete the invoices created by the seed command.
`

const API_BODY = `# Issue invoice

---

## Goal

The API issues an invoice.

---

## Preconditions

- Test environment: \`php artisan test\`

---

## Steps

### S01. Issuing returns 201

Parents: none
Requirement: none
Endpoint: \`POST /api/invoices\`
As: admin
Request: body \`{"customer": 1}\`

Expected: status 201 and an \`id\` field.

---

## Cleanup

- Isolated by RefreshDatabase.
`

test('lists sections in file order without Steps and separators', () => {
  const { sections } = parseBody(UI_BODY)
  assert.deepEqual(sections.map((s) => s.heading), ['Goal', 'Preconditions', 'Not covered', 'Cleanup'])
  assert.ok(sections.every((s) => !s.html.includes('---')))
})

test('leaves out a missing section and an empty one', () => {
  const noNotCovered = UI_BODY.replace(/## Not covered[\s\S]*?(?=## Cleanup)/, '')
  assert.deepEqual(parseBody(noNotCovered).sections.map((s) => s.heading), ['Goal', 'Preconditions', 'Cleanup'])
  const empty = parseBody('## Goal\n\n---\n\n## Cleanup\n\n- x\n')
  assert.deepEqual(empty.sections.map((s) => s.heading), ['Cleanup'])
})

test('reads the fields and actions of a UI step', () => {
  const { steps } = parseBody(UI_BODY)
  assert.deepEqual(steps.map((s) => s.step), ['S01', 'S02'])
  assert.equal(steps[0].title, 'The list shows the invoices')
  assert.deepEqual(steps[0].fields, [
    { name: 'Parents', value: 'none' },
    { name: 'Requirement', value: 'none' },
    { name: 'Page', value: '/billing/invoices' },
    { name: 'Design', value: 'invoices-list' },
  ])
  assert.ok(steps[0].actions.startsWith('<ol><li>'))
  assert.equal(steps[0].actions.match(/<li>/g).length, 3)
  assert.match(steps[0].expected, /The table shows 3 rows/)
  assert.equal(steps[0].request, null)
})

test('a step without Actions has actions null', () => {
  const { steps } = parseBody(UI_BODY)
  assert.equal(steps[1].actions, null)
  assert.deepEqual(steps[1].fields.at(-1), { name: 'Viewports', value: 'desktop' })
  assert.match(steps[1].expected, /Export/)
})

test('reads the request of an API step', () => {
  const { steps } = parseBody(API_BODY)
  assert.deepEqual(steps[0].fields.map((f) => f.name), ['Parents', 'Requirement', 'Endpoint', 'As'])
  assert.equal(steps[0].fields[2].value, 'POST /api/invoices')
  assert.match(steps[0].request, /customer/)
  assert.equal(steps[0].actions, null)
})

test('a body without sections or Steps', () => {
  assert.deepEqual(parseBody('# Title\n\nno sections'), { sections: [], steps: [] })
  assert.deepEqual(parseBody('## Goal\n\ntext').steps, [])
  assert.deepEqual(parseBody(''), { sections: [], steps: [] })
})

test('escapes HTML in step text', () => {
  const { steps } = parseBody('## Steps\n\n### S01. t\n\nExpected: <img src=x onerror=y>\n')
  assert.ok(!steps[0].expected.includes('<img'))
})

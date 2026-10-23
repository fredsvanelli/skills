import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSteps, parsePreconditionCases } from './lib/steps.mjs'

const BODY = [
  '## Steps', '', '### S01. Lists the invoice', '', 'Parents: none', 'Page: `/billing/invoices`',
  'Actions:', '1. Open "Invoices".', '- editor: this is an action note, not a role line',
  'Expected: the list shows "INV-001".', '- editor: read-only. The "Delete" button does not appear.',
  '- anonymous: denied. Redirects to /signin.', '', '---', '',
  '### S02. Cancels it', '', 'Parents: S01', 'Roles: admin, `manager`', 'As: admin', 'Expected: the status is "Cancelled".',
].join('\n')

test('parseSteps reads Roles, As and the role lines of Expected', () => {
  const [s1, s2] = parseSteps(BODY)
  assert.deepEqual(s1.outcomes, { editor: 'read-only', anonymous: 'denied' })
  assert.deepEqual(s1.roles, [])
  assert.equal(s1.as, null)
  assert.deepEqual(s2.roles, ['admin', 'manager'])
  assert.equal(s2.as, 'admin')
  assert.deepEqual(s2.parents, ['S01'])
  assert.deepEqual(s2.outcomes, {})
})

test('parseSteps reads CRLF bodies the same way', () => {
  assert.deepEqual(parseSteps(BODY.replace(/\n/g, '\r\n')), parseSteps(BODY))
})

test('role lines stop at the next field line', () => {
  const [s] = parseSteps(['### S01. A', 'Expected: ok', '- editor: allowed.', 'Notes:', '- admin: denied.'].join('\n'))
  assert.deepEqual(s.outcomes, { editor: 'allowed' })
})

test('role lines stop at a --- line and at any # heading', () => {
  const body = [
    '### S01. A', 'Expected: ok', '- editor: hidden.', '', '---', '',
    '## Not covered', '', '- persistence: mocked runbooks cannot show it.', '- admin: denied requests leave no trace.', '',
    '## Cleanup', '', '- data: deleted by the script.',
  ].join('\n')
  assert.deepEqual(parseSteps(body)[0].outcomes, { editor: 'hidden' })
  const last = parseSteps(['### S01. A', 'Expected: ok', '# Notes', '- admin: denied.'].join('\n'))[0]
  assert.deepEqual(last.outcomes, {})
})

test('a bullet in Expected is a role line only when its keyword is an outcome', () => {
  const [s] = parseSteps(['### S01. A', 'Expected: the invoice shows:', '- status: paid', '- total: 100', '- ghost: denied.'].join('\n'))
  assert.deepEqual(s.outcomes, { ghost: 'denied' })
})

test('parseSteps reads Cases: lines and role lines with cases', () => {
  const body = [
    '### S02. Edit', '', 'Parents: S01', 'Cases: vip-team, regular',
    'Expected: the page shows "Saved".',
    '- manager in vip-outside: read-only. No "Edit".',
    '- manager in vip-team,regular: partial. No "Delete".',
    '- viewer: read-only. No "Edit".',
    '- viewer: hidden. Twice.',
  ].join('\r\n')
  const [step] = parseSteps(body)
  assert.deepEqual(step.cases, ['vip-team', 'regular'])
  assert.deepEqual(step.outcomes, { viewer: 'hidden' })
  assert.deepEqual(step.caseOutcomes, { manager: { 'vip-outside': 'read-only', 'vip-team': 'partial', regular: 'partial' } })
  assert.deepEqual(step.duplicates, ['viewer'])
})

test('parseSteps labels a repeated role and case by role and case', () => {
  const [step] = parseSteps([
    '### S01. A', 'Expected: ok',
    '- manager in vip-team: read-only.',
    '- manager in vip-team, regular: partial.',
    '- manager in regular: hidden.',
  ].join('\n'))
  assert.deepEqual(step.duplicates, ['manager in vip-team', 'manager in regular'])
  assert.deepEqual(parseSteps('### S01. A\nExpected: ok\n- manager: allowed.')[0].duplicates, [])
  assert.deepEqual(parseSteps('### S01. A')[0].cases, [])
})

test('parseSteps handles a role named constructor with cases', () => {
  const [step] = parseSteps('### S01. A\nExpected: ok\n- constructor in regular: hidden.\n- constructor: denied.')
  assert.deepEqual(step.caseOutcomes.constructor, { regular: 'hidden' })
  assert.equal(step.outcomes.constructor, 'denied')
  assert.deepEqual(step.duplicates, [])
})

test('parsePreconditionCases reads the Cases: bullets of Preconditions', () => {
  const body = '## Preconditions\n\n- Account: each role.\n- Cases:\n  - vip-team: client "ACME".\n  - regular: client "Initech".\n\n---\n\n## Steps\n'
  assert.deepEqual(parsePreconditionCases(body), { 'vip-team': 'client "ACME".', regular: 'client "Initech".' })
  assert.deepEqual(parsePreconditionCases(body.replace(/\n/g, '\r\n')), { 'vip-team': 'client "ACME".', regular: 'client "Initech".' })
  assert.deepEqual(parsePreconditionCases('## Preconditions\n\n- Data: one client.\n'), {})
  assert.deepEqual(parsePreconditionCases('## Preconditions\n\n- Cases:\n  - a: x\n## Steps\n  - b: y\n'), { a: 'x' })
})

test('lines inside a code block are never fields or role lines', () => {
  const [s] = parseSteps([
    '### S01. A', 'Parents: none', 'Request:', '', '```http', 'GET /quotes/airports', 'Authorization: Bearer <token>', 'Parents: S09', '```', '',
    'Expected: 200.', '', '```json', '{ "status": "paid" }', 'Note: inside', '- viewer: denied.', '```', '',
    'The items come in this order.', '- editor: denied. 403 with', '', '  ```json', '  { "error": "forbidden" }', '  ```',
  ].join('\n'))
  assert.deepEqual(s.parents, [])
  assert.deepEqual(s.outcomes, { editor: 'denied' })
})

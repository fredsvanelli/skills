import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSteps } from './lib/steps.mjs'

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

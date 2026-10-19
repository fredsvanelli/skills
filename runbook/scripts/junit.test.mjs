import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSteps, parseJunit, stepOfTest, stepStates } from './lib/junit.mjs'
import { run } from './runbook.mjs'

const BODY = `# Create an invoice

## Steps

### S01. Admin creates a draft invoice

Parents: none
Endpoint: \`POST /invoices\`

### S02. The invoice persists

Parents: S01

### S03. A partner cannot create one

Parents: none

### S04. The draft can be cancelled

Parents: \`S02\`

### S05. The partner gets an e-mail

Parents: S01
`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="InvoiceTest">
    <testcase classname="Invoice" name="S01 admin creates a draft invoice" time="0.1"/>
    <testcase classname="Invoice" name="test_s02_the_invoice_persists">
      <failure message="expected 200, got 404 &amp; no body">stack</failure>
    </testcase>
    <testcase classname="Invoice" name="testS03PartnerCannotCreate"></testcase>
    <testcase classname="Invoice" name="S04 cancels the draft"/>
    <testcase classname="Invoice" name="S05 mails the partner"><skipped/></testcase>
    <testcase classname="Invoice" name="S06 jest failure"><failure>Error: expect(received).toBe(expected) // Object.is equality

Expected: &quot;INV-2026-09-9999&quot;
Received: &quot;INV-2026-09-0001&quot;
    at Object.toBe (/app/x.test.ts:274:34)</failure></testcase>
    <testcase classname="Invoice" name="S07 phpunit failure"><failure>Failed asserting that 404 is identical to 200.

/app/tests/Feature/InvoiceTest.php:42</failure></testcase>
    <testcase classname="Invoice" name="S09 something else"/>
    <testcase classname="Invoice" name="lists invoices with a filter &gt; 10"><error><![CDATA[TypeError: x is undefined
    at y]]></error></testcase>
  </testsuite>
</testsuites>`

test('parseSteps reads ids, titles and parents', () => {
  assert.deepEqual(parseSteps(BODY).map((s) => [s.step, s.parents]), [
    ['S01', []], ['S02', ['S01']], ['S03', []], ['S04', ['S02']], ['S05', ['S01']],
  ])
})

test('parseJunit reads outcomes and the first line of a failure', () => {
  const cases = parseJunit(XML)
  assert.equal(cases.length, 9)
  assert.equal(cases[5].seen, 'Error: expect(received).toBe(expected) // Object.is equality · Expected: "INV-2026-09-9999" · Received: "INV-2026-09-0001"')
  assert.equal(cases[6].seen, 'Failed asserting that 404 is identical to 200.')
  assert.deepEqual(cases[1], { name: 'test_s02_the_invoice_persists', classname: 'Invoice', outcome: 'failed', seen: 'expected 200, got 404 & no body' })
  assert.equal(cases[4].outcome, 'skipped')
  assert.deepEqual(cases[8], { name: 'lists invoices with a filter > 10', classname: 'Invoice', outcome: 'failed', seen: 'TypeError: x is undefined' })
})

test('stepOfTest matches the Sxx prefix in common naming styles', () => {
  const step = (name) => stepOfTest({ name })
  assert.equal(step('S01 creates'), 'S01')
  assert.equal(step('test_s02_persists'), 'S02')
  assert.equal(step('testS03Partner'), 'S03')
  assert.equal(step('returns 201 with S3 bucket'), null)
  assert.equal(step('SS01'), null)
})

test('stepStates resolves blocked-by-parent and keeps other tests out of the result', () => {
  const result = stepStates(parseSteps(BODY), parseJunit(XML))
  assert.deepEqual(result.steps.map((s) => [s.step, s.state]), [
    ['S01', 'passed'], ['S02', 'failed'], ['S03', 'passed'], ['S04', 'blocked-by-parent'], ['S05', 'blocked'],
  ])
  assert.equal(result.steps[3].seen, 'parent S02 did not pass')
  assert.equal(result.result, 'failed')
  assert.deepEqual(result.extra, [{ step: 'S06', test: 'S06 jest failure' }, { step: 'S07', test: 'S07 phpunit failure' }, { step: 'S09', test: 'S09 something else' }])
  assert.deepEqual(result.others.map((o) => o.outcome), ['failed'])
})

test('a waived step ignores its test and does not block its children', () => {
  const result = stepStates(parseSteps(BODY), parseJunit(XML), { waived: ['S02'] })
  assert.deepEqual(result.steps.map((s) => s.state), ['passed', 'waived', 'passed', 'passed', 'blocked'])
  assert.equal(result.result, 'blocked')
})

test('a step with no test is blocked; a step with two tests takes the worst outcome', () => {
  const xml = '<testsuite><testcase name="S01 a"/><testcase name="S01 b"><failure message="no"/></testcase></testsuite>'
  const result = stepStates(parseSteps('### S01. a\nParents: none\n### S02. b\nParents: none\n'), parseJunit(xml))
  assert.deepEqual(result.steps.map((s) => [s.step, s.state, s.seen]), [['S01', 'failed', 'no'], ['S02', 'blocked', 'no test for this step in the script']])
  assert.deepEqual(result.steps.map((s) => s.tests.length), [2, 0])
})

test('a cycle in the dependency tree is an error', () => {
  assert.throws(() => stepStates(parseSteps('### S01. a\nParents: S02\n### S02. b\nParents: S01\n'), []), /cycle through S0/)
})

test('runbook.mjs junit reads the runbook and the report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-junit-'))
  const write = (rel, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  write('docs/runbooks/runbook.config.json', '{ "version": 1, "stack": "backend" }')
  write('docs/runbooks/billing/create-invoice.md', `---\nid: billing.create-invoice\ncapability: billing\nsurface: api\nstatus: draft\n---\n${BODY}`)
  write('.runbook/junit/run.xml', XML)
  const json = run(['junit', 'billing.create-invoice', '--file', '.runbook/junit/run.xml', '--root', dir, '--json'])
  assert.equal(json.code, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).result, 'failed')
  const md = run(['junit', 'billing.create-invoice', '--file', '.runbook/junit/run.xml', '--root', dir])
  assert.match(md.stdout, /^States: passed,failed,passed,blocked-by-parent,blocked$/m)
  assert.match(md.stdout, /### Other tests in the file/)
  const missing = run(['junit', 'billing.create-invoice', '--file', 'nope.xml', '--root', dir])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /the test command wrote no JUnit report/)
})

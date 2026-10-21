import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSteps, parseJunit, roleOfTest, stepOfTest, stepStates, viewportOfTest } from './lib/junit.mjs'
import { nextStatus } from './lib/status.mjs'
import { junitMarkdown } from './lib/format.mjs'
import { run } from './runbooks.mjs'

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

test('runbooks.mjs junit reads the runbook and the report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-junit-'))
  const write = (rel, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  write('docs/runbooks/runbooks.config.json', '{ "version": 1, "stack": "backend" }')
  write('docs/runbooks/billing/create-invoice.md', `---\nid: billing.create-invoice\ncapability: billing\nsurface: api\nstatus: draft\n---\n${BODY}`)
  write('.runbooks/junit/run.xml', XML)
  const json = run(['junit', 'billing.create-invoice', '--file', '.runbooks/junit/run.xml', '--root', dir, '--json'])
  assert.equal(json.code, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).result, 'failed')
  const md = run(['junit', 'billing.create-invoice', '--file', '.runbooks/junit/run.xml', '--root', dir])
  assert.match(md.stdout, /^States: passed,failed,passed,blocked-by-parent,blocked$/m)
  assert.match(md.stdout, /### Other tests in the file/)
  const missing = run(['junit', 'billing.create-invoice', '--file', 'nope.xml', '--root', dir])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /the test command wrote no JUnit report/)
})

const BODY_VP = `### S01. Open the list

Parents: none

### S02. Filter the list

Parents: S01

### S03. Desktop-only export

Parents: none
Viewports: desktop
`

const CASES_VP = [
  ['S01 a @ desktop', 'passed'], ['S01 a @ mobile', 'failed'],
  ['S02 b @ desktop', 'passed'], ['S02 b @ mobile', 'passed'],
  ['S03 c @ desktop', 'passed'], ['S03 c @ tablet', 'passed'],
].map(([name, outcome]) => ({ name, classname: 'ui', outcome, seen: outcome === 'failed' ? 'boom' : '' }))

test('parseSteps reads the Viewports line and viewportOfTest the trailing viewport', () => {
  assert.deepEqual(parseSteps(BODY_VP).map((s) => s.viewports), [[], [], ['desktop']])
  assert.deepEqual(parseSteps('### S01. a\nViewports: none\n').map((s) => s.viewports), [[]])
  assert.equal(viewportOfTest({ name: 'S01 a @ mobile' }), 'mobile')
  assert.equal(viewportOfTest({ name: 'S01 a @mobile ' }), 'mobile')
  assert.equal(viewportOfTest({ name: 'S01 a' }), null)
})

test('stepStates gives one state per step and viewport', () => {
  const { steps, result, extra } = stepStates(parseSteps(BODY_VP), CASES_VP, { viewports: ['desktop', 'mobile'] })
  assert.deepEqual(steps.map((s) => `${s.viewport} ${s.step} ${s.state}`), [
    'desktop S01 passed', 'desktop S02 passed', 'desktop S03 passed',
    'mobile S01 failed', 'mobile S02 blocked-by-parent',
  ])
  assert.equal(result, 'failed')
  assert.deepEqual(extra, [{ step: 'S03', viewport: 'tablet', test: 'S03 c @ tablet' }])
  assert.deepEqual(steps[3], { step: 'S01', viewport: 'mobile', title: 'Open the list', state: 'failed', seen: 'boom', tests: ['S01 a @ mobile'] })
})

test('per viewport: a step that does not run there sends its test to extra, a missing test blocks, a waiver spans viewports', () => {
  const cases = [
    { name: 'S03 c @ mobile', outcome: 'passed', seen: '' },
    { name: 'S09 z', outcome: 'passed', seen: '' },
    { name: 'plain', outcome: 'passed', seen: '' },
  ]
  const { steps, extra, others } = stepStates(parseSteps(BODY_VP), cases, { viewports: ['desktop', 'mobile'], waived: ['S01'] })
  assert.deepEqual(steps.map((s) => `${s.viewport} ${s.step} ${s.state}`), [
    'desktop S01 waived', 'desktop S02 blocked', 'desktop S03 blocked',
    'mobile S01 waived', 'mobile S02 blocked',
  ])
  assert.deepEqual(extra, [
    { step: 'S03', viewport: 'mobile', test: 'S03 c @ mobile' },
    { step: 'S09', viewport: null, test: 'S09 z' },
  ])
  assert.equal(others.length, 1)
})

test('junitMarkdown shows the Viewport column only when rows carry a viewport', () => {
  const vp = stepStates(parseSteps(BODY_VP), CASES_VP, { viewports: ['desktop', 'mobile'] })
  const md = junitMarkdown({ id: 'x.y', ...vp })
  assert.match(md, /\| Viewport \|/)
  assert.match(md, /^States: passed,passed,passed,failed,blocked-by-parent$/m)
  assert.match(md, /S03 \(tablet\)|S03 \(S03 c @ tablet\)/)
  assert.doesNotMatch(junitMarkdown({ id: 'x.y', ...stepStates(parseSteps(BODY), parseJunit(XML)) }), /Viewport/)
})

test('runbooks.mjs junit passes the runbook viewports through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks-junit-vp-'))
  const write = (rel, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  write('docs/runbooks/runbooks.config.json', '{ "version": 1, "stack": "frontend", "viewports": { "desktop": { "width": 1280, "height": 800 }, "mobile": { "width": 390, "height": 844 } } }')
  write('docs/runbooks/billing/list.md', `---\nid: billing.list\ncapability: billing\nsurface: ui\nstatus: draft\nviewports: [desktop, mobile]\n---\n${BODY_VP}`)
  const xml = `<testsuite>${CASES_VP.map((c) => `<testcase name="${c.name}">${c.outcome === 'failed' ? '<failure message="boom"/>' : ''}</testcase>`).join('')}</testsuite>`
  write('.runbooks/junit/run.xml', xml)
  const out = run(['junit', 'billing.list', '--file', '.runbooks/junit/run.xml', '--root', dir, '--json'])
  assert.equal(out.code, 0, out.stderr)
  const parsed = JSON.parse(out.stdout)
  assert.equal(parsed.result, 'failed')
  assert.equal(parsed.steps.length, 5)
})

const ROLE_BODY = `### S01. Lists the invoices

Parents: none

Expected: the list shows.
- viewer: denied.

### S02. Cancels an invoice

Parents: S01

### S03. Reloads the list

Parents: S02
`

const xmlOf = (names) => `<testsuite>${names.map((name) => `<testcase name="${name}"/>`).join('')}</testsuite>`

test('roleOfTest reads the role suffix only for the runbook roles', () => {
  assert.equal(roleOfTest({ name: 'S01 creates an invoice as editor @ mobile' }, ['editor']), 'editor')
  assert.equal(roleOfTest({ name: 'S01 creates an invoice as Editor' }, ['editor']), 'editor')
  assert.equal(roleOfTest({ name: 'S01 logs in as a guest' }, ['editor']), null)
})

test('stepStates closes the branch after a denied parent', () => {
  const steps = parseSteps(ROLE_BODY)
  const cases = parseJunit(xmlOf(['S01 lists as admin', 'S02 cancels as admin', 'S03 reloads as admin', 'S01 lists as viewer']))
  const { steps: rows, result, extra } = stepStates(steps, cases, { roles: ['admin', 'viewer', 'editor'], noAccount: ['editor'] })
  assert.deepEqual(rows.filter((r) => r.role === 'viewer').map((r) => r.state), ['passed', 'not-applicable', 'not-applicable'])
  assert.deepEqual(rows.filter((r) => r.role === 'editor').map((r) => r.state), ['no-account', 'no-account', 'no-account'])
  assert.equal(rows.find((r) => r.role === 'editor').seen, 'no account for editor')
  assert.deepEqual(rows.map((r) => r.role), ['admin', 'admin', 'admin', 'viewer', 'viewer', 'viewer', 'editor', 'editor', 'editor'])
  assert.equal(result, 'passed')
  assert.deepEqual(extra, [])
})

test('stepStates sends tests without a role, for a not-applicable step or for a no-account role to extra', () => {
  const steps = parseSteps(ROLE_BODY)
  const cases = parseJunit(xmlOf(['S01 lists as admin', 'S02 cancels as admin', 'S03 reloads as admin', 'S01 lists', 'S01 lists as viewer', 'S02 cancels as viewer', 'S01 lists as editor']))
  const { extra } = stepStates(steps, cases, { roles: ['admin', 'viewer', 'editor'], noAccount: ['editor'] })
  assert.deepEqual(extra.map((e) => e.test).sort(), ['S01 lists', 'S01 lists as editor', 'S02 cancels as viewer'])
})

test('stepStates orders rows by role, then viewport, then step', () => {
  const steps = parseSteps(ROLE_BODY)
  const { steps: rows } = stepStates(steps, [], { roles: ['admin', 'viewer'], viewports: ['desktop', 'mobile'] })
  assert.deepEqual(rows.slice(0, 4).map((r) => `${r.role}|${r.viewport}|${r.step}`), ['admin|desktop|S01', 'admin|desktop|S02', 'admin|desktop|S03', 'admin|mobile|S01'])
  assert.equal(rows[6].role, 'viewer')
})

test('stepStates applies waived to every role', () => {
  const steps = parseSteps(ROLE_BODY)
  const { steps: rows } = stepStates(steps, [], { roles: ['admin', 'viewer'], waived: ['S02'] })
  assert.deepEqual(rows.filter((r) => r.step === 'S02').map((r) => r.state), ['waived', 'waived'])
})

test('stepStates without roles is unchanged', () => {
  const steps = parseSteps(BODY)
  const cases = parseJunit(XML)
  assert.deepEqual(stepStates(steps, cases, { roles: [] }), stepStates(steps, cases))
  assert.equal('role' in stepStates(steps, cases).steps[0], false)
})

test('nextStatus accepts not-applicable and no-account', () => {
  assert.equal(nextStatus('draft', ['passed', 'not-applicable', 'no-account']), 'active')
  assert.equal(nextStatus('draft', ['not-applicable', 'no-account']), 'draft')
})

test('junitMarkdown does not list no-account and not-applicable rows as missing tests', () => {
  const row = (step, role, state) => ({ step, role, title: '', state, seen: '', tests: [] })
  const base = { id: 'x', result: 'passed', extra: [], others: [] }
  const quiet = junitMarkdown({ ...base, steps: [row('S01', 'editor', 'no-account'), row('S02', 'viewer', 'not-applicable')] })
  assert.doesNotMatch(quiet, /Steps with no test/)
  const loud = junitMarkdown({ ...base, steps: [row('S01', 'editor', 'no-account'), row('S02', 'admin', 'blocked')] })
  assert.match(loud, /Steps with no test: S02 as admin/)
})

test('with roles, each extra test names why it maps to no row', () => {
  const steps = parseSteps(`${ROLE_BODY}\n### S04. Approves\n\nParents: none\nRoles: admin\n`)
  const cases = parseJunit(xmlOf([
    'S01 lists as admin', 'S02 cancels as admin', 'S03 reloads as admin', 'S04 approves as admin', 'S01 lists as viewer',
    'S01 lists', 'S01 lists as ghost', 'S01 lists as editor', 'S02 cancels as viewer', 'S04 approves as viewer', 'S09 other as admin',
  ]))
  const { extra } = stepStates(steps, cases, { roles: ['admin', 'viewer', 'editor'], noAccount: ['editor'] })
  assert.deepEqual(extra.map((e) => [e.test, e.reason]), [
    ['S01 lists', 'no " as <role>" suffix'],
    ['S01 lists as ghost', 'ghost is not one of the runbook\'s roles'],
    ['S01 lists as editor', 'editor has no account'],
    ['S04 approves as viewer', 'S04 does not run for viewer'],
    ['S09 other as admin', 'the runbook has no S09'],
    ['S02 cancels as viewer', 'S02 is not-applicable for viewer'],
  ])
  const vp = stepStates(steps, parseJunit(xmlOf(['S01 lists as admin', 'S01 lists as admin @ tablet'])), { roles: ['admin'], viewports: ['desktop'] })
  assert.deepEqual(vp.extra.map((e) => e.reason), ['no " @ <viewport>" suffix', 'tablet is not one of the runbook\'s viewports'])
})

test('junitMarkdown names the reason of each extra test with roles, and keeps the 1.5.0 line without them', () => {
  const steps = parseSteps(ROLE_BODY)
  const roles = stepStates(steps, parseJunit(xmlOf(['S01 lists as admin', 'S01 lists'])), { roles: ['admin'] })
  assert.match(junitMarkdown({ id: 'x', ...roles }), /^Tests that match no step to run: S01 \(S01 lists\): no " as <role>" suffix$/m)
  const plain = junitMarkdown({ id: 'x', ...stepStates(parseSteps(BODY), parseJunit(XML)) })
  assert.match(plain, /^Tests for steps the runbook does not have: S06 \(S06 jest failure\); S07 \(S07 phpunit failure\); S09 \(S09 something else\)$/m)
})

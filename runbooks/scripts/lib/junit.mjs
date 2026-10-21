// Maps a JUnit XML report onto a runbook's steps; see docs/adr/0001.

import { CLOSING_OUTCOMES } from './roles.mjs'

const VIEWPORT_IN_NAME = /@\s*([a-z0-9][a-z0-9-]*)\s*$/i
// S01 at the start of a word or after "test"/"test_": "S01 creates", "test_s01_creates", "testS01Creates".
const STEP_IN_NAME = /(?:^|[^A-Za-z0-9]|test_?)(S\d{2,})(?![0-9])/i
const ROLE_IN_NAME = /\bas\s+([a-z0-9][a-z0-9-]*)\s*(?:@\s*[a-z0-9][a-z0-9-]*\s*)?$/i
const BLOCKING = ['failed', 'blocked', 'blocked-by-parent']

export { parseSteps } from './steps.mjs'

const decode = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const attributes = (text) =>
  Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], decode(m[2] ?? m[3])]))

// The message lines before the stack trace: Jest puts Expected/Received there, PHPUnit the assertion.
const failureText = (text) => {
  const lines = decode(text.replace(/<!\[CDATA\[|\]\]>/g, '')).split('\n').map((line) => line.trim())
  const end = lines.findIndex((line) => /^at |^\/|^[A-Z]:\\/.test(line))
  return lines.slice(0, end === -1 ? undefined : end).filter(Boolean).join(' · ')
}

export function parseJunit(xml) {
  const cases = []
  const pattern = /<testcase\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?:\/>|>([\s\S]*?)<\/testcase>)/g
  for (const match of xml.matchAll(pattern)) {
    const attrs = attributes(match[1])
    const inner = match[2] ?? ''
    const problem = inner.match(/<(failure|error)\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?:\/>|>([\s\S]*?)<\/\1>)/)
    const skipped = /<skipped\b/.test(inner)
    const outcome = problem ? 'failed' : skipped ? 'skipped' : 'passed'
    const seen = problem ? attributes(problem[2]).message || failureText(problem[3] ?? '') : ''
    cases.push({ name: attrs.name ?? '', classname: attrs.classname ?? '', outcome, seen })
  }
  return cases
}

export function stepOfTest(testCase) {
  const match = testCase.name.match(STEP_IN_NAME)
  return match ? match[1].toUpperCase() : null
}

export function viewportOfTest(testCase) {
  const match = testCase.name.match(VIEWPORT_IN_NAME)
  return match ? match[1].toLowerCase() : null
}

export function roleOfTest(testCase, roles) {
  const match = testCase.name.match(ROLE_IN_NAME)
  const role = match ? match[1].toLowerCase() : null
  return role && roles.includes(role) ? role : null
}

// Own state of one step from its tests.
const ownState = (tests) => {
  if (tests.length === 0) return { state: 'blocked', seen: 'no test for this step in the script' }
  const failed = tests.find((t) => t.outcome === 'failed')
  if (failed) return { state: 'failed', seen: failed.seen }
  if (tests.some((t) => t.outcome === 'skipped')) return { state: 'blocked', seen: 'test skipped' }
  return { state: 'passed', seen: '' }
}

// Rows for the steps that run in one context (the whole runbook, one viewport, one role).
// testsOf(step) returns that step's tests in the context. role is null without roles;
// noAccount is true when the role has no login.
function resolveRows(active, testsOf, waived, { role = null, noAccount = false } = {}) {
  const known = new Set(active.map((s) => s.step))
  const resolved = new Map()
  const resolve = (step, visiting = new Set()) => {
    if (resolved.has(step)) return resolved.get(step)
    if (visiting.has(step)) throw new Error(`the dependency tree has a cycle through ${step}`)
    visiting.add(step)
    const { parents } = active.find((s) => s.step === step)
    const parentStates = parents.filter((p) => known.has(p)).map((p) => ({ step: p, ...resolve(p, visiting) }))
    const blockedBy = parentStates.filter((p) => BLOCKING.includes(p.state)).map((p) => p.step)
    const closes = (p) => p.state === 'not-applicable'
      || (p.state === 'passed' && CLOSING_OUTCOMES.includes(active.find((s) => s.step === p.step).outcomes?.[role]))
    const result = noAccount ? { state: 'no-account', seen: `no account for ${role}` }
      : waived.includes(step) ? { state: 'waived', seen: '' }
      : blockedBy.length > 0 ? { state: 'blocked-by-parent', seen: `parent ${blockedBy.join(', ')} did not pass` }
      : role && parentStates.some(closes) ? { state: 'not-applicable', seen: '' }
      : ownState(testsOf(step))
    resolved.set(step, result)
    return result
  }
  return active.map(({ step, title }) => {
    const result = resolve(step)
    const tests = result.state === 'not-applicable' || result.state === 'no-account' ? [] : testsOf(step)
    return { step, title, ...result, tests: tests.map((t) => t.name) }
  })
}

const overall = (rows) => {
  const states = rows.map((row) => row.state)
  return states.includes('failed') ? 'failed'
    : states.some((s) => s === 'blocked' || s === 'blocked-by-parent') ? 'blocked'
    : 'passed'
}

// With roles, each role runs the steps in turn (and inside it each viewport), and each row has a role.
export function stepStates(steps, cases, { waived = [], viewports = [], roles = [], noAccount = [] } = {}) {
  const known = new Set(steps.map((s) => s.step))
  const byKey = new Map()
  const others = []
  const extra = []
  const multi = viewports.length > 0
  const withRoles = roles.length > 0
  const keyOf = (role, viewport, step) => `${role ?? ''}|${viewport ?? ''}|${step}`
  const stepOf = (step) => steps.find((s) => s.step === step)
  const runsAt = (step, viewport) => {
    const { viewports: only } = stepOf(step)
    return only.length === 0 || only.includes(viewport)
  }
  const runsFor = (step, role) => {
    const { roles: only } = stepOf(step)
    return only.length === 0 || only.includes(role)
  }
  // With roles, each entry says why the test maps to no row; without them entries keep their 1.5.0 shape.
  const extraEntry = (step, role, viewport, test, reason) =>
    ({ step, ...(withRoles ? { role } : {}), ...(multi ? { viewport } : {}), test, ...(withRoles ? { reason } : {}) })
  // Why a test of a known step maps to no row, or null when it maps to one.
  const mismatch = (testCase, step, role, viewport) => {
    if (withRoles && !role) {
      const written = testCase.name.match(ROLE_IN_NAME)?.[1].toLowerCase()
      return written ? `${written} is not one of the runbook's roles` : 'no " as <role>" suffix'
    }
    if (withRoles && noAccount.includes(role)) return `${role} has no account`
    if (withRoles && !runsFor(step, role)) return `${step} does not run for ${role}`
    if (multi && !viewport) return 'no " @ <viewport>" suffix'
    if (multi && !viewports.includes(viewport)) return `${viewport} is not one of the runbook's viewports`
    if (multi && !runsAt(step, viewport)) return `${step} does not run at ${viewport}`
    return null
  }
  for (const testCase of cases) {
    const step = stepOfTest(testCase)
    const viewport = multi ? viewportOfTest(testCase) : null
    const role = withRoles ? roleOfTest(testCase, roles) : null
    const reason = !step ? null : !known.has(step) ? `the runbook has no ${step}` : mismatch(testCase, step, role, viewport)
    if (!step) others.push(testCase)
    else if (reason) extra.push(extraEntry(step, role, viewport, testCase.name, reason))
    else byKey.set(keyOf(role, viewport, step), [...(byKey.get(keyOf(role, viewport, step)) ?? []), testCase])
  }

  const rows = []
  for (const role of withRoles ? roles : [null]) {
    for (const viewport of multi ? viewports : [null]) {
      const active = steps.filter((s) => (!withRoles || runsFor(s.step, role)) && (!multi || runsAt(s.step, viewport)))
      const testsOf = (step) => byKey.get(keyOf(role, viewport, step)) ?? []
      const context = { role, noAccount: withRoles && noAccount.includes(role) }
      for (const { step, ...rest } of resolveRows(active, testsOf, waived, context)) {
        if (rest.state === 'not-applicable') {
          for (const test of testsOf(step)) extra.push(extraEntry(step, role, viewport, test.name, `${step} is not-applicable for ${role}`))
        }
        rows.push({ step, ...(withRoles ? { role } : {}), ...(multi ? { viewport } : {}), ...rest })
      }
    }
  }
  return { steps: rows, result: overall(rows), extra, others }
}

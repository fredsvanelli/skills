// Maps a JUnit XML report onto a runbook's steps; see docs/adr/0001.

const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const PARENTS_LINE = /^Parents:\s*(.*)$/
const VIEWPORTS_LINE = /^Viewports:\s*(.*)$/
const VIEWPORT_IN_NAME = /@\s*([a-z0-9][a-z0-9-]*)\s*$/i
// S01 at the start of a word or after "test"/"test_": "S01 creates", "test_s01_creates", "testS01Creates".
const STEP_IN_NAME = /(?:^|[^A-Za-z0-9]|test_?)(S\d{2,})(?![0-9])/i
const BLOCKING = ['failed', 'blocked', 'blocked-by-parent']

const nameList = (text) => text.split(',').map((p) => p.trim().replace(/`/g, '')).filter((p) => p && p !== 'none')

export function parseSteps(body) {
  const steps = []
  for (const line of body.split('\n')) {
    const heading = line.match(STEP_HEADING)
    if (heading) {
      steps.push({ step: heading[1], title: heading[2].trim(), parents: [], viewports: [] })
      continue
    }
    const parents = line.match(PARENTS_LINE)
    if (parents && steps.length > 0) {
      steps.at(-1).parents = nameList(parents[1])
    }
    const viewports = line.match(VIEWPORTS_LINE)
    if (viewports && steps.length > 0) steps.at(-1).viewports = nameList(viewports[1])
  }
  return steps
}

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

// Own state of one step from its tests.
const ownState = (tests) => {
  if (tests.length === 0) return { state: 'blocked', seen: 'no test for this step in the script' }
  const failed = tests.find((t) => t.outcome === 'failed')
  if (failed) return { state: 'failed', seen: failed.seen }
  if (tests.some((t) => t.outcome === 'skipped')) return { state: 'blocked', seen: 'test skipped' }
  return { state: 'passed', seen: '' }
}

// Rows for the steps that run in one context (the whole runbook, or one viewport).
// testsOf(step) returns that step's tests in the context.
function resolveRows(active, testsOf, waived) {
  const known = new Set(active.map((s) => s.step))
  const resolved = new Map()
  const resolve = (step, visiting = new Set()) => {
    if (resolved.has(step)) return resolved.get(step)
    if (visiting.has(step)) throw new Error(`the dependency tree has a cycle through ${step}`)
    visiting.add(step)
    const { parents } = active.find((s) => s.step === step)
    const blockedBy = parents.filter((p) => known.has(p) && BLOCKING.includes(resolve(p, visiting).state))
    const result = waived.includes(step) ? { state: 'waived', seen: '' }
      : blockedBy.length > 0 ? { state: 'blocked-by-parent', seen: `parent ${blockedBy.join(', ')} did not pass` }
      : ownState(testsOf(step))
    resolved.set(step, result)
    return result
  }
  return active.map(({ step, title }) => ({ step, title, ...resolve(step), tests: testsOf(step).map((t) => t.name) }))
}

const overall = (rows) => {
  const states = rows.map((row) => row.state)
  return states.includes('failed') ? 'failed'
    : states.some((s) => s === 'blocked' || s === 'blocked-by-parent') ? 'blocked'
    : 'passed'
}

export function stepStates(steps, cases, { waived = [], viewports = [] } = {}) {
  const known = new Set(steps.map((s) => s.step))
  const byStep = new Map()
  const others = []
  const extra = []
  const multi = viewports.length > 0
  const runsAt = (step, viewport) => {
    const { viewports: only } = steps.find((s) => s.step === step)
    return only.length === 0 || only.includes(viewport)
  }
  for (const testCase of cases) {
    const step = stepOfTest(testCase)
    const viewport = viewportOfTest(testCase)
    const entry = (extraStep) => (multi ? { step: extraStep, viewport, test: testCase.name } : { step: extraStep, test: testCase.name })
    if (!step) others.push(testCase)
    else if (!known.has(step)) extra.push(entry(step))
    else if (!multi) byStep.set(step, [...(byStep.get(step) ?? []), testCase])
    else if (!viewports.includes(viewport) || !runsAt(step, viewport)) extra.push(entry(step))
    else byStep.set(`${viewport}|${step}`, [...(byStep.get(`${viewport}|${step}`) ?? []), testCase])
  }

  if (!multi) {
    const rows = resolveRows(steps, (step) => byStep.get(step) ?? [], waived)
    return { steps: rows, result: overall(rows), extra, others }
  }
  const rows = viewports.flatMap((viewport) => {
    const active = steps.filter((s) => runsAt(s.step, viewport))
    return resolveRows(active, (step) => byStep.get(`${viewport}|${step}`) ?? [], waived)
      .map(({ step, ...rest }) => ({ step, viewport, ...rest }))
  })
  return { steps: rows, result: overall(rows), extra, others }
}

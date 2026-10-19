// Maps a JUnit XML report onto a runbook's steps; see docs/adr/0001.

const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const PARENTS_LINE = /^Parents:\s*(.*)$/
// S01 at the start of a word or after "test"/"test_": "S01 creates", "test_s01_creates", "testS01Creates".
const STEP_IN_NAME = /(?:^|[^A-Za-z0-9]|test_?)(S\d{2,})(?![0-9])/i
const BLOCKING = ['failed', 'blocked', 'blocked-by-parent']

export function parseSteps(body) {
  const steps = []
  for (const line of body.split('\n')) {
    const heading = line.match(STEP_HEADING)
    if (heading) {
      steps.push({ step: heading[1], title: heading[2].trim(), parents: [] })
      continue
    }
    const parents = line.match(PARENTS_LINE)
    if (parents && steps.length > 0) {
      steps.at(-1).parents = parents[1].split(',').map((p) => p.trim().replace(/`/g, '')).filter((p) => p && p !== 'none')
    }
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

export function stepStates(steps, cases, { waived = [] } = {}) {
  const known = new Set(steps.map((s) => s.step))
  const byStep = new Map()
  const others = []
  const extra = []
  for (const testCase of cases) {
    const step = stepOfTest(testCase)
    if (!step) others.push(testCase)
    else if (!known.has(step)) extra.push({ step, test: testCase.name })
    else byStep.set(step, [...(byStep.get(step) ?? []), testCase])
  }

  const own = (step) => {
    const tests = byStep.get(step) ?? []
    if (tests.length === 0) return { state: 'blocked', seen: 'no test for this step in the script' }
    const failed = tests.find((t) => t.outcome === 'failed')
    if (failed) return { state: 'failed', seen: failed.seen }
    if (tests.some((t) => t.outcome === 'skipped')) return { state: 'blocked', seen: 'test skipped' }
    return { state: 'passed', seen: '' }
  }

  const resolved = new Map()
  const resolve = (step, visiting = new Set()) => {
    if (resolved.has(step)) return resolved.get(step)
    if (visiting.has(step)) throw new Error(`the dependency tree has a cycle through ${step}`)
    visiting.add(step)
    const { parents } = steps.find((s) => s.step === step)
    const blockedBy = parents.filter((p) => known.has(p) && BLOCKING.includes(resolve(p, visiting).state))
    const result = waived.includes(step) ? { state: 'waived', seen: '' }
      : blockedBy.length > 0 ? { state: 'blocked-by-parent', seen: `parent ${blockedBy.join(', ')} did not pass` }
      : own(step)
    resolved.set(step, result)
    return result
  }

  const rows = steps.map(({ step, title }) => ({
    step,
    title,
    ...resolve(step),
    tests: (byStep.get(step) ?? []).map((t) => t.name),
  }))
  const states = rows.map((row) => row.state)
  const result = states.includes('failed') ? 'failed'
    : states.some((s) => s === 'blocked' || s === 'blocked-by-parent') ? 'blocked'
    : 'passed'
  return { steps: rows, result, extra, others }
}

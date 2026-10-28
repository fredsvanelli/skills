import { STEP_STATES } from './status.mjs'

export const LAST_RUN_RESULTS = ['passed', 'failed', 'blocked', 'incomplete']

function text(value) {
  return value === null || value === undefined ? null : String(value)
}

// Builds the pass key of a cell: `<role>`, then `/<case>`, then `@<viewport>`. '' when the cell has none.
export function passKey({ role, case: caseName, viewport }) {
  return `${role ?? ''}${caseName ? `/${caseName}` : ''}${viewport ? `@${viewport}` : ''}`
}

// Splits a pass key back into role, case and viewport. A missing part is null.
export function parsePassKey(key) {
  const at = key.indexOf('@')
  const viewport = at === -1 ? null : key.slice(at + 1) || null
  const head = at === -1 ? key : key.slice(0, at)
  const slash = head.indexOf('/')
  const role = (slash === -1 ? head : head.slice(0, slash)) || null
  const caseName = slash === -1 ? null : head.slice(slash + 1) || null
  return { role, case: caseName, viewport }
}

function readRuns(raw, problems) {
  const runs = {}
  if (raw === null || raw === undefined) return runs
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('last_run.runs must be a map of run keys')
    return runs
  }
  for (const [key, value] of Object.entries(raw)) {
    const run = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    runs[key] = { date: text(run.date), commit: text(run.commit), report: text(run.report) }
  }
  return runs
}

// Reads one "<state> <run key>[ outdated]" string. Returns the cell parts or null after recording a problem.
function readCellValue(value, where, runs, problems) {
  const parts = String(value).trim().split(/\s+/)
  const [state, run, flag, ...extra] = parts
  if (!STEP_STATES.includes(state)) {
    problems.push(`${where}: state "${state}" is not a step state`)
    return null
  }
  if (run === undefined || !Object.hasOwn(runs, run)) {
    problems.push(`${where}: run "${run ?? ''}" is not in last_run.runs`)
    return null
  }
  if (extra.length > 0 || (flag !== undefined && flag !== 'outdated')) {
    problems.push(`${where}: "${String(value).trim()}" must be "<state> <run>" or "<state> <run> outdated"`)
    return null
  }
  return { state, run, outdated: flag === 'outdated' }
}

function readCells(raw, runs, problems) {
  const cells = []
  if (raw === null || raw === undefined) return cells
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('last_run.cells must be a map of step ids')
    return cells
  }
  for (const [step, value] of Object.entries(raw)) {
    const where = `last_run.cells.${step}`
    const isMap = value !== null && typeof value === 'object' && !Array.isArray(value)
    const entries = isMap ? Object.entries(value) : [['', value]]
    for (const [key, cell] of entries) {
      if (cell === null || cell === undefined || typeof cell === 'object') {
        problems.push(`${where}: cell "${key}" must be "<state> <run>"`)
        continue
      }
      const read = readCellValue(cell, where, runs, problems)
      if (read !== null) cells.push({ step, ...parsePassKey(key), ...read })
    }
  }
  return cells
}

// Reads the last_run frontmatter value, the old one-map shape or the per-cell shape.
// Returns { lastRun, problems }. A value with neither `cells` nor `runs` is legacy.
export function readLastRun(raw) {
  const problems = []
  if (raw === null || raw === undefined) return { lastRun: null, problems }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { lastRun: null, problems: ['last_run must be a map'] }
  }
  const legacy = !Object.hasOwn(raw, 'cells') && !Object.hasOwn(raw, 'runs')
  if (raw.outdated !== undefined && typeof raw.outdated !== 'boolean') problems.push('last_run.outdated must be true or false')
  if (raw.mixed !== undefined && typeof raw.mixed !== 'boolean') problems.push('last_run.mixed must be true or false')
  const result = text(raw.result)
  if (result !== null && !LAST_RUN_RESULTS.includes(result)) {
    problems.push(`last_run.result "${result}" must be one of ${LAST_RUN_RESULTS.join(', ')}`)
  }
  const runs = legacy ? {} : readRuns(raw.runs, problems)
  const cells = legacy ? [] : readCells(raw.cells, runs, problems)
  const lastRun = {
    date: text(raw.date),
    oldest: text(raw.oldest),
    commit: text(raw.commit),
    result,
    report: text(raw.report),
    mixed: raw.mixed === true,
    outdated: raw.outdated === true,
    runs,
    cells,
    legacy
  }
  return { lastRun, problems }
}

function scalar(value) {
  return value === null ? null : String(value)
}

// Serializes a LastRun in the per-cell shape as YAML lines, starting with `last_run:`.
export function lastRunLines(lastRun) {
  const lines = ['last_run:']
  if (lastRun.date !== null) lines.push(`  date: ${lastRun.date}`)
  if (lastRun.oldest !== null) lines.push(`  oldest: ${lastRun.oldest}`)
  if (lastRun.commit !== null) lines.push(`  commit: ${JSON.stringify(lastRun.commit)}`)
  if (lastRun.result !== null) lines.push(`  result: ${lastRun.result}`)
  if (lastRun.report !== null) lines.push(`  report: ${lastRun.report}`)
  if (lastRun.mixed) lines.push('  mixed: true')
  if (lastRun.outdated) lines.push('  outdated: true')
  const runKeys = Object.keys(lastRun.runs)
  if (runKeys.length === 0) {
    lines.push('  runs: {}')
  } else {
    lines.push('  runs:')
    for (const key of runKeys) {
      const run = lastRun.runs[key]
      const fields = []
      if (scalar(run.date) !== null) fields.push(`date: ${run.date}`)
      if (scalar(run.commit) !== null) fields.push(`commit: ${JSON.stringify(run.commit)}`)
      if (scalar(run.report) !== null) fields.push(`report: ${run.report}`)
      lines.push(`    ${key}: { ${fields.join(', ')} }`)
    }
  }
  const steps = []
  for (const cell of lastRun.cells) {
    let entry = steps.find((item) => item.step === cell.step)
    if (entry === undefined) {
      entry = { step: cell.step, cells: [] }
      steps.push(entry)
    }
    entry.cells.push(cell)
  }
  if (steps.length === 0) {
    lines.push('  cells: {}')
  } else {
    lines.push('  cells:')
    for (const { step, cells } of steps) {
      const write = (cell) => `${cell.state} ${cell.run}${cell.outdated ? ' outdated' : ''}`
      if (cells.length === 1 && passKey(cells[0]) === '') {
        lines.push(`    ${step}: ${write(cells[0])}`)
      } else {
        lines.push(`    ${step}: { ${cells.map((cell) => `${passKey(cell)}: ${write(cell)}`).join(', ')} }`)
      }
    }
  }
  return lines
}

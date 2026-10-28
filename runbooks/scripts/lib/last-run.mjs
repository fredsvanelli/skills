import { STEP_STATES, nextStatus } from './status.mjs'
import { passPlan } from './passes.mjs'

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

// The old one-line flow map, `last_run: { date, commit, result, report[, outdated] }`. A missing field is left out.
function legacyLine(lastRun) {
  const fields = []
  if (lastRun.date !== null) fields.push(`date: ${lastRun.date}`)
  if (lastRun.commit !== null) fields.push(`commit: ${JSON.stringify(lastRun.commit)}`)
  if (lastRun.result !== null) fields.push(`result: ${lastRun.result}`)
  if (lastRun.report !== null) fields.push(`report: ${lastRun.report}`)
  if (lastRun.outdated) fields.push('outdated: true')
  return `last_run: { ${fields.join(', ')} }`
}

// A pass key as a flow-map key. YAML reserves `@` at the start of a plain scalar, so such a key is quoted.
const keyText = (key) => (key.startsWith('@') ? JSON.stringify(key) : key)

// Serializes a LastRun as YAML lines, starting with `last_run:`. A legacy value keeps the old one-line shape,
// so only a run converts it; any other value is written in the per-cell shape.
export function lastRunLines(lastRun) {
  if (lastRun.legacy) return [legacyLine(lastRun)]
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
        lines.push(`    ${step}: { ${cells.map((cell) => `${keyText(passKey(cell))}: ${write(cell)}`).join(', ')} }`)
      }
    }
  }
  return lines
}

const PARTIAL_WITHOUT_MERGE = 'a partial run changes last_run only with --merge; without it last_run stays as it is'

// One string per cell: the step and the pass key.
function cellKey(cell) {
  return `${cell.step} ${passKey(cell)}`
}

// True when a step's Roles:, Cases: or Viewports: line lets the value through. An empty line or a null value always does.
function allows(only, value) {
  return (only ?? []).length === 0 || value === null || only.includes(value)
}

// The cells a full run of the runbook fills, step by step. With tracking on (registry not null), every step for every
// pass of passPlan; with it off, every step for every viewport, with viewport null when the runbook has none.
// A pass that a step's Roles:, Cases: or Viewports: line leaves out has no cell, as in `junit`.
export function expectedCells(runbook, steps, { registry, config }) {
  if (registry !== null) {
    const passes = passPlan(registry, config, runbook, steps)
    return steps.flatMap((step) => passes
      .filter((pass) => allows(step.roles, pass.role) && allows(step.cases, pass.dataCase) && allows(step.viewports, pass.viewport))
      .map((pass) => ({ step: step.step, role: pass.role, case: pass.case, viewport: pass.viewport })))
  }
  const viewports = runbook.viewports?.length > 0 ? runbook.viewports : [null]
  return steps.flatMap((step) => viewports
    .filter((viewport) => allows(step.viewports, viewport))
    .map((viewport) => ({ step: step.step, role: null, case: null, viewport })))
}

// The report rows as cells. An empty column reads as null; the run is left for mergeLastRun to set.
export function reportCells(report) {
  return report.steps.map((row) => ({
    step: row.step,
    role: row.role || null,
    case: row.case || null,
    viewport: row.viewport || null,
    state: row.state,
    run: null,
    outdated: false
  }))
}

// The expected cells with no cell of the same step and pass key.
export function pendingCells(cells, expected) {
  const held = new Set(cells.map(cellKey))
  return expected
    .filter((cell) => !held.has(cellKey(cell)))
    .map(({ step, role, case: caseName, viewport }) => ({ step, role, case: caseName, viewport }))
}

// failed, then blocked, then incomplete (a pending cell), then passed. not-applicable, no-account and waived pass.
function resultOf(states, pending) {
  if (states.includes('failed')) return 'failed'
  if (states.some((state) => state === 'blocked' || state === 'blocked-by-parent')) return 'blocked'
  if (pending.length > 0) return 'incomplete'
  return 'passed'
}

const reportName = (run) => (run.report ?? '').split('/').pop()

// Merges a run report into last_run. A full report replaces every cell; a partial one, with merge, replaces the cells
// it ran and keeps the others. Cells outside expected are dropped. Returns the new LastRun, the runbook status and the
// cells whose state or run changed (from null for a cell that was pending), with the date of the run before and after.
export function mergeLastRun(previous, report, expected, { merge, status }) {
  if (report.partial && !merge) throw new Error(PARTIAL_WITHOUT_MERGE)
  // Inside this function a cell's run is an id, the report path, so runs keep their identity while keys renumber.
  const runs = new Map()
  const before = new Map()
  if (previous !== null && !previous.legacy) {
    for (const cell of previous.cells) {
      const run = previous.runs[cell.run]
      const id = run.report ?? `#${cell.run}`
      runs.set(id, run)
      before.set(cellKey(cell), { ...cell, run: id })
    }
  }
  const run = { date: (report.date ?? report.name).slice(0, 10), commit: report.commit, report: `_runs/${report.name}` }
  runs.set(run.report, run)

  const wanted = new Set(expected.map(cellKey))
  const cells = new Map(report.partial ? before : [])
  for (const cell of reportCells(report)) {
    const key = cellKey(cell)
    if (!wanted.has(key)) continue
    if (cell.state === 'no-account' && cells.has(key)) continue
    cells.set(key, { ...cell, run: run.report, outdated: false })
  }
  const kept = expected.map((cell) => cells.get(cellKey(cell))).filter(Boolean)

  const ids = [...new Set(kept.map((cell) => cell.run))]
    .sort((a, b) => reportName(runs.get(a)).localeCompare(reportName(runs.get(b))) || a.localeCompare(b))
  const keyOf = new Map(ids.map((id, index) => [id, `r${index + 1}`]))
  const newest = runs.get(ids.at(-1)) ?? run
  const oldest = runs.get(ids[0]) ?? run

  const changed = []
  for (const cell of kept) {
    const was = before.get(cellKey(cell))
    if (was !== undefined && was.state === cell.state && was.run === cell.run) continue
    changed.push({
      step: cell.step,
      role: cell.role,
      case: cell.case,
      viewport: cell.viewport,
      from: was?.state ?? null,
      to: cell.state,
      fromDate: was === undefined ? null : runs.get(was.run).date,
      toDate: runs.get(cell.run).date
    })
  }

  const finalCells = kept.map((cell) => ({ ...cell, run: keyOf.get(cell.run) }))
  const states = finalCells.map((cell) => cell.state)
  const pending = pendingCells(finalCells, expected)
  const outdated = finalCells.some((cell) => cell.outdated)
  const lastRun = {
    date: newest.date,
    oldest: oldest.date,
    commit: newest.commit,
    result: resultOf(states, pending),
    report: newest.report,
    mixed: ids.length > 1,
    outdated,
    runs: Object.fromEntries(ids.map((id) => [keyOf.get(id), { ...runs.get(id) }])),
    cells: finalCells,
    legacy: false
  }
  const nextState = pending.length > 0 || outdated ? status : nextStatus(status, states)
  return { lastRun, status: nextState, changed }
}

// Marks every cell and the whole last_run outdated. A legacy value has no cells, so only the whole changes.
export function markOutdated(lastRun) {
  return { ...lastRun, outdated: true, cells: lastRun.cells.map((cell) => ({ ...cell, outdated: true })) }
}

// Renames a role or a case in every cell that has it. A legacy value has no cells and comes back unchanged.
// The case `*` (a role that runs once) is never renamed, since it is not a case name.
export function renameCells(lastRun, { field, from, to }) {
  if (lastRun.legacy || from === '*') return lastRun
  const cells = lastRun.cells.map((cell) => (cell[field] === from ? { ...cell, [field]: to } : cell))
  const seen = new Set()
  for (const cell of cells) {
    const key = cellKey(cell)
    if (seen.has(key)) throw new Error(`${cell.step} already has a cell "${passKey(cell)}"`)
    seen.add(key)
  }
  return { ...lastRun, cells }
}

// Throws when the loader found a problem in the runbook's last_run: an edit would drop the cells it could not read.
export function requireReadableLastRun(runbook) {
  const problem = runbook.problems.find((item) => item.startsWith('last_run'))
  if (problem) throw new Error(`${runbook.id}: ${problem}. Fix last_run by hand first. Nothing was written`)
}

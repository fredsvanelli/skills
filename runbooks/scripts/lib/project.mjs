import { loadRunbooks } from './runbooks.mjs'
import { extractItems } from './extract.mjs'
import { computeCoverage, sliceOf } from './coverage.mjs'

export function collect(root, config, listName, warnings, status = {}) {
  const { items, warnings: found, ran, complete } = extractItems(root, config[listName], listName)
  warnings.push(...found)
  Object.assign(status, { ran, complete })
  return items.map((item) => ({ ...item, slice: sliceOf(item.file, config.slices) }))
}

export function runbookWarnings(runbooks) {
  return runbooks.flatMap((rb) => [...rb.problems, ...rb.warnings].map((problem) => `${rb.path}: ${problem}`))
}

export function coverageResult(root, config, filters, warnings, withItems = false) {
  const runbooks = loadRunbooks(root, config)
  const sourceWarnings = []
  const entriesStatus = {}
  const requirementsStatus = {}
  const entries = collect(root, config, 'entries', sourceWarnings, entriesStatus)
  const requirements = collect(root, config, 'requirements', sourceWarnings, requirementsStatus)
  warnings.push(...sourceWarnings, ...runbookWarnings(runbooks))
  const result = computeCoverage({
    runbooks,
    entries,
    requirements,
    requirementsConfigured: config.requirements.length > 0,
    requirementsRan: requirementsStatus.ran > 0,
    slices: config.slices,
    stack: config.stack,
    filters,
    unavailable: { entries: !entriesStatus.complete, requirements: !requirementsStatus.complete },
    withItems,
  })
  result.warnings = sourceWarnings
  return result
}

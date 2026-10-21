import fs from 'node:fs'
import path from 'node:path'
import { loadRunbooks } from './runbooks.mjs'
import { collect, coverageResult } from './project.mjs'
import { computeCoverage } from './coverage.mjs'
import { staleState } from './stale.mjs'
import { listReports, reportByName } from './reports.mjs'
import { renderMarkdown } from './markdown.mjs'
import { parseBody } from './body.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'

const NO_SLICE = '(no slice)'

const byId = (a, b) => a.id.localeCompare(b.id)
const byName = (a, b) => (a.name === NO_SLICE) - (b.name === NO_SLICE) || a.name.localeCompare(b.name)

// The time comes from the report name (<YYYY-MM-DD-HHMM>-<id>), since last_run.date has only the day.
function rowOf(rb, reportCount, { today, staleDays }) {
  const date = rb.lastRun?.date ? String(rb.lastRun.date) : null
  const time = String(rb.lastRun?.report ?? '').match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-[^/]*$/)
  const { stale, age } = staleState(rb, { today, staleDays })
  return {
    id: rb.id,
    flow: rb.id.slice(rb.id.indexOf('.') + 1),
    title: rb.title,
    status: rb.status,
    surface: rb.surface,
    upstream: rb.upstream,
    tags: rb.tags,
    date,
    time: date && time?.[1] === date ? `${time[2]}:${time[3]}` : null,
    age,
    stale,
    result: rb.lastRun?.result ?? null,
    outdated: rb.lastRun?.outdated === true,
    runs: reportCount,
    problems: rb.problems,
  }
}

const sumGroups = (groups, name) => {
  const rows = groups.filter((group) => group.name === name)
  if (rows.length === 0) return null
  return { covered: rows.reduce((n, g) => n + g.covered, 0), total: rows.reduce((n, g) => n + g.total, 0) }
}

// Entry points only: the Runbooks page never runs a requirement source. The warnings are the
// entry sources' own; runbook problems already show on each row.
function entryCoverage(root, config, runbooks) {
  const status = {}
  const warnings = []
  const entries = collect(root, config, 'entries', warnings, status)
  const result = computeCoverage({
    runbooks,
    entries,
    requirements: [],
    requirementsConfigured: false,
    slices: config.slices,
    stack: config.stack,
    unavailable: { entries: !status.complete, requirements: false },
  })
  return { result, warnings }
}

export function runbooksView(root, config, { today }) {
  const staleDays = config.staleDays
  const runbooks = loadRunbooks(root, config)
  const { result, warnings } = entryCoverage(root, config, runbooks)
  const sliceNames = Object.keys(config.slices)
  const names = new Set([...runbooks.map((rb) => rb.capability), ...sliceNames, ...result.groups.map((group) => group.name)])
  const capabilities = [...names].map((name) => {
    const runbooksOf = runbooks.filter((rb) => rb.capability === name).sort(byId)
    const rows = runbooksOf.map((rb) => rowOf(rb, listReports(root, config.paths.runbooks, rb.id).length, { today, staleDays }))
    const uncovered = result.entries.uncovered
      .filter((entry) => (entry.slice ?? NO_SLICE) === name)
      .map(({ id, kind, file }) => ({ id, kind, file }))
      .sort(byId)
    const stale = rows.filter((row) => row.stale).length
    // A config slice whose globs match no entry point still has a coverage, of nothing.
    const coverage = sumGroups(result.groups, name) ?? (sliceNames.includes(name) ? { covered: 0, total: 0 } : null)
    return { name, problems: stale + uncovered.length, stale, uncovered, coverage, runbooks: rows }
  })
  capabilities.sort(byName)
  return { staleDays, today, warnings, capabilities }
}

const reportFileName = (lastRun) => (typeof lastRun?.report === 'string' ? path.basename(lastRun.report) : null)

function rawFrontmatter(root, rb) {
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, rb.path), 'utf8'))
  let data = {}
  try {
    data = parts ? parseYaml(parts.yaml) : {}
  } catch {
    // loadRunbooks already reports the broken frontmatter as a problem.
  }
  return { data, body: parts ? parts.body : '' }
}

export function runbookView(root, config, id, { today }) {
  const rb = loadRunbooks(root, config).find((r) => r.id === id)
  if (!rb) return null
  const runbooksDir = config.paths.runbooks
  const row = rowOf(rb, listReports(root, runbooksDir, rb.id).length, { today, staleDays: config.staleDays })
  const { data, body } = rawFrontmatter(root, rb)

  const name = reportFileName(rb.lastRun)
  const report = name ? reportByName(root, runbooksDir, name) : null
  const stepStates = {}
  for (const { step, state, viewport } of report?.steps ?? []) {
    ;(stepStates[step] ??= []).push({ viewport: viewport ?? null, state })
  }

  return {
    ...row,
    feature: rb.feature,
    roles: rb.roles,
    viewports: rb.viewports.map((vp) => ({ name: vp, width: config.viewports[vp]?.width ?? null, height: config.viewports[vp]?.height ?? null })),
    upstreamFromConfig: rb.surface === 'ui' && (data.upstream === undefined || data.upstream === null),
    covers: rb.covers,
    scripts: rb.scripts,
    sources: rb.sources,
    design: rb.design,
    lastRun: rb.lastRun,
    path: rb.path,
    body: parseBody(body),
    stepStates,
    reportOnDisk: name === null || report !== null,
    warnings: rb.warnings,
  }
}

export function historyView(root, config, id) {
  const runs = listReports(root, config.paths.runbooks, id)
  if (runs.length === 0 && !loadRunbooks(root, config).some((rb) => rb.id === id)) return null
  return {
    id,
    runs: runs.map(({ name, date, commit, branch, mode, upstream, result, partial, counts }) =>
      ({ name, date, commit, branch, mode, upstream, result, partial, counts })),
  }
}

export function reportView(root, config, name) {
  const report = reportByName(root, config.paths.runbooks, name)
  if (!report) return null
  const { body } = report
  const heading = body.match(/^# Run\b.*$/m)
  const rest = heading ? body.slice(heading.index + heading[0].length) : body
  return {
    name: report.name,
    runbook: report.runbook,
    date: report.date,
    commit: report.commit,
    branch: report.branch,
    mode: report.mode,
    upstream: report.upstream,
    viewports: report.viewports,
    result: report.result,
    partial: report.partial,
    steps: report.steps,
    sectionsHtml: renderMarkdown(rest.trim()),
  }
}

export function coverageView(root, config, slice) {
  const result = coverageResult(root, config, {}, [], true)
  const names = new Set([...Object.keys(config.slices), ...result.groups.map((group) => group.name)])
  const slices = [...names].map((name) => ({ name, ...(sumGroups(result.groups, name) ?? { covered: 0, total: 0 }) })).sort(byName)
  if (slice === undefined) return { slices, scope: 'overall', result }
  // The counts come from the slice's own groups, so they agree with its uncovered list.
  const groups = result.groups.filter((group) => group.name === slice)
  const count = (field) => groups.reduce((n, group) => n + group[field], 0)
  return {
    slices,
    scope: slice,
    result: {
      ...result,
      groups,
      entries: {
        total: count('total'),
        covered: count('covered'),
        pending: count('pending'),
        planned: count('planned'),
        uncovered: result.entries.uncovered.filter((entry) => (entry.slice ?? NO_SLICE) === slice),
      },
    },
  }
}

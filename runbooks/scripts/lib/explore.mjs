import fs from 'node:fs'
import path from 'node:path'
import { loadRunbooks } from './runbooks.mjs'
import { collect, coverageResult } from './project.mjs'
import { computeCoverage, roleCoverage } from './coverage.mjs'
import { rolesEnabled } from './config.mjs'
import { loadRoles, effectivePermissions } from './roles.mjs'
import { roleRows, roleDetail, contextRows } from './role-views.mjs'
import { roleHistory } from './role-history.mjs'
import { staleState } from './stale.mjs'
import { listReports, reportByName } from './reports.mjs'
import { renderMarkdown } from './markdown.mjs'
import { parseBody } from './body.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'

const NO_SLICE = '(no slice)'

const byId = (a, b) => a.id.localeCompare(b.id)
const byName = (a, b) => (a.name === NO_SLICE) - (b.name === NO_SLICE) || a.name.localeCompare(b.name)

// The time comes from the report name (<YYYY-MM-DD-HHMM>-<id>), since last_run.date has only the day.
// `oldest` is the date of the oldest run a cell cites; `age` and `stale` count from it.
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
    oldest: rb.lastRun?.oldest ? String(rb.lastRun.oldest) : null,
    age,
    stale,
    result: rb.lastRun?.result ?? null,
    outdated: rb.lastRun?.outdated === true,
    mixed: rb.lastRun?.mixed === true,
    runs: reportCount,
    review: rb.review.length > 0,
    problems: rb.problems,
  }
}

const sumGroups = (groups, name) => {
  const rows = groups.filter((group) => group.name === name)
  if (rows.length === 0) return null
  return { covered: rows.reduce((n, g) => n + g.covered, 0), total: rows.reduce((n, g) => n + g.total, 0) }
}

// Entry points only: the Runbooks page never runs a requirement source. The warnings are the
// config's and the entry sources' own; runbook problems already show on each row.
function entryCoverage(root, config, runbooks) {
  const status = {}
  const warnings = [...(config.warnings ?? [])]
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
  // With cells, the states come from them; the report is only the fallback of an old one-line last_run.
  const hasCells = (rb.lastRun?.cells ?? []).length > 0
  for (const { step, state, viewport, role, case: kase } of hasCells ? rb.lastRun.cells : report?.steps ?? []) {
    // A report with no Case column gives entries without a case key.
    ;(stepStates[step] ??= []).push({ role: role || null, ...(kase ? { case: kase } : {}), viewport: viewport ?? null, state })
  }

  // Every report a cell cites, so the page can link each one.
  const reports = Object.values(rb.lastRun?.runs ?? {}).filter((entry) => typeof entry.report === 'string').map((entry) => {
    const file = path.basename(entry.report)
    return { name: file, report: entry.report, onDisk: reportByName(root, runbooksDir, file) !== null }
  })

  return {
    ...row,
    feature: rb.feature,
    roles: rb.roles,
    rolesAll: rb.rolesAll,
    ...(rb.context ? { context: rb.context, cases: rb.cases, casesAll: rb.casesAll } : {}),
    review: rb.review,
    viewports: rb.viewports.map((vp) => ({ name: vp, width: config.viewports[vp]?.width ?? null, height: config.viewports[vp]?.height ?? null })),
    upstreamFromConfig: rb.surface === 'ui' && (data.upstream === undefined || data.upstream === null),
    covers: rb.covers,
    calls: rb.calls,
    scripts: rb.scripts,
    sources: rb.sources,
    design: rb.design,
    lastRun: rb.lastRun,
    path: rb.path,
    body: parseBody(body),
    stepStates,
    // True when last_run cites no report, or when any report it cites is on this machine.
    reportOnDisk: name === null || report !== null || reports.some((entry) => entry.onDisk),
    reports,
    warnings: rb.warnings,
  }
}

// The Roles page. With tracking off the page has nothing to show.
export function rolesView(root, config, { today }) {
  if (!rolesEnabled(config)) return { enabled: false }
  const registry = loadRoles(root, config)
  const runbooks = loadRunbooks(root, config)
  const rows = roleRows(root, config, registry, runbooks)
  const keys = [...new Set(registry.names.flatMap((name) => Object.keys(effectivePermissions(registry, name))))].sort()
  const keysWithoutRunbook = roleCoverage(registry, runbooks).reduce((n, entry) => n + entry.keys.filter((k) => k.state === 'uncovered').length, 0)
  return {
    enabled: true,
    today,
    counters: {
      roles: rows.length,
      reviews: runbooks.filter((rb) => rb.review.length > 0).length,
      noAccount: rows.filter((row) => row.name !== 'anonymous' && row.account === null).length,
      keysWithoutRunbook,
    },
    rows,
    matrix: {
      keys,
      roles: registry.names.map((name) => {
        const effective = effectivePermissions(registry, name)
        return {
          name,
          cells: Object.fromEntries(Object.entries(effective).map(([key, entry]) => [key, { actions: entry.actions, source: entry.source, ...(entry.cases ? { cases: entry.cases } : {}) }])),
        }
      }),
    },
    ...(Object.keys(registry.contexts ?? {}).length > 0 ? { contexts: contextRows(registry, runbooks) } : {}),
  }
}

export function roleView(root, config, name) {
  if (!rolesEnabled(config)) return null
  const registry = loadRoles(root, config)
  const detail = roleDetail(root, config, registry, loadRunbooks(root, config), name)
  return detail ? { ...detail, history: roleHistory(root, config, name) } : null
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

const SCOPE_KEYS = ['capability', 'feature', 'path', 'slice']

// filters takes the keys of runbooks.mjs coverage. The side list of slices always shows the overall numbers.
export function coverageView(root, config, filters = {}) {
  const withWarnings = (result) => ({ ...result, warnings: [...(config.warnings ?? []), ...result.warnings] })
  const narrow = (scoped) => (typeof filters.role === 'string' && scoped.roles ? { ...scoped, roles: scoped.roles.filter((entry) => entry.role === filters.role) } : scoped)
  const result = narrow(withWarnings(coverageResult(root, config, {}, [], true)))
  const names = new Set([...Object.keys(config.slices), ...result.groups.map((group) => group.name)])
  const slices = [...names].map((name) => ({ name, ...(sumGroups(result.groups, name) ?? { covered: 0, total: 0 }) })).sort(byName)
  const keys = SCOPE_KEYS.filter((key) => typeof filters[key] === 'string')
  if (keys.length === 0) return { slices, scope: 'overall', result }
  if (keys.length > 1 || keys[0] !== 'slice') {
    const picked = Object.fromEntries(keys.map((key) => [key, filters[key]]))
    const scope = keys.map((key) => `${key} ${picked[key]}`).join(', ')
    return { slices, scope, filters: picked, result: narrow(withWarnings(coverageResult(root, config, picked, [], true))) }
  }
  const slice = filters.slice
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

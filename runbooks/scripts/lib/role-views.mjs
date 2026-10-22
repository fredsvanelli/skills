// Views of the role registry against the runbooks: one row per role, one role in detail,
// the runbooks a permission change reaches, and the runbooks that cite a role.
import fs from 'node:fs'
import path from 'node:path'
import { effectivePermissions, heirsOf, keyMatches } from './roles.mjs'
import { reportByName } from './reports.mjs'
import { parseSteps } from './steps.mjs'
import { splitFrontmatter } from './yaml.mjs'

// The role's own result in one report. Other roles' rows do not count.
export function roleResult(steps, role) {
  const rows = steps.filter((row) => row.role === role)
  if (rows.length === 0) return null
  const has = (state) => rows.some((row) => row.state === state)
  if (has('failed')) return 'failed'
  if (has('blocked') || has('blocked-by-parent')) return 'blocked'
  if (rows.every((row) => row.state === 'no-account')) return 'no-account'
  return 'passed'
}

const live = (runbooks) => runbooks.filter((rb) => rb.status !== 'deprecated')

// The last_run report of a runbook, or null when it has none on disk.
function lastReport(root, config, runbook) {
  const file = runbook.lastRun?.report
  if (typeof file !== 'string') return null
  return reportByName(root, config.paths.runbooks, path.basename(file))
}

function roleRow(root, config, registry, runbooks, reports, name) {
  const role = registry.roles[name]
  const own = live(runbooks).filter((rb) => rb.roles.includes(name))
  const results = { passed: 0, failed: 0, blocked: 0, 'no-account': 0, never: 0 }
  for (const rb of own) {
    const report = reports.get(rb.id)
    if (!report) results.never += 1
    else {
      const result = roleResult(report.steps, name)
      if (result) results[result] += 1
    }
  }
  const reviews = live(runbooks).reduce((sum, rb) => {
    const named = rb.review.filter((entry) => entry.role === name).length
    const enabled = rb.roles.includes(name) ? rb.review.filter((entry) => entry.reason === 'roles-enabled').length : 0
    return sum + named + enabled
  }, 0)
  const account = Object.hasOwn(config.accounts ?? {}, name) ? config.accounts[name] : null
  return {
    name,
    description: role.description,
    inherits: [...role.inherits],
    account: account ? { emailEnv: account.emailEnv, passwordEnv: account.passwordEnv } : null,
    runbooks: own.length,
    reviews,
    guesses: Object.keys(role.permissions).filter((key) => role.origins[key] === 'guess'),
    results,
  }
}

function reportsOf(root, config, runbooks) {
  return new Map(runbooks.map((rb) => [rb.id, lastReport(root, config, rb)]))
}

export function roleRows(root, config, registry, runbooks) {
  const reports = reportsOf(root, config, runbooks)
  return registry.names.map((name) => roleRow(root, config, registry, runbooks, reports, name))
}

// One state per case and viewport the role ran, in report order. `case` is absent when the report has no case. A role that ran once has the case '*'.
export function passStates(report, name) {
  if (!report) return []
  const rows = report.steps.filter((row) => row.role === name)
  const keyOf = (row) => JSON.stringify([row.case || null, row.viewport || null])
  const keys = [...new Set(rows.map(keyOf))]
  return keys.map((key) => {
    const [caseName, viewport] = JSON.parse(key)
    const result = roleResult(rows.filter((row) => keyOf(row) === key), name)
    // A report with no Case column gives states without a case key.
    return caseName === null ? { viewport, result } : { case: caseName, viewport, result }
  })
}

export function roleDetail(root, config, registry, runbooks, name) {
  if (!registry.names.includes(name)) return null
  const reports = reportsOf(root, config, runbooks)
  const row = roleRow(root, config, registry, runbooks, reports, name)
  const runbooksOf = live(runbooks).filter((rb) => rb.roles.includes(name)).map((rb) => {
    const outcomes = rb.roleOutcomes && Object.hasOwn(rb.roleOutcomes, name) ? rb.roleOutcomes[name] : null
    return {
      id: rb.id,
      title: rb.title,
      status: rb.status,
      outcomes: outcomes && outcomes.length > 0 ? [...outcomes] : ['allowed'],
      states: passStates(reports.get(rb.id), name),
      review: rb.review.length > 0,
    }
  })
  return {
    ...row,
    found: [...registry.roles[name].found],
    effective: effectivePermissions(registry, name),
    runbooksOf,
  }
}

// The role and its heirs, for the runbooks the key reaches. Deprecated runbooks and placeholders are left out.
// With kase, only the runbooks that run that case.
export function affectedByChange(registry, runbooks, role, key, kase = null) {
  const candidates = runbooks.filter((rb) => rb.status !== 'deprecated' && rb.status !== 'placeholder' && keyMatches(key, rb.capability, rb.feature)
    && (kase === null || (rb.cases ?? []).includes(kase)))
  return [role, ...heirsOf(registry, role)]
    .map((name) => ({ role: name, runbooks: candidates.filter((rb) => rb.roles.includes(name)).map((rb) => rb.id).sort() }))
    .filter((group) => group.runbooks.length > 0)
}

const reachable = (rb) => rb.status !== 'deprecated' && rb.status !== 'placeholder'

// One row per context with the number of runbooks that belong to it, deprecated and placeholders left out.
export function contextRows(registry, runbooks) {
  return Object.values(registry.contexts ?? {}).map((context) => ({
    name: context.name,
    description: context.description,
    keys: context.keys,
    cases: [...context.cases],
    runbooks: runbooks.filter((rb) => reachable(rb) && rb.context === context.name).length,
  }))
}

// The ids of the runbooks of a context, narrowed to one key when given.
export function affectedByContext(registry, runbooks, name, { key } = {}) {
  if (!Object.hasOwn(registry.contexts ?? {}, name)) throw new Error(`no context "${name}"`)
  return runbooks
    .filter((rb) => reachable(rb) && rb.context === name && (key === undefined || keyMatches(key, rb.capability, rb.feature)))
    .map((rb) => rb.id)
    .sort()
}

export function citingRole(root, registry, runbooks, name) {
  const cited = []
  for (const rb of runbooks) {
    const places = []
    if (rb.roles.includes(name)) places.push('roles')
    const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, rb.path), 'utf8'))
    const steps = parts ? parseSteps(parts.body) : []
    if (steps.some((step) => step.roles.includes(name))) places.push('Roles:')
    if (steps.some((step) => Object.hasOwn(step.outcomes, name) || Object.hasOwn(step.caseOutcomes, name))) places.push('role line')
    if (steps.some((step) => step.as === name)) places.push('As:')
    if ((rb.review || []).some((entry) => entry.role === name)) places.push('review')
    if (places.length > 0) cited.push({ id: rb.id, path: rb.path, places })
  }
  return { runbooks: cited, heirs: heirsOf(registry, name) }
}

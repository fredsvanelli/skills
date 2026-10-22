import fs from 'node:fs'
import path from 'node:path'
import { findFiles } from './glob.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'
import { surfacesOf, upstreamModeOf } from './config.mjs'
import { fixturesDir } from './fixtures.mjs'
import { normalizeCall } from './calls.mjs'
import { loadRoles, contextOfRunbook, API_OUTCOMES, REVIEW_REASONS, REVIEW_FIELDS } from './roles.mjs'
import { parseSteps, parsePreconditionCases } from './steps.mjs'

const STATUSES = ['placeholder', 'draft', 'active', 'deprecated']

const asList = (value) => {
  if (value === null || value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

const SURFACES = ['ui', 'api']
const UPSTREAM_MODES = ['live', 'mocked']

const hasFixtures = (projectRoot, dir) =>
  findFiles(path.resolve(projectRoot, dir), '**/*.json').length > 0

// A mocked ui runbook runs against the plugin's upstream server. Missing scripts or fixtures only warn.
function readUpstream(runbook, data, surface, config, projectRoot) {
  if (data.upstream !== undefined && data.upstream !== null && surface !== 'ui') {
    runbook.problems.push('upstream applies only to ui runbooks')
  }
  if (surface !== 'ui') {
    runbook.upstream = null
    return
  }
  runbook.upstream = upstreamModeOf(config)
  if (data.upstream !== undefined && data.upstream !== null) {
    if (UPSTREAM_MODES.includes(data.upstream)) runbook.upstream = data.upstream
    else runbook.problems.push(`upstream "${data.upstream}" must be one of ${UPSTREAM_MODES.join(', ')}`)
  }
  if (runbook.upstream !== 'mocked') return
  if (!config.upstream?.urlEnv) runbook.problems.push('a mocked runbook needs upstream.urlEnv in the config')
  if (runbook.scripts.length === 0) runbook.warnings.push('mocked runbook without a script: no automated run checks its fixtures')
  const dir = fixturesDir(config, runbook)
  if (runbook.status !== 'placeholder' && !hasFixtures(projectRoot, dir)) {
    runbook.warnings.push(`mocked runbook has no fixtures in ${dir}`)
  }
}

// calls lists the upstream API operations the screens reach, as the upstream spells them; see docs/adr/0005.
function readCalls(runbook, data, surface, config) {
  const calls = []
  for (const raw of asList(data.calls)) {
    const call = normalizeCall(raw)
    if (call === null) runbook.problems.push(`call "${raw}" must be "METHOD /path"`)
    else if (!calls.includes(call)) calls.push(call)
  }
  if (calls.length > 0 && surface !== 'ui') runbook.problems.push('calls apply only to ui runbooks')
  else if (calls.length > 0 && !config.upstream) runbook.problems.push('calls need an upstream block in the config')
  runbook.calls = calls
}

// design maps a name to a frame link or a file; "<name>.<viewport>" is the variant used at that viewport.
function readDesign(runbook, design, surface, system) {
  if (design === null || design === undefined) return
  if (typeof design !== 'object' || Array.isArray(design)) {
    runbook.problems.push('design must map each name to a reference')
    return
  }
  if (surface !== 'ui') runbook.problems.push('design applies only to ui runbooks')
  else if (!system) runbook.problems.push('design references need a design system in the config')
  for (const [key, ref] of Object.entries(design)) {
    if (typeof ref !== 'string' || ref === '') runbook.problems.push(`design "${key}" needs a reference`)
    const dot = key.indexOf('.')
    if (dot !== -1 && !runbook.viewports.includes(key.slice(dot + 1))) {
      runbook.problems.push(`design "${key}": "${key.slice(dot + 1)}" is not one of the runbook's viewports`)
    }
  }
  runbook.design = design
}

// roles lists the runbook's roles: "all" expands to the registry, which includes anonymous.
function readRoles(runbook, data, registry) {
  const written = data.roles
  if (registry === null) {
    runbook.roles = asList(written)
    if (written === 'all') runbook.problems.push('roles: all needs role tracking (roles.enabled)')
    return
  }
  runbook.rolesAll = written === 'all' || written === undefined || written === null
  runbook.roles = runbook.rolesAll ? [...registry.names] : asList(written)
  if (!runbook.rolesAll && runbook.roles.length === 0) runbook.problems.push('roles must list at least one role, or be all')
  if (!runbook.rolesAll) {
    for (const role of runbook.roles) {
      if (!registry.names.includes(role)) runbook.problems.push(`role "${role}" is not registered`)
    }
  }
}

// cases lists the cases the runbook runs: "all" (or no key) expands to the cases of its context.
function readCases(runbook, data, body, registry) {
  const written = data.cases
  const given = written !== undefined && written !== null
  if (registry === null) {
    if (given) runbook.problems.push('cases needs role tracking (roles.enabled)')
    return
  }
  // The fields exist only when the registry has contexts, so a project without contexts keeps the runbook shape it had.
  if (Object.keys(registry.contexts).length > 0) {
    runbook.context = null
    runbook.cases = []
    runbook.casesAll = false
  }
  const context = contextOfRunbook(registry, runbook.capability, runbook.feature)
  if (context === null) {
    if (given) runbook.problems.push(`cases needs a context: ${runbook.capability}/${runbook.feature} belongs to no context`)
    return
  }
  runbook.context = context
  const known = registry.contexts[context].cases
  runbook.casesAll = !given || written === 'all'
  runbook.cases = runbook.casesAll ? [...known] : asList(written)
  if (!runbook.casesAll && runbook.cases.length === 0) runbook.problems.push('cases must list at least one case, or be all')
  if (!runbook.casesAll) {
    for (const name of runbook.cases) {
      if (!known.includes(name)) runbook.problems.push(`case "${name}" is not a case of ${context}`)
    }
  }
  const lines = parsePreconditionCases(body)
  for (const name of runbook.cases) {
    if (!Object.hasOwn(lines, name)) runbook.problems.push(`Preconditions: case "${name}" has no line under Cases:`)
  }
  for (const name of Object.keys(lines)) {
    if (!runbook.cases.includes(name)) runbook.problems.push(`Preconditions: Cases: "${name}" is not one of the runbook's cases`)
  }
}

function readReview(runbook, review, registry) {
  if (review === undefined || review === null) return
  if (registry === null) {
    runbook.problems.push('review needs role tracking (roles.enabled)')
    return
  }
  if (!Array.isArray(review)) {
    runbook.problems.push('review must be a list of entries')
    return
  }
  review.forEach((raw, index) => {
    const label = `review[${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      runbook.problems.push(`${label}: an entry needs reason and date`)
      return
    }
    const entry = {}
    for (const [key, value] of Object.entries(raw)) entry[key] = String(value)
    if (!REVIEW_REASONS.includes(entry.reason)) {
      runbook.problems.push(`${label}: reason "${entry.reason}" must be one of ${REVIEW_REASONS.join(', ')}`)
    } else {
      const needed = REVIEW_FIELDS[entry.reason]
      if (needed.some((field) => !entry[field])) {
        runbook.problems.push(`${label}: ${entry.reason} needs ${needed.length > 1 ? `${needed.slice(0, -1).join(', ')} and ${needed.at(-1)}` : needed[0]}`)
      }
    }
    if (!entry.date) runbook.problems.push(`${label}: date is required`)
    runbook.review.push(entry)
  })
}

// Checks the steps against the registry and the runbook's roles; collects the outcomes each role's lines use.
function readStepRoles(runbook, body, registry) {
  const runbookCases = runbook.cases ?? []
  const runbookContext = runbook.context ?? null
  const outcomes = {}
  const byCaseOutcomes = {}
  const addOutcome = (map, role, outcome) => {
    const seen = Object.hasOwn(map, role) ? map[role] : []
    map[role] = [...new Set([...seen, outcome])].sort()
  }
  const unknown = new Set()
  const unregistered = (role) => {
    if (registry.names.includes(role) || unknown.has(role)) return
    unknown.add(role)
    runbook.problems.push(`role "${role}" is not registered`)
  }
  for (const step of parseSteps(body)) {
    for (const role of step.roles) {
      unregistered(role)
      if (!runbook.roles.includes(role)) runbook.problems.push(`${step.step}: Roles: "${role}" is not one of the runbook's roles`)
    }
    const stepRoles = step.roles.length > 0 ? step.roles : runbook.roles
    for (const [role, outcome] of Object.entries(step.outcomes)) {
      unregistered(role)
      if (registry.names.includes(role) && !stepRoles.includes(role)) {
        runbook.problems.push(`${step.step}: role line "${role}" is not one of the step's roles`)
      }
      // parseSteps keeps only bullets whose keyword is one of OUTCOMES, so only the api subset needs a check.
      if (runbook.surface === 'api' && !API_OUTCOMES.includes(outcome)) {
        runbook.problems.push(`${step.step}: outcome "${outcome}" does not apply to api steps`)
      }
      addOutcome(outcomes, role, outcome)
    }
    const stepCases = step.cases.length > 0 ? step.cases : runbookCases
    for (const name of step.cases) {
      if (!runbookCases.includes(name)) runbook.problems.push(`${step.step}: Cases: "${name}" is not one of the runbook's cases`)
    }
    for (const label of step.duplicates) runbook.problems.push(`${step.step}: two role lines for ${label}`)
    for (const [role, byCase] of Object.entries(step.caseOutcomes)) {
      unregistered(role)
      if (registry.names.includes(role) && !stepRoles.includes(role)) {
        runbook.problems.push(`${step.step}: role line "${role}" is not one of the step's roles`)
      }
      for (const [name, outcome] of Object.entries(byCase)) {
        if (runbookContext === null) {
          runbook.problems.push(`${step.step}: role line "${role} in ${name}": the runbook has no context`)
          continue
        }
        if (!stepCases.includes(name)) {
          runbook.problems.push(`${step.step}: role line "${role} in ${name}" names a case the step does not run`)
        }
        if (runbook.surface === 'api' && !API_OUTCOMES.includes(outcome)) {
          runbook.problems.push(`${step.step}: outcome "${outcome}" does not apply to api steps`)
        }
        addOutcome(outcomes, role, outcome)
      }
    }
    // The outcome that applies to a role in a case of this step: the case line, else the no-case line.
    for (const role of new Set([...Object.keys(step.outcomes), ...Object.keys(step.caseOutcomes)])) {
      if (!registry.names.includes(role)) continue
      const roleCases = Object.hasOwn(byCaseOutcomes, role) ? byCaseOutcomes[role] : (byCaseOutcomes[role] = {})
      const own = Object.hasOwn(step.caseOutcomes, role) ? step.caseOutcomes[role] : {}
      for (const name of stepCases) {
        const applies = Object.hasOwn(own, name) ? own[name] : Object.hasOwn(step.outcomes, role) ? step.outcomes[role] : null
        if (applies === null) continue
        const seen = Object.hasOwn(roleCases, name) ? roleCases[name] : []
        if (!seen.includes(applies)) roleCases[name] = [...seen, applies]
      }
    }
    if (step.as !== null && !runbook.review.some((entry) => entry.reason === 'roles-enabled')) {
      runbook.warnings.push(`${step.step}: As: is replaced by role lines; /runbooks:update rewrites it`)
    }
  }
  runbook.roleOutcomes = outcomes
  if (Object.keys(registry.contexts).length > 0) runbook.outcomesByCase = byCaseOutcomes
}

function readRunbook(file, rel, config, projectRoot, registry) {
  const runbooksDir = config.paths.runbooks
  const stack = config.stack
  const viewports = config.viewports ?? {}
  const segments = rel.split('/')
  const flow = segments.join('.').replace(/\.md$/, '')
  const runbook = {
    id: flow,
    path: `${runbooksDir}/${rel}`,
    title: '',
    capability: segments[0],
    surface: 'ui',
    feature: null,
    tags: [],
    roles: [],
    rolesAll: false,
    review: [],
    roleOutcomes: {},
    viewports: [],
    design: {},
    covers: { entries: [], requirements: [] },
    calls: [],
    sources: [],
    scripts: [],
    status: null,
    lastRun: null,
    upstream: upstreamModeOf(config),
    problems: [],
    warnings: [],
  }
  if (segments.length !== 2) runbook.problems.push('runbooks live exactly one folder deep: <capability>/<flow>.md')

  const parts = splitFrontmatter(fs.readFileSync(file, 'utf8'))
  if (!parts) {
    runbook.problems.push('missing frontmatter block')
    return runbook
  }
  let data
  try {
    data = parseYaml(parts.yaml)
  } catch (err) {
    runbook.problems.push(`frontmatter: ${err.message}`)
    return runbook
  }

  if (data.id !== runbook.id) runbook.problems.push(`id "${data.id}" does not match the path, expected "${runbook.id}"`)
  if (data.capability !== runbook.capability) runbook.problems.push(`capability "${data.capability}" does not match the folder "${runbook.capability}"`)
  if (STATUSES.includes(data.status)) runbook.status = data.status
  else runbook.problems.push(`status "${data.status}" must be one of ${STATUSES.join(', ')}`)

  const surface = data.surface ?? 'ui'
  if (!SURFACES.includes(surface)) runbook.problems.push(`surface "${surface}" must be one of ${SURFACES.join(', ')}`)
  else if (!surfacesOf(stack).includes(surface)) runbook.problems.push(`surface "${surface}" is not allowed in a ${stack} stack`)
  else runbook.surface = surface

  runbook.viewports = asList(data.viewports)
  if (runbook.viewports.length > 0 && surface !== 'ui') runbook.problems.push('viewports apply only to ui runbooks')
  for (const name of runbook.viewports) {
    if (!Object.hasOwn(viewports, name)) runbook.problems.push(`viewport "${name}" is not in the config viewports`)
  }
  readDesign(runbook, data.design, surface, config.design ?? null)

  runbook.title = data.title === null || data.title === undefined ? '' : String(data.title)
  runbook.feature = data.feature ?? null
  runbook.tags = asList(data.tags)
  readRoles(runbook, data, registry)
  readCases(runbook, data, parts.body, registry)
  readReview(runbook, data.review, registry)
  runbook.covers = { entries: asList(data.covers?.entries), requirements: asList(data.covers?.requirements) }
  readCalls(runbook, data, surface, config)
  runbook.sources = asList(data.sources)
  runbook.scripts = asList(data.scripts)
  runbook.lastRun = data.last_run ?? null
  const outdated = runbook.lastRun?.outdated
  if (outdated !== undefined && typeof outdated !== 'boolean') runbook.problems.push('last_run.outdated must be true or false')
  readUpstream(runbook, data, surface, config, projectRoot)
  if (registry !== null) readStepRoles(runbook, parts.body, registry)
  return runbook
}

export function loadRunbooks(projectRoot, config) {
  const runbooksDir = config.paths.runbooks
  const dir = path.resolve(projectRoot, runbooksDir)
  const registry = loadRoles(projectRoot, config)
  return findFiles(dir, '**/*.md')
    .filter((rel) => rel.includes('/') && !rel.split('/').some((segment) => segment.startsWith('_')))
    .map((rel) => readRunbook(path.join(dir, rel), rel, config, projectRoot, registry))
}

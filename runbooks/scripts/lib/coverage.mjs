import { matchesGlob } from './glob.mjs'
import { filterRunbooks } from './filter.mjs'
import { surfacesOf } from './config.mjs'
import { effectivePermissions, allowedActions, contextOfKey, keyMatches, CLOSING_OUTCOMES } from './roles.mjs'

const NO_SLICE = '(no slice)'

export function sliceOf(file, slices) {
  if (!file) return null
  for (const [name, globs] of Object.entries(slices)) {
    if (globs.some((glob) => matchesGlob(file, glob))) return name
  }
  return null
}

// For each ref, the scripts of the runbooks that cite it: active runbooks first, then draft, then placeholder.
function scriptsByRef(runbooks, field) {
  const scripts = new Map()
  for (const status of ['active', 'draft', 'placeholder']) {
    for (const rb of runbooks.filter((r) => r.status === status)) {
      for (const ref of rb.covers[field]) {
        const list = scripts.get(ref) ?? []
        list.push(...rb.scripts.filter((script) => !list.includes(script)))
        scripts.set(ref, list)
      }
    }
  }
  return scripts
}

// For each ref, the sorted ids of the runbooks that cite it.
function runbooksByRef(runbooks, field) {
  const ids = new Map()
  for (const rb of runbooks) {
    for (const ref of rb.covers[field]) ids.set(ref, [...(ids.get(ref) ?? []), rb.id])
  }
  for (const list of ids.values()) list.sort()
  return ids
}

function refsByStatus(runbooks, field) {
  const pick = (status) => new Set(runbooks.filter((rb) => rb.status === status).flatMap((rb) => rb.covers[field]))
  return {
    active: pick('active'), draft: pick('draft'), placeholder: pick('placeholder'),
    scripts: scriptsByRef(runbooks, field), runbooks: runbooksByRef(runbooks, field),
  }
}

export const surfaceOfEntry = (entry) => (entry.kind === 'api-endpoint' ? 'api' : 'ui')

// refsFor(item) picks the refs that can cover the item; see docs/adr/0002.
function withState(items, refsFor) {
  return items.map((item) => {
    const refs = refsFor(item)
    return {
      ...item,
      state: refs.active.has(item.id) ? 'covered'
        : refs.draft.has(item.id) ? 'pending'
        : refs.placeholder.has(item.id) ? 'planned'
        : 'uncovered',
    }
  })
}

function summarize(items) {
  return {
    total: items.length,
    covered: items.filter((i) => i.state === 'covered').length,
    pending: items.filter((i) => i.state === 'pending').length,
    planned: items.filter((i) => i.state === 'planned').length,
    uncovered: items
      .filter((i) => i.state === 'uncovered')
      .map((i) => {
        const item = { ...i }
        delete item.state
        return item
      }),
  }
}

export function computeCoverage({
  runbooks,
  entries,
  requirements,
  requirementsConfigured,
  requirementsRan = true,
  slices,
  stack = 'frontend',
  filters = {},
  unavailable = { entries: false, requirements: false },
  withItems = false,
}) {
  const requirementsAvailable = requirementsConfigured && requirementsRan
  const valid = runbooks.filter((rb) => rb.problems.length === 0 && rb.status !== 'deprecated')
  const scoped = filterRunbooks(valid, { capability: filters.capability, feature: filters.feature })
  const sliceName = filters.slice ?? filters.capability
  const featureEntries = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.entries)) : null
  const featureRequirements = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.requirements)) : null

  // A mocked runbook never reaches its upstream API, so it covers no endpoint; see docs/adr/0004.
  const notMocked = valid.filter((rb) => rb.upstream !== 'mocked')
  const bySurface = surfacesOf(stack).includes('api')
  const entryRefs = bySurface
    ? Object.fromEntries(['ui', 'api'].map((surface) => [surface, refsByStatus((surface === 'api' ? notMocked : valid).filter((rb) => rb.surface === surface), 'entries')]))
    : null
  const allEntryRefs = refsByStatus(valid, 'entries')
  const endpointRefs = refsByStatus(notMocked, 'entries')
  const entryRefsFor = (entry) => (bySurface ? entryRefs[surfaceOfEntry(entry)] : entry.kind === 'api-endpoint' ? endpointRefs : allEntryRefs)
  const mockedBy = new Map()
  for (const rb of valid.filter((r) => r.upstream === 'mocked')) {
    for (const ref of rb.covers.entries) mockedBy.set(ref, [...(mockedBy.get(ref) ?? []), rb.id])
  }
  const citedByMockedOf = (entry) => {
    const ids = entry.kind === 'api-endpoint' ? mockedBy.get(entry.id) : null
    return ids ? { citedByMocked: [...ids].sort() } : {}
  }
  const scopedEntries = withState(
    entries
      .map((entry) => ({ ...entry, slice: sliceOf(entry.file, slices) }))
      .filter((entry) =>
        (!sliceName || entry.slice === sliceName) &&
        (!filters.path || (entry.file !== null && matchesGlob(entry.file, filters.path))) &&
        (!featureEntries || featureEntries.has(entry.id)),
      ),
    entryRefsFor,
  ).map((entry) => ({ ...entry, ...citedByMockedOf(entry) }))

  const requirementRefs = refsByStatus(valid, 'requirements')
  const scopedRequirements = requirementsAvailable
    ? withState(requirements.filter((r) => !featureRequirements || featureRequirements.has(r.id)), () => requirementRefs)
    : null

  const groupMap = new Map()
  for (const entry of scopedEntries) {
    const name = entry.slice ?? NO_SLICE
    const surface = bySurface ? surfaceOfEntry(entry) : null
    const key = `${name}\0${surface}`
    const group = groupMap.get(key) ?? {
      name, ...(bySurface && { surface }), total: 0, covered: 0, pending: 0, planned: 0, ...(withItems && { items: [] }),
    }
    group.total++
    if (entry.state === 'covered') group.covered++
    if (entry.state === 'pending') group.pending++
    if (entry.state === 'planned') group.planned++
    const refs = entryRefsFor(entry)
    group.items?.push({
      id: entry.id, kind: entry.kind, file: entry.file, state: entry.state,
      runbooks: refs.runbooks.get(entry.id) ?? [],
      ...(entry.citedByMocked && { citedByMocked: entry.citedByMocked }),
      tests: refs.scripts.get(entry.id) ?? [],
    })
    groupMap.set(key, group)
  }
  for (const group of groupMap.values()) group.items?.sort((a, b) => a.id.localeCompare(b.id))
  const groups = [...groupMap.values()].sort((a, b) =>
    (a.name === NO_SLICE) - (b.name === NO_SLICE) || a.name.localeCompare(b.name) || (a.surface ?? '').localeCompare(b.surface ?? ''))

  const entryIds = new Set(entries.map((e) => e.id))
  const requirementIds = new Set(requirements.map((r) => r.id))
  // A list whose sources did not all run cannot tell a removed id from an unread one.
  const checkEntries = !unavailable.entries
  const checkRequirements = requirementsAvailable && !unavailable.requirements
  const orphanChecksSkipped = [
    ...(checkEntries ? [] : ['entry']),
    ...(requirementsConfigured && !checkRequirements ? ['requirement'] : []),
  ]
  const orphans = scoped.flatMap((rb) => [
    ...(checkEntries
      ? rb.covers.entries.filter((ref) => !entryIds.has(ref)).map((ref) => ({ runbook: rb.id, kind: 'entry', ref }))
      : []),
    ...(checkRequirements
      ? rb.covers.requirements.filter((ref) => !requirementIds.has(ref)).map((ref) => ({ runbook: rb.id, kind: 'requirement', ref }))
      : []),
  ])

  const active = scoped.filter((rb) => rb.status === 'active')
  return {
    entries: summarize(scopedEntries),
    requirements: scopedRequirements && summarize(scopedRequirements),
    requirementsNote: requirementsConfigured && !requirementsRan ? 'requirement sources did not run' : null,
    groups,
    orphans,
    orphanChecksSkipped,
    runbooks: {
      active: active.length,
      draft: scoped.filter((rb) => rb.status === 'draft').length,
      placeholder: scoped.filter((rb) => rb.status === 'placeholder').length,
      automated: active.filter((rb) => rb.scripts.length > 0).length,
    },
    invalid: runbooks.filter((rb) => rb.problems.length > 0).map((rb) => ({ id: rb.id, path: rb.path, problems: rb.problems })),
  }
}

// Per role, every key in any role's matrix. With access, an active runbook that matches the key and runs
// the role covers it. Without access, the runbook must also close the role out (read-only, hidden or denied).
// A key of a context gets one row per case, and the runbook's cases must include the case.
export function roleCoverage(registry, runbooks, { role } = {}) {
  const keys = [...new Set(registry.names.flatMap((name) => Object.keys(effectivePermissions(registry, name))))].sort()
  const candidates = runbooks.filter((rb) => rb.problems.length === 0 && (rb.status === 'active' || rb.status === 'draft'))
  const rowFor = (name, key, kase) => {
    const [capability, feature] = key.split('/', 2)
    const access = allowedActions(registry, name, capability, feature === '*' ? null : feature, kase).length > 0
    const closes = (rb) => {
      const byRole = kase === null ? rb.roleOutcomes : rb.outcomesByCase
      if (!Object.hasOwn(byRole ?? {}, name)) return false
      const outcomes = kase === null ? byRole[name] : (Object.hasOwn(byRole[name], kase) ? byRole[name][kase] : [])
      return outcomes.some((outcome) => CLOSING_OUTCOMES.includes(outcome))
    }
    const qualifying = candidates
      .filter((rb) =>
        rb.roles.includes(name) && keyMatches(key, rb.capability, rb.feature) &&
        (kase === null || (rb.cases ?? []).includes(kase)) &&
        (access || closes(rb)))
      .sort((a, b) => a.id.localeCompare(b.id))
    return {
      key,
      ...(kase === null ? {} : { case: kase }),
      access,
      state: qualifying.some((rb) => rb.status === 'active') ? 'covered' : qualifying.length > 0 ? 'pending' : 'uncovered',
      runbooks: qualifying.map((rb) => rb.id),
    }
  }
  return registry.names.filter((name) => !role || name === role).map((name) => ({
    role: name,
    keys: keys.flatMap((key) => {
      const context = contextOfKey(registry, key)
      return context === null ? [rowFor(name, key, null)] : registry.contexts[context].cases.map((kase) => rowFor(name, key, kase))
    }),
  }))
}

import { matchesGlob } from './glob.mjs'
import { filterRunbooks } from './filter.mjs'
import { surfacesOf } from './config.mjs'

const NO_SLICE = '(no slice)'

export function sliceOf(file, slices) {
  if (!file) return null
  for (const [name, globs] of Object.entries(slices)) {
    if (globs.some((glob) => matchesGlob(file, glob))) return name
  }
  return null
}

function refsByStatus(runbooks, field) {
  const pick = (status) => new Set(runbooks.filter((rb) => rb.status === status).flatMap((rb) => rb.covers[field]))
  return { active: pick('active'), draft: pick('draft'), placeholder: pick('placeholder') }
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
}) {
  const requirementsAvailable = requirementsConfigured && requirementsRan
  const valid = runbooks.filter((rb) => rb.problems.length === 0 && rb.status !== 'deprecated')
  const scoped = filterRunbooks(valid, { capability: filters.capability, feature: filters.feature })
  const sliceName = filters.slice ?? filters.capability
  const featureEntries = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.entries)) : null
  const featureRequirements = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.requirements)) : null

  const bySurface = surfacesOf(stack).includes('api')
  const entryRefs = bySurface
    ? Object.fromEntries(['ui', 'api'].map((surface) => [surface, refsByStatus(valid.filter((rb) => rb.surface === surface), 'entries')]))
    : null
  const allEntryRefs = refsByStatus(valid, 'entries')
  const scopedEntries = withState(
    entries
      .map((entry) => ({ ...entry, slice: sliceOf(entry.file, slices) }))
      .filter((entry) =>
        (!sliceName || entry.slice === sliceName) &&
        (!filters.path || (entry.file !== null && matchesGlob(entry.file, filters.path))) &&
        (!featureEntries || featureEntries.has(entry.id)),
      ),
    (entry) => (bySurface ? entryRefs[surfaceOfEntry(entry)] : allEntryRefs),
  )

  const requirementRefs = refsByStatus(valid, 'requirements')
  const scopedRequirements = requirementsAvailable
    ? withState(requirements.filter((r) => !featureRequirements || featureRequirements.has(r.id)), () => requirementRefs)
    : null

  const groupMap = new Map()
  for (const entry of scopedEntries) {
    const name = entry.slice ?? NO_SLICE
    const surface = bySurface ? surfaceOfEntry(entry) : null
    const key = `${name}\0${surface}`
    const group = groupMap.get(key) ?? { name, ...(bySurface && { surface }), total: 0, covered: 0, pending: 0, planned: 0 }
    group.total++
    if (entry.state === 'covered') group.covered++
    if (entry.state === 'pending') group.pending++
    if (entry.state === 'planned') group.planned++
    groupMap.set(key, group)
  }
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

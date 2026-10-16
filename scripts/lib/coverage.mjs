import { matchesGlob } from './glob.mjs'
import { filterRunbooks } from './filter.mjs'

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
  return { active: pick('active'), draft: pick('draft') }
}

function withState(items, refs) {
  return items.map((item) => ({
    ...item,
    state: refs.active.has(item.id) ? 'covered' : refs.draft.has(item.id) ? 'pending' : 'uncovered',
  }))
}

function summarize(items) {
  return {
    total: items.length,
    covered: items.filter((i) => i.state === 'covered').length,
    pending: items.filter((i) => i.state === 'pending').length,
    uncovered: items
      .filter((i) => i.state === 'uncovered')
      .map((i) => {
        const item = { ...i }
        delete item.state
        return item
      }),
  }
}

export function computeCoverage({ runbooks, entries, requirements, requirementsConfigured, slices, filters = {} }) {
  const valid = runbooks.filter((rb) => rb.problems.length === 0 && rb.status !== 'deprecated')
  const scoped = filterRunbooks(valid, { capability: filters.capability, feature: filters.feature })
  const sliceName = filters.slice ?? filters.capability
  const featureEntries = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.entries)) : null
  const featureRequirements = filters.feature ? new Set(scoped.flatMap((rb) => rb.covers.requirements)) : null

  const scopedEntries = withState(
    entries
      .map((entry) => ({ ...entry, slice: sliceOf(entry.file, slices) }))
      .filter((entry) =>
        (!sliceName || entry.slice === sliceName) &&
        (!filters.path || (entry.file !== null && matchesGlob(entry.file, filters.path))) &&
        (!featureEntries || featureEntries.has(entry.id)),
      ),
    refsByStatus(valid, 'entries'),
  )

  const scopedRequirements = requirementsConfigured
    ? withState(requirements.filter((r) => !featureRequirements || featureRequirements.has(r.id)), refsByStatus(valid, 'requirements'))
    : null

  const groupMap = new Map()
  for (const entry of scopedEntries) {
    const name = entry.slice ?? NO_SLICE
    const group = groupMap.get(name) ?? { name, total: 0, covered: 0, pending: 0 }
    group.total++
    if (entry.state === 'covered') group.covered++
    if (entry.state === 'pending') group.pending++
    groupMap.set(name, group)
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.name === NO_SLICE) return 1
    if (b.name === NO_SLICE) return -1
    return a.name.localeCompare(b.name)
  })

  const entryIds = new Set(entries.map((e) => e.id))
  const requirementIds = new Set(requirements.map((r) => r.id))
  const orphans = scoped.flatMap((rb) => [
    ...rb.covers.entries.filter((ref) => !entryIds.has(ref)).map((ref) => ({ runbook: rb.id, kind: 'entry', ref })),
    ...(requirementsConfigured
      ? rb.covers.requirements.filter((ref) => !requirementIds.has(ref)).map((ref) => ({ runbook: rb.id, kind: 'requirement', ref }))
      : []),
  ])

  const active = scoped.filter((rb) => rb.status === 'active')
  return {
    entries: summarize(scopedEntries),
    requirements: scopedRequirements && summarize(scopedRequirements),
    groups,
    orphans,
    runbooks: {
      active: active.length,
      draft: scoped.filter((rb) => rb.status === 'draft').length,
      automated: active.filter((rb) => rb.scripts.length > 0).length,
    },
    invalid: runbooks.filter((rb) => rb.problems.length > 0).map((rb) => ({ id: rb.id, path: rb.path, problems: rb.problems })),
  }
}

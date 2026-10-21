// Moves the endpoint ids of an upstream API in another repository from covers.entries to calls;
// see docs/adr/0005. Without write it only plans, so the user reviews the moves first.
import fs from 'node:fs'
import path from 'node:path'
import { loadRunbooks } from './runbooks.mjs'
import { extractItems } from './extract.mjs'
import { computeCoverage } from './coverage.mjs'
import { normalizeCall } from './calls.mjs'
import { setListKeys } from './frontmatter-edit.mjs'
import { isOutside } from './config.mjs'

function entryCoverage(runbooks, entries, config) {
  const { entries: summary } = computeCoverage({
    runbooks, entries, requirements: [], requirementsConfigured: false, slices: config.slices, stack: config.stack,
  })
  return { covered: summary.covered, total: summary.total }
}

// Runbooks whose frontmatter did not parse have no covers to move; the loader already reports them.
const unreadable = (rb) => rb.problems.some((problem) => problem.startsWith('frontmatter:') || problem === 'missing frontmatter block')

export function moveToCalls(root, config, { source, write = false }) {
  if (!config.upstream) throw new Error('calls need an upstream block in the config: run /runbooks:settings upstream first')
  const perSource = config.entries.map((src, index) => ({ index, src, ...extractItems(root, [src], 'entries') }))
  let moving
  let kept
  if (source !== undefined) {
    const index = Number(source)
    if (!/^\d+$/.test(String(source)) || index >= perSource.length) {
      throw new Error(`--source must be the index of an entries source, from 0 to ${perSource.length - 1}`)
    }
    const picked = perSource[index]
    if (!picked.src.root || !isOutside(root, picked.src.root)) throw new Error(`entries[${index}] is inside the project: its ids stay entries`)
    if (picked.ran === 0) {
      throw new Error(`entries[${index}]: root "${picked.src.root}" does not exist, so its ids cannot be read. Remove the source from the config and run move-to-calls without --source`)
    }
    const others = perSource.filter((item) => item.index !== index)
    const unread = others.find((item) => !item.complete)
    if (unread) throw new Error(`entries[${unread.index}] did not run, so an id of entries[${index}] cannot be told apart from it`)
    kept = others.flatMap((item) => item.items)
    const keptIds = new Set(kept.map((item) => item.id))
    moving = new Set(picked.items.map((item) => item.id).filter((id) => !keptIds.has(id)))
  } else {
    const reading = perSource.find((item) => item.src.root && isOutside(root, item.src.root) && item.ran > 0)
    if (reading) throw new Error(`entries[${reading.index}] still reads "${reading.src.root}": pass --source ${reading.index}`)
    const unread = perSource.find((item) => !item.complete)
    if (unread) throw new Error(`entries[${unread.index}] did not run, so an orphan cannot be told from an unread id. Remove the source from the config first`)
    kept = perSource.flatMap((item) => item.items)
    moving = null
  }
  const keptIds = new Set(kept.map((item) => item.id))
  const moves = (ref) => (moving ? moving.has(ref) : !keptIds.has(ref) && normalizeCall(ref) !== null)

  const runbooks = loadRunbooks(root, config)
  const plan = { source: source === undefined ? null : Number(source), sourceRoot: source === undefined ? null : config.entries[Number(source)].root, runbooks: [], left: [], orphansLeft: [], written: [] }
  const edited = []
  for (const rb of runbooks) {
    if (unreadable(rb)) continue
    const move = rb.covers.entries.filter(moves)
    const entries = rb.covers.entries.filter((ref) => !moves(ref))
    for (const ref of entries.filter((id) => !keptIds.has(id))) plan.orphansLeft.push({ runbook: rb.id, ref })
    if (move.length === 0) {
      edited.push(rb)
      continue
    }
    if (rb.surface !== 'ui') {
      plan.left.push({ id: rb.id, ids: move, reason: 'an api runbook verifies endpoints of this repository only: move it to the repository of its API' })
      edited.push(rb)
      continue
    }
    const calls = [...rb.calls]
    for (const call of move.map(normalizeCall)) if (!calls.includes(call)) calls.push(call)
    plan.runbooks.push({ id: rb.id, path: rb.path, move, calls })
    edited.push({ ...rb, covers: { ...rb.covers, entries }, calls })
  }
  const allEntries = perSource.flatMap((item) => item.items)
  plan.coverage = { before: entryCoverage(runbooks, allEntries, config), after: entryCoverage(edited, kept, config) }

  if (write) {
    // Every edit is computed first, so a runbook the editor refuses leaves every file unwritten.
    const texts = plan.runbooks.map((item) => {
      const file = path.resolve(root, item.path)
      const rb = edited.find((r) => r.id === item.id)
      try {
        return [file, setListKeys(fs.readFileSync(file, 'utf8'), { 'covers.entries': rb.covers.entries, calls: item.calls })]
      } catch (err) {
        throw new Error(`${item.path}: ${err.message}. Nothing was written`)
      }
    })
    for (const [file, text] of texts) fs.writeFileSync(file, text)
    plan.written = plan.runbooks.map((item) => item.path)
  }
  return plan
}

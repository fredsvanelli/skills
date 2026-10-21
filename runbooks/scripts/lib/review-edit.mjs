// Bulk edits of the roles and review keys: mark runbooks for review and migrate a project to role tracking.
// Without write it only plans, as move-to-calls does.
import fs from 'node:fs'
import path from 'node:path'
import { loadRunbooks } from './runbooks.mjs'
import { setRoleKeys } from './frontmatter-edit.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'

// Runbooks whose frontmatter did not parse cannot be edited; the loader already reports them.
const unreadableProblem = (rb) => rb.problems.find((problem) => problem.startsWith('frontmatter:') || problem === 'missing frontmatter block')

const sameEntry = (a, b) => a.reason === b.reason && a.role === b.role && a.key === b.key

// Computes every edit first, so a runbook the editor refuses leaves every file unwritten.
function writeEdits(root, edits) {
  const texts = edits.map(({ item, keys }) => {
    const file = path.resolve(root, item.path)
    try {
      return [file, setRoleKeys(fs.readFileSync(file, 'utf8'), keys)]
    } catch (err) {
      throw new Error(`${item.path}: ${err.message}. Nothing was written`)
    }
  })
  for (const [file, text] of texts) fs.writeFileSync(file, text)
  return edits.map(({ item }) => item.path)
}

export function planReview(root, config, ids, { entry, clear = false, write = false }) {
  const loaded = loadRunbooks(root, config)
  const plan = { runbooks: [], written: [] }
  const edits = []
  for (const id of ids) {
    const rb = loaded.find((r) => r.id === id)
    if (!rb) throw new Error(`no runbook with id "${id}"`)
    const review = clear ? [] : rb.review.some((existing) => sameEntry(existing, entry)) ? rb.review : [...rb.review, entry]
    const item = { id, path: rb.path, review }
    plan.runbooks.push(item)
    if (review.length !== rb.review.length) edits.push({ item, keys: { review } })
  }
  if (write) plan.written = writeEdits(root, edits)
  return plan
}

export function planEnableRoles(root, config, { date, write = false }) {
  const plan = { runbooks: [], skipped: [], written: [] }
  const edits = []
  for (const rb of loadRunbooks(root, config)) {
    if (rb.status === 'deprecated') continue
    const problem = unreadableProblem(rb)
    if (problem) {
      plan.skipped.push({ id: rb.id, reason: problem })
      continue
    }
    const written = parseYaml(splitFrontmatter(fs.readFileSync(path.resolve(root, rb.path), 'utf8')).yaml).roles
    const marks = rb.status !== 'placeholder' && !rb.review.some((entry) => entry.reason === 'roles-enabled')
    if (written === 'all' && !marks) continue
    const item = { id: rb.id, path: rb.path, roles: 'all', review: marks }
    plan.runbooks.push(item)
    const keys = { roles: 'all' }
    if (marks) keys.review = [...rb.review, { reason: 'roles-enabled', date }]
    edits.push({ item, keys })
  }
  if (write) plan.written = writeEdits(root, edits)
  return plan
}

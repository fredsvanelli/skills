// Permission changes of one role, read from the git history of the registry file.
import { execFileSync } from 'node:child_process'
import { rolesFileOf } from './config.mjs'
import { parseRoles, effectivePermissions } from './roles.mjs'

// The role's effective matrix at a revision. null when the revision does not parse. An absent file
// or role is an empty matrix, because the role did not exist yet.
function matrixAt(git, rev, file, name) {
  let text
  try {
    text = git('show', `${rev}:./${file}`)
  } catch {
    return {}
  }
  try {
    const registry = parseRoles(JSON.parse(text))
    return registry.names.includes(name) ? effectivePermissions(registry, name) : {}
  } catch {
    return null
  }
}

function diffMatrices(before, after) {
  const changes = []
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!before[key]) changes.push(`${key}: key added`)
    else if (!after[key]) changes.push(`${key}: key removed`)
    else {
      for (const action of before[key].actions) if (!after[key].actions.includes(action)) changes.push(`${key}: ${action} removed`)
      for (const action of after[key].actions) if (!before[key].actions.includes(action)) changes.push(`${key}: ${action} added`)
    }
  }
  return changes
}

// Runbook files the commit changed with an added line that marks this role for review.
function markedCount(git, sha, dir, name) {
  let diff
  try {
    diff = git('show', '--format=', '--unified=0', sha, '--', dir)
  } catch {
    return 0
  }
  const marked = new Set()
  const own = new RegExp(`role:\\s*${name}(?![a-z0-9-])`)
  let file = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4)
    else if (line.startsWith('+') && file?.endsWith('.md') && line.includes('reason: role-permissions') && own.test(line)) marked.add(file)
  }
  return marked.size
}

export function roleHistory(root, config, name, { limit = 50 } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  const file = rolesFileOf(config)
  let log
  try {
    log = git('log', '--format=%h%x09%ad', '--date=short', '-n', String(limit), '--', file)
  } catch {
    return []
  }
  const history = []
  for (const line of log.split('\n').filter(Boolean)) {
    const [commit, date] = line.split('\t')
    const after = matrixAt(git, commit, file, name)
    const before = matrixAt(git, `${commit}^`, file, name)
    if (after === null) continue
    // A parent revision whose registry does not parse gives nothing to compare with. A first commit has no
    // parent, and matrixAt reads it as an empty matrix, so the role starts from nothing.
    if (before === null) continue
    const changes = diffMatrices(before, after)
    if (changes.length === 0) continue
    history.push({ date, commit, changes, marked: markedCount(git, commit, config.paths.runbooks, name) })
  }
  return history
}

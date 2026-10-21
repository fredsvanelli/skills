import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { matchesGlob } from './glob.mjs'
import { matchCall, changedOperations } from './contract.mjs'

export function changedFiles(projectRoot, base) {
  const git = (...args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    throw new Error(`base "${base}" is not a known branch or commit`)
  }
  const output = [
    git('diff', '--name-only', '--relative', `${base}...HEAD`),
    git('diff', '--name-only', '--relative', 'HEAD'),
    git('ls-files', '--others', '--exclude-standard'),
  ].join('\n')
  return [...new Set(output.split('\n').map((line) => line.trim()).filter(Boolean))].sort()
}

// The operations a new version of upstream.schema changed since the merge base, or null when the file
// did not change or did not exist there (nothing to compare). The working tree counts, as in changedFiles.
export function schemaChanges(projectRoot, base, schemaFile, changed) {
  if (!schemaFile || !changed.includes(path.posix.normalize(schemaFile))) return null
  const git = (...args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let before
  try {
    before = JSON.parse(git('show', `${git('merge-base', base, 'HEAD').trim()}:./${schemaFile}`))
  } catch {
    return null
  }
  const file = path.resolve(projectRoot, schemaFile)
  let after = {}
  if (fs.existsSync(file)) {
    try {
      after = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`${schemaFile} is not valid JSON: ${err.message}`)
    }
  }
  return { before, after, changes: changedOperations(before, after) }
}

export function affectedRunbooks({ runbooks, entries, slices, changed, schema = null }) {
  const changedSet = new Set(changed)
  const fileOf = new Map(entries.map((entry) => [entry.id, entry.file]))
  return runbooks.flatMap((runbook) => {
    // Placeholders have no steps to run.
    if (runbook.status === 'deprecated' || runbook.status === 'placeholder') return []
    const reasons = []
    if (changedSet.has(runbook.path)) reasons.push('runbook changed')
    for (const id of runbook.covers.entries) {
      const file = fileOf.get(id)
      if (file && changedSet.has(file)) reasons.push(`${id} (${file})`)
    }
    const globs = slices[runbook.capability] ?? []
    const sliceHits = changed.filter((file) => globs.some((glob) => matchesGlob(file, glob)))
    if (sliceHits.length > 0) reasons.push(`slice ${runbook.capability}: ${sliceHits.length} file(s)`)
    // A removed operation is found in the old document, the others in the new one; see docs/adr/0005.
    for (const { operation, change } of schema?.changes ?? []) {
      const doc = change === 'removed' ? schema.before : schema.after
      if ((runbook.calls ?? []).some((call) => matchCall(call, doc) === operation)) reasons.push(`upstream schema: ${operation} ${change}`)
    }
    return reasons.length > 0 ? [{ runbook, reasons }] : []
  })
}

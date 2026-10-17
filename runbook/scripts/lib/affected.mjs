import { execFileSync } from 'node:child_process'
import { matchesGlob } from './glob.mjs'

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

export function affectedRunbooks({ runbooks, entries, slices, changed }) {
  const changedSet = new Set(changed)
  const fileOf = new Map(entries.map((entry) => [entry.id, entry.file]))
  return runbooks.flatMap((runbook) => {
    if (runbook.status === 'deprecated') return []
    const reasons = []
    if (changedSet.has(runbook.path)) reasons.push('runbook changed')
    for (const id of runbook.covers.entries) {
      const file = fileOf.get(id)
      if (file && changedSet.has(file)) reasons.push(`${id} (${file})`)
    }
    const globs = slices[runbook.capability] ?? []
    const sliceHits = changed.filter((file) => globs.some((glob) => matchesGlob(file, glob)))
    if (sliceHits.length > 0) reasons.push(`slice ${runbook.capability}: ${sliceHits.length} file(s)`)
    return reasons.length > 0 ? [{ runbook, reasons }] : []
  })
}

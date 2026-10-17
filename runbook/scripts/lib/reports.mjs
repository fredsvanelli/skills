import fs from 'node:fs'
import path from 'node:path'
import { splitFrontmatter, parseYaml } from './yaml.mjs'

// Report files are named <YYYY-MM-DD-HHMM>-<runbook id>.md, so a name sort is a date sort.
const RUN_PREFIX = /^\d{4}-\d{2}-\d{2}-\d{4}-/

function readSteps(body) {
  const steps = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\|\s*(S\d+)\s*\|\s*([a-z-]+)\s*\|/)
    if (match) steps.push({ step: match[1], state: match[2] })
  }
  return steps
}

function readReport(runsDir, runbooksDir, name) {
  const text = fs.readFileSync(path.join(runsDir, name), 'utf8')
  const parts = splitFrontmatter(text)
  const data = parts ? parseYaml(parts.yaml) : {}
  const steps = readSteps(parts ? parts.body : text)
  const counts = {}
  for (const { state } of steps) counts[state] = (counts[state] ?? 0) + 1
  return {
    path: `${runbooksDir}/_runs/${name}`,
    run: data.run ?? name.replace(/\.md$/, ''),
    date: data.date === undefined || data.date === null ? null : String(data.date),
    commit: data.commit === undefined || data.commit === null ? null : String(data.commit),
    branch: data.branch ?? null,
    mode: data.mode ?? null,
    result: data.result ?? null,
    partial: data.partial === true,
    counts,
    steps,
  }
}

// With full, partial runs (--steps) are skipped, as last_run skips them.
export function latestReport(projectRoot, runbooksDir, id, { full = false } = {}) {
  const runsDir = path.resolve(projectRoot, runbooksDir, '_runs')
  if (!fs.existsSync(runsDir)) return null
  const names = fs.readdirSync(runsDir)
    .filter((name) => RUN_PREFIX.test(name) && name.replace(RUN_PREFIX, '') === `${id}.md`)
    .sort()
    .reverse()
  for (const name of names) {
    const report = readReport(runsDir, runbooksDir, name)
    if (!full || !report.partial) return report
  }
  return null
}

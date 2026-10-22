import fs from 'node:fs'
import path from 'node:path'
import { splitFrontmatter, parseYaml } from './yaml.mjs'

// Report files are named <YYYY-MM-DD-HHMM>-<runbook id>.md, so a name sort is a date sort.
export const RUN_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}-[\w-]+\.[\w-]+\.md$/
const RUN_PREFIX = /^\d{4}-\d{2}-\d{2}-\d{4}-/

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

// Reads the first table whose header starts with Step. Column positions come from the header row.
function readSteps(body) {
  const steps = []
  let columns = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) {
      if (columns) break
      continue
    }
    const row = cells(line)
    if (!columns) {
      if (row[0] === 'Step') columns = { step: 0, state: row.indexOf('State'), role: row.indexOf('Role'), case: row.indexOf('Case'), viewport: row.indexOf('Viewport') }
      continue
    }
    if (!/^S\d+$/.test(row[columns.step]) || columns.state < 0) continue
    if (!row[columns.state]) continue
    const entry = { step: row[columns.step], state: row[columns.state] }
    if (columns.role >= 0) entry.role = row[columns.role] ?? ''
    if (columns.case >= 0) entry.case = row[columns.case] ?? ''
    if (columns.viewport >= 0) entry.viewport = row[columns.viewport] ?? ''
    steps.push(entry)
  }
  return steps
}

function readReport(runsDir, runbooksDir, name) {
  const text = fs.readFileSync(path.join(runsDir, name), 'utf8')
  const parts = splitFrontmatter(text)
  let data = {}
  if (parts) {
    try {
      data = parseYaml(parts.yaml)
    } catch {
      // Hand-edited frontmatter that does not parse: list the report with null fields.
    }
  }
  const body = parts ? parts.body : text
  const steps = readSteps(body)
  const counts = {}
  for (const { state } of steps) counts[state] = (counts[state] ?? 0) + 1
  return {
    name,
    body,
    path: `${runbooksDir}/_runs/${name}`,
    run: data.run ?? name.replace(/\.md$/, ''),
    date: data.date === undefined || data.date === null ? null : String(data.date),
    commit: data.commit === undefined || data.commit === null ? null : String(data.commit),
    branch: data.branch ?? null,
    mode: data.mode ?? null,
    upstream: data.upstream ?? null,
    roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
    cases: Array.isArray(data.cases) ? data.cases.map(String) : [],
    viewports: Array.isArray(data.viewports) ? data.viewports.map(String) : [],
    result: data.result ?? null,
    partial: data.partial === true,
    counts,
    steps,
  }
}

function runsDirOf(projectRoot, runbooksDir) {
  return path.resolve(projectRoot, runbooksDir, '_runs')
}

function withoutBody({ body, ...report }) {
  return report
}

// Every report of one runbook, newest first, partial runs included.
export function listReports(projectRoot, runbooksDir, id) {
  const runsDir = runsDirOf(projectRoot, runbooksDir)
  if (!fs.existsSync(runsDir)) return []
  return fs.readdirSync(runsDir)
    .filter((name) => RUN_PREFIX.test(name) && name.replace(RUN_PREFIX, '') === `${id}.md`)
    .sort()
    .reverse()
    .map((name) => withoutBody(readReport(runsDir, runbooksDir, name)))
}

// The name comes from a URL, so it is matched against the directory listing and never joined blindly.
export function reportByName(projectRoot, runbooksDir, name) {
  if (typeof name !== 'string' || !RUN_NAME.test(name)) return null
  const runsDir = runsDirOf(projectRoot, runbooksDir)
  if (!fs.existsSync(runsDir) || !fs.readdirSync(runsDir).includes(name)) return null
  const report = readReport(runsDir, runbooksDir, name)
  return { ...report, runbook: name.replace(RUN_PREFIX, '').replace(/\.md$/, '') }
}

// With full, partial runs (--steps) are skipped, as last_run skips them.
export function latestReport(projectRoot, runbooksDir, id, { full = false } = {}) {
  const reports = listReports(projectRoot, runbooksDir, id)
  return reports.find((report) => !full || !report.partial) ?? null
}

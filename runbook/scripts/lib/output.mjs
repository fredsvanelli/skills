import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Where older versions wrote the runs summary; removed whenever runs.* is written.
const LEGACY = ['_runs/output.json', '_runs/output.html']

// last_run is written only by full runs, so its date and result are the last full run.
export function outputRows(runbooks) {
  return runbooks.map((rb) => ({
    id: rb.id,
    title: rb.title,
    date: rb.lastRun?.date ? String(rb.lastRun.date) : null,
    result: rb.lastRun?.result ?? null,
  }))
}

// Writes <name>.json and <name>.html in the runbooks folder, the HTML with the same data
// inlined so it opens from disk (file:// cannot fetch the JSON).
function writePair(projectRoot, runbooksDir, name, value) {
  const dir = path.resolve(projectRoot, runbooksDir)
  fs.mkdirSync(dir, { recursive: true })
  const data = JSON.stringify(value, null, 2)
  fs.writeFileSync(path.join(dir, `${name}.json`), `${data}\n`)
  const template = fileURLToPath(new URL(`../../templates/${name}.html`, import.meta.url))
  const html = fs.readFileSync(template, 'utf8').replace('/*DATA*/null', () => data.replaceAll('<', '\\u003c'))
  fs.writeFileSync(path.join(dir, `${name}.html`), html)
  return [`${runbooksDir}/${name}.json`, `${runbooksDir}/${name}.html`]
}

export function writeRuns(projectRoot, runbooksDir, rows) {
  for (const rel of LEGACY) fs.rmSync(path.resolve(projectRoot, runbooksDir, rel), { force: true })
  return writePair(projectRoot, runbooksDir, 'runs', rows)
}

export function writeCoverage(projectRoot, runbooksDir, result) {
  return writePair(projectRoot, runbooksDir, 'coverage', result)
}

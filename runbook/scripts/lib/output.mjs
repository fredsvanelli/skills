import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('../../templates/output.html', import.meta.url))

// last_run is written only by full runs, so its date and result are the last full run.
export function outputRows(runbooks) {
  return runbooks.map((rb) => ({
    id: rb.id,
    title: rb.title,
    date: rb.lastRun?.date ? String(rb.lastRun.date) : null,
    result: rb.lastRun?.result ?? null,
  }))
}

// Writes _runs/output.json and _runs/output.html, the HTML with the same rows inlined
// so it opens from disk (file:// cannot fetch the JSON).
export function writeOutput(projectRoot, runbooksDir, rows) {
  const runsDir = path.resolve(projectRoot, runbooksDir, '_runs')
  fs.mkdirSync(runsDir, { recursive: true })
  const data = JSON.stringify(rows, null, 2)
  fs.writeFileSync(path.join(runsDir, 'output.json'), `${data}\n`)
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace('/*DATA*/[]', () => data.replaceAll('<', '\\u003c'))
  fs.writeFileSync(path.join(runsDir, 'output.html'), html)
  return [`${runbooksDir}/_runs/output.json`, `${runbooksDir}/_runs/output.html`]
}

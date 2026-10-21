// Reads the steps of a runbook body: headings, Parents, Viewports, Roles, As and the per-role lines of Expected.

import { OUTCOMES } from './roles.mjs'

const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const PARENTS_LINE = /^Parents:\s*(.*)$/
const VIEWPORTS_LINE = /^Viewports:\s*(.*)$/
const ROLES_LINE = /^Roles:\s*(.*)$/
const AS_LINE = /^As:\s*(.*)$/
const EXPECTED_LINE = /^Expected:/
const FIELD_LINE = /^[A-Z][A-Za-z ]*:/
// A --- rule or any heading ends Expected, so Not covered and Cleanup bullets never read as role lines.
const SECTION_END = /^(---\s*$|#)/
const ROLE_OUTCOME_LINE = /^\s*-\s+([a-z0-9][a-z0-9-]*):\s+([a-z-]+)\b/

const nameList = (text) => text.split(',').map((p) => p.trim().replace(/`/g, '')).filter((p) => p && p !== 'none')

export function parseSteps(body) {
  const steps = []
  let inExpected = false
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(STEP_HEADING)
    if (heading) {
      steps.push({ step: heading[1], title: heading[2].trim(), parents: [], viewports: [], roles: [], outcomes: {}, as: null })
      inExpected = false
      continue
    }
    if (steps.length === 0) continue
    const current = steps.at(-1)
    if (EXPECTED_LINE.test(line)) {
      inExpected = true
      continue
    }
    if (FIELD_LINE.test(line) || SECTION_END.test(line)) inExpected = false
    const parents = line.match(PARENTS_LINE)
    if (parents) current.parents = nameList(parents[1])
    const viewports = line.match(VIEWPORTS_LINE)
    if (viewports) current.viewports = nameList(viewports[1])
    const roles = line.match(ROLES_LINE)
    if (roles) current.roles = nameList(roles[1])
    const as = line.match(AS_LINE)
    if (as) current.as = as[1].trim().replace(/`/g, '') || null
    if (inExpected) {
      const outcome = line.match(ROLE_OUTCOME_LINE)
      // A bullet whose keyword is not an outcome ("- status: paid") is plain Expected text.
      if (outcome && OUTCOMES.includes(outcome[2])) current.outcomes[outcome[1]] = outcome[2]
    }
  }
  return steps
}

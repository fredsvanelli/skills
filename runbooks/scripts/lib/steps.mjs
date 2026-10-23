// Reads the steps of a runbook body: headings, Parents, Viewports, Roles, Cases, As and the per-role lines of Expected.

import { OUTCOMES } from './roles.mjs'

const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const PARENTS_LINE = /^Parents:\s*(.*)$/
const VIEWPORTS_LINE = /^Viewports:\s*(.*)$/
const ROLES_LINE = /^Roles:\s*(.*)$/
const CASES_LINE = /^Cases:\s*(.*)$/
const AS_LINE = /^As:\s*(.*)$/
const EXPECTED_LINE = /^Expected:/
const FIELD_LINE = /^[A-Z][A-Za-z ]*:/
// A --- rule or any heading ends Expected, so Not covered and Cleanup bullets never read as role lines.
const SECTION_END = /^(---\s*$|#)/
// A code block (a Request or a response body) holds text that is never a field or a role line.
const FENCE = /^\s*```/
const ROLE_OUTCOME_LINE = /^\s*-\s+([a-z0-9][a-z0-9-]*)(?:\s+in\s+([a-z0-9][a-z0-9-]*(?:\s*,\s*[a-z0-9][a-z0-9-]*)*))?:\s+([a-z-]+)\b/
const PRECONDITIONS_HEADING = /^##\s+Preconditions\s*$/
const CASES_BULLET = /^-\s+Cases:\s*$/
const CASE_BULLET = /^\s+-\s+([a-z0-9][a-z0-9-]*):\s*(.*?)\s*$/

const nameList = (text) => text.split(',').map((p) => p.trim().replace(/`/g, '')).filter((p) => p && p !== 'none')

// A line with no case sets outcomes[role]. A line with cases sets caseOutcomes[role][case] for each case.
// Two lines for the same role and case add one label to duplicates: "manager" or "manager in vip-team".
function recordRoleLine(step, seen, role, caseList, outcome) {
  if (!caseList) {
    if (seen.has(role)) addOnce(step.duplicates, role)
    seen.add(role)
    step.outcomes[role] = outcome
    return
  }
  if (!Object.hasOwn(step.caseOutcomes, role)) step.caseOutcomes[role] = {}
  for (const name of caseList.split(',').map((c) => c.trim())) {
    const label = `${role} in ${name}`
    if (seen.has(label)) addOnce(step.duplicates, label)
    seen.add(label)
    step.caseOutcomes[role][name] = outcome
  }
}

const addOnce = (list, item) => {
  if (!list.includes(item)) list.push(item)
}

export function parseSteps(body) {
  const steps = []
  let inExpected = false
  let inFence = false
  let seen = new Set()
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence || FENCE.test(line)) continue
    const heading = line.match(STEP_HEADING)
    if (heading) {
      steps.push({ step: heading[1], title: heading[2].trim(), parents: [], viewports: [], roles: [], cases: [], outcomes: {}, caseOutcomes: {}, duplicates: [], as: null })
      inExpected = false
      seen = new Set()
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
    const cases = line.match(CASES_LINE)
    if (cases) current.cases = nameList(cases[1])
    const as = line.match(AS_LINE)
    if (as) current.as = as[1].trim().replace(/`/g, '') || null
    if (inExpected) {
      const outcome = line.match(ROLE_OUTCOME_LINE)
      // A bullet whose keyword is not an outcome ("- status: paid") is plain Expected text.
      if (outcome && OUTCOMES.includes(outcome[3])) recordRoleLine(current, seen, outcome[1], outcome[2], outcome[3])
    }
  }
  return steps
}

// The bullets under "- Cases:" in ## Preconditions, case name to text. Ends at a --- line or any heading.
export function parsePreconditionCases(body) {
  const found = {}
  let inPreconditions = false
  let inCases = false
  for (const line of body.split(/\r?\n/)) {
    if (PRECONDITIONS_HEADING.test(line)) {
      inPreconditions = true
      continue
    }
    if (!inPreconditions) continue
    if (SECTION_END.test(line)) break
    if (CASES_BULLET.test(line)) {
      inCases = true
      continue
    }
    const bullet = inCases ? line.match(CASE_BULLET) : null
    if (bullet) found[bullet[1]] = bullet[2]
    else if (/^\S/.test(line)) inCases = false
  }
  return found
}

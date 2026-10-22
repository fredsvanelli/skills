import { actionsByCase, noAccountRoles } from './roles.mjs'

const sameActions = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

// True when the role's actions are the same in every case of the runbook and no role line names it with a case.
export function runsOnce(registry, runbook, steps, role) {
  if (!runbook.context) return false
  if (steps.some((step) => step.caseOutcomes && Object.hasOwn(step.caseOutcomes, role))) return false
  const byCase = actionsByCase(registry, role, runbook.capability, runbook.feature)
  if (byCase === null) return false
  const lists = (runbook.cases ?? []).map((kase) => Object.hasOwn(byCase, kase) ? byCase[kase] : [])
  return lists.every((list) => sameActions(list, lists[0]))
}

export function casePlan(registry, runbook, steps) {
  if (!runbook.context) return null
  const cases = runbook.cases ?? []
  const plan = {}
  for (const role of runbook.roles ?? []) {
    const once = runsOnce(registry, runbook, steps, role)
    plan[role] = { once, cases: once ? cases.slice(0, 1) : [...cases] }
  }
  return plan
}

export function passPlan(registry, config, runbook, steps, { roles, cases } = {}) {
  const plan = casePlan(registry, runbook, steps)
  const noAccount = noAccountRoles(config, runbook)
  const viewports = runbook.viewports?.length > 0 ? runbook.viewports : [null]
  const passes = []
  for (const role of runbook.roles ?? []) {
    if (roles && !roles.includes(role)) continue
    const entry = plan === null || !Object.hasOwn(plan, role) ? null : plan[role]
    const items = entry === null ? [{ case: null, dataCase: null }]
      : entry.once ? [{ case: '*', dataCase: entry.cases[0] ?? null }]
        : entry.cases.map((kase) => ({ case: kase, dataCase: kase }))
    for (let item of items) {
      if (cases && item.case !== null) {
        if (item.case === '*') {
          const dataCase = (runbook.cases ?? []).find((kase) => cases.includes(kase))
          if (dataCase === undefined) continue
          item = { ...item, dataCase }
        } else if (!cases.includes(item.case)) continue
      }
      for (const viewport of viewports) {
        passes.push({ role, case: item.case, dataCase: item.dataCase, viewport, noAccount: noAccount.includes(role) })
      }
    }
  }
  return passes
}

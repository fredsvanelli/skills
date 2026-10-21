export const STEP_STATES = ['passed', 'failed', 'blocked', 'blocked-by-parent', 'waived', 'not-applicable', 'no-account']

export function nextStatus(current, states, { partial = false } = {}) {
  const unknown = states.filter((state) => !STEP_STATES.includes(state))
  if (unknown.length > 0) throw new Error(`unknown step state: ${unknown.join(', ')}`)
  if (partial || current !== 'draft') return current
  const clean = states.every((state) => ['passed', 'waived', 'not-applicable', 'no-account'].includes(state))
  return clean && states.includes('passed') ? 'active' : 'draft'
}

const DAY_MS = 24 * 60 * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')

// The local calendar date as YYYY-MM-DD.
export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const utcDay = (date) => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

// Whole days from `date` to `today`, both YYYY-MM-DD. UTC keeps DST from shifting the result.
export const daysSince = (date, today) => Math.round((utcDay(today) - utcDay(date)) / DAY_MS)

// Only active and draft runbooks go stale. No last run date counts as stale.
export function staleState(runbook, { today, staleDays }) {
  const date = runbook.lastRun?.date
  const age = date == null ? null : daysSince(String(date).slice(0, 10), today)
  const tracked = runbook.status === 'active' || runbook.status === 'draft'
  return { stale: tracked && (age === null || age > staleDays), age }
}

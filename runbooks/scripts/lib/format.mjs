const escapeCell = (value) => String(value ?? '').replaceAll('|', '\\|')

export function pct(part, total) {
  if (total === 0) return 'n/a'
  return `${Math.round((part / total) * 1000) / 10}%`
}

function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n')
}

const bullets = (items) => (items.length > 0 ? items.map((item) => `- ${item}`) : ['None.'])

export function lastRunText(lastRun) {
  if (!lastRun || !lastRun.date) return 'never'
  return [lastRun.date, lastRun.result, lastRun.outdated === true && '(outdated)'].filter(Boolean).join(' ')
}

export function listMarkdown(runbooks, reasons = null) {
  if (runbooks.length === 0) return 'No runbooks match.\n'
  const header = ['Id', 'Title', 'Capability / feature', 'Status', 'Last run']
  if (reasons) header.push('Why')
  const rows = runbooks.map((rb) => {
    const row = [
      rb.id,
      rb.title,
      rb.feature ? `${rb.capability} / ${rb.feature}` : rb.capability,
      rb.problems.length > 0 ? 'invalid' : rb.status,
      lastRunText(rb.lastRun),
    ]
    if (reasons) row.push(reasons.get(rb.id).join('; '))
    return row
  })
  return `${table(header, rows)}\n`
}

export function itemsMarkdown(items) {
  if (items.length === 0) return 'No items found.\n'
  return `${table(['Id', 'Kind', 'Slice', 'File'], items.map((i) => [i.id, i.kind, i.slice ?? '', i.file ?? '']))}\n`
}

export function coverageMarkdown(result, scope) {
  const e = result.entries
  const r = result.requirements
  const lines = ['## Script numbers', '', `Scope: ${scope}`, '']
  lines.push(table(['Metric', 'Covered', 'Pending (draft)', 'Planned (placeholder)', 'Total', 'Coverage'], [
    ['Entry points', e.covered, e.pending, e.planned, e.total, pct(e.covered, e.total)],
    r ? ['Requirements', r.covered, r.pending, r.planned, r.total, pct(r.covered, r.total)] : ['Requirements', '-', '-', '-', '-', result.requirementsNote ?? 'no requirement source configured'],
  ]), '')
  lines.push(`Active runbooks: ${result.runbooks.active}. Draft runbooks: ${result.runbooks.draft}. Placeholders: ${result.runbooks.placeholder}. Active runbooks with a script: ${result.runbooks.automated}.`, '')
  const bySurface = result.groups.some((g) => g.surface)
  const sliceHeader = ['Slice', ...(bySurface ? ['Surface'] : []), 'Covered', 'Pending (draft)', 'Planned (placeholder)', 'Total', 'Coverage']
  const sliceRows = result.groups.map((g) => [g.name, ...(bySurface ? [g.surface] : []), g.covered, g.pending, g.planned, g.total, pct(g.covered, g.total)])
  lines.push('### By slice', '', table(sliceHeader, sliceRows), '')
  if (bySurface) lines.push('An API endpoint counts as covered only through an `api` runbook; a `ui` runbook citing it does not.', '')
  lines.push('### Uncovered entry points', '', ...bullets(e.uncovered.map((i) => `\`${i.id}\`${i.file ? ` (\`${i.file}\`)` : ''}${i.citedByMocked ? `, cited, not covered (mocked: ${i.citedByMocked.join(', ')})` : ''}`)), '')
  if (r) lines.push('### Uncovered requirements', '', ...bullets(r.uncovered.map((i) => `\`${i.id}\`${i.title ? `: ${i.title}` : ''}`)), '')
  lines.push('### Orphans', '')
  if (result.orphanChecksSkipped && result.orphanChecksSkipped.length > 0) {
    const labels = result.orphanChecksSkipped.map((kind) => (kind === 'entry' ? 'entry points' : 'requirements'))
    lines.push(`Orphan check skipped for ${labels.join(', ')}: a source did not run (see Warnings).`, '')
  }
  lines.push(...bullets(result.orphans.map((o) => `\`${o.runbook}\` cites ${o.kind} \`${o.ref}\`, which no longer exists`)), '')
  lines.push('### Invalid runbooks', '', ...bullets(result.invalid.map((i) => `\`${i.path}\`: ${i.problems.join('; ')}`)), '')
  if (result.warnings && result.warnings.length > 0) lines.push('### Warnings', '', ...bullets(result.warnings), '')
  return `${lines.join('\n')}`
}

export function checkMarkdown({ id, title, lastRun, full, latest, lastRunIsLatest }) {
  const name = title ? `${id} (${title})` : id
  if (!latest) {
    const dangling = lastRun?.report ? `\nlast_run cites ${lastRun.report}, which does not exist.` : ''
    return `${name} has never ${full ? 'had a full run' : 'been run'}.${dangling}\n`
  }
  const where = [
    latest.date,
    latest.commit && `commit ${latest.commit}`,
    latest.branch && `branch ${latest.branch}`,
    latest.mode && `mode ${latest.mode}`,
    latest.partial ? 'partial run (--steps)' : 'full run',
  ].filter(Boolean).join(' · ')
  const steps = Object.entries(latest.counts).map(([state, count]) => `${count} ${state}`).join(', ') || 'none found'
  const lines = [
    `Last ${full ? 'full run' : 'run'} of ${name}: ${latest.result ?? 'unknown'}`,
    `Report: ${latest.path}`,
    `Date: ${where}`,
    `Steps: ${steps}`,
  ]
  if (!lastRunIsLatest) {
    lines.push(lastRun?.date
      ? `Last full run (last_run): ${lastRunText(lastRun)}, report ${lastRun.report}`
      : 'Last full run (last_run): never')
  }
  if (lastRun?.outdated === true) lines.push('Outdated: the runbook changed after its last full run')
  return `${lines.join('\n')}\n`
}

export function junitMarkdown({ id, steps, result, extra, others }) {
  const withViewport = steps.some((s) => s.viewport)
  const label = (s) => (s.viewport ? `${s.step} @ ${s.viewport}` : s.step)
  const missing = steps.filter((s) => s.tests.length === 0).map(label)
  const duplicates = steps.filter((s) => s.tests.length > 1).map(label)
  const lines = [`Result of ${id}: ${result}`, '']
  lines.push(withViewport
    ? table(['Viewport', 'Step', 'State', 'Seen', 'Tests'], steps.map((s) => [s.viewport, s.step, s.state, s.seen, s.tests.join('; ')]))
    : table(['Step', 'State', 'Seen', 'Tests'], steps.map((s) => [s.step, s.state, s.seen, s.tests.join('; ')])), '')
  lines.push(`States: ${steps.map((s) => s.state).join(',')}`, '')
  if (missing.length > 0) lines.push(`Steps with no test: ${missing.join(', ')}`)
  if (duplicates.length > 0) lines.push(`Steps with more than one test: ${duplicates.join(', ')}`)
  if (extra.length > 0) lines.push(`Tests for steps the runbook does not have: ${extra.map((e) => `${e.step} (${e.test})`).join('; ')}`)
  if (others.length > 0) {
    lines.push('', '### Other tests in the file', '', ...others.map((o) => `- ${o.name}: ${o.outcome}${o.seen ? `, ${o.seen}` : ''}`))
  }
  return `${lines.join('\n')}\n`
}

export function fixturesMarkdown({ id, dir, fixtures, sources, problems }) {
  const lines = [
    `Fixtures of ${id} in ${dir}: ${fixtures.length}`,
    `Sources: ${sources.recorded} recorded, ${sources.schema} from the schema, ${sources.handWritten} hand-written`,
    '',
  ]
  if (fixtures.length > 0) {
    lines.push(table(['File', 'Step', 'Request', 'Status'],
      fixtures.map((f) => [f.file, f.step ?? 'all', `${f.request.method} ${f.request.path}`, f.response.status])), '')
  }
  lines.push('### Problems', '', ...bullets(problems))
  return `${lines.join('\n')}\n`
}

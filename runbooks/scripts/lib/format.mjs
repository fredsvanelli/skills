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

function reviewLine(entry) {
  const change = entry.change ? ` (${entry.change})` : ''
  return `Review: ${[entry.reason, entry.role, entry.key && `${entry.key}${change}`, entry.date].filter(Boolean).join(', ')}`
}

export function checkMarkdown({ id, title, lastRun, full, latest, lastRunIsLatest, review = [] }) {
  const name = title ? `${id} (${title})` : id
  const reviewLines = review.map(reviewLine)
  if (!latest) {
    const dangling = lastRun?.report ? `\nlast_run cites ${lastRun.report}, which does not exist.` : ''
    return `${[`${name} has never ${full ? 'had a full run' : 'been run'}.${dangling}`, ...reviewLines].join('\n')}\n`
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
  lines.push(...reviewLines)
  return `${lines.join('\n')}\n`
}

export function junitMarkdown({ id, steps, result, extra, others }) {
  const withViewport = steps.some((s) => s.viewport)
  const withRole = steps.some((s) => s.role)
  const label = (s) => `${s.step}${s.role ? ` as ${s.role}` : ''}${s.viewport ? ` @ ${s.viewport}` : ''}`
  const missing = steps.filter((s) => s.tests.length === 0 && s.state !== 'not-applicable' && s.state !== 'no-account').map(label)
  const duplicates = steps.filter((s) => s.tests.length > 1).map(label)
  const lines = [`Result of ${id}: ${result}`, '']
  const columns = [withRole && ['Role', (s) => s.role], withViewport && ['Viewport', (s) => s.viewport], ['Step', (s) => s.step],
    ['State', (s) => s.state], ['Seen', (s) => s.seen], ['Tests', (s) => s.tests.join('; ')]].filter(Boolean)
  lines.push(table(columns.map(([name]) => name), steps.map((s) => columns.map(([, cell]) => cell(s)))), '')
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

export function moveToCallsMarkdown({ source, sourceRoot, runbooks, left, orphansLeft, coverage, written }) {
  const { before, after } = coverage
  const lines = [
    source === null ? 'Moves the orphan endpoint ids to calls.' : `Moves the ids of entries[${source}] (root "${sourceRoot}") to calls.`,
    `Entry coverage: ${before.covered} of ${before.total} (${pct(before.covered, before.total)}) now, ${after.covered} of ${after.total} (${pct(after.covered, after.total)}) after.`,
    '',
  ]
  lines.push(runbooks.length === 0 ? 'No runbook cites these ids.' : table(['Runbook', 'Leaves covers.entries', 'calls after'],
    runbooks.map((rb) => [rb.id, rb.move.join(', '), rb.calls.join(', ')])), '')
  if (left.length > 0) lines.push('### Left in place', '', ...bullets(left.map((l) => `\`${l.id}\`: ${l.ids.join(', ')}. ${l.reason}`)), '')
  lines.push('### Orphans left for /runbooks:update', '', ...bullets(orphansLeft.map((o) => `\`${o.runbook}\` cites \`${o.ref}\``)), '')
  lines.push(written.length > 0 ? `Written: ${written.join(', ')}.` : 'Dry run: nothing written. Run again with --write to apply.')
  return `${lines.join('\n')}\n`
}

// mark-review and enable-roles: one row per runbook with its roles and review entries after the edit.
export function reviewPlanMarkdown({ title, runbooks, skipped = [], written, write }) {
  const describe = (entry) => [entry.reason, entry.role, entry.key, entry.change].filter(Boolean).join(' ')
  const reviewCell = (review) => (Array.isArray(review) ? review.map(describe).join('; ') || 'none' : review ? 'adds roles-enabled' : 'unchanged')
  const lines = [title, '']
  lines.push(runbooks.length === 0 ? 'No runbook to change.' : table(['Runbook', 'Roles', 'Review after'],
    runbooks.map((rb) => [rb.id, rb.roles ?? 'unchanged', reviewCell(rb.review)])), '')
  if (skipped.length > 0) lines.push('### Skipped', '', ...bullets(skipped.map((s) => `\`${s.id}\`: ${s.reason}`)), '')
  if (written.length > 0) lines.push(`Written: ${written.join(', ')}.`)
  else lines.push(write ? 'Nothing to change.' : 'Dry run: nothing written. Run again with --write to apply.')
  return `${lines.join('\n')}\n`
}

export function contractMarkdown({ schema, runbooks, findings }) {
  const lines = [
    schema ? `Contract: ${schema}. Runbooks checked: ${runbooks.length}.` : `Runbooks checked: ${runbooks.length}.`,
    ...(schema ? [] : ['No upstream.schema in the config: calls and fixtures were checked against each other only.']),
    '',
    findings.length === 0 ? 'No findings.' : table(['Runbook', 'Kind', 'Finding'], findings.map((f) => [f.runbook, f.kind, f.message])),
  ]
  return `${lines.join('\n')}\n`
}

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
  return [lastRun.date, lastRun.result].filter(Boolean).join(' ')
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
  lines.push(table(['Metric', 'Covered', 'Pending (draft)', 'Total', 'Coverage'], [
    ['Entry points', e.covered, e.pending, e.total, pct(e.covered, e.total)],
    r ? ['Requirements', r.covered, r.pending, r.total, pct(r.covered, r.total)] : ['Requirements', '-', '-', '-', result.requirementsNote ?? 'no requirement source configured'],
  ]), '')
  lines.push(`Active runbooks: ${result.runbooks.active}. Draft runbooks: ${result.runbooks.draft}. Active runbooks with a to-script spec: ${result.runbooks.automated}.`, '')
  lines.push('### By slice', '', table(['Slice', 'Covered', 'Pending (draft)', 'Total', 'Coverage'], result.groups.map((g) => [g.name, g.covered, g.pending, g.total, pct(g.covered, g.total)])), '')
  lines.push('### Uncovered entry points', '', ...bullets(e.uncovered.map((i) => `\`${i.id}\`${i.file ? ` (\`${i.file}\`)` : ''}`)), '')
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

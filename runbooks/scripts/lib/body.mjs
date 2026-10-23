// Splits a runbook body into its sections and steps for the UI. Every HTML value comes
// from renderMarkdown, so nothing here builds markup.
import { renderMarkdown } from './markdown.mjs'

const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const SECTION_HEADING = /^##\s+(.*?)\s*$/
const SEPARATOR = /^\s*---\s*$/
const FIELD_LINE = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/
const BLOCK_NAMES = { Actions: 'actions', Request: 'request', Expected: 'expected' }
const FENCE = /^\s*```/

function renderOrNull(lines) {
  const text = lines.join('\n').trim()
  return text ? renderMarkdown(text) : null
}

function parseStep(heading, lines) {
  const fields = []
  const blocks = { actions: [], request: [], expected: [] }
  let current = null
  let inFence = false
  for (const line of lines) {
    // A code block stays whole in its block: no line of it is a field or a separator.
    if (FENCE.test(line) || inFence) {
      if (FENCE.test(line)) inFence = !inFence
      if (current) blocks[current].push(line)
      continue
    }
    if (SEPARATOR.test(line)) continue
    const match = FIELD_LINE.exec(line)
    const block = match && BLOCK_NAMES[match[1]]
    if (block) {
      current = block
      blocks[block].push(match[2])
    } else if (current) {
      blocks[current].push(line)
    } else if (match) {
      fields.push({ name: match[1], value: match[2].replace(/`/g, '').trim() })
    }
  }
  return {
    step: heading[1],
    title: heading[2].trim(),
    fields,
    actions: renderOrNull(blocks.actions),
    request: renderOrNull(blocks.request),
    expected: renderOrNull(blocks.expected),
  }
}

function parseSteps(lines) {
  const steps = []
  let heading = null
  let stepLines = []
  const flush = () => {
    if (heading) steps.push(parseStep(heading, stepLines))
  }
  for (const line of lines) {
    const match = STEP_HEADING.exec(line)
    if (match) {
      flush()
      heading = match
      stepLines = []
    } else if (heading) {
      stepLines.push(line)
    }
  }
  flush()
  return steps
}

export function parseBody(body) {
  const blocks = []
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const match = SECTION_HEADING.exec(line)
    if (match) blocks.push({ heading: match[1], lines: [] })
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line)
  }
  const sections = []
  let steps = []
  for (const block of blocks) {
    if (block.heading === 'Steps') {
      steps = parseSteps(block.lines)
      continue
    }
    const text = block.lines.filter((line) => !SEPARATOR.test(line)).join('\n').trim()
    if (text) sections.push({ heading: block.heading, html: renderMarkdown(text) })
  }
  return { sections, steps }
}

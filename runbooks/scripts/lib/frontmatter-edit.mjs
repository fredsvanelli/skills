// Rewrites list keys of a runbook's frontmatter in place: covers.entries and calls. Every other line,
// and the body, stays byte for byte as it was. The result is parsed again before it is returned.
import { isDeepStrictEqual } from 'node:util'
import { flowDepth, stripComment, splitFrontmatter, parseYaml } from './yaml.mjs'

// Array.prototype.toSpliced needs Node 20; the plugin supports Node 18.
const spliced = (lines, start, count, ...items) => [...lines.slice(0, start), ...items, ...lines.slice(start + count)]
const indentOf = (line) => line.match(/^ */)[0].length
const isBlank = (line) => stripComment(line).trim() === ''
const isItem = (text) => text === '-' || text.startsWith('- ')

// The cases references/format.md tells authors to quote, plus what a comment or a bracket would break.
const needsQuotes = (value) =>
  value === '' || /^[[{"'\s]/.test(value) || /\s$/.test(value) || value.includes(', ') || /\s#/.test(value) || flowDepth(value) !== 0

const flowList = (values) => `[${values.map((value) => (needsQuotes(value) ? JSON.stringify(value) : value)).join(', ')}]`

// The lines [start, end) that hold `key:` at this indent and its value, or null.
function keySpan(lines, from, to, indent, key) {
  const pattern = new RegExp(`^${key}:(?:\\s+(.*))?$`)
  for (let i = from; i < to; i++) {
    if (isBlank(lines[i]) || indentOf(lines[i]) !== indent) continue
    const match = stripComment(lines[i]).trim().match(pattern)
    if (!match) continue
    const rest = match[1] ?? ''
    let end = i + 1
    if (/^[[{]/.test(rest)) {
      let depth = flowDepth(stripComment(lines[i]))
      while (depth > 0 && end < to) depth += flowDepth(stripComment(lines[end++]))
    } else if (rest === '') {
      for (let j = end; j < to; j++) {
        if (isBlank(lines[j])) continue
        const text = stripComment(lines[j]).trim()
        if (!isItem(text) || indentOf(lines[j]) < indent) break
        end = j + 1
      }
    }
    return { start: i, end }
  }
  return null
}

// The covers block: its key line, the end of its last child and the indent of its children.
function coversSpan(lines) {
  const span = keySpan(lines, 0, lines.length, 0, 'covers')
  if (!span) return null
  if (span.end > span.start + 1 || stripComment(lines[span.start]).trim() !== 'covers:') {
    throw new Error('covers is not a block map; edit it by hand')
  }
  let end = span.start + 1
  let childIndent = null
  for (let j = end; j < lines.length; j++) {
    if (isBlank(lines[j])) continue
    if (indentOf(lines[j]) === 0) break
    childIndent ??= indentOf(lines[j])
    end = j + 1
  }
  return { start: span.start, end, childIndent: childIndent ?? 2 }
}

function setEntries(lines, values) {
  const covers = coversSpan(lines)
  if (!covers) return [...lines, 'covers:', `  entries: ${flowList(values)}`]
  const line = `${' '.repeat(covers.childIndent)}entries: ${flowList(values)}`
  const span = keySpan(lines, covers.start + 1, covers.end, covers.childIndent, 'entries')
  if (!span) return spliced(lines, covers.start + 1, 0, line)
  return spliced(lines, span.start, span.end - span.start, line)
}

function setCalls(lines, values) {
  const span = keySpan(lines, 0, lines.length, 0, 'calls')
  if (values.length === 0) return span ? spliced(lines, span.start, span.end - span.start) : lines
  const line = `calls: ${flowList(values)}`
  if (span) return spliced(lines, span.start, span.end - span.start, line)
  const covers = coversSpan(lines)
  return covers ? spliced(lines, covers.end, 0, line) : [...lines, line]
}

const asStrings = (value) => (value === null || value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(String))

// edits: { 'covers.entries'?: [...], calls?: [...] }.
export function setListKeys(text, edits) {
  const bom = text.startsWith('﻿') ? '﻿' : ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const all = text.slice(bom.length).split(eol)
  const close = all.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line))
  if (all[0] !== '---' || close === -1) throw new Error('no frontmatter block')
  let lines = all.slice(1, close)
  if (edits['covers.entries']) lines = setEntries(lines, edits['covers.entries'])
  if (edits.calls) lines = setCalls(lines, edits.calls)
  const out = `${bom}${['---', ...lines, ...all.slice(close)].join(eol)}`

  const before = parseYaml(splitFrontmatter(text).yaml)
  const after = parseYaml(splitFrontmatter(out).yaml)
  const expected = structuredClone(before)
  if (edits['covers.entries']) expected.covers = { ...expected.covers, entries: edits['covers.entries'] }
  if (edits.calls) {
    if (edits.calls.length > 0) expected.calls = edits.calls
    else delete expected.calls
  }
  const normalized = { ...after, ...(after.covers && { covers: { ...after.covers, entries: asStrings(after.covers.entries) } }), ...(after.calls && { calls: asStrings(after.calls) }) }
  if (!isDeepStrictEqual(normalized, expected)) throw new Error('the edit would change other frontmatter keys; edit it by hand')
  return out
}

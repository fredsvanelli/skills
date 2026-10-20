// Small Markdown renderer for the UI. The output is set with innerHTML, so all text is
// escaped before any tag is added and link targets are limited to http, https and relative.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

// A target is safe when it has no scheme, or the scheme is http or https. Whitespace and
// control characters are removed first because browsers ignore them inside a scheme.
function safeHref(href) {
  const compact = href.replace(/[\s\u0000-\u001f\u007f]/g, '').toLowerCase()
  const scheme = /^[^/?#]*:/.exec(compact)
  if (!scheme) return true
  return compact.startsWith('http:') || compact.startsWith('https:')
}

function renderInline(text) {
  return formatEscaped(escapeHtml(text.replace(/\u0000/g, '')))
}

// Formats text that is already escaped. Code spans and links go into a stash first, so
// bold markers inside code or inside an href are left alone.
function formatEscaped(escaped, stash = []) {
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`
  let out = escaped.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`))
  out = out.replace(/\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (_, label, href) => {
    // A marker in the href means a code span sits inside the target, so it is not a usable link.
    if (href.includes('\u0000') || !safeHref(href)) return formatEscaped(label, stash)
    return keep(`<a href="${href}" target="_blank" rel="noreferrer">${formatEscaped(label, stash)}</a>`)
  })
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)])
}

function splitRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|')
const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])
const isBullet = (line) => /^\s*[-*]\s+/.test(line)
const isNumbered = (line) => /^\s*\d+[.)]\s+/.test(line)
const isHeading = (line) => /^#{1,4}\s+/.test(line)
const isRule = (line) => /^\s*---+\s*$/.test(line)
const isFence = (line) => /^\s*```/.test(line)
const indentOf = (line) => /^\s*/.exec(line)[0].length
const startsBlock = (lines, i) =>
  isFence(lines[i]) || isHeading(lines[i]) || isRule(lines[i]) || isBullet(lines[i]) || isNumbered(lines[i]) || isTableStart(lines, i)

// Renders the lines folded under a list item (a sub-list, a later paragraph) as Markdown of their own.
function renderNested(lines) {
  if (lines.every((line) => line.trim() === '')) return ''
  const indent = Math.min(...lines.filter((line) => line.trim() !== '').map(indentOf))
  return renderMarkdown(lines.map((line) => line.slice(indent)).join('\n'))
}

// Reads one list from lines[i]. A line indented past the list's markers belongs to the item above
// it: plain text continues the item, anything after a nested block starts goes into that block.
// A blank line keeps the list open when the next line is another item or indented content.
function readList(lines, i) {
  const ordered = isNumbered(lines[i])
  const base = indentOf(lines[i])
  const isItem = (line) => (ordered ? isNumbered(line) : isBullet(line)) && indentOf(line) <= base
  const strip = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/
  const start = ordered ? /^\s*(\d+)/.exec(lines[i])[1].replace(/^0+(?=\d)/, '') : '1'
  const items = []
  while (i < lines.length) {
    const line = lines[i]
    const item = items[items.length - 1]
    if (line.trim() === '') {
      const next = lines[i + 1]
      if (next === undefined || next.trim() === '' || !(isItem(next) || indentOf(next) > base)) break
      if (!isItem(next)) item.nested.push('')
    } else if (isItem(line)) {
      items.push({ text: [line.replace(strip, '')], nested: [] })
    } else if (indentOf(line) > base || !startsBlock(lines, i)) {
      const nestedStarts = item.nested.length === 0 && indentOf(line) > base && startsBlock(lines, i)
      if (item.nested.length > 0 || nestedStarts) item.nested.push(line)
      else item.text.push(line.trim())
    } else {
      break
    }
    i++
  }
  const tag = ordered ? 'ol' : 'ul'
  const html = items.map(({ text, nested }) => `<li>${renderInline(text.join(' '))}${renderNested(nested)}</li>`).join('')
  return { html: `<${tag}${start === '1' ? '' : ` start="${start}"`}>${html}</${tag}>`, next: i }
}

export function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const html = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i++; continue }
    if (isFence(line)) {
      const code = []
      i++
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++])
      i++
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
    } else if (isHeading(line)) {
      const [, hashes, title] = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line)
      html.push(`<h${hashes.length}>${renderInline(title)}</h${hashes.length}>`)
      i++
    } else if (isRule(line)) {
      html.push('<hr>')
      i++
    } else if (isTableStart(lines, i)) {
      const head = splitRow(line)
      i += 2
      const body = []
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) body.push(splitRow(lines[i++]))
      const cells = (tag, row) => row.map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`).join('')
      html.push(`<table><thead><tr>${cells('th', head)}</tr></thead><tbody>${body.map((row) => `<tr>${cells('td', row)}</tr>`).join('')}</tbody></table>`)
    } else if (isBullet(line) || isNumbered(line)) {
      const list = readList(lines, i)
      html.push(list.html)
      i = list.next
    } else {
      const para = []
      while (i < lines.length && lines[i].trim() !== '' && !isFence(lines[i]) && !isHeading(lines[i]) && !isRule(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i]) && !isTableStart(lines, i)) {
        para.push(lines[i++].trim())
      }
      html.push(`<p>${renderInline(para.join(' '))}</p>`)
    }
  }
  return html.join('')
}

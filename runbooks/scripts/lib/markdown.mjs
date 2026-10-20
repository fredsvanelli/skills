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
function formatEscaped(escaped) {
  const stash = []
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`
  let out = escaped.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`))
  out = out.replace(/\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (_, label, href) => {
    if (!safeHref(href)) return formatEscaped(label)
    return keep(`<a href="${href}" target="_blank" rel="noreferrer">${formatEscaped(label)}</a>`)
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
      const ordered = isNumbered(line)
      const test = ordered ? isNumbered : isBullet
      const strip = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/
      const items = []
      while (i < lines.length && test(lines[i])) items.push(`<li>${renderInline(lines[i++].replace(strip, ''))}</li>`)
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
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

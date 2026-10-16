// A YAML subset for runbook frontmatter: block maps, block lists of scalars,
// flow lists [a, b], flow maps { k: v }, quoted and plain scalars, comments.
// references/format.md documents the same subset for runbook authors.

export class FrontmatterError extends Error {}

const KEY_LINE = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/

export function splitFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/)
  if (!match) return null
  return { yaml: match[1], body: match[2] }
}

function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function scalar(raw) {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseFlow(text, lineNo) {
  let i = 0
  const fail = (message) => {
    throw new FrontmatterError(`line ${lineNo}: ${message}`)
  }
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const readUntil = (stops) => {
    const start = i
    while (i < text.length && !stops.includes(text[i])) i++
    return text.slice(start, i)
  }
  const quoted = () => {
    const quote = text[i++]
    let out = ''
    while (i < text.length && text[i] !== quote) {
      if (quote === '"' && text[i] === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      out += text[i++]
    }
    if (i >= text.length) fail('unterminated string')
    i++
    return out
  }
  const value = (stops) => {
    skipSpace()
    if (text[i] === '[') {
      i++
      const list = []
      skipSpace()
      if (text[i] === ']') {
        i++
        return list
      }
      for (;;) {
        list.push(value(',]'))
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return list
        }
        fail('expected , or ]')
      }
    }
    if (text[i] === '{') {
      i++
      const map = {}
      skipSpace()
      if (text[i] === '}') {
        i++
        return map
      }
      for (;;) {
        skipSpace()
        const key = text[i] === '"' || text[i] === "'" ? quoted() : readUntil(':,}').trim()
        skipSpace()
        if (text[i] !== ':') fail(`expected : after "${key}"`)
        i++
        map[key] = value(',}')
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return map
        }
        fail('expected , or }')
      }
    }
    if (text[i] === '"' || text[i] === "'") return quoted()
    return scalar(readUntil(stops))
  }
  const result = value('')
  skipSpace()
  if (i < text.length) fail(`unexpected "${text[i]}"`)
  return result
}

const isItem = (text) => text === '-' || text.startsWith('- ')
const itemText = (text) => text.slice(1).trim()

function parseBlock(lines, start, indent) {
  const list = isItem(lines[start].text)
  const result = list ? [] : {}
  let i = start
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i]
    if (list) {
      if (!isItem(line.text)) throw new FrontmatterError(`line ${line.no}: expected a list item`)
      result.push(parseFlow(itemText(line.text), line.no))
      i++
      continue
    }
    const match = line.text.match(KEY_LINE)
    if (!match) throw new FrontmatterError(`line ${line.no}: expected "key: value"`)
    const [, key, rest] = match
    i++
    if (rest) {
      result[key] = parseFlow(rest, line.no)
    } else if (i < lines.length && lines[i].indent > indent) {
      const [child, next] = parseBlock(lines, i, lines[i].indent)
      result[key] = child
      i = next
    } else if (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
      const items = []
      while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
        items.push(parseFlow(itemText(lines[i].text), lines[i].no))
        i++
      }
      result[key] = items
    } else {
      result[key] = null
    }
  }
  return [result, i]
}

export function parseYaml(text) {
  const lines = []
  text.replace(/\r\n/g, '\n').split('\n').forEach((raw, index) => {
    const content = stripComment(raw)
    if (content.trim() === '') return
    const leading = content.match(/^\s*/)[0]
    if (leading.includes('\t')) throw new FrontmatterError(`line ${index + 1}: tabs are not allowed for indentation`)
    lines.push({ no: index + 1, indent: leading.length, text: content.trim() })
  })
  if (lines.length === 0) return {}
  const [value, next] = parseBlock(lines, 0, lines[0].indent)
  if (next < lines.length) throw new FrontmatterError(`line ${lines[next].no}: unexpected indentation`)
  return value
}

// The own permissions of every role as a CSV matrix, one row per role and key and one column per action,
// and the way back: a CSV edited in a spreadsheet replaces the matrix of each role it has rows for.
import fs from 'node:fs'
import { parseRoles, readRolesFile, splitKey, contextOfKey, RolesError } from './roles.mjs'

const YES = ['x', '1', 'true', 'yes']
const NO = ['', '0', 'false', 'no', '-']
const ACTION_NAME = /^[a-z][a-z0-9-]*$/

function csvField(value, delimiter) {
  const text = String(value)
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const csvLine = (fields, delimiter) => fields.map((field) => csvField(field, delimiter)).join(delimiter)

const hasContexts = (registry) => Object.keys(registry.contexts ?? {}).length > 0

export function exportPermissions(registry, { role } = {}) {
  const withCases = hasContexts(registry)
  const header = ['role', 'key', ...(withCases ? ['case'] : []), ...registry.actions, 'origin']
  const lines = [csvLine(header, ',')]
  for (const name of registry.names) {
    if (role !== undefined && name !== role) continue
    const { permissions, origins } = registry.roles[name]
    for (const [key, actions] of Object.entries(permissions)) {
      const origin = Object.hasOwn(origins, key) ? origins[key] : ''
      const row = (kase, list) => {
        const marks = registry.actions.map((action) => (list.includes(action) ? 'x' : ''))
        lines.push(csvLine([name, key, ...(withCases ? [kase] : []), ...marks, origin], ','))
      }
      if (Array.isArray(actions)) {
        row('', actions)
      } else {
        for (const kase of registry.contexts[contextOfKey(registry, key)].cases) row(kase, Object.hasOwn(actions, kase) ? actions[kase] : [])
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`
}

// A spreadsheet in a comma-decimal locale saves with ";", so the header line picks the delimiter.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '')
  const count = (char) => firstLine.split(char).length - 1
  return count(';') > count(',') ? ';' : ','
}

// RFC 4180: quoted fields may hold the delimiter, quotes doubled and line breaks. Each row keeps its line number.
export function parseCsv(text) {
  const source = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(source)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        if (char === '\n') line++
        field += char
      }
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push({ line: rowLine, cells: row })
      row = []
      field = ''
      line++
      rowLine = line
    } else {
      field += char
    }
  }
  if (quoted) throw new RolesError(`line ${rowLine}: a quoted field is not closed`)
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push({ line: rowLine, cells: row })
  }
  return { delimiter, rows: rows.filter((r) => r.cells.some((cell) => cell.trim() !== '')) }
}

function readHeader(header, actions, withCases) {
  const names = header.cells.map((cell) => cell.trim())
  const seen = new Set()
  for (const name of names) {
    if (name === '') throw new RolesError(`line ${header.line}: a header cell is empty`)
    if (seen.has(name)) throw new RolesError(`line ${header.line}: column "${name}" appears twice`)
    seen.add(name)
  }
  for (const required of ['role', 'key']) {
    if (!seen.has(required)) throw new RolesError(`line ${header.line}: the header has no "${required}" column`)
  }
  if (withCases && !seen.has('case')) throw new RolesError(`line ${header.line}: the registry has contexts, so the header needs a "case" column`)
  const skipped = withCases ? ['role', 'key', 'case', 'origin'] : ['role', 'key', 'origin']
  const columns = names.map((name, index) => ({ name, index })).filter(({ name }) => !skipped.includes(name))
  for (const { name } of columns) {
    if (!actions.includes(name) && !ACTION_NAME.test(name)) {
      throw new RolesError(`line ${header.line}: column "${name}" is not an action; a new action is lowercase English, like approve`)
    }
  }
  const missing = actions.filter((action) => !seen.has(action))
  if (missing.length > 0) {
    throw new RolesError(`line ${header.line}: the header has no column for ${missing.join(', ')}; a missing column would remove that action from every key`)
  }
  return { role: names.indexOf('role'), key: names.indexOf('key'), case: names.indexOf('case'), columns }
}

function readRows(rows, header, registry, withCases) {
  const byRole = new Map()
  const seen = new Map()
  for (const { line, cells } of rows) {
    const cell = (index) => (cells[index] ?? '').trim()
    const role = cell(header.role)
    const key = cell(header.key)
    if (!registry.names.includes(role)) throw new RolesError(`line ${line}: role "${role}" is not registered; /runbooks:roles:create adds it`)
    if (!splitKey(key)) throw new RolesError(`line ${line}: key "${key}" must be <capability>/<feature> or <capability>/*`)
    const kase = withCases ? cell(header.case) : ''
    let context = null
    if (kase !== '') {
      context = contextOfKey(registry, key)
      if (context === null) throw new RolesError(`line ${line}: key "${key}" belongs to no context, so its case must be empty`)
      if (!registry.contexts[context].cases.includes(kase)) {
        throw new RolesError(registry.caseNames.includes(kase)
          ? `line ${line}: case "${kase}" is not a case of ${context}`
          : `line ${line}: case "${kase}" is not registered; /runbooks:roles:manage-contexts adds it`)
      }
    }
    const id = `${role}\n${key}`
    const rowId = `${id}\n${kase}`
    if (seen.has(rowId)) throw new RolesError(`line ${line}: ${role} "${key}"${kase === '' ? '' : ` in ${kase}`} repeats line ${seen.get(rowId)}`)
    seen.set(rowId, line)
    const earlier = byRole.get(role)?.get(key)
    if (earlier && (earlier.cases === undefined) !== (kase === '')) {
      throw new RolesError(`line ${line}: ${role} "${key}" mixes a row with no case and rows with cases`)
    }
    const actions = []
    for (const { name, index } of header.columns) {
      const value = cell(index).toLowerCase()
      if (YES.includes(value)) actions.push(name)
      else if (!NO.includes(value)) throw new RolesError(`line ${line}, column ${name}: "${cell(index)}" must be x or empty`)
    }
    if (!byRole.has(role)) byRole.set(role, new Map())
    if (kase === '') {
      byRole.get(role).set(key, { list: actions })
    } else {
      if (!earlier) byRole.get(role).set(key, { cases: new Map() })
      byRole.get(role).get(key).cases.set(kase, actions)
    }
  }
  return byRole
}

const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item))

// Both entries expanded to a map over the cases of the key's context, so a list equals the full map of that list.
function sameEntry(registry, key, a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return sameSet(a, b)
  const context = contextOfKey(registry, key)
  if (context === null) return false
  const at = (value, kase) => (Array.isArray(value) ? value : Object.hasOwn(value, kase) ? value[kase] : [])
  return registry.contexts[context].cases.every((kase) => sameSet(at(a, kase), at(b, kase)))
}

// The new entry of one key from its CSV rows: a list, or a map with the cases the CSV has, in context order.
function entryOf(registry, key, row, order) {
  const sorted = (actions) => order.filter((action) => actions.includes(action))
  if (row.list) return sorted(row.list)
  const cases = registry.contexts[contextOfKey(registry, key)].cases.filter((kase) => row.cases.has(kase))
  return Object.fromEntries(cases.map((kase) => [kase, sorted(row.cases.get(kase))]))
}

// Keys keep their order in the file and new keys follow in CSV order. An unchanged key keeps its list and
// its origin; a key added, changed or removed loses its origin, because the CSV replaces what the scanner deduced.
function replaceMatrix(entry, rows, order, registry) {
  const before = entry.permissions ?? {}
  const origins = { ...(entry.origins ?? {}) }
  const permissions = {}
  const changes = []
  for (const [key, actions] of Object.entries(before)) {
    if (!rows.has(key)) {
      changes.push({ key, before: actions, after: null })
      delete origins[key]
    } else if (sameEntry(registry, key, actions, entryOf(registry, key, rows.get(key), order))) {
      permissions[key] = actions
    } else {
      const after = entryOf(registry, key, rows.get(key), order)
      permissions[key] = after
      changes.push({ key, before: actions, after })
      delete origins[key]
    }
  }
  for (const [key, row] of rows) {
    if (Object.hasOwn(before, key)) continue
    const after = entryOf(registry, key, row, order)
    permissions[key] = after
    changes.push({ key, before: null, after })
  }
  const next = { ...entry, permissions }
  if (Object.keys(origins).length > 0) next.origins = origins
  else delete next.origins
  return { next, changes }
}

export function planImport(root, config, registry, csvText, { write = false } = {}) {
  const { rel, file, raw } = readRolesFile(root, config)
  const { delimiter, rows } = parseCsv(csvText)
  if (rows.length === 0) throw new RolesError('the CSV is empty')
  const withCases = hasContexts(registry)
  const header = readHeader(rows[0], registry.actions, withCases)
  const byRole = readRows(rows.slice(1), header, registry, withCases)
  const actionsAdded = header.columns.map(({ name }) => name).filter((name) => !registry.actions.includes(name))
  const order = [...registry.actions, ...actionsAdded]

  const next = { ...raw, roles: { ...(raw.roles ?? {}) } }
  if (actionsAdded.length > 0) next.actions = [...(raw.actions ?? []), ...actionsAdded]
  const changes = []
  const missingCases = []
  for (const [role, keys] of byRole) {
    for (const [key, row] of keys) {
      if (!row.cases) continue
      const missing = registry.contexts[contextOfKey(registry, key)].cases.filter((kase) => !row.cases.has(kase))
      if (missing.length > 0) missingCases.push({ role, key, cases: missing })
    }
    const entry = Object.hasOwn(next.roles, role) ? next.roles[role] : { description: registry.roles[role].description }
    const result = replaceMatrix(entry, keys, order, registry)
    if (result.changes.length === 0) continue
    next.roles[role] = result.next
    changes.push(...result.changes.map((change) => ({ role, ...change })))
  }
  try {
    parseRoles(next, { accounts: config.accounts })
  } catch (err) {
    if (err instanceof RolesError) throw new RolesError(`the imported registry does not load: ${err.message}`)
    throw err
  }
  const plan = {
    file: rel,
    delimiter,
    actionsAdded,
    changes,
    ...(withCases ? { missingCases } : {}),
    kept: registry.names.filter((name) => !byRole.has(name)),
    written: false,
  }
  if (write && (changes.length > 0 || actionsAdded.length > 0)) {
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    plan.written = true
  }
  return plan
}

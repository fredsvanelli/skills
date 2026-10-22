import fs from 'node:fs'
import path from 'node:path'
import { validateSchema, resolveRef } from './schema.mjs'

// Fixtures of runbook <capability>.<flow> live in <fixtures>/<capability>/<flow>, relative to the project root.
export function fixturesDir(config, runbook) {
  const base = config.upstream?.fixtures ?? `${config.paths.runbooks}/_fixtures`
  const flow = runbook.id.slice(runbook.capability.length + 1)
  return `${base.replace(/\/+$/, '')}/${runbook.capability}/${flow}`
}

const STEP_DIR = /^S\d+$/
const ROLE_DIR = /^@[a-z0-9][a-z0-9-]*$/
const CASE_DIR = /^\+[a-z0-9][a-z0-9-]*$/

// Reads every fixture file of a runbook: .json files in its folder (step null) and in S<nn> subfolders.
// An @<role> folder, at the runbook level or inside S<nn>, holds the fixtures of that role. With roles null
// (role tracking off) a role folder is a problem; otherwise its role must be one of roles. A +<case> folder
// sits at the runbook level, inside S<nn>, inside @<role> and inside S<nn>/@<role>. With cases null (the
// runbook has no context) a case folder is a problem; otherwise its case must be one of cases.
export function loadFixtures(root, dir, { roles = null, cases = null } = {}) {
  const fixtures = []
  const problems = []
  const base = path.resolve(root, dir)
  if (!fs.existsSync(base)) return { fixtures, problems }
  const readDir = (folder, step, role = null, kase = null) => {
    for (const name of fs.readdirSync(path.join(base, folder)).sort()) {
      if (!name.endsWith('.json')) continue
      const file = [dir.replace(/\/+$/, ''), folder, name].filter(Boolean).join('/')
      let data
      try {
        data = JSON.parse(fs.readFileSync(path.join(base, folder, name), 'utf8'))
      } catch (err) {
        problems.push(`${file}: not valid JSON (${err.message})`)
        continue
      }
      const missing = []
      if (!data?.request?.method) missing.push('request.method')
      if (!data?.request?.path) missing.push('request.path')
      if (data?.response?.status === undefined) missing.push('response.status')
      if (missing.length > 0) {
        problems.push(`${file}: missing ${missing.join(', ')}`)
        continue
      }
      fixtures.push({ file, step, role, case: kase, request: data.request, response: data.response, source: data.source })
    }
  }
  const label = (folder) => `${dir.replace(/\/+$/, '')}/${folder}`
  // Reads the @<role> folders directly inside parent ('' for the runbook level), for the given step.
  const readRoles = (parent, step) => {
    const entries = fs.readdirSync(path.join(base, parent), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('@')) continue
      const folder = parent ? `${parent}/${entry.name}` : entry.name
      const role = entry.name.slice(1)
      if (!ROLE_DIR.test(entry.name)) problems.push(`${label(folder)}: not a role folder`)
      else if (roles === null) problems.push(`${label(folder)}: role folders need role tracking`)
      else if (!roles.includes(role)) problems.push(`${label(folder)}: role ${role} is not registered`)
      else {
        readDir(folder, step, role)
        readCases(folder, step, role)
      }
    }
  }
  // Reads the +<case> folders directly inside parent ('' for the runbook level), for the given step and role.
  function readCases(parent, step, role) {
    const entries = fs.readdirSync(path.join(base, parent), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('+')) continue
      const folder = parent ? `${parent}/${entry.name}` : entry.name
      const kase = entry.name.slice(1)
      if (!CASE_DIR.test(entry.name)) problems.push(`${label(folder)}: not a case folder`)
      else if (cases === null) problems.push(`${label(folder)}: case folders need a context`)
      else if (!cases.includes(kase)) problems.push(`${label(folder)}: case ${kase} is not one of the runbook's cases`)
      else readDir(folder, step, role, kase)
    }
  }
  const entries = fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  readDir('', null)
  readCases('', null, null)
  readRoles('', null)
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('@') || entry.name.startsWith('+')) continue
    if (STEP_DIR.test(entry.name)) {
      readDir(entry.name, entry.name)
      readCases(entry.name, entry.name, null)
      readRoles(entry.name, entry.name)
    } else problems.push(`${label(entry.name)}: not a step folder`)
  }
  return { fixtures, problems }
}

export function sourceCounts(fixtures) {
  const counts = { recorded: 0, schema: 0, handWritten: 0 }
  for (const { source } of fixtures) {
    const text = typeof source === 'string' ? source : ''
    if (text.startsWith('recorded ')) counts.recorded++
    else if (text.startsWith('schema')) counts.schema++
    else if (text.startsWith('hand-written')) counts.handWritten++
  }
  return counts
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function findTemplate(templates, requestPath) {
  if (templates.includes(requestPath)) return requestPath
  return templates.find((template) =>
    new RegExp(`^${template.split(/\{[^}]+\}/).map(escapeRegex).join('[^/]+')}$`).test(requestPath))
}

export function serverPrefix(doc) {
  const url = doc?.servers?.[0]?.url
  if (typeof url !== 'string') return ''
  try {
    return new URL(url, 'http://placeholder').pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

// A path item or a response may be a local $ref into components.
function deref(node, doc) {
  return typeof node?.$ref === 'string' ? resolveRef(node.$ref, doc) : node
}

function isJson(response) {
  const header = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')
  if (header) return String(header[1]).toLowerCase().includes('json')
  return typeof response.body !== 'string'
}

// Checks each JSON response body against the schema of its operation in the OpenAPI document.
export function checkFixtures(fixtures, doc) {
  const problems = []
  const templates = Object.keys(doc?.paths ?? {})
  const prefix = serverPrefix(doc)
  for (const fixture of fixtures) {
    const { method, path: rawPath } = fixture.request
    const requestPath = String(rawPath).split('?')[0]
    let template = findTemplate(templates, requestPath)
    if (!template && prefix && requestPath.startsWith(`${prefix}/`)) {
      template = findTemplate(templates, requestPath.slice(prefix.length))
    }
    const operation = template ? deref(doc.paths[template], doc)?.[String(method).toLowerCase()] : undefined
    if (!operation) {
      problems.push(`${fixture.file}: no operation for ${String(method).toUpperCase()} ${requestPath} in the schema`)
      continue
    }
    const { response } = fixture
    const responses = operation.responses ?? {}
    const declared = deref(responses[String(response.status)] ?? responses.default, doc)
    if (!declared) {
      problems.push(`${fixture.file}: no response ${response.status} for ${String(method).toUpperCase()} ${requestPath} in the schema`)
      continue
    }
    const schema = declared.content?.['application/json']?.schema
    if (!schema || !isJson(response) || response.body === undefined) continue
    for (const message of validateSchema(response.body, schema, doc)) problems.push(`${fixture.file}: ${message}`)
  }
  return problems
}
